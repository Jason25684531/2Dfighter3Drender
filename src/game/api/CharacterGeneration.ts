import Phaser from 'phaser'
import { sheetAnimations } from '../ui/animation/SheetSpriteManifest'
import { clearGeneratedHitMasks } from '../ui/animation/SpriteHitTest'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'

const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
type Sheet = { filename: string; frames: number; cellSize: number }
type Status = { status: 'processing' | 'failed' | 'ready'; actions?: Record<string, Sheet> }
type Asset = { id: string; displayName: string; actions: Record<string, Sheet> }

export async function listGeneratedCharacters(): Promise<CharacterEntry[]> {
  try {
    const assets = await request<Asset[]>(`${base}/generation/assets`, new AbortController().signal)
    return assets.map(({ id, displayName }) => ({ id: `generated-${id}`, generationId: id, displayName, type: 'CUSTOM', status: 'READY', spriteId: `generated-${id}` as const }))
  } catch { return [] }
}

async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal, method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(`Generation request failed (${response.status})`)
  return await response.json() as T
}

export async function generateCharacter(scene: Phaser.Scene, name: string, template: number, photo: string, signal: AbortSignal): Promise<string> {
  const { job } = await request<{ job: string }>(`${base}/generation`, signal, { name, template, photo })
  let status: Status
  do {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 3000)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    status = await request<Status>(`${base}/generation/${job}`, signal)
    if (status.status === 'failed') throw new Error('ComfyUI generation failed')
  } while (status.status !== 'ready')
  const id = `generated-${job}`
  const actions = status.actions ?? {}
  const sheets = sheetAnimations.map((animation) => {
    const number = animation.filename.slice(0, 2), found = Object.entries(actions).find(([action]) => action.startsWith(number + '_'))?.[1]
    if (!found || !Number.isInteger(found.frames) || found.frames < 1 || found.cellSize < 1) throw new Error(`Missing generated action ${number}`)
    return { ...animation, ...found }
  })
  const loaded = await Promise.all(sheets.map(async (sheet) => {
    const response = await fetch(`${base}/generation/${job}/sheets/${encodeURIComponent(sheet.filename)}`, { signal })
    if (!response.ok) throw new Error('Sheet download failed')
    const blob = await response.blob(), url = URL.createObjectURL(blob), image = new Image()
    try {
      image.src = url
      await image.decode()
      if (image.width < sheet.cellSize * 4 || image.height < Math.ceil(sheet.frames / 4) * sheet.cellSize) throw new Error('Invalid sheet dimensions')
      return { sheet, image }
    } finally { URL.revokeObjectURL(url) }
  }))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  clearGeneratedHitMasks(id)
  for (const { sheet, image } of loaded) {
    const key = `${id}-${sheet.key}`
    if (scene.textures.exists(key)) scene.textures.remove(key)
    scene.textures.addSpriteSheet(key, image, { frameWidth: sheet.cellSize, frameHeight: sheet.cellSize, endFrame: sheet.frames - 1 })
    if (!scene.textures.exists(key)) throw new Error('Sheet decode failed')
  }
  return job
}

export async function loadGeneratedCharacter(scene: Phaser.Scene, id: string, signal: AbortSignal, idleOnly = false): Promise<void> {
  const asset = await request<Asset>(`${base}/generation/assets/${id}`, signal)
  const sprite = `generated-${id}`
  const sheets = sheetAnimations.filter(({ key }) => !idleOnly || key === 'idle').map((animation) => {
    const number = animation.filename.slice(0, 2), sheet = Object.entries(asset.actions).find(([name]) => name.startsWith(number + '_'))?.[1]
    if (!sheet) throw new Error(`Missing generated action ${number}`)
    return { ...animation, ...sheet }
  }).filter(({ key }) => !scene.textures.exists(`${sprite}-${key}`))
  if (!sheets.length) return
  const images = await Promise.all(sheets.map(async (sheet) => {
    const response = await fetch(`${base}/generation/${id}/sheets/${encodeURIComponent(sheet.filename)}`, { signal })
    if (!response.ok) throw new Error('Sheet download failed')
    const url = URL.createObjectURL(await response.blob()), image = new Image()
    try { image.src = url; await image.decode(); return { sheet, image } } finally { URL.revokeObjectURL(url) }
  }))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  clearGeneratedHitMasks(sprite)
  for (const { sheet, image } of images) {
    const key = `${sprite}-${sheet.key}`
    if (scene.textures.exists(key)) continue
    scene.textures.addSpriteSheet(key, image, { frameWidth: sheet.cellSize, frameHeight: sheet.cellSize, endFrame: sheet.frames - 1 })
  }
}
