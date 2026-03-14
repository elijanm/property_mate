"""
Publishes IoT events to RabbitMQ queues consumed by the PMS worker.
"""
from typing import Any, Dict, Optional
from app.core.rabbitmq import publish
from app.core.logging import get_logger

logger = get_logger(__name__)

QUEUE_IOT_METER_READING = "iot.meter_reading"
QUEUE_IOT_LOCK_EVENT    = "iot.lock_event"
QUEUE_IOT_ALERT         = "iot.alert"
QUEUE_IOT_DEVICE_STATUS = "iot.device_status"


async def publish_meter_reading(
    org_id: str,
    property_id: str,
    device_id: str,
    device_uid: str,
    unit_id: Optional[str],
    meter_number: str,
    current_reading: float,
    previous_reading: Optional[float],
    utility_key: Optional[str],
    unit_of_measure: str = "units",
    raw_telemetry: Optional[Dict[str, Any]] = None,
) -> None:
    await publish(QUEUE_IOT_METER_READING, {
        "org_id": org_id,
        "property_id": property_id,
        "device_id": device_id,
        "device_uid": device_uid,
        "unit_id": unit_id,
        "meter_number": meter_number,
        "current_reading": current_reading,
        "previous_reading": previous_reading,
        "utility_key": utility_key,
        "unit_of_measure": unit_of_measure,
        "raw_telemetry": raw_telemetry or {},
    })
    logger.info("meter_reading_published", device_uid=device_uid, org_id=org_id)


async def publish_lock_event(
    org_id: str,
    property_id: str,
    device_id: str,
    device_uid: str,
    unit_id: Optional[str],
    action: str,
    actor_user_id: Optional[str] = None,
    method: str = "physical",
) -> None:
    await publish(QUEUE_IOT_LOCK_EVENT, {
        "org_id": org_id,
        "property_id": property_id,
        "device_id": device_id,
        "device_uid": device_uid,
        "unit_id": unit_id,
        "action": action,
        "actor_user_id": actor_user_id,
        "method": method,
    })


async def publish_alert(
    org_id: str,
    property_id: str,
    device_id: str,
    device_uid: str,
    alert_type: str,
    severity: str,
    description: str,
    raw_data: Optional[Dict[str, Any]] = None,
) -> None:
    await publish(QUEUE_IOT_ALERT, {
        "org_id": org_id,
        "property_id": property_id,
        "device_id": device_id,
        "device_uid": device_uid,
        "alert_type": alert_type,
        "severity": severity,
        "description": description,
        "raw_data": raw_data or {},
    })


async def publish_device_status(
    org_id: str, property_id: str, device_id: str, device_uid: str, previous: str, new_status: str
) -> None:
    await publish(QUEUE_IOT_DEVICE_STATUS, {
        "org_id": org_id,
        "property_id": property_id,
        "device_id": device_id,
        "device_uid": device_uid,
        "previous_status": previous,
        "new_status": new_status,
    })


QUEUE_IOT_DEVICE_LIFECYCLE = "iot.device_lifecycle"

async def publish_device_lifecycle(
    event: str,               # "provisioned" | "decommissioned"
    org_id: str,
    property_id: str,
    device_id: str,
    device_uid: str,
    unit_id: Optional[str],
    device_type_category: str,
    inventory_item_id: Optional[str] = None,
    inventory_serial_number: Optional[str] = None,
) -> None:
    await publish(QUEUE_IOT_DEVICE_LIFECYCLE, {
        "event": event,
        "org_id": org_id,
        "property_id": property_id,
        "device_id": device_id,
        "device_uid": device_uid,
        "unit_id": unit_id,
        "device_type_category": device_type_category,
        "inventory_item_id": inventory_item_id,
        "inventory_serial_number": inventory_serial_number,
    })
    logger.info("device_lifecycle_published", event=event, device_uid=device_uid, org_id=org_id)
