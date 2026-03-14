"""WebSocket notification service — publishes to Redis pub/sub so all API instances
forward messages to the relevant org's connected WebSocket clients."""
import json
from typing import Any, Dict, Optional
from uuid import uuid4

import structlog

from app.core.redis import get_redis_client
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def publish_notification(
    org_id: str,
    event_type: str,
    title: str,
    message: str,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    """Publish a notification to all WebSocket clients subscribed for org_id."""
    payload = json.dumps({
        "id": str(uuid4()),
        "type": event_type,
        "title": title,
        "message": message,
        "data": data or {},
        "org_id": org_id,
        "timestamp": utc_now().isoformat(),
    })
    channel = f"ws:notifications:{org_id}"
    try:
        redis = get_redis_client()
        await redis.publish(channel, payload)
        logger.debug(
            "ws_notification_published",
            action="publish_notification",
            resource_type="ws_notification",
            org_id=org_id,
            event_type=event_type,
            status="success",
        )
    except Exception as exc:
        logger.error(
            "ws_notification_failed",
            action="publish_notification",
            resource_type="ws_notification",
            org_id=org_id,
            event_type=event_type,
            status="error",
            error_code="WS_PUBLISH_ERROR",
            exc_info=exc,
        )
