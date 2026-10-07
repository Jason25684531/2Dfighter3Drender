CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  nickname TEXT NOT NULL,
  language TEXT NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','ACTIVE','FINISHED','CANCELLED')),
  selected_character TEXT,
  client_request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(status) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  match_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('IN_PROGRESS','FINISHED','ABANDONED')),
  result TEXT CHECK(result IN ('WIN','LOSE','DRAW')),
  finish_reason TEXT,
  player_round_wins INTEGER,
  enemy_round_wins INTEGER,
  remaining_hp INTEGER,
  max_combo INTEGER,
  score INTEGER,
  title TEXT,
  rank INTEGER,
  client_request_id TEXT NOT NULL UNIQUE,
  finish_request_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(session_id, match_number)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  round_index INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  winner TEXT CHECK(winner IN ('PLAYER','ENEMY') OR winner IS NULL),
  finish_reason TEXT NOT NULL,
  player_hp INTEGER NOT NULL,
  enemy_hp INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  duration_ticks INTEGER NOT NULL,
  client_request_id TEXT NOT NULL UNIQUE,
  UNIQUE(match_id, round_index)
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_matches_session ON matches(session_id);
CREATE INDEX IF NOT EXISTS idx_matches_score ON matches(score);
CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at);
CREATE INDEX IF NOT EXISTS idx_rounds_match ON rounds(match_id);

-- Small durable ledger for mutations that do not have a resource-level
-- request-id column (session updates/transitions and queue activation).
CREATE TABLE IF NOT EXISTS mutation_requests (
  operation TEXT NOT NULL,
  target TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY(operation, target, request_id)
);
