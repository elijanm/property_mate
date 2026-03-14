from typing import List, Optional, Type

from beanie import Document, init_beanie
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: Optional[AsyncIOMotorClient] = None


async def init_db(app: FastAPI, document_models: List[Type[Document]] = None) -> None:
    global _client
    client = AsyncIOMotorClient(
        settings.mongo_uri,
        maxPoolSize=settings.mongo_max_pool_size,
    )
    _client = client
    app.state.mongo_client = client
    db = client[settings.mongo_db]
    app.state.mongo_db = db

    if document_models:
        await init_beanie(database=db, document_models=document_models)

    logger.info("action", action="db_connected", resource_type="mongodb", status="success")


async def close_db(app: FastAPI) -> None:
    if hasattr(app.state, "mongo_client"):
        app.state.mongo_client.close()
        logger.info("action", action="db_disconnected", resource_type="mongodb", status="success")


def get_db(app: FastAPI):
    return app.state.mongo_db


def get_motor_client() -> AsyncIOMotorClient:
    """Return the module-level Motor client for use in services (transactions)."""
    if _client is None:
        raise RuntimeError("Database not initialised — call init_db first")
    return _client


def get_motor_db():
    """FastAPI dependency — returns the Motor database instance."""
    if _client is None:
        raise RuntimeError("Database not initialised — call init_db first")
    return _client[settings.mongo_db]
