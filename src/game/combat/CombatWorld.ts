import type { InputSnapshot } from '../input/InputManager'
import type { AttackAction } from '../input/ControlProfile'
import { ARENA_WIDTH, STAGE_TUNING } from '../config/stageTuning'

export type FighterId = 'PLAYER' | 'ENEMY'
export type Facing = 'LEFT' | 'RIGHT'
export type FighterState = 'IDLE' | 'WALK' | 'JUMP' | 'ATTACK' | 'GUARD' | 'HIT_STUN' | 'KNOCKDOWN'
export type AttackPhase = 'NONE' | 'STARTUP' | 'ACTIVE' | 'RECOVERY'
export type Aabb = { x: number; y: number; width: number; height: number }
// attack：出招種類，決定招式資料（幀數、傷害、判定框）；省略視為輕拳。
export type FighterIntent = { moveX: number; jumpPressed: boolean; attackPressed: boolean; attack?: AttackAction }
export const NEUTRAL_INTENT: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false }

export type CombatConfig = {
  inputBufferTicks?: number
  arenaWidth: number; floorY: number; fighterWidth: number; fighterHeight: number; walkSpeed: number; jumpVelocity: number; gravity: number; maxHp: number
  attack: AttackData
  // 各招覆寫 attack 的欄位；未列出的招式沿用 attack。
  moves?: Partial<Record<AttackAction, Partial<AttackData>>>
  initialPositions: Record<FighterId, number>
  // 兩人最大水平距離，讓鏡頭（可視 1920/0.9 寬）永遠框住兩人。
  maxSeparation?: number
  // 推擠寬度（兩人中心最小距離）；sprite 身體約 285 寬，hurtbox 120 太窄會視覺重疊。省略時用 fighterWidth。
  pushWidth?: number
  // 角色中心離牆最小距離；省略時用 fighterWidth / 2。
  wallMargin?: number
}

// hitboxTop：判定框上緣離地高度佔身高比例，省略 0.8（胸口）。
export type AttackData = { startupTicks: number; activeTicks: number; recoveryTicks: number; damage: number; hitStunTicks: number; hitboxOffset: number; hitboxWidth: number; hitboxHeight: number; hitboxTop?: number; blockStunTicks?: number; knockback?: number; knockbackTicks?: number; blockPush?: number; blockPushTicks?: number; hitFreeze?: number; blockFreeze?: number }

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  inputBufferTicks: 3,
  arenaWidth: ARENA_WIDTH, floorY: 820, fighterWidth: 220, fighterHeight: 220, walkSpeed: 18, jumpVelocity: -34, gravity: 3, maxHp: 100,
  // attack＝輕拳；不變式：hitStun > recovery，push 距離下四招皆命中（CombatWorld.test）。
  attack: { startupTicks: 2, activeTicks: 3, recoveryTicks: 8, damage: 6, hitStunTicks: 14, hitboxOffset: 170, hitboxWidth: 130, hitboxHeight: 90, blockStunTicks: 6, knockback: 10, knockbackTicks: 4, blockPush: 5, blockPushTicks: 3, hitFreeze: 2, blockFreeze: 2 },
  moves: {
    HEAVY_PUNCH: { startupTicks: 4, recoveryTicks: 14, damage: 12, hitStunTicks: 20, hitboxOffset: 190, hitboxWidth: 150, hitboxHeight: 110, blockStunTicks: 9, knockback: 16, knockbackTicks: 5, hitFreeze: 4 },
    LIGHT_KICK: { startupTicks: 3, recoveryTicks: 10, damage: 8, hitStunTicks: 16, hitboxOffset: 200, hitboxWidth: 150, hitboxTop: 0.45, blockStunTicks: 7, knockback: 12 },
    HEAVY_KICK: { startupTicks: 5, activeTicks: 4, recoveryTicks: 16, damage: 14, hitStunTicks: 22, hitboxOffset: 220, hitboxWidth: 170, hitboxHeight: 110, hitboxTop: 0.5, blockStunTicks: 10, knockback: 18, knockbackTicks: 5, hitFreeze: 4 },
  },
  // 場地、推擠、最大距離都在 config/stageTuning.ts 調整。
  initialPositions: { PLAYER: ARENA_WIDTH / 2 - 400, ENEMY: ARENA_WIDTH / 2 + 400 },
  pushWidth: STAGE_TUNING.pushWidth,
  wallMargin: STAGE_TUNING.wallMargin,
  maxSeparation: STAGE_TUNING.maxSeparation,
}

