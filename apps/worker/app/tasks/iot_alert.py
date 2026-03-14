"""
iot.alert queue handler.

Consumes IoTAlertPayload published by the IoT service for environmental
alerts (smoke, water_leak, motion, custom). Creates a maintenance ticket
and, for critical severity, publishes a WebSocket notification to the org.

Idempotency: deduped by event_id in Redis for 24h.
"""
import json
import uuid
from typing import Optional

import aio_pika
from bson import ObjectId as BsonObjectId

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.utils.datetime import utc_now

logger = get_logger(__name__)

QUEUE_NAME = "iot.alert"
_IDEMPOTENCY_TTL = 86_400


def _to_oid(id_str) -> Optional[BsonObjectId]:
    try:
        return BsonObjectId(str(id_str)) if id_str else None
    except Exception:
        return None


async def _is_duplicate(event_id: str) -> bool:
    redis = get_redis()
    key = f"iot:alert:seen:{event_id}"
    result = await redis.set(key, "1", ex=_IDEMPOTENCY_TTL, nx=True)
    return result is None


async def _publish_ws(org_id: str, title: str, message: str, data: dict) -> None:
    try:
        redis = get_redis()
        payload = json.dumps({
            "id": str(uuid.uuid4()),
            "type": "iot_alert",
            "title": title,
            "message": message,
            "data": data,
            "org_id": org_id,
            "timestamp": utc_now().isoformat(),
        })
        await redis.publish(f"ws:notifications:{org_id}", payload)
    except Exception as exc:
        logger.warning("iot_ws_notify_failed", org_id=org_id, exc_info=exc)


_PRIORITY_MAP = {
    "critical": "urgent",
    "high": "high",
    "medium": "medium",
    "low": "low",
}


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        event_id = payload.get("event_id", "")
        org_id = payload.get("org_id", "")
        device_uid = payload.get("device_uid", "")
        device_id = payload.get("device_id", "")
        unit_id = payload.get("unit_id")
        property_id = payload.get("property_id")
        alert_type = payload.get("alert_type", "custom")
        severity = payload.get("severity", "medium")
        alert_message = payload.get("message", f"Alert: {alert_type}")

        logger.info(
            "iot_alert_started",
            action="process_iot_alert",
            org_id=org_id,
            device_uid=device_uid,
            alert_type=alert_type,
            severity=severity,
            event_id=event_id,
            status="started",
        )

        if await _is_duplicate(event_id):
            logger.info(
                "iot_alert_duplicate",
                action="process_iot_alert",
                event_id=event_id,
                status="skipped",
            )
            return

        db = get_db()
        now = utc_now()

        # Resolve property name and unit code for context
        prop_name = property_id or "Unknown property"
        unit_code = None

        prop_oid = _to_oid(property_id)
        if prop_oid:
            prop = await db["properties"].find_one(
                {"_id": prop_oid, "org_id": org_id, "deleted_at": None}
            )
            if prop:
                prop_name = prop.get("name", property_id)

        unit_oid = _to_oid(unit_id)
        if unit_oid:
            unit = await db["units"].find_one(
                {"_id": unit_oid, "org_id": org_id, "deleted_at": None}
            )
            if unit:
                unit_code = unit.get("unit_code")

        title = f"[{alert_type.replace('_', ' ').title()}] {unit_code or device_uid} — {prop_name}"
        priority = _PRIORITY_MAP.get(severity, "medium")

        ticket_id = BsonObjectId()
        ticket = {
            "_id": ticket_id,
            "org_id": org_id,
            "property_id": property_id,
            "unit_id": unit_id,
            "ticket_number": f"IOT-{str(ticket_id)[-6:].upper()}",
            "title": title,
            "description": (
                f"IoT alert from device {device_uid}: {alert_message}\n"
                f"Alert type: {alert_type}, Severity: {severity}\n"
                f"Event ID: {event_id}"
            ),
            "category": "iot_alert",
            "priority": priority,
            "status": "open",
            "source": "iot_auto",
            "iot_device_uid": device_uid,
            "iot_event_id": event_id,
            "iot_alert_type": alert_type,
            "iot_severity": severity,
            "comments": [],
            "activities": [],
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        }
        await db["tickets"].insert_one(ticket)

        logger.info(
            "iot_alert_ticket_created",
            action="process_iot_alert",
            org_id=org_id,
            device_uid=device_uid,
            alert_type=alert_type,
            ticket_id=str(ticket_id),
            status="success",
        )

        # Push real-time WebSocket notification for critical/high alerts
        if severity in ("critical", "high"):
            await _publish_ws(
                org_id=org_id,
                title=f"IoT Alert: {alert_type.replace('_', ' ').title()}",
                message=alert_message,
                data={
                    "device_uid": device_uid,
                    "alert_type": alert_type,
                    "severity": severity,
                    "unit_id": unit_id,
                    "unit_code": unit_code,
                    "property_id": property_id,
                    "ticket_id": str(ticket_id),
                },
            )


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
