import { describe, expect, it } from 'vitest'
import { CombatWorld, DEFAULT_COMBAT_CONFIG } from '../../combat/CombatWorld'
import { spriteFrameFor } from './TemporarySpriteManifest'
import { dilate, silhouetteContact, type Mask, type Placement } from './SpriteHitTest'

// 10×10 實心方塊，錨點在底部中央：world 佔 [x-5, x+5]。
const block: Mask = { width: 10, height: 10, solid: new Uint8Array(100).fill(1) }
const at = (x: number, dir: 1 | -1 = 1, mask = block): Placement => ({ mask, x, y: 0, dir, scale: 1, originY: 1 })

describe('SpriteHitTest', () => {
  it('hits within 5 px of the outline and misses beyond it', () => {
    // 間隙 = (dx - 5) - 5；外推 5 → dx ≤ 15 前命中。
    expect(silhouetteContact(at(0), at(14, -1))).not.toBeNull()
    expect(silhouetteContact(at(0), at(16, -1))).toBeNull()
    expect(silhouetteContact(at(0), at(16, -1), 8)).not.toBeNull()
  })
  it('follows the drawn shape, not a bounding box', () => {
    // 只有右上角一格的「拳頭」：同距離下，拳頭高度不對就打不到。
    const fist = new Uint8Array(100); fist[9] = 1
    const low = new Uint8Array(100); low[99] = 1
    expect(silhouetteContact(at(0, 1, { ...block, solid: fist }), at(14, -1, { ...block, solid: low }))).toBeNull()
    expect(silhouetteContact(at(0, 1, { ...block, solid: fist }), at(14, -1))).toMatchObject({ x: 4.5, y: -9.5 })
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
  })
})
