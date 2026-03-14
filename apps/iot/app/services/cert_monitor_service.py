"""
Certificate expiry monitoring service.

Periodically checks all devices with TLS client certificates and fires
alert events when certs are about to expire or have already expired.

Alert severity:
  warning  — cert expires within 30 days
  critical — cert expires within 7 days OR has already expired

Notifications are rate-limited to once per 24 hours per device using Redis.
"""
from datetime import timedelta
from typing import List

from app.models.device import Device
from app.core.redis import get_redis
from app.core.logging import get_logger
from app.core.rabbitmq import publish
from app.utils.datetime import utc_now

logger = get_logger(__name__)

_QUEUE_IOT_ALERT = "iot.alert"


async def run_cert_expiry_sweep() -> int:
    """
    Check all non-decommissioned devices with certificates and fire alerts
    for those expiring within 30 days or already expired.

    Returns the total count of alerted devices in this sweep.
    """
    now = utc_now()
    warning_threshold = now + timedelta(days=30)
    critical_threshold = now + timedelta(days=7)

    # Devices whose cert will expire within the warning window (not yet expired)
    expiring: List[Device] = await Device.find({
        "cert_expires_at": {"$lte": warning_threshold, "$gte": now},
        "deleted_at": None,
        "status": {"$ne": "decommissioned"},
    }).to_list()

    # Devices whose cert has already expired
    expired: List[Device] = await Device.find({
        "cert_expires_at": {"$lt": now, "$ne": None},
        "deleted_at": None,
        "status": {"$ne": "decommissioned"},
    }).to_list()

    redis = get_redis()
    alerted_count = 0

    for device in expiring + expired:
        if device.cert_expires_at is None:
            continue

        # Rate-limit to once per 24 hours per device
        cooldown_key = f"iot:cert_expiry_notified:{str(device.id)}"
        if await redis.exists(cooldown_key):
            continue
        await redis.setex(cooldown_key, 86400, "1")

        is_expired = device.cert_expires_at < now
        is_critical = is_expired or device.cert_expires_at < critical_threshold
        severity = "critical" if is_critical else "warning"

        if is_expired:
            message = f"Device '{device.name}' certificate has expired"
        else:
            expires_str = device.cert_expires_at.strftime("%Y-%m-%d")
            message = f"Device '{device.name}' certificate expires {expires_str}"

        try:
            await publish(_QUEUE_IOT_ALERT, {
                "org_id": device.org_id,
                "device_id": str(device.id),
                "device_uid": device.device_uid,
                "device_name": device.name,
                "alert_type": "cert_expiry",
                "severity": severity,
                "description": message,
                "property_id": device.property_id,
                "cert_expires_at": device.cert_expires_at.isoformat() if device.cert_expires_at else None,
                "is_expired": is_expired,
            })
            alerted_count += 1
            logger.info(
                "cert_expiry_alert_sent",
                action="cert_expiry_sweep",
                resource_type="device",
                resource_id=str(device.id),
                org_id=device.org_id,
                severity=severity,
                is_expired=is_expired,
                status="success",
            )
        except Exception as e:
            logger.warning(
                "cert_expiry_alert_failed",
                device_id=str(device.id),
                error=str(e),
            )

    if alerted_count:
        logger.info("cert_expiry_sweep_completed", alerted_count=alerted_count)

    return alerted_count
