import type { CompletedMatch } from './MatchController'

export type MatchOutcome = 'WIN' | 'LOSE' | 'DRAW'
export type MatchResult = CompletedMatch & { outcome: MatchOutcome; score: number; title: 'UNTOUCHABLE' | 'COMBO CONTENDER' | 'CHAMPION' | 'EVEN MATCH' | 'CHALLENGER'; ranking: 'NOT_RANKED' }
export type P6SubState = 'RANK_1_TO_6' | 'RANK_7_TO_19' | 'RANK_20' | 'NOT_RANKED'
export const p6SubStateForRank = (rank: number | null | undefined): P6SubState => rank !== null && rank !== undefined && rank >= 1 && rank <= 6 ? 'RANK_1_TO_6' : rank !== null && rank !== undefined && rank >= 7 && rank <= 19 ? 'RANK_7_TO_19' : rank === 20 ? 'RANK_20' : 'NOT_RANKED'

export const resolveMatchResult = (match: CompletedMatch): MatchResult => {
  const outcome: MatchOutcome = match.winner === null ? 'DRAW' : match.winner === 'PLAYER' ? 'WIN' : 'LOSE'
  const bonus = outcome === 'WIN' ? 1000 : outcome === 'DRAW' ? 500 : 0
  const score = bonus + 250 * match.playerRoundWins + match.remainingPlayerHP + 100 * match.maxPlayerCombo
  const title = outcome === 'DRAW' ? 'EVEN MATCH' : outcome === 'LOSE' ? 'CHALLENGER' : match.remainingPlayerHP >= 75 ? 'UNTOUCHABLE' : match.maxPlayerCombo >= 3 ? 'COMBO CONTENDER' : 'CHAMPION'
  return { ...match, outcome, score, title, ranking: 'NOT_RANKED' }
}
