"""
IoT service MQTT subscriber.
Runs as a background asyncio task during lifespan.
Subscribes to pms/# and gw/# and dispatches messages to handlers.
"""
import asyncio
import json
from typing import Any, Dict
import aiomqtt
from app.core.config import settings
from app.core.logging import get_logger
from app.core.metrics import IOT_MQTT_MESSAGES
from app.core.redis import get_redis
from app.models.device import Device
from app.models.edge_gateway import EdgeGateway
from app.services import pms_event_publisher, thingsboard_client
from app.utils.mqtt_topic import parse_device_topic, parse_gateway_topic
from app.utils.datetime import utc_now

logger = get_logger(__name__)

_running = True


async def start_subscriber() -> None:
    """Start the MQTT subscriber loop. Reconnects automatically on failure."""
    global _running
    _running = True
    backoff = 1

    while _running:
        try:
            tls_params = aiomqtt.TLSParameters() if settings.mqtt_use_tls else None
            async with aiomqtt.Client(
                hostname=settings.mqtt_broker_host,
                port=settings.mqtt_broker_port,
                username=settings.mqtt_username,
                password=settings.mqtt_password,
                identifier=settings.mqtt_client_id,
                keepalive=settings.mqtt_keepalive,
                clean_session=settings.mqtt_clean_start,
                tls_params=tls_params,
            ) as client:
                await client.subscribe("pms/#", qos=1)
                await client.subscribe("gw/#", qos=1)
                logger.info("mqtt_subscriber_connected", broker=settings.mqtt_broker_host)
                backoff = 1  # reset backoff on successful connection

                async for message in client.messages:
                    if not _running:
                        break
                    asyncio.create_task(_dispatch(str(message.topic), message.payload))

        except aiomqtt.MqttError as e:
            if not _running:
                break
            logger.warning("mqtt_subscriber_disconnected", error=str(e), retry_in=backoff)
            await asyncio.sleep(min(backoff, 60))
            backoff = min(backoff * 2, 60)
        except Exception as e:
            logger.error("mqtt_subscriber_error", error=str(e))
            await asyncio.sleep(5)


def stop_subscriber() -> None:
    global _running
    _running = False


async def _dispatch(topic: str, payload: bytes) -> None:
    try:
        data: Dict[str, Any] = json.loads(payload)
    except Exception:
        data = {"raw": payload.decode(errors="replace")}

    dt = parse_device_topic(topic)
    if dt:
        IOT_MQTT_MESSAGES.labels(topic_type=dt.suffix.split("/")[0]).inc()
        if dt.is_telemetry:
            await _handle_telemetry(dt.org_id, dt.property_id, dt.device_uid, data)
        elif dt.is_status:
            await _handle_device_status(dt.org_id, dt.device_uid, data)
        elif dt.is_rpc_response:
            await _handle_rpc_response(dt.device_uid, data)
        elif dt.is_ota_progress:
            await _handle_ota_progress(dt.device_uid, data)
        return

    gt = parse_gateway_topic(topic)
    if gt:
        IOT_MQTT_MESSAGES.labels(topic_type="gateway_status").inc()
        if gt.is_status:
            await _handle_gateway_status(gt.org_id, gt.gateway_uid, data)


