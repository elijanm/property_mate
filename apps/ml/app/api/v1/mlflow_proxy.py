"""Proxy endpoint for MLflow artifacts.

The browser cannot reach http://mlflow:5000 (internal Docker network), so
artifact image URLs are rewritten to /api/v1/mlflow/artifact?run_uuid=...&path=...
and this endpoint fetches the bytes from MLflow and streams them back.
"""
import httpx
from fastapi import APIRouter, Query
from fastapi.responses import Response, StreamingResponse

from app.core.config import settings

router = APIRouter(prefix="/mlflow", tags=["mlflow-proxy"])

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


@router.get("/artifact")
async def proxy_mlflow_artifact(
    run_uuid: str = Query(...),
    path: str = Query(...),
):
    """Fetch a MLflow artifact and stream it back to the browser."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{settings.MLFLOW_TRACKING_URI}/get-artifact",
                params={"run_uuid": run_uuid, "path": path},
            )
    except httpx.RequestError:
        return Response(content=_PLACEHOLDER_SVG, media_type="image/svg+xml")

    if resp.status_code != 200:
        return Response(content=_PLACEHOLDER_SVG, media_type="image/svg+xml")

    content_type = resp.headers.get("content-type", "image/png")

    async def _stream():
        yield resp.content

    return StreamingResponse(_stream(), media_type=content_type)
