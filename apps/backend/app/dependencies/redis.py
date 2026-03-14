from fastapi import Request
from redis.asyncio import Redis

from app.core.redis import get_redis


async def get_redis_dep(request: Request) -> Redis:
    """FastAPI dependency — injects a Redis client. Override in tests."""
    return get_redis(request.app)
