import Phaser from 'phaser'
import { alignedAction, alignedAnimations, alignedSheetUrl, alignedSprites, registerGeneratedSprite, type AlignedSprite, type AlignedSpriteId } from '../ui/animation/SheetSpriteManifest'
import { GENERATED_ORIGIN_Y } from '../ui/animation/TemporarySpriteManifest'
import { clearGeneratedHitMasks, forgetPixelSource, setPixelSource, warmAttackPose, warmIdleMasks } from '../ui/animation/SpriteHitTest'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'
import { headKey, paintHead } from '../ui/p1/headCrop'

const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
type Sheet = { filename: string; frames: number; cellSize: number }
type Asset = { id: string; displayName: string; fps: number; actions: Record<string, Sheet> }
type Status = { status: 'processing' | 'failed' } | ({ status: 'ready' } & Asset)

async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal, method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw Object.assign(new Error(`Generation request failed (${response.status})`), { status: response.status })
  return await response.json() as T
}

/** 一次生成實測約 110–160 秒；超過就視為 ComfyUI 卡住，交給 P3 重試。 */
export const GENERATION_TIMEOUT_MS = 6 * 60_000
const POLL_MS = 3000

const wait = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const abort = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
})

/** 刪掉貼圖連同它的讀像素縮小圖。 */
const removeTexture = (scene: Phaser.Scene, key: string): void => { forgetPixelSource(key); scene.textures.remove(key) }

/** sprite 省略＝全部生成角色。 */
export function dropGeneratedTextures(scene: Phaser.Scene, sprite = 'generated'): void {
  clearGeneratedHitMasks(sprite)
  scene.textures.getTextureKeys().filter((key) => key.startsWith(`${sprite}-`)).forEach((key) => removeTexture(scene, key))
}

const HIT_SAMPLE_SIZE = 512
type DecodedSheet = { image: ImageBitmap; sample: ImageBitmap; scale: number }
/** 圖集在背景執行緒解碼成 ImageBitmap：上傳 GPU 約 10ms（HTMLImageElement 約 60ms，P3／開戰會卡）；另做命中判定讀像素用的半尺寸版。 */
async function decodeSheet(blob: Blob, cell: number): Promise<DecodedSheet> {
  const image = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' }), scale = Math.min(1, HIT_SAMPLE_SIZE / cell)
  // 從 blob 再解碼一次縮小版：也在背景執行緒；從 image 縮放會在主執行緒做。
  const sample = await createImageBitmap(blob, { resizeWidth: Math.round(image.width * scale), resizeHeight: Math.round(image.height * scale), resizeQuality: 'high' })
  return { image, sample, scale }
}
/** cache：生成角色同名同模板會覆寫同一資料夾，要 no-cache。 */
const fetchSheet = async (url: string, cell: number, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<DecodedSheet> => {
  const response = await fetch(url, { signal, cache })
  if (!response.ok) throw new Error(`Sheet download failed (${response.status})`)
  return decodeSheet(await response.blob(), cell)
}
/** 上傳 GPU 後，除了待機（選角預覽與頭像還要讀）都關掉原尺寸點陣圖，像素只從縮小版讀，省下每張約 32MB 記憶體。 */
function addSheet(scene: Phaser.Scene, key: string, { image, sample, scale }: DecodedSheet, cell: number, frames: number): void {
  setPixelSource(key, sample, scale)
  scene.textures.addSpriteSheet(key, image as unknown as HTMLImageElement, { frameWidth: cell, frameHeight: cell, endFrame: frames - 1 })
  if (scene.game.renderer.type === Phaser.WEBGL && !key.endsWith('-idle')) image.close()
}

const hdLoads = new Map<string, Promise<void>>()
const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))
/** 大尺寸畫面（選角兩側全身、P3–P5）改用原始每格 1024 圖集，避免 256 精簡圖放大 4–5 倍變糊。idleOnly＝只載待機（選角預覽）。
 *  全部圖集同時在背景解碼，主執行緒每幀只上傳一張。 */
