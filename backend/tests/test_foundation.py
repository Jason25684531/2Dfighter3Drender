import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import connect, init_db
from app.main import create_app


def test_health(client):
    assert client.get('/api/v1/health').json() == {'status': 'ok', 'database': 'ok'}


def test_schema_is_repeatable_and_enforces_foreign_keys(db_path):
    init_db(db_path)
    init_db(db_path)
    with connect(db_path) as connection:
        assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        try:
            connection.execute("INSERT INTO sessions(player_id, status, client_request_id, created_at) VALUES(999, 'QUEUED', 'bad', 'now')")
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError('foreign key was not enforced')


def test_errors_are_uniform(client):
    response = client.get('/missing')
    assert response.status_code == 404
    assert response.json()['error']['code'] == 'NOT_FOUND'


def test_unexpected_error_hides_traceback(tmp_path):
    app = create_app(tmp_path / 'error.db')

    @app.get('/boom')
    def boom():
        raise RuntimeError('secret traceback')

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get('/boom')
    assert response.status_code == 500
    assert response.json() == {'error': {'code': 'INTERNAL_ERROR', 'message': 'Internal server error', 'details': {}}}
