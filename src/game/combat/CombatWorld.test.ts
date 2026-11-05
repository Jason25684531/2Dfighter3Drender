import { describe, expect, it } from 'vitest'
import { STAGE_TUNING } from '../config/stageTuning'
import { ATTACK_ACTIONS } from '../input/ControlProfile'
import { CombatWorld, DEFAULT_COMBAT_CONFIG, KNOCKDOWN, type CombatConfig, type CombatEvent, type FighterIntent } from './CombatWorld'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false }
const closeConfig = (positions = { PLAYER: 560, ENEMY: 640 }): CombatConfig => ({
  arenaWidth: 1920, floorY: 820, fighterWidth: 120, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100,
  attack: { startupTicks: 3, activeTicks: 2, recoveryTicks: 5, damage: 10, hitStunTicks: 6, hitboxOffset: 90, hitboxWidth: 90, hitboxHeight: 80, blockStunTicks: 0, knockback: 0, knockbackTicks: 0, blockPush: 0, blockPushTicks: 0, hitFreeze: 0, blockFreeze: 0 }, initialPositions: positions,
})
const tick = (world: CombatWorld, player = neutral, enemy = neutral): void => world.tick(player, enemy)

describe('CombatWorld', () => {
  it('freezes deterministically, pushes the defender, and allows a buffered combo', () => {
    // 固定單一招式資料，只驗 freeze／knockback／buffer 機制。
    const config: CombatConfig = { ...DEFAULT_COMBAT_CONFIG, attack: { ...DEFAULT_COMBAT_CONFIG.attack, startupTicks: 3, recoveryTicks: 12, hitStunTicks: 20, knockback: 12, knockbackTicks: 5, hitFreeze: 3 }, moves: undefined, initialPositions: { PLAYER: 1300, ENEMY: 1520 } }
    const world = new CombatWorld(config), events: CombatEvent[] = []
    world.subscribe(event => events.push(event))
    tick(world, { ...neutral, attackPressed: true })
    for (let i = 0; i < 3; i++) tick(world)
    const hit = world.getSnapshot()
    for (let i = 0; i < 3; i++) { tick(world); expect(world.getSnapshot().fighters).toEqual(hit.fighters) }
    for (let i = 0; i < 5; i++) tick(world)
    expect(world.getFighter('ENEMY').x).toBe(hit.fighters.ENEMY.x + 60)
    while (world.getFighter('PLAYER').attackPhase !== 'RECOVERY' || world.getFighter('PLAYER').attackTicks < 11) tick(world)
    tick(world, { ...neutral, attackPressed: true, attack: 'HEAVY_KICK' })
    for (let i = 0; i < 8; i++) tick(world)
    expect(world.getFighter('PLAYER').combo).toBe(2)
    expect(events.filter(event => event.type === 'ATTACK_STARTED').at(-1)).toMatchObject({ attack: 'HEAVY_KICK' })
  })

  it('emits a jump event', () => {
    const world = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1520 } }), events: CombatEvent[] = []
    world.subscribe(event => events.push(event))
    tick(world, { ...neutral, jumpPressed: true })
    expect(events.filter(event => event.type === 'JUMP')).toEqual([{ type: 'JUMP', fighter: 'PLAYER' }])
  })
  it('does not block while airborne or attacking', () => {
    for (const action of ['jumpPressed', 'attackPressed'] as const) {
      const world = new CombatWorld(closeConfig())
      tick(world, { ...neutral, attackPressed: true }, { ...neutral, moveX: 1, [action]: true })
      for (let i = 0; i < 3; i++) tick(world, neutral, { ...neutral, moveX: 1 })
      expect(world.getFighter('ENEMY').currentHP).toBe(90)
    }
  })
  it('can block another attack while still in block stun', () => {
    const config = closeConfig(), world = new CombatWorld({ ...config, walkSpeed: 0, attack: { ...config.attack, startupTicks: 0, activeTicks: 1, recoveryTicks: 0, blockStunTicks: 20 } }), events: CombatEvent[] = []
    world.subscribe(event => events.push(event))
    for (let i = 0; i < 8; i++) tick(world, { ...neutral, attackPressed: true }, { ...neutral, moveX: 1 })
    expect(events.filter(event => event.type === 'BLOCK').length).toBeGreaterThanOrEqual(2)
    expect(world.getFighter('ENEMY').currentHP).toBe(100)
  })
  it('buffers an attack pressed during freeze and retains its kind', () => {
    const config = closeConfig(), world = new CombatWorld({ ...config, inputBufferTicks: 3, attack: { ...config.attack, hitStunTicks: 1, hitFreeze: 3 } })
    tick(world, { ...neutral, attackPressed: true }); for (let i = 0; i < 3; i++) tick(world)
    tick(world, neutral, { ...neutral, attackPressed: true, attack: 'HEAVY_KICK' }); tick(world); tick(world); tick(world)
    expect(world.getFighter('ENEMY')).toMatchObject({ attackPhase: 'STARTUP', attack: 'HEAVY_KICK' })
  })
  it('replays the same freeze and event sequence deterministically', () => {
    // 固定單一招式資料，只驗 freeze／knockback／buffer 機制。
    const config: CombatConfig = { ...DEFAULT_COMBAT_CONFIG, attack: { ...DEFAULT_COMBAT_CONFIG.attack, startupTicks: 3, recoveryTicks: 12, hitStunTicks: 20, knockback: 12, knockbackTicks: 5, hitFreeze: 3 }, moves: undefined, initialPositions: { PLAYER: 1300, ENEMY: 1520 } }
    const a = new CombatWorld(config), b = new CombatWorld(config), ae: CombatEvent[] = [], be: CombatEvent[] = []
    a.subscribe(event => ae.push(event)); b.subscribe(event => be.push(event))
    for (let i = 0; i < 30; i++) { const input = { ...neutral, attackPressed: i === 0 }; tick(a, input); tick(b, input); expect(a.getSnapshot()).toEqual(b.getSnapshot()) }
    expect(ae).toEqual(be)
  })
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
  })

  it('expires a hit-stun press and clears both buffers on reset without exposing them', () => {
    const world = new CombatWorld({ ...closeConfig(), inputBufferTicks: 3 })
    tick(world, neutral, { ...neutral, attackPressed: true }); tick(world); tick(world); tick(world)
    tick(world, { ...neutral, attackPressed: true })
    for (let i = 0; i < 6; i++) tick(world)
    expect(world.getFighter('PLAYER').attackPhase).toBe('NONE')
    tick(world, { ...neutral, attackPressed: true, jumpPressed: true })
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

  it('blocks when holding back and applies damage otherwise', () => {
    const blocked = new CombatWorld(closeConfig()); tick(blocked, { ...neutral, attackPressed: true }); tick(blocked); tick(blocked); tick(blocked, neutral, { ...neutral, moveX: 1 }); expect(blocked.getFighter('ENEMY').currentHP).toBe(100); expect(blocked.getFighter('ENEMY').hitStunTicks).toBe(0)
    for (const moveX of [0, -1]) { const guarded = new CombatWorld(closeConfig()); tick(guarded, { ...neutral, attackPressed: true }); tick(guarded); tick(guarded); tick(guarded, neutral, { ...neutral, moveX }); expect(guarded.getFighter('ENEMY').currentHP).toBe(90) }
    const hit = new CombatWorld(closeConfig()); tick(hit, { ...neutral, attackPressed: true }); tick(hit); tick(hit); tick(hit, neutral, { ...neutral, moveX: -1 }); expect(hit.getFighter('ENEMY').currentHP).toBe(90); expect(hit.getFighter('ENEMY').state).toBe('HIT_STUN'); tick(hit, neutral, { ...neutral, attackPressed: true }); expect(hit.getFighter('ENEMY').attackPhase).toBe('NONE')
  })

  it('resets and produces identical snapshots for identical inputs', () => {
    const a = new CombatWorld(closeConfig()); const b = new CombatWorld(closeConfig()); const inputs = [{ ...neutral, moveX: 1 }, { ...neutral, attackPressed: true }, neutral, neutral, neutral, neutral]
    inputs.forEach((input) => { tick(a, input); tick(b, input) }); expect(a.getSnapshot()).toEqual(b.getSnapshot()); a.tick({ ...neutral, moveX: -1 }, neutral); a.reset(); expect(a.getSnapshot()).toEqual(new CombatWorld(closeConfig()).getSnapshot())
  })

  it('never lets fighters overlap or pass through each other even against a wall', () => {
    const world = new CombatWorld()
    for (let i = 0; i < 80; i += 1) { tick(world, { ...neutral, moveX: 1 }, { ...neutral, moveX: -1 }); const { PLAYER, ENEMY } = world.getSnapshot().fighters; expect(ENEMY.x - PLAYER.x).toBeGreaterThanOrEqual(220 - 1e-9) }
    expect(world.getFighter('PLAYER').facing).toBe('RIGHT'); expect(world.getFighter('ENEMY').facing).toBe('LEFT')
    const m = STAGE_TUNING.wallMargin, wall = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: m, ENEMY: m + 90 } }); tick(wall)
    expect([wall.getFighter('PLAYER').x, wall.getFighter('ENEMY').x]).toEqual([m, m + STAGE_TUNING.pushWidth])
    const close = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1380 } }); tick(close)
    tick(close, { ...neutral, attackPressed: true }); for (let i = 0; i < 4; i += 1) tick(close)
    expect(close.getFighter('ENEMY').currentHP).toBe(100 - DEFAULT_COMBAT_CONFIG.attack.damage)
  })
  it('limits separation so both fighters stay inside the camera, stopping whoever walks away', () => {
    const world = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 300, ENEMY: 2090 } })
    for (let i = 0; i < 10; i += 1) tick(world, { ...neutral, moveX: -1 })
    expect(world.getFighter('ENEMY').x).toBe(2090); expect(world.getFighter('ENEMY').x - world.getFighter('PLAYER').x).toBe(1800)
  })
  it('gives each attack its own move data with a playable window, and every move reaches at push distance', () => {
    const world = new CombatWorld(), moves = ATTACK_ACTIONS.map((attack) => world.move(attack))
    moves.forEach((move) => expect(move.hitStunTicks).toBeGreaterThan(move.recoveryTicks))
    expect(new Set(moves.map((move) => move.damage)).size).toBe(4)
    expect(world.move('LIGHT_PUNCH').startupTicks).toBeLessThan(world.move('HEAVY_PUNCH').startupTicks)
    expect(world.move('LIGHT_KICK').hitboxOffset).toBeGreaterThan(world.move('LIGHT_PUNCH').hitboxOffset)
    ATTACK_ACTIONS.forEach((attack) => {
      const close = new CombatWorld({ ...DEFAULT_COMBAT_CONFIG, initialPositions: { PLAYER: 1300, ENEMY: 1300 + STAGE_TUNING.pushWidth } })
      tick(close, { ...neutral, attackPressed: true, attack }); for (let i = 0; i < 8; i += 1) tick(close)
      expect(close.getFighter('ENEMY').currentHP).toBe(100 - close.move(attack).damage)
    })
  })
  it('records the attack kind and reports the contact point', () => {
    const run = (attack?: 'HEAVY_KICK') => {
      const world = new CombatWorld(closeConfig()), events: CombatEvent[] = []
      world.subscribe((event) => events.push(event))
      tick(world, { ...neutral, attackPressed: true, attack }); const kind = world.getFighter('PLAYER').attack
      for (let i = 0; i < 12; i += 1) tick(world)
      return { kind, events, hp: world.getFighter('ENEMY').currentHP }
    }
    const heavy = run('HEAVY_KICK'), light = run()
    expect([heavy.kind, light.kind]).toEqual(['HEAVY_KICK', 'LIGHT_PUNCH'])
    expect(heavy.events.map((e) => e.type).filter((t) => t !== 'KNOCKDOWN')).toEqual(light.events.map((e) => e.type))
    const hit = heavy.events.find((e) => e.type === 'HIT')
    expect(hit).toMatchObject({ attack: 'HEAVY_KICK', at: { x: expect.any(Number), y: expect.any(Number) } })
    // 接觸點落在敵方 hurtbox 內。
    if (hit?.type === 'HIT') { expect(hit.at.x).toBeGreaterThan(640 - 60); expect(hit.at.x).toBeLessThan(640 + 60) }
  })
  it('emits HIT then BLOCK for a guarded attack and no damage', () => {
    const world = new CombatWorld(closeConfig()), types: string[] = []
    world.subscribe((event) => types.push(event.type))
    tick(world, { ...neutral, attackPressed: true })
    for (let i = 0; i < 6; i += 1) tick(world, neutral, { ...neutral, moveX: 1 })
    expect(types).toEqual(['ATTACK_STARTED', 'HIT', 'BLOCK']); expect(world.getFighter('ENEMY').currentHP).toBe(100)
  })

  it('blocks with the held guard button even while pressing forward, standing still in GUARD', () => {
    const world = new CombatWorld(closeConfig()), types: string[] = []
    world.subscribe((event) => types.push(event.type))
    tick(world) // 先讓推擠把兩人分開
    const x = world.getFighter('ENEMY').x
    tick(world, neutral, { ...neutral, guard: true, moveX: -1 })
    expect(world.getFighter('ENEMY')).toMatchObject({ state: 'GUARD', x })
    tick(world, { ...neutral, attackPressed: true }, { ...neutral, guard: true, moveX: -1 })
    for (let i = 0; i < 6; i += 1) tick(world, neutral, { ...neutral, guard: true, moveX: -1 })
    expect(types).toContain('BLOCK'); expect(world.getFighter('ENEMY').currentHP).toBe(100)
  })

  it('knocks down on the 2nd heavy or 3rd light hit (counted separately), then wakes up invulnerable', () => {
    const config = closeConfig(), world = new CombatWorld({ ...config, attack: { ...config.attack, hitStunTicks: 20 } }), types: string[] = []
    world.subscribe((e) => types.push(e.type))
    const swing = (attack?: 'HEAVY_PUNCH'): void => { tick(world, { ...neutral, attackPressed: true, attack }); while (world.getFighter('PLAYER').attackPhase !== 'NONE') tick(world) }
    expect(KNOCKDOWN.downTicks).toBe(12)
    swing('HEAVY_PUNCH'); swing(); swing()
    expect(world.getFighter('ENEMY').state).toBe('HIT_STUN')
    expect(world.getFighter('ENEMY').state).toBe('HIT_STUN')
    swing()
    expect(world.getFighter('ENEMY').state).toBe('KNOCKDOWN'); expect(types).toContain('KNOCKDOWN')
    const hp = world.getFighter('ENEMY').currentHP
    swing()
    expect(world.getFighter('ENEMY').currentHP).toBe(hp)
    // 倒地只 0.5 秒，可能在上一下 swing 期間就起身。
    while (!types.includes('WAKE_UP')) tick(world, neutral, { ...neutral, attackPressed: true })
    expect(world.getFighter('ENEMY').attackPhase).toBe('NONE')
    expect(world.getFighter('ENEMY').invulnerableTicks).toBeGreaterThan(0)
    swing()
    expect(world.getFighter('ENEMY').currentHP).toBe(hp)
    while (world.getFighter('ENEMY').invulnerableTicks > 0) tick(world)
    // 起身歸零：之前的重擊不累計。
    swing('HEAVY_PUNCH')
    expect(world.getFighter('ENEMY').state).toBe('HIT_STUN')
    while (world.getFighter('ENEMY').hitStunTicks > 0) tick(world)
    swing('HEAVY_PUNCH')
    expect(world.getFighter('ENEMY').state).toBe('KNOCKDOWN')
    world.reset()
    expect(world.getFighter('ENEMY')).toMatchObject({ state: 'IDLE', knockdownTicks: 0, invulnerableTicks: 0 })
  })

  it('does not count blocked hits toward knockdown', () => {
    const world = new CombatWorld(closeConfig())
    for (let n = 0; n < 3; n += 1) { tick(world, { ...neutral, attackPressed: true }, { ...neutral, moveX: 1 }); while (world.getFighter('PLAYER').attackPhase !== 'NONE') tick(world, neutral, { ...neutral, moveX: 1 }) }
    expect(world.getFighter('ENEMY').state).not.toBe('KNOCKDOWN'); expect(world.getFighter('ENEMY').currentHP).toBe(100)
  })
})
