import sqlite3

from app.errors import ApiError
from app.services.common import conflict, item, now


def create(connection: sqlite3.Connection, nickname: str, language: str, request_id: str) -> tuple[dict, bool]:
    existing = connection.execute('SELECT id, nickname, language, created_at FROM players WHERE client_request_id = ?', (request_id,)).fetchone()
    if existing:
        if existing['nickname'] != nickname or existing['language'] != language:
            conflict()
        return item(existing), False
    created = now()
    cursor = connection.execute('INSERT INTO players(nickname, language, client_request_id, created_at, updated_at) VALUES(?,?,?,?,?)', (nickname, language, request_id, created, created))
    return {'id': cursor.lastrowid, 'nickname': nickname, 'language': language, 'created_at': created}, True


def get(connection: sqlite3.Connection, player_id: int) -> dict:
    player = connection.execute('SELECT id, nickname, language, created_at FROM players WHERE id = ?', (player_id,)).fetchone()
    if not player:
        raise ApiError('PLAYER_NOT_FOUND', 404, f'Player {player_id} not found')
    return item(player)
