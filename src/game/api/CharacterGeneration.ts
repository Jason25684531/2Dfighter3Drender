import Phaser from 'phaser'
import { alignedAction, alignedAnimations, alignedSprites, registerGeneratedSprite, type AlignedSprite, type AlignedSpriteId } from '../ui/animation/SheetSpriteManifest'
import { GENERATED_ORIGIN_Y } from '../ui/animation/TemporarySpriteManifest'
import { clearGeneratedHitMasks } from '../ui/animation/SpriteHitTest'
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

/** sprite 省略＝全部生成角色。 */
export function dropGeneratedTextures(scene: Phaser.Scene, sprite = 'generated'): void {
  clearGeneratedHitMasks(sprite)
  scene.textures.getTextureKeys().filter((key) => key.startsWith(`${sprite}-`)).forEach((key) => scene.textures.remove(key))
}

const hdLoads = new Map<string, Promise<void>>(), fullHd = new Set<string>()
/** 大尺寸畫面（選角兩側全身、P3–P5）改用原始每格 1024 圖集，避免 256 精簡圖放大 4–5 倍變糊；開機仍只預載精簡版。idleOnly＝只載待機（選角預覽）。 */
export function loadHdSprite(scene: Phaser.Scene, id: AlignedSpriteId, idleOnly = false): Promise<void> {
  const hd = `hd-${id}`, cacheKey = `${id}:${idleOnly}`, sprite = alignedSprites[id], cell = sprite.sourceCellSize
  registerGeneratedSprite(hd, { ...sprite, size: cell } as AlignedSprite)
  if (!hdLoads.has(cacheKey)) hdLoads.set(cacheKey, Promise.all(alignedAnimations.filter(({ key }) => !idleOnly || key === 'idle').map(async ({ key }) => {
    const name = `${hd}-${key}`, action = alignedAction(id, key)!
    if (scene.textures.exists(name)) return
    const image = new Image(); image.src = `/test-assets/1113_characters/runtime/${sprite.folder}/full/${action.filename}`
    await image.decode()
    if (scene.textures.exists(name)) return
    scene.textures.addSpriteSheet(name, image, { frameWidth: cell, frameHeight: cell, endFrame: action.frames - 1 })
    if (key === 'idle' && !scene.anims.exists(name)) scene.anims.create({ key: name, frames: scene.anims.generateFrameNumbers(name, { start: 0, end: action.frames - 1 }), frameRate: sprite.fps, repeat: -1 })
  })).then(() => { if (!idleOnly) fullHd.add(id) }, (error: unknown) => { hdLoads.delete(cacheKey); throw error }))
  return hdLoads.get(cacheKey)!
}
/** 已載入原圖全套時回傳 hd 版 id，否則沿用精簡版。 */
export const sharpSprite = <T extends string | undefined>(id: T): T => (id && fullHd.has(id) ? `hd-${id}` : id) as T
/** 回到選角／首頁時釋放全套原圖（估算每角色約 450MB 顯存）；待機原圖保留給選角預覽重用。 */
export function dropHdActions(scene: Phaser.Scene): void {
  fullHd.clear(); [...hdLoads.keys()].filter((key) => key.endsWith(':false')).forEach((key) => hdLoads.delete(key))
  clearGeneratedHitMasks('hd')
  scene.textures.getTextureKeys().filter((key) => key.startsWith('hd-') && !key.endsWith('-idle')).forEach((key) => scene.textures.remove(key))
}

const headsFromOriginals = new Set<string>()
/** 名冊每個角色（含已生成的）的 512×512 頭像：同步先用開機的精簡圖畫一版，再逐一解碼原圖待機重畫（逐一而非同時，避免暫存 4096 寬圖佔滿記憶體）。onHead 在每次更新後呼叫。 */
export async function loadHeads(scene: Phaser.Scene, entries: CharacterEntry[], onHead: () => void): Promise<void> {
  const people = entries.filter(({ type, spriteId }) => type !== 'BODY_TEMPLATE' && spriteId)
  for (const { spriteId } of people) {
    const compact = scene.textures.exists(`${spriteId}-idle`) && !scene.textures.exists(headKey(spriteId!)) ? scene.textures.get(`${spriteId}-idle`) : undefined
    if (compact) paintHead(scene, spriteId!, compact.getSourceImage() as CanvasImageSource, compact.get(0).cutWidth)
  }
  onHead()
  for (const { spriteId, generationId } of people) {
    if (headsFromOriginals.has(spriteId!)) continue
    const url = spriteId! in alignedSprites ? `/test-assets/1113_characters/runtime/${alignedSprites[spriteId as AlignedSpriteId].folder}/full/02_Idle.png` : generationId ? `${base}/generation/assets/${encodeURIComponent(generationId)}/sheets/02_Idle.png` : undefined
    if (!url) continue
    try {
      // 跨網域圖片直接放進 canvas 會被瀏覽器標成污染而不能讀像素，所以先 fetch 成 blob 再解碼。
      const response = await fetch(url); if (!response.ok) continue
      const objectUrl = URL.createObjectURL(await response.blob()), image = new Image()
      try { image.src = objectUrl; await image.decode(); paintHead(scene, spriteId!, image, image.width / 4); headsFromOriginals.add(spriteId!); onHead() } finally { URL.revokeObjectURL(objectUrl) }
    } catch { /* 沒有原圖就保留精簡版頭像。 */ }
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
    return assets.map(({ id, displayName }) => ({ id: `generated-${id}`, generationId: id, displayName, type: 'CUSTOM', status: 'READY', spriteId: `generated-${id}` as const }))
  } catch { return [] }
}

