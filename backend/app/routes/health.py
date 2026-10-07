import sqlite3

from fastapi import APIRouter, Request

from app.errors import ApiError

router = APIRouter()


@router.get('/health')
def health(request: Request) -> dict[str, str]:
    try:
        with request.app.state.connect() as connection:
            connection.execute('SELECT 1')
    except sqlite3.Error as error:
        raise ApiError('DATABASE_UNAVAILABLE', 503, 'Database unavailable') from error
    return {'status': 'ok', 'database': 'ok'}