async def _handle_telemetry(org_id: str, property_id: str, device_uid: str, data: Dict) -> None:
    device = await Device.find_one({"device_uid": device_uid, "org_id": org_id, "deleted_at": None})
    if not device:
        return

    now = utc_now()
    await Device.find_one({"_id": device.id}).update({"$set": {"last_telemetry_at": now, "last_seen_at": now}})

    # Cache the latest telemetry payload in Redis for the live-telemetry endpoint (TTL 5 min)
    try:
        import json as _json
        redis = get_redis()
        await redis.setex(
            f"iot:device:{device.id}:last_telemetry",
            300,
            _json.dumps({"data": data, "ts": now.isoformat()}),
        )
    except Exception:
        pass

    # Forward to ThingsBoard
    if device.tb_access_token:
        try:
            await thingsboard_client.push_telemetry(device.tb_access_token, data)
        except Exception as e:
            logger.warning("tb_telemetry_forward_failed", device_uid=device_uid, error=str(e))

    # Evaluate alert rules against the incoming telemetry
    try:
        from app.services import alert_rule_service
        await alert_rule_service.evaluate_rules_for_telemetry(device, data)
    except Exception as e:
        logger.warning("alert_rule_evaluation_failed", device_uid=device_uid, error=str(e))

    # Publish to PMS if device is a meter
    if device.device_type_category == "meter":
        reading = data.get("value") or data.get("reading") or data.get("current_reading")
        if reading is not None:
            await pms_event_publisher.publish_meter_reading(
                org_id=org_id,
                property_id=property_id,
                device_id=str(device.id),
                device_uid=device_uid,
                unit_id=device.unit_id,
                meter_number=device.serial_number or device_uid,
                current_reading=float(reading),
                previous_reading=data.get("previous_reading"),
                utility_key=data.get("utility_key"),
                unit_of_measure=data.get("unit", "units"),
                raw_telemetry=data,
            )

    # Publish lock events
    elif device.device_type_category == "smart_lock":
        action = data.get("action") or data.get("event")
        if action:
            await pms_event_publisher.publish_lock_event(
                org_id=org_id,
                property_id=property_id,
                device_id=str(device.id),
                device_uid=device_uid,
                unit_id=device.unit_id,
                action=action,
                method=data.get("method", "physical"),
            )

    # Alerts
    alert_type = data.get("alert") or data.get("alarm")
    if alert_type:
        await pms_event_publisher.publish_alert(
            org_id=org_id,
            property_id=property_id,
            device_id=str(device.id),
            device_uid=device_uid,
            alert_type=str(alert_type),
            severity=data.get("severity", "warning"),
            description=data.get("description", str(alert_type)),
            raw_data=data,
        )


async def _handle_device_status(org_id: str, device_uid: str, data: Dict) -> None:
    device = await Device.find_one({"device_uid": device_uid, "org_id": org_id, "deleted_at": None})
    if not device:
        return
    new_status = data.get("status", "online")
    if new_status != device.status:
        await pms_event_publisher.publish_device_status(
            org_id=org_id,
            property_id=device.property_id,
            device_id=str(device.id),
            device_uid=device_uid,
            previous=device.status,
            new_status=new_status,
        )
    await Device.find_one({"_id": device.id}).update({
        "$set": {"status": new_status, "last_seen_at": utc_now(), "firmware_version": data.get("firmware_version", device.firmware_version)}
    })


async def _handle_rpc_response(device_uid: str, data: Dict) -> None:
    from app.models.device_command import DeviceCommand
    request_id = data.get("id") or data.get("request_id")
    if not request_id:
        return
    cmd = await DeviceCommand.find_one({"request_id": str(request_id), "deleted_at": None})
    if not cmd:
        return
    success = data.get("status", "success") not in ("error", "failed")
    await cmd.set({
        "status": "success" if success else "failed",
        "response": data,
        "error_message": data.get("error") if not success else None,
        "completed_at": utc_now(),
    })


async def _handle_ota_progress(device_uid: str, data: Dict) -> None:
    progress = data.get("progress", 0)
    status = data.get("status", "in_progress")
    device = await Device.find_one({"device_uid": device_uid, "deleted_at": None})
    if not device:
        return

    # Delegate full OTA tracking to the ota_service (updates OTAUpdate record + device)
    try:
        from app.services import ota_service
        await ota_service.handle_ota_progress(device, data)
    except Exception as e:
        logger.warning("ota_progress_handler_failed", device_uid=device_uid, error=str(e))
        # Fallback: update device firmware_version directly if completed
        if status == "completed" and device.ota_pending_version:
            await Device.find_one({"_id": device.id}).update({
                "$set": {"firmware_version": device.ota_pending_version, "ota_pending_version": None, "updated_at": utc_now()}
            })

    logger.info("ota_progress", device_uid=device_uid, progress=progress, status=status)


async def _handle_gateway_status(org_id: str, gateway_uid: str, data: Dict) -> None:
    gw = await EdgeGateway.find_one({"gateway_uid": gateway_uid, "org_id": org_id, "deleted_at": None})
    if not gw:
        return
    new_status = data.get("status", "online")
    await EdgeGateway.find_one({"_id": gw.id}).update({
        "$set": {
            "status": new_status,
            "last_seen_at": utc_now(),
            "os_version": data.get("os_version", gw.os_version),
            "agent_version": data.get("agent_version", gw.agent_version),
        }
    })
