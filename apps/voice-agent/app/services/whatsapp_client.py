"""WhatsApp client for the voice agent.

Calls WuzAPI directly (not the PMS backend proxy) to avoid the PMS auth layer —
the service token is a superadmin JWT scoped to the platform org, which is
different from the tenant org that owns the WhatsApp instance.

All instance metadata (wuzapi_token) is read from MongoDB.
Chat history is also read from MongoDB (whatsapp_events collection).
"""
import asyncio
import base64
import re
import time
import uuid
from datetime import datetime, timezone

import httpx
import structlog

from app.core.config import settings
from app.core.database import get_db
from app.services import api_logger

logger = structlog.get_logger(__name__)

# Shared client for WuzAPI calls (no default auth header — token is per-request via "Token" header)
_wuzapi_client: httpx.AsyncClient | None = None


def _get_wuzapi_client() -> httpx.AsyncClient:
    global _wuzapi_client
    if _wuzapi_client is None or _wuzapi_client.is_closed:
        _wuzapi_client = httpx.AsyncClient(
            base_url=settings.WUZAPI_URL,
            timeout=15.0,
        )
    return _wuzapi_client


async def _wa_post(path: str, headers: dict, json_body: dict | list | None = None) -> httpx.Response:
    """POST to WuzAPI and record the call in the per-call API audit log.

    Uses explicit logging rather than httpx event hooks so that the audit
    record is guaranteed to be appended to the current call's ContextVar
    regardless of asyncio task boundaries.
    """
    start = time.monotonic()
    response = await _get_wuzapi_client().post(path, headers=headers, json=json_body)
    duration_ms = int((time.monotonic() - start) * 1000)
    try:
        resp_data = response.json()
    except Exception:
        resp_data = response.text[:500] if response.text else None
    api_logger.append({
        "method": "POST",
        "url": f"{settings.WUZAPI_URL}{path}",
        "payload": json_body,
        "status_code": response.status_code,
        "response": resp_data,
        "duration_ms": duration_ms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return response


def _to_jid(phone: str) -> str:
    """Normalise a phone number to WhatsApp JID format (no-op if already a JID)."""
    if "@" in phone:
        return phone
    digits = re.sub(r"\D", "", phone)
    return f"{digits}@s.whatsapp.net"


def _token_headers(token: str) -> dict:
    return {"Token": token, "Content-Type": "application/json"}


# ── Instance discovery ─────────────────────────────────────────────────────────

async def find_connected_instance(org_id: str) -> dict | None:
    """Return the first connected WhatsApp instance for this org, or None.

    Returns dict with keys: id, name, wuzapi_token
    """
    try:
        db = get_db()
        doc = await db["whatsapp_instances"].find_one(
            {"org_id": org_id, "status": "connected", "deleted_at": None},
            {"_id": 1, "name": 1, "wuzapi_token": 1},
        )
        if doc:
            doc["id"] = str(doc.pop("_id"))
        return doc
    except Exception as exc:
        logger.warning("wa_client_error", action="find_connected_instance", error=str(exc))
        return None


# ── Number check ──────────────────────────────────────────────────────────────

async def check_number_on_whatsapp(instance_id: str, phone: str, *, wuzapi_token: str = "") -> bool:
    """Returns True if the phone number has an active WhatsApp account."""
    if not wuzapi_token:
        try:
            db = get_db()
            from bson import ObjectId
            doc = await db["whatsapp_instances"].find_one(
                {"_id": ObjectId(instance_id)},
                {"wuzapi_token": 1},
            )
            wuzapi_token = (doc or {}).get("wuzapi_token", "")
        except Exception as exc:
            logger.warning("wa_client_error", action="fetch_token", error=str(exc))

    if not wuzapi_token:
        logger.warning("wa_client_error", action="check_number", error="no wuzapi_token")
        return False

    try:
        jid = _to_jid(phone)
        r = await _wa_post(
            "/user/check",
            headers=_token_headers(wuzapi_token),
            json_body={"Phone": [jid]},
        )
        r.raise_for_status()
        data = r.json()
        # WuzAPI response: {"data": {"254...@s.whatsapp.net": {"exists": true}}}
        inner = (data.get("data") or {})
        return any(
            isinstance(v, dict) and v.get("exists")
            for v in inner.values()
        )
    except Exception as exc:
        logger.warning("wa_client_error", action="check_number", error=str(exc))
        return False


# ── Chat history from MongoDB ─────────────────────────────────────────────────

async def get_chat_history(
    org_id: str,
    instance_id: str,
    phone: str,
    limit: int = 10,
) -> list[dict]:
    """Fetch recent WhatsApp Message events involving this phone from MongoDB."""
    try:
        db = get_db()
        digits = re.sub(r"\D", "", phone)
        cursor = db["whatsapp_events"].find(
            {
                "org_id": org_id,
                "instance_id": instance_id,
                "event_type": "Message",
                "$or": [
                    {"payload.data.key.remoteJid": {"$regex": digits}},
                    {"payload.body.key.remoteJid": {"$regex": digits}},
                ],
            },
            {"event_type": 1, "payload": 1, "received_at": 1},
        ).sort("received_at", -1).limit(limit)

        events = await cursor.to_list(length=limit)
        result: list[dict] = []
        for ev in events:
            data_block = ev.get("payload", {}).get("data", {})
            msg = data_block.get("message", {})
            key = data_block.get("key", {})
            text = (
                msg.get("conversation")
                or msg.get("extendedTextMessage", {}).get("text")
                or "[media]"
            )
            result.append({
                "message_id": key.get("id"),
                "from_me": key.get("fromMe", False),
                "chat": key.get("remoteJid", _to_jid(phone)),
                "text": text,
                "timestamp": ev["received_at"].isoformat() if ev.get("received_at") else None,
            })
        return result
    except Exception as exc:
        logger.warning("wa_client_error", action="get_chat_history", error=str(exc))
        return []


# ── Presence ──────────────────────────────────────────────────────────────────

async def set_presence(
    instance_id: str,
    phone: str,
    presence: str = "composing",
    *,
    wuzapi_token: str,
    media: str | None = None,
) -> None:
    """Set typing/composing indicator. Silently swallows errors.

    Args:
        presence: "composing" | "paused" | "recording"
        media: Optional. Pass "audio" only when indicating voice message recording.
               Omit for regular text composing.
    """
    try:
        body: dict = {"Phone": _to_jid(phone), "State": presence}
        if media:
            body["Media"] = media
        await _wa_post(
            "/chat/presence",
            headers=_token_headers(wuzapi_token),
            json_body=body,
        )
    except Exception as exc:
        logger.debug("wa_client_error", action="set_presence", error=str(exc))


# ── Send helpers ──────────────────────────────────────────────────────────────

async def send_text(instance_id: str, phone: str, text: str, *, wuzapi_token: str) -> bool:
    """Show composing indicator, wait a moment, then send a text message."""
    jid = _to_jid(phone)
    await set_presence(instance_id, jid, "composing", wuzapi_token=wuzapi_token)
    delay = min(1.5 + len(text) / 200, 4.0)
    await asyncio.sleep(delay)
    try:
        r = await _wa_post(
            "/chat/send/text",
            headers=_token_headers(wuzapi_token),
            json_body={"Phone": jid, "Body": text, "Id": uuid.uuid4().hex.upper()},
        )
        r.raise_for_status()
        await set_presence(instance_id, jid, "paused", wuzapi_token=wuzapi_token)
        return True
    except Exception as exc:
        logger.warning("wa_client_error", action="send_text", error=str(exc))
        return False


async def send_document(
    instance_id: str,
    phone: str,
    document_url: str,
    filename: str,
    caption: str = "",
    *,
    wuzapi_token: str,
) -> bool:
    """Fetch the document from a URL, base64-encode it, then send via WuzAPI."""
    jid = _to_jid(phone)
    await set_presence(instance_id, jid, "composing", wuzapi_token=wuzapi_token)
    await asyncio.sleep(2.0)
    try:
        # WuzAPI requires the document as a base64 data URI, not a URL.
        async with httpx.AsyncClient(timeout=30.0) as fetch_client:
            fetch_resp = await fetch_client.get(document_url)
            fetch_resp.raise_for_status()
            doc_bytes = fetch_resp.content

        b64 = base64.b64encode(doc_bytes).decode("utf-8")
        data_uri = f"data:application/octet-stream;base64,{b64}"

        body: dict = {
            "Phone": jid,
            "Document": data_uri,
            "FileName": filename,
            "Id": uuid.uuid4().hex.upper(),
        }
        if caption:
            body["Caption"] = caption
        r = await _wa_post(
            "/chat/send/document",
            headers=_token_headers(wuzapi_token),
            json_body=body,
        )
        r.raise_for_status()
        await set_presence(instance_id, jid, "paused", wuzapi_token=wuzapi_token)
        return True
    except Exception as exc:
        logger.warning("wa_client_error", action="send_document", error=str(exc))
        return False


# ── React + mark-read ─────────────────────────────────────────────────────────

async def react_to_message(
    instance_id: str,
    chat_jid: str,
    message_id: str,
    emoji: str = "👍",
    *,
    wuzapi_token: str,
) -> None:
    """Add an emoji reaction to an incoming message. Silently swallows errors."""
    try:
        await _wa_post(
            "/chat/react",
            headers=_token_headers(wuzapi_token),
            json_body={"Phone": chat_jid, "Id": message_id, "Reaction": emoji},
        )
    except Exception as exc:
        logger.debug("wa_client_error", action="react", error=str(exc))


async def mark_read(
    instance_id: str,
    chat_jid: str,
    message_ids: list[str],
    *,
    wuzapi_token: str,
) -> None:
    """Mark a list of messages as read. Silently swallows errors."""
    if not message_ids:
        return
    try:
        await _wa_post(
            "/chat/markread",
            headers=_token_headers(wuzapi_token),
            json_body={"Phone": chat_jid, "Id": message_ids},
        )
    except Exception as exc:
        logger.debug("wa_client_error", action="mark_read", error=str(exc))


async def acknowledge_incoming(
    instance_id: str,
    chat_jid: str,
    message_id: str,
    *,
    wuzapi_token: str,
) -> None:
    """React 👍 and mark-read on an incoming message — called after agent acts on it."""
    await asyncio.gather(
        react_to_message(instance_id, chat_jid, message_id, "👍", wuzapi_token=wuzapi_token),
        mark_read(instance_id, chat_jid, [message_id], wuzapi_token=wuzapi_token),
    )
