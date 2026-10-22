import { describe, expect, it } from 'vitest'
import { CombatWorld } from '../../combat/CombatWorld'
import { characterEntries } from '../assets/TestAssetManifest'
import { spriteActionFor, spriteActions, spriteFrameCount, spriteFrameFor, spriteFrameUrl, spriteIds } from './TemporarySpriteManifest'
import { presentationSheet, resolvePresentation, spriteTextureFrame, spriteTextureKey } from './TemporarySpriteManifest'
import { isSheetSprite, sheetAnimations, sheetSprites, sheetUrl, SHEET_FRAME_COUNT } from './SheetSpriteManifest'

describe('temporary sprite presentation', () => {
  it('maps featured characters and temporary body stand-ins to complete local frame sets', () => {
    expect(characterEntries().map((entry) => entry.spriteId)).toEqual(['body01', 'kael', 'riven', 'aria', 'aria', 'kael', 'riven', 'kevin', 'body01'])
    const urls = spriteIds.filter(id => !isSheetSprite(id)).flatMap((id) => spriteActions.flatMap((action) => Array.from({ length: spriteFrameCount(action) }, (_, frame) => spriteFrameUrl(id, action, frame))))
    expect(urls).toHaveLength(84)
    expect(new Set(urls).size).toBe(urls.length)
    const files = Object.keys(import.meta.glob('../../../../public/test-assets/characters/{aria,kael,riven}/**/*.png'))
    expect(files.map((path) => path.slice(path.indexOf('/test-assets/'))).sort()).toEqual(urls.sort())
  })

  it('maps every Kevin sheet in source order and selects individual frames for combat', () => {
    const files = Object.keys(import.meta.glob('../../../../public/test-assets/characters/{Kevin,Customize_body_01}/*.png')).map(path => path.slice(path.indexOf('/test-assets/')))
    const urls = (['kevin', 'body01'] as const).flatMap(id => sheetAnimations.map(({ key, filename }) => sheetUrl(id, key, filename)))
    expect(urls.sort()).toEqual(files.sort())
    expect(sheetAnimations).toHaveLength(15)
    expect(sheetSprites.kevin.size * 4).toBe(512); expect(sheetSprites.body01.size * 4).toBe(1024); expect(SHEET_FRAME_COUNT).toBe(16)
    expect(spriteTextureKey('body01', 'hurt')).toBe('body01-prone')
    const fighter = new CombatWorld().getFighter('PLAYER')
    for (const action of spriteActions) expect(sheetAnimations.some(entry => `kevin-${entry.key}` === spriteTextureKey('kevin', action))).toBe(true)
    expect(Array.from({ length: 17 }, (_, i) => spriteFrameFor(fighter, 'walk', i * 5, 'kevin'))).toEqual([...Array.from({ length: 16 }, (_, i) => i), 0])
    expect(spriteTextureFrame('kevin', 15)).toBe(15)
    expect(spriteFrameFor(fighter, 'hurt', 200, 'kevin')).toBe(15)
    expect(spriteFrameFor({ ...fighter, attackPhase: 'RECOVERY', attackTicks: 5 }, 'attack', 0, 'kevin')).toBe(15)
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

  it('resolves semantic attacks by standing / airborne / crouch context to the supplied sheets', () => {
    const world = new CombatWorld(), fighter = world.getFighter('PLAYER'), before = JSON.stringify(world.getSnapshot())
    const attacking = { ...fighter, state: 'ATTACK' as const, attackPhase: 'ACTIVE' as const }, air = { ...attacking, grounded: false }
    const sheet = (f: typeof fighter, context?: Parameters<typeof resolvePresentation>[1]) => { const p = resolvePresentation(f, context); return [p, sheetUrl('body01', presentationSheet[p], sheetAnimations.find(a => a.key === presentationSheet[p])!.filename).split('/').at(-1)] }
    expect(sheet(attacking, { attack: 'LIGHT_PUNCH' })).toEqual(['PUNCH_LIGHT', '08_Punch_Light.png'])
    expect(sheet(air, { attack: 'LIGHT_PUNCH' })).toEqual(['PUNCH_AIR', '10_Punch_Jump.png'])
    expect(sheet(attacking, { attack: 'LIGHT_PUNCH', crouch: true })).toEqual(['PUNCH_CROUCH', '11_Punch_Crouch.png'])
    expect(sheet(attacking, { attack: 'HEAVY_PUNCH' })).toEqual(['PUNCH_HEAVY', '09_Punch_Heavy.png'])
    expect(sheet(air, { attack: 'HEAVY_PUNCH' })[0]).toBe('PUNCH_AIR')
    expect(sheet(attacking, { attack: 'LIGHT_KICK' })).toEqual(['KICK_LIGHT', '12_Kick_Light.png'])
    expect(sheet(attacking, { attack: 'HEAVY_KICK' })).toEqual(['KICK_HEAVY', '13_Kick_Heavy.png'])
    expect(sheet(air, { attack: 'HEAVY_KICK' })).toEqual(['KICK_AIR', '14_Kick_Jump.png'])
    expect(sheet(attacking, { attack: 'HEAVY_KICK', crouch: true })).toEqual(['KICK_CROUCH', '15_Kick_Crounch.png'])
    expect(resolvePresentation(attacking)).toBe('PUNCH_LIGHT') // CPU 沒有語意時沿用輕拳
    expect([resolvePresentation({ ...fighter, state: 'GUARD' }), resolvePresentation({ ...fighter, state: 'HIT_STUN' }), resolvePresentation(fighter, { crouch: true }), resolvePresentation({ ...fighter, state: 'WALK' }, { crouch: true })]).toEqual(['BLOCK', 'PRONE', 'CROUCH', 'MOVE'])
    expect(JSON.stringify(world.getSnapshot())).toBe(before)
  })
})
