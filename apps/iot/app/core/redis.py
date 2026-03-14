from typing import Optional
import redis.asyncio as aioredis
from fastapi import FastAPI
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)
_redis: Optional[aioredis.Redis] = None


async def init_redis(app: FastAPI) -> None:
    global _redis
    _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    app.state.redis = _redis
    logger.info("action", action="redis_connected", resource_type="redis", status="success")


async def close_redis(app: FastAPI) -> None:
    if _redis:
        await _redis.aclose()


def get_redis() -> aioredis.Redis:
    if _redis is None:
        raise RuntimeError("Redis not initialised")
    return _redis
