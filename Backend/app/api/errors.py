"""HTTP error helpers that emit the spec's error envelope (section 13).

Both application errors (``IRValidationError``) and API-level errors (``ApiError``,
e.g. 404s) are rendered as ``{"error": {"code", "message", "details"}}``.
"""

from __future__ import annotations

from fastapi.exceptions import RequestValidationError
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from ..core.ir.models import ErrorDetail, ErrorEnvelope, IRValidationError


class ApiError(Exception):
    """An error to surface over HTTP with a specific status code and envelope."""

    def __init__(self, code: str, message: str, *, status_code: int = 400, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def to_envelope(self) -> ErrorEnvelope:
        return ErrorEnvelope(error=ErrorDetail(code=self.code, message=self.message, details=self.details))


def as_http_error(code: str, message: str, *, status_code: int = 400, details: dict | None = None) -> ApiError:
    return ApiError(code, message, status_code=status_code, details=details)


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.to_envelope().model_dump())


async def request_validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Render FastAPI's request validation errors (missing field, wrong type,
    over-long value) in the error envelope instead of its default ``{"detail"}``
    body, so clients always find an ``error.code``. Keeps FastAPI's 422."""
    errors = [
        {"loc": list(err.get("loc", ())), "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in exc.errors()
    ]
    first = errors[0] if errors else None
    message = (
        f"Invalid request: {'.'.join(str(p) for p in first['loc'])}: {first['msg']}"
        if first
        else "Invalid request."
    )
    envelope = ErrorEnvelope(error=ErrorDetail(code="INVALID_REQUEST", message=message, details={"errors": errors}))
    return JSONResponse(status_code=422, content=envelope.model_dump())


# IRValidationError codes that denote a server-side fault rather than bad client
# input; these map to 5xx while still using the same error envelope.
_SERVER_ERROR_CODES = {"CORRUPT_ANALYSIS", "UNKNOWN_RULE", "STORAGE_ERROR"}


async def ir_validation_handler(_request: Request, exc: IRValidationError) -> JSONResponse:
    """Map IRValidationError to an HTTP status with the error envelope.

    Bad client input is 400; server-side faults (a corrupt stored analysis, a
    missing rule definition) are 500.
    """
    status_code = 500 if exc.code in _SERVER_ERROR_CODES else 400
    return JSONResponse(status_code=status_code, content=exc.to_envelope().model_dump())
