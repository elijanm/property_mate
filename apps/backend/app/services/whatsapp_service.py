"""WhatsApp instance management + WuzAPI bridge."""
import base64
import io
import json
import mimetypes
import uuid
from typing import Any, Dict, List, Optional

import httpx
import structlog

from app.core.config import settings
from app.core.redis import get_redis_client
from app.core.s3 import generate_presigned_url, get_s3_client
from app.dependencies.auth import CurrentUser
from app.models.whatsapp_event import WhatsAppEvent
from app.models.whatsapp_instance import WhatsAppInstance
from app.repositories.whatsapp_event_repository import whatsapp_event_repository
from app.repositories.whatsapp_instance_repository import whatsapp_instance_repository

logger = structlog.get_logger(__name__)


# ── WuzAPI HTTP helpers ──────────────────────────────────────────────────────

def _admin_headers() -> Dict[str, str]:
    return {"Authorization": settings.wuzapi_admin_token, "Content-Type": "application/json"}


def _user_headers(token: str) -> Dict[str, str]:
    return {"Token": token, "Content-Type": "application/json"}


async def _wuzapi(method: str, path: str, headers: dict, json_body: Optional[dict] = None) -> dict:
    url = f"{settings.wuzapi_url}{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(method, url, headers=headers, json=json_body)
        resp.raise_for_status()
        return resp.json() if resp.content else {}


# ── Media helpers ────────────────────────────────────────────────────────────

# Map of whatsapp message sub-keys that contain media
_MEDIA_KEYS = ["imageMessage", "videoMessage", "audioMessage", "documentMessage",
               "stickerMessage", "pttMessage"]

_MIME_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/ogg; codecs=opus": "ogg",
    "application/pdf": "pdf",
}


def _detect_media(payload: dict) -> Optional[Dict[str, Any]]:
    """Return the media sub-message dict if the payload is a media message."""
    msg = (
        payload.get("body", {}).get("message")
        or payload.get("data", {}).get("message")
        or {}
    )
    for key in _MEDIA_KEYS:
        if key in msg:
            info = msg[key]
            info["_wa_key"] = key
            return info
    return None


_WA_KEY_TO_DOWNLOAD_PATH = {
    "imageMessage":    "/chat/downloadimage",
    "videoMessage":    "/chat/downloadvideo",
    "audioMessage":    "/chat/downloadaudio",
    "pttMessage":      "/chat/downloadaudio",
    "documentMessage": "/chat/downloaddocument",
    "stickerMessage":  "/chat/downloadimage",
}


async def _download_from_wuzapi(wuzapi_token: str, message_payload: dict, media_info: dict) -> Optional[bytes]:
    """Ask WuzAPI to download the media and return raw bytes."""
    wa_key = media_info.get("_wa_key", "")
    path = _WA_KEY_TO_DOWNLOAD_PATH.get(wa_key, "/chat/downloadimage")
    body = message_payload.get("body") or message_payload.get("data") or message_payload
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.wuzapi_url}{path}",
                headers=_user_headers(wuzapi_token),
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
            # WuzAPI returns base64-encoded content in "Data", "data", or nested
            b64 = (
                data.get("Data")
                or data.get("data")
                or (data.get("data") or {}).get("data")
                or data.get("body")
            )
            if b64:
                return base64.b64decode(b64)
    except Exception as exc:
        logger.warning("wuzapi_media_download_failed", path=path, exc_info=exc)
    return None


