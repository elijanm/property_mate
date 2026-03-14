"""
OTA firmware update service.

Workflow:
  1. Upload firmware binary to S3, create OTAUpdate record (status=draft)
  2. start_ota_rollout() sets status=active, resolves target devices, publishes
     MQTT OTA request messages, updates device.ota_pending_version
  3. Devices report progress via MQTT: pms/{org}/{property}/{uid}/v1/ota/progress
  4. handle_ota_progress() updates DeviceOTAStatus and Device.firmware_version on completion
  5. pause_ota() / cancel_ota() allow controlling the rollout
"""
import hashlib
import math
from typing import Any, Dict, List, Optional

import aiomqtt
import aioboto3

from app.models.device import Device
from app.models.ota_update import OTAUpdate, DeviceOTAStatus
from app.core.config import settings
from app.core.logging import get_logger
from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.utils.datetime import utc_now
from beanie import PydanticObjectId

logger = get_logger(__name__)


def _s3_session():
    return aioboto3.Session()


async def _generate_presigned_url(s3_key: str, expiry: int = 3600) -> str:
    """Generate a presigned GET URL for an S3 object."""
    endpoint = settings.s3_public_endpoint_url or settings.s3_endpoint_url
    session = _s3_session()
    async with session.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    ) as s3:
        url = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
            ExpiresIn=expiry,
        )
    return url


async def _publish_ota_command(
    device_uid: str,
    org_id: str,
    property_id: str,
    version: str,
    firmware_url: str,
    checksum: Optional[str],
    size_bytes: Optional[int],
) -> None:
    """Publish an OTA request command to the device via MQTT."""
    topic = f"pms/{org_id}/{property_id}/{device_uid}/v1/ota/request"
    payload_dict: Dict[str, Any] = {
        "version": version,
        "url": firmware_url,
    }
    if checksum:
        payload_dict["checksum_sha256"] = checksum
    if size_bytes:
        payload_dict["size_bytes"] = size_bytes

    import json
    try:
        tls_params = aiomqtt.TLSParameters() if settings.mqtt_use_tls else None
        async with aiomqtt.Client(
            hostname=settings.mqtt_broker_host,
            port=settings.mqtt_broker_port,
            username=settings.mqtt_username,
            password=settings.mqtt_password,
            identifier=f"ota-publisher-{device_uid}",
            tls_params=tls_params,
        ) as client:
            await client.publish(
                topic,
                payload=json.dumps(payload_dict).encode(),
                qos=1,
            )
        logger.info(
            "ota_command_published",
            device_uid=device_uid,
            version=version,
            org_id=org_id,
        )
    except Exception as e:
        logger.warning(
            "ota_command_publish_failed",
            device_uid=device_uid,
            error=str(e),
        )
        raise


async def upload_firmware(
    file_content: bytes,
    filename: str,
    device_type_id: str,
    version: str,
    org_id: str,
    user_id: str,
    release_notes: Optional[str] = None,
) -> OTAUpdate:
    """
    Upload firmware binary to S3 and create an OTAUpdate record with status=draft.
    """
    s3_key = f"{org_id}/ota/{device_type_id}/{version}/{filename}"
    size_bytes = len(file_content)
    checksum = hashlib.sha256(file_content).hexdigest()

    session = _s3_session()
    async with session.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    ) as s3:
        await s3.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=file_content,
            ContentType="application/octet-stream",
            Metadata={
                "version": version,
                "device_type_id": device_type_id,
                "org_id": org_id,
                "checksum_sha256": checksum,
            },
        )

    ota = OTAUpdate(
        org_id=org_id,
        device_type_id=device_type_id,
        target_version=version,
        firmware_s3_key=s3_key,
        firmware_size_bytes=size_bytes,
        checksum_sha256=checksum,
        release_notes=release_notes,
        status="draft",
        created_by=user_id,
    )
    await ota.insert()

    logger.info(
        "firmware_uploaded",
        action="upload_firmware",
        resource_type="ota_update",
        resource_id=str(ota.id),
        org_id=org_id,
        version=version,
        size_bytes=size_bytes,
        status="success",
    )
    return ota


