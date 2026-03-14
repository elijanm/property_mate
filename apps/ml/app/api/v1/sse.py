"""
Server-Sent Events endpoint — streams inference + feedback events to the UI.

Redis pub/sub channel: ml:events
Message format (JSON): {"type": "inference"|"feedback"|"training", "data": {...}}

The ml-service publishes via publish_event(); the SSE endpoint subscribes and forwards.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, Query
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.dependencies.auth import get_current_user

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/events", tags=["SSE"])

_CHANNEL = "ml:events"


async def publish_event(event_type: str, data: dict) -> None:
    """Fire-and-forget publish — call from inference/feedback services."""
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        payload = json.dumps({"type": event_type, "data": data})
        await r.publish(_CHANNEL, payload)
        await r.aclose()
    except Exception as exc:
        logger.warning("sse_publish_failed", error=str(exc))


async def _event_generator(trainer_filter: str | None) -> AsyncIterator[dict]:
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe(_CHANNEL)
    try:
        # Send a connected heartbeat
        yield {"event": "connected", "data": json.dumps({"status": "connected"})}
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
            if msg and msg["type"] == "message":
                try:
                    payload = json.loads(msg["data"])
                    # Filter by trainer_name if requested
                    if trainer_filter:
                        dn = payload.get("data", {}).get("trainer_name")
                        if dn and dn != trainer_filter:
                            continue
                    yield {"event": payload.get("type", "event"), "data": json.dumps(payload["data"])}
                except Exception:
                    pass
            else:
                # Heartbeat every ~5s so proxy/browser doesn't close the connection
                yield {"event": "ping", "data": "{}"}
            await asyncio.sleep(0.05)
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(_CHANNEL)
        await r.aclose()


@router.get("")
async def sse_stream(
    trainer: str | None = Query(None, description="Filter by trainer_name"),
    user=Depends(get_current_user),
):
    """Subscribe to real-time inference + feedback events.

    Accepts auth via `Authorization: Bearer <token>` header OR `?token=<jwt>` query param
    (required for browser EventSource which cannot set custom headers).
    """
    return EventSourceResponse(_event_generator(trainer))
