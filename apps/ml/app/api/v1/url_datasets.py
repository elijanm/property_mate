"""URL Dataset management endpoints.

URL datasets are created automatically on first training run via the trainer's
UrlDatasetDataSource(slug=..., source_url=...) definition — no manual creation needed.
These endpoints are for viewing, updating hooks/schedule, manual refresh, and deletion.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel

from app.dependencies.auth import get_current_user
from app.models.url_dataset import UrlDataset
from app.models.ml_user import MLUser
from app.services import url_dataset_service
from app.utils.datetime import utc_now

router = APIRouter(tags=["URL Datasets"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class UrlDatasetUpdateRequest(BaseModel):
    name: Optional[str] = None
    refresh_interval_hours: Optional[int] = None
    url_field: Optional[str] = None
    max_items: Optional[int] = None
    on_change_webhook_url: Optional[str] = None
    on_change_retrain: Optional[str] = None


class UrlDatasetResponse(BaseModel):
    id: str
    org_id: str
    name: str
    slug: Optional[str]
    source_url: str
    refresh_interval_hours: int
    url_field: Optional[str]
    max_items: Optional[int]
    content_type: str
    status: str
    item_count: Optional[int]
    size_bytes: Optional[int]
    content_hash: Optional[str]
    last_fetched_at: Optional[str]
    next_fetch_at: Optional[str]
    fetch_error: Optional[str]
    on_change_webhook_url: Optional[str]
    on_change_retrain: Optional[str]
    dataset_profile_id: Optional[str]
    created_at: str
    updated_at: str

    @classmethod
    def from_doc(cls, d: UrlDataset) -> "UrlDatasetResponse":
        return cls(
            id=str(d.id),
            org_id=d.org_id,
            name=d.name,
            slug=d.slug,
            source_url=d.source_url,
            refresh_interval_hours=d.refresh_interval_hours,
            url_field=d.url_field,
            max_items=d.max_items,
            content_type=d.content_type,
            status=d.status,
            item_count=d.item_count,
            size_bytes=d.size_bytes,
            content_hash=d.content_hash,
            last_fetched_at=d.last_fetched_at.isoformat() if d.last_fetched_at else None,
            next_fetch_at=d.next_fetch_at.isoformat() if d.next_fetch_at else None,
            fetch_error=d.fetch_error,
            on_change_webhook_url=d.on_change_webhook_url,
            on_change_retrain=d.on_change_retrain,
            dataset_profile_id=d.dataset_profile_id,
            created_at=d.created_at.isoformat(),
            updated_at=d.updated_at.isoformat(),
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/url-datasets", response_model=List[UrlDatasetResponse])
async def list_url_datasets(user: MLUser = Depends(get_current_user)):
    """List all URL datasets for the current org (auto-created by trainers)."""
    sources = await UrlDataset.find({
        "org_id": user.org_id or "",
        "deleted_at": None,
    }).sort("-created_at").to_list()
    return [UrlDatasetResponse.from_doc(s) for s in sources]


@router.get("/url-datasets/{source_id}", response_model=UrlDatasetResponse)
async def get_url_dataset(source_id: str, user: MLUser = Depends(get_current_user)):
    src = await _get_or_404(source_id, user.org_id or "")
    return UrlDatasetResponse.from_doc(src)


@router.patch("/url-datasets/{source_id}", response_model=UrlDatasetResponse)
async def update_url_dataset(
    source_id: str,
    body: UrlDatasetUpdateRequest,
    user: MLUser = Depends(get_current_user),
):
    """Update refresh schedule, hooks, or metadata."""
    src = await _get_or_404(source_id, user.org_id or "")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if updates:
        updates["updated_at"] = utc_now()
        await src.set(updates)
        src = await _get_or_404(source_id, user.org_id or "")
    return UrlDatasetResponse.from_doc(src)


@router.post("/url-datasets/{source_id}/refresh", response_model=UrlDatasetResponse)
async def refresh_url_dataset(
    source_id: str,
    background_tasks: BackgroundTasks,
    user: MLUser = Depends(get_current_user),
):
    """Manually trigger a re-fetch of the URL content."""
    src = await _get_or_404(source_id, user.org_id or "")
    if src.status == "fetching":
        raise HTTPException(status_code=409, detail="Fetch already in progress")
    background_tasks.add_task(url_dataset_service.fetch_and_store, source_id)
    await src.set({"status": "fetching", "updated_at": utc_now()})
    return UrlDatasetResponse.from_doc(src)


@router.delete("/url-datasets/{source_id}", status_code=204)
async def delete_url_dataset(source_id: str, user: MLUser = Depends(get_current_user)):
    src = await _get_or_404(source_id, user.org_id or "")
    await src.set({"deleted_at": utc_now(), "updated_at": utc_now()})


# ── Helper ────────────────────────────────────────────────────────────────────

async def _get_or_404(source_id: str, org_id: str) -> UrlDataset:
    try:
        from beanie import PydanticObjectId
        src = await UrlDataset.find_one({
            "_id": PydanticObjectId(source_id),
            "org_id": org_id,
            "deleted_at": None,
        })
    except Exception:
        src = None
    if not src:
        raise HTTPException(status_code=404, detail="URL dataset not found")
    return src
