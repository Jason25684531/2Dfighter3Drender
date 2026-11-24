import { describe, expect, it } from 'vitest'
import { impactFlip, impactFx, impactScale } from './ImpactFx'

describe('impact VFX', () => {
  it.each([
    ['LIGHT_PUNCH', 'light-punch', 6], ['HEAVY_PUNCH', 'heavy-punch', 5],
    ['LIGHT_KICK', 'light-kick', 5], ['HEAVY_KICK', 'heavy-kick', 5],
  ] as const)('maps %s to its own strip', (attack, name, frames) => {
    expect(impactFx[attack]).toMatchObject({ url: `/test-assets/vfx/attack/${name}.png`, frames, peak: 2 })
    expect(impactScale(attack)).toBe(impactFx[attack].scale)
  })
  it('flips toward the facing side and preserves the guard strip', () => {
    expect([impactFlip('RIGHT'), impactFlip('LEFT')]).toEqual([false, true])
    expect(impactFx.guard).toMatchObject({ url: '/test-assets/vfx/guard-impact-fx/sheet-transparent.png', width: 256, height: 256, frames: 6, peak: 2, scale: 1.3 })
  })
})