async def start_ota_rollout(ota_id: str, org_id: str, user_id: str) -> OTAUpdate:
    """
    Activate an OTA rollout: resolve target devices, publish MQTT commands,
    update device.ota_pending_version, and track per-device status.
    """
    ota = await OTAUpdate.find_one({
        "_id": PydanticObjectId(ota_id),
        "org_id": org_id,
        "deleted_at": None,
    })
    if not ota:
        raise ResourceNotFoundError("OTAUpdate", ota_id)
    if ota.status not in ("draft", "paused"):
        raise ValidationError(f"Cannot start OTA rollout with status '{ota.status}'")

    # Generate presigned firmware URL (valid for 24 hours)
    firmware_url = await _generate_presigned_url(ota.firmware_s3_key, expiry=86400)

    # Resolve target devices
    if ota.device_ids:
        # Explicit list
        from beanie import PydanticObjectId as OID
        target_devices: List[Device] = []
        for did in ota.device_ids:
            try:
                d = await Device.find_one({
                    "_id": OID(did),
                    "org_id": org_id,
                    "deleted_at": None,
                    "status": {"$nin": ["decommissioned", "quarantined"]},
                })
                if d:
                    target_devices.append(d)
            except Exception:
                pass
    else:
        # All devices of this type in org
        target_devices = await Device.find({
            "org_id": org_id,
            "device_type_id": ota.device_type_id,
            "deleted_at": None,
            "status": {"$nin": ["decommissioned", "quarantined"]},
        }).to_list()

    # Apply rollout_pct
    if ota.rollout_pct < 100 and target_devices:
        count = max(1, math.ceil(len(target_devices) * ota.rollout_pct / 100))
        target_devices = target_devices[:count]

    now = utc_now()
    device_statuses: List[DeviceOTAStatus] = []

    for device in target_devices:
        # Update device.ota_pending_version
        await device.set({"ota_pending_version": ota.target_version, "updated_at": now})

        # Publish MQTT OTA command (best-effort — errors tracked in status)
        status = "sent"
        try:
            await _publish_ota_command(
                device_uid=device.device_uid,
                org_id=device.org_id,
                property_id=device.property_id,
                version=ota.target_version,
                firmware_url=firmware_url,
                checksum=ota.checksum_sha256,
                size_bytes=ota.firmware_size_bytes,
            )
        except Exception as e:
            logger.warning(
                "ota_command_failed",
                device_uid=device.device_uid,
                error=str(e),
            )
            status = "pending"  # will be retried when device comes online

        device_statuses.append(DeviceOTAStatus(
            device_id=str(device.id),
            device_uid=device.device_uid,
            status=status,
            started_at=now if status == "sent" else None,
        ))

    await ota.set({
        "status": "active",
        "device_statuses": [ds.model_dump() for ds in device_statuses],
        "updated_at": now,
    })

    logger.info(
        "ota_rollout_started",
        action="start_ota_rollout",
        resource_type="ota_update",
        resource_id=str(ota.id),
        org_id=org_id,
        target_count=len(target_devices),
        status="success",
    )
    return await OTAUpdate.get(ota.id)


