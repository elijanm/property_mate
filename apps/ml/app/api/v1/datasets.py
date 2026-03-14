"""Dataset management API — admin/engineer endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies.auth import RequireEngineer
from app.models.ml_user import MLUser
import app.services.dataset_service as svc

router = APIRouter(prefix="/datasets", tags=["datasets"])


# ── Request schemas ────────────────────────────────────────────────────────────

class FieldIn(BaseModel):
    label: str
    instruction: str = ""
    type: str = "image"           # image | file | text | number
    capture_mode: str = "both"   # camera_only | upload_only | both
    required: bool = True
    description_mode: str = "none"
    description_presets: List[str] = []
    description_required: bool = False
    order: int = 0
    repeatable: bool = False
    max_repeats: int = 0
    validation_model: Optional[str] = None
    validation_labels: List[str] = []
    validation_message: str = ""


class DatasetCreateRequest(BaseModel):
    name: str
    description: str = ""
    category: str = ""
    fields: List[FieldIn] = []
    points_enabled: bool = False
    points_per_entry: int = 1
    points_redemption_info: str = ""


class DatasetUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    fields: Optional[List[FieldIn]] = None
    points_enabled: Optional[bool] = None
    points_per_entry: Optional[int] = None
    points_redemption_info: Optional[str] = None


class InviteRequest(BaseModel):
    email: str
    name: str = ""
    message: str = ""


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_datasets(user: MLUser = RequireEngineer):
    items = await svc.list_datasets(user.org_id)
    return [_profile_dict(p) for p in items]


@router.post("", status_code=201)
async def create_dataset(body: DatasetCreateRequest, user: MLUser = RequireEngineer):
    data = body.model_dump()
    return _profile_dict(await svc.create_dataset(user.org_id, data, user.email))


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str, user: MLUser = RequireEngineer):
    profile = await svc.get_dataset(user.org_id, dataset_id)
    collectors = await svc.get_collectors(user.org_id, dataset_id)
    resp = _profile_dict(profile)
    resp["collectors"] = [_collector_dict(c) for c in collectors]
    return resp


@router.patch("/{dataset_id}")
async def update_dataset(dataset_id: str, body: DatasetUpdateRequest, user: MLUser = RequireEngineer):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    return _profile_dict(await svc.update_dataset(user.org_id, dataset_id, data))


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, user: MLUser = RequireEngineer):
    await svc.delete_dataset(user.org_id, dataset_id)


@router.post("/{dataset_id}/invite", status_code=201)
async def invite_collector(dataset_id: str, body: InviteRequest, user: MLUser = RequireEngineer):
    collector = await svc.invite_collector(user.org_id, dataset_id, body.email, body.name, body.message)
    return _collector_dict(collector)


@router.get("/{dataset_id}/collectors")
async def list_collectors(dataset_id: str, user: MLUser = RequireEngineer):
    collectors = await svc.get_collectors(user.org_id, dataset_id)
    return [_collector_dict(c) for c in collectors]


@router.delete("/{dataset_id}/collectors/{collector_id}", status_code=204)
async def remove_collector(dataset_id: str, collector_id: str, user: MLUser = RequireEngineer):
    await svc.remove_collector(user.org_id, dataset_id, collector_id)


@router.get("/{dataset_id}/entries")
async def get_entries(
    dataset_id: str,
    field_id: Optional[str] = None,
    collector_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: MLUser = RequireEngineer,
):
    return await svc.get_entries(user.org_id, dataset_id, field_id, collector_id, date_from, date_to)


# ── Serialisers ────────────────────────────────────────────────────────────────

def _profile_dict(p) -> dict:
    d = p.model_dump()
    d["id"] = str(p.id)
    return d


def _collector_dict(c) -> dict:
    d = c.model_dump()
    d["id"] = str(c.id)
    return d
