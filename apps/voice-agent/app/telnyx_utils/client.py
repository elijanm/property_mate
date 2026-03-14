"""Thin async wrapper around the Telnyx Call Control REST API."""
import httpx
import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)

TELNYX_BASE = "https://api.telnyx.com/v2"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
        "Content-Type": "application/json",
    }


async def answer_call(call_control_id: str) -> bool:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TELNYX_BASE}/calls/{call_control_id}/actions/answer",
            headers=_headers(),
            json={},
        )
        if r.status_code not in (200, 201, 204):
            logger.error("telnyx_answer_failed", call_control_id=call_control_id, status=r.status_code)
            return False
        return True


async def start_media_stream(call_control_id: str, stream_url: str) -> bool:
    """Tell Telnyx to connect audio to our WebSocket endpoint."""
    payload = {
        "stream_url": stream_url,
        "stream_track": "both_tracks",
        "enable_dialogflow": False,
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TELNYX_BASE}/calls/{call_control_id}/actions/streaming_start",
            headers=_headers(),
            json=payload,
        )
        if r.status_code not in (200, 201, 204):
            logger.error(
                "telnyx_stream_start_failed",
                call_control_id=call_control_id,
                status=r.status_code,
                body=r.text,
            )
            return False
        return True


async def stop_media_stream(call_control_id: str) -> None:
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{TELNYX_BASE}/calls/{call_control_id}/actions/streaming_stop",
            headers=_headers(),
            json={},
        )


async def hangup_call(call_control_id: str) -> None:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TELNYX_BASE}/calls/{call_control_id}/actions/hangup",
            headers=_headers(),
            json={},
        )
        logger.info("telnyx_hangup", call_control_id=call_control_id, status=r.status_code)


async def transfer_call(call_control_id: str, to: str) -> bool:
    """Transfer to a SIP URI or E.164 number."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TELNYX_BASE}/calls/{call_control_id}/actions/transfer",
            headers=_headers(),
            json={"to": to},
        )
        return r.status_code in (200, 201, 204)
