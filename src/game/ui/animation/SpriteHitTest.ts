import type Phaser from 'phaser'
import type { FighterId, FighterSnapshot, HitTest } from '../../combat/CombatWorld'
import { spriteOriginY, type PresentationContext, type SpriteId } from './TemporarySpriteManifest'
import type { SpritePose, TemporarySpriteRenderer } from './TemporarySpriteRenderer'
import { HIT_TUNING, reachFor } from '../../config/hitTuning'

/** 角色輪廓往外推多少 world 單位仍算命中；推擠間隙。數值在 config/hitTuning.ts 調。 */
export const PUSH_EDGE = HIT_TUNING.pushEdge
const ALPHA_THRESHOLD = 32
const HIT_SAMPLE_SIZE = 512
const FRAME_SAMPLE_SIZE = 256
const groundOrigins = new WeakMap<Phaser.Textures.Frame, number>()

/** 讀像素用的縮小圖：從 4096 寬原圖直接縮畫一次約 45ms（主執行緒），背景先做好的半尺寸版只要約 1ms。 */
const pixelSources = new Map<string, { image: CanvasImageSource; scale: number }>()
export const setPixelSource = (key: string, image: CanvasImageSource, scale: number): void => { pixelSources.set(key, { image, scale }) }
export const forgetPixelSource = (key: string): void => { pixelSources.delete(key) }
/** 把貼圖原尺寸座標 (x, y, w, h) 的區域畫進 context 的 (0, 0, width, height)；有縮小圖就用縮小圖。 */
export const drawFrame = (context: CanvasRenderingContext2D, frame: Phaser.Textures.Frame, width: number, height: number, x = frame.cutX, y = frame.cutY, w = frame.cutWidth, h = frame.cutHeight): void => {
  const { image, scale } = pixelSources.get(frame.texture.key) ?? { image: frame.source.image as CanvasImageSource, scale: 1 }
  context.drawImage(image, x * scale, y * scale, w * scale, h * scale, 0, 0, width, height)
}

export function groundOrigin(frame: Phaser.Textures.Frame, fallback: number): number {
  if (!frame.source?.image) return fallback
  const cached = groundOrigins.get(frame)
  if (cached !== undefined) return cached
  const width = 128, height = 256
  const probe = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })
  if (!probe) return fallback
  drawFrame(probe, frame, width, height)
  const pixels = probe.getImageData(0, 0, width, height).data
  for (let y = height - 1; y >= 0; y--) {
    let solid = 0
    for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) solid++
    if (solid < 2) continue
    const origin = (y + 1) / height
    groundOrigins.set(frame, origin)
    return origin
  }
  groundOrigins.set(frame, fallback)
  return fallback
}

export type Mask = { width: number; height: number; solid: Uint8Array }
/** 一個影格在戰鬥座標中的擺放：腳底錨點 (x, y)、水平朝向、縮放、錨點高度比例。 */
export type Placement = { mask: Mask; x: number; y: number; dir: 1 | -1; scale: number; originY: number }

/** 方形膨脹 radius 像素（先橫後直，可分離）；四周各加寬 radius，貼影格邊的輪廓也能外推。 */
export const dilate = (mask: Mask, radius: number): Mask => {
  if (radius === 0) return mask
  const width = mask.width + radius * 2, height = mask.height + radius * 2
  const horizontal = new Uint8Array(width * mask.height), solid = new Uint8Array(width * height)
  const diameter = radius * 2 + 1
  // A destination pixel is solid if any source pixel is inside its square window.
  for (let row = 0; row < mask.height; row++) {
    let count = 0
    for (let col = 0; col < width; col++) {
      if (col < mask.width) count += mask.solid[row * mask.width + col]
      const trailing = col - diameter
      if (trailing >= 0) count -= mask.solid[row * mask.width + trailing]
      horizontal[row * width + col] = Number(count > 0)
    }
  }
  const counts = new Int32Array(width)
  for (let row = 0; row < height; row++) {
    const trailing = row - diameter
    for (let col = 0; col < width; col++) {
      if (row < mask.height) counts[col] += horizontal[row * width + col]
      if (trailing >= 0) counts[col] -= horizontal[trailing * width + col]
      solid[row * width + col] = Number(counts[col] > 0)
    }
  }
  return { width, height, solid }
}

