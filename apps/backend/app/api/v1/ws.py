"""WebSocket endpoint — real-time notifications via Redis pub/sub.

Horizontal-scaling safe: any API instance can forward messages because the
worker publishes to Redis pub/sub and all instances subscribe on behalf of
their connected clients.

Connect: ws(s)://<host>/api/v1/ws?token=<jwt>
"""
import asyncio
import contextlib

import structlog
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from app.core.config import settings
from app.core.redis import get_redis_client

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_notifications(
    ws: WebSocket,
    token: str = Query(..., description="JWT access token (browsers cannot set WS headers)"),
) -> None:
    """Subscribe to real-time notifications for the authenticated user's org."""
    # --- Validate JWT manually (Depends() doesn't work on WS handshakes) ---
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        org_id: str = payload.get("org_id", "")
        user_id: str = payload.get("sub", "")
        if not org_id or not user_id:
            await ws.close(code=4401)
            return
    except JWTError:
        await ws.close(code=4401)
        return

    await ws.accept()

    logger.info(
        "ws_connected",
        action="ws_connect",
        resource_type="websocket",
        org_id=org_id,
        user_id=user_id,
        status="success",
    )

    redis = get_redis_client()
    pubsub = redis.pubsub()
    channel = f"ws:notifications:{org_id}"
    await pubsub.subscribe(channel)

    async def _forward() -> None:
        """Read from Redis pub/sub and forward to WS client."""
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    await ws.send_text(message["data"])
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("ws_forward_error", org_id=org_id, exc_info=exc)

    forward_task = asyncio.create_task(_forward())

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        forward_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await forward_task
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        logger.info(
            "ws_disconnected",
            action="ws_disconnect",
            resource_type="websocket",
            org_id=org_id,
            user_id=user_id,
            status="success",
        )
