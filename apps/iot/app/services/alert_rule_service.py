"""
Telemetry alert rule evaluation service.

Called from the MQTT subscriber after receiving telemetry. Evaluates all
applicable alert rules for the device and fires alerts when thresholds are
breached (with consecutive-violation counting and per-rule cooldowns).
"""
from typing import Any, Dict, List, Optional
from app.models.device import Device
from app.models.alert_rule import AlertRule
from app.core.redis import get_redis
from app.core.logging import get_logger
from app.utils.datetime import utc_now

logger = get_logger(__name__)


def _check_operator(value: float, op: str, threshold: float) -> bool:
    """Return True if the value violates the rule threshold."""
    ops: Dict[str, bool] = {
        "gt":  value > threshold,
        "lt":  value < threshold,
        "gte": value >= threshold,
        "lte": value <= threshold,
        "eq":  value == threshold,
        "neq": value != threshold,
    }
    return ops.get(op, False)


async def _fire_alert(rule: AlertRule, device: Device, key: str, value: float) -> None:
    """Publish an alert event to the RabbitMQ iot.alert queue."""
    message = rule.alert_message_template.format(
        device_name=device.name,
        key=key,
        value=value,
        operator=rule.operator,
        threshold=rule.threshold,
    )
    from app.services.pms_event_publisher import publish_alert
    try:
        await publish_alert(
            org_id=device.org_id,
            property_id=device.property_id or "",
            device_id=str(device.id),
            device_uid=device.device_uid,
            alert_type="telemetry_threshold",
            severity=rule.severity,
            description=message,
            raw_data={
                "rule_id": str(rule.id),
                "rule_name": rule.name,
                "telemetry_key": key,
                "telemetry_value": value,
                "threshold": rule.threshold,
                "operator": rule.operator,
                "create_ticket": rule.create_ticket,
                "notify_email": rule.notify_email,
            },
        )
        logger.info(
            "alert_rule_fired",
            action="fire_alert",
            resource_type="alert_rule",
            resource_id=str(rule.id),
            org_id=device.org_id,
            device_id=str(device.id),
            telemetry_key=key,
            telemetry_value=value,
            severity=rule.severity,
            status="success",
        )
    except Exception as e:
        logger.warning(
            "alert_rule_publish_failed",
            rule_id=str(rule.id),
            device_id=str(device.id),
            error=str(e),
        )


async def evaluate_rules_for_telemetry(device: Device, telemetry: Dict[str, Any]) -> None:
    """
    Evaluate all applicable alert rules for a telemetry payload.

    Rules are matched by (in order of specificity):
      1. device_id == device.id  (most specific)
      2. device_type_id == device.device_type_id AND device_id is None
      3. org_id == device.org_id AND device_id is None AND device_type_id is None (org-wide)

    Consecutive violation counting uses Redis with a 1-hour TTL.
    Cooldown prevention uses Redis setex keyed per rule+device.
    """
    device_id_str = str(device.id)

    rules: List[AlertRule] = await AlertRule.find({
        "$or": [
            {"device_id": device_id_str},
            {"device_type_id": device.device_type_id, "device_id": None},
            {"org_id": device.org_id, "device_id": None, "device_type_id": None},
        ],
        "org_id": device.org_id,
        "is_active": True,
        "deleted_at": None,
    }).to_list()

    if not rules:
        return

    redis = get_redis()

    for rule in rules:
        key = rule.telemetry_key
        if key not in telemetry:
            continue

        try:
            value = float(telemetry[key])
        except (TypeError, ValueError):
            continue

        violated = _check_operator(value, rule.operator, rule.threshold)
        rule_id_str = str(rule.id)
        viol_key = f"iot:rule:{rule_id_str}:{device_id_str}:violations"
        cooldown_key = f"iot:rule:{rule_id_str}:{device_id_str}:last_fired"

        if violated:
            count = await redis.incr(viol_key)
            await redis.expire(viol_key, 3600)  # reset violation counter after 1 hour of silence
            if count >= rule.consecutive_violations:
                # Only fire if not in cooldown window
                if not await redis.exists(cooldown_key):
                    await _fire_alert(rule, device, key, value)
                    await redis.setex(cooldown_key, rule.cooldown_m * 60, "1")
        else:
            # Clear violation counter when value is back within bounds
            await redis.delete(viol_key)
