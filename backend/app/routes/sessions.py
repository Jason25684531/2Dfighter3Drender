from fastapi import APIRouter, Request, Response

from app.schemas import MutationRequest, SessionCreate, SessionUpdate
from app.services import sessions

router = APIRouter(prefix='/sessions')


@router.post('')
def create(payload: SessionCreate, request: Request, response: Response):
    with request.app.state.connect() as connection:
        result, created = sessions.create(connection, payload.player_id, payload.selected_character, payload.client_request_id)
    response.status_code = 201 if created else 200
    return result


@router.get('/current')
def current(request: Request):
    with request.app.state.connect() as connection:
        return sessions.current(connection)


@router.get('/{session_id}')
def get(session_id: int, request: Request):
    with request.app.state.connect() as connection:
        return sessions.get(connection, session_id)


@router.patch('/{session_id}')
def update(session_id: int, payload: SessionUpdate, request: Request):
    with request.app.state.connect() as connection:
        return sessions.update(connection, session_id, payload.selected_character, payload.client_request_id)


@router.post('/{session_id}/finish')
def finish(session_id: int, payload: MutationRequest, request: Request):
    with request.app.state.connect() as connection:
        return sessions.finish(connection, session_id, payload.client_request_id)


@router.post('/{session_id}/cancel')
def cancel(session_id: int, payload: MutationRequest, request: Request):
    with request.app.state.connect() as connection:
        return sessions.cancel(connection, session_id, payload.client_request_id)
