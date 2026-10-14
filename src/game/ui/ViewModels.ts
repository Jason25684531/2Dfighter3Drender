import type { MatchSnapshot } from '../match/MatchController'
import type { MatchResult, P6SubState } from '../match/ResultResolver'
import type { LeaderboardEntry } from '../api/ApiTypes'
import type { StageId } from './assets/TestAssetManifest'
import { testCharacterManifest } from './assets/TestAssetManifest'
import { testStageManifest } from './assets/TestAssetManifest'
import type { SpriteId } from './animation/TemporarySpriteManifest'

export type CharacterChoice = { id: string; label: string; nickname: string; previewUrl: string; spriteId?: SpriteId; custom?: boolean }
export type RecordWallRow = { name: string; score: number; maxCombo?: number; title?: string }
export type P0RecordWallViewModel = { variant: 'EMPTY' | 'RECORDS_1_TO_4' | 'RECORDS_5_PLUS'; rows: RecordWallRow[] }
export type P1CharacterSelectViewModel = { heading: string; choices: CharacterChoice[]; selectedId: string; nickname: string }
export type P2StageSelectViewModel = { heading: string; stages: { id: StageId; label: string; url: string }[]; selectedStageId: StageId }
export type P3LoadingViewModel = { character: CharacterChoice; enemyName: string; stage: string; progress: number; controls: string[] }
export type BattleViewModel = { stageId: StageId; playerName: string; enemyName: string; playerHp: number; enemyHp: number; maxHp: number; timerSeconds: number; round: number; playerWins: number; enemyWins: number; combo: number; danger: boolean; lastTenSeconds: boolean; player: MatchSnapshot['world']['fighters']['PLAYER']; enemy: MatchSnapshot['world']['fighters']['ENEMY'] }
export type P5ShowcaseVariant = 'KO' | 'TIME_UP' | 'WIN'
export type PresentationViewModel = { headline: string; outcome: string; result?: 'WIN' | 'LOSE' | 'DRAW' }
export type ResultStatistic = { label: string; value: string | number }
export type ResultRow = { rank: number; name: string; score: number; highlighted?: boolean }
export type ResultViewModel = { outcome: string; headline: string; title: string; score: number; rank: number | null; substate: P6SubState; statistics: ResultStatistic[]; ranking: ResultRow[]; newRecord: boolean }
export type EndViewModel = { nextPlayerName?: string; nextPlayerLabel?: string }

export const characterChoices = (): CharacterChoice[] => [
  { id: testCharacterManifest.presetA.id, label: 'A', nickname: testCharacterManifest.presetA.nickname, spriteId: testCharacterManifest.presetA.spriteId, previewUrl: testCharacterManifest.presetA.previewUrl },
  { id: testCharacterManifest.presetB.id, label: 'B', nickname: testCharacterManifest.presetB.nickname, spriteId: testCharacterManifest.presetB.spriteId, previewUrl: testCharacterManifest.presetB.previewUrl },
  { id: testCharacterManifest.presetC.id, label: 'C', nickname: testCharacterManifest.presetC.nickname, spriteId: testCharacterManifest.presetC.spriteId, previewUrl: testCharacterManifest.presetC.previewUrl },
  { id: testCharacterManifest.custom.id, label: '+', nickname: testCharacterManifest.custom.nickname, previewUrl: testCharacterManifest.custom.previewUrl, custom: true },
]

export const characterSelectViewModel = (selectedId = characterChoices()[0].id): P1CharacterSelectViewModel => {
  const choices = characterChoices(); const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0]
  return { heading: 'SELECT YOUR FIGHTER', choices, selectedId: selected.id, nickname: selected.nickname }
}

export const stageSelectViewModel = (selectedStageId: StageId = 'laboratory'): P2StageSelectViewModel => ({ heading: 'SELECT STAGE', stages: Object.values(testStageManifest), selectedStageId })

export const p0Variant = (recordCount: number): 'EMPTY' | 'RECORDS_1_TO_4' | 'RECORDS_5_PLUS' => recordCount <= 0 ? 'EMPTY' : recordCount < 5 ? 'RECORDS_1_TO_4' : 'RECORDS_5_PLUS'

export const recordWallViewModel = (rows: readonly RecordWallRow[], variant = p0Variant(rows.length)): P0RecordWallViewModel => ({ variant, rows: [...rows] })

