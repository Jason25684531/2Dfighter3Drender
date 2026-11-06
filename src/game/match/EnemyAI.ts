import { DEFAULT_COMBAT_CONFIG, NEUTRAL_INTENT as neutral, type CombatConfig, type CombatSnapshot, type FighterIntent } from '../combat/CombatWorld'
import { ATTACK_ACTIONS, type AttackAction } from '../input/ControlProfile'
import { DEFAULT_AI_PROFILE, type AiProfile } from '../config/aiProfiles'

// 難度與行為參數在 config/aiProfiles.ts。
const AI_SEED = 0x2f6e2b1
// 可重現的偽隨機：同 profile、同輸入序列 → 同輸出（單元測試與 reset 依賴）。
const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

type Stance = 'HOLD' | 'IN' | 'OUT'
const stances: readonly Stance[] = ['HOLD', 'IN', 'OUT']

export class EnemyAI {
  private rng = mulberry32(AI_SEED)
  private tickCount = 0
  private cooldown = 0
  private retreat = 0
  private committed = false
  private stance: Stance = 'HOLD'
  private wasAttacking = false
  private guardedAttack = 0
  private guarding = false
  private readonly attackDistance: number
  private readonly closest: number
  constructor(private readonly config: CombatConfig = DEFAULT_COMBAT_CONFIG, private readonly profile: AiProfile = DEFAULT_AI_PROFILE) {
    this.attackDistance = config.attack.hitboxOffset + config.attack.hitboxWidth / 2 + config.fighterWidth / 2 - config.walkSpeed
    this.closest = (config.pushWidth ?? config.fighterWidth) + config.walkSpeed
  }
  reset(): void {
    this.rng = mulberry32(AI_SEED); this.tickCount = 0; this.cooldown = 0; this.retreat = 0; this.committed = false; this.stance = 'HOLD'
    this.wasAttacking = false; this.guardedAttack = 0; this.guarding = false
  }

  /**
   * reaches：畫面輪廓的射程判定（CombatWorld.reaches）；沒有時用 AABB 估算的 attackDistance。
   * contact：兩人輪廓貼身的中心距離（CombatWorld.contactWidth）；間距帶從這裡起算，沒有時用 attackDistance。
   */
  getIntent(snapshot: CombatSnapshot, reaches?: (attack: AttackAction) => boolean | undefined, contact?: number): FighterIntent {
    const intent = this.decide(snapshot, reaches, contact), { PLAYER: player, ENEMY: enemy } = snapshot.fighters
    // CombatWorld 把「往後走」當防禦：玩家出招中只有擲中 guardChance 才准後退，否則撤退／保持間距會變成隱形防禦。
    return player.attackPhase !== 'NONE' && !this.guarding && intent.moveX * (player.x - enemy.x) < 0 ? { ...intent, moveX: 0 } : intent
  }

  private decide(snapshot: CombatSnapshot, reaches?: (attack: AttackAction) => boolean | undefined, contact?: number): FighterIntent {
    const enemy = snapshot.fighters.ENEMY, player = snapshot.fighters.PLAYER, p = this.profile
    const near = contact ?? this.attackDistance, closest = contact === undefined ? this.closest : contact + this.config.walkSpeed
    if (enemy.state === 'HIT_STUN' || enemy.state === 'KNOCKDOWN' || enemy.attackPhase !== 'NONE') { this.wasAttacking = enemy.attackPhase !== 'NONE'; this.committed = false; return neutral }
    if (this.wasAttacking) { this.wasAttacking = false; this.retreat = p.retreatTicks }
    this.tickCount += 1
    if (this.cooldown > 0) this.cooldown -= 1
    const dx = player.x - enemy.x, dist = Math.abs(dx), dir = Math.sign(dx) || 1
    // 玩家出招：每一招只擲一次是否防禦（距離外也擲，避免沿用上一招的結果）。
    if (player.attackPhase !== 'NONE') {
      if (player.attackId !== this.guardedAttack) { this.guardedAttack = player.attackId; this.guarding = this.rng() < p.guardChance }
      // guard：站定擺防禦（只往後走會退出射程，變成閃避而不是擋下）。
      if (this.guarding && dist <= this.attackDistance + 60) return { ...neutral, moveX: -dir, guard: true }
    } else this.guarding = false
    // 出招後先退開，避免貼身互毆。
    if (this.retreat > 0) { this.retreat -= 1; return dist >= near + p.spacingMax ? neutral : { ...neutral, moveX: -dir } }
    if (!this.committed && (this.tickCount - 1) % p.decisionTicks === 0) {
      if (dist <= near + p.spacingMax && this.rng() < p.aggression) this.committed = true
      else this.stance = stances[Math.floor(this.rng() * stances.length)]
    }
    // 玩家倒地或起身無敵時打不到，不白揮；保持距離等他起來。
    if (player.knockdownTicks > 0 || player.invulnerableTicks > 0) return dist < near + p.spacingMin ? { ...neutral, moveX: -dir } : neutral
    if (this.committed) {
      // 種類輪替只看 tick，不消耗 rng，出招時機與既有序列不變。
      const attack = ATTACK_ACTIONS[this.tickCount % ATTACK_ACTIONS.length]
      // 已貼到推擠距離仍判定打不到時照樣出手，避免一直往前頂。
      if (!(reaches?.(attack) ?? dist <= this.attackDistance) && dist > closest) return { ...neutral, moveX: dir }
      if (this.cooldown > 0) return neutral
      this.committed = false; this.cooldown = p.attackCooldownTicks
      return { ...neutral, attackPressed: true, attack }
    }
    if (dist > near + p.spacingMax) return { ...neutral, moveX: dir }
    if (dist < near + p.spacingMin) return { ...neutral, moveX: -dir }
    return { ...neutral, moveX: this.stance === 'IN' ? dir : this.stance === 'OUT' ? -dir : 0 }
  }
}