const dilations = new WeakMap<Mask, Map<number, Mask>>()
const dilated = (mask: Mask, radius: number): Mask => {
  const byRadius = dilations.get(mask) ?? new Map<number, Mask>(); dilations.set(mask, byRadius)
  return byRadius.get(radius) ?? byRadius.set(radius, dilate(mask, radius)).get(radius) as Mask
}

const solidSums = new WeakMap<Mask, Int32Array>()

function solidSum(mask: Mask): Int32Array {
  const cached = solidSums.get(mask)
  if (cached) return cached
  const stride = mask.width + 1, summed = new Int32Array(stride * (mask.height + 1))
  for (let y = 0; y < mask.height; y++) {
    let row = 0
    for (let x = 0; x < mask.width; x++) {
      row += mask.solid[y * mask.width + x]
      summed[(y + 1) * stride + x + 1] = summed[y * stride + x + 1] + row
    }
  }
  solidSums.set(mask, summed)
  return summed
}

/** 攻擊方輪廓與「防守方輪廓外推 edge」重疊的像素平均點；沒有重疊回 null。 */
export const silhouetteContact = (attacker: Placement, defender: Placement, edge = HIT_TUNING.edge.LIGHT_KICK): { x: number; y: number } | null => {
  const padding = edge / defender.scale, target = defender.mask, sum = solidSum(target), stride = target.width + 1
  const { width, height, solid } = attacker.mask
  let sx = 0, sy = 0, count = 0
  for (let v = 0; v < height; v++) {
    const wy = attacker.y + (v + 0.5 - attacker.originY * height) * attacker.scale
    const dv = (wy - defender.y) / defender.scale + defender.originY * target.height
    const top = Math.max(0, Math.floor(dv - padding)), bottom = Math.min(target.height, Math.floor(dv + padding) + 1)
    if (top >= bottom) continue
    for (let u = 0; u < width; u++) {
      if (!solid[v * width + u]) continue
      const wx = attacker.x + attacker.dir * (u + 0.5 - width / 2) * attacker.scale
      const du = (wx - defender.x) * defender.dir / defender.scale + target.width / 2
      const left = Math.max(0, Math.floor(du - padding)), right = Math.min(target.width, Math.floor(du + padding) + 1)
      if (left >= right || sum[bottom * stride + right] - sum[bottom * stride + left] === sum[top * stride + right] - sum[top * stride + left]) continue
      sx += wx; sy += wy; count += 1
    }
  }
  return count ? { x: sx / count, y: sy / count } : null
}

// ponytail: 每個影格第一次用到才讀像素並快取；角色數多到記憶體吃緊再改成預先烘焙。
type SpriteMask = Mask & { sourceScale: number }
const masks = new Map<string, SpriteMask>()
const readMask = (scene: Phaser.Scene, key: string, frameName: string | number): SpriteMask | undefined => {
  const id = `${key}:${frameName}`
  if (masks.has(id)) return masks.get(id)
  const frame = scene.textures.exists(key) ? scene.textures.getFrame(key, frameName) : undefined
  let mask: SpriteMask | undefined
  if (frame) {
    const { cutWidth, cutHeight } = frame
    const scale = Math.min(1, HIT_SAMPLE_SIZE / Math.max(cutWidth, cutHeight))
    const width = Math.max(1, Math.round(cutWidth * scale)), height = Math.max(1, Math.round(cutHeight * scale))
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })
    if (context) {
      drawFrame(context, frame, width, height)
      const data = context.getImageData(0, 0, width, height).data, solid = new Uint8Array(width * height)
      for (let i = 0; i < solid.length; i += 1) solid[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0
      mask = { width, height, solid, sourceScale: cutHeight / height }
    }
  }
  if (mask) masks.set(id, mask)
  return mask
}

