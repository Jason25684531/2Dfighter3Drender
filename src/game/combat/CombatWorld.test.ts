import { describe, expect, it } from 'vitest'
import { CombatWorld, type CombatConfig, type FighterIntent } from './CombatWorld'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
const closeConfig = (positions = { PLAYER: 560, ENEMY: 640 }): CombatConfig => ({
  arenaWidth: 1920, floorY: 820, fighterWidth: 120, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100,
  attack: { startupTicks: 3, activeTicks: 2, recoveryTicks: 5, damage: 10, hitStunTicks: 6, hitboxOffset: 90, hitboxWidth: 90, hitboxHeight: 80 }, initialPositions: positions,
})
const tick = (world: CombatWorld, player = neutral, enemy = neutral): void => world.tick(player, enemy)

describe('CombatWorld', () => {
  it('moves, clamps, faces, and jumps deterministically', () => {
    const world = new CombatWorld(); tick(world, { ...neutral, moveX: -1 }); expect(world.getFighter('PLAYER').x).toBe(542); expect(world.getFighter('PLAYER').facing).toBe('RIGHT')
    for (let i = 0; i < 100; i += 1) tick(world, { ...neutral, moveX: -1 }); expect(world.getFighter('PLAYER').x).toBe(60)
    const before = world.getFighter('PLAYER'); tick(world, { ...neutral, jumpPressed: true }); expect(world.getFighter('PLAYER').grounded).toBe(false); expect(world.getFighter('PLAYER').vy).toBe(-31)
    tick(world, { ...neutral, jumpPressed: true }); expect(world.getFighter('PLAYER').vy).not.toBe(before.vy)
    for (let i = 0; i < 30; i += 1) tick(world); expect(world.getFighter('PLAYER').grounded).toBe(true); expect(world.getFighter('PLAYER').y).toBe(820)
  })

  it('runs startup, active, recovery and one-hit attack lifecycle', () => {
    const world = new CombatWorld(closeConfig()); const events: string[] = []; world.subscribe((event) => events.push(event.type))
    tick(world, { ...neutral, attackPressed: true }); expect(world.getActiveHitbox('PLAYER')).toBeUndefined()
    tick(world); tick(world); expect(world.getActiveHitbox('PLAYER')).toBeUndefined()
    tick(world); expect(world.getActiveHitbox('PLAYER')).toBeDefined(); expect(world.getFighter('ENEMY').currentHP).toBe(90)
    tick(world); expect(world.getFighter('ENEMY').currentHP).toBe(90)
    for (let i = 0; i < 6; i += 1) tick(world); expect(world.getActiveHitbox('PLAYER')).toBeUndefined(); expect(world.getFighter('PLAYER').attackPhase).toBe('NONE'); expect(events).toContain('ATTACK_STARTED'); expect(events).toContain('HIT'); expect(events).toContain('DAMAGE')
  })

  it('does not hit when inactive or separated and mirrors hitboxes by facing', () => {
    const world = new CombatWorld(closeConfig({ PLAYER: 560, ENEMY: 1200 })); tick(world, { ...neutral, attackPressed: true }); for (let i = 0; i < 4; i += 1) tick(world); expect(world.getFighter('ENEMY').currentHP).toBe(100)
    const mirrored = new CombatWorld(closeConfig()); tick(mirrored, { ...neutral, attackPressed: true }); for (let i = 0; i < 3; i += 1) tick(mirrored); const right = mirrored.getActiveHitbox('PLAYER')!
    mirrored.reset(); mirrored.tick(neutral, { ...neutral, attackPressed: true }); for (let i = 0; i < 3; i += 1) tick(mirrored); const left = mirrored.getActiveHitbox('ENEMY')!; expect(right.x + right.width).toBeCloseTo(695); expect(left.x).toBeCloseTo(505)
  })

  it('blocks only with backward guard and applies damage/hit stun otherwise', () => {
    const blocked = new CombatWorld(closeConfig()); tick(blocked, { ...neutral, attackPressed: true }); tick(blocked); tick(blocked); tick(blocked, neutral, { ...neutral, moveX: 1, guardHeld: true }); expect(blocked.getFighter('ENEMY').currentHP).toBe(100); expect(blocked.getFighter('ENEMY').hitStunTicks).toBe(0)
    const hit = new CombatWorld(closeConfig()); tick(hit, { ...neutral, attackPressed: true }); tick(hit); tick(hit); tick(hit, neutral, { ...neutral, moveX: -1, guardHeld: true }); expect(hit.getFighter('ENEMY').currentHP).toBe(90); expect(hit.getFighter('ENEMY').state).toBe('HIT_STUN'); tick(hit, neutral, { ...neutral, attackPressed: true }); expect(hit.getFighter('ENEMY').attackPhase).toBe('NONE')
  })

  it('resets and produces identical snapshots for identical inputs', () => {
    const a = new CombatWorld(closeConfig()); const b = new CombatWorld(closeConfig()); const inputs = [{ ...neutral, moveX: 1 }, { ...neutral, attackPressed: true }, neutral, neutral, neutral, neutral]
    inputs.forEach((input) => { tick(a, input); tick(b, input) }); expect(a.getSnapshot()).toEqual(b.getSnapshot()); a.tick({ ...neutral, moveX: -1 }, neutral); a.reset(); expect(a.getSnapshot()).toEqual(new CombatWorld(closeConfig()).getSnapshot())
  })
})
