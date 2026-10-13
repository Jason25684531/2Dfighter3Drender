import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { UIFramework } from '../ui/UIFramework'
import { type FighterIntent } from '../combat/CombatWorld'
import { MatchController } from '../match/MatchController'
import { p6SubStateForRank, resolveMatchResult, type MatchResult } from '../match/ResultResolver'
import type { ExperiencePersistence } from './ExperiencePersistence'

const neutral: FighterIntent = { moveX: 0, jumpPressed: false, attackPressed: false, guardHeld: false }

export class OfflineExperienceHarness {
  readonly app = new AppStateMachine()
  readonly ui = new UIFramework(this.app)
  readonly match = new MatchController()
  result?: MatchResult
  constructor(private readonly persistence?: ExperiencePersistence) {}

  start(): void {
    this.app.transitionTo(AppState.READY)
    void this.persistence?.ensureSession().catch(() => this.ui.substates.set(AppState.READY, 'FALLBACK'))
    ;[AppState.SETUP, AppState.LOADING, AppState.BATTLE].forEach((state) => this.app.transitionTo(state)); this.match.start(); void this.persistence?.beginMatch().catch(() => undefined)
  }
  tick(intent: FighterIntent = neutral): void {
    if (this.app.getCurrentState() !== AppState.BATTLE) return
    this.match.tick(intent); void this.persistence?.recordRounds(this.match.getRoundSummaries()).catch(() => undefined)
    const completed = this.match.getCompletedMatch()
    if (completed && !this.result) {
      this.result = resolveMatchResult(completed)
      void this.persistence?.finishMatch(this.result).then((stored) => { this.ui.substates.set(AppState.RESULT, p6SubStateForRank(stored?.rank ?? this.persistence?.context.snapshot.backendRank)); }).catch(() => undefined)
      this.app.transitionTo(AppState.PRESENTATION); this.app.transitionTo(AppState.RESULT); this.app.transitionTo(AppState.END)
    }
  }
  replay(): boolean { if (this.app.getCurrentState() !== AppState.END) return false; this.match.resetMatch(); this.result = undefined; this.persistence?.resetMatch(); return this.app.transitionTo(AppState.SETUP) }
  finish(): boolean { if (this.app.getCurrentState() !== AppState.END) return false; void this.persistence?.finishSession().catch(() => undefined); this.match.resetMatch(); this.result = undefined; return this.app.transitionTo(AppState.IDLE) }
}