/** Read the whole sheet once so a new animation doesn't need a GPU readback per frame. */
function sampleSheet(scene: Phaser.Scene, key: string, sampleSize: number): SpriteMask[] | undefined {
  if (!scene.textures.exists(key)) return undefined
  const frames = Array.from({ length: scene.textures.get(key).frameTotal - 1 }, (_, frame) => scene.textures.getFrame(key, frame))
  const first = frames[0]
  if (!first || frames.some(frame => !frame)) return undefined
  const scale = Math.min(1, sampleSize / Math.max(first.cutWidth, first.cutHeight))
  const cutWidth = Math.max(...frames.map(frame => frame.cutX + frame.cutWidth))
  const cutHeight = Math.max(...frames.map(frame => frame.cutY + frame.cutHeight))
  const width = Math.round(cutWidth * scale), height = Math.round(cutHeight * scale)
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  drawFrame(context, first, width, height, 0, 0, cutWidth, cutHeight)
  const data = context.getImageData(0, 0, width, height).data
  return frames.map(({ cutX, cutY, cutWidth, cutHeight }) => {
    const x = Math.round(cutX * scale), y = Math.round(cutY * scale), w = Math.round(cutWidth * scale), h = Math.round(cutHeight * scale)
    const solid = new Uint8Array(w * h)
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) solid[row * w + col] = data[((y + row) * width + x + col) * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0
    return { width: w, height: h, solid, sourceScale: cutHeight / h }
  })
}

/** sheet 中 score 最大的影格（同分取前面）；讀不到貼圖回 undefined。 */
const bests = new Map<string, number>()
const bestFrame = (scene: Phaser.Scene, key: string, kind: string, score: (mask: Mask) => number): number | undefined => {
  const id = `${kind}:${key}`
  if (bests.has(id)) return bests.get(id)
  let best: number | undefined, bestScore = -1
  sampleSheet(scene, key, FRAME_SAMPLE_SIZE)?.forEach((mask, index) => {
    const value = score(mask)
    if (value > bestScore) { bestScore = value; best = index }
  })
  if (best !== undefined) bests.set(id, best)
  return best
}
/** 攻擊 sheet 中往前（右）伸最遠的影格。 */
export const peakFrame = (scene: Phaser.Scene, key: string): number | undefined => bestFrame(scene, key, 'reach', (mask) => {
  let reach = -1
  mask.solid.forEach((solid, i) => { if (solid) reach = Math.max(reach, i % mask.width) })
  return reach
})

/** Prepare the active attack frame while loading its atlas. */
export function warmAttackPose(scene: Phaser.Scene, sheet: string, id: SpriteId, texture = `${id}-${sheet}`): void {
  if (sheet !== 'attack' && !sheet.startsWith('punch-') && !sheet.startsWith('kick-')) return
  const index = peakFrame(scene, `${id}-${sheet}`)
  if (index === undefined || !readMask(scene, texture, index)) return
  groundOrigin(scene.textures.getFrame(texture, index), spriteOriginY(id))
}

export function warmIdleMasks(scene: Phaser.Scene, key: string): void {
  sampleSheet(scene, key, HIT_SAMPLE_SIZE)?.forEach((mask, index) => {
    const id = `${key}:${index}`, cached = masks.get(id) ?? mask
    masks.set(id, cached)
    solidSum(cached)
  })
}
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
// Use one idle frame per texture so changing animation frames doesn't move the fighters.
export const stancePushWidth = (scene: Phaser.Scene, player?: SpritePose, enemy?: SpritePose): number | undefined => {
  const stance = (pose?: SpritePose): Stance | undefined => {
    const mask = pose && readMask(scene, pose.key, pose.frame)
    return pose && mask && { mask, scale: pose.scale * mask.sourceScale, originY: pose.originY }
  }
  const a = stance(player), b = stance(enemy)
  return a && b ? contactWidth(a, b) : undefined
}

