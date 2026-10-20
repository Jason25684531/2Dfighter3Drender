import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/ApiClient'
import type { Match, Round, Session } from '../api/ApiTypes'
import { resolveMatchResult } from '../match/ResultResolver'
import { ExperienceContext } from './ExperienceContext'
import { ExperiencePersistence } from './ExperiencePersistence'

const match = (id: number, rank: number | null = null): Match => ({ id, session_id: 1, match_number: 1, status: 'IN_PROGRESS', result: null, finish_reason: null, player_round_wins: null, enemy_round_wins: null, remaining_hp: null, max_combo: null, score: null, title: null, rank, client_request_id: 'match', finish_request_id: null, created_at: '', finished_at: null, rounds: [] })
const fakeSession: Session = { id: 1, player_id: 1, status: 'ACTIVE', selected_character: null, queue_position: null }

describe('ExperiencePersistence', () => {
  it('reports connection status from the existing leaderboard request', async () => {
    const leaderboard = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const persistence = new ExperiencePersistence({ leaderboard } as unknown as ApiClient)
    expect(persistence.lastLeaderboardOk).toBeUndefined()
    await persistence.leaderboard(); expect(persistence.lastLeaderboardOk).toBe(true)
    expect(await persistence.leaderboard()).toEqual([]); expect(persistence.lastLeaderboardOk).toBe(false)
    await persistence.leaderboard(); expect(persistence.lastLeaderboardOk).toBe(true); expect(leaderboard).toHaveBeenCalledTimes(3)
  })
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
    await expect(persistence.beginMatch()).rejects.toThrow('offline'); expect(context.snapshot.persistence).toBe('ERROR'); await persistence.retryPending(); expect(createMatch).toHaveBeenCalledTimes(2); expect(context.snapshot.matchId).toBe(3); expect(context.snapshot.persistence).toBe('SAVED')
  })

  it('coalesces session setup and creates one match after a delayed session', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const api = { createPlayer: vi.fn(async () => { await gate; return { id: 1 } }), createSession: vi.fn().mockResolvedValue(fakeSession), activateNext: vi.fn().mockResolvedValue(fakeSession), createMatch: vi.fn().mockResolvedValue(match(9)) } as unknown as ApiClient
    const persistence = new ExperiencePersistence(api)
    const first = persistence.ensureSession(); const second = persistence.ensureSession(); const attempt = persistence.beginMatch(); const duplicate = persistence.beginMatch()
    expect(first).toBe(second); expect(attempt).toBe(duplicate); expect(api.createMatch).not.toHaveBeenCalled()
    release(); await Promise.all([first, attempt])
    expect(api.createPlayer).toHaveBeenCalledTimes(1); expect(api.createMatch).toHaveBeenCalledTimes(1)
  })

  it('keeps a fast P4 attempt when an old session proves stale', async () => {
    let release!: (value: Session) => void
    const oldSession = new Promise<Session>((resolve) => { release = resolve })
    const api = { getSession: vi.fn().mockReturnValue(oldSession), createPlayer: vi.fn().mockResolvedValue({ id: 2 }), createSession: vi.fn().mockResolvedValue({ ...fakeSession, id: 2 }), activateNext: vi.fn().mockResolvedValue({ ...fakeSession, id: 2 }), createMatch: vi.fn().mockResolvedValue(match(11)) } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    const session = persistence.ensureSession(); const attempt = persistence.beginMatch()
    release({ ...fakeSession, status: 'FINISHED' }); await Promise.all([session, attempt])
    expect(api.createMatch).toHaveBeenCalledTimes(1); expect(api.createMatch).toHaveBeenCalledWith(expect.objectContaining({ session_id: 2 }))
    expect(context.snapshot.matchId).toBe(11)
  })

  it('queues each round once and finishes after delayed match creation', async () => {
    let release!: (value: Match) => void
    const gate = new Promise<Match>((resolve) => { release = resolve })
    const api = { createMatch: vi.fn().mockReturnValue(gate), addRound: vi.fn().mockResolvedValue({} as Round), finishMatch: vi.fn().mockResolvedValue({ ...match(9, 3), status: 'FINISHED' } as Match) } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    const created = persistence.beginMatch()
    const summary = { roundIndex: 1, roundNumber: 1, winner: 'PLAYER' as const, finishReason: 'KO' as const, playerHP: 80, enemyHP: 0, maxCombo: 3, durationTicks: 12 }
    const round = persistence.recordRounds([summary]); await persistence.recordRounds([summary])
    const result = resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 80, maxPlayerCombo: 3 })
    const finished = persistence.finishMatch(result)
    expect(api.addRound).not.toHaveBeenCalled(); expect(api.finishMatch).not.toHaveBeenCalled()
    release(match(9)); await Promise.all([created, round, finished])
    expect(api.addRound).toHaveBeenCalledTimes(1); expect(api.finishMatch).toHaveBeenCalledTimes(1)
    expect(api.finishMatch).toHaveBeenCalledWith(9, expect.anything()); expect(context.snapshot.backendRank).toBe(3)
  })

  it('reports failed finish and retries without inventing a saved rank', async () => {
    const finishMatch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...match(9, 5), status: 'FINISHED' } as Match)
    const api = { createMatch: vi.fn().mockResolvedValue(match(9)), finishMatch } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    await persistence.beginMatch()
    const result = resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 80, maxPlayerCombo: 3 })
    await expect(persistence.finishMatch(result)).rejects.toThrow('offline')
    expect(context.snapshot.persistence).toBe('ERROR'); expect(context.snapshot.backendRank).toBeUndefined()
    await persistence.retryPending()
    expect(finishMatch).toHaveBeenCalledTimes(2)
    expect(finishMatch.mock.calls[0][1].finish_request_id).toBe(finishMatch.mock.calls[1][1].finish_request_id)
    expect(context.snapshot).toMatchObject({ persistence: 'SAVED', backendRank: 5 })
  })

  it('holds finish until a failed round is retried', async () => {
    const addRound = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({} as Round)
    const finishMatch = vi.fn().mockResolvedValue({ ...match(9, 4), status: 'FINISHED' } as Match)
    const api = { createMatch: vi.fn().mockResolvedValue(match(9)), addRound, finishMatch } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    await persistence.beginMatch()
    const summary = { roundIndex: 1, roundNumber: 1, winner: 'PLAYER' as const, finishReason: 'KO' as const, playerHP: 80, enemyHP: 0, maxCombo: 3, durationTicks: 12 }
    const failedRound = persistence.recordRounds([summary])
    const result = resolveMatchResult({ winner: 'PLAYER', finishReason: 'KO', playerRoundWins: 2, enemyRoundWins: 0, remainingPlayerHP: 80, maxPlayerCombo: 3 })
    const heldFinish = persistence.finishMatch(result)
    await expect(failedRound).rejects.toThrow('offline'); await expect(heldFinish).rejects.toThrow('Earlier match writes are pending')
    expect(finishMatch).not.toHaveBeenCalled()
    await persistence.retryPending()
    expect(addRound).toHaveBeenCalledTimes(2); expect(finishMatch).toHaveBeenCalledTimes(1)
    expect(context.snapshot.backendRank).toBe(4)
  })

  it('creates a new match for replay and ignores a late old creation', async () => {
    let release!: (value: Match) => void
    const first = new Promise<Match>((resolve) => { release = resolve })
    const createMatch = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(match(10))
    const api = { createMatch } as unknown as ApiClient
    const context = new ExperienceContext(); context.set({ sessionId: 1, sessionStatus: 'ACTIVE' })
    const persistence = new ExperiencePersistence(api, context)
    const abandoned = persistence.beginMatch()
    await Promise.resolve()
    persistence.resetMatch()
    const replay = persistence.beginMatch()
    release(match(9)); await Promise.all([abandoned, replay])
    expect(createMatch).toHaveBeenCalledTimes(2)
    expect(context.snapshot.matchId).toBe(10)
    expect(createMatch.mock.calls[0][0].client_request_id).not.toBe(createMatch.mock.calls[1][0].client_request_id)
  })

  it('projects the first queued player without blocking offline P7', async () => {
    const queue = vi.fn().mockResolvedValue([{ ...fakeSession, id: 2, player_id: 7, status: 'QUEUED' }])
    const getPlayer = vi.fn().mockResolvedValue({ nickname: 'NEXT' })
    const api = { queue, getPlayer } as unknown as ApiClient
    const persistence = new ExperiencePersistence(api)
    await expect(persistence.nextQueuedPlayer()).resolves.toBe('NEXT')
    queue.mockRejectedValue(new Error('offline'))
    await expect(persistence.nextQueuedPlayer()).resolves.toBeUndefined()
  })
})