export function loadHdSprite(scene: Phaser.Scene, id: AlignedSpriteId, idleOnly = false): Promise<void> {
  const hd = `hd-${id}`, cacheKey = `${id}:${idleOnly}`, sprite = alignedSprites[id], cell = sprite.sourceCellSize
  registerGeneratedSprite(hd, { ...sprite, size: cell } as AlignedSprite)
  const existing = hdLoads.get(cacheKey)
  if (existing) return existing
  const load = async () => {
    const missing = alignedAnimations.filter(({ key }) => (!idleOnly || key === 'idle') && !scene.textures.exists(`${hd}-${key}`)).map(({ key }) => {
      const action = alignedAction(id, key)!, decoded = fetchSheet(alignedSheetUrl(sprite, action.filename, true), cell)
      decoded.catch(() => undefined)
      return { key, action, decoded }
    })
    for (const { key, action, decoded } of missing) {
      const sheet = await decoded
      if (!idleOnly) await nextFrame()
      if (hdLoads.get(cacheKey) !== pending) return
      const name = `${hd}-${key}`
      if (scene.textures.exists(name)) continue
      addSheet(scene, name, sheet, cell, action.frames)
      warmAttackPose(scene, key, id, name)
    }
    const idle = `${hd}-idle`, frames = alignedAction(id, 'idle')!.frames
    if (scene.textures.exists(idle) && !scene.anims.exists(idle)) scene.anims.create({ key: idle, frames: scene.anims.generateFrameNumbers(idle, { start: 0, end: frames - 1 }), frameRate: sprite.fps, repeat: -1 })
    if (!idleOnly) {
      await nextFrame()
      if (hdLoads.get(cacheKey) === pending) warmIdleMasks(scene, idle)
    }
  }
  const pending = load().catch((error: unknown) => {
    if (hdLoads.get(cacheKey) === pending) hdLoads.delete(cacheKey)
    throw error
  })
  hdLoads.set(cacheKey, pending)
  return pending
}
/** 回到選角／首頁時釋放戰鬥用的原圖動作；待機原圖留著，選角預覽再進來不用重新解碼（否則會先顯示放大的精簡圖而變糊）。 */
export function dropHdActions(scene: Phaser.Scene): void {
  hdLoads.clear()
  clearGeneratedHitMasks('hd')
  for (const key of scene.textures.getTextureKeys().filter(key => key.startsWith('hd-') && !key.endsWith('-idle'))) removeTexture(scene, key)
}

const decode = async (blob: Blob): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(blob), image = new Image()
  try { image.src = url; await image.decode(); return image } finally { URL.revokeObjectURL(url) }
}

const headsFromOriginals = new Set<string>()
/** 從已載入的原圖待機畫頭像；開機時先畫好長官的，選角時就不必在畫面上逐張畫 4096 寬圖。 */
export function paintHdHead(scene: Phaser.Scene, id: AlignedSpriteId): void {
  const idle = scene.textures.get(`hd-${id}-idle`)
  paintHead(scene, id, idle.getSourceImage() as CanvasImageSource, idle.get(0).cutWidth)
  headsFromOriginals.add(id)
}
/** 名冊每個角色的 512×512 頭像：先同步用開機的精簡圖畫一版，再逐一換成清晰來源。
 *  長官＝原圖待機（同一張也是選角預覽，畫完預覽就不會糊）；已生成角色＝後端 256 縮圖，不為了頭像下載 4096 寬的圖集。onHead 在每次更新後呼叫。 */
export async function loadHeads(scene: Phaser.Scene, entries: CharacterEntry[], onHead: () => void, signal?: AbortSignal): Promise<void> {
  const people = entries.filter(({ type, spriteId }) => type !== 'BODY_TEMPLATE' && spriteId)
  for (const { spriteId } of people) {
    const compact = scene.textures.exists(`${spriteId}-idle`) && !scene.textures.exists(headKey(spriteId!)) ? scene.textures.get(`${spriteId}-idle`) : undefined
    if (compact) paintHead(scene, spriteId!, compact.getSourceImage() as CanvasImageSource, compact.get(0).cutWidth)
  }
  onHead()
  for (const { spriteId, generationId } of people) {
    const id = spriteId!
    if (signal?.aborted) return
    if (generationId ? scene.textures.exists(headKey(id)) : headsFromOriginals.has(id) || !(id in alignedSprites)) continue
    try {
      if (generationId) {
        // 跨網域圖片直接放進 canvas 會被標成污染而不能讀像素，所以先 fetch 成 blob 再解碼。
        const response = await fetch(`${base}/generation/assets/${encodeURIComponent(generationId)}/thumb.png`, { signal }); if (!response.ok) continue
        const image = await decode(await response.blob())
        if (signal?.aborted) return
        if (scene.textures.exists(headKey(id))) continue
        paintHead(scene, id, image, image.width)
      } else {
        await loadHdSprite(scene, id as AlignedSpriteId, true)
        if (signal?.aborted) return
        paintHdHead(scene, id as AlignedSpriteId)
      }
      onHead()
    } catch { /* 沒有清晰來源就保留精簡版頭像。 */ }
  }
}
/** 重新生成或刪除後讓該角色的頭像重做。 */
export function dropHead(scene: Phaser.Scene, spriteId: string): void { headsFromOriginals.delete(spriteId); scene.textures.remove(headKey(spriteId)) }

/** 永久刪除一個已生成角色的素材資料夾（後端只刪有 game_manifest 的資料夾）。 */
export async function deleteGeneratedCharacter(generationId: string): Promise<void> {
  const response = await fetch(`${base}/generation/assets/${encodeURIComponent(generationId)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Delete failed (${response.status})`)
}

export async function listGeneratedCharacters(): Promise<CharacterEntry[]> {
  try {
    const assets = await request<Asset[]>(`${base}/generation/assets`, new AbortController().signal)
    return assets.map(asset => ({ id: `generated-${asset.id}`, generationId: asset.id, displayName: asset.displayName, type: 'CUSTOM', status: 'READY', spriteId: `generated-${asset.id}` as const }))
  } catch { return [] }
}

