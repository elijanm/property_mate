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
    _connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    app.state.rabbitmq_connection = _connection
    logger.info("action", action="rabbitmq_connected", status="success")


async def close_rabbitmq(app: FastAPI) -> None:
    if _connection:
        await _connection.close()


async def publish(queue_name: str, payload: Dict[str, Any], correlation_id: Optional[str] = None) -> None:
    if _connection is None:
        raise RuntimeError("RabbitMQ not initialised")
    channel = await _connection.channel()
    try:
        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload, default=str).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                correlation_id=correlation_id,
                content_type="application/json",
            ),
            routing_key=queue_name,
        )
    finally:
        await channel.close()
