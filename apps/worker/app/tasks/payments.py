import json
import aio_pika
from app.core.logging import get_logger

logger = get_logger(__name__)

QUEUE_NAME = "payments.webhooks"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        logger.info(
            "action",
            action="payment_webhook_received",
            resource_type="payment",
            status="started",
        )
        # TODO: implement payment webhook processing (Mpesa C2B, B2C reconciliation)


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
