export type ErrorEnvelope = { error: { code: string; message: string; details?: unknown } }
export type HealthResponse = { status: 'ok'; database: 'ok' }
export type Player = { id: number; nickname: string; language: string; created_at: string }
export type SessionStatus = 'QUEUED' | 'ACTIVE' | 'FINISHED' | 'CANCELLED'
export type Session = { id: number; player_id: number; status: SessionStatus; selected_character: string | null; queue_position: number | null }
export type RequestId = { client_request_id: string }
export type MatchStatus = 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED'
export type Match = {
  id: number; session_id: number; match_number: number; status: MatchStatus; result: 'WIN' | 'LOSE' | 'DRAW' | null
  finish_reason: string | null; player_round_wins: number | null; enemy_round_wins: number | null
  remaining_hp: number | null; max_combo: number | null; score: number | null; title: string | null; rank: number | null
  client_request_id: string; finish_request_id: string | null; created_at: string; finished_at: string | null; rounds: Round[]
}
export type Round = { id: number; match_id: number; round_index: number; round_number: number; winner: 'PLAYER' | 'ENEMY' | null; finish_reason: string; player_hp: number; enemy_hp: number; max_combo: number; duration_ticks: number; client_request_id: string }
export type MatchCreate = { session_id: number } & RequestId
export type RoundCreate = Omit<Round, 'id' | 'match_id' | 'client_request_id'> & RequestId
export type MatchFinish = { outcome: 'WIN' | 'LOSE' | 'DRAW'; finish_reason: string; player_round_wins: number; enemy_round_wins: number; remaining_hp: number; max_combo: number; client_score: number; client_title: string; finish_request_id: string }
export type LeaderboardEntry = { rank: number; match_id: number; session_id: number; nickname: string; score: number; title: string; remaining_hp: number; max_combo: number; finished_at: string }
