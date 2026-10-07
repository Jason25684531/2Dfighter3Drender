from fastapi import APIRouter, Request, Response

from app.schemas import PlayerCreate
from app.services import players

router = APIRouter(prefix='/players')


@router.post('')
def create(payload: PlayerCreate, request: Request, response: Response):
    with request.app.state.connect() as connection:
        result, created = players.create(connection, payload.nickname, payload.language, payload.client_request_id)
    response.status_code = 201 if created else 200
    return result


@router.get('/{player_id}')
def get(player_id: int, request: Request):
    with request.app.state.connect() as connection:
        return players.get(connection, player_id)
