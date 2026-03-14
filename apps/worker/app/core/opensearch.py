from typing import Optional
from opensearchpy import AsyncOpenSearch
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_client: Optional[AsyncOpenSearch] = None


async def connect_opensearch() -> None:
    global _client
    _client = AsyncOpenSearch(
        hosts=[{"host": settings.opensearch_host, "port": settings.opensearch_port}],
        http_auth=(settings.opensearch_user, settings.opensearch_password),
        use_ssl=settings.opensearch_use_ssl,
        verify_certs=settings.opensearch_verify_certs,
        ssl_show_warn=False,
    )
    logger.info("action", action="opensearch_connected", resource_type="opensearch", status="success")


async def disconnect_opensearch() -> None:
    global _client
    if _client:
        await _client.close()


def get_opensearch() -> AsyncOpenSearch:
    if _client is None:
        raise RuntimeError("OpenSearch not initialised")
    return _client