// 24Hz：倒地 3 秒、起身無敵 1 秒；同一連段被打第 3 下倒地。
export const KNOCKDOWN = { downTicks: 72, invulnerableTicks: 24, hits: 3 } as const

export type CombatEvent =
  | { type: 'JUMP'; fighter: FighterId }
  | { type: 'ATTACK_STARTED'; attacker: FighterId; attackId: number; attack: AttackAction }
  | { type: 'HIT'; attacker: FighterId; defender: FighterId; attackId: number; attack: AttackAction; at: { x: number; y: number } }
  | { type: 'BLOCK'; attacker: FighterId; defender: FighterId; attackId: number }
  | { type: 'DAMAGE'; attacker: FighterId; defender: FighterId; amount: number; attackId: number }
  | { type: 'HP_CHANGED'; fighter: FighterId; currentHP: number; previousHP: number }
  | { type: 'COMBO_CHANGED'; fighter: FighterId; combo: number }
  | { type: 'KNOCKDOWN'; fighter: FighterId }
  | { type: 'WAKE_UP'; fighter: FighterId }

type Fighter = {
  jumpBuffer: number; attackBuffer: number; bufferedAttack: AttackAction
  id: FighterId; x: number; y: number; vx: number; vy: number; facing: Facing; currentHP: number; grounded: boolean; state: FighterState
  hitStunTicks: number; blockStunTicks: number; pushTicks: number; pushVx: number; attackPhase: AttackPhase; attackTicks: number; attackId: number; attack: AttackAction; hitTargets: Set<FighterId>; combo: number; comboWindowTicks: number
  knockdownTicks: number; invulnerableTicks: number; hitsTaken: number
}

