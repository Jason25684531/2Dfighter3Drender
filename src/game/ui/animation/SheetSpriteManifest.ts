import type Phaser from 'phaser'

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
const bodyRenamed: Record<string, string> = { 'punch-jump': '10_Punch_Jump.png' }
export const sheetSprites = {
  kevin: { folder: 'Kevin', size: 128, renamed: {} as Record<string, string> },
  body01: { folder: 'Customize_body_01', size: 256, renamed: { 'punch-jump': '10_Punch_Jump.png', 'kick-crouch': '15_Kick_Crounch.png' } as Record<string, string> },
  // Customize Body 01–04 的正式身形。
  s1aw: { folder: 'S1AW', size: 256, renamed: bodyRenamed },
  s2am: { folder: 'S2AM', size: 256, renamed: bodyRenamed },
  s2lw: { folder: 'S2LW', size: 256, renamed: bodyRenamed },
  s3ww: { folder: 'S3WW', size: 256, renamed: bodyRenamed },
} as const
type StaticSheetSpriteId = keyof typeof sheetSprites
export type SheetSpriteId = StaticSheetSpriteId | `generated-${string}` | 'generated1' | 'generated2'
const sheetSpriteIds = Object.keys(sheetSprites) as StaticSheetSpriteId[]
export const isSheetSprite = (id: string | undefined): id is SheetSpriteId => id !== undefined && (id in sheetSprites || id.startsWith('generated-') || id === 'generated1' || id === 'generated2')
export const sheetUrl = (id: SheetSpriteId, key: string, filename: string): string => id in sheetSprites ? `/test-assets/characters/${sheetSprites[id as StaticSheetSpriteId].folder}/${sheetSprites[id as StaticSheetSpriteId].renamed[key] ?? filename}` : filename

export const loadSheetSprites = (scene: Phaser.Scene): void => sheetSpriteIds.forEach((id) => sheetAnimations.forEach(({ key, filename }) => scene.load.spritesheet(`${id}-${key}`, sheetUrl(id, key, filename), { frameWidth: sheetSprites[id].size, frameHeight: sheetSprites[id].size })))
export const registerSheetAnimations = (scene: Phaser.Scene): void => sheetSpriteIds.forEach((id) => sheetAnimations.forEach(({ key, loop }) => {
  const name = `${id}-${key}`
  if (scene.textures.exists(name) && !scene.anims.exists(name)) scene.anims.create({ key: name, frames: scene.anims.generateFrameNumbers(name, { start: 0, end: SHEET_FRAME_COUNT - 1 }), frameRate: 12, repeat: loop ? -1 : 0 })
}))
