import type { CombatSnapshot, FighterIntent } from '../combat/CombatWorld'

export class EnemyAI {
  private cycle = 0
  reset(): void { this.cycle = 0 }

  getIntent(snapshot: CombatSnapshot): FighterIntent {
    const enemy = snapshot.fighters.ENEMY; const player = snapshot.fighters.PLAYER; this.cycle = (this.cycle + 1) % 96
    if (enemy.state === 'HIT_STUN' || enemy.attackPhase !== 'NONE') return { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }
    const distance = player.x - enemy.x
    if (Math.abs(distance) > 240) return { moveX: Math.sign(distance), jumpPressed: false, attackPressed: false, guardHeld: false }
    if (this.cycle >= 72 && this.cycle <= 83) return { moveX: distance > 0 ? -1 : 1, jumpPressed: false, attackPressed: false, guardHeld: true }
    return { moveX: 0, jumpPressed: false, attackPressed: true, guardHeld: false }
  }
}
