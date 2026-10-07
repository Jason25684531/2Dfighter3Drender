import { ApiClient } from '../api/ApiClient'
import { ApiError } from '../api/ApiError'
import type { Match, RoundCreate } from '../api/ApiTypes'
import { p6SubStateForRank, type MatchResult, type P6SubState } from '../match/ResultResolver'
import type { RoundSummary } from '../match/MatchController'
import { ExperienceContext, type StorageLike } from './ExperienceContext'

type PendingOperation = { key: string; run: () => Promise<void> }
const id = (prefix: string): string => `${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}:${prefix}`

export class ExperiencePersistence {
  private attemptId?: string
  private finishRequestId?: string
  private sessionFinishRequestId?: string
  private playerRequestId?: string
  private sessionRequestId?: string
  private queueRequestId?: string
  private sentRounds = new Set<number>()
  private pending: PendingOperation[] = []
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly api: ApiClient, readonly context = new ExperienceContext(), private readonly storage?: StorageLike) {}

  async ensureSession(): Promise<void> {
    const known = this.context.snapshot.sessionId
    if (known) {
      try {
        const session = await this.api.getSession(known)
        if (session.status === 'ACTIVE' || session.status === 'QUEUED') { this.context.set({ sessionStatus: session.status }); this.persist(); return }
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
      }
      this.clear()
    }
    this.playerRequestId ??= id('player:create'); this.sessionRequestId ??= id('session:create'); this.queueRequestId ??= id('queue:activate')
    const player = await this.api.createPlayer({ nickname: 'PLAYER', language: 'zh-TW', client_request_id: this.playerRequestId })
    await this.api.createSession({ player_id: player.id, client_request_id: this.sessionRequestId })
    const active = await this.api.activateNext({ client_request_id: this.queueRequestId })
    this.context.set({ playerId: player.id, sessionId: active.id, sessionStatus: active.status, persistence: 'SAVED' }); this.persist()
  }

  async restoreSession(): Promise<void> {
    if (!this.storage) return
    this.context.restore(this.storage)
    if (!this.context.snapshot.sessionId) return
    try { await this.ensureSession() } catch { this.clear() }
  }

  beginMatch(): Promise<void> {
    if (this.attemptId && (this.context.snapshot.matchId !== undefined || this.pending.some((operation) => operation.key === `match:${this.attemptId}`))) return Promise.resolve()
    this.attemptId = id('attempt').split(':')[0]
    this.finishRequestId = undefined; this.sentRounds.clear()
    const sessionId = this.context.snapshot.sessionId
    if (!sessionId) return Promise.resolve()
    const requestId = `${this.attemptId}:create`
    return this.enqueue({ key: `match:${this.attemptId}`, run: async () => {
      this.context.set({ persistence: 'SAVING' })
      const match = await this.api.createMatch({ session_id: sessionId, client_request_id: requestId })
      this.context.set({ matchId: match.id, persistence: 'SAVED' }); this.persist()
    }})
  }

  updateSession(selectedCharacter: string | null): Promise<void> {
    const sessionId = this.context.snapshot.sessionId
    if (!sessionId) return Promise.resolve()
    const requestId = `${this.sessionRequestId ?? String(sessionId)}:update`
    return this.enqueue({ key: `session-update:${sessionId}`, run: async () => { await this.api.updateSession(sessionId, { selected_character: selectedCharacter, client_request_id: requestId }); this.persist() } })
  }

  recordRounds(summaries: readonly RoundSummary[]): Promise<void> {
    const attemptId = this.attemptId
    if (!attemptId) return Promise.resolve()
    const newSummaries = summaries.filter((summary) => !this.sentRounds.has(summary.roundIndex))
    if (newSummaries.length === 0) return Promise.resolve()
    return this.enqueue({ key: `rounds:${attemptId}:${newSummaries.map((summary) => summary.roundIndex).join(',')}`, run: async () => {
      const matchId = this.context.snapshot.matchId
      if (!matchId) throw new Error('Match has not been persisted')
      for (const summary of newSummaries) {
        const payload: RoundCreate = {
          round_index: summary.roundIndex, round_number: summary.roundNumber, winner: summary.winner,
          finish_reason: summary.finishReason, player_hp: summary.playerHP, enemy_hp: summary.enemyHP,
          max_combo: summary.maxCombo, duration_ticks: summary.durationTicks, client_request_id: `${attemptId}:round:${summary.roundIndex}`,
        }
        await this.api.addRound(matchId, payload); this.sentRounds.add(summary.roundIndex)
      }
      this.context.set({ persistence: 'SAVED' }); this.persist()
    }})
  }

  finishMatch(result: MatchResult): Promise<Match | undefined> {
    const matchId = this.context.snapshot.matchId
    const attemptId = this.attemptId
    if (!matchId || !attemptId) return Promise.resolve(undefined)
    const finishRequestId = this.finishRequestId ?? `${attemptId}:finish`; this.finishRequestId = finishRequestId
    let persisted: Match | undefined
    return this.enqueue({ key: `finish:${attemptId}`, run: async () => {
      this.context.set({ persistence: 'SAVING' })
      persisted = await this.api.finishMatch(matchId, {
        outcome: result.outcome, finish_reason: result.finishReason, player_round_wins: result.playerRoundWins,
        enemy_round_wins: result.enemyRoundWins, remaining_hp: result.remainingPlayerHP, max_combo: result.maxPlayerCombo,
        client_score: result.score, client_title: result.title, finish_request_id: finishRequestId,
      })
      this.context.set({ persistence: 'SAVED', backendRank: persisted.rank }); this.persist()
    }}).then(() => persisted)
  }

  finishSession(): Promise<void> {
    const sessionId = this.context.snapshot.sessionId
    if (!sessionId) { this.clear(); return Promise.resolve() }
    const requestId = this.sessionFinishRequestId ?? id('session:finish'); this.sessionFinishRequestId = requestId
    return this.enqueue({ key: `session-finish:${sessionId}`, run: async () => { await this.api.finishSession(sessionId, { client_request_id: requestId }); this.clear() } })
  }

  async retryPending(): Promise<void> {
    const pending = [...this.pending]
    for (const operation of pending) {
      try { await operation.run(); this.pending = this.pending.filter((item) => item !== operation) }
      catch { this.context.set({ persistence: 'ERROR' }); this.persist() }
    }
    if (this.pending.length === 0 && this.context.snapshot.persistence === 'ERROR') { this.context.set({ persistence: 'SAVED' }); this.persist() }
  }

  p6SubState(): P6SubState { return p6SubStateForRank(this.context.snapshot.backendRank) }
  resetMatch(): void { this.context.set({ matchId: undefined, backendRank: undefined, persistence: 'IDLE' }); this.attemptId = undefined; this.finishRequestId = undefined; this.sentRounds.clear(); this.pending = this.pending.filter((operation) => !operation.key.startsWith('match:') && !operation.key.startsWith('rounds:') && !operation.key.startsWith('finish:')) }
  clear(): void { this.storage ? this.context.remove(this.storage) : this.context.clear(); this.attemptId = undefined; this.finishRequestId = undefined; this.sessionFinishRequestId = undefined; this.playerRequestId = undefined; this.sessionRequestId = undefined; this.queueRequestId = undefined; this.sentRounds.clear(); this.pending = [] }

  private enqueue(operation: PendingOperation): Promise<void> {
    this.pending.push(operation)
    this.chain = this.chain.then(async () => {
      try { await operation.run(); this.pending = this.pending.filter((item) => item !== operation) }
      catch (error) { this.context.set({ persistence: 'ERROR' }); this.persist(); throw error }
    }).catch(() => undefined)
    return this.chain
  }

  private persist(): void { if (this.storage) this.context.serialize(this.storage) }
}