export const loadingViewModel = (selectedId = characterChoices()[0].id, stage = 'LABORATORY', progress = 1): P3LoadingViewModel => ({ character: characterChoices().find((choice) => choice.id === selectedId) ?? characterChoices()[0], enemyName: 'ROG_SAGA', stage, progress: Math.max(0, Math.min(1, progress)), controls: ['MOVE', 'ATTACK', 'JUMP', 'K / LB = GUARD'] })

export const battleViewModel = (snapshot: MatchSnapshot, stageId: StageId, playerName = 'ROG_Player', enemyName = 'ROG_SAGA'): BattleViewModel => {
  const player = snapshot.world.fighters.PLAYER; const enemy = snapshot.world.fighters.ENEMY; const maxHp = 100
  return { stageId, playerName, enemyName, playerHp: player.currentHP, enemyHp: enemy.currentHP, maxHp, timerSeconds: Math.max(0, Math.ceil(snapshot.remainingTicks / 24)), round: snapshot.roundNumber, playerWins: snapshot.playerRoundWins, enemyWins: snapshot.enemyRoundWins, combo: player.combo, danger: player.currentHP <= maxHp * 0.25, lastTenSeconds: snapshot.remainingTicks <= 240, player, enemy }
}

export const mockResultViewModel = (substate: P6SubState = 'RANK_1_TO_6', outcome: 'WIN' | 'LOSE' | 'DRAW' = 'WIN'): ResultViewModel => ({
  outcome, headline: outcome === 'WIN' ? 'YOU WIN!' : outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', title: outcome === 'WIN' ? 'RISING STAR' : '', score: 1541, rank: substate === 'NOT_RANKED' ? null : substate === 'RANK_20' ? 20 : substate === 'RANK_7_TO_19' ? 12 : 3, substate, newRecord: outcome === 'WIN',
  statistics: [{ label: 'MAX COMBO', value: 28 }, { label: 'PLAYER HP', value: 80 }, { label: 'ROUNDS WON', value: 2 }],
  ranking: [['Shadow', 1688], ['Kazu', 1630], ['ROG_Player', 1541], ['Lee', 1488], ['Nancy', 1420], ['Chris', 1338], ['Taro', 1310], ['Ken', 1256], ['Kevin', 1203], ['Yuki', 1180]].map(([name, score], index) => ({ rank: index + 1, name: String(name), score: Number(score), highlighted: name === 'ROG_Player' })),
})

export const resultViewModel = (result: MatchResult, rank: number | null, substate: P6SubState, leaderboard: readonly LeaderboardEntry[] = [], currentSessionId?: number): ResultViewModel => ({ outcome: result.outcome, headline: result.outcome === 'WIN' ? 'YOU WIN!' : result.outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', title: result.title, score: result.score, rank, substate, newRecord: false, statistics: [{ label: 'MAX COMBO', value: result.maxPlayerCombo }, { label: 'PLAYER HP', value: result.remainingPlayerHP }, { label: 'ROUNDS WON', value: result.playerRoundWins }], ranking: leaderboard.map((entry) => ({ rank: entry.rank, name: entry.nickname, score: entry.score, highlighted: currentSessionId !== undefined && entry.session_id === currentSessionId })) })

export const presentationViewModel = (result?: MatchResult, showcase?: P5ShowcaseVariant): PresentationViewModel => {
  if (showcase === 'TIME_UP') return { headline: 'TIME UP', outcome: 'DRAW', result: 'DRAW' }
  if (showcase === 'WIN') return { headline: 'YOU WIN!', outcome: 'MATCH COMPLETE', result: 'WIN' }
  if (showcase === 'KO') return { headline: 'K.O.', outcome: '' }
  if (!result) return { headline: '', outcome: '' }
  return { headline: result.finishReason === 'TIME_UP' ? 'TIME UP' : result.finishReason === 'DRAW' ? 'DRAW' : 'K.O.', outcome: result.outcome === 'WIN' ? 'YOU WIN!' : result.outcome === 'LOSE' ? 'YOU LOSE!' : 'DRAW!', result: result.outcome }
}

export const endViewModel = (nextPlayerName?: string): EndViewModel => ({ nextPlayerName: nextPlayerName || undefined, nextPlayerLabel: nextPlayerName ? `NEXT  /  ${nextPlayerName}` : undefined })