export const clearGeneratedHitMasks = (sprite: string): void => {
  for (const cache of [masks, bests]) for (const key of cache.keys()) if (key.includes(`${sprite}-`)) cache.delete(key)
}

/** 以畫面上的角色輪廓判定命中；任一方沒有貼圖時回 undefined，Combat 退回 AABB。 */
/**
 * 貼身必中：兩人同在地面、中心距離 ≤ 推擠距離 + edge（身體已被擋住、不可能再靠近）時，伸不到的短招也算中。
 * 推擠以站姿最寬的列（常是護胸的拳頭）計算，腿較短的踢擊在那列之下伸不過去，不補這條就永遠打不到。
 * 接觸點：兩人中點、攻擊輪廓最前緣那一列的高度。
 */
export const touchContact = (a: Placement, d: Placement, contact: number, edge = HIT_TUNING.edge.LIGHT_KICK): { x: number; y: number } | null => {
  const forward = (d.x - a.x) * a.dir
  if (a.y !== d.y || forward < 0 || forward > contact + edge) return null
  const { width, height, solid } = a.mask
  let tip = -1, row = 0
  for (let i = 0; i < solid.length; i += 1) if (solid[i] && i % width > tip) { tip = i % width; row = Math.floor(i / width) }
  return tip < 0 ? null : { x: (a.x + d.x) / 2, y: a.y + (row + 0.5 - a.originY * height) * a.scale }
}

/** contact：目前的推擠距離（CombatWorld.contactWidth）；有值時啟用貼身必中。 */
const placementFor = (scene: Phaser.Scene, renderer: TemporarySpriteRenderer, fighter: FighterSnapshot, context?: PresentationContext): Placement | undefined => {
  const pose = renderer.pose(fighter, context)
  const mask = pose && readMask(scene, pose.key, pose.frame)
  return pose && mask && { mask, x: fighter.x, y: fighter.y, dir: fighter.facing === 'LEFT' ? -1 : 1, scale: pose.scale * mask.sourceScale, originY: pose.originY }
}

export const createSpriteHitTest = (scene: Phaser.Scene, renderers: Record<FighterId, TemporarySpriteRenderer>, context: (id: FighterId) => PresentationContext | undefined, contact: () => number | undefined = () => undefined): HitTest => (attacker, defender) => {
  const a = placementFor(scene, renderers[attacker.id], attacker, context(attacker.id))
  const d = placementFor(scene, renderers[defender.id], defender, context(defender.id))
  if (!a || !d) return undefined
  const width = contact()
  const edge = HIT_TUNING.edge[attacker.attack]
  return silhouetteContact(a, d, edge + reachFor(renderers[attacker.id].spriteId, attacker.attack)) ?? (width === undefined ? null : touchContact(a, d, width, edge))
}

/** Draw the occupied rows of the same alpha mask the hit test reads. */
export function drawContactRange(graphics: Phaser.GameObjects.Graphics, renderer: TemporarySpriteRenderer, fighter: FighterSnapshot, color: number, context?: PresentationContext, edge = 0): void {
  const place = placementFor(graphics.scene, renderer, fighter, context)
  if (!place) return
  const radius = Math.floor(edge / place.scale)
  const mask = radius ? dilated(place.mask, radius) : place.mask
  const displayX = (column: number) => place.x + place.dir * (column - mask.width / 2) * place.scale
  graphics.lineStyle(2, color, 0.65)
  const stride = Math.max(1, Math.round(5 / place.scale))
  for (let row = 0; row < mask.height; row += stride) {
    const y = place.y + (row + 0.5 - place.originY * place.mask.height - radius) * place.scale
    for (let start = 0; start < mask.width; start++) {
      if (!mask.solid[row * mask.width + start]) continue
      let end = start + 1
      while (end < mask.width && mask.solid[row * mask.width + end]) end++
      graphics.lineBetween(displayX(start), y, displayX(end), y)
      start = end
    }
  }
}
