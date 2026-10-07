from fastapi import APIRouter, Query, Request
from app.services.leaderboard import entries

router = APIRouter()

@router.get('/leaderboard')
def leaderboard(request: Request, limit: int = Query(20, ge=1, le=100)):
    with request.app.state.connect() as connection: return entries(connection, limit)
