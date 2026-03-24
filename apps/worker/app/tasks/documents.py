import json
import aio_pika
from app.core.logging import get_logger
from app.core.metrics import task_metrics_wrap

logger = get_logger(__name__)

QUEUE_NAME = "documents.generate"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        logger.info(
            "action",
            action="document_generate_started",
            resource_type="document",
            resource_id=payload.get("document_id"),
            org_id=payload.get("org_id"),
            status="started",
        )
        # TODO: implement document generation logic


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(task_metrics_wrap(QUEUE_NAME, "document_generate", handle))