async def handle_ota_progress(device: Device, payload: Dict[str, Any]) -> None:
    """
    Handle an OTA progress report from a device.
    Called from mqtt_subscriber when an ota/progress message is received.
    """
    version = payload.get("version")
    progress = int(payload.get("progress", 0))
    ota_status = payload.get("status", "in_progress")
    error_msg = payload.get("error")

    if not version:
        return

    # Find the active OTA update targeting this device
    ota = await OTAUpdate.find_one({
        "org_id": device.org_id,
        "target_version": version,
        "status": "active",
        "deleted_at": None,
    })
    if not ota:
        return

    now = utc_now()
    device_id_str = str(device.id)
    updated_statuses = []
    found = False

    for ds_data in ota.device_statuses:
        if isinstance(ds_data, dict):
            ds = DeviceOTAStatus(**ds_data)
        else:
            ds = ds_data

        if ds.device_id == device_id_str:
            found = True
            ds.progress_pct = progress
            if ota_status == "completed":
                ds.status = "completed"
                ds.completed_at = now
            elif ota_status in ("failed", "error"):
                ds.status = "failed"
                ds.error = error_msg or "Unknown error"
                ds.completed_at = now
            else:
                ds.status = "in_progress"
        updated_statuses.append(ds.model_dump())

    if not found:
        updated_statuses.append(DeviceOTAStatus(
            device_id=device_id_str,
            device_uid=device.device_uid,
            status="in_progress" if ota_status not in ("completed", "failed", "error") else ota_status,
            progress_pct=progress,
            error=error_msg,
        ).model_dump())

    await ota.set({"device_statuses": updated_statuses, "updated_at": now})

    # Update device firmware_version on success
    if ota_status == "completed":
        await device.set({
            "firmware_version": version,
            "ota_pending_version": None,
            "updated_at": now,
        })
        logger.info(
            "ota_completed",
            action="ota_progress",
            resource_type="device",
            resource_id=device_id_str,
            org_id=device.org_id,
            version=version,
            status="success",
        )
    elif ota_status in ("failed", "error"):
        logger.warning(
            "ota_failed",
            device_uid=device.device_uid,
            version=version,
            error=error_msg,
        )

    # Check if all devices are done and mark OTA as completed
    all_terminal = all(
        (ds.get("status") if isinstance(ds, dict) else ds.status) in ("completed", "failed")
        for ds in updated_statuses
    )
    if all_terminal and updated_statuses:
        await ota.set({"status": "completed", "updated_at": now})


async def pause_ota(ota_id: str, org_id: str) -> OTAUpdate:
    """Pause an active OTA rollout (pending devices will not receive the command)."""
    ota = await OTAUpdate.find_one({
        "_id": PydanticObjectId(ota_id),
        "org_id": org_id,
        "deleted_at": None,
    })
    if not ota:
        raise ResourceNotFoundError("OTAUpdate", ota_id)
    if ota.status != "active":
        raise ValidationError(f"Cannot pause OTA with status '{ota.status}'")
    await ota.set({"status": "paused", "updated_at": utc_now()})
    return await OTAUpdate.get(ota.id)


async def cancel_ota(ota_id: str, org_id: str) -> OTAUpdate:
    """Cancel an OTA rollout and clear ota_pending_version on affected devices."""
    ota = await OTAUpdate.find_one({
        "_id": PydanticObjectId(ota_id),
        "org_id": org_id,
        "deleted_at": None,
    })
    if not ota:
        raise ResourceNotFoundError("OTAUpdate", ota_id)
    if ota.status == "cancelled":
        raise ValidationError("OTA update is already cancelled")

    now = utc_now()
    await ota.set({
        "status": "cancelled",
        "deleted_at": now,
        "updated_at": now,
    })

    # Clear ota_pending_version on devices that haven't completed yet
    for ds_data in ota.device_statuses:
        if isinstance(ds_data, dict):
            ds = DeviceOTAStatus(**ds_data)
        else:
            ds = ds_data
        if ds.status not in ("completed",):
            try:
                device = await Device.find_one({
                    "_id": PydanticObjectId(ds.device_id),
                    "deleted_at": None,
                })
                if device and device.ota_pending_version == ota.target_version:
                    await device.set({"ota_pending_version": None, "updated_at": now})
            except Exception:
                pass

    return await OTAUpdate.get(ota.id)


async def get_ota_status(ota_id: str, org_id: str) -> OTAUpdate:
    """Fetch an OTA update record with its per-device progress."""
    ota = await OTAUpdate.find_one({
        "_id": PydanticObjectId(ota_id),
        "org_id": org_id,
        "deleted_at": None,
    })
    if not ota:
        raise ResourceNotFoundError("OTAUpdate", ota_id)
    return ota
