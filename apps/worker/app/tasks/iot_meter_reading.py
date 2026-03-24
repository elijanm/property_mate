"""
iot.meter_reading queue handler.

Consumes IoTMeterReadingPayload published by the IoT service when a smart
meter device reports a reading via MQTT telemetry. Applies the reading to
the active invoice for the tenant occupying the unit so that billing reflects
real-time consumption.

Idempotency: the message event_id is stored in Redis for 24h. If an identical
event_id arrives again, the message is acked immediately without reprocessing.
"""
import json
from datetime import datetime, timezone
from typing import Optional

import aio_pika
from bson import ObjectId as BsonObjectId

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.metrics import task_metrics_wrap
from app.core.redis import get_redis
from app.utils.datetime import utc_now

logger = get_logger(__name__)

QUEUE_NAME = "iot.meter_reading"
_IDEMPOTENCY_TTL = 86_400  # 24 hours


def _to_oid(id_str) -> Optional[BsonObjectId]:
    try:
        return BsonObjectId(str(id_str)) if id_str else None
    except Exception:
        return None


async def _is_duplicate(event_id: str) -> bool:
    redis = get_redis()
    key = f"iot:meter_reading:seen:{event_id}"
    result = await redis.set(key, "1", ex=_IDEMPOTENCY_TTL, nx=True)
    return result is None  # nx=True returns None if key already existed


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        event_id = payload.get("event_id", "")
        org_id = payload.get("org_id", "")
        device_uid = payload.get("device_uid", "")
        unit_id = payload.get("unit_id")
        utility_key = payload.get("utility_key", "")
        reading_value = payload.get("reading_value")
        meter_number = payload.get("meter_number")
        reading_at_raw = payload.get("reading_at")

        logger.info(
            "iot_meter_reading_started",
            action="apply_meter_reading",
            org_id=org_id,
            device_uid=device_uid,
            unit_id=unit_id,
            utility_key=utility_key,
            reading_value=reading_value,
            event_id=event_id,
            status="started",
        )

        if await _is_duplicate(event_id):
            logger.info(
                "iot_meter_reading_duplicate",
                action="apply_meter_reading",
                event_id=event_id,
                status="skipped",
            )
            return

        if not unit_id or reading_value is None:
            logger.warning(
                "iot_meter_reading_invalid",
                action="apply_meter_reading",
                org_id=org_id,
                event_id=event_id,
                reason="missing unit_id or reading_value",
                status="error",
            )
            return

        db = get_db()
        unit_oid = _to_oid(unit_id)
        if not unit_oid:
            logger.warning(
                "iot_meter_reading_bad_unit_id",
                action="apply_meter_reading",
                unit_id=unit_id,
                status="error",
            )
            return

        # Find the unit to get property_id and meter info
        unit = await db["units"].find_one(
            {"_id": unit_oid, "org_id": org_id, "deleted_at": None}
        )
        if not unit:
            logger.warning(
                "iot_meter_reading_unit_not_found",
                action="apply_meter_reading",
                unit_id=unit_id,
                org_id=org_id,
                status="error",
            )
            return

        property_id = str(unit.get("property_id", ""))

        # Update unit meter_reading_cache so billing picks it up next cycle
        reading_at = datetime.fromisoformat(reading_at_raw) if reading_at_raw else utc_now()
        await db["units"].update_one(
            {"_id": unit_oid, "org_id": org_id},
            {
                "$set": {
                    f"meter_reading_cache.{utility_key or 'water'}": {
                        "value": reading_value,
                        "read_at": reading_at,
                        "read_by": device_uid,
                        "read_by_name": f"IoT:{device_uid}",
                    },
                    "updated_at": utc_now(),
                }
            },
        )

        # If a meter_number was provided and unit doesn't have one set it
        if meter_number:
            await db["units"].update_one(
                {"_id": unit_oid, "org_id": org_id, "meter_number": None},
                {"$set": {"meter_number": meter_number}},
            )

        # Persist to meter_readings collection so billing can pick up IoT readings
        reading_doc = {
            "_id": BsonObjectId(),
            "org_id": org_id,
            "property_id": property_id,
            "unit_id": unit_id,
            "utility_key": utility_key or "water",
            "previous_reading": None,  # will be set by billing service via get_latest
            "current_reading": reading_value,
            "units_consumed": None,
            "read_at": reading_at,
            "read_by": device_uid,
            "source": "iot",
            "notes": f"IoT meter reading from device {device_uid}",
            "deleted_at": None,
            "created_at": utc_now(),
        }
        await db["meter_readings"].insert_one(reading_doc)

        # Update unit.iot_device_id if not set and device_uid known
        if device_uid:
            await db["units"].update_one(
                {"_id": unit_oid, "org_id": org_id, "iot_device_id": None},
                {"$set": {"iot_device_id": payload.get("device_id", ""), "updated_at": utc_now()}},
            )

        # Try to find an open (draft/pending) invoice for this unit and update
        # the relevant line item with the current reading (auto-computes usage)
        now = utc_now()
        billing_month = now.strftime("%Y-%m")

        invoice = await db["invoices"].find_one(
            {
                "org_id": org_id,
                "unit_id": str(unit_oid),
                "billing_month": billing_month,
                "status": {"$in": ["draft", "pending"]},
                "deleted_at": None,
            },
            sort=[("created_at", -1)],
        )

        if invoice:
            # Update the matching line item's current_reading
            line_items = invoice.get("line_items", [])
            updated = False
            for item in line_items:
                if item.get("utility_key") == utility_key:
                    item["current_reading"] = reading_value
                    item["updated_at"] = now
                    updated = True
                    break

            if updated:
                await db["invoices"].update_one(
                    {"_id": invoice["_id"]},
                    {"$set": {"line_items": line_items, "updated_at": now}},
                )
                logger.info(
                    "iot_meter_reading_applied_to_invoice",
                    action="apply_meter_reading",
                    org_id=org_id,
                    unit_id=unit_id,
                    invoice_id=str(invoice["_id"]),
                    utility_key=utility_key,
                    reading_value=reading_value,
                    status="success",
                )
                return

        # No active invoice — reading cached on unit for next billing run
        logger.info(
            "iot_meter_reading_cached",
            action="apply_meter_reading",
            org_id=org_id,
            unit_id=unit_id,
            utility_key=utility_key,
            reading_value=reading_value,
            property_id=property_id,
            status="success",
        )


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(task_metrics_wrap(QUEUE_NAME, "iot_meter_reading", handle))
