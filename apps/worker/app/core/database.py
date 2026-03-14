from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: AsyncIOMotorClient = None
_db: AsyncIOMotorDatabase = None


async def connect_db() -> None:
    global _client, _db
    _client = AsyncIOMotorClient(settings.mongo_uri)
    _db = _client[settings.mongo_db]
    logger.info("action", action="db_connected", resource_type="mongodb", status="success")


async def disconnect_db() -> None:
    global _client
    if _client:
        _client.close()
        logger.info("action", action="db_disconnected", resource_type="mongodb", status="success")


def get_db() -> AsyncIOMotorDatabase:
    return _db
