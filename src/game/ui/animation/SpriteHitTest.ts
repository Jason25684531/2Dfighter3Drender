import type Phaser from 'phaser'
import type { FighterId, FighterSnapshot, HitTest } from '../../combat/CombatWorld'
import type { PresentationContext } from './TemporarySpriteManifest'
import { SHEET_FRAME_COUNT } from './SheetSpriteManifest'
import type { TemporarySpriteRenderer } from './TemporarySpriteRenderer'

/** 角色輪廓往外推多少 world 單位仍算命中（world ≈ 畫面 px / 0.9）。手感調這裡。 */
export const HIT_EDGE = 5
const ALPHA_THRESHOLD = 32

export type Mask = { width: number; height: number; solid: Uint8Array }
/** 一個影格在戰鬥座標中的擺放：腳底錨點 (x, y)、水平朝向、縮放、錨點高度比例。 */
export type Placement = { mask: Mask; x: number; y: number; dir: 1 | -1; scale: number; originY: number }

/** 方形膨脹 radius 像素（先橫後直，可分離）；四周各加寬 radius，貼影格邊的輪廓也能外推。 */
export const dilate = (mask: Mask, radius: number): Mask => {
  const width = mask.width + radius * 2, height = mask.height + radius * 2, padded = new Uint8Array(width * height)
  for (let y = 0; y < mask.height; y += 1) padded.set(mask.solid.subarray(y * mask.width, (y + 1) * mask.width), (y + radius) * width + radius)
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!src[y * width + x]) continue
      for (let d = -radius; d <= radius; d += 1) {
        const nx = horizontal ? x + d : x, ny = horizontal ? y : y + d
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) out[ny * width + nx] = 1
      }
    }
    return out
  }
  return { width, height, solid: pass(pass(padded, true), false) }
}

const dilations = new WeakMap<Mask, Map<number, Mask>>()
const dilated = (mask: Mask, radius: number): Mask => {
  const byRadius = dilations.get(mask) ?? new Map<number, Mask>(); dilations.set(mask, byRadius)
  return byRadius.get(radius) ?? byRadius.set(radius, dilate(mask, radius)).get(radius) as Mask
}

/** 攻擊方輪廓與「防守方輪廓外推 edge」重疊的像素平均點；沒有重疊回 null。 */
export const silhouetteContact = (attacker: Placement, defender: Placement, edge = HIT_EDGE): { x: number; y: number } | null => {
  const radius = Math.ceil(edge / defender.scale), target = dilated(defender.mask, radius)
  const { width, height, solid } = attacker.mask
  let sx = 0, sy = 0, count = 0
  for (let v = 0; v < height; v += 1) for (let u = 0; u < width; u += 1) {
    if (!solid[v * width + u]) continue
    const wx = attacker.x + attacker.dir * (u + 0.5 - width / 2) * attacker.scale, wy = attacker.y + (v + 0.5 - attacker.originY * height) * attacker.scale
    const du = Math.floor((wx - defender.x) * defender.dir / defender.scale + target.width / 2), dv = Math.floor((wy - defender.y) / defender.scale + defender.originY * defender.mask.height + radius)
    if (du < 0 || du >= target.width || dv < 0 || dv >= target.height || !target.solid[dv * target.width + du]) continue
    sx += wx; sy += wy; count += 1
  }
  return count ? { x: sx / count, y: sy / count } : null
}

// ponytail: 每個影格第一次用到才讀像素並快取；角色數多到記憶體吃緊再改成預先烘焙。
const masks = new Map<string, Mask | undefined>()
const readMask = (scene: Phaser.Scene, key: string, frameName: string | number): Mask | undefined => {
  const id = `${key}:${frameName}`
  if (masks.has(id)) return masks.get(id)
  const frame = scene.textures.exists(key) ? scene.textures.getFrame(key, frameName) : undefined
  let mask: Mask | undefined
  if (frame) {
    const { cutX, cutY, cutWidth: width, cutHeight: height } = frame
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })
    if (context) {
      context.drawImage(frame.source.image as CanvasImageSource, cutX, cutY, width, height, 0, 0, width, height)
      const data = context.getImageData(0, 0, width, height).data, solid = new Uint8Array(width * height)
      for (let i = 0; i < solid.length; i += 1) solid[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0
      mask = { width, height, solid }
    }
  }
  masks.set(id, mask); return mask
}

/** 攻擊 sheet 中往前（右）伸最遠的影格；讀不到貼圖回 undefined。 */
const peaks = new Map<string, number | undefined>()
export const peakFrame = (scene: Phaser.Scene, key: string): number | undefined => {
  if (peaks.has(key)) return peaks.get(key)
  let best: number | undefined, bestReach = -1
  for (let frame = 0; frame < SHEET_FRAME_COUNT; frame += 1) {
    const mask = readMask(scene, key, frame)
    if (!mask) break
    let reach = -1
    mask.solid.forEach((solid, i) => { if (solid) reach = Math.max(reach, i % mask.width) })
    if (reach > bestReach) { bestReach = reach; best = frame }
  }
  peaks.set(key, best); return best
}

/** 以畫面上的角色輪廓判定命中；任一方沒有貼圖時回 undefined，Combat 退回 AABB。 */
export const createSpriteHitTest = (scene: Phaser.Scene, renderers: Record<FighterId, TemporarySpriteRenderer>, context: () => PresentationContext | undefined): HitTest => (attacker, defender) => {
  const place = (fighter: FighterSnapshot): Placement | undefined => {
    const pose = renderers[fighter.id].pose(fighter, fighter.id === 'PLAYER' ? context() : undefined)
    const mask = pose && readMask(scene, pose.key, pose.frame)
    return pose && mask && { mask, x: fighter.x, y: fighter.y, dir: fighter.facing === 'LEFT' ? -1 : 1, scale: pose.scale, originY: pose.originY }
  }
  const a = place(attacker), d = place(defender)
  return a && d ? silhouetteContact(a, d) : undefined
}
