import { describe, expect, it } from 'vitest'
import { fxScale, signatureFx } from './OverdriveFx'

describe('Jeansen signature effects', () => {
  it('kicks play ROG OVERDRIVE, the heavy punch plays the explosion, the light punch and other fighters play none', () => {
    expect(signatureFx('jeansen', 'LIGHT_KICK')?.pack).toBe('overdrive')
    expect(signatureFx('hd-jeansen', 'HEAVY_KICK')?.pack).toBe('overdrive')
    expect(signatureFx('jeansen', 'HEAVY_PUNCH')?.pack).toBe('explosion')
    expect(signatureFx('jeansen', 'LIGHT_PUNCH')).toBeUndefined()
    expect(signatureFx('hw', 'HEAVY_PUNCH')).toBeUndefined()
  })

  it('draws the heavy hit at least twice the character height', () => {
    for (const attack of ['HEAVY_KICK', 'HEAVY_PUNCH'] as const) {
      const fx = signatureFx('jeansen', attack)!
      expect(fxScale(fx.pack, 'hit_impact', fx.size.hit_impact!) * (fx.pack === 'overdrive' ? 442 : 462), attack).toBeGreaterThanOrEqual(1.8 * 500)
    }
  })
})
