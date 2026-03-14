"""
notifications.email queue handler.
Payload shape:
  { "to": "...", "subject": "...", "html": "..." }
"""
import json
import httpx
import aio_pika

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

QUEUE_NAME = "notifications.email"
_RESEND_URL = "https://api.resend.com/emails"


async def _send(to: str, subject: str, html: str) -> None:
    if not settings.resend_api_key:
        logger.warning(
            "email_skipped",
            reason="RESEND_API_KEY not configured",
            to=to,
            subject=subject,
        )
        return
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "html": html,
            },
        )
    if resp.status_code >= 400:
        logger.error("email_send_failed", status=resp.status_code, body=resp.text, to=to)
    else:
        logger.info("email_sent", to=to, subject=subject, status="success")


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        logger.info(
            "notification_email_started",
            action="send_email",
            resource_type="notification",
            org_id=payload.get("org_id"),
            status="started",
        )
        to = payload.get("to", "")
        subject = payload.get("subject", "")
        html = payload.get("html", "")
        if to and subject and html:
            await _send(to, subject, html)
        else:
            logger.warning("notification_email_invalid_payload", payload=payload)


async def start(channel: aio_pika.abc.AbstractChannel) -> None:
    queue = await channel.get_queue(QUEUE_NAME)
    await queue.consume(handle)
