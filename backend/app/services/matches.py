import sqlite3

from app.db import transaction
from app.errors import ApiError
from app.scoring import score_and_title
from app.services import leaderboard
from app.services.common import conflict, item, now


def _match(connection: sqlite3.Connection, match_id: int) -> dict:
    row = connection.execute('SELECT * FROM matches WHERE id=?', (match_id,)).fetchone()
    if not row: raise ApiError('MATCH_NOT_FOUND', 404, f'Match {match_id} not found')
    result = item(row); result['rounds'] = [item(round_) for round_ in connection.execute('SELECT * FROM rounds WHERE match_id=? ORDER BY round_index', (match_id,))]
    return result


def create(connection: sqlite3.Connection, session_id: int, request_id: str) -> tuple[dict, bool]:
    existing = connection.execute('SELECT id, session_id FROM matches WHERE client_request_id=?', (request_id,)).fetchone()
    if existing:
        if existing['session_id'] != session_id: conflict()
        return _match(connection, existing['id']), False
    with transaction(connection):
        session = connection.execute('SELECT status FROM sessions WHERE id=?', (session_id,)).fetchone()
        if not session: raise ApiError('SESSION_NOT_FOUND', 404, f'Session {session_id} not found')
        if session['status'] != 'ACTIVE': raise ApiError('INVALID_SESSION_STATE', 409, 'Session is not active')
        connection.execute("UPDATE matches SET status='ABANDONED' WHERE session_id=? AND status='IN_PROGRESS'", (session_id,))
        number = connection.execute('SELECT COUNT(*) FROM matches WHERE session_id=?', (session_id,)).fetchone()[0] + 1
        cursor = connection.execute("INSERT INTO matches(session_id,match_number,status,client_request_id,created_at) VALUES(?,?, 'IN_PROGRESS', ?, ?)", (session_id, number, request_id, now()))
    return _match(connection, cursor.lastrowid), True


def add_round(connection: sqlite3.Connection, match_id: int, payload: dict) -> tuple[dict, bool]:
    existing = connection.execute('SELECT * FROM rounds WHERE client_request_id=?', (payload['client_request_id'],)).fetchone()
    if existing:
        fields = ('round_index', 'round_number', 'winner', 'finish_reason', 'player_hp', 'enemy_hp', 'max_combo', 'duration_ticks')
        if existing['match_id'] != match_id or any(existing[field] != payload[field] for field in fields): conflict()
        return item(existing), False
    with transaction(connection):
        match = _match(connection, match_id)
        if match['status'] != 'IN_PROGRESS': raise ApiError('INVALID_MATCH_STATE', 409, 'Match is not in progress')
        if payload['round_index'] < 1 or payload['round_number'] < 1 or payload['player_hp'] < 0 or payload['player_hp'] > 100 or payload['enemy_hp'] < 0 or payload['enemy_hp'] > 100 or payload['max_combo'] < 0 or payload['duration_ticks'] < 0:
            raise ApiError('VALIDATION_ERROR', 400, 'Invalid round summary')
        duplicate = connection.execute('SELECT * FROM rounds WHERE match_id=? AND round_index=?', (match_id, payload['round_index'])).fetchone()
        if duplicate: conflict('Round index already exists for this match')
        try:
            cursor = connection.execute('''INSERT INTO rounds(match_id,round_index,round_number,winner,finish_reason,player_hp,enemy_hp,max_combo,duration_ticks,client_request_id)
              VALUES(:match_id,:round_index,:round_number,:winner,:finish_reason,:player_hp,:enemy_hp,:max_combo,:duration_ticks,:client_request_id)''', {**payload, 'match_id': match_id})
        except sqlite3.IntegrityError as error: raise ApiError('IDEMPOTENCY_CONFLICT', 409, 'Round conflicts with existing record') from error
        result = item(connection.execute('SELECT * FROM rounds WHERE id=?', (cursor.lastrowid,)).fetchone())
    return result, True


def _finish_payload_matches(match: dict, payload: dict, score: int, title: str) -> bool:
    return match.get('result') == payload.get('outcome') and all(match.get(field) == payload.get(field) for field in ('finish_reason', 'player_round_wins', 'enemy_round_wins', 'remaining_hp', 'max_combo')) and match.get('score') == score and match.get('title') == title and payload.get('client_score') == score and payload.get('client_title') == title


def finish(connection: sqlite3.Connection, match_id: int, payload: dict) -> dict:
    with transaction(connection):
        match = _match(connection, match_id)
        if match['status'] == 'FINISHED':
            if match['finish_request_id'] == payload['finish_request_id']:
                score, title = score_and_title(payload['outcome'], payload['player_round_wins'], payload['remaining_hp'], payload['max_combo'])
                if not _finish_payload_matches(match, payload, score, title): conflict()
                return match
            raise ApiError('MATCH_ALREADY_FINISHED', 409, 'Match already finished')
        if match['status'] != 'IN_PROGRESS': raise ApiError('INVALID_MATCH_STATE', 409, 'Match is not in progress')
        reused = connection.execute('SELECT id FROM matches WHERE finish_request_id=? AND id<>?', (payload['finish_request_id'], match_id)).fetchone()
        if reused: conflict()
        outcome = payload['outcome']; p, e = payload['player_round_wins'], payload['enemy_round_wins']
        if (outcome == 'WIN' and (p != 2 or e >= 2)) or (outcome == 'LOSE' and (e != 2 or p >= 2)) or (outcome == 'DRAW' and (payload['finish_reason'] != 'DRAW' or p >= 2 or e >= 2)) or payload['finish_reason'] not in ('KO', 'TIME_UP', 'DRAW') or not 0 <= p <= 2 or not 0 <= e <= 2 or not 0 <= payload['remaining_hp'] <= 100 or payload['max_combo'] < 0:
            raise ApiError('VALIDATION_ERROR', 400, 'Inconsistent match result')
        score, title = score_and_title(outcome, p, payload['remaining_hp'], payload['max_combo'])
        if score != payload['client_score'] or title != payload['client_title']:
            raise ApiError('RESULT_MISMATCH', 422, 'Client result does not match authoritative result', {'score': score, 'title': title})
        connection.execute("UPDATE matches SET status='FINISHED', result=?, finish_reason=?, player_round_wins=?, enemy_round_wins=?, remaining_hp=?, max_combo=?, score=?, title=?, finished_at=?, finish_request_id=? WHERE id=?", (outcome, payload['finish_reason'], p, e, payload['remaining_hp'], payload['max_combo'], score, title, now(), payload['finish_request_id'], match_id))
        leaderboard.refresh_ranks(connection)
    return _match(connection, match_id)
