import json
import aio_pika
from app.core.logging import get_logger
from app.core.opensearch import get_opensearch

logger = get_logger(__name__)

QUEUE_NAME = "search.index"


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        org_id = payload.get("org_id")
        index_name = payload.get("index_name")
        document_id = payload.get("document_id")
        action = payload.get("action", "upsert")
        document = payload.get("document")

        logger.info(
            "search_index_started",
            action="search_index",
            resource_type=index_name,
            resource_id=document_id,
            org_id=org_id,
            status="started",
        )

        try:
            os_client = get_opensearch()

            if action == "delete":
                await os_client.delete(index=index_name, id=document_id, ignore=[404])
            elif action in ("upsert", "bulk_upsert") and document:
                # Always include org_id for tenant isolation
                doc_body = {**document, "org_id": org_id}
                await os_client.index(
                    index=index_name,
                    id=document_id,
                    body=doc_body,
                )

            logger.info(
                "search_index_completed",
                action="search_index",
                resource_type=index_name,
                resource_id=document_id,
                org_id=org_id,
                status="success",
            )
        except Exception as exc:
            logger.error(
                "search_index_failed",
                action="search_index",
                resource_type=index_name,
                resource_id=document_id,
                org_id=org_id,
                status="error",
                error=str(exc),
            )
            raise


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
