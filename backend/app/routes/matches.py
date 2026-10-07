from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.services import matches

router = APIRouter(prefix='/matches')


class MatchCreate(BaseModel): session_id: int; client_request_id: str = Field(min_length=1)
class RoundCreate(BaseModel):
    round_index: int; round_number: int; winner: Literal['PLAYER', 'ENEMY'] | None = None; finish_reason: str; player_hp: int; enemy_hp: int; max_combo: int; duration_ticks: int; client_request_id: str = Field(min_length=1)
class Finish(BaseModel):
    outcome: Literal['WIN', 'LOSE', 'DRAW']; finish_reason: str; player_round_wins: int; enemy_round_wins: int; remaining_hp: int; max_combo: int; client_score: int; client_title: str; finish_request_id: str = Field(min_length=1)

@router.post('')
def create(payload: MatchCreate, request: Request, response: Response):
    with request.app.state.connect() as connection: result, created = matches.create(connection, payload.session_id, payload.client_request_id)
    response.status_code = 201 if created else 200; return result

@router.get('/{match_id}')
def get(match_id: int, request: Request):
    with request.app.state.connect() as connection: return matches._match(connection, match_id)

@router.post('/{match_id}/rounds')
def add_round(match_id: int, payload: RoundCreate, request: Request, response: Response):
    with request.app.state.connect() as connection: result, created = matches.add_round(connection, match_id, payload.model_dump())
    response.status_code = 201 if created else 200; return result

@router.post('/{match_id}/finish')
def finish(match_id: int, payload: Finish, request: Request):
    with request.app.state.connect() as connection: return matches.finish(connection, match_id, payload.model_dump())
