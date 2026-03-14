"""
iot.lock_event queue handler.

Consumes IoTLockEventPayload published by the IoT service when a smart lock
device reports a state change (unlock/lock/tamper). Writes an access log
entry to the access_log collection and optionally creates a maintenance ticket
for tamper or battery_low events.

Idempotency: deduped by event_id stored in Redis for 24h.
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

QUEUE_NAME = "iot.lock_event"
_IDEMPOTENCY_TTL = 86_400  # 24 hours

# Event types that should trigger a maintenance ticket
_TICKET_EVENTS = {"tamper", "battery_low", "offline"}


def _to_oid(id_str) -> Optional[BsonObjectId]:
    try:
        return BsonObjectId(str(id_str)) if id_str else None
    except Exception:
        return None


async def _is_duplicate(event_id: str) -> bool:
    redis = get_redis()
    key = f"iot:lock_event:seen:{event_id}"
    result = await redis.set(key, "1", ex=_IDEMPOTENCY_TTL, nx=True)
    return result is None


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        event_id = payload.get("event_id", "")
        org_id = payload.get("org_id", "")
        device_uid = payload.get("device_uid", "")
        device_id = payload.get("device_id", "")
        unit_id = payload.get("unit_id")
        property_id = payload.get("property_id")
        event_type = payload.get("event_type", "")
        triggered_by = payload.get("triggered_by")
        access_method = payload.get("access_method")
        timestamp_raw = payload.get("timestamp")

        logger.info(
            "iot_lock_event_started",
            action="process_lock_event",
            org_id=org_id,
            device_uid=device_uid,
            event_type=event_type,
            unit_id=unit_id,
            event_id=event_id,
            status="started",
        )

        if await _is_duplicate(event_id):
            logger.info(
                "iot_lock_event_duplicate",
                action="process_lock_event",
                event_id=event_id,
                status="skipped",
            )
            return

        db = get_db()
        now = utc_now()

        # Write access log entry
        log_entry = {
            "_id": BsonObjectId(),
            "org_id": org_id,
            "device_uid": device_uid,
            "device_id": device_id,
            "unit_id": unit_id,
            "property_id": property_id,
            "event_type": event_type,
            "triggered_by": triggered_by,
            "access_method": access_method,
            "event_at": now,
            "raw_payload": payload.get("raw_telemetry", {}),
            "created_at": now,
            "deleted_at": None,
        }
        await db["device_access_logs"].insert_one(log_entry)

        logger.info(
            "iot_lock_event_logged",
            action="process_lock_event",
            org_id=org_id,
            device_uid=device_uid,
            event_type=event_type,
            log_id=str(log_entry["_id"]),
            status="success",
        )

        # Create a maintenance ticket for alert-level events
        if event_type in _TICKET_EVENTS and property_id:
            prop_oid = _to_oid(property_id)
            unit_oid = _to_oid(unit_id) if unit_id else None

            # Look up property for context
            prop = await db["properties"].find_one(
                {"_id": prop_oid, "org_id": org_id, "deleted_at": None}
            ) if prop_oid else None
            prop_name = prop.get("name", property_id) if prop else property_id

            unit_code = None
            if unit_oid:
                unit = await db["units"].find_one(
                    {"_id": unit_oid, "org_id": org_id, "deleted_at": None}
                )
                unit_code = unit.get("unit_code") if unit else None

            severity_map = {"tamper": "high", "battery_low": "medium", "offline": "low"}
            severity = severity_map.get(event_type, "medium")

            title_map = {
                "tamper": f"Smart lock tamper detected — {unit_code or device_uid}",
                "battery_low": f"Smart lock battery low — {unit_code or device_uid}",
                "offline": f"Smart lock offline — {unit_code or device_uid}",
            }
            title = title_map.get(event_type, f"Smart lock alert: {event_type}")

            ticket_id = BsonObjectId()
            ticket = {
                "_id": ticket_id,
                "org_id": org_id,
                "property_id": property_id,
                "unit_id": unit_id,
                "ticket_number": f"IOT-{str(ticket_id)[-6:].upper()}",
                "title": title,
                "description": (
                    f"IoT device {device_uid} reported event '{event_type}' "
                    f"at {now.isoformat()}. "
                    f"Property: {prop_name}. "
                    f"Unit: {unit_code or 'N/A'}."
                ),
                "category": "smart_lock",
                "priority": severity,
                "status": "open",
                "source": "iot_auto",
                "iot_device_uid": device_uid,
                "iot_event_id": event_id,
                "comments": [],
                "activities": [],
                "created_at": now,
                "updated_at": now,
                "deleted_at": None,
            }
            await db["tickets"].insert_one(ticket)

            logger.info(
                "iot_lock_event_ticket_created",
                action="process_lock_event",
                org_id=org_id,
                device_uid=device_uid,
                event_type=event_type,
                ticket_id=str(ticket_id),
                status="success",
            )


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
