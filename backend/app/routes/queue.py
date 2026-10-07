from fastapi import APIRouter, Request

from app.schemas import MutationRequest
from app.services import sessions

router = APIRouter(prefix='/queue')


@router.get('')
def queue(request: Request):
    with request.app.state.connect() as connection:
        return sessions.queue(connection)


@router.post('/activate-next')
def activate_next(payload: MutationRequest, request: Request):
    with request.app.state.connect() as connection:
        return sessions.activate_next(connection, payload.client_request_id)
