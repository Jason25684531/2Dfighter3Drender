import type Phaser from 'phaser'
import alignedMetadata from './AlignedSpriteData.json'

// 4×4 cells per sheet; frame order is left-to-right, then top-to-bottom.
export const sheetAnimations = [
  { key: 'intro-victory', filename: '01_Intro_Victory.png', loop: false },
  { key: 'idle', filename: '02_Idle.png', loop: true },
  { key: 'walk', filename: '03_Move.png', loop: true },
  { key: 'jump', filename: '04_Jump.png', loop: false },
  { key: 'crouch', filename: '05_Crouch.png', loop: true },
  { key: 'prone', filename: '07_Prone.png', loop: false },
  { key: 'attack', filename: '08_Punch_Light.png', loop: false },
  { key: 'punch-heavy', filename: '09_Punch_Heavy.png', loop: false },
  { key: 'punch-jump', filename: '10_Puch_Jump.png', loop: false },
  { key: 'punch-crouch', filename: '11_Punch_Crouch.png', loop: false },
  { key: 'kick-light', filename: '12_Kick_Light.png', loop: false },
  { key: 'kick-heavy', filename: '13_Kick_Heavy.png', loop: false },
  { key: 'kick-jump', filename: '14_Kick_Jump.png', loop: false },
  { key: 'kick-crouch', filename: '15_Kick_Crouch.png', loop: false },
] as const

export const SHEET_FRAME_COUNT = 16
// renamed：來源檔名與 Kevin 不同的部分，照原檔名對應、不改素材。
export const sheetSprites = {
  kevin: { folder: 'Kevin', size: 128, renamed: {} as Record<string, string> },
  body01: { folder: 'Customize_body_01', size: 256, renamed: { 'punch-jump': '10_Punch_Jump.png', 'kick-crouch': '15_Kick_Crounch.png' } as Record<string, string> },
} as const
type StaticSheetSpriteId = keyof typeof sheetSprites
export type SheetSpriteId = StaticSheetSpriteId | AlignedSpriteId | `generated-${string}` | 'generated1' | 'generated2'
export type AlignedSpriteId = keyof typeof alignedMetadata
export const alignedSprites = alignedMetadata
export const alignedSprite = (id: string | undefined) => id && id in alignedSprites ? alignedSprites[id as AlignedSpriteId] : undefined
const sheetSpriteIds: SheetSpriteId[] = [...Object.keys(sheetSprites) as StaticSheetSpriteId[], ...Object.keys(alignedSprites) as AlignedSpriteId[]]
export const isSheetSprite = (id: string | undefined): id is SheetSpriteId => id !== undefined && (id in sheetSprites || id in alignedSprites || id.startsWith('generated-') || id === 'generated1' || id === 'generated2')
export const alignedAction = (id: string | undefined, key: string) => {
  const sprite = alignedSprite(id)
  const number = key === 'block' ? '06' : sheetAnimations.find(action => action.key === key)?.filename.slice(0, 2)
  return sprite && number ? (sprite.actions as Record<string, { filename: string; frames: number }>)[number] : undefined
}
export const sheetUrl = (id: SheetSpriteId, key: string, filename: string): string => {
  const aligned = alignedSprite(id), action = alignedAction(id, key)
  if (aligned && action) return `/test-assets/1113_characters/runtime/${aligned.folder}/${action.filename}`
  return id in sheetSprites ? `/test-assets/characters/${sheetSprites[id as StaticSheetSpriteId].folder}/${sheetSprites[id as StaticSheetSpriteId].renamed[key] ?? filename}` : filename
}
const animationsFor = (id: SheetSpriteId) => alignedSprite(id) ? [...sheetAnimations, { key: 'block', filename: '06_Block.png', loop: false }] : sheetAnimations
export const loadSheetSprites = (scene: Phaser.Scene): void => sheetSpriteIds.forEach((id) => animationsFor(id).forEach(({ key, filename }) => {
  const size = alignedSprite(id)?.size ?? sheetSprites[id as StaticSheetSpriteId].size
  scene.load.spritesheet(`${id}-${key}`, sheetUrl(id, key, filename), { frameWidth: size, frameHeight: size, endFrame: (alignedAction(id, key)?.frames ?? SHEET_FRAME_COUNT) - 1 })
}))
export const registerSheetAnimations = (scene: Phaser.Scene): void => sheetSpriteIds.forEach((id) => animationsFor(id).forEach(({ key, loop }) => {
  const name = `${id}-${key}`
  if (scene.textures.exists(name) && !scene.anims.exists(name)) scene.anims.create({ key: name, frames: scene.anims.generateFrameNumbers(name, { start: 0, end: (alignedAction(id, key)?.frames ?? SHEET_FRAME_COUNT) - 1 }), frameRate: alignedSprite(id)?.fps ?? 12, repeat: loop ? -1 : 0 })
}))
