"""Publish WebSocket notifications to PMS dashboard via Redis pub/sub.

Format mirrors the existing WS notification format so the frontend
IncomingCallModal and NotificationCenter pick them up automatically.
"""
import json
import uuid
from datetime import datetime, timezone
import structlog
from app.core.database import get_redis
from app.core.config import settings

logger = structlog.get_logger(__name__)

WS_CHANNEL = "ws:notifications:{org_id}"


async def _publish(org_id: str, payload: dict) -> None:
    try:
        redis = await get_redis()
        channel = WS_CHANNEL.format(org_id=org_id)
        await redis.publish(channel, json.dumps(payload))
    except Exception as exc:
        logger.warning("notification_publish_failed", error=str(exc))


def _base_event(event_type: str, title: str, message: str, org_id: str, data: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "type": event_type,
        "title": title,
        "message": message,
        "data": data,
        "org_id": org_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def notify_incoming_call(
    *,
    org_id: str,
    call_control_id: str,
    caller_number: str,
    tenant_id: str | None = None,
    tenant_name: str | None = None,
    tenant_email: str | None = None,
    unit_label: str | None = None,
    property_name: str | None = None,
    balance_due: float | None = None,
    open_tickets: list[dict] | None = None,
    auto_answered: bool = False,
) -> None:
    payload = _base_event(
        "incoming_call",
        "Incoming Call",
        f"Call from {tenant_name or caller_number}",
        org_id,
        {
            "call_id": call_control_id,
            "caller_number": caller_number,
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "tenant_email": tenant_email,
            "unit_label": unit_label,
            "property_name": property_name,
            "balance_due": balance_due,
            "open_tickets": open_tickets or [],
            "auto_answered": auto_answered,
            "transcript": "",
        },
    )
    await _publish(org_id, payload)


async def notify_call_updated(
    *,
    org_id: str,
    call_control_id: str,
    transcript: str,
) -> None:
    payload = _base_event(
        "call_updated",
        "Call in Progress",
        "AI agent is handling the call",
        org_id,
        {"call_id": call_control_id, "transcript": transcript},
    )
    await _publish(org_id, payload)


async def notify_caller_identified(
    *,
    org_id: str,
    call_control_id: str,
    caller_number: str,
    tenant_id: str | None = None,
    tenant_name: str | None = None,
    tenant_email: str | None = None,
    unit_label: str | None = None,
    property_name: str | None = None,
    balance_due: float | None = None,
    open_tickets: list[dict] | None = None,
) -> None:
    """Emit a call_updated event when the caller is identified mid-call.

    Uses call_updated (not incoming_call) so the dashboard merges the tenant
    data into the existing call panel without replaying the ring sound.
    """
    payload = _base_event(
        "call_updated",
        "Caller Identified",
        f"Caller identified as {tenant_name or caller_number}",
        org_id,
        {
            "call_id": call_control_id,
            "caller_number": caller_number,
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "tenant_email": tenant_email,
            "unit_label": unit_label,
            "property_name": property_name,
            "balance_due": balance_due,
            "open_tickets": open_tickets or [],
        },
    )
    await _publish(org_id, payload)


async def notify_call_ended(
    *,
    org_id: str,
    call_control_id: str,
    duration_seconds: int | None = None,
    summary: str | None = None,
    actions_taken: list[str] | None = None,
) -> None:
    dur = f"{duration_seconds}s" if duration_seconds else "unknown duration"
    payload = _base_event(
        "call_ended",
        "Call Ended",
        f"Call ended after {dur}",
        org_id,
        {
            "call_id": call_control_id,
            "duration_seconds": duration_seconds,
            "summary": summary,
            "actions_taken": actions_taken or [],
        },
    )
    await _publish(org_id, payload)


async def notify_call_action(
    *,
    org_id: str,
    call_control_id: str,
    action: str,
    detail: str,
) -> None:
    """Notify dashboard of a specific action taken during call (payment sent, ticket created, etc.)."""
    payload = _base_event(
        "call_action",
        f"Call Action: {action}",
        detail,
        org_id,
        {"call_id": call_control_id, "action": action, "detail": detail},
    )
    await _publish(org_id, payload)


async def notify_keyword_alert(
    *,
    org_id: str,
    call_control_id: str,
    keyword: str,
    context: str,
) -> None:
    """Alert dashboard when a legally sensitive keyword is detected in the call."""
    payload = _base_event(
        "keyword_alert",
        "Keyword Alert",
        f"Sensitive keyword detected: '{keyword}'",
        org_id,
        {
            "call_id": call_control_id,
            "keyword": keyword,
            "context": context,
        },
    )
    await _publish(org_id, payload)


async def notify_unresolved_call(
    *,
    org_id: str,
    call_control_id: str,
    caller_number: str,
    tenant_name: str | None = None,
    duration_seconds: int | None = None,
) -> None:
    """Alert dashboard that a call ended without resolution — needs follow-up."""
    name = tenant_name or caller_number
    payload = _base_event(
        "unresolved_call",
        "Unresolved Call",
        f"Call from {name} ended without resolution — follow-up needed",
        org_id,
        {
            "call_id": call_control_id,
            "caller_number": caller_number,
            "tenant_name": tenant_name,
            "duration_seconds": duration_seconds,
        },
    )
    await _publish(org_id, payload)
