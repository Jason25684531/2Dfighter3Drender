import { describe, expect, it } from 'vitest'
import { ApiClient } from '../api/ApiClient'
import { ExperienceContext } from '../app/ExperienceContext'
import { ExperiencePersistence } from '../app/ExperiencePersistence'

const api = new ApiClient({ baseUrl: import.meta.env.VITE_SYSTEM_API_BASE_URL, timeoutMs: 2000 })

describe('D8 backend system flow', () => {
  it('persists a match, keeps replay history, ranks the best session match, and closes the session', async () => {
    const suffix = `${Date.now()}`
    const player = await api.createPlayer({ nickname: 'SYSTEM', language: 'en', client_request_id: `${suffix}:player` })
    const session = await api.createSession({ player_id: player.id, client_request_id: `${suffix}:session` })
    const active = await api.activateNext({ client_request_id: `${suffix}:activate` })
    expect(active.id).toBe(session.id)

    const first = await api.createMatch({ session_id: session.id, client_request_id: `${suffix}:match:1` })
    await api.addRound(first.id, { round_index: 1, round_number: 1, winner: 'PLAYER', finish_reason: 'KO', player_hp: 50, enemy_hp: 0, max_combo: 3, duration_ticks: 12, client_request_id: `${suffix}:round:1` })
    const firstFinished = await api.finishMatch(first.id, { outcome: 'WIN', finish_reason: 'KO', player_round_wins: 2, enemy_round_wins: 0, remaining_hp: 50, max_combo: 3, client_score: 1850, client_title: 'COMBO CONTENDER', finish_request_id: `${suffix}:finish:1` })
    expect(firstFinished.status).toBe('FINISHED')

    const replay = await api.createMatch({ session_id: session.id, client_request_id: `${suffix}:match:2` })
    expect(replay.match_number).toBe(2)
    await api.finishMatch(replay.id, { outcome: 'WIN', finish_reason: 'KO', player_round_wins: 2, enemy_round_wins: 0, remaining_hp: 80, max_combo: 3, client_score: 1880, client_title: 'UNTOUCHABLE', finish_request_id: `${suffix}:finish:2` })
    const entries = await api.leaderboard()
    expect(entries.filter((entry) => entry.session_id === session.id)).toHaveLength(1)
    expect(entries.find((entry) => entry.session_id === session.id)?.match_id).toBe(replay.id)
    expect((await api.getMatch(first.id)).status).toBe('FINISHED')
    expect((await api.finishSession(session.id, { client_request_id: `${suffix}:session:finish` })).status).toBe('FINISHED')
    const nextPlayer = await api.createPlayer({ nickname: 'NEXT', language: 'en', client_request_id: `${suffix}:next:player` })
    const nextSession = await api.createSession({ player_id: nextPlayer.id, client_request_id: `${suffix}:next:session` })
    expect((await api.activateNext({ client_request_id: `${suffix}:next:activate` })).id).toBe(nextSession.id)
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    const saved = new ExperienceContext(); saved.set({ playerId: nextPlayer.id, sessionId: nextSession.id, sessionStatus: 'ACTIVE' }); saved.serialize(storage)
    const restored = new ExperienceContext(); const persistence = new ExperiencePersistence(api, restored, storage); await persistence.restoreSession()
    expect(restored.snapshot).toMatchObject({ playerId: nextPlayer.id, sessionId: nextSession.id, sessionStatus: 'ACTIVE' })
    expect((await api.getMatch(replay.id)).status).toBe('FINISHED')
  })
})