async def _store_media_in_minio(
    org_id: str,
    instance_id: str,
    raw: bytes,
    content_type: str,
    message_id: str,
) -> Optional[str]:
    """Upload raw media bytes to MinIO; return the S3 key."""
    ext = _MIME_EXT.get(content_type) or mimetypes.guess_extension(content_type) or "bin"
    key = f"{org_id}/whatsapp/{instance_id}/{message_id}.{ext}"
    try:
        async with get_s3_client() as s3:
            await s3.upload_fileobj(
                io.BytesIO(raw),
                settings.s3_bucket_name,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        return key
    except Exception as exc:
        logger.warning("whatsapp_media_upload_failed", key=key, exc_info=exc)
    return None


# ── Real-time broadcast ──────────────────────────────────────────────────────

async def _publish_ws(org_id: str, payload: dict) -> None:
    """Publish a whatsapp event to the org's WS notification channel."""
    try:
        redis = get_redis_client()
        await redis.publish(f"ws:notifications:{org_id}", json.dumps(payload))
    except Exception as exc:
        logger.warning("whatsapp_ws_publish_failed", org_id=org_id, exc_info=exc)


# ── Internal helpers ─────────────────────────────────────────────────────────

async def _get_instance(instance_id: str, current_user: CurrentUser) -> WhatsAppInstance:
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")
    return instance


def _to_jid(phone: str) -> str:
    """Normalise a phone number to WhatsApp JID format (no-op if already a JID)."""
    if "@" in phone:
        return phone
    return f"{phone}@s.whatsapp.net"


# ── Service methods ──────────────────────────────────────────────────────────

async def list_instances(
    property_id: str,
    current_user: CurrentUser,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> List[WhatsAppInstance]:
    return await whatsapp_instance_repository.list_by_property(
        property_id, current_user.org_id, entity_type=entity_type, entity_id=entity_id
    )


async def create_instance(property_id: str, name: str, current_user: CurrentUser) -> WhatsAppInstance:
    """Create a WuzAPI user + store the instance in MongoDB."""
    token = uuid.uuid4().hex  # used as both wuzapi username and token

    # Create user in WuzAPI — endpoint: POST /admin/users
    wuzapi_user_id: Optional[str] = None
    try:
        result = await _wuzapi(
            "POST", "/admin/users", _admin_headers(),
            {"name": token, "token": token},
        )
        wuzapi_user_id = (result.get("data") or {}).get("id")
    except Exception as exc:
        logger.error("wuzapi_create_user_failed", exc_info=exc)
        raise ValueError(f"Failed to create WuzAPI user: {exc}") from exc

    instance = WhatsAppInstance(
        org_id=current_user.org_id,
        property_id=property_id,
        name=name,
        wuzapi_token=token,
        wuzapi_user_id=wuzapi_user_id,
    )
    await whatsapp_instance_repository.create(instance)

    # Set per-instance webhook URL (uses internal Docker backend URL so WuzAPI can reach us)
    backend_url = settings.wuzapi_backend_webhook_base.rstrip("/")
    webhook_url = f"{backend_url}/api/v1/webhooks/whatsapp/{instance.webhook_token}"
    try:
        await _wuzapi("POST", "/webhook", _user_headers(token), {"webhookURL": webhook_url})
    except Exception as exc:
        logger.warning("wuzapi_set_webhook_failed", exc_info=exc)

    logger.info("whatsapp_instance_created", org_id=current_user.org_id, instance_id=str(instance.id))
    return instance


async def connect_instance(instance_id: str, current_user: CurrentUser) -> WhatsAppInstance:
    """Start WuzAPI session → QR code will arrive via webhook."""
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")

    try:
        await _wuzapi(
            "POST", "/session/connect", _user_headers(instance.wuzapi_token),
            {"Subscribe": ["Message", "ReadReceipt", "Presence", "ChatPresence", "All"],
             "Immediate": True},
        )
    except Exception as exc:
        logger.error("wuzapi_connect_failed", instance_id=instance_id, exc_info=exc)
        raise ValueError(f"Failed to connect: {exc}") from exc

    instance = await whatsapp_instance_repository.update(instance, {"status": "connecting", "qr_code": None})
    await _publish_ws(instance.org_id, {
        "type": "whatsapp_status",
        "instance_id": str(instance.id),
        "status": "connecting",
    })
    return instance


async def disconnect_instance(instance_id: str, current_user: CurrentUser) -> WhatsAppInstance:
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")
    try:
        await _wuzapi("POST", "/session/disconnect", _user_headers(instance.wuzapi_token))
    except Exception:
        pass
    return await whatsapp_instance_repository.update(instance, {"status": "disconnected", "qr_code": None})


async def logout_instance(instance_id: str, current_user: CurrentUser) -> WhatsAppInstance:
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")
    try:
        await _wuzapi("POST", "/session/logout", _user_headers(instance.wuzapi_token))
    except Exception:
        pass
    return await whatsapp_instance_repository.update(
        instance, {"status": "logged_out", "qr_code": None, "phone_number": None, "push_name": None}
    )


async def delete_instance(instance_id: str, current_user: CurrentUser) -> None:
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")
    try:
        if instance.wuzapi_user_id:
            await _wuzapi("DELETE", f"/admin/users/{instance.wuzapi_user_id}", _admin_headers())
    except Exception:
        pass
    await whatsapp_instance_repository.soft_delete(instance)


async def get_qr(instance_id: str, current_user: CurrentUser) -> Optional[str]:
    """Fetch latest QR directly from WuzAPI (fallback to stored)."""
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise ValueError("Instance not found")
    try:
        data = await _wuzapi("GET", "/session/qr", _user_headers(instance.wuzapi_token))
        inner = data.get("data") or {}
        qr = inner.get("QRCode") or inner.get("qrcode") or data.get("QRCode") or data.get("qr")
        if qr:
            await whatsapp_instance_repository.update(instance, {"qr_code": qr})
            return qr
    except Exception:
        pass
    return instance.qr_code


# ── Webhook processor ────────────────────────────────────────────────────────

async def process_webhook(webhook_token: str, payload: Dict[str, Any]) -> None:
    """Receive a raw WuzAPI webhook payload, persist it, and broadcast via WS."""
    instance = await whatsapp_instance_repository.get_by_webhook_token(webhook_token)
    if not instance:
        logger.warning("whatsapp_webhook_unknown_token", webhook_token=webhook_token)
        return

    # Log raw payload keys to aid debugging
    logger.info("whatsapp_webhook_raw",
                instance_id=str(instance.id),
                payload_keys=list(payload.keys()),
                payload_preview=str(payload)[:300])

    # Normalise event type.
    # WuzAPI form-encoded payloads: "type" = event name string, "event" = event data (dict or string)
    # Prefer "type" (always a string), fall back to "event" only when it's a string.
    _raw_type = payload.get("type") or payload.get("Type")
    _raw_event = payload.get("event")
    if isinstance(_raw_type, str) and _raw_type:
        event_type: Any = _raw_type
    elif isinstance(_raw_event, str) and _raw_event:
        event_type = _raw_event
    else:
        event_type = "unknown"
    event_type = event_type.split(".")[-1]  # "message.received" → "received"

    logger.info("whatsapp_webhook_event_type",
                instance_id=str(instance.id),
                event_type=event_type,
                payload_keys=list(payload.keys()))

    # Handle QR code update — WuzAPI: type="code", qrCodeBase64="data:image/png;..."
    if event_type in ("QR", "qr", "qrcode", "code"):
        _d = payload.get("data") or {}
        qr = (
            payload.get("qrCodeBase64")       # WuzAPI form-encoded format
            or payload.get("QRCode")           # WuzAPI JSON format
            or _d.get("QRCode")
            or _d.get("qrcode")
            or payload.get("qr")
        )
        if qr:
            instance = await whatsapp_instance_repository.update(
                instance, {"qr_code": qr, "status": "connecting"}
            )

    # Handle connected (PairSuccess = QR scanned + phone approved)
    elif event_type in ("Connected", "connected", "ready", "PairSuccess", "pair_success"):
        # WuzAPI PairSuccess: event = {"ID": "254700000000:3@s.whatsapp.net", "BusinessName": "..."}
        _ev = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        _jid = (
            (_ev.get("ID") or "")                           # "254700000000:3@s.whatsapp.net"
            or payload.get("data", {}).get("jid", "")
        )
        phone = _jid.split("@")[0].split(":")[0] if _jid else (
            payload.get("phoneNumber") or payload.get("phone")
        )
        push_name = (
            _ev.get("BusinessName")
            or payload.get("pushName")
            or payload.get("data", {}).get("pushName")
        )
        instance = await whatsapp_instance_repository.update(
            instance,
            {"status": "connected", "qr_code": None,
             "phone_number": phone or instance.phone_number,
             "push_name": push_name or instance.push_name},
        )

    # Handle logged out
    elif event_type in ("LoggedOut", "logged_out", "logout"):
        instance = await whatsapp_instance_repository.update(
            instance, {"status": "logged_out", "qr_code": None, "phone_number": None}
        )

    # Download + store media if present
    media_key: Optional[str] = None
    media_content_type: Optional[str] = None
    if event_type not in ("QR", "qr", "qrcode",
                          "Connected", "connected", "ready", "PairSuccess", "pair_success",
                          "LoggedOut", "logged_out", "logout"):
        media_info = _detect_media(payload)
        if media_info:
            content_type = media_info.get("mimetype", "application/octet-stream")
            msg_body = payload.get("body") or payload.get("data") or {}
            message_id = (
                msg_body.get("key", {}).get("id")
                or msg_body.get("id")
                or uuid.uuid4().hex
            )
            raw = await _download_from_wuzapi(instance.wuzapi_token, payload, media_info)
            if raw:
                media_key = await _store_media_in_minio(
                    instance.org_id, str(instance.id), raw, content_type, message_id
                )
                media_content_type = content_type

    # Persist event
    event = WhatsAppEvent(
        org_id=instance.org_id,
        instance_id=str(instance.id),
        event_type=event_type,
        payload=payload,
        media_key=media_key,
        media_content_type=media_content_type,
    )
    await whatsapp_event_repository.create(event)

    # Broadcast to frontend via WebSocket
    await _publish_ws(instance.org_id, {
        "type": "whatsapp_event",
        "instance_id": str(instance.id),
        "event_type": event_type,
        "status": instance.status,
        "qr_code": instance.qr_code,
        "payload": payload,
        "received_at": event.received_at.isoformat(),
    })

    logger.info(
        "whatsapp_event_received",
        action="process_webhook",
        resource_type="whatsapp_event",
        resource_id=str(event.id),
        org_id=instance.org_id,
        instance_id=str(instance.id),
        event_type=event_type,
        status="success",
    )


# ── WhatsApp interaction methods ──────────────────────────────────────────────

async def check_number(instance_id: str, phone: str, current_user: CurrentUser) -> dict:
    """Check whether a phone number has a WhatsApp account."""
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi(
        "POST", "/user/check",
        _user_headers(instance.wuzapi_token),
        {"Phone": [_to_jid(phone)]},
    )


async def get_user_info(instance_id: str, phone: str, current_user: CurrentUser) -> dict:
    """Fetch the WhatsApp profile (name, avatar URL) for a phone number."""
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi(
        "POST", "/user/info",
        _user_headers(instance.wuzapi_token),
        {"Phone": [_to_jid(phone)]},
    )


async def mark_read(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Mark one or more messages as read.
    body: {"Id": ["msgId1", ...], "Chat": "254700000000@s.whatsapp.net"}
    """
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi("POST", "/chat/markread", _user_headers(instance.wuzapi_token), body)


async def react(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Add an emoji reaction to a message.
    body: {"Id": "msgId", "Chat": "...", "Reaction": "👍"}
    """
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi("POST", "/chat/react", _user_headers(instance.wuzapi_token), body)


async def _send(instance_id: str, wuzapi_path: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Generic send helper — forwards body to the given WuzAPI send path."""
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi("POST", wuzapi_path, _user_headers(instance.wuzapi_token), body)


async def send_text(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a plain-text message.
    body: {"Phone": "254700000000", "Body": "Hello", "Id": "optional"}
    """
    return await _send(instance_id, "/chat/send/text", body, current_user)


async def send_image(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send an image (base64 or URL).
    body: {"Phone": "...", "Image": "<base64|url>", "Caption": "..."}
    """
    return await _send(instance_id, "/chat/send/image", body, current_user)


async def send_audio(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send an audio file (base64 or URL).
    body: {"Phone": "...", "Audio": "<base64|url>"}
    """
    return await _send(instance_id, "/chat/send/audio", body, current_user)


async def send_document(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a document (base64 or URL).
    body: {"Phone": "...", "Document": "<base64|url>", "FileName": "report.pdf"}
    """
    return await _send(instance_id, "/chat/send/document", body, current_user)


async def send_video(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a video (base64 or URL).
    body: {"Phone": "...", "Video": "<base64|url>", "Caption": "..."}
    """
    return await _send(instance_id, "/chat/send/video", body, current_user)


async def send_buttons(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a message with quick-reply buttons.
    body: {"Phone": "...", "Content": "...", "Footer": "...",
           "Buttons": [{"ButtonId": "1", "ButtonText": "Yes"}]}
    """
    return await _send(instance_id, "/chat/send/buttons", body, current_user)


async def send_list(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a list-picker message.
    body: {"Phone": "...", "Title": "...", "Text": "...", "ButtonText": "Choose",
           "Sections": [{"Title": "Section", "Rows": [{"RowId": "1", "Title": "Item"}]}]}
    """
    return await _send(instance_id, "/chat/send/list", body, current_user)


async def send_poll(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Send a poll.
    body: {"Phone": "...", "Question": "Favourite colour?",
           "Options": ["Red", "Blue"], "MaxAnswer": 1}
    """
    return await _send(instance_id, "/chat/send/poll", body, current_user)


async def send_text_for_org(org_id: str, phone: str, message: str) -> bool:
    """Send a plain-text WhatsApp message using any connected instance for the org.

    Finds the first connected WhatsApp instance for the org, then sends via WuzAPI.
    The phone should be the tenant's *registered* number, not a call-context number.
    Returns True on success, False if no connected instance or send failed.
    """
    instance = await WhatsAppInstance.find_one(
        WhatsAppInstance.org_id == org_id,
        WhatsAppInstance.status == "connected",
        WhatsAppInstance.deleted_at == None,  # noqa: E711
    )
    if not instance:
        logger.warning("whatsapp_send_no_connected_instance", org_id=org_id)
        return False
    try:
        await _wuzapi(
            "POST", "/chat/send/text",
            _user_headers(instance.wuzapi_token),
            {"Phone": _to_jid(phone), "Body": message},
        )
        logger.info(
            "ai_whatsapp_sent",
            org_id=org_id,
            instance_id=str(instance.id),
            phone=phone,
        )
        return True
    except Exception as exc:
        logger.error("whatsapp_send_failed", org_id=org_id, phone=phone, exc_info=exc)
        return False


async def set_presence(instance_id: str, body: Dict[str, Any], current_user: CurrentUser) -> dict:
    """Set typing/presence indicator.
    body: {"Phone": "...", "Presence": "composing"}
    Presence values: composing | paused | available | unavailable | recording
    """
    instance = await _get_instance(instance_id, current_user)
    return await _wuzapi("POST", "/chat/presence", _user_headers(instance.wuzapi_token), body)
