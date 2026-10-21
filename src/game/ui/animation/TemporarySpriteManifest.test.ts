import { describe, expect, it } from 'vitest'
import { CombatWorld } from '../../combat/CombatWorld'
import { characterEntries } from '../assets/TestAssetManifest'
import { spriteActionFor, spriteActions, spriteFrameCount, spriteFrameFor, spriteFrameUrl, spriteIds } from './TemporarySpriteManifest'

describe('temporary sprite presentation', () => {
  it('maps featured characters and temporary body stand-ins to complete local frame sets', () => {
    expect(characterEntries().map((entry) => entry.spriteId)).toEqual(['aria', 'kael', 'riven', 'aria', 'aria', 'kael', 'riven'])
    const urls = spriteIds.flatMap((id) => spriteActions.flatMap((action) => Array.from({ length: spriteFrameCount(action) }, (_, frame) => spriteFrameUrl(id, action, frame))))
    expect(urls).toHaveLength(84)
    expect(new Set(urls).size).toBe(urls.length)
    const files = Object.keys(import.meta.glob('../../../../public/test-assets/characters/{aria,kael,riven}/**/*.png'))
    expect(files.map((path) => path.slice(path.indexOf('/test-assets/'))).sort()).toEqual(urls.sort())
  })

  it('projects existing combat states and attack phases to frames without mutating combat', () => {
    const world = new CombatWorld(); const fighter = world.getFighter('PLAYER')
    expect(spriteActionFor(fighter)).toBe('idle')
    const walk = { ...fighter, state: 'WALK' as const }; expect(spriteActionFor(walk)).toBe('walk')
    const jump = { ...fighter, grounded: false }; expect(spriteActionFor(jump)).toBe('jump')
    const hurt = { ...fighter, state: 'HIT_STUN' as const }; expect(spriteActionFor(hurt)).toBe('hurt')
    const guard = { ...fighter, state: 'GUARD' as const }; expect(spriteActionFor(guard)).toBe('guard')
    expect(spriteActionFor({ ...guard, attackPhase: 'ACTIVE' })).toBe('attack')
    expect(spriteActionFor({ ...guard, grounded: false })).toBe('jump')
    expect([0, 2, 4, 6, 8].map((tick) => spriteFrameFor(guard, 'guard', tick))).toEqual([0, 1, 2, 3, 0])
    expect(spriteFrameFor({ ...fighter, attackPhase: 'STARTUP', attackTicks: 1 }, 'attack', 0)).toBe(0)
    expect(spriteFrameFor({ ...fighter, attackPhase: 'ACTIVE', attackTicks: 1 }, 'attack', 0)).toBe(2)
    expect(spriteFrameFor({ ...fighter, attackPhase: 'RECOVERY', attackTicks: 5 }, 'attack', 0)).toBe(5)
    expect(world.getFighter('PLAYER')).toEqual(fighter)
  })
})
