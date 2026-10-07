import type { InputSnapshot } from '../input/InputManager'

export type FighterId = 'PLAYER' | 'ENEMY'
export type Facing = 'LEFT' | 'RIGHT'
export type FighterState = 'IDLE' | 'WALK' | 'JUMP' | 'ATTACK' | 'GUARD' | 'HIT_STUN'
export type AttackPhase = 'NONE' | 'STARTUP' | 'ACTIVE' | 'RECOVERY'
export type Aabb = { x: number; y: number; width: number; height: number }
export type FighterIntent = { moveX: number; jumpPressed: boolean; attackPressed: boolean; guardHeld: boolean }

export type CombatConfig = {
  arenaWidth: number; floorY: number; fighterWidth: number; fighterHeight: number; walkSpeed: number; jumpVelocity: number; gravity: number; maxHp: number
  attack: { startupTicks: number; activeTicks: number; recoveryTicks: number; damage: number; hitStunTicks: number; hitboxOffset: number; hitboxWidth: number; hitboxHeight: number }
  initialPositions: Record<FighterId, number>
}

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  arenaWidth: 1920, floorY: 820, fighterWidth: 120, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100,
  attack: { startupTicks: 3, activeTicks: 2, recoveryTicks: 5, damage: 10, hitStunTicks: 6, hitboxOffset: 90, hitboxWidth: 90, hitboxHeight: 80 },
  initialPositions: { PLAYER: 560, ENEMY: 1360 },
}

export type CombatEvent =
  | { type: 'ATTACK_STARTED'; attacker: FighterId; attackId: number }
  | { type: 'HIT'; attacker: FighterId; defender: FighterId; attackId: number }
  | { type: 'BLOCK'; attacker: FighterId; defender: FighterId; attackId: number }
  | { type: 'DAMAGE'; attacker: FighterId; defender: FighterId; amount: number; attackId: number }
  | { type: 'HP_CHANGED'; fighter: FighterId; currentHP: number; previousHP: number }
  | { type: 'COMBO_CHANGED'; fighter: FighterId; combo: number }

type Fighter = {
  id: FighterId; x: number; y: number; vx: number; vy: number; facing: Facing; currentHP: number; grounded: boolean; state: FighterState
  hitStunTicks: number; attackPhase: AttackPhase; attackTicks: number; attackId: number; hitTargets: Set<FighterId>; combo: number; comboWindowTicks: number
}

