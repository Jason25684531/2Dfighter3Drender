import type { MatchSnapshot } from '../match/MatchController'
import type { MatchResult, P6SubState } from '../match/ResultResolver'
import type { LeaderboardEntry } from '../api/ApiTypes'
import { testCharacterManifest, testStageManifest, type CharacterEntry, type StageId } from './assets/TestAssetManifest'

export type P2StageSelectViewModel = { heading: string; stages: { id: StageId; label: string; url: string }[]; selectedStageId: StageId }
export type P3LoadingViewModel = { character: CharacterEntry; playerName: string; enemyName: string; stage: string; progress: number; controls: string[] }
export type BattleViewModel = { stageId: StageId; playerName: string; enemyName: string; playerHp: number; enemyHp: number; maxHp: number; timerSeconds: number; round: number; playerWins: number; enemyWins: number; combo: number; danger: boolean; lastTenSeconds: boolean; player: MatchSnapshot['world']['fighters']['PLAYER']; enemy: MatchSnapshot['world']['fighters']['ENEMY'] }
export type P5ShowcaseVariant = 'KO' | 'TIME_UP' | 'WIN'
export type PresentationViewModel = { headline: string; outcome: string; result?: 'WIN' | 'LOSE' | 'DRAW' }
export type ResultStatistic = { label: string; value: string | number }
export type ResultRow = { rank: number; name: string; score: number; highlighted?: boolean }
export type ResultViewModel = { outcome: string; headline: string; title: string; score: number; rank: number | null; substate: P6SubState; statistics: ResultStatistic[]; ranking: ResultRow[]; newRecord: boolean }
export type LeaderboardPanelStatus = 'LOADING' | 'READY' | 'EMPTY' | 'OFFLINE'
export type LeaderboardPanelModel = { status: LeaderboardPanelStatus; rows: { rank: number; name: string; score: number; title: string }[] }
export type EndViewModel = { nextPlayerName?: string; nextPlayerLabel?: string }

export const stageSelectViewModel = (selectedStageId: StageId = 'laboratory'): P2StageSelectViewModel => ({ heading: 'SELECT STAGE', stages: Object.values(testStageManifest), selectedStageId })

export const loadingViewModel = (character: CharacterEntry = testCharacterManifest.presetA, enemyName = 'ROG_SAGA', stage = 'LABORATORY', progress = 1, playerName = character.displayName): P3LoadingViewModel => ({ character, playerName, enemyName, stage, progress: Math.max(0, Math.min(1, progress)), controls: ['MOVE', 'JUMP', 'PUNCH', 'KICK', 'GUARD'] })

export const battleViewModel = (snapshot: MatchSnapshot, stageId: StageId, playerName = 'ROG_Player', enemyName = 'ROG_SAGA'): BattleViewModel => {
  const player = snapshot.world.fighters.PLAYER; const enemy = snapshot.world.fighters.ENEMY; const maxHp = 100
  return { stageId, playerName, enemyName, playerHp: player.currentHP, enemyHp: enemy.currentHP, maxHp, timerSeconds: Math.max(0, Math.ceil(snapshot.remainingTicks / 24)), round: snapshot.roundNumber, playerWins: snapshot.playerRoundWins, enemyWins: snapshot.enemyRoundWins, combo: player.combo, danger: player.currentHP <= maxHp * 0.25, lastTenSeconds: snapshot.remainingTicks <= 240, player, enemy }
}

export const mockResultViewModel = (substate: P6SubState = 'RANK_1_TO_6', outcome: 'WIN' | 'LOSE' | 'DRAW' = 'WIN'): ResultViewModel => ({
  outcome, headline: outcome === 'WIN' ? 'YOU WIN!' : outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', title: outcome === 'WIN' ? 'RISING STAR' : '', score: 1541, rank: substate === 'NOT_RANKED' ? null : substate === 'RANK_20' ? 20 : substate === 'RANK_7_TO_19' ? 12 : 3, substate, newRecord: outcome === 'WIN',
  statistics: [{ label: 'MAX COMBO', value: 28 }, { label: 'PLAYER HP', value: 80 }, { label: 'ROUNDS WON', value: 2 }],
  ranking: [['Shadow', 1688], ['Kazu', 1630], ['ROG_Player', 1541], ['Lee', 1488], ['Nancy', 1420], ['Chris', 1338], ['Taro', 1310], ['Ken', 1256], ['Kevin', 1203], ['Yuki', 1180]].map(([name, score], index) => ({ rank: index + 1, name: String(name), score: Number(score), highlighted: name === 'ROG_Player' })),
})

export const resultViewModel = (result: MatchResult, rank: number | null, substate: P6SubState, leaderboard: readonly LeaderboardEntry[] = [], currentSessionId?: number): ResultViewModel => {
  const ranking = leaderboard.slice(0, 20).map((entry) => ({ rank: entry.rank, name: entry.nickname, score: entry.score, highlighted: currentSessionId !== undefined && entry.session_id === currentSessionId }))
  // 玩家不在顯示名單內時，以 YOU 列取代最後一列，讓結算一定看得到自己的名次。
  if (rank !== null && ranking.length > 0 && !ranking.some((row) => row.highlighted)) ranking.splice(19, Infinity, { rank, name: 'YOU', score: result.score, highlighted: true })
  return { outcome: result.outcome, headline: result.outcome === 'WIN' ? 'YOU WIN!' : result.outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', title: result.title, score: result.score, rank, substate, newRecord: rank === 1, statistics: [{ label: 'MAX COMBO', value: result.maxPlayerCombo }, { label: 'PLAYER HP', value: result.remainingPlayerHP }, { label: 'ROUNDS WON', value: result.playerRoundWins }], ranking }
}

export const presentationViewModel = (result?: MatchResult, showcase?: P5ShowcaseVariant): PresentationViewModel => {
  if (showcase === 'TIME_UP') return { headline: 'TIME UP', outcome: 'DRAW', result: 'DRAW' }
  if (showcase === 'WIN') return { headline: 'YOU WIN!', outcome: 'MATCH COMPLETE', result: 'WIN' }
  if (showcase === 'KO') return { headline: 'K.O.', outcome: '' }
  if (!result) return { headline: '', outcome: '' }
  return { headline: result.finishReason === 'TIME_UP' ? 'TIME UP' : result.finishReason === 'DRAW' ? 'DRAW' : 'K.O.', outcome: result.outcome === 'WIN' ? 'YOU WIN!' : result.outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', result: result.outcome }
}

export const endViewModel = (nextPlayerName?: string): EndViewModel => ({ nextPlayerName: nextPlayerName || undefined, nextPlayerLabel: nextPlayerName ? `NEXT  /  ${nextPlayerName}` : undefined })

// 首頁排行榜：entries 為 undefined 代表尚在載入，ok=false 代表請求失敗（離線）。
export const leaderboardPanelModel = (entries: readonly LeaderboardEntry[] | undefined, ok = true, limit = 10): LeaderboardPanelModel => {
  if (!ok) return { status: 'OFFLINE', rows: [] }
  if (!entries) return { status: 'LOADING', rows: [] }
  const rows = entries.slice(0, limit).map((entry) => ({ rank: entry.rank, name: entry.nickname, score: entry.score, title: entry.title }))
  return { status: rows.length ? 'READY' : 'EMPTY', rows }
}
