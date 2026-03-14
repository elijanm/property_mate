"""
Device group / fleet management service.

A DeviceGroup is a named collection of devices. Members can be:
  - Explicitly listed (device_ids)
  - Auto-resolved by tag (tag_filter)

Fleet operations:
  - bulk_command: send an RPC command to all online RPC-capable members
  - bulk_quarantine: quarantine all non-quarantined members
"""
import json
from datetime import timedelta
from typing import Any, Dict, List, Optional

import aiomqtt

from app.models.device import Device
from app.models.device_group import DeviceGroup
from app.models.device_command import DeviceCommand
from app.core.config import settings
from app.core.logging import get_logger
from app.core.exceptions import ResourceNotFoundError
from app.utils.datetime import utc_now
from app.utils.mqtt_topic import device_topic, DEVICE_SUFFIX_RPC_REQ
from beanie import PydanticObjectId

logger = get_logger(__name__)


async def _find_group(group_id: str, org_id: str) -> DeviceGroup:
    try:
        oid = PydanticObjectId(group_id)
        group = await DeviceGroup.find_one({"_id": oid, "org_id": org_id, "deleted_at": None})
    except Exception:
        group = await DeviceGroup.find_one({
            "name": group_id,
            "org_id": org_id,
            "deleted_at": None,
        })
    if not group:
        raise ResourceNotFoundError("DeviceGroup", group_id)
    return group


