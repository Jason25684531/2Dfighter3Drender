import { describe, expect, it } from 'vitest'
import { STAGE_TUNING } from '../config/stageTuning'
import { CombatWorld, DEFAULT_COMBAT_CONFIG, type CombatConfig, type FighterIntent } from './CombatWorld'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
const closeConfig = (positions = { PLAYER: 560, ENEMY: 640 }): CombatConfig => ({
  arenaWidth: 1920, floorY: 820, fighterWidth: 120, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100,
  attack: { startupTicks: 3, activeTicks: 2, recoveryTicks: 5, damage: 10, hitStunTicks: 6, hitboxOffset: 90, hitboxWidth: 90, hitboxHeight: 80 }, initialPositions: positions,
})
const tick = (world: CombatWorld, player = neutral, enemy = neutral): void => world.tick(player, enemy)

describe('CombatWorld', () => {
  it.each([0, 1, 3])('retains a recovery press for exactly %i following ticks and consumes it once', (inputBufferTicks) => {
    for (const delay of [1, 2, 3, 4]) {
      const world = new CombatWorld({ ...closeConfig({ PLAYER: 560, ENEMY: 1360 }), inputBufferTicks })
      const started: number[] = []
      world.subscribe((event) => { if (event.type === 'ATTACK_STARTED') started.push(event.attackId) })
      tick(world, { ...neutral, attackPressed: true })
      while (world.getFighter('PLAYER').attackPhase !== 'RECOVERY' || world.getFighter('PLAYER').attackTicks < 6 - delay) tick(world)
      tick(world, { ...neutral, attackPressed: true })
      for (let i = 0; i < 20; i++) tick(world)
      expect(started.length, `delay ${delay}`).toBe(delay <= inputBufferTicks ? 2 : 1)
    }
  })

  it('buffers a jump until the first grounded tick and never jumps in midair', () => {
    const world = new CombatWorld()
    tick(world, { ...neutral, jumpPressed: true })
    while (world.getFighter('PLAYER').y + 2 * world.getFighter('PLAYER').vy + 3 * world.getConfig().gravity < world.getConfig().floorY) tick(world)
    tick(world, { ...neutral, jumpPressed: true })
    while (!world.getFighter('PLAYER').grounded) {
      const before = world.getFighter('PLAYER')
      tick(world)
      expect(world.getFighter('PLAYER').vy).toBe(world.getFighter('PLAYER').grounded ? 0 : before.vy + world.getConfig().gravity)
    }
    tick(world)
    expect(world.getFighter('PLAYER')).toMatchObject({ grounded: false, vy: -31 })
    for (let i = 0; i < 25; i++) tick(world)
    expect(world.getFighter('PLAYER').grounded).toBe(true)
  })

  it('drops an airborne jump that expires before landing', () => {
    const world = new CombatWorld()
    tick(world, { ...neutral, jumpPressed: true }); tick(world, { ...neutral, jumpPressed: true })
    for (let i = 0; i < 30; i++) tick(world)
    expect(world.getFighter('PLAYER')).toMatchObject({ grounded: true, vy: 0 })
  })

  it('keeps hit-stun and guard restrictions ahead of buffered actions', () => {
    const world = new CombatWorld({ ...closeConfig(), inputBufferTicks: 3 })
    tick(world, neutral, { ...neutral, attackPressed: true }); tick(world); tick(world); tick(world)
    while (world.getFighter('PLAYER').hitStunTicks > 3) tick(world)
    tick(world, { ...neutral, attackPressed: true })
    expect(world.getFighter('PLAYER')).toMatchObject({ hitStunTicks: 2, attackPhase: 'NONE' })
    tick(world); expect(world.getFighter('PLAYER').attackPhase).toBe('NONE')
    tick(world); expect(world.getFighter('PLAYER').attackPhase).toBe('STARTUP')
    for (const action of ['jumpPressed', 'attackPressed'] as const) {
      const guarded = new CombatWorld()
      tick(guarded, { ...neutral, [action]: true, guardHeld: true })
      tick(guarded, { ...neutral, guardHeld: true })
      expect(guarded.getFighter('PLAYER')).toMatchObject({ state: 'GUARD', grounded: true, attackPhase: 'NONE' })
      tick(guarded)
      expect(guarded.getFighter('PLAYER')[action === 'jumpPressed' ? 'grounded' : 'attackPhase']).toBe(action === 'jumpPressed' ? false : 'STARTUP')
    }
  })

  it('expires a hit-stun press and clears both buffers on reset without exposing them', () => {
    const world = new CombatWorld({ ...closeConfig(), inputBufferTicks: 3 })
    tick(world, neutral, { ...neutral, attackPressed: true }); tick(world); tick(world); tick(world)
    tick(world, { ...neutral, attackPressed: true })
    for (let i = 0; i < 6; i++) tick(world)
    expect(world.getFighter('PLAYER').attackPhase).toBe('NONE')
    tick(world, { ...neutral, attackPressed: true, jumpPressed: true, guardHeld: true })
    expect(world.getFighter('PLAYER')).not.toHaveProperty('jumpBuffer')
    expect(world.getFighter('PLAYER')).not.toHaveProperty('attackBuffer')
    world.reset(); tick(world)
    expect(world.getFighter('PLAYER')).toMatchObject({ grounded: true, attackPhase: 'NONE' })
  })

  it('moves, clamps, faces, and jumps deterministically', () => {
    const world = new CombatWorld(); tick(world, { ...neutral, moveX: -1 }); expect(world.getFighter('PLAYER').x).toBe(DEFAULT_COMBAT_CONFIG.initialPositions.PLAYER - 18); expect(world.getFighter('PLAYER').facing).toBe('RIGHT')
    // 對手不動時，往後走會被最大距離擋住（牆邊夾住另見推擠測試）。
    for (let i = 0; i < 150; i += 1) tick(world, { ...neutral, moveX: -1 }); expect(world.getFighter('PLAYER').x).toBe(Math.max(STAGE_TUNING.wallMargin, DEFAULT_COMBAT_CONFIG.initialPositions.ENEMY - STAGE_TUNING.maxSeparation))
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
    mirrored.reset(); mirrored.tick(neutral, { ...neutral, attackPressed: true }); for (let i = 0; i < 3; i += 1) tick(mirrored); const left = mirrored.getActiveHitbox('ENEMY')!; expect(right.x + right.width).toBeCloseTo(675); expect(left.x).toBeCloseTo(525)
  })

  it('blocks whenever guard is held, in any direction, and applies damage/hit stun otherwise', () => {
    const blocked = new CombatWorld(closeConfig()); tick(blocked, { ...neutral, attackPressed: true }); tick(blocked); tick(blocked); tick(blocked, neutral, { ...neutral, moveX: 1, guardHeld: true }); expect(blocked.getFighter('ENEMY').currentHP).toBe(100); expect(blocked.getFighter('ENEMY').hitStunTicks).toBe(0)
    for (const moveX of [0, -1]) { const guarded = new CombatWorld(closeConfig()); tick(guarded, { ...neutral, attackPressed: true }); tick(guarded); tick(guarded); tick(guarded, neutral, { ...neutral, moveX, guardHeld: true }); expect(guarded.getFighter('ENEMY').currentHP).toBe(100) }
    const hit = new CombatWorld(closeConfig()); tick(hit, { ...neutral, attackPressed: true }); tick(hit); tick(hit); tick(hit, neutral, { ...neutral, moveX: -1 }); expect(hit.getFighter('ENEMY').currentHP).toBe(90); expect(hit.getFighter('ENEMY').state).toBe('HIT_STUN'); tick(hit, neutral, { ...neutral, attackPressed: true }); expect(hit.getFighter('ENEMY').attackPhase).toBe('NONE')
  })

  it('resets and produces identical snapshots for identical inputs', () => {
    const a = new CombatWorld(closeConfig()); const b = new CombatWorld(closeConfig()); const inputs = [{ ...neutral, moveX: 1 }, { ...neutral, attackPressed: true }, neutral, neutral, neutral, neutral]
    inputs.forEach((input) => { tick(a, input); tick(b, input) }); expect(a.getSnapshot()).toEqual(b.getSnapshot()); a.tick({ ...neutral, moveX: -1 }, neutral); a.reset(); expect(a.getSnapshot()).toEqual(new CombatWorld(closeConfig()).getSnapshot())
  })

  it('never lets fighters overlap or pass through each other on the same depth lane, even against a wall', () => {
    const world = new CombatWorld()
    for (let i = 0; i < 80; i += 1) { tick(world, { ...neutral, moveX: 1 }, { ...neutral, moveX: -1 }); const { PLAYER, ENEMY } = world.getSnapshot().fighters; expect(ENEMY.x - PLAYER.x).toBeGreaterThanOrEqual(220 - 1e-9) }
    expect(world.getFighter('PLAYER').facing).toBe('RIGHT'); expect(world.getFighter('ENEMY').facing).toBe('LEFT')
    const m = STAGE_TUNING.wallMargin, wall = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: m, ENEMY: m + 90 } }); tick(wall)
    expect([wall.getFighter('PLAYER').x, wall.getFighter('ENEMY').x]).toEqual([m, m + STAGE_TUNING.pushWidth])
    // 推擠寬 220 時攻擊仍打得到（hitbox 延伸到 150+45）。
    const close = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1380 } }); tick(close)
    tick(close, { ...neutral, attackPressed: true }); for (let i = 0; i < 4; i += 1) tick(close)
    expect(close.getFighter('ENEMY').currentHP).toBe(90)
  })
  it('limits separation so both fighters stay inside the camera, stopping whoever walks away', () => {
    const world = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 300, ENEMY: 2090 } })
    for (let i = 0; i < 10; i += 1) tick(world, { ...neutral, moveX: -1 })
    expect(world.getFighter('ENEMY').x).toBe(2090); expect(world.getFighter('ENEMY').x - world.getFighter('PLAYER').x).toBe(1800)
  })
  it('moves in depth, keeps the band, lets fighters pass on different lanes, and misses across lanes', () => {
    const world = new CombatWorld()
    const { min, max } = STAGE_TUNING.depth
    for (let i = 0; i < 60; i += 1) tick(world, { ...neutral, moveZ: 1 })
    expect(world.getFighter('PLAYER').z).toBe(max); expect(world.getFighter('PLAYER').state).toBe('WALK')
    for (let i = 0; i < 80; i += 1) tick(world, { ...neutral, moveZ: -1 }); expect(world.getFighter('PLAYER').z).toBe(min)
    const lanes = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1380 } })
    for (let i = 0; i < 12; i += 1) tick(lanes, { ...neutral, moveZ: 1 })
    expect(lanes.getFighter('PLAYER').z - lanes.getFighter('ENEMY').z).toBeGreaterThan(45)
    tick(lanes, { ...neutral, attackPressed: true }); for (let i = 0; i < 4; i += 1) tick(lanes)
    expect(lanes.getFighter('ENEMY').currentHP).toBe(100)
  })
})
