"""
Heartbeat monitor service.

Periodically checks all online devices and marks them offline if they have
not been seen within the expected heartbeat threshold for their device type.

Heartbeat thresholds (in seconds) per device category:
  meter       — 5 minutes
  smart_lock  — 1 minute
  sensor      — 2 minutes
  camera      — 30 seconds
  gateway     — 1 minute
  default     — 5 minutes
"""
from typing import Optional
from datetime import timezone
from app.models.device import Device
from app.services.pms_event_publisher import publish_alert
from app.core.logging import get_logger
from app.utils.datetime import utc_now

logger = get_logger(__name__)

HEARTBEAT_THRESHOLDS: dict = {
    "meter": 300,
    "smart_lock": 60,
    "sensor": 120,
    "camera": 30,
    "gateway": 60,
    "default": 300,
}


async def _publish_offline_alert(device: Device) -> None:
    """Publish a device_offline alert to RabbitMQ iot.alert queue."""
    try:
        last_seen_str = device.last_seen_at.isoformat() if device.last_seen_at else "never"
        await publish_alert(
            org_id=device.org_id,
            property_id=device.property_id,
            device_id=str(device.id),
            device_uid=device.device_uid,
            alert_type="device_offline",
            severity="warning",
            description=(
                f"Device '{device.name}' has gone offline (last seen {last_seen_str})"
            ),
            raw_data={
                "device_name": device.name,
                "last_seen_at": last_seen_str,
                "device_type_category": device.device_type_category,
            },
        )
    except Exception as e:
        logger.warning(
            "heartbeat_alert_publish_failed",
            device_id=str(device.id),
            org_id=device.org_id,
            error=str(e),
        )


async def run_heartbeat_sweep() -> int:
    """
    Check all online devices and mark offline if last_seen_at exceeds the threshold
    for their device type category.

    Returns the count of devices marked offline in this sweep.
    """
    now = utc_now()

    online_devices = await Device.find({
        "status": "online",
        "deleted_at": None,
    }).to_list()

    count = 0
    for device in online_devices:
        if not device.last_seen_at:
            continue
        category = device.device_type_category or "default"
        threshold_s = HEARTBEAT_THRESHOLDS.get(category, HEARTBEAT_THRESHOLDS["default"])
        last_seen = device.last_seen_at
        # Normalise naive datetimes stored without tzinfo to UTC
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        elapsed = (now - last_seen).total_seconds()
        if elapsed > threshold_s:
            await device.set({"status": "offline", "updated_at": now})
            await _publish_offline_alert(device)
            count += 1
            logger.info(
                "device_marked_offline",
                action="heartbeat_sweep",
                resource_type="device",
                resource_id=str(device.id),
                org_id=device.org_id,
                elapsed_s=elapsed,
                threshold_s=threshold_s,
                status="success",
            )

    if count:
        logger.info("heartbeat_sweep_completed", devices_marked_offline=count)

    return count
