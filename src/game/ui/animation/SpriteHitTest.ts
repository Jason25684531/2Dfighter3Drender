import type Phaser from 'phaser'
import type { FighterId, FighterSnapshot, HitTest } from '../../combat/CombatWorld'
import type { PresentationContext } from './TemporarySpriteManifest'
import type { TemporarySpriteRenderer } from './TemporarySpriteRenderer'
import { HIT_TUNING, reachFor } from '../../config/hitTuning'

/** 角色輪廓往外推多少 world 單位仍算命中；推擠間隙。數值在 config/hitTuning.ts 調。 */
export const HIT_EDGE = HIT_TUNING.edge
export const PUSH_EDGE = HIT_TUNING.pushEdge
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

/** sheet 中 score 最大的影格（同分取前面）；讀不到貼圖回 undefined。 */
const bests = new Map<string, number | undefined>()
const bestFrame = (scene: Phaser.Scene, key: string, kind: string, score: (mask: Mask) => number): number | undefined => {
  const id = `${kind}:${key}`
  if (bests.has(id)) return bests.get(id)
  let best: number | undefined, bestScore = -1
  for (let frame = 0; frame < scene.textures.get(key).frameTotal - 1; frame += 1) {
    const mask = readMask(scene, key, frame)
    if (!mask) break
    const value = score(mask)
    if (value > bestScore) { bestScore = value; best = frame }
  }
  bests.set(id, best); return best
}
/** 攻擊 sheet 中往前（右）伸最遠的影格。 */
export const peakFrame = (scene: Phaser.Scene, key: string): number | undefined => bestFrame(scene, key, 'reach', (mask) => {
  let reach = -1
  mask.solid.forEach((solid, i) => { if (solid) reach = Math.max(reach, i % mask.width) })
  return reach
})
/** 蹲姿 sheet 中頭頂最低（蹲最深）的影格；05_Crouch 前段是站姿，防禦固定顯示這格。 */
export const crouchFrame = (scene: Phaser.Scene, key: string): number | undefined => bestFrame(scene, key, 'crouch', (mask) => Math.floor(mask.solid.indexOf(1) / mask.width))

type Stance = Pick<Placement, 'mask' | 'scale' | 'originY'>
/** 兩人面對面（腳底對齊）、輪廓水平間隙剛好 edge 時的中心距離；逐列取「前緣＋前緣」最大值。沒有同高的列回 undefined。 */
export const contactWidth = (a: Stance, b: Stance, edge = PUSH_EDGE): number | undefined => {
  const front = ({ mask: { width, solid }, scale }: Stance, v: number): number | undefined => { for (let u = width - 1; u >= 0; u -= 1) if (solid[v * width + u]) return (u + 1 - width / 2) * scale; return undefined }
  let widest: number | undefined
  for (let v = 0; v < a.mask.height; v += 1) {
    const y = (v + 0.5 - a.originY * a.mask.height) * a.scale, vb = Math.floor(y / b.scale + b.originY * b.mask.height)
    const fa = front(a, v), fb = vb >= 0 && vb < b.mask.height ? front(b, vb) : undefined
    if (fa !== undefined && fb !== undefined) widest = Math.max(widest ?? -Infinity, fa + fb)
  }
  return widest === undefined ? undefined : widest + edge
}
// ponytail: 只量開場站姿一格、整場固定，避免換影格時互推抖動；出招伸出的手腳照樣可以疊到對方身上（本來就該命中）。
export const stancePushWidth = (scene: Phaser.Scene, renderers: Record<FighterId, TemporarySpriteRenderer>, fighters: Record<FighterId, FighterSnapshot>): number | undefined => {
  const stance = (id: FighterId): Stance | undefined => { const pose = renderers[id].pose(fighters[id]), mask = pose && readMask(scene, pose.key, pose.frame); return pose && mask && { mask, scale: pose.scale, originY: pose.originY } }
  const a = stance('PLAYER'), b = stance('ENEMY')
  return a && b ? contactWidth(a, b) : undefined
}

/** 頭像直徑（影格像素）；256 格 Body 的頭寬約 32。 */
export const HEAD_PX = 32
// ponytail: 頭＝輪廓最上緣往下 HEAD_PX 的中心；舉手過頭、倒地的影格會偏。接上 ComfyUI 正式算圖後連同頭像整段移除。
export const headOf = ({ width, height, solid }: Mask): { x: number; y: number } | undefined => {
  const top = Math.floor(solid.indexOf(1) / width)
  let sx = 0, count = 0
  if (top >= 0) for (let v = top; v < Math.min(height, top + HEAD_PX); v += 1) for (let u = 0; u < width; u += 1) if (solid[v * width + u]) { sx += u; count += 1 }
  return count ? { x: sx / count, y: top + HEAD_PX / 2 } : undefined
}
const heads = new Map<string, { x: number; y: number } | undefined>()
export const clearGeneratedHitMasks = (sprite: string): void => {
  for (const cache of [masks, bests, heads]) for (const key of cache.keys()) if (key.includes(`${sprite}-`)) cache.delete(key)
}
export const headPoint = (scene: Phaser.Scene, key: string, frameName: string | number): { x: number; y: number } | undefined => {
  const id = `${key}:${frameName}`
  if (!heads.has(id)) { const mask = readMask(scene, key, frameName); heads.set(id, mask && headOf(mask)) }
  return heads.get(id)
}

/** 以畫面上的角色輪廓判定命中；任一方沒有貼圖時回 undefined，Combat 退回 AABB。 */
/**
 * 貼身必中：兩人同在地面、中心距離 ≤ 推擠距離 + edge（身體已被擋住、不可能再靠近）時，伸不到的短招也算中。
 * 推擠以站姿最寬的列（常是護胸的拳頭）計算，腿較短的踢擊在那列之下伸不過去，不補這條就永遠打不到。
 * 接觸點：兩人中點、攻擊輪廓最前緣那一列的高度。
 */
export const touchContact = (a: Placement, d: Placement, contact: number, edge = HIT_EDGE): { x: number; y: number } | null => {
  if (a.y !== d.y || Math.abs(d.x - a.x) > contact + edge) return null
  const { width, height, solid } = a.mask
  let tip = -1, row = 0
  for (let i = 0; i < solid.length; i += 1) if (solid[i] && i % width > tip) { tip = i % width; row = Math.floor(i / width) }
  return tip < 0 ? null : { x: (a.x + d.x) / 2, y: a.y + (row + 0.5 - a.originY * height) * a.scale }
}

/** contact：目前的推擠距離（CombatWorld.contactWidth）；有值時啟用貼身必中。 */
export const createSpriteHitTest = (scene: Phaser.Scene, renderers: Record<FighterId, TemporarySpriteRenderer>, context: (id: FighterId) => PresentationContext | undefined, contact: () => number | undefined = () => undefined): HitTest => (attacker, defender) => {
  const place = (fighter: FighterSnapshot): Placement | undefined => {
    const pose = renderers[fighter.id].pose(fighter, context(fighter.id))
    const mask = pose && readMask(scene, pose.key, pose.frame)
    return pose && mask && { mask, x: fighter.x, y: fighter.y, dir: fighter.facing === 'LEFT' ? -1 : 1, scale: pose.scale, originY: pose.originY }
  }
  const a = place(attacker), d = place(defender)
  if (!a || !d) return undefined
  const width = contact()
  return silhouetteContact(a, d, HIT_EDGE + reachFor(renderers[attacker.id].spriteId, attacker.attack)) ?? (width === undefined ? null : touchContact(a, d, width))
}
