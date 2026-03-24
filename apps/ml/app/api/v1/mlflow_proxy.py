"""Proxy endpoint for MLflow artifacts.

The browser cannot reach http://mlflow:5000 (internal Docker network), so
artifact image URLs are rewritten to /api/v1/mlflow/artifact?run_uuid=...&path=...
and this endpoint fetches the bytes from MLflow and streams them back.

Uses MlflowClient.download_artifacts() which works for any backend (local FS,
S3/MinIO, Azure Blob, GCS) — more reliable than the /get-artifact HTTP endpoint
which doesn't work with S3-backed stores.
"""
import asyncio
import structlog
import tempfile
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import Response
from mlflow.tracking import MlflowClient

from app.core.config import settings

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/mlflow", tags=["mlflow-proxy"])

_CONTENT_TYPES = {
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg":  "image/svg+xml",
    ".gif":  "image/gif",
    ".webp": "image/webp",
}

_PLACEHOLDER_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <rect width="480" height="320" fill="#111827" rx="8"/>
  <rect x="20" y="20" width="440" height="280" fill="#1f2937" rx="6" stroke="#374151" stroke-width="1"/>
  <line x1="60" y1="260" x2="60" y2="60" stroke="#374151" stroke-width="1.5"/>
  <line x1="60" y1="260" x2="420" y2="260" stroke="#374151" stroke-width="1.5"/>
  <polyline points="80,220 140,180 200,200 260,140 320,160 380,100 420,120"
            fill="none" stroke="#6b7280" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="240" y="310" font-family="ui-monospace,monospace" font-size="11"
        fill="#6b7280" text-anchor="middle">Plot not available</text>
</svg>"""


def _download_sync(run_uuid: str, path: str) -> tuple[bytes, str]:
    """Download artifact via MLflow Python SDK (handles S3/MinIO, local FS, etc.)."""
    client = MlflowClient(tracking_uri=settings.MLFLOW_TRACKING_URI)
    with tempfile.TemporaryDirectory() as tmpdir:
        local = client.download_artifacts(run_uuid, path, tmpdir)
        content = Path(local).read_bytes()
        suffix = Path(local).suffix.lower()
    return content, suffix


@router.get("/artifact")
async def proxy_mlflow_artifact(
    run_uuid: str = Query(...),
    path: str = Query(...),
):
    """Fetch a MLflow artifact and stream it back to the browser."""
    loop = asyncio.get_event_loop()
    try:
        content, suffix = await loop.run_in_executor(None, _download_sync, run_uuid, path)
        content_type = _CONTENT_TYPES.get(suffix, "image/png")
        return Response(content=content, media_type=content_type)
    except Exception as exc:
        logger.warning(
            "mlflow_artifact_proxy_failed",
            run_uuid=run_uuid,
            path=path,
            error=str(exc),
        )
        return Response(content=_PLACEHOLDER_SVG, media_type="image/svg+xml")
