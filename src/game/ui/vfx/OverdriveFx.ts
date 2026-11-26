import type Phaser from 'phaser'
import type { AttackAction } from '../../input/ControlProfile'
import type { SpriteId } from '../animation/TemporarySpriteManifest'
import { reducedMotion } from '../tokens/uiTokens'

// 兩組同版型的特效包（五段：蓄能→噴發→衝擊波→命中→消散），scripts/prepare-ui-vfx-assets.py 複製到 public。
// overdrive＝assest/VFX/rog-overdrive（紫藍電光）；explosion＝assest/VFX/1126_explosion/vfx/rog-overdrive（金白爆炸）。
const clips = {
  energy_charge: { frames: 8, cell: [256, 256], origin: [128, 128] },
  energy_burst: { frames: 12, cell: [512, 256], origin: [104, 128] },
  shockwave: { frames: 8, cell: [512, 512], origin: [256, 256] },
  hit_impact: { frames: 8, cell: [512, 512], origin: [256, 256] },
  energy_dissipation: { frames: 8, cell: [256, 256], origin: [128, 128] },
} as const
export type FxClip = keyof typeof clips
export type FxPack = 'overdrive' | 'explosion'
// opaque＝各段所有影格不透明範圍的最長邊（px），用來把特效換算成「人物身高的幾成」。
const packs: Record<FxPack, { key: string; folder: string; opaque: Record<FxClip, number> }> = {
  overdrive: { key: 'fx-overdrive', folder: '/test-assets/vfx/rog-overdrive/', opaque: { energy_charge: 120, energy_burst: 408, shockwave: 393, hit_impact: 442, energy_dissipation: 168 } },
  explosion: { key: 'fx-explosion', folder: '/test-assets/vfx/explosion/', opaque: { energy_charge: 163, energy_burst: 348, shockwave: 367, hit_impact: 462, energy_dissipation: 140 } },
}

/** Jeansen 待機身高（world，scripts/audit-character-scale.py 量得約 496）。 */
export const FX_BODY = 500
export type SignatureFx = { pack: FxPack; height: number; size: Partial<Record<FxClip, number>> }
const lightSize = { energy_charge: 0.7, energy_burst: 1.6, hit_impact: 1.6, energy_dissipation: 0.8 }
const heavySize = { energy_charge: 0.9, energy_burst: 2, shockwave: 1.8, hit_impact: 1.9, energy_dissipation: 1 }
/**
 * Jeansen 每招帶的特效；要改觸發的招式、換特效包、調大小都只改這裡。
 * height＝特效出現在腳底上方多高（world，蹲下時減半）；size＝各段最長邊佔人物身高幾成（1＝與人物等高），沒列的段落不播。
 */
export const JEANSEN_FX: Partial<Record<AttackAction, SignatureFx>> = {
  LIGHT_KICK: { pack: 'overdrive', height: 230, size: lightSize },
  HEAVY_KICK: { pack: 'overdrive', height: 230, size: heavySize },
  HEAVY_PUNCH: { pack: 'explosion', height: 300, size: heavySize },
}
export const signatureFx = (sprite: SpriteId | undefined, attack: AttackAction): SignatureFx | undefined => sprite?.replace(/^hd-/, '') === 'jeansen' ? JEANSEN_FX[attack] : undefined
/** 特效最長邊＝人物身高 × body 時的縮放。 */
export const fxScale = (pack: FxPack, clip: FxClip, body: number): number => body * FX_BODY / packs[pack].opaque[clip]

const register = (scene: Phaser.Scene, pack: FxPack): void => (Object.keys(clips) as FxClip[]).forEach((clip) => {
  const { key } = packs[pack], anim = `${key}-${clip}`
  if (!scene.anims.exists(anim)) scene.anims.create({ key: anim, frames: Array.from({ length: clips[clip].frames }, (_, i) => ({ key, frame: `${clip}/${String(i + 1).padStart(2, '0')}.png` })), frameRate: 24, repeat: 0 })
})

/** 本場有 Jeansen 才載入（每組三張圖集約 4 MB）；已載入就只註冊動畫。 */
export const loadSignatureFx = (scene: Phaser.Scene): void => {
  for (const pack of new Set(Object.values(JEANSEN_FX).map((fx) => fx.pack))) {
    const { key, folder } = packs[pack]
    if (scene.textures.exists(key)) { register(scene, pack); continue }
    scene.load.multiatlas(key, `${folder}rog-overdrive.json`, folder)
    scene.load.once(`filecomplete-multiatlas-${key}`, () => register(scene, pack))
  }
  scene.load.start()
}

/** 一次性特效，播完自毀；素材還沒載好就略過。body＝特效最長邊佔人物身高幾成；facingLeft 時左右翻轉（含原點）。 */
export const playFx = (scene: Phaser.Scene, parent: Phaser.GameObjects.Container, pack: FxPack, clip: FxClip, x: number, y: number, facingLeft: boolean, body: number): Phaser.GameObjects.Sprite | undefined => {
  const { key } = packs[pack], anim = `${key}-${clip}`
  if (!scene.anims.exists(anim)) return undefined
  const { cell: [w, h], origin: [ox, oy], frames } = clips[clip]
  const sprite = scene.add.sprite(x, y, key, `${clip}/${String(reducedMotion ? Math.ceil(frames / 2) : 1).padStart(2, '0')}.png`)
    .setOrigin(facingLeft ? 1 - ox / w : ox / w, oy / h).setFlipX(facingLeft).setScale(fxScale(pack, clip, body))
  parent.add(sprite)
  if (reducedMotion) scene.time.delayedCall(150, () => { if (sprite.active) sprite.destroy() })
  else sprite.once('animationcomplete', () => sprite.destroy()).play(anim)
  return sprite
}