/** 提交並輪詢到完成，載入本次輸出的全部圖集後回傳角色 ID（＝輸出資料夾名 `<名稱>_<模板>`）。 */
export async function generateCharacter(scene: Phaser.Scene, name: string, template: number, photo: string, signal: AbortSignal): Promise<string> {
  const { job } = await request<{ job: string }>(`${base}/generation`, signal, { name, template, photo })
  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  let status: Status | undefined
  try {
    // ComfyUI 終端凍結時輪詢會 502；解凍後工作會自己跑完，所以暫時性錯誤不立刻判失敗，只在逾時或後端不認得這個工作（404）時放棄。
    while (status?.status !== 'ready') {
      await wait(POLL_MS, signal)
      if (Date.now() > deadline) throw new Error('ComfyUI generation timed out')
      try { status = await request<Status>(`${base}/generation/${job}`, signal) } catch (error) {
        if (signal.aborted || (error as { status?: number }).status === 404) throw error
        continue
      }
      if (status.status === 'failed') throw new Error('ComfyUI generation failed')
    }
  } catch (error) {
    // 放棄的工作要從 ComfyUI 佇列移除，否則重試會排在殭屍工作後面或與它搶同一個輸出資料夾。
    void fetch(`${base}/generation/${job}`, { method: 'DELETE', keepalive: true }).catch(() => undefined)
    throw error
  }
  // 同名同模板會覆寫同一資料夾：丟掉先前預覽載入的舊圖集再重載。
  dropGeneratedTextures(scene, `generated-${status.id}`); dropHead(scene, `generated-${status.id}`)
  await loadSheets(scene, status, signal)
  return status.id
}

export async function loadGeneratedCharacter(scene: Phaser.Scene, id: string, signal: AbortSignal, idleOnly = false): Promise<void> {
  await loadSheets(scene, await request<Asset>(`${base}/generation/assets/${encodeURIComponent(id)}`, signal), signal, idleOnly)
}

async function loadSheets(scene: Phaser.Scene, asset: Asset, signal: AbortSignal, idleOnly = false): Promise<void> {
  const sprite = `generated-${asset.id}`
  const sheets = alignedAnimations.filter(({ key }) => (!idleOnly || key === 'idle') && !scene.textures.exists(`${sprite}-${key}`)).map((animation) => {
    const number = animation.filename.slice(0, 2), sheet = Object.entries(asset.actions).find(([action]) => action.startsWith(number + '_'))?.[1]
    if (!sheet || !Number.isInteger(sheet.frames) || sheet.frames < 1 || sheet.cellSize < 1) throw new Error(`Missing generated action ${number}`)
    return { ...animation, ...sheet }
  })
  const images = await Promise.all(sheets.map(async (sheet) => {
    const response = await fetch(`${base}/generation/assets/${encodeURIComponent(asset.id)}/sheets/${encodeURIComponent(sheet.filename)}`, { signal, cache: 'no-cache' })
    if (!response.ok) throw new Error('Sheet download failed')
    const url = URL.createObjectURL(await response.blob()), image = new Image()
    try {
      image.src = url
      await image.decode()
      if (image.width < sheet.cellSize * 4 || image.height < Math.ceil(sheet.frames / 4) * sheet.cellSize) throw new Error('Invalid sheet dimensions')
      return { sheet, image }
    } finally { URL.revokeObjectURL(url) }
  }))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const actions = Object.fromEntries(Object.entries(asset.actions).map(([action, { filename, frames }]) => [action.slice(0, 2), { filename, frames }]))
  const cellSize = Object.values(asset.actions)[0]?.cellSize ?? 1024
  registerGeneratedSprite(sprite, { folder: '', size: cellSize, sourceCellSize: cellSize, originY: GENERATED_ORIGIN_Y, fps: asset.fps ?? 16, manifestFallback: false, actions } as AlignedSprite)
  clearGeneratedHitMasks(sprite)
  for (const { sheet, image } of images) {
    const key = `${sprite}-${sheet.key}`
    if (!scene.textures.exists(key)) scene.textures.addSpriteSheet(key, image, { frameWidth: sheet.cellSize, frameHeight: sheet.cellSize, endFrame: sheet.frames - 1 })
  }
}
