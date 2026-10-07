from datetime import UTC, datetime
import json
import sqlite3

from app.errors import ApiError


def now() -> str:
    return datetime.now(UTC).isoformat()


def item(row):
    return dict(row) if row else None


def conflict(message: str = 'Idempotency key conflicts with existing request') -> None:
    raise ApiError('IDEMPOTENCY_CONFLICT', 409, message)


def request_replay(connection: sqlite3.Connection, operation: str, target: str, request_id: str, payload: dict) -> dict | None:
    row = connection.execute(
        'SELECT payload, response FROM mutation_requests WHERE operation=? AND target=? AND request_id=?',
        (operation, target, request_id),
    ).fetchone()
    if not row:
        return None
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    if row['payload'] != encoded:
        conflict()
    return json.loads(row['response'])


def remember_request(connection: sqlite3.Connection, operation: str, target: str, request_id: str, payload: dict, response: dict) -> None:
    connection.execute(
        'INSERT INTO mutation_requests(operation,target,request_id,payload,response) VALUES(?,?,?,?,?)',
        (operation, target, request_id, json.dumps(payload, sort_keys=True, separators=(',', ':')), json.dumps(response, sort_keys=True)),
    )
