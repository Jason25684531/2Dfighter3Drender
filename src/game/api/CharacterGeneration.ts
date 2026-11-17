import Phaser from 'phaser'
import { alignedAnimations, registerGeneratedSprite, type AlignedSprite } from '../ui/animation/SheetSpriteManifest'
import { GENERATED_ORIGIN_Y } from '../ui/animation/TemporarySpriteManifest'
import { clearGeneratedHitMasks } from '../ui/animation/SpriteHitTest'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'

const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
type Sheet = { filename: string; frames: number; cellSize: number }
type Asset = { id: string; displayName: string; fps: number; actions: Record<string, Sheet> }
type Status = { status: 'processing' | 'failed' } | ({ status: 'ready' } & Asset)

async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal, method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`Generation request failed (${response.status})`)
  return await response.json() as T
}

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

export async function listGeneratedCharacters(): Promise<CharacterEntry[]> {
  try {
    const assets = await request<Asset[]>(`${base}/generation/assets`, new AbortController().signal)
    return assets.map(({ id, displayName }) => ({ id: `generated-${id}`, generationId: id, displayName, type: 'CUSTOM', status: 'READY', spriteId: `generated-${id}` as const }))
  } catch { return [] }
}

/** 提交並輪詢到完成，載入本次輸出的全部圖集後回傳角色 ID（＝輸出資料夾名 `<名稱>_<模板>`）。 */
export async function generateCharacter(scene: Phaser.Scene, name: string, template: number, photo: string, signal: AbortSignal): Promise<string> {
  const { job } = await request<{ job: string }>(`${base}/generation`, signal, { name, template, photo })
  let status: Status
  do {
    await wait(3000, signal)
    status = await request<Status>(`${base}/generation/${job}`, signal)
    if (status.status === 'failed') throw new Error('ComfyUI generation failed')
  } while (status.status !== 'ready')
  // 同名同模板會覆寫同一資料夾：丟掉先前預覽載入的舊圖集再重載。
  dropGeneratedTextures(scene, `generated-${status.id}`)
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
