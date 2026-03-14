"""Shared async MongoDB and Redis clients for the voice-agent service."""
import motor.motor_asyncio
import redis.asyncio as aioredis
from app.core.config import settings

_mongo_client: motor.motor_asyncio.AsyncIOMotorClient | None = None
_redis_client: aioredis.Redis | None = None


def get_mongo_client() -> motor.motor_asyncio.AsyncIOMotorClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = motor.motor_asyncio.AsyncIOMotorClient(settings.MONGODB_URL)
    return _mongo_client


def get_db() -> motor.motor_asyncio.AsyncIOMotorDatabase:
    return get_mongo_client()[settings.MONGODB_DATABASE]


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_connections() -> None:
    global _mongo_client, _redis_client
    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
    if _redis_client:
        await _redis_client.aclose()
        _redis_client = None
