import aio_pika
from aio_pika import ExchangeType
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_QUEUES = [
    "pms.events",
    "payments.webhooks",
    "billing.runs",
    "settlement.payouts",
    "media.processing",
    "documents.generate",
    "notifications.email",
    "search.index",
    "cache.invalidate",
    "property.units.generate",
    # IoT queues
    "iot.meter_reading",
    "iot.lock_event",
    "iot.alert",
    "iot.device_status",
    "iot.device_lifecycle",
]

_connection: aio_pika.RobustConnection = None


async def connect() -> aio_pika.RobustConnection:
    global _connection
    _connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    logger.info("action", action="rabbitmq_connected", resource_type="rabbitmq", status="success")
    return _connection


async def disconnect() -> None:
    global _connection
    if _connection:
        await _connection.close()
        logger.info("action", action="rabbitmq_disconnected", resource_type="rabbitmq", status="success")


async def declare_queues(channel: aio_pika.abc.AbstractChannel) -> None:
    """Declare all main queues + retry queues + DLQs."""
    for queue_name in _QUEUES:
        dlq_name = f"{queue_name}.dlq"
        retry_name = f"{queue_name}.retry"

        # DLQ — messages exhausting retries land here
        await channel.declare_queue(dlq_name, durable=True)

        # Main queue — failed messages go to retry exchange
        retry_exchange = await channel.declare_exchange(
            f"{queue_name}.retry.exchange",
            ExchangeType.DIRECT,
            durable=True,
        )
        main_queue = await channel.declare_queue(
            queue_name,
            durable=True,
            arguments={
                "x-dead-letter-exchange": f"{queue_name}.retry.exchange",
            },
        )

        # Retry queue — TTL 30s then routes back to main exchange
        main_exchange = await channel.declare_exchange(
            queue_name,
            ExchangeType.DIRECT,
            durable=True,
        )
        retry_queue = await channel.declare_queue(
            retry_name,
            durable=True,
            arguments={
                "x-dead-letter-exchange": queue_name,
                "x-message-ttl": 30_000,
            },
        )

        await main_queue.bind(main_exchange, routing_key=queue_name)
        await retry_queue.bind(retry_exchange, routing_key=queue_name)

        logger.info(
            "action",
            action="queue_declared",
            resource_type="queue",
            resource_id=queue_name,
            status="success",
        )


async def get_channel() -> aio_pika.abc.AbstractChannel:
    return await _connection.channel()


def get_connection() -> aio_pika.RobustConnection:
    return _connection
