import type { MatchSnapshot, RoundSummary } from '../match/MatchController'
import type { MatchResult, P6SubState } from '../match/ResultResolver'
import type { LeaderboardEntry } from '../api/ApiTypes'
import { testCharacterManifest, testStageManifest, type CharacterEntry, type StageId } from './assets/TestAssetManifest'

export type P2StageSelectViewModel = { heading: string; stages: { id: StageId; label: string; url: string }[]; selectedStageId: StageId }
export type P3LoadingViewModel = { character: CharacterEntry; playerName: string; enemyName: string; stage: string; progress: number }
export type BattleViewModel = { stageId: StageId; playerName: string; enemyName: string; playerHp: number; enemyHp: number; maxHp: number; timerSeconds: number; round: number; playerWins: number; enemyWins: number; combo: number; danger: boolean; lastTenSeconds: boolean; player: MatchSnapshot['world']['fighters']['PLAYER']; enemy: MatchSnapshot['world']['fighters']['ENEMY'] }
export type AnnouncerTone = 'system' | 'player' | 'enemy' | 'danger' | 'gold'
/** big：K.O.／TIME UP 用最大字級。 */
export type Announcement = { text: string; sub?: string; tone: AnnouncerTone; big?: boolean }
export type ResultStatistic = { label: string; value: string | number }
export type ResultRow = { rank: number; name: string; score: number; highlighted?: boolean }
export type ResultViewModel = { outcome: string; headline: string; title: string; score: number; rank: number | null; substate: P6SubState; statistics: ResultStatistic[]; ranking: ResultRow[]; newRecord: boolean }
export type LeaderboardPanelStatus = 'LOADING' | 'READY' | 'EMPTY' | 'OFFLINE'
export type LeaderboardPanelModel = { status: LeaderboardPanelStatus; rows: { rank: number; name: string; score: number; title: string }[] }
export type EndViewModel = { nextPlayerName?: string; nextPlayerLabel?: string }

export const stageSelectViewModel = (selectedStageId: StageId = 'laboratory'): P2StageSelectViewModel => ({ heading: 'SELECT STAGE', stages: Object.values(testStageManifest), selectedStageId })

export const loadingViewModel = (character: CharacterEntry = testCharacterManifest.presetA, enemyName = 'ROG_SAGA', stage = 'LABORATORY', progress = 1, playerName = character.displayName): P3LoadingViewModel => ({ character, playerName, enemyName, stage, progress: Math.max(0, Math.min(1, progress)) })

export const battleViewModel = (snapshot: MatchSnapshot, stageId: StageId, playerName = 'ROG_Player', enemyName = 'ROG_SAGA'): BattleViewModel => {
  const player = snapshot.world.fighters.PLAYER; const enemy = snapshot.world.fighters.ENEMY; const maxHp = 100
  return { stageId, playerName, enemyName, playerHp: player.currentHP, enemyHp: enemy.currentHP, maxHp, timerSeconds: Math.max(0, Math.ceil(snapshot.remainingTicks / 24)), round: snapshot.roundNumber, playerWins: snapshot.playerRoundWins, enemyWins: snapshot.enemyRoundWins, combo: player.combo, danger: player.currentHP <= maxHp * 0.25, lastTenSeconds: snapshot.remainingTicks <= 240, player, enemy }
}

export const resultViewModel = (result: MatchResult, rank: number | null, substate: P6SubState, leaderboard: readonly LeaderboardEntry[] = [], currentSessionId?: number): ResultViewModel => {
  const ranking = leaderboard.slice(0, 20).map((entry) => ({ rank: entry.rank, name: entry.nickname, score: entry.score, highlighted: currentSessionId !== undefined && entry.session_id === currentSessionId }))
  // 玩家不在顯示名單內時，以 YOU 列取代最後一列，讓結算一定看得到自己的名次。
  if (rank !== null && ranking.length > 0 && !ranking.some((row) => row.highlighted)) ranking.splice(19, Infinity, { rank, name: 'YOU', score: result.score, highlighted: true })
  return { outcome: result.outcome, headline: result.outcome === 'WIN' ? 'YOU WIN!' : result.outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', title: result.title, score: result.score, rank, substate, newRecord: rank === 1, statistics: [{ label: 'MAX COMBO', value: result.maxPlayerCombo }, { label: 'PLAYER HP', value: result.remainingPlayerHP }, { label: 'ROUNDS WON', value: result.playerRoundWins }], ranking }
}

const outcomeOf = (winner: 'PLAYER' | 'ENEMY' | null | undefined): Announcement => winner === 'PLAYER' ? { text: 'YOU WIN', tone: 'player' } : winner === 'ENEMY' ? { text: 'YOU LOSE', tone: 'enemy' } : { text: 'DRAW', tone: 'system' }
const CALLS: Record<'KO' | 'TIME_UP' | 'DRAW', Announcement> = { KO: { text: 'K.O.', tone: 'danger', big: true }, TIME_UP: { text: 'TIME UP', tone: 'gold', big: true }, DRAW: { text: 'DRAW', tone: 'system', big: true } }

/** P4 播報：只讀 MatchController 快照；OUTCOME 讀上一回合摘要。 */
export const battleAnnouncement = ({ announce, roundNumber }: MatchSnapshot, lastRound?: RoundSummary): Announcement | undefined => {
  if (announce === 'KO' || announce === 'TIME_UP') return CALLS[announce]
  if (announce === 'OUTCOME') return { ...outcomeOf(lastRound?.winner), sub: `ROUND ${lastRound?.roundNumber}` }
  if (announce === 'ROUND') return { text: `ROUND ${roundNumber}`, tone: 'system' }
  if (announce === 'READY') return { text: 'READY?', tone: 'system' }
  if (announce === 'FIGHT') return { text: 'FIGHT!', tone: 'player' }
  return undefined
}
/** P5 播報：結束方式（大字）＋勝負。 */
export const finishAnnouncements = (result: MatchResult): [Announcement, Announcement] => [CALLS[result.finishReason], outcomeOf(result.outcome === 'WIN' ? 'PLAYER' : result.outcome === 'LOSE' ? 'ENEMY' : null)]

export const endViewModel = (nextPlayerName?: string): EndViewModel => ({ nextPlayerName: nextPlayerName || undefined, nextPlayerLabel: nextPlayerName ? `NEXT  /  ${nextPlayerName}` : undefined })

// 首頁排行榜：entries 為 undefined 代表尚在載入，ok=false 代表請求失敗（離線）。
export const leaderboardPanelModel = (entries: readonly LeaderboardEntry[] | undefined, ok = true, limit = 10): LeaderboardPanelModel => {
  if (!ok) return { status: 'OFFLINE', rows: [] }
  if (!entries) return { status: 'LOADING', rows: [] }
  const rows = entries.slice(0, limit).map((entry) => ({ rank: entry.rank, name: entry.nickname, score: entry.score, title: entry.title }))
  return { status: rows.length ? 'READY' : 'EMPTY', rows }
}
/** 連擊標語：未滿 2 不顯示；2–3 COMBO!（萊姆綠）、4–5 GREAT!（金）、6+ AWESOME!（洋紅）。 */
export const comboCallout = (hits: number): { count: string; word: string; color: 'statusLime' | 'resultGold' | 'comboMagenta' } | undefined =>
  hits < 2 ? undefined : { count: `${hits} HITS`, ...(hits >= 6 ? { word: 'AWESOME!', color: 'comboMagenta' as const } : hits >= 4 ? { word: 'GREAT!', color: 'resultGold' as const } : { word: 'COMBO!', color: 'statusLime' as const }) }
