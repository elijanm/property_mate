"""
Unit generation worker task.
Consumes from property.units.generate queue.
Idempotent: uses MongoDB $setOnInsert upsert so retries are safe.
"""
import json
import uuid
from typing import Any, Dict, List, Optional

import aio_pika
from beanie import Document, PydanticObjectId
from app.core.database import get_db
from app.core.logging import get_logger
from app.utils.datetime import utc_now

logger = get_logger(__name__)

QUEUE_NAME = "property.units.generate"


# ── Unit code generation (mirrors property_service.py — keep in sync) ─────────

def _generate_unit_code(wing: Optional[str], floor: int, unit_number: str) -> str:
    floor_part = f"{floor:02d}"
    try:
        unit_part = f"{int(unit_number):02d}"
    except ValueError:
        unit_part = unit_number.upper()
    if wing:
        return f"{wing.upper()}-{floor_part}{unit_part}"
    return f"{floor_part}{unit_part}"


def _expand_templates(wings: List[dict], unit_templates: List[dict]) -> List[dict]:
    units: List[dict] = []
    wing_names = [w["name"] for w in wings] if wings else [None]

    for template in unit_templates:
        target_wings = template.get("wings") or wing_names
        unit_ids: List[str] = template.get("unit_numbers") or []
        if not unit_ids and template.get("units_per_floor"):
            unit_ids = [str(i) for i in range(1, template["units_per_floor"] + 1)]
        if not unit_ids:
            continue

        for wing_name in target_wings:
            for floor in range(template["floors_start"], template["floors_end"] + 1):
                for unit_num in unit_ids:
                    units.append(
                        {
                            "wing": wing_name,
                            "floor": floor,
                            "unit_number": unit_num,
                            "unit_code": _generate_unit_code(wing_name, floor, unit_num),
                            "unit_type": template.get("unit_type", "standard"),
                            "rent_base": template.get("rent_base"),
                            "deposit_amount": template.get("deposit_amount"),
                            "deposit_rule": template.get("deposit_rule"),
                            "size": template.get("size"),
                            "furnished": template.get("furnished", False),
                            "is_premium": template.get("is_premium", False),
                        }
                    )

    seen: set = set()
    deduped = []
    for u in units:
        if u["unit_code"] not in seen:
            seen.add(u["unit_code"])
            deduped.append(u)
    return deduped


async def _process(payload: Dict[str, Any]) -> None:
    job_id = payload["job_id"]
    org_id = payload["org_id"]
    user_id = payload.get("user_id", "system")
    property_id = PydanticObjectId(payload["property_id"])
    wings = payload.get("wings", [])
    unit_templates = payload.get("unit_templates", [])

    db = get_db()
    now = utc_now()

    # Mark job in_progress
    await db.job_runs.update_one(
        {"_id": job_id},
        {"$set": {"status": "in_progress", "updated_at": now}, "$inc": {"attempts": 1}},
    )

    logger.info(
        "unit_generation_started",
        action="unit_generation",
        resource_type="property",
        resource_id=property_id,
        org_id=org_id,
        user_id=user_id,
        status="started",
    )

    unit_specs = _expand_templates(wings, unit_templates)
    created = 0
    failed = 0

    for spec in unit_specs:
        try:
            result = await db.units.update_one(
                {
                    "org_id": org_id,
                    "property_id": property_id,
                    "unit_code": spec["unit_code"],
                    "deleted_at": None,
                },
                {
                    "$setOnInsert": {
                        "_id": str(uuid.uuid4()),
                        "org_id": org_id,
                        "property_id": property_id,
                        "unit_code": spec["unit_code"],
                        "wing": spec["wing"],
                        "floor": spec["floor"],
                        "unit_number": spec["unit_number"],
                        "unit_type": spec["unit_type"],
                        "size": spec["size"],
                        "furnished": spec["furnished"],
                        "is_premium": spec["is_premium"],
                        "status": "vacant",
                        "rent_base": spec["rent_base"],
                        "deposit_amount": spec["deposit_amount"],
                        "deposit_rule": spec["deposit_rule"],
                        "utility_overrides": None,
                        "meter_id": None,
                        "iot_device_id": None,
                        "deleted_at": None,
                        "created_at": now,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
            if result.upserted_id:
                created += 1
        except Exception as exc:
            failed += 1
            logger.error(
                "unit_upsert_failed",
                action="unit_generation",
                resource_type="unit",
                resource_id=spec["unit_code"],
                org_id=org_id,
                status="error",
                error=str(exc),
            )

    # Update property unit_count
    total_units = await db.units.count_documents(
        {"org_id": org_id, "property_id": property_id, "deleted_at": None}
    )
    await db.properties.update_one(
        {"_id": property_id, "org_id": org_id},
        {"$set": {"unit_count": total_units, "updated_at": now}},
    )

    status = "completed" if failed == 0 else "failed"
    await db.job_runs.update_one(
        {"_id": job_id},
        {
            "$set": {
                "status": status,
                "result": {"created": created, "failed": failed, "total": len(unit_specs)},
                "updated_at": now,
                "completed_at": now,
            }
        },
    )

    logger.info(
        "unit_generation_completed",
        action="unit_generation",
        resource_type="property",
        resource_id=property_id,
        org_id=org_id,
        user_id=user_id,
        status=status,
        duration_ms=0,
    )


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        try:
            payload = json.loads(message.body)
            await _process(payload)
        except Exception as exc:
            logger.error(
                "unit_generation_error",
                action="unit_generation",
                status="error",
                error=str(exc),
            )
            raise


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
