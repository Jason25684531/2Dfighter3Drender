import { CombatWorld, DEFAULT_COMBAT_CONFIG, type CombatConfig, type FighterId, type FighterIntent, type CombatSnapshot } from '../combat/CombatWorld'
import { EnemyAI } from './EnemyAI'

export const ROUND_TICKS = 60 * 24
export type MatchState = 'READY' | 'FIGHTING' | 'ROUND_END' | 'MATCH_END'
export type FinishReason = 'KO' | 'TIME_UP' | 'DRAW'
export type P4SubState = 'NORMAL' | 'COMBO' | 'DANGER' | 'LAST_10_SECONDS'
export type CompletedMatch = { winner: FighterId | null; finishReason: FinishReason; playerRoundWins: number; enemyRoundWins: number; remainingPlayerHP: number; maxPlayerCombo: number }
export type RoundSummary = { roundIndex: number; roundNumber: number; winner: FighterId | null; finishReason: FinishReason; playerHP: number; enemyHP: number; maxCombo: number; durationTicks: number }
export type MatchSnapshot = { matchState: MatchState; roundNumber: number; playerRoundWins: number; enemyRoundWins: number; remainingTicks: number; winner?: FighterId; finishReason?: FinishReason; drawRetries: number; maxPlayerCombo: number; world: CombatSnapshot }
export const p4SubStateFor = (remainingTicks: number, playerHP: number, maxHP: number, combo: number): P4SubState => remainingTicks <= 240 ? 'LAST_10_SECONDS' : playerHP <= maxHP * 0.25 ? 'DANGER' : combo >= 2 ? 'COMBO' : 'NORMAL'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }

export class MatchController {
  readonly world: CombatWorld
  readonly ai = new EnemyAI()
  private matchState: MatchState = 'READY'
  private roundNumber = 1
  private playerRoundWins = 0
  private enemyRoundWins = 0
  private remainingTicks = ROUND_TICKS
  private winner?: FighterId
  private finishReason?: FinishReason
  private drawRetries = 0
  private maxPlayerCombo = 0
  private roundMaxCombo = 0
  private roundWinner?: FighterId | null
  private readonly roundSummaries: RoundSummary[] = []
  private roundStartTick = 0

  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG) { this.world = new CombatWorld(config) }

  start(): void { this.resetMatch(); this.startRound() }
  resetMatch(): void { this.world.reset(); this.ai.reset(); this.matchState = 'READY'; this.roundNumber = 1; this.playerRoundWins = 0; this.enemyRoundWins = 0; this.remainingTicks = ROUND_TICKS; this.winner = undefined; this.finishReason = undefined; this.drawRetries = 0; this.maxPlayerCombo = 0; this.roundMaxCombo = 0; this.roundWinner = undefined; this.roundSummaries.length = 0; this.roundStartTick = 0 }
  tick(playerIntent: FighterIntent = neutral): void {
    if (this.matchState === 'ROUND_END') { this.startPendingRound(); return }
    if (this.matchState !== 'FIGHTING') return
    this.world.tick(playerIntent, this.ai.getIntent(this.world.getSnapshot())); this.remainingTicks -= 1; this.maxPlayerCombo = Math.max(this.maxPlayerCombo, this.world.getFighter('PLAYER').combo); this.roundMaxCombo = Math.max(this.roundMaxCombo, this.world.getFighter('PLAYER').combo)
    const player = this.world.getFighter('PLAYER'); const enemy = this.world.getFighter('ENEMY')
    if (player.currentHP === 0 || enemy.currentHP === 0) this.resolveRound(player.currentHP === enemy.currentHP ? null : player.currentHP > 0 ? 'PLAYER' : 'ENEMY', 'KO')
    else if (this.remainingTicks <= 0) this.resolveRound(player.currentHP === enemy.currentHP ? null : player.currentHP > enemy.currentHP ? 'PLAYER' : 'ENEMY', 'TIME_UP')
  }

  getSnapshot(): MatchSnapshot { return { matchState: this.matchState, roundNumber: this.roundNumber, playerRoundWins: this.playerRoundWins, enemyRoundWins: this.enemyRoundWins, remainingTicks: this.remainingTicks, winner: this.winner, finishReason: this.finishReason, drawRetries: this.drawRetries, maxPlayerCombo: this.maxPlayerCombo, world: this.world.getSnapshot() } }
  getCompletedMatch(): CompletedMatch | undefined {
    if (this.matchState !== 'MATCH_END' || !this.finishReason) return undefined
    return { winner: this.winner ?? null, finishReason: this.finishReason, playerRoundWins: this.playerRoundWins, enemyRoundWins: this.enemyRoundWins, remainingPlayerHP: this.world.getFighter('PLAYER').currentHP, maxPlayerCombo: this.maxPlayerCombo }
  }
  getRoundSummaries(): readonly RoundSummary[] { return this.roundSummaries.map((summary) => ({ ...summary })) }
  getP4SubState(): P4SubState { const snapshot = this.getSnapshot(); const player = snapshot.world.fighters.PLAYER; return p4SubStateFor(snapshot.remainingTicks, player.currentHP, this.world.getConfig().maxHp, player.combo) }

  private startRound(): void { this.world.reset(); this.ai.reset(); this.remainingTicks = ROUND_TICKS; this.roundStartTick = this.world.getSnapshot().tick; this.roundMaxCombo = 0; this.matchState = 'FIGHTING'; this.roundWinner = undefined }
  private startPendingRound(): void { if (this.matchState !== 'ROUND_END') return; if (this.roundWinner !== null && this.roundWinner !== undefined) this.roundNumber += 1; this.startRound() }
  private resolveRound(roundWinner: FighterId | null, reason: FinishReason): void {
    const player = this.world.getFighter('PLAYER'); const enemy = this.world.getFighter('ENEMY')
    this.roundSummaries.push({ roundIndex: this.roundSummaries.length + 1, roundNumber: this.roundNumber, winner: roundWinner, finishReason: reason, playerHP: player.currentHP, enemyHP: enemy.currentHP, maxCombo: this.roundMaxCombo, durationTicks: this.world.getSnapshot().tick - this.roundStartTick })
    this.matchState = 'ROUND_END'; this.roundWinner = roundWinner
    if (roundWinner === null) { this.drawRetries += 1; if (this.drawRetries > 2) { this.winner = undefined; this.finishReason = 'DRAW'; this.matchState = 'MATCH_END' }; return }
    this.drawRetries = 0; if (roundWinner === 'PLAYER') this.playerRoundWins += 1; else this.enemyRoundWins += 1
    if (this.playerRoundWins >= 2 || this.enemyRoundWins >= 2) { this.winner = roundWinner; this.finishReason = reason; this.matchState = 'MATCH_END' }
  }
}