async def create_group(
    org_id: str,
    name: str,
    user_id: str,
    description: Optional[str] = None,
    device_ids: Optional[List[str]] = None,
    tag_filter: Optional[str] = None,
    property_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> DeviceGroup:
    group = DeviceGroup(
        org_id=org_id,
        property_id=property_id,
        name=name,
        description=description,
        tags=tags or [],
        device_ids=device_ids or [],
        tag_filter=tag_filter,
        created_by=user_id,
    )
    await group.insert()
    logger.info(
        "device_group_created",
        action="create_group",
        resource_type="device_group",
        resource_id=str(group.id),
        org_id=org_id,
        user_id=user_id,
        status="success",
    )
    return group


async def get_group(group_id: str, org_id: str) -> DeviceGroup:
    return await _find_group(group_id, org_id)


async def list_groups(org_id: str, property_id: Optional[str] = None) -> List[DeviceGroup]:
    filt: Dict[str, Any] = {"org_id": org_id, "deleted_at": None}
    if property_id:
        filt["property_id"] = property_id
    return await DeviceGroup.find(filt).sort(DeviceGroup.name).to_list()


async def update_group(group_id: str, org_id: str, data: Dict[str, Any]) -> DeviceGroup:
    group = await _find_group(group_id, org_id)
    updates = {k: v for k, v in data.items() if v is not None}
    updates["updated_at"] = utc_now()
    await group.set(updates)
    return await DeviceGroup.get(group.id)


async def delete_group(group_id: str, org_id: str) -> None:
    group = await _find_group(group_id, org_id)
    await group.set({"deleted_at": utc_now()})


async def add_devices(group_id: str, org_id: str, device_ids: List[str]) -> DeviceGroup:
    group = await _find_group(group_id, org_id)
    existing = set(group.device_ids)
    for did in device_ids:
        existing.add(did)
    await group.set({"device_ids": list(existing), "updated_at": utc_now()})
    return await DeviceGroup.get(group.id)


async def remove_devices(group_id: str, org_id: str, device_ids: List[str]) -> DeviceGroup:
    group = await _find_group(group_id, org_id)
    to_remove = set(device_ids)
    remaining = [d for d in group.device_ids if d not in to_remove]
    await group.set({"device_ids": remaining, "updated_at": utc_now()})
    return await DeviceGroup.get(group.id)


async def resolve_members(group: DeviceGroup, org_id: str) -> List[Device]:
    """
    Return all devices in the group:
    - Explicitly listed device_ids
    - Any devices matching tag_filter (if set)
    """
    device_set: Dict[str, Device] = {}

    # Explicit device IDs
    for did in group.device_ids:
        try:
            d = await Device.find_one({
                "_id": PydanticObjectId(did),
                "org_id": org_id,
                "deleted_at": None,
            })
            if d:
                device_set[str(d.id)] = d
        except Exception:
            pass

    # Tag filter
    if group.tag_filter:
        tag_devices = await Device.find({
            "org_id": org_id,
            "tags": group.tag_filter,
            "deleted_at": None,
        }).to_list()
        for d in tag_devices:
            device_set[str(d.id)] = d

    return list(device_set.values())


async def bulk_command(
    group_id: str,
    org_id: str,
    command_name: str,
    params: Dict[str, Any],
    user_id: str,
    timeout_s: int = 30,
) -> List[DeviceCommand]:
    """
    Send an RPC command to all online, RPC-capable devices in the group.
    Returns the list of created DeviceCommand records.
    """
    group = await _find_group(group_id, org_id)
    members = await resolve_members(group, org_id)

    eligible = [
        d for d in members
        if d.status == "online" and "rpc" in d.capabilities
    ]

    if not eligible:
        return []

    now = utc_now()
    created_commands: List[DeviceCommand] = []

    for device in eligible:
        cmd = DeviceCommand(
            org_id=org_id,
            device_id=str(device.id),
            command_name=command_name,
            params=params,
            sent_by_user_id=user_id,
            sent_via="api",
            timeout_at=now + timedelta(seconds=timeout_s),
        )
        await cmd.insert()

        # Publish via MQTT
        topic = device_topic(device.org_id, device.property_id, device.device_uid, DEVICE_SUFFIX_RPC_REQ)
        mqtt_payload = json.dumps({
            "id": cmd.request_id,
            "method": command_name,
            "params": params,
        })
        try:
            tls = aiomqtt.TLSParameters() if settings.mqtt_use_tls else None
            async with aiomqtt.Client(
                hostname=settings.mqtt_broker_host,
                port=settings.mqtt_broker_port,
                username=settings.mqtt_username,
                password=settings.mqtt_password,
                tls_params=tls,
            ) as client:
                await client.publish(topic, payload=mqtt_payload, qos=1)
            await cmd.set({"status": "sent", "sent_at": utc_now()})
        except Exception as e:
            await cmd.set({"status": "failed", "error_message": str(e)})
            logger.warning(
                "bulk_command_publish_failed",
                device_uid=device.device_uid,
                command=command_name,
                error=str(e),
            )

        created_commands.append(await DeviceCommand.get(cmd.id))

    logger.info(
        "bulk_command_sent",
        action="bulk_command",
        resource_type="device_group",
        resource_id=group_id,
        org_id=org_id,
        command=command_name,
        device_count=len(created_commands),
        status="success",
    )
    return created_commands


async def bulk_quarantine(
    group_id: str,
    org_id: str,
    reason: str,
    user_id: str,
) -> Dict[str, int]:
    """
    Quarantine all non-quarantined devices in the group.
    Returns {"quarantined": N, "skipped": M}.
    """
    from app.services import quarantine_service

    group = await _find_group(group_id, org_id)
    members = await resolve_members(group, org_id)

    quarantined = 0
    skipped = 0

    for device in members:
        if device.status in ("quarantined", "decommissioned"):
            skipped += 1
            continue
        try:
            await quarantine_service.quarantine_device(
                device_id=str(device.id),
                org_id=org_id,
                reason=reason,
                user_id=user_id,
            )
            quarantined += 1
        except Exception as e:
            logger.warning(
                "bulk_quarantine_device_failed",
                device_id=str(device.id),
                error=str(e),
            )
            skipped += 1

    logger.info(
        "bulk_quarantine_completed",
        action="bulk_quarantine",
        resource_type="device_group",
        resource_id=group_id,
        org_id=org_id,
        quarantined=quarantined,
        skipped=skipped,
        status="success",
    )
    return {"quarantined": quarantined, "skipped": skipped}
