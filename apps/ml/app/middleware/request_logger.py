"""Request logging + IP security middleware.

Every request:
  1. Checks if the source IP is banned → 403 immediately
  2. After response: logs to RequestLog + updates IPRecord asynchronously

Upload endpoints additionally:
  • Scan the file body with file_scanner_service
  • Block and ban the IP if a threat is found
"""
import time
import base64
import asyncio
import structlog
from typing import Set
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.models.request_log import RequestLog
from app.services import ip_analyzer_service
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

# Headers whose values should NOT be logged (contain credentials)
_REDACT_HEADERS: Set[str] = {
    "authorization", "cookie", "set-cookie", "x-api-key",
    "x-auth-token", "proxy-authorization",
}

# Paths that accept file uploads and should be scanned
_UPLOAD_PATHS = {
    "/api/v1/models/deploy-pretrained/zip",
    "/api/v1/models/deploy-pretrained/upload",
    "/api/v1/trainers/upload",
    "/api/v1/training/start-with-data",
}

# These paths upload TRUSTED developer code (BaseTrainer subclasses and PythonModel
# inference scripts bundled in model ZIPs).
# Run ClamAV virus scan only — skip static code analysis entirely.
# Code analysis produces too many false positives on legitimate ML code:
# os.system("tesseract …"), boto3.client("s3"), eval/exec for dynamic configs, etc.
_TRAINER_UPLOAD_PATHS = {
    "/api/v1/trainers/upload",
    "/api/v1/training/start-with-data",
    "/api/v1/models/deploy-pretrained/zip",
    "/api/v1/models/deploy-pretrained/upload",
}


