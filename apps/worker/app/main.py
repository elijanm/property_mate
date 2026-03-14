import asyncio
from app.core.logging import configure_logging, get_logger
from app.core.rabbitmq import connect, disconnect, declare_queues, get_channel
from app.core.database import connect_db, disconnect_db
from app.core.redis import connect_redis, disconnect_redis
from app.core.opensearch import connect_opensearch, disconnect_opensearch
from app.core.scheduler import create_scheduler
from app.tasks import billing, documents, notifications, search_index, cache_invalidate, media, payments, settlements, unit_generation
from app.tasks import iot_meter_reading, iot_lock_event, iot_alert, iot_device_lifecycle

logger = get_logger(__name__)


async def start_consumers(channel) -> None:
    await channel.set_qos(prefetch_count=10)

    await billing.start(channel)
    await documents.start(channel)
    await notifications.start(channel)
    await search_index.start(channel)
    await cache_invalidate.start(channel)
    await media.start(channel)
    await payments.start(channel)
    await settlements.start(channel)
    await unit_generation.start(channel)
    await iot_meter_reading.start(channel)
    await iot_lock_event.start(channel)
    await iot_alert.start(channel)
    await iot_device_lifecycle.start(channel)

    logger.info("action", action="consumers_started", status="success")


async def main() -> None:
    configure_logging()

    await connect_db()
    await connect_redis()
    await connect_opensearch()

    connection = await connect()
    channel = await get_channel()

    await declare_queues(channel)

    # Re-open a fresh channel for consumers (after declaration)
    consumer_channel = await connection.channel()
    await start_consumers(consumer_channel)

    # Start APScheduler for automated billing
    scheduler = create_scheduler()
    scheduler.start()
    logger.info("action", action="scheduler_started", status="success")

    logger.info("action", action="worker_started", status="success")

    try:
        await asyncio.Future()  # run forever
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("action", action="worker_stopping", status="started")
    finally:
        scheduler.shutdown(wait=False)
        await disconnect()
        await disconnect_opensearch()
        await disconnect_redis()
        await disconnect_db()
        logger.info("action", action="worker_stopped", status="success")


if __name__ == "__main__":
    asyncio.run(main())