export type FighterSnapshot = Omit<Fighter, 'hitTargets'>
export type CombatSnapshot = { tick: number; fighters: Record<FighterId, FighterSnapshot> }
export const intentFromInput = (input: InputSnapshot): FighterIntent => ({ moveX: input.moveX, jumpPressed: input.jumpPressed, attackPressed: input.attackPressed, guardHeld: input.guardHeld })

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const overlaps = (a: Aabb, b: Aabb): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export class CombatWorld {
  private readonly config: CombatConfig
  private readonly fighters: Record<FighterId, Fighter>
  private readonly listeners = new Set<(event: CombatEvent) => void>()
  private tickNumber = 0
  private nextAttackId = 1
  private readonly intents: Record<FighterId, FighterIntent> = { PLAYER: { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }, ENEMY: { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false } }

  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG) {
    this.config = config
    this.fighters = { PLAYER: this.createFighter('PLAYER'), ENEMY: this.createFighter('ENEMY') }
  }

  private createFighter(id: FighterId): Fighter {
    return { id, x: this.config.initialPositions[id], y: this.config.floorY, vx: 0, vy: 0, facing: id === 'PLAYER' ? 'RIGHT' : 'LEFT', currentHP: this.config.maxHp, grounded: true, state: 'IDLE', hitStunTicks: 0, attackPhase: 'NONE', attackTicks: 0, attackId: 0, hitTargets: new Set(), combo: 0, comboWindowTicks: 0 }
  }

  subscribe(listener: (event: CombatEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getConfig(): CombatConfig { return this.config }
  getFighter(id: FighterId): FighterSnapshot { return this.snapshotFighter(this.fighters[id]) }
  getSnapshot(): CombatSnapshot { return { tick: this.tickNumber, fighters: { PLAYER: this.snapshotFighter(this.fighters.PLAYER), ENEMY: this.snapshotFighter(this.fighters.ENEMY) } } }
  getHurtbox(id: FighterId): Aabb { const fighter = this.fighters[id]; return { x: fighter.x - this.config.fighterWidth / 2, y: fighter.y - this.config.fighterHeight, width: this.config.fighterWidth, height: this.config.fighterHeight } }
  getActiveHitbox(id: FighterId): Aabb | undefined {
    const fighter = this.fighters[id]; if (fighter.attackPhase !== 'ACTIVE') return undefined
    const direction = fighter.facing === 'RIGHT' ? 1 : -1
    return { x: fighter.x + direction * this.config.attack.hitboxOffset - this.config.attack.hitboxWidth / 2, y: fighter.y - this.config.fighterHeight * 0.72, width: this.config.attack.hitboxWidth, height: this.config.attack.hitboxHeight }
  }

  tick(playerIntent: FighterIntent, enemyIntent: FighterIntent): void {
    this.intents.PLAYER = playerIntent; this.intents.ENEMY = enemyIntent; this.tickNumber += 1
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.beginTick(this.fighters[id]))
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.applyIntent(this.fighters[id], this.intents[id], id === 'PLAYER' ? 'ENEMY' : 'PLAYER'))
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.advancePhysics(this.fighters[id]))
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.advanceAttack(this.fighters[id]))
    this.resolveCollisions()
  }

  private beginTick(fighter: Fighter): void {
    if (fighter.comboWindowTicks > 0) fighter.comboWindowTicks -= 1
    if (fighter.comboWindowTicks === 0 && fighter.combo > 0) this.setCombo(fighter, 0)
    if (fighter.hitStunTicks > 0) { fighter.hitStunTicks -= 1; if (fighter.hitStunTicks === 0) fighter.state = 'IDLE' }
  }

  private applyIntent(fighter: Fighter, intent: FighterIntent, opponentId: FighterId): void {
    const opponent = this.fighters[opponentId]
    if (fighter.hitStunTicks > 0) { fighter.state = 'HIT_STUN'; return }
    if (fighter.attackPhase !== 'NONE') return
    if (fighter.x < opponent.x) fighter.facing = 'RIGHT'; else if (fighter.x > opponent.x) fighter.facing = 'LEFT'
    const backward = opponent.x > fighter.x ? intent.moveX < 0 : intent.moveX > 0
    if (intent.guardHeld && backward) { fighter.vx = 0; fighter.state = 'GUARD'; return }
    if (intent.attackPressed) { this.startAttack(fighter); return }
    if (intent.jumpPressed && fighter.grounded) { fighter.vy = this.config.jumpVelocity; fighter.grounded = false; fighter.state = 'JUMP' }
    fighter.vx = clamp(intent.moveX, -1, 1) * this.config.walkSpeed
    if (fighter.vx !== 0) fighter.state = 'WALK'; else if (fighter.grounded) fighter.state = 'IDLE'
  }

  private startAttack(fighter: Fighter): void {
    fighter.attackPhase = 'STARTUP'; fighter.attackTicks = 0; fighter.attackId = this.nextAttackId++; fighter.hitTargets.clear(); fighter.state = 'ATTACK'; this.emit({ type: 'ATTACK_STARTED', attacker: fighter.id, attackId: fighter.attackId })
  }

  private advancePhysics(fighter: Fighter): void {
    if (!fighter.grounded || fighter.vy !== 0) { fighter.vy += this.config.gravity; fighter.y += fighter.vy; if (fighter.y >= this.config.floorY) { fighter.y = this.config.floorY; fighter.vy = 0; fighter.grounded = true; if (fighter.state === 'JUMP') fighter.state = 'IDLE' } else fighter.grounded = false }
    fighter.x += fighter.vx; const edge = this.config.fighterWidth / 2; fighter.x = clamp(fighter.x, edge, this.config.arenaWidth - edge)
    if (fighter.grounded) fighter.vx = 0
  }

  private advanceAttack(fighter: Fighter): void {
    if (fighter.attackPhase === 'NONE') return
    fighter.attackTicks += 1
    if (fighter.attackPhase === 'STARTUP' && fighter.attackTicks > this.config.attack.startupTicks) { fighter.attackPhase = 'ACTIVE'; fighter.attackTicks = 1 }
    else if (fighter.attackPhase === 'ACTIVE' && fighter.attackTicks > this.config.attack.activeTicks) { fighter.attackPhase = 'RECOVERY'; fighter.attackTicks = 1 }
    else if (fighter.attackPhase === 'RECOVERY' && fighter.attackTicks > this.config.attack.recoveryTicks) { fighter.attackPhase = 'NONE'; fighter.attackTicks = 0; fighter.state = fighter.grounded ? 'IDLE' : 'JUMP' }
  }

  private resolveCollisions(): void {
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((attackerId) => {
      const attacker = this.fighters[attackerId]; const defenderId = attackerId === 'PLAYER' ? 'ENEMY' : 'PLAYER'; const defender = this.fighters[defenderId]; const hitbox = this.getActiveHitbox(attackerId)
      if (!hitbox || attacker.hitTargets.has(defenderId) || !overlaps(hitbox, this.getHurtbox(defenderId))) return
      attacker.hitTargets.add(defenderId); this.emit({ type: 'HIT', attacker: attackerId, defender: defenderId, attackId: attacker.attackId })
      const intent = this.intents[defenderId]; const backward = attacker.x > defender.x ? intent.moveX < 0 : intent.moveX > 0
      if (intent.guardHeld && backward && defender.hitStunTicks === 0) { this.emit({ type: 'BLOCK', attacker: attackerId, defender: defenderId, attackId: attacker.attackId }); return }
      const previousHP = defender.currentHP; defender.currentHP = Math.max(0, defender.currentHP - this.config.attack.damage); defender.hitStunTicks = this.config.attack.hitStunTicks; defender.state = 'HIT_STUN'; defender.attackPhase = 'NONE'; defender.attackTicks = 0; this.setCombo(attacker, attacker.comboWindowTicks > 0 ? attacker.combo + 1 : 1); attacker.comboWindowTicks = this.config.attack.hitStunTicks; this.setCombo(defender, 0)
      this.emit({ type: 'DAMAGE', attacker: attackerId, defender: defenderId, amount: previousHP - defender.currentHP, attackId: attacker.attackId }); this.emit({ type: 'HP_CHANGED', fighter: defenderId, currentHP: defender.currentHP, previousHP })
    })
  }

  private setCombo(fighter: Fighter, combo: number): void { if (fighter.combo === combo) return; fighter.combo = combo; this.emit({ type: 'COMBO_CHANGED', fighter: fighter.id, combo }) }
  private emit(event: CombatEvent): void { this.listeners.forEach((listener) => listener(event)) }
  private snapshotFighter(fighter: Fighter): FighterSnapshot { const { hitTargets: _hitTargets, ...snapshot } = fighter; return { ...snapshot } }

  reset(): void { this.tickNumber = 0; this.nextAttackId = 1; (['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => { const fresh = this.createFighter(id); this.fighters[id] = fresh }) }
}
