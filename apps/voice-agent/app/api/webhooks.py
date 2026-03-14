"""Telnyx webhook handlers.

Telnyx sends call lifecycle events as HTTP POST to /webhook/telnyx.
We validate the signature, then:
  call.initiated → answer + start media stream
  call.hangup    → mark session complete (pipeline will clean up itself)

The media stream WebSocket is handled separately at /ws/media/{call_control_id}.
"""
import hashlib
import hmac
import json
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
import structlog

from app.core.config import settings
from app.core.database import get_db
from app.models.conversation import CallSessionDocument
from app.services import pms_api, notification as notif
from app.telnyx_utils import client as telnyx

router = APIRouter(prefix="/webhook", tags=["webhooks"])
logger = structlog.get_logger(__name__)


def _normalize_caller_number(raw: str) -> str:
    """Strip SIP URI decorations, returning a clean E.164 or local number string.

    Telnyx may send any of:
      +254723681977
      +254723681977;tag=abc123
      sip:+254723681977@sip.telnyx.com
      tel:+254723681977
    """
    raw = raw.strip()
    # Strip SIP/tel scheme
    for prefix in ("sip:", "tel:", "sips:"):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
    # Strip SIP domain (after @)
    raw = raw.split("@")[0]
    # Strip tag parameter (after ;)
    raw = raw.split(";")[0]
    return raw.strip()


def _verify_signature(request_body: bytes, signature: str) -> bool:
    """Verify Telnyx webhook signature using HMAC-SHA256."""
    if not settings.TELNYX_WEBHOOK_SECRET:
        return True   # skip in dev if not configured
    expected = hmac.new(
        settings.TELNYX_WEBHOOK_SECRET.encode(),
        request_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature or "")


async def _handle_call_initiated(data: dict) -> None:
    """Answer the call, pre-fetch tenant context, and start media streaming."""
    payload = data.get("payload", {})
    call_control_id: str = payload.get("call_control_id", "")
    caller_number: str = _normalize_caller_number(payload.get("from", ""))
    called_number: str = _normalize_caller_number(payload.get("to", settings.TELNYX_PHONE_NUMBER))

    logger.info(
        "call_initiated",
        action="handle_call_initiated",
        resource_type="call_session",
        caller=caller_number,
        status="started",
    )

    # ── Answer the call ───────────────────────────────────────────────────────
    answered = await telnyx.answer_call(call_control_id)
    if not answered:
        logger.error("call_answer_failed", call_control_id=call_control_id)
        return

    # ── Pre-fetch tenant context ──────────────────────────────────────────────
    tenant = await pms_api.find_tenant_by_phone(caller_number)
    tenant_id: str | None = (tenant or {}).get("id") or (tenant or {}).get("_id") or None
    tenant_name: str | None = None
    org_id: str | None = settings.DEFAULT_ORG_ID or None
    balance_due: float | None = None
    open_tickets: list[dict] = []
    lease_info: dict | None = None

    if tenant:
        tenant_name = tenant.get("name") or f"{tenant.get('first_name','')} {tenant.get('last_name','')}".strip()
        org_id = tenant.get("org_id") or org_id

        # Fetch supporting context concurrently
        invoices_task = asyncio.create_task(pms_api.get_tenant_invoices(tenant_id or "", page_size=5))
        tickets_task = asyncio.create_task(pms_api.get_tenant_tickets(tenant_id or "", page_size=10))
        lease_task = asyncio.create_task(pms_api.get_tenant_lease(tenant_id or ""))

        invoices, tickets, lease_info = await asyncio.gather(
            invoices_task, tickets_task, lease_task
        )

        balance_due = sum(i.get("balance_due", 0) for i in invoices if i.get("balance_due", 0) > 0)
        open_tickets = [
            t for t in tickets if t.get("status") not in ("resolved", "closed", "cancelled")
        ]

    # ── Create session document ───────────────────────────────────────────────
    db = get_db()
    session = CallSessionDocument.new(
        call_control_id=call_control_id,
        caller_number=caller_number,
        called_number=called_number,
        org_id=org_id,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        auto_mode=settings.AUTO_MODE_DEFAULT,
    )
    session["balance_due"] = balance_due
    session["recording_enabled"] = settings.RECORDING_ENABLED
    await db[CallSessionDocument.COLLECTION].insert_one(session)

    # ── Notify dashboard ──────────────────────────────────────────────────────
    if org_id:
        await notif.notify_incoming_call(
            org_id=org_id,
            call_control_id=call_control_id,
            caller_number=caller_number,
            tenant_id=tenant_id,
            tenant_name=tenant_name,
            tenant_email=tenant.get("email") if tenant else None,
            unit_label=(lease_info or {}).get("unit_label"),
            property_name=(lease_info or {}).get("property_name"),
            balance_due=balance_due,
            open_tickets=[
                {
                    "id": t.get("id"),
                    "title": t.get("title"),
                    "status": t.get("status"),
                    "priority": t.get("priority"),
                    "category": t.get("category"),
                }
                for t in open_tickets[:5]
            ],
            auto_answered=settings.AUTO_MODE_DEFAULT,
        )

    # ── Start media stream (only if auto mode — staff handle manually otherwise) ──
    if settings.AUTO_MODE_DEFAULT:
        stream_url = f"{settings.PUBLIC_BASE_URL}/ws/media/{call_control_id}"
        # Replace http(s) with ws(s)
        stream_url = stream_url.replace("https://", "wss://").replace("http://", "ws://")
        await telnyx.start_media_stream(call_control_id, stream_url)


async def _handle_call_hangup(data: dict) -> None:
    payload = data.get("payload", {})
    call_control_id: str = payload.get("call_control_id", "")
    db = get_db()
    # Pipeline's finally block handles the full cleanup; just log here
    logger.info(
        "call_hangup",
        action="handle_call_hangup",
        resource_type="call_session",
        resource_id=call_control_id,
        status="success",
    )
    await db[CallSessionDocument.COLLECTION].update_one(
        {"call_control_id": call_control_id, "status": "active"},
        {"$set": {"status": "completed"}},
    )


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/telnyx")
async def telnyx_webhook(request: Request, background_tasks: BackgroundTasks) -> Response:
    body = await request.body()
    sig = request.headers.get("telnyx-signature-ed25519", "")

    if not _verify_signature(body, sig):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event_type: str = event.get("data", {}).get("event_type", "")

    if event_type == "call.initiated":
        background_tasks.add_task(_handle_call_initiated, event.get("data", {}))
    elif event_type in ("call.hangup", "call.answered"):
        if event_type == "call.hangup":
            background_tasks.add_task(_handle_call_hangup, event.get("data", {}))

    # Telnyx expects 200 OK quickly
    return Response(status_code=200)