export type FighterSnapshot = Omit<Fighter, 'hitTargets' | 'jumpBuffer' | 'attackBuffer' | 'bufferedAttack' | 'hitsTaken'>
/** 外部命中判定（畫面輪廓）：回傳接觸點＝命中、null＝未命中、undefined＝無法判定而退回 AABB。 */
export type HitTest = (attacker: FighterSnapshot, defender: FighterSnapshot) => { x: number; y: number } | null | undefined
export type CombatSnapshot = { tick: number; fighters: Record<FighterId, FighterSnapshot> }
export const intentFromInput = (input: InputSnapshot): FighterIntent => ({ moveX: input.moveX, jumpPressed: input.jumpPressed, attackPressed: input.attackPressed, attack: input.attack })

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
/** 兩框交集的中心＝接觸點。 */
const contact = (a: Aabb, b: Aabb): { x: number; y: number } => ({ x: (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2, y: (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 })
const overlaps = (a: Aabb, b: Aabb): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export class CombatWorld {
  private readonly config: CombatConfig
  private readonly fighters: Record<FighterId, Fighter>
  private readonly listeners = new Set<(event: CombatEvent) => void>()
  private tickNumber = 0
  private nextAttackId = 1
  private readonly intents: Record<FighterId, FighterIntent> = { PLAYER: { ...NEUTRAL_INTENT }, ENEMY: { ...NEUTRAL_INTENT } }
  private freezeTicks = 0
  private hitTest?: HitTest

  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG) {
    this.config = config
    this.fighters = { PLAYER: this.createFighter('PLAYER'), ENEMY: this.createFighter('ENEMY') }
  }

  private createFighter(id: FighterId): Fighter {
    return { id, x: this.config.initialPositions[id], y: this.config.floorY, vx: 0, vy: 0, facing: id === 'PLAYER' ? 'RIGHT' : 'LEFT', currentHP: this.config.maxHp, grounded: true, state: 'IDLE', hitStunTicks: 0, blockStunTicks: 0, pushTicks: 0, pushVx: 0, attackPhase: 'NONE', attackTicks: 0, attackId: 0, attack: 'LIGHT_PUNCH', hitTargets: new Set(), combo: 0, comboWindowTicks: 0, knockdownTicks: 0, invulnerableTicks: 0, hitsTaken: 0, jumpBuffer: 0, attackBuffer: 0, bufferedAttack: 'LIGHT_PUNCH' }
  }

  subscribe(listener: (event: CombatEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getConfig(): CombatConfig { return this.config }
  /** 呈現層提供；Combat 本身不讀畫面。 */
  setHitTest(test?: HitTest): void { this.hitTest = test }
  /** AI 用：id 此刻出 attack，判定期打不打得到（依輪廓）；沒有輪廓判定回 undefined。 */
  reaches(id: FighterId, attack: AttackAction): boolean | undefined {
    const probe: FighterSnapshot = { ...this.getFighter(id), attack, attackPhase: 'ACTIVE', attackTicks: 1, attackId: -1 }
    const at = this.hitTest?.(probe, this.getFighter(id === 'PLAYER' ? 'ENEMY' : 'PLAYER'))
    return at === undefined ? undefined : at !== null
  }
  move(attack: AttackAction): AttackData { return { ...this.config.attack, ...this.config.moves?.[attack] } }
  isFrozen(): boolean { return this.freezeTicks > 0 }
  getFighter(id: FighterId): FighterSnapshot { return this.snapshotFighter(this.fighters[id]) }
  getSnapshot(): CombatSnapshot { return { tick: this.tickNumber, fighters: { PLAYER: this.snapshotFighter(this.fighters.PLAYER), ENEMY: this.snapshotFighter(this.fighters.ENEMY) } } }
  getHurtbox(id: FighterId): Aabb { const fighter = this.fighters[id]; return { x: fighter.x - this.config.fighterWidth / 2, y: fighter.y - this.config.fighterHeight, width: this.config.fighterWidth, height: this.config.fighterHeight } }
  getActiveHitbox(id: FighterId): Aabb | undefined {
    const fighter = this.fighters[id]; if (fighter.attackPhase !== 'ACTIVE') return undefined
    const direction = fighter.facing === 'RIGHT' ? 1 : -1, move = this.move(fighter.attack)
    return { x: fighter.x + direction * move.hitboxOffset - move.hitboxWidth / 2, y: fighter.y - this.config.fighterHeight * (move.hitboxTop ?? 0.8), width: move.hitboxWidth, height: move.hitboxHeight }
  }

  tick(playerIntent: FighterIntent, enemyIntent: FighterIntent): void {
    this.intents.PLAYER = playerIntent; this.intents.ENEMY = enemyIntent; this.tickNumber += 1
    if (this.freezeTicks > 0) {
      for (const id of ['PLAYER', 'ENEMY'] as FighterId[]) {
        const fighter = this.fighters[id], intent = this.intents[id]
        fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - 1); fighter.attackBuffer = Math.max(0, fighter.attackBuffer - 1)
        if (intent.jumpPressed) fighter.jumpBuffer = (this.config.inputBufferTicks ?? 0) + 1
        if (intent.attackPressed) { fighter.attackBuffer = (this.config.inputBufferTicks ?? 0) + 1; fighter.bufferedAttack = intent.attack ?? 'LIGHT_PUNCH' }
      }
      this.freezeTicks -= 1; return
    }
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.beginTick(this.fighters[id]))
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.applyIntent(this.fighters[id], this.intents[id], id === 'PLAYER' ? 'ENEMY' : 'PLAYER'))
    const before = { PLAYER: this.fighters.PLAYER.x, ENEMY: this.fighters.ENEMY.x }
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.advancePhysics(this.fighters[id]))
    this.separate(before)
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => this.advanceAttack(this.fighters[id]))
    this.resolveCollisions()
  }

  private beginTick(fighter: Fighter): void {
    fighter.jumpBuffer = Math.max(0, fighter.jumpBuffer - 1)
    fighter.attackBuffer = Math.max(0, fighter.attackBuffer - 1)
    if (fighter.comboWindowTicks > 0) fighter.comboWindowTicks -= 1
    if (fighter.comboWindowTicks === 0 && fighter.combo > 0) this.setCombo(fighter, 0)
    if (fighter.hitStunTicks > 0) { fighter.hitStunTicks -= 1; if (fighter.hitStunTicks === 0) fighter.state = 'IDLE' }
    if (fighter.blockStunTicks > 0) { fighter.blockStunTicks -= 1; if (fighter.blockStunTicks === 0) fighter.state = 'IDLE' }
    if (fighter.invulnerableTicks > 0) fighter.invulnerableTicks -= 1
    // KO 倒地不起身：回合由 MatchController 結束。
    if (fighter.knockdownTicks > 0 && fighter.currentHP > 0) { fighter.knockdownTicks -= 1; if (fighter.knockdownTicks === 0) { fighter.state = 'IDLE'; fighter.invulnerableTicks = KNOCKDOWN.invulnerableTicks; fighter.hitsTaken = 0; this.emit({ type: 'WAKE_UP', fighter: fighter.id }) } }
  }

  private applyIntent(fighter: Fighter, intent: FighterIntent, opponentId: FighterId): void {
    // Include the press tick as well as the configured number of following ticks.
    if (intent.jumpPressed) fighter.jumpBuffer = (this.config.inputBufferTicks ?? 0) + 1
    if (intent.attackPressed) { fighter.attackBuffer = (this.config.inputBufferTicks ?? 0) + 1; fighter.bufferedAttack = intent.attack ?? 'LIGHT_PUNCH' }
    const opponent = this.fighters[opponentId]
    if (fighter.knockdownTicks > 0) { fighter.vx = 0; fighter.jumpBuffer = 0; fighter.attackBuffer = 0; fighter.state = 'KNOCKDOWN'; return }
    if (fighter.hitStunTicks > 0) { fighter.vx = 0; fighter.state = 'HIT_STUN'; return }
    if (fighter.blockStunTicks > 0) { fighter.vx = 0; fighter.state = 'GUARD'; return }
    if (fighter.attackPhase !== 'NONE') return
    if (fighter.x < opponent.x) fighter.facing = 'RIGHT'; else if (fighter.x > opponent.x) fighter.facing = 'LEFT'
    if (fighter.attackBuffer > 0) { fighter.attackBuffer = 0; this.startAttack(fighter, fighter.bufferedAttack); return }
    if (fighter.jumpBuffer > 0 && fighter.grounded) { fighter.jumpBuffer = 0; fighter.vy = this.config.jumpVelocity; fighter.grounded = false; fighter.state = 'JUMP'; this.emit({ type: 'JUMP', fighter: fighter.id }) }
    fighter.vx = clamp(intent.moveX, -1, 1) * this.config.walkSpeed
    if (fighter.vx !== 0) fighter.state = 'WALK'; else if (fighter.grounded) fighter.state = 'IDLE'
  }

  private startAttack(fighter: Fighter, attack: AttackAction): void {
    fighter.attack = attack; fighter.attackPhase = 'STARTUP'; fighter.attackTicks = 0; fighter.attackId = this.nextAttackId++; fighter.hitTargets.clear(); fighter.state = 'ATTACK'; this.emit({ type: 'ATTACK_STARTED', attacker: fighter.id, attackId: fighter.attackId, attack })
  }

  private advancePhysics(fighter: Fighter): void {
    if (!fighter.grounded || fighter.vy !== 0) { fighter.vy += this.config.gravity; fighter.y += fighter.vy; if (fighter.y >= this.config.floorY) { fighter.y = this.config.floorY; fighter.vy = 0; fighter.grounded = true; if (fighter.state === 'JUMP') fighter.state = 'IDLE' } else fighter.grounded = false }
    if (fighter.pushTicks > 0) { fighter.vx = fighter.pushVx; fighter.pushTicks -= 1 }
    fighter.x += fighter.vx; const edge = this.config.wallMargin ?? this.config.fighterWidth / 2; fighter.x = clamp(fighter.x, edge, this.config.arenaWidth - edge)
    if (fighter.grounded) fighter.vx = 0
  }

  /** 推擠：高度重疊時，兩人中心至少相距一個身寬；牆邊由另一人讓出。再限制最大距離，由往外走的一方停下。 */
  private separate(before: Record<FighterId, number>): void {
    const { PLAYER: a, ENEMY: b } = this.fighters, width = this.config.pushWidth ?? this.config.fighterWidth, low = this.config.wallMargin ?? this.config.fighterWidth / 2, high = this.config.arenaWidth - low
    const dir = a.x !== b.x ? Math.sign(b.x - a.x) : a.facing === 'RIGHT' ? 1 : -1
    if (Math.abs(a.y - b.y) < this.config.fighterHeight * 0.75 && Math.abs(b.x - a.x) < width) {
      const overlap = width - Math.abs(b.x - a.x)
      a.x = clamp(a.x - dir * overlap / 2, low, high); b.x = clamp(b.x + dir * overlap / 2, low, high)
      if ((b.x - a.x) * dir < width) { if (a.x === low || a.x === high) b.x = a.x + dir * width; else a.x = b.x - dir * width }
    }
    const excess = Math.abs(b.x - a.x) - (this.config.maxSeparation ?? Infinity)
    if (excess > 0) {
      const aOut = (a.x - before.PLAYER) * dir < 0, bOut = (b.x - before.ENEMY) * dir > 0
      const share = aOut === bOut ? 0.5 : aOut ? 1 : 0
      a.x += dir * excess * share; b.x -= dir * excess * (1 - share)
    }
  }

  private advanceAttack(fighter: Fighter): void {
    if (fighter.attackPhase === 'NONE') return
    fighter.attackTicks += 1
    const move = this.move(fighter.attack)
    if (fighter.attackPhase === 'STARTUP' && fighter.attackTicks > move.startupTicks) { fighter.attackPhase = 'ACTIVE'; fighter.attackTicks = 1 }
    else if (fighter.attackPhase === 'ACTIVE' && fighter.attackTicks > move.activeTicks) { fighter.attackPhase = 'RECOVERY'; fighter.attackTicks = 1 }
    else if (fighter.attackPhase === 'RECOVERY' && fighter.attackTicks > move.recoveryTicks) { fighter.attackPhase = 'NONE'; fighter.attackTicks = 0; fighter.state = fighter.grounded ? 'IDLE' : 'JUMP' }
  }

  private resolveCollisions(): void {
    ;(['PLAYER', 'ENEMY'] as FighterId[]).forEach((attackerId) => {
      const attacker = this.fighters[attackerId]; const defenderId = attackerId === 'PLAYER' ? 'ENEMY' : 'PLAYER'; const defender = this.fighters[defenderId]; const hitbox = this.getActiveHitbox(attackerId), hurtbox = this.getHurtbox(defenderId)
      if (!hitbox || attacker.hitTargets.has(defenderId) || defender.knockdownTicks > 0 || defender.invulnerableTicks > 0) return
      const silhouette = this.hitTest?.(this.snapshotFighter(attacker), this.snapshotFighter(defender))
      const at = silhouette !== undefined ? silhouette : overlaps(hitbox, hurtbox) ? contact(hitbox, hurtbox) : null
      if (!at) return
      const move = this.move(attacker.attack)
      attacker.hitTargets.add(defenderId); this.emit({ type: 'HIT', attacker: attackerId, defender: defenderId, attackId: attacker.attackId, attack: attacker.attack, at })
      const direction = Math.sign(defender.x - attacker.x) || (attacker.facing === 'RIGHT' ? 1 : -1)
      if (defender.grounded && defender.attackPhase === 'NONE' && defender.hitStunTicks === 0 && this.intents[defenderId].moveX * direction > 0) {
        defender.blockStunTicks = move.blockStunTicks ?? 0; defender.state = 'GUARD'; defender.pushTicks = move.blockPushTicks ?? 0; defender.pushVx = direction * (move.blockPush ?? 0); this.freezeTicks = move.blockFreeze ?? 0
        this.emit({ type: 'BLOCK', attacker: attackerId, defender: defenderId, attackId: attacker.attackId }); return
      }
      defender.pushTicks = move.knockbackTicks ?? 0; defender.pushVx = direction * (move.knockback ?? 0); this.freezeTicks = move.hitFreeze ?? 0
      const previousHP = defender.currentHP; defender.currentHP = Math.max(0, defender.currentHP - move.damage); defender.attackPhase = 'NONE'; defender.attackTicks = 0; defender.hitsTaken = attacker.comboWindowTicks > 0 ? defender.hitsTaken + 1 : 1; this.setCombo(attacker, attacker.comboWindowTicks > 0 ? attacker.combo + 1 : 1); attacker.comboWindowTicks = move.hitStunTicks; this.setCombo(defender, 0)
      if (attacker.attack.startsWith('HEAVY') || defender.hitsTaken >= KNOCKDOWN.hits || defender.currentHP === 0) { defender.hitStunTicks = 0; defender.knockdownTicks = KNOCKDOWN.downTicks; defender.state = 'KNOCKDOWN'; this.emit({ type: 'KNOCKDOWN', fighter: defenderId }) }
      else { defender.hitStunTicks = move.hitStunTicks; defender.state = 'HIT_STUN' }
      this.emit({ type: 'DAMAGE', attacker: attackerId, defender: defenderId, amount: previousHP - defender.currentHP, attackId: attacker.attackId }); this.emit({ type: 'HP_CHANGED', fighter: defenderId, currentHP: defender.currentHP, previousHP })
    })
  }

  private setCombo(fighter: Fighter, combo: number): void { if (fighter.combo === combo) return; fighter.combo = combo; this.emit({ type: 'COMBO_CHANGED', fighter: fighter.id, combo }) }
  private emit(event: CombatEvent): void { this.listeners.forEach((listener) => listener(event)) }
  private snapshotFighter(fighter: Fighter): FighterSnapshot { const { hitTargets: _hitTargets, jumpBuffer: _jumpBuffer, attackBuffer: _attackBuffer, bufferedAttack: _bufferedAttack, ...snapshot } = fighter; return { ...snapshot } }

  reset(): void { this.tickNumber = 0; this.nextAttackId = 1; this.freezeTicks = 0; (['PLAYER', 'ENEMY'] as FighterId[]).forEach((id) => { const fresh = this.createFighter(id); this.fighters[id] = fresh }) }
}
