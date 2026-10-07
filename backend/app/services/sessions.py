import sqlite3

from app.db import transaction
from app.errors import ApiError
from app.services.common import conflict, item, now, remember_request, request_replay


def _session(connection: sqlite3.Connection, session_id: int) -> dict:
    row = connection.execute('SELECT * FROM sessions WHERE id = ?', (session_id,)).fetchone()
    if not row:
        raise ApiError('SESSION_NOT_FOUND', 404, f'Session {session_id} not found')
    result = item(row)
    if result['status'] == 'QUEUED':
        result['queue_position'] = connection.execute("SELECT COUNT(*) FROM sessions WHERE status = 'QUEUED' AND (created_at < ? OR (created_at = ? AND id <= ?))", (result['created_at'], result['created_at'], session_id)).fetchone()[0]
    else:
        result['queue_position'] = None
    return result


def create(connection: sqlite3.Connection, player_id: int, selected_character: str | None, request_id: str) -> tuple[dict, bool]:
    existing = connection.execute('SELECT * FROM sessions WHERE client_request_id = ?', (request_id,)).fetchone()
    if existing:
        if existing['player_id'] != player_id or existing['selected_character'] != selected_character:
            conflict()
        return _session(connection, existing['id']), False
    if not connection.execute('SELECT 1 FROM players WHERE id = ?', (player_id,)).fetchone():
        raise ApiError('PLAYER_NOT_FOUND', 404, f'Player {player_id} not found')
    created = now()
    cursor = connection.execute("INSERT INTO sessions(player_id,status,selected_character,client_request_id,created_at) VALUES(?,?,?,?,?)", (player_id, 'QUEUED', selected_character, request_id, created))
    return _session(connection, cursor.lastrowid), True


def get(connection: sqlite3.Connection, session_id: int) -> dict:
    return _session(connection, session_id)


def current(connection: sqlite3.Connection) -> dict:
    row = connection.execute("SELECT id FROM sessions WHERE status = 'ACTIVE'").fetchone()
    if not row:
        raise ApiError('NO_ACTIVE_SESSION', 404, 'No active session')
    return _session(connection, row['id'])


def update(connection: sqlite3.Connection, session_id: int, selected_character: str | None, request_id: str) -> dict:
    payload = {'selected_character': selected_character}
    replay = request_replay(connection, 'session.update', str(session_id), request_id, payload)
    if replay is not None:
        return replay
    with transaction(connection):
        current_session = _session(connection, session_id)
        if current_session['status'] not in ('QUEUED', 'ACTIVE'):
            raise ApiError('INVALID_SESSION_STATE', 409, 'Session cannot be updated')
        connection.execute('UPDATE sessions SET selected_character = ? WHERE id = ?', (selected_character, session_id))
        result = _session(connection, session_id)
        remember_request(connection, 'session.update', str(session_id), request_id, payload, result)
    return result


def finish(connection: sqlite3.Connection, session_id: int, request_id: str) -> dict:
    replay = request_replay(connection, 'session.finish', str(session_id), request_id, {})
    if replay is not None:
        return replay
    with transaction(connection):
        current_session = _session(connection, session_id)
        if current_session['status'] == 'FINISHED':
            result = current_session
            remember_request(connection, 'session.finish', str(session_id), request_id, {}, result)
            return result
        if current_session['status'] != 'ACTIVE':
            raise ApiError('INVALID_SESSION_STATE', 409, 'Session cannot be finished')
        finished = now()
        connection.execute("UPDATE matches SET status = 'ABANDONED' WHERE session_id = ? AND status = 'IN_PROGRESS'", (session_id,))
        connection.execute("UPDATE sessions SET status = 'FINISHED', finished_at = ? WHERE id = ?", (finished, session_id))
        result = _session(connection, session_id)
        remember_request(connection, 'session.finish', str(session_id), request_id, {}, result)
    return result


def cancel(connection: sqlite3.Connection, session_id: int, request_id: str) -> dict:
    replay = request_replay(connection, 'session.cancel', str(session_id), request_id, {})
    if replay is not None:
        return replay
    with transaction(connection):
        current_session = _session(connection, session_id)
        if current_session['status'] == 'CANCELLED':
            result = current_session
            remember_request(connection, 'session.cancel', str(session_id), request_id, {}, result)
            return result
        if current_session['status'] not in ('QUEUED', 'ACTIVE'):
            raise ApiError('INVALID_SESSION_STATE', 409, 'Session cannot be cancelled')
        connection.execute("UPDATE sessions SET status = 'CANCELLED' WHERE id = ?", (session_id,))
        result = _session(connection, session_id)
        remember_request(connection, 'session.cancel', str(session_id), request_id, {}, result)
    return result


def queue(connection: sqlite3.Connection) -> list[dict]:
    return [_session(connection, row['id']) for row in connection.execute("SELECT id FROM sessions WHERE status = 'QUEUED' ORDER BY created_at, id")]


def activate_next(connection: sqlite3.Connection, request_id: str) -> dict:
    replay = request_replay(connection, 'queue.activate', 'queue', request_id, {})
    if replay is not None:
        return replay
    with transaction(connection):
        active = connection.execute("SELECT id FROM sessions WHERE status = 'ACTIVE'").fetchone()
        if active:
            result = _session(connection, active['id'])
            remember_request(connection, 'queue.activate', 'queue', request_id, {}, result)
            return result
        queued = connection.execute("SELECT id FROM sessions WHERE status = 'QUEUED' ORDER BY created_at, id LIMIT 1").fetchone()
        if not queued:
            raise ApiError('QUEUE_EMPTY', 404, 'Queue is empty')
        connection.execute("UPDATE sessions SET status = 'ACTIVE', started_at = ? WHERE id = ?", (now(), queued['id']))
        result = _session(connection, queued['id'])
        remember_request(connection, 'queue.activate', 'queue', request_id, {}, result)
    return result
