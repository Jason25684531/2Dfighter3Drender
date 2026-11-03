import { describe, expect, it } from 'vitest'
import { impactFlip, impactFx, impactScale } from './ImpactFx'

describe('impact VFX', () => {
  it('sizes hits by attack weight and keeps guard constant', () => {
    expect(impactScale('hit', 'HEAVY_PUNCH')).toBe(impactFx.hit.scale.heavy)
    expect(impactScale('hit', 'HEAVY_KICK')).toBe(impactFx.hit.scale.heavy)
    expect(impactScale('hit', 'LIGHT_KICK')).toBe(impactFx.hit.scale.light)
    expect(impactFx.hit.scale.light).toBeLessThan(impactFx.hit.scale.heavy)
    expect(impactScale('guard', 'HEAVY_KICK')).toBe(impactScale('guard', 'LIGHT_PUNCH'))
  })
  it('flips toward the facing side and matches the sheet frame counts', () => {
    expect([impactFlip('RIGHT'), impactFlip('LEFT')]).toEqual([false, true])
    expect([impactFx.hit.frames, impactFx.guard.frames]).toEqual([7, 6])
  })
})
