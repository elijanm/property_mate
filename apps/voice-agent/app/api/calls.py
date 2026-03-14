"""REST endpoints for querying call sessions.

GET  /calls                     — list sessions (paginated)
GET  /calls/{session_id}        — single session with full transcript
POST /calls/{ccid}/answer       — staff manually triggers media stream (manual mode)
POST /calls/{ccid}/hangup       — hang up a call (in-process or Telnyx)
GET  /calls/{session_id}/recording — presigned S3 URL for call recording playback
"""
import aioboto3
from fastapi import APIRouter, HTTPException, Query
import structlog
from app.core import active_calls as _active_calls
from app.core.config import settings
from app.core.database import get_db
from app.models.conversation import CallSessionDocument
from app.telnyx_utils import client as telnyx

router = APIRouter(prefix="/calls", tags=["calls"])
logger = structlog.get_logger(__name__)


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id", ""))
    return doc


@router.get("")
async def list_calls(
    org_id: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    db = get_db()
    filt: dict = {}
    if org_id:
        filt["org_id"] = org_id
    if status:
        filt["status"] = status

    skip = (page - 1) * page_size
    cursor = db[CallSessionDocument.COLLECTION].find(filt).sort("started_at", -1).skip(skip).limit(page_size)
    items = [_clean(d) async for d in cursor]
    total = await db[CallSessionDocument.COLLECTION].count_documents(filt)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{session_id}")
async def get_call(session_id: str):
    db = get_db()
    doc = await db[CallSessionDocument.COLLECTION].find_one({"_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    return _clean(doc)


@router.post("/{call_control_id}/answer")
async def manual_answer(call_control_id: str):
    """Staff clicks 'Answer' in the dashboard — starts media stream for auto-AI mode."""
    stream_url = (
        f"{settings.PUBLIC_BASE_URL}/ws/media/{call_control_id}"
        .replace("https://", "wss://")
        .replace("http://", "ws://")
    )
    ok = await telnyx.start_media_stream(call_control_id, stream_url)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to start media stream")
    # Update session to reflect AI taking over
    db = get_db()
    await db[CallSessionDocument.COLLECTION].update_one(
        {"call_control_id": call_control_id},
        {"$set": {"auto_mode": True}},
    )
    return {"started": True}


@router.post("/{call_control_id}/hangup")
async def hangup(call_control_id: str):
    """Terminate a call. Tries in-process EndFrame first (works for browser + Telnyx),
    then falls back to Telnyx API hangup for externally initiated calls."""
    ended_in_process = await _active_calls.hangup(call_control_id)
    if not ended_in_process:
        # Not in this process (or already ended) — try Telnyx API
        await telnyx.hangup_call(call_control_id)
    return {"ok": True}


@router.get("/{session_id}/recording")
async def get_recording(session_id: str):
    """Return a short-lived presigned URL for the call recording WAV."""
    db = get_db()
    doc = await db[CallSessionDocument.COLLECTION].find_one(
        {"_id": session_id}, {"recording_key": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    recording_key = doc.get("recording_key")
    if not recording_key:
        raise HTTPException(status_code=404, detail="No recording for this call")

    # Sign against the public-facing endpoint so the URL is directly usable by browsers.
    # MinIO uploads use the internal Docker URL (S3_ENDPOINT_URL); presigned download
    # links must use the public URL (S3_PUBLIC_ENDPOINT_URL) so browsers can reach MinIO.
    public_endpoint = (settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL).rstrip("/")

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=public_endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        url: str = await s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET, "Key": recording_key},
            ExpiresIn=3600,
        )

    return {"url": url, "key": recording_key}


@router.delete("/{session_id}")
async def delete_call(session_id: str):
    """GDPR deletion — remove call transcript, recording reference, and PII from a session.

    Does NOT hard-delete the document (preserves audit trail) but clears sensitive content.
    """
    db = get_db()
    result = await db[CallSessionDocument.COLLECTION].update_one(
        {"_id": session_id},
        {"$set": {
            "transcript": [],
            "tool_calls": [],
            "summary": "[deleted]",
            "recording_key": None,
            "caller_number": "[redacted]",
            "tenant_name": "[redacted]",
            "tenant_id": None,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Call session not found")
    return {"deleted": True, "session_id": session_id}
