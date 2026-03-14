"""
Device quarantine service.

Quarantining a device:
  1. Sets device.status = "quarantined"
  2. Kicks existing EMQX sessions so the device is forced to reconnect (and auth will fail)
  3. Clears the Redis auth cache entry so EMQX re-fetches on next connect attempt
  4. Adds a Headscale deny ACL rule for the device's Tailscale IP (if registered)

Un-quarantining a device:
  1. Removes the Headscale deny ACL rule
  2. Resets status to "offline" (device re-authenticates normally when it reconnects)
  3. Clears quarantine metadata fields
"""
import httpx
from typing import Optional
from app.models.device import Device
from app.services import headscale_client
from app.core.redis import get_redis
from app.core.config import settings
from app.core.logging import get_logger
from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.utils.datetime import utc_now
from beanie import PydanticObjectId

logger = get_logger(__name__)


async def _find_device(device_id: str, org_id: Optional[str] = None) -> Device:
    """Look up a Device by ObjectId or device_uid, optionally scoped to org."""
    device: Optional[Device] = None
    try:
        oid = PydanticObjectId(device_id)
        device = await Device.find_one({"_id": oid, "deleted_at": None})
    except Exception:
        pass
    if device is None:
        device = await Device.find_one({
            "$or": [{"device_uid": device_id}, {"mqtt_client_id": device_id}],
            "deleted_at": None,
        })
    if device is None:
        raise ResourceNotFoundError("Device", device_id)
    if org_id and device.org_id != org_id:
        raise ResourceNotFoundError("Device", device_id)
    return device


async def _kick_emqx_session(mqtt_client_id: str) -> None:
    """Force-disconnect a device from EMQX by deleting its session via management API."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.delete(
                f"{settings.emqx_api_url}/api/v5/clients/{mqtt_client_id}",
                auth=(settings.emqx_api_key, settings.emqx_api_secret),
            )
            if resp.status_code not in (200, 204, 404):
                logger.warning(
                    "emqx_kick_session_unexpected",
                    mqtt_client_id=mqtt_client_id,
                    status=resp.status_code,
                )
    except Exception as e:
        logger.warning("emqx_kick_session_failed", mqtt_client_id=mqtt_client_id, error=str(e))


async def _add_headscale_deny_rule(device: Device) -> Optional[str]:
    """
    Add a Headscale ACL deny rule for the device's Tailscale IP.
    Returns the fingerprint string used to identify/remove the rule later.
    """
    if not device.tailscale_ip:
        return None
    # We add a deny rule: action="deny", src=["*"], dst=["{ip}:*"]
    # The fingerprint uniquely identifies this quarantine rule.
    fingerprint = f"quarantine:{str(device.id)}|{device.tailscale_ip}"
    try:
        if not await headscale_client._acquire_lock():
            logger.warning("headscale_acl_lock_failed_quarantine", device_id=str(device.id))
            return None
        try:
            policy = await headscale_client._get_acl()
            acls = policy.get("acls", [])
            if not acls:
                acls = [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]
            # Insert deny rule at the beginning so it takes precedence
            deny_rule = {
                "action": "deny",
                "src": ["*"],
                "dst": [f"{device.tailscale_ip}:*"],
            }
            acls.insert(0, deny_rule)
            policy["acls"] = acls
            await headscale_client._put_acl(policy)
            logger.info(
                "headscale_deny_rule_added",
                device_id=str(device.id),
                tailscale_ip=device.tailscale_ip,
                fingerprint=fingerprint,
            )
            return fingerprint
        finally:
            await headscale_client._release_lock()
    except Exception as e:
        logger.warning(
            "headscale_deny_rule_failed",
            device_id=str(device.id),
            error=str(e),
        )
        return None


async def _remove_headscale_deny_rule(device: Device) -> None:
    """Remove the Headscale deny ACL rule that was added during quarantine."""
    if not device.quarantine_acl_comment or not device.tailscale_ip:
        return
    try:
        if not await headscale_client._acquire_lock():
            logger.warning("headscale_acl_lock_failed_unquarantine", device_id=str(device.id))
            return
        try:
            policy = await headscale_client._get_acl()
            acls = policy.get("acls", [])
            dst_entry = f"{device.tailscale_ip}:*"
            before = len(acls)
            policy["acls"] = [
                r for r in acls
                if not (
                    r.get("action") == "deny"
                    and r.get("src") == ["*"]
                    and r.get("dst") == [dst_entry]
                )
            ]
            if len(policy["acls"]) < before:
                await headscale_client._put_acl(policy)
                logger.info(
                    "headscale_deny_rule_removed",
                    device_id=str(device.id),
                    tailscale_ip=device.tailscale_ip,
                )
        finally:
            await headscale_client._release_lock()
    except Exception as e:
        logger.warning(
            "headscale_deny_rule_remove_failed",
            device_id=str(device.id),
            error=str(e),
        )


async def quarantine_device(device_id: str, org_id: str, reason: str, user_id: str) -> Device:
    """
    Quarantine a device: block MQTT auth, kick existing sessions, block Tailscale access.
    """
    device = await _find_device(device_id, org_id)

    if device.status == "decommissioned":
        raise ValidationError("Cannot quarantine a decommissioned device")
    if device.status == "quarantined":
        raise ValidationError("Device is already quarantined")

    now = utc_now()

    # Add Headscale deny rule before marking quarantined (best-effort)
    acl_comment = await _add_headscale_deny_rule(device)

    # Update device status
    updates = {
        "status": "quarantined",
        "quarantine_reason": reason,
        "quarantined_at": now,
        "quarantined_by": user_id,
        "quarantine_acl_comment": acl_comment,
        "updated_at": now,
    }
    await device.set(updates)

    # Kick EMQX session (fire-and-forget style — errors are logged, not fatal)
    await _kick_emqx_session(device.mqtt_client_id)

    # Clear Redis auth cache so next connect attempt re-fetches from DB
    redis = get_redis()
    await redis.delete(f"iot:auth:{device.mqtt_client_id}")
    await redis.delete(f"iot:emqx:device:{device.mqtt_username}")

    logger.info(
        "device_quarantined",
        action="quarantine_device",
        resource_type="device",
        resource_id=str(device.id),
        org_id=org_id,
        user_id=user_id,
        reason=reason,
        status="success",
    )

    return await Device.get(device.id)


async def unquarantine_device(device_id: str, org_id: str, user_id: str) -> Device:
    """
    Remove quarantine from a device: restore network access and allow re-authentication.
    """
    device = await _find_device(device_id, org_id)

    if device.status != "quarantined":
        raise ValidationError("Device is not quarantined")

    # Remove Headscale deny rule
    await _remove_headscale_deny_rule(device)

    now = utc_now()
    updates = {
        "status": "offline",
        "quarantine_reason": None,
        "quarantined_at": None,
        "quarantined_by": None,
        "quarantine_acl_comment": None,
        "updated_at": now,
    }
    await device.set(updates)

    # Clear auth cache so next connect attempt gets fresh device state
    redis = get_redis()
    await redis.delete(f"iot:auth:{device.mqtt_client_id}")
    await redis.delete(f"iot:emqx:device:{device.mqtt_username}")

    logger.info(
        "device_unquarantined",
        action="unquarantine_device",
        resource_type="device",
        resource_id=str(device.id),
        org_id=org_id,
        user_id=user_id,
        status="success",
    )

    return await Device.get(device.id)
