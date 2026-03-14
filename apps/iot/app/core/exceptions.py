from typing import Any, Dict, Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError


class IoTError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict[str, Any]] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)


class ResourceNotFoundError(IoTError):
    def __init__(self, resource: str, resource_id: str = ""):
        super().__init__(
            code="RESOURCE_NOT_FOUND",
            message=f"{resource} not found" + (f": {resource_id}" if resource_id else ""),
        )


class ConflictError(IoTError):
    def __init__(self, message: str):
        super().__init__(code="CONFLICT", message=message)


class ForbiddenError(IoTError):
    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(code="FORBIDDEN", message=message)


class UnauthorizedError(IoTError):
    def __init__(self, message: str = "Authentication required"):
        super().__init__(code="UNAUTHORIZED", message=message)


class ValidationError(IoTError):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(code="VALIDATION_ERROR", message=message, details=details)


class DeviceAuthError(IoTError):
    def __init__(self, message: str = "Device authentication failed"):
        super().__init__(code="DEVICE_AUTH_FAILED", message=message)


class ThingsBoardError(IoTError):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(code="THINGSBOARD_ERROR", message=message, details=details)


class HeadscaleError(IoTError):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(code="HEADSCALE_ERROR", message=message, details=details)


def _error_response(code: str, message: str, details: Optional[Dict] = None) -> Dict:
    payload: Dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        payload["error"]["details"] = details
    return payload


def add_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ResourceNotFoundError)
    async def not_found_handler(request: Request, exc: ResourceNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content=_error_response(exc.code, exc.message, exc.details))

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content=_error_response(exc.code, exc.message, exc.details))

    @app.exception_handler(ForbiddenError)
    async def forbidden_handler(request: Request, exc: ForbiddenError) -> JSONResponse:
        return JSONResponse(status_code=403, content=_error_response(exc.code, exc.message, exc.details))

    @app.exception_handler(UnauthorizedError)
    async def unauthorized_handler(request: Request, exc: UnauthorizedError) -> JSONResponse:
        return JSONResponse(status_code=401, content=_error_response(exc.code, exc.message, exc.details))

    @app.exception_handler(ValidationError)
    async def validation_handler(request: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=400, content=_error_response(exc.code, exc.message, exc.details))

    @app.exception_handler(DeviceAuthError)
    async def device_auth_handler(request: Request, exc: DeviceAuthError) -> JSONResponse:
        return JSONResponse(status_code=401, content=_error_response(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def pydantic_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_response("UNPROCESSABLE_ENTITY", "Validation failed", {"errors": exc.errors()}),
        )

    @app.exception_handler(HTTPException)
    async def http_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_response("HTTP_ERROR", exc.detail),
        )

    @app.exception_handler(Exception)
    async def generic_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=_error_response("INTERNAL_SERVER_ERROR", "An unexpected error occurred"),
        )
