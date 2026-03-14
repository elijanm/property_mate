"""
Device RPC command endpoint.
Commands are published to the device's MQTT rpc/request topic.
Responses are matched by request_id when the device publishes to rpc/response.
"""
import asyncio
import json
from datetime import timedelta
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from beanie import PydanticObjectId
import aiomqtt
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.device import Device
from app.models.device_command import DeviceCommand
from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.core.config import settings
from app.utils.datetime import utc_now
from app.utils.mqtt_topic import device_topic, DEVICE_SUFFIX_RPC_REQ

router = APIRouter(prefix="/devices/{device_id}/commands", tags=["commands"])

_DEFAULT_TIMEOUT_S = 30


class CommandRequest(BaseModel):
    command_name: str
    params: Dict[str, Any] = {}
    timeout_s: int = _DEFAULT_TIMEOUT_S


class CommandResponse(BaseModel):
    id: str
    device_id: str
    command_name: str
    params: Dict[str, Any]
    request_id: str
    status: str
    response: Optional[Dict[str, Any]]
    error_message: Optional[str]
    sent_at: Optional[str]
    completed_at: Optional[str]
    created_at: str


def _to_cmd_resp(cmd: DeviceCommand) -> CommandResponse:
    return CommandResponse(
        id=str(cmd.id),
        device_id=cmd.device_id,
        command_name=cmd.command_name,
        params=cmd.params,
        request_id=cmd.request_id,
        status=cmd.status,
        response=cmd.response,
        error_message=cmd.error_message,
        sent_at=cmd.sent_at.isoformat() if cmd.sent_at else None,
        completed_at=cmd.completed_at.isoformat() if cmd.completed_at else None,
        created_at=cmd.created_at.isoformat(),
    )


async def _get_device(device_id: str, org_id: Optional[str]) -> Device:
    device = await Device.find_one({"_id": PydanticObjectId(device_id), "deleted_at": None})
    if not device or (org_id and device.org_id != org_id):
        raise ResourceNotFoundError("Device", device_id)
    return device


@router.post("", response_model=CommandResponse, status_code=202,
             dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def send_command(
    device_id: str,
    body: CommandRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    device = await _get_device(device_id, current_user.org_id if current_user.role != "superadmin" else None)

    if "rpc" not in device.capabilities:
        raise ValidationError(f"Device '{device.name}' does not support RPC commands")
    if device.status not in ("online",):
        raise ValidationError(f"Device is {device.status} — cannot send command")

    now = utc_now()
    cmd = DeviceCommand(
        org_id=device.org_id,
        device_id=str(device.id),
        command_name=body.command_name,
        params=body.params,
        sent_by_user_id=current_user.user_id,
        timeout_at=now + timedelta(seconds=body.timeout_s),
    )
    await cmd.insert()

    # Publish to device via MQTT
    topic = device_topic(device.org_id, device.property_id, device.device_uid, DEVICE_SUFFIX_RPC_REQ)
    mqtt_payload = json.dumps({"id": cmd.request_id, "method": body.command_name, "params": body.params})

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

    return _to_cmd_resp(await DeviceCommand.get(cmd.id))


@router.get("", response_model=List[CommandResponse],
            dependencies=[Depends(require_roles("owner", "agent", "superadmin"))])
async def list_commands(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    device = await _get_device(device_id, current_user.org_id if current_user.role != "superadmin" else None)
    cmds = await DeviceCommand.find(
        {"device_id": str(device.id), "deleted_at": None}
    ).sort(-DeviceCommand.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
    return [_to_cmd_resp(c) for c in cmds]
