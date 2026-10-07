from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, code: str, status: int, message: str, details: Any = None):
        self.code, self.status, self.message, self.details = code, status, message, details or {}


def response(error: ApiError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': error.message, 'details': error.details}})


async def api_error_handler(_: Request, error: ApiError) -> JSONResponse:
    return response(error)


async def validation_error_handler(_: Request, error: RequestValidationError) -> JSONResponse:
    return response(ApiError('VALIDATION_ERROR', 400, 'Invalid request', error.errors()))


async def unexpected_error_handler(_: Request, __: Exception) -> JSONResponse:
    return response(ApiError('INTERNAL_ERROR', 500, 'Internal server error'))
