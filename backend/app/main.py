from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.config import settings
from app.db import connect, init_db
from app.errors import ApiError, api_error_handler, unexpected_error_handler, validation_error_handler
from app.routes.health import router as health_router
from app.routes.players import router as players_router
from app.routes.sessions import router as sessions_router
from app.routes.queue import router as queue_router
from app.routes.matches import router as matches_router
from app.routes.leaderboard import router as leaderboard_router
from fastapi.exceptions import RequestValidationError


def create_app(db_path: str | Path | None = None) -> FastAPI:
    config = settings(db_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(config.db_path)
        app.state.connect = lambda: connect(config.db_path)
        yield

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(config.cors_origins), allow_methods=['*'], allow_headers=['*'])
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unexpected_error_handler)

    @app.exception_handler(StarletteHTTPException)
    async def not_found(_, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            return JSONResponse(status_code=404, content={'error': {'code': 'NOT_FOUND', 'message': 'Not found', 'details': {}}})
        return JSONResponse(status_code=error.status_code, content={'error': {'code': 'HTTP_ERROR', 'message': str(error.detail), 'details': {}}})

    app.include_router(health_router, prefix='/api/v1')
    app.include_router(players_router, prefix='/api/v1')
    app.include_router(sessions_router, prefix='/api/v1')
    app.include_router(queue_router, prefix='/api/v1')
    app.include_router(matches_router, prefix='/api/v1')
    app.include_router(leaderboard_router, prefix='/api/v1')
    return app


app = create_app()
