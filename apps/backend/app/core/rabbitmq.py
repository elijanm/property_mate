import json
from typing import Any, Dict, Optional

import aio_pika
from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_connection: Optional[aio_pika.RobustConnection] = None


async def init_rabbitmq(app: FastAPI) -> None:
    global _connection
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    _connection = connection
    app.state.rabbitmq_connection = connection
    logger.info("action", action="rabbitmq_connected", resource_type="rabbitmq", status="success")


async def close_rabbitmq(app: FastAPI) -> None:
    if hasattr(app.state, "rabbitmq_connection"):
        await app.state.rabbitmq_connection.close()
        logger.info("action", action="rabbitmq_disconnected", resource_type="rabbitmq", status="success")


async def get_channel(app: FastAPI) -> aio_pika.abc.AbstractChannel:
    connection: aio_pika.RobustConnection = app.state.rabbitmq_connection
    return await connection.channel()


async def publish(
    queue_name: str,
    payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
) -> None:
    """Publish a JSON message to a durable queue from within a service."""
    if _connection is None:
        raise RuntimeError("RabbitMQ not initialised — call init_rabbitmq first")
    channel = await _connection.channel()
    try:
        message = aio_pika.Message(
            body=json.dumps(payload, default=str).encode(),
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            correlation_id=correlation_id,
            content_type="application/json",
        )
        await channel.default_exchange.publish(message, routing_key=queue_name)
    finally:
        await channel.close()
