"""
iot.device_lifecycle queue handler.

On "provisioned" — stock-out the device serial from inventory (meter installed in unit).
On "decommissioned" — stock-in the device serial back to inventory (meter removed).
"""
import json
from typing import Optional

import aio_pika
from bson import ObjectId as BsonObjectId

from app.core.database import get_db
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.utils.datetime import utc_now

logger = get_logger(__name__)

QUEUE_NAME = "iot.device_lifecycle"
_IDEMPOTENCY_TTL = 86_400


def _to_oid(s) -> Optional[BsonObjectId]:
    try:
        return BsonObjectId(str(s)) if s else None
    except Exception:
        return None


async def _is_duplicate(key: str) -> bool:
    redis = get_redis()
    result = await redis.set(f"iot:lifecycle:seen:{key}", "1", ex=_IDEMPOTENCY_TTL, nx=True)
    return result is None


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        event             = payload.get("event", "")
        org_id            = payload.get("org_id", "")
        device_id         = payload.get("device_id", "")
        device_uid        = payload.get("device_uid", "")
        unit_id           = payload.get("unit_id")
        inventory_item_id = payload.get("inventory_item_id")
        serial_number     = payload.get("inventory_serial_number")

        idem_key = f"{event}:{device_id}"
        if await _is_duplicate(idem_key):
            logger.info("device_lifecycle_duplicate", event=event, device_uid=device_uid)
            return

        if not inventory_item_id:
            # No inventory item linked — nothing to stock-out/in
            logger.info("device_lifecycle_no_inventory", event=event, device_uid=device_uid)
            return

        db = get_db()
        now = utc_now()
        item_oid = _to_oid(inventory_item_id)
        if not item_oid:
            logger.warning("device_lifecycle_bad_item_id", inventory_item_id=inventory_item_id)
            return

        item = await db["inventory_items"].find_one(
            {"_id": item_oid, "org_id": org_id, "deleted_at": None}
        )
        if not item:
            logger.warning("device_lifecycle_item_not_found", inventory_item_id=inventory_item_id)
            return

        logger.info("device_lifecycle_started", event=event, device_uid=device_uid, org_id=org_id, status="started", action="device_lifecycle", resource_type="inventory_item", resource_id=inventory_item_id)

        if event == "provisioned":
            # Stock-out: mark serial as dispatched
            movement = {
                "id": str(BsonObjectId()),
                "movement_type": "stock_out",
                "quantity": 1,
                "unit_of_measure": item.get("unit_of_measure", "unit"),
                "reference": f"Device provisioned: {device_uid}",
                "notes": f"Auto stock-out — IoT device {device_uid} provisioned to unit {unit_id or 'unassigned'}",
                "unit_id": unit_id,
                "serial_numbers": [serial_number] if serial_number else [],
                "serial_count": 1 if serial_number else 0,
                "created_at": now,
                "updated_at": now,
                "created_by": "system",
            }

            if serial_number:
                # Update serial status to dispatched
                await db["inventory_items"].update_one(
                    {"_id": item_oid, "serials.serial_number": serial_number},
                    {"$set": {"serials.$.status": "dispatched", "serials.$.updated_at": now, "updated_at": now}},
                )
            # Decrement stock level
            await db["inventory_items"].update_one(
                {"_id": item_oid},
                {"$push": {"movements": movement}, "$inc": {"total_stock_in_qty": 0, "total_stock_out_qty": 1}, "$set": {"updated_at": now}},
            )
            logger.info("device_lifecycle_stocked_out", device_uid=device_uid, inventory_item_id=inventory_item_id, status="success", action="device_lifecycle", resource_type="inventory_item", resource_id=inventory_item_id)

        elif event == "decommissioned":
            # Stock-in: mark serial as returned
            movement = {
                "id": str(BsonObjectId()),
                "movement_type": "return",
                "quantity": 1,
                "unit_of_measure": item.get("unit_of_measure", "unit"),
                "reference": f"Device decommissioned: {device_uid}",
                "notes": f"Auto stock-in — IoT device {device_uid} decommissioned from unit {unit_id or 'unassigned'}",
                "unit_id": unit_id,
                "serial_numbers": [serial_number] if serial_number else [],
                "serial_count": 1 if serial_number else 0,
                "created_at": now,
                "updated_at": now,
                "created_by": "system",
            }
            if serial_number:
                await db["inventory_items"].update_one(
                    {"_id": item_oid, "serials.serial_number": serial_number},
                    {"$set": {"serials.$.status": "returned", "serials.$.updated_at": now, "updated_at": now}},
                )
            await db["inventory_items"].update_one(
                {"_id": item_oid},
                {"$push": {"movements": movement}, "$inc": {"total_stock_out_qty": -1}, "$set": {"updated_at": now}},
            )
            logger.info("device_lifecycle_stocked_in", device_uid=device_uid, inventory_item_id=inventory_item_id, status="success", action="device_lifecycle", resource_type="inventory_item", resource_id=inventory_item_id)


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
