import { ApiError } from './ApiError'
import type { ErrorEnvelope, HealthResponse, LeaderboardEntry, Match, MatchCreate, MatchFinish, Player, RequestId, RoundCreate, Session } from './ApiTypes'

export type ApiClientOptions = { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch; maxRetries?: number; retryDelayMs?: number }

export class ApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 3000
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxRetries = options.maxRetries ?? 2
    this.retryDelayMs = options.retryDelayMs ?? 0
  }

  async health(): Promise<HealthResponse> { return this.request<HealthResponse>('/health') }
  async createPlayer(payload: { nickname: string; language: string } & RequestId): Promise<Player> { return this.request('/players', 'POST', payload) }
  async getPlayer(id: number): Promise<Player> { return this.request(`/players/${id}`) }
  async createSession(payload: { player_id: number; selected_character?: string } & RequestId): Promise<Session> { return this.request('/sessions', 'POST', payload) }
  async getSession(id: number): Promise<Session> { return this.request(`/sessions/${id}`) }
  async currentSession(): Promise<Session> { return this.request('/sessions/current') }
  async updateSession(id: number, payload: { selected_character?: string | null } & RequestId): Promise<Session> { return this.request(`/sessions/${id}`, 'PATCH', payload) }
  async finishSession(id: number, payload: RequestId): Promise<Session> { return this.request(`/sessions/${id}/finish`, 'POST', payload) }
  async activateNext(payload: RequestId): Promise<Session> { return this.request('/queue/activate-next', 'POST', payload) }
  async queue(): Promise<Session[]> { return this.request('/queue') }
  async createMatch(payload: MatchCreate): Promise<Match> { return this.request('/matches', 'POST', payload) }
  async getMatch(id: number): Promise<Match> { return this.request(`/matches/${id}`) }
  async addRound(matchId: number, payload: RoundCreate): Promise<RoundCreate & { id: number; match_id: number }> { return this.request(`/matches/${matchId}/rounds`, 'POST', payload) }
  async finishMatch(matchId: number, payload: MatchFinish): Promise<Match> { return this.request(`/matches/${matchId}/finish`, 'POST', payload) }
  async leaderboard(limit = 20): Promise<LeaderboardEntry[]> { return this.request(`/leaderboard?limit=${limit}`) }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.requestOnce<T>(path, method, body) }
      catch (error) {
        const retryable = error instanceof ApiError && error.retryable
        if (!retryable || attempt >= this.maxRetries) throw error
        if (this.retryDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs))
      }
    }
  }

  private async requestOnce<T>(path: string, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try { response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, signal: controller.signal, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }) }
      catch (error) { throw new ApiError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 0, controller.signal.aborted ? 'Request timed out' : 'Network request failed', error, true) }
      const payload: unknown = await response.json().catch(() => { throw new ApiError('INVALID_RESPONSE', response.status, 'Response was not JSON', {}, response.status >= 502) })
      if (!response.ok) {
        const error = (payload as Partial<ErrorEnvelope>).error
        throw new ApiError(error?.code ?? 'HTTP_ERROR', response.status, error?.message ?? `HTTP ${response.status}`, error?.details ?? {}, response.status === 502 || response.status === 503 || response.status === 504)
      }
      return payload as T
    } finally { clearTimeout(timeout) }
  }
}