/** 提交並輪詢到完成，載入本次輸出的全部圖集後回傳角色 ID（＝輸出資料夾名 `<名稱>_<模板>`）。 */
export async function generateCharacter(scene: Phaser.Scene, name: string, template: number, photo: string, signal: AbortSignal, assetGate?: Promise<void>): Promise<string> {
  signal.throwIfAborted()
  // Wait for the job ID even if the player leaves while ComfyUI is accepting the prompt.
  const { job } = await request<{ job: string }>(`${base}/generation`, AbortSignal.timeout(65_000), { name, template, photo })
  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  let status: Status | undefined
  try {
    signal.throwIfAborted()
    // 暫時的 ComfyUI 連線錯誤允許重試。工作不存在或成品不可讀時結束輪詢。
    while (status?.status !== 'ready') {
      await wait(POLL_MS, signal)
      if (Date.now() > deadline) throw new Error('ComfyUI generation timed out')
      try { status = await request<Status>(`${base}/generation/${job}`, signal) } catch (error) {
        const statusCode = (error as { status?: number }).status
        if (signal.aborted || statusCode === 404 || statusCode === 422) throw error
        continue
      }
      if (status.status === 'failed') throw new Error('ComfyUI generation failed')
    }
  } catch (error) {
    // 放棄的工作要從 ComfyUI 佇列移除，否則重試會排在殭屍工作後面或與它搶同一個輸出資料夾。
    void fetch(`${base}/generation/${job}`, { method: 'DELETE', keepalive: true }).catch(() => undefined)
    throw error
  }
  await assetGate
  signal.throwIfAborted()
  // 同名同模板會覆寫同一資料夾：丟掉先前預覽載入的舊圖集再重載。
  dropGeneratedTextures(scene, `generated-${status.id}`); dropHead(scene, `generated-${status.id}`)
  await loadSheets(scene, status, signal)
  return status.id
}

export async function loadGeneratedCharacter(scene: Phaser.Scene, id: string, signal: AbortSignal, idleOnly = false): Promise<void> {
  await loadSheets(scene, await request<Asset>(`${base}/generation/assets/${encodeURIComponent(id)}`, signal), signal, idleOnly)
}

async function loadSheets(scene: Phaser.Scene, asset: Asset, signal: AbortSignal, idleOnly = false): Promise<void> {
  const sprite = `generated-${asset.id}` as const
  const sheets = alignedAnimations.filter(({ key }) => (!idleOnly || key === 'idle') && !scene.textures.exists(`${sprite}-${key}`)).map((animation) => {
    const number = animation.filename.slice(0, 2), sheet = Object.entries(asset.actions).find(([action]) => action.startsWith(number + '_'))?.[1]
    if (!sheet || !Number.isInteger(sheet.frames) || sheet.frames < 1 || sheet.cellSize < 1) throw new Error(`Missing generated action ${number}`)
    return { ...animation, ...sheet }
  })
  const images = await Promise.all(sheets.map(async (sheet) => {
    const image = await fetchSheet(`${base}/generation/assets/${encodeURIComponent(asset.id)}/sheets/${encodeURIComponent(sheet.filename)}`, sheet.cellSize, signal, 'no-cache')
    if (image.image.width < sheet.cellSize * 4 || image.image.height < Math.ceil(sheet.frames / 4) * sheet.cellSize) throw new Error('Invalid sheet dimensions')
    return { sheet, image }
  }))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const actions = Object.fromEntries(Object.entries(asset.actions).map(([action, { filename, frames }]) => [action.slice(0, 2), { filename, frames }]))
  const cellSize = Object.values(asset.actions)[0]?.cellSize ?? 1024
  registerGeneratedSprite(sprite, { folder: '', size: cellSize, sourceCellSize: cellSize, originY: GENERATED_ORIGIN_Y, fps: asset.fps ?? 16, manifestFallback: false, actions } as AlignedSprite)
  clearGeneratedHitMasks(sprite)
  for (const { sheet, image } of images) {
    const key = `${sprite}-${sheet.key}`
    if (!idleOnly) await nextFrame()
    signal.throwIfAborted()
    if (!scene.textures.exists(key)) {
      addSheet(scene, key, image, sheet.cellSize, sheet.frames)
      warmAttackPose(scene, sheet.key, sprite)
    }
  }
  if (!idleOnly) warmIdleMasks(scene, `${sprite}-idle`)
  if (scene.textures.exists(`${sprite}-idle`) && (sheets.some(sheet => sheet.key === 'idle') || !scene.textures.exists(headKey(sprite)))) {
    const idle = scene.textures.get(`${sprite}-idle`)
    paintHead(scene, sprite, idle.getSourceImage() as CanvasImageSource, idle.get(0).cutWidth)
  }
}
