from fastapi import FastAPI
from opensearchpy import AsyncOpenSearch
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


async def init_opensearch(app: FastAPI) -> None:
    client = AsyncOpenSearch(
        hosts=[{"host": settings.opensearch_host, "port": settings.opensearch_port}],
        http_auth=(settings.opensearch_user, settings.opensearch_password),
        use_ssl=settings.opensearch_use_ssl,
        verify_certs=settings.opensearch_verify_certs,
        ssl_show_warn=False,
    )
    app.state.opensearch = client
    logger.info("action", action="opensearch_connected", resource_type="opensearch", status="success")


async def close_opensearch(app: FastAPI) -> None:
    if hasattr(app.state, "opensearch"):
        await app.state.opensearch.close()
        logger.info("action", action="opensearch_disconnected", resource_type="opensearch", status="success")


def get_opensearch(app: FastAPI) -> AsyncOpenSearch:
    return app.state.opensearch
