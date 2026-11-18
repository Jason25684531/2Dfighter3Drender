import { NEUTRAL_INTENT, type FighterIntent } from '../combat/CombatWorld'
import type { MatchController } from './MatchController'

/** P3 練習：傳入 enemyIntent 就不跑 AI，所以單人時對手是不出招的木樁；回合一結束就重開，永遠不計分。 */
export function practiceTick(match: MatchController, player: FighterIntent = NEUTRAL_INTENT, opponent: FighterIntent = NEUTRAL_INTENT): void {
  if (match.getSnapshot().matchState !== 'FIGHTING') match.start()
  match.tick(player, opponent)
}
