import json
import aio_pika
from app.core.logging import get_logger
from app.core.redis import get_redis

logger = get_logger(__name__)

QUEUE_NAME = "cache.invalidate"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        keys = payload.get("keys", [])
        org_id = payload.get("org_id")

        if keys:
            redis = get_redis()
            await redis.delete(*keys)

        logger.info(
            "action",
            action="cache_invalidated",
            resource_type="cache",
            org_id=org_id,
            status="success",
        )


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
