import { AppState, type AppState as AppStateValue } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { UIFramework } from '../ui/UIFramework'
import { NEUTRAL_INTENT, type FighterIntent } from '../combat/CombatWorld'
import { MatchController } from '../match/MatchController'
import { p6SubStateForRank, resolveMatchResult, type MatchResult } from '../match/ResultResolver'
import { resolveAiProfile } from '../config/aiProfiles'
import type { LeaderboardEntry } from '../api/ApiTypes'
import type { PlayerSlotId } from '../input/InputManager'
import type { OpponentChoice } from '../select/P1SelectionModel'
import type { ExperiencePersistence } from './ExperiencePersistence'
import type { PlayerSelection } from './ExperienceContext'

/** P0–P7 轉移副作用與對戰推進的唯一實作；AppScene 只呈現，測試直接驅動本類別。 */
export class ExperienceFlow {
  players: Partial<Record<PlayerSlotId, PlayerSelection>>
  opponent?: OpponentChoice
  result?: MatchResult
  leaderboard: LeaderboardEntry[] = []
  nextPlayerName?: string
  onOffline?: () => void
  onResultStored?: () => void

  constructor(readonly app = new AppStateMachine(), readonly ui = new UIFramework(app), readonly match = new MatchController(), readonly persistence?: ExperiencePersistence) {
    this.players = persistence?.context.snapshot.players ?? {}
    app.subscribe(({ nextState }) => this.onTransition(nextState))
  }

  setPlayers(players: Partial<Record<PlayerSlotId, PlayerSelection>>): void {
    this.players = players; this.persistence?.context.set({ players })
    void this.persistence?.updateSession(players.P1?.characterId ?? null).catch(() => undefined)
  }

  async refreshLeaderboard(): Promise<void> { if (this.persistence) this.leaderboard = await this.persistence.leaderboard() }

  /** 2P 已加入時 ENEMY 只吃 p2Intent（沒輸入＝中立），不使用 AI。 */
  tick(intent: FighterIntent = NEUTRAL_INTENT, p2Intent: FighterIntent = NEUTRAL_INTENT): void {
    if (this.app.getCurrentState() !== AppState.BATTLE) return
    const persistence = this.persistence
    this.match.tick(intent, this.players.P2 ? p2Intent : undefined); void persistence?.recordRounds(this.match.getRoundSummaries()).catch(() => undefined)
    this.ui.substates.set(AppState.BATTLE, this.match.getP4SubState())
    const completed = this.match.getCompletedMatch()
    if (!completed || this.result) return
    this.result = resolveMatchResult(completed)
    void persistence?.finishMatch(this.result).then(async (stored) => {
      this.ui.substates.set(AppState.RESULT, p6SubStateForRank(stored?.rank ?? persistence.context.snapshot.backendRank))
      this.leaderboard = await persistence.leaderboard(); this.nextPlayerName = await persistence.nextQueuedPlayer()
      this.onResultStored?.()
    }).catch(() => undefined)
    this.app.transitionTo(AppState.PRESENTATION)
  }

  private onTransition(next: AppStateValue): void {
    const persistence = this.persistence
    // 進 P1 建立 session；若建立完成前已回 P0，補結束。
    if (next === AppState.READY) void persistence?.ensureSession().then(() => { if (this.app.getCurrentState() === AppState.IDLE) return persistence.finishSession() }).catch(() => this.onOffline?.())
    // 任何畫面回 P0 都結束 session；後端會把未完成的對戰標為 ABANDONED。
    if (next === AppState.IDLE) void persistence?.finishSession().catch(() => undefined)
    if (next === AppState.BATTLE) { if (!this.players.P2) this.match.setAiProfile(resolveAiProfile(this.opponent?.difficulty)); this.match.start(); void persistence?.beginMatch().catch(() => undefined) }
    if (next === AppState.SETUP || next === AppState.IDLE) { this.match.resetMatch(); persistence?.resetMatch(); this.result = undefined; this.nextPlayerName = undefined }
    if (next === AppState.IDLE) { this.players = {}; this.opponent = undefined }
  }
}
