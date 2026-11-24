import type Phaser from 'phaser'
import type { Facing } from '../../combat/CombatWorld'
import { reducedMotion } from '../tokens/uiTokens'
import layout from '../assets/hudLayout.json'

// 素材弧面凸向右；尺寸只在這裡調。
export const impactFx = {
  ...layout.attack,
  guard: { key: 'fx-guard', url: '/test-assets/vfx/guard-impact-fx/sheet-transparent.png', width: 256, height: 256, frames: 6, peak: 2, scale: 1.3 },
} as const
export type ImpactKind = keyof typeof impactFx
const FPS = 24

export const impactScale = (kind: ImpactKind): number => impactFx[kind].scale
/** guard 弧面朝攻擊者 = 防守者面向；hit 依攻擊者面向。兩者都是「該角色面向左時翻轉」。 */
export const impactFlip = (facing: Facing): boolean => facing === 'LEFT'

export const loadImpactFx = (scene: Phaser.Scene): void => Object.values(impactFx).forEach(({ key, url, width, height }) => scene.load.spritesheet(key, url, { frameWidth: width, frameHeight: height }))
export const registerImpactFx = (scene: Phaser.Scene): void => Object.values(impactFx).forEach(({ key, frames }) => {
  if (scene.textures.exists(key) && !scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }), frameRate: FPS, repeat: 0 })
})

/** 一次性特效：播完自毀；缺素材時什麼都不做；減少動態只閃一下峰值幀。 */
export const playImpactFx = (scene: Phaser.Scene, parent: Phaser.GameObjects.Container, kind: ImpactKind, x: number, y: number, flipX: boolean): void => {
  const { key, peak } = impactFx[kind]
  if (!scene.textures.exists(key)) return
  const sprite = scene.add.sprite(x, y, key, reducedMotion ? peak : 0).setScale(impactScale(kind)).setFlipX(flipX)
  parent.add(sprite)
  if (reducedMotion || !scene.anims.exists(key)) { scene.time.delayedCall(150, () => { if (sprite.active) sprite.destroy() }); return }
  sprite.once('animationcomplete', () => sprite.destroy()).play(key)
}
