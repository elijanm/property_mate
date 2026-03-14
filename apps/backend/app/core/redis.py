from typing import Optional

from fastapi import FastAPI
from redis.asyncio import ConnectionPool, Redis
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Module-level pool so services can get a Redis client without needing the app instance
_pool: Optional[ConnectionPool] = None


async def init_redis(app: FastAPI) -> None:
    global _pool
    pool = ConnectionPool.from_url(
        settings.redis_url,
        max_connections=settings.redis_max_connections,
        decode_responses=True,
    )
    _pool = pool
    app.state.redis_pool = pool
    logger.info("action", action="redis_connected", resource_type="redis", status="success")


async def close_redis(app: FastAPI) -> None:
    global _pool
    if hasattr(app.state, "redis_pool"):
        await app.state.redis_pool.aclose()
        _pool = None
        logger.info("action", action="redis_disconnected", resource_type="redis", status="success")


def get_redis(app: FastAPI) -> Redis:
    return Redis(connection_pool=app.state.redis_pool)


def get_redis_client() -> Redis:
    """Module-level helper for service layer (no app instance needed)."""
    if _pool is None:
        raise RuntimeError("Redis not initialised — call init_redis first")
    return Redis(connection_pool=_pool)
