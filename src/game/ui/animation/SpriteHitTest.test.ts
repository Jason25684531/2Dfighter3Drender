import { describe, expect, it } from 'vitest'
import { CombatWorld, DEFAULT_COMBAT_CONFIG } from '../../combat/CombatWorld'
import { spriteFrameFor } from './TemporarySpriteManifest'
import { contactWidth, HIT_EDGE, dilate, touchContact, headOf, HEAD_PX, silhouetteContact, type Mask, type Placement } from './SpriteHitTest'
import { HIT_TUNING, reachFor } from '../../config/hitTuning'

// 10×10 實心方塊，錨點在底部中央：world 佔 [x-5, x+5]。
const block: Mask = { width: 10, height: 10, solid: new Uint8Array(100).fill(1) }
const at = (x: number, dir: 1 | -1 = 1, mask = block): Placement => ({ mask, x, y: 0, dir, scale: 1, originY: 1 })

describe('SpriteHitTest', () => {
  it('hits within 5 px of the outline and misses beyond it', () => {
    // 間隙 = (dx - 5) - 5；外推 5 → dx ≤ 15 前命中。
    expect(silhouetteContact(at(0), at(14, -1), 5)).not.toBeNull()
    expect(silhouetteContact(at(0), at(16, -1), 5)).toBeNull()
    expect(silhouetteContact(at(0), at(16, -1), 8)).not.toBeNull()
  })
  it('adds the per-character reach to the edge, falling back to the default row', () => {
    // 間隙 = dx - 10；s1aw 輕拳 edge 10 + reach 40 = 50。
    const edge = HIT_EDGE + reachFor('s1aw', 'LIGHT_PUNCH')
    expect(edge).toBe(HIT_TUNING.edge + 40)
    expect(silhouetteContact(at(0), at(59, -1), edge)).not.toBeNull()
    expect(silhouetteContact(at(0), at(61, -1), edge)).toBeNull()
    // 沒列的角色：輕攻擊吃 default，重攻擊 0。
    expect([reachFor('kevin', 'LIGHT_KICK'), reachFor(undefined, 'LIGHT_PUNCH'), reachFor('kevin', 'HEAVY_KICK')]).toEqual([30, 30, 0])
  })
  it('follows the drawn shape, not a bounding box', () => {
    // 只有右上角一格的「拳頭」：同距離下，拳頭高度不對就打不到。
    const fist = new Uint8Array(100); fist[9] = 1
    const low = new Uint8Array(100); low[99] = 1
    expect(silhouetteContact(at(0, 1, { ...block, solid: fist }), at(14, -1, { ...block, solid: low }), 5)).toBeNull()
    expect(silhouetteContact(at(0, 1, { ...block, solid: fist }), at(14, -1), 5)).toMatchObject({ x: 4.5, y: -9.5 })
  })
  it('mirrors with facing and pads dilation past the frame edge', () => {
    expect(silhouetteContact(at(0, -1), at(-14))).not.toBeNull()
    expect(dilate(block, 2)).toMatchObject({ width: 14, height: 14 })
  })
  it('lets the combat world use the silhouette verdict and falls back to AABB when unknown', () => {
    const run = (verdict: { x: number; y: number } | null | undefined) => {
      const world = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1520 } }), hits: unknown[] = []
      world.setHitTest(() => verdict); world.subscribe((event) => { if (event.type === 'HIT') hits.push(event.at) })
      world.tick({ moveX: 0, jumpPressed: false, attackPressed: true }, { moveX: 0, jumpPressed: false, attackPressed: false })
      for (let i = 0; i < 8; i += 1) world.tick({ moveX: 0, jumpPressed: false, attackPressed: false }, { moveX: 0, jumpPressed: false, attackPressed: false })
      return hits
    }
    expect(run(null)).toEqual([])
    expect(run({ x: 1, y: 2 })).toEqual([{ x: 1, y: 2 }])
    expect(run(undefined)).toHaveLength(1)
  })
  it('holds the measured peak frame during the active phase', () => {
    const fighter = { ...new CombatWorld().getFighter('PLAYER'), attackPhase: 'ACTIVE' as const, attackTicks: 2 }
    expect(spriteFrameFor(fighter, 'attack', 0, 'body01', 2)).toBe(2)
    expect(spriteFrameFor({ ...fighter, attackPhase: 'STARTUP', attackTicks: 4 }, 'attack', 0, 'body01', 2)).toBeLessThan(2)
    expect(spriteFrameFor({ ...fighter, attackPhase: 'RECOVERY', attackTicks: 1 }, 'attack', 0, 'body01', 2)).toBe(3)
    expect(spriteFrameFor(fighter, 'attack', 0, 'body01')).toBe(8)
    // 防禦：有量到蹲最深的影格就固定顯示，不從站姿開始播。
    expect([0, 7, 40].map((t) => spriteFrameFor({ ...fighter, attackPhase: 'NONE', state: 'GUARD' }, 'guard', t, 'body01', 11))).toEqual([11, 11, 11])
  })

  it('pushes bodies apart at the widest facing rows plus the edge, not at a bounding box', () => {
    // 兩個實心方塊：前緣各 5 → 10 + 5。A 放大 2 倍、只有上半寬：上半在 B 頭頂之上不算，同高的下半前緣 0 → 0 + 5。
    expect(contactWidth({ mask: block, scale: 1, originY: 1 }, { mask: block, scale: 1, originY: 1 })).toBe(15)
    const fist = new Uint8Array(100).fill(1); for (let v = 5; v < 10; v += 1) for (let u = 5; u < 10; u += 1) fist[v * 10 + u] = 0
    expect(contactWidth({ mask: { ...block, solid: fist }, scale: 2, originY: 1 }, { mask: block, scale: 1, originY: 1 }, 0)).toBe(5)
    expect(contactWidth({ mask: block, scale: 1, originY: 1 }, { mask: block, scale: 1, originY: 3 })).toBeUndefined()
  })

  it('lands a short attack when the bodies are already pushed together, but not from range or the air', () => {
    // 只有左上一格的短拳：輪廓差很遠打不到；貼身（距離 ≤ 推擠 15 + 10）則必中，接觸點在中點、拳頭高度。
    const short = new Uint8Array(100); short[0] = 1
    const punch = at(0, 1, { ...block, solid: short }), body = at(15, -1)
    expect(silhouetteContact(punch, body)).toBeNull()
    expect(touchContact(punch, body, 15)).toEqual({ x: 7.5, y: -9.5 })
    expect(touchContact(punch, at(26, -1), 15)).toBeNull()
    expect(touchContact({ ...punch, y: -50 }, body, 15)).toBeNull()
  })

  it('places the photo head at the centre of the top HEAD_PX rows of the outline', () => {
    // 100×100 空白，頭在 x 40–49、y 20 起；身體從 y 20+HEAD_PX 起整列實心，不影響頭中心。
    const solid = new Uint8Array(100 * 100)
    for (let y = 20; y < 100; y += 1) for (let x = 0; x < 100; x += 1) solid[y * 100 + x] = y < 20 + HEAD_PX ? Number(x >= 40 && x < 50) : 1
    expect(headOf({ width: 100, height: 100, solid })).toEqual({ x: 44.5, y: 20 + HEAD_PX / 2 })
    expect(headOf({ width: 4, height: 4, solid: new Uint8Array(16) })).toBeUndefined()
  })
})
