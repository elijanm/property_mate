import json
import aio_pika
from app.core.logging import get_logger
from app.core.metrics import task_metrics_wrap

logger = get_logger(__name__)

QUEUE_NAME = "settlement.payouts"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        logger.info(
            "action",
            action="settlement_payout_started",
            resource_type="settlement",
            resource_id=payload.get("settlement_id"),
            org_id=payload.get("org_id"),
            status="started",
        )
        # TODO: implement settlement payout logic (B2C Mpesa / bank rails)


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(task_metrics_wrap(QUEUE_NAME, "settlement_payout", handle))
