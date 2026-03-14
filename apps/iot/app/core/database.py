from typing import List, Optional, Type
from beanie import Document, init_beanie
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)
_client: Optional[AsyncIOMotorClient] = None


async def init_db(app: FastAPI, document_models: List[Type[Document]]) -> None:
    global _client
    client = AsyncIOMotorClient(settings.mongo_uri, maxPoolSize=settings.mongo_max_pool_size)
    _client = client
    app.state.mongo_client = client
    db = client[settings.mongo_db]
    await init_beanie(database=db, document_models=document_models)
    logger.info("action", action="db_connected", resource_type="mongodb", status="success")


async def close_db(app: FastAPI) -> None:
    if hasattr(app.state, "mongo_client"):
        app.state.mongo_client.close()


def get_motor_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Database not initialised")
    return _client
