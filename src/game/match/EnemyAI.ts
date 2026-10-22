import { DEFAULT_COMBAT_CONFIG, type CombatConfig, type CombatSnapshot, type FighterIntent } from '../combat/CombatWorld'
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

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
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
  private readonly depthAlign: number
  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG, private readonly profile: AiProfile = DEFAULT_AI_PROFILE) {
    this.attackDistance = config.attack.hitboxOffset + config.attack.hitboxWidth / 2 + config.fighterWidth / 2 - config.walkSpeed
    this.depthAlign = (config.depth?.tolerance ?? Infinity) / 2
  }
  reset(): void {
    this.rng = mulberry32(AI_SEED); this.tickCount = 0; this.cooldown = 0; this.retreat = 0; this.committed = false; this.stance = 'HOLD'
    this.wasAttacking = false; this.guardedAttack = 0; this.guarding = false
  }

  getIntent(snapshot: CombatSnapshot): FighterIntent {
    const enemy = snapshot.fighters.ENEMY, player = snapshot.fighters.PLAYER, p = this.profile
    if (enemy.state === 'HIT_STUN' || enemy.attackPhase !== 'NONE') { this.wasAttacking = enemy.attackPhase !== 'NONE'; this.committed = false; return neutral }
    if (this.wasAttacking) { this.wasAttacking = false; this.retreat = p.retreatTicks }
    this.tickCount += 1
    if (this.cooldown > 0) this.cooldown -= 1
    const dx = player.x - enemy.x, dist = Math.abs(dx), dir = Math.sign(dx) || 1, dz = player.z - enemy.z
    // 玩家出招：每一招只擲一次是否防禦。
    if (player.attackPhase !== 'NONE' && dist <= this.attackDistance + 60) {
      if (player.attackId !== this.guardedAttack) { this.guardedAttack = player.attackId; this.guarding = this.rng() < p.guardChance }
      if (this.guarding) return { ...neutral, guardHeld: true }
    }
    // 出招後先退開，避免貼身互毆。
    if (this.retreat > 0) { this.retreat -= 1; return dist >= this.attackDistance + p.spacingMax ? neutral : { ...neutral, moveX: -dir } }
    if (!this.committed && (this.tickCount - 1) % p.decisionTicks === 0) {
      if (dist <= this.attackDistance + p.spacingMax && this.rng() < p.aggression) this.committed = true
      else this.stance = stances[Math.floor(this.rng() * stances.length)]
    }
    if (this.committed) {
      // 先對齊縱深再出招，否則打不到另一條縱深上的玩家。
      const moveZ = Math.abs(dz) > this.depthAlign ? Math.sign(dz) : 0
      if (dist > this.attackDistance || moveZ) return { ...neutral, moveX: dist > this.attackDistance ? dir : 0, moveZ }
      if (this.cooldown > 0) return neutral
      this.committed = false; this.cooldown = p.attackCooldownTicks
      return { ...neutral, attackPressed: true }
    }
    if (dist > this.attackDistance + p.spacingMax) return { ...neutral, moveX: dir }
    if (dist < this.attackDistance + p.spacingMin) return { ...neutral, moveX: -dir }
    return { ...neutral, moveX: this.stance === 'IN' ? dir : this.stance === 'OUT' ? -dir : 0 }
  }
}
