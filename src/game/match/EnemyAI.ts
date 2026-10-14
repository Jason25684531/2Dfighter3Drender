import { DEFAULT_COMBAT_CONFIG, type CombatConfig, type CombatSnapshot, type FighterIntent } from '../combat/CombatWorld'

// 難度旋鈕：敵人收招後，在攻擊距離內再停手的 tick 數（24Hz；12 ≈ 0.5 秒）。調大更簡單；0 = 原本的連續出招。
export const ENEMY_ATTACK_COOLDOWN_TICKS = 12

export class EnemyAI {
  private cycle = 0
  private cooldown = 0
  private readonly attackDistance: number
  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG, private readonly attackCooldownTicks = ENEMY_ATTACK_COOLDOWN_TICKS) {
    this.attackDistance = config.attack.hitboxOffset + config.attack.hitboxWidth / 2 + config.fighterWidth / 2 - config.walkSpeed
  }
  reset(): void { this.cycle = 0; this.cooldown = 0 }

  getIntent(snapshot: CombatSnapshot): FighterIntent {
    const enemy = snapshot.fighters.ENEMY; const player = snapshot.fighters.PLAYER; this.cycle = (this.cycle + 1) % 96
    if (enemy.state === 'HIT_STUN' || enemy.attackPhase !== 'NONE') return { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
    const distance = player.x - enemy.x
    if (Math.abs(distance) > this.attackDistance) return { moveX: Math.sign(distance), jumpPressed: false, attackPressed: false, guardHeld: false }
    if (this.cycle >= 72 && this.cycle <= 83) return { moveX: distance > 0 ? -1 : 1, jumpPressed: false, attackPressed: false, guardHeld: true }
    if (this.cooldown > 0) { this.cooldown -= 1; return { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false } }
    this.cooldown = this.attackCooldownTicks
    return { moveX: 0, jumpPressed: false, attackPressed: true, guardHeld: false }
  }
}
