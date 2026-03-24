import json
import aio_pika
from app.core.logging import get_logger
from app.core.metrics import task_metrics_wrap

logger = get_logger(__name__)

QUEUE_NAME = "media.processing"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        logger.info(
            "action",
            action="media_processing_started",
            resource_type="media",
            resource_id=payload.get("media_id"),
            org_id=payload.get("org_id"),
            status="started",
        )
        # TODO: implement media processing (thumbnail generation, virus scan, OCR, etc.)


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(task_metrics_wrap(QUEUE_NAME, "media_processing", handle))
