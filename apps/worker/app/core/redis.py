from redis.asyncio import ConnectionPool, Redis
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_pool: ConnectionPool = None


async def connect_redis() -> None:
    global _pool
    _pool = ConnectionPool.from_url(settings.redis_url, decode_responses=True)
    logger.info("action", action="redis_connected", resource_type="redis", status="success")


async def disconnect_redis() -> None:
    global _pool
    if _pool:
        await _pool.aclose()
        logger.info("action", action="redis_disconnected", resource_type="redis", status="success")


def get_redis() -> Redis:
    return Redis(connection_pool=_pool)
