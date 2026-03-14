"""Per-call API call logger for the voice agent.

Uses a ContextVar so each call session accumulates its own log list, even when
multiple calls are handled concurrently by the same process.

Usage in pipeline.py:
    from app.services import api_logger
    api_logger.init_call_log()          # call at pipeline start
    ...
    log = api_logger.get_call_log()     # at call end, save to MongoDB

Usage in httpx clients (pms_api.py, whatsapp_client.py):
    event_hooks={"request": [api_logger.on_request], "response": [api_logger.on_response]}
"""
import json
import time
from contextvars import ContextVar
from datetime import datetime, timezone

# None = "not inside a call pipeline" (no-op mode)
_api_log: ContextVar[list | None] = ContextVar("_api_log", default=None)


def init_call_log() -> None:
    """Call once at the start of run_call_pipeline() to enable logging."""
    _api_log.set([])


def get_call_log() -> list:
    """Return all captured API call records for the current call (may be empty)."""
    return _api_log.get(None) or []


def append(record: dict) -> None:
    """Append a call record to the current call's audit log (no-op outside a pipeline)."""
    log = _api_log.get(None)
    if log is not None:
        log.append(record)


# Keep the private alias for internal use
_append = append


# ── httpx event hooks ─────────────────────────────────────────────────────────

async def on_request(request) -> None:
    """httpx request hook — capture method, URL, and payload."""
    request.extensions["_log_start_ts"] = time.monotonic()
    try:
        body = await request.aread()
        payload = json.loads(body.decode("utf-8")) if body else None
    except Exception:
        payload = None
    request.extensions["_log_payload"] = payload


async def on_response(response) -> None:
    """httpx response hook — capture status and response body; append record."""
    start = response.request.extensions.get("_log_start_ts")
    duration_ms = int((time.monotonic() - start) * 1000) if start is not None else None

    try:
        await response.aread()
        try:
            resp_data = response.json()
        except Exception:
            resp_data = response.text[:500] if response.text else None
    except Exception:
        resp_data = None

    _append({
        "method": response.request.method,
        "url": str(response.request.url),
        "payload": response.request.extensions.get("_log_payload"),
        "status_code": response.status_code,
        "response": resp_data,
        "duration_ms": duration_ms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