def _get_client_ip(request: Request) -> str:
    """Extract real client IP respecting common proxy headers."""
    for header in ("x-real-ip", "x-forwarded-for", "cf-connecting-ip"):
        val = request.headers.get(header, "")
        if val:
            return val.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _safe_headers(headers) -> dict:
    return {
        k: ("***REDACTED***" if k.lower() in _REDACT_HEADERS else v)
        for k, v in headers.items()
    }


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    """Log + gate every request through IP security checks."""

    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()
        ip = _get_client_ip(request)
        path = request.url.path
        method = request.method
        user_agent = request.headers.get("user-agent", "")
        is_upload = path in _UPLOAD_PATHS

        # ── 1. Fast IP ban check ───────────────────────────────────────────
        blocked, ban_reason = await ip_analyzer_service.check_ip(ip, path, user_agent)
        if blocked:
            logger.warning("request_blocked_banned_ip", ip=ip, path=path, reason=ban_reason)
            await _log_request(
                ip=ip, method=method, path=path,
                query=str(request.query_params),
                headers=_safe_headers(request.headers),
                status_code=403,
                latency_ms=0,
                user_agent=user_agent,
                is_upload=is_upload,
                blocked=True,
                block_reason=ban_reason,
            )
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "IP_BANNED", "message": "Access denied"}},
            )

        # ── 2. Upload file scan (before calling the actual handler) ────────
        body_bytes = b""
        if is_upload and method == "POST":
            body_bytes = await request.body()

            # Trainer uploads: ClamAV only (no code analysis — ML code has too many false positives)
            # Model ZIP uploads: full scan (ClamAV + static code analysis)
            clamav_only = path in _TRAINER_UPLOAD_PATHS
            scan_result = await _scan_upload(request, body_bytes, clamav_only=clamav_only)
            if not scan_result["safe"]:
                threat_reason = scan_result["reason"]
                logger.warning(
                    "upload_blocked_threat",
                    ip=ip, path=path, threats=threat_reason,
                )
                # Increment blocked counter
                record = await _get_or_create_record(ip)
                record.blocked_uploads += 1
                await record.save()

                # Only auto-ban when ClamAV confirms actual malware (not just code analysis flags).
                # Code analysis can have false positives; a confirmed virus signature cannot.
                is_confirmed_malware = scan_result.get("clamav_hit", False)
                if is_confirmed_malware or record.blocked_uploads >= 3:
                    await ip_analyzer_service.ban_ip(
                        ip,
                        reason=f"Malicious upload: {threat_reason}",
                        expires_hours=None,  # permanent
                    )
                await _log_request(
                    ip=ip, method=method, path=path,
                    query=str(request.query_params),
                    headers=_safe_headers(request.headers),
                    status_code=400,
                    latency_ms=0,
                    user_agent=user_agent,
                    is_upload=True,
                    filename=scan_result.get("filename"),
                    file_size=scan_result.get("file_size"),
                    blocked=True,
                    block_reason=threat_reason,
                    threat_flags=scan_result.get("threats", []),
                )
                return JSONResponse(
                    status_code=400,
                    content={"error": {
                        "code": "MALICIOUS_FILE",
                        "message": f"File rejected: {threat_reason}",
                    }},
                )

            # Re-inject body so the actual handler can read it
            async def _receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            request._receive = _receive

        # ── 3. Call the real handler ───────────────────────────────────────
        response = await call_next(request)
        latency_ms = (time.perf_counter() - start) * 1000

        # ── 4. Fire-and-forget: log + update IPRecord ──────────────────────
        asyncio.create_task(
            ip_analyzer_service.record_request(
                ip=ip,
                path=path,
                method=method,
                status_code=response.status_code,
                latency_ms=latency_ms,
                user_agent=user_agent,
                payload_size=len(body_bytes),
                is_upload=is_upload,
            )
        )
        asyncio.create_task(
            _log_request(
                ip=ip, method=method, path=path,
                query=str(request.query_params),
                headers=_safe_headers(request.headers),
                status_code=response.status_code,
                latency_ms=latency_ms,
                user_agent=user_agent,
                is_upload=is_upload,
                payload_size=len(body_bytes),
            )
        )

        return response


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _scan_upload(request: Request, body_bytes: bytes, clamav_only: bool = False) -> dict:
    """
    Parse multipart body and scan each uploaded file.
    clamav_only=True: skip static code analysis (used for trainer .py uploads).
    Returns {"safe": bool, "reason": str, "filename": str, "clamav_hit": bool, ...}.
    """
    from app.services.file_scanner_service import scan_file

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        return {"safe": True, "reason": ""}

    # Use python-multipart to parse
    try:
        from multipart.multipart import create_form_parser, QuerystringParser
        import multipart

        files_found = []

        class _Callbacks:
            def __init__(self):
                self.current_name = b""
                self.current_filename = b""
                self.current_data = b""
                self.is_file = False

            def on_field_name(self, data, start, end):
                self.current_name = data[start:end]

            def on_field_data(self, data, start, end):
                pass

            def on_file_name(self, data, start, end):
                self.current_filename = data[start:end]
                self.is_file = True

            def on_file_data(self, data, start, end):
                self.current_data += data[start:end]

            def on_end_file(self):
                if self.current_data:
                    files_found.append((
                        self.current_filename.decode("utf-8", errors="replace"),
                        bytes(self.current_data),
                    ))
                self.current_data = b""
                self.current_filename = b""
                self.is_file = False

        # Fallback: basic boundary extraction
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[9:].strip('"')
                break

        if boundary:
            boundary_bytes = f"--{boundary}".encode()
            parts = body_bytes.split(boundary_bytes)
            for part in parts[1:]:
                if b'filename="' in part:
                    # Extract filename
                    fn_start = part.find(b'filename="') + 10
                    fn_end = part.find(b'"', fn_start)
                    filename = part[fn_start:fn_end].decode("utf-8", errors="replace")
                    # Extract body (after double CRLF)
                    body_start = part.find(b"\r\n\r\n") + 4
                    body_end = part.rfind(b"\r\n")
                    file_content = part[body_start:body_end] if body_end > body_start else part[body_start:]
                    if file_content:
                        files_found.append((filename, file_content))
    except Exception as exc:
        logger.debug("multipart_parse_failed", error=str(exc))
        files_found = []

    # Scan each file
    for filename, file_content in files_found:
        result = await scan_file(file_content, filename, clamav_only=clamav_only)
        if not result.safe:
            return {
                "safe": False,
                "reason": result.summary,
                "filename": filename,
                "file_size": len(file_content),
                "threats": result.threats,
                "clamav_hit": result.clamav_result is not None,
            }

    return {"safe": True, "reason": "", "filename": None, "clamav_hit": False}


async def _log_request(
    ip: str,
    method: str,
    path: str,
    query: str,
    headers: dict,
    status_code: int,
    latency_ms: float,
    user_agent: str,
    is_upload: bool = False,
    payload_size: int = 0,
    filename: str = None,
    file_size: int = None,
    blocked: bool = False,
    block_reason: str = "",
    threat_flags: list = None,
) -> None:
    try:
        log = RequestLog(
            ip=ip, method=method, path=path,
            query_string=query, headers=headers,
            status_code=status_code, latency_ms=latency_ms,
            user_agent=user_agent, is_upload=is_upload,
            payload_size=payload_size, filename=filename,
            file_size=file_size, blocked=blocked,
            block_reason=block_reason,
            threat_flags=threat_flags or [],
        )
        await log.insert()
    except Exception as exc:
        logger.error("request_log_failed", error=str(exc))


async def _get_or_create_record(ip: str):
    from app.models.ip_record import IPRecord
    record = await IPRecord.find_one({"ip": ip})
    if record is None:
        record = IPRecord(ip=ip)
        await record.insert()
    return record
