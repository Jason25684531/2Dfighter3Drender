import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/ApiClient'
import type { Match, Round, Session } from '../api/ApiTypes'
import { resolveMatchResult } from '../match/ResultResolver'
import { ExperienceContext } from './ExperienceContext'
import { ExperiencePersistence } from './ExperiencePersistence'

const match = (id: number, rank: number | null = null): Match => ({ id, session_id: 1, match_number: 1, status: 'IN_PROGRESS', result: null, finish_reason: null, player_round_wins: null, enemy_round_wins: null, remaining_hp: null, max_combo: null, score: null, title: null, rank, client_request_id: 'match', finish_request_id: null, created_at: '', finished_at: null, rounds: [] })
const fakeSession: Session = { id: 1, player_id: 1, status: 'ACTIVE', selected_character: null, queue_position: null }

describe('ExperiencePersistence', () => {
  it('sends one match and one request per round, then stores backend rank', async () => {
    const api = { createMatch: vi.fn().mockResolvedValue(match(9)), addRound: vi.fn().mockResolvedValue({} as Round), finishMatch: vi.fn().mockResolvedValue({ ...match(9, 7), status: 'FINISHED' } as Match), getSession: vi.fn().mockResolvedValue(fakeSession) } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    await persistence.beginMatch(); expect(api.createMatch).toHaveBeenCalledTimes(1); expect(context.snapshot.matchId).toBe(9)
    const summary = { roundIndex: 1, roundNumber: 1, winner: 'PLAYER' as const, finishReason: 'KO' as const, playerHP: 80, enemyHP: 0, maxCombo: 3, durationTicks: 12 }
    await persistence.recordRounds([summary]); await persistence.recordRounds([summary]); expect(api.addRound).toHaveBeenCalledTimes(1)
    const result = resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 80, maxPlayerCombo: 3 })
    await persistence.finishMatch(result); expect(api.finishMatch).toHaveBeenCalledTimes(1); expect(context.snapshot).toMatchObject({ backendRank: 7, persistence: 'SAVED' }); expect(persistence.p6SubState()).toBe('RANK_7_TO_19')
  })

  it('keeps failed operations and retries them with the same request payload', async () => {
    const createMatch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(match(3))
    const api = { createMatch, addRound: vi.fn(), finishMatch: vi.fn(), getSession: vi.fn() } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    await persistence.beginMatch(); expect(context.snapshot.persistence).toBe('ERROR'); await persistence.retryPending(); expect(createMatch).toHaveBeenCalledTimes(2); expect(context.snapshot.matchId).toBe(3); expect(context.snapshot.persistence).toBe('SAVED')
  })
})
