"""Dataset management API — admin/engineer endpoints."""
import csv
import io
from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse
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
    slug: Optional[str] = None
    description: str = ""
    category: str = ""
    fields: List[FieldIn] = []
    visibility: str = "private"
    discoverable: bool = False
    contributor_allowlist: List[str] = []
    points_enabled: bool = False
    points_per_entry: int = 1
    points_redemption_info: str = ""
    require_location: bool = False
    location_purpose: str = ""


class DatasetUpdateRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    visibility: Optional[str] = None
    discoverable: Optional[bool] = None
    contributor_allowlist: Optional[List[str]] = None
    fields: Optional[List[FieldIn]] = None
    points_enabled: Optional[bool] = None
    points_per_entry: Optional[int] = None
    points_redemption_info: Optional[str] = None
    require_location: Optional[bool] = None
    location_purpose: Optional[str] = None


class VisibilityRequest(BaseModel):
    visibility: str   # private | public


class InviteRequest(BaseModel):
    email: str
    name: str = ""
    message: str = ""

class AddCollectorRequest(BaseModel):
    name: str
    email: str = ""
    phone: str = ""


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_datasets(user: MLUser = RequireEngineer):
    items = await svc.list_datasets(user.org_id)
    return [_profile_dict(p) for p in items]


@router.get("/public")
async def list_public_datasets(user: MLUser = RequireEngineer):
    """Return all public datasets from other orgs (for discovery / clone / reference)."""
    items = await svc.list_public_datasets(exclude_org_id=user.org_id)
    return [_profile_dict(p) for p in items]


@router.post("", status_code=201)
async def create_dataset(body: DatasetCreateRequest, user: MLUser = RequireEngineer):
    data = body.model_dump()
    return _profile_dict(await svc.create_dataset(user.org_id, data, user.email, acting_email=user.email))


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
    return _profile_dict(await svc.update_dataset(user.org_id, dataset_id, data, acting_email=user.email))


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, user: MLUser = RequireEngineer):
    await svc.delete_dataset(user.org_id, dataset_id)


@router.patch("/{dataset_id}/visibility")
async def set_visibility(dataset_id: str, body: VisibilityRequest, user: MLUser = RequireEngineer):
    """Toggle a dataset between private and public."""
    return _profile_dict(await svc.set_visibility(user.org_id, dataset_id, body.visibility))


@router.post("/{dataset_id}/clone", status_code=201)
async def clone_dataset(dataset_id: str, user: MLUser = RequireEngineer):
    """
    Clone a public dataset into the caller's org.
    Copies schema/fields — the user uploads their own data.
    Counts against caller's storage.
    """
    return _profile_dict(await svc.clone_dataset(user.org_id, dataset_id, user.email))


@router.post("/{dataset_id}/reference", status_code=201)
async def reference_dataset(dataset_id: str, user: MLUser = RequireEngineer):
    """
    Add a read-only reference to a public dataset.
    No data is copied — reads always proxy to the source.
    No extra storage incurred; cannot add/modify entries.
    """
    return _profile_dict(await svc.reference_dataset(user.org_id, dataset_id, user.email))


@router.post("/{dataset_id}/invite", status_code=201)
async def invite_collector(dataset_id: str, body: InviteRequest, user: MLUser = RequireEngineer):
    collector = await svc.invite_collector(user.org_id, dataset_id, body.email, body.name, body.message)
    return _collector_dict(collector)


@router.post("/{dataset_id}/collectors", status_code=201)
async def add_collector(dataset_id: str, body: AddCollectorRequest, user: MLUser = RequireEngineer):
    """Add a contributor by name/phone/email without sending an invite email."""
    collector = await svc.add_collector(user.org_id, dataset_id, body.name, body.email, body.phone)
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


@router.get("/{dataset_id}/entry-count")
async def get_entry_count(dataset_id: str, user: MLUser = RequireEngineer):
    """Return the total number of entries in a dataset (fast check for empty state)."""
    count = await svc.get_entry_count(user.org_id, dataset_id)
    return {"dataset_id": dataset_id, "count": count}


@router.post("/{dataset_id}/entries/upload", status_code=201)
async def upload_entry_direct(
    dataset_id: str,
    field_id: str = Form(...),
    file: Optional[UploadFile] = File(None),
    text_value: Optional[str] = Form(None),
    user: MLUser = RequireEngineer,
):
    """Admin direct entry upload — no collector token needed. Use for seeding datasets from the Trainers page."""
    return await svc.upload_entry_direct(
        user.org_id, dataset_id, field_id, file, text_value, user.email
    )


@router.get("/{dataset_id}/overview")
async def get_dataset_overview(dataset_id: str, user: MLUser = RequireEngineer):
    """Return a rich summary: entry stats, location breakdown, daily trend, top collectors."""
    return await svc.get_dataset_overview(user.org_id, dataset_id)


@router.get("/{dataset_id}/export")
async def export_dataset_csv(dataset_id: str, user: MLUser = RequireEngineer):
    """
    Export all entries as a CSV file.
    Columns: entry_id, field_label, field_type, text_value, file_url, collector_id,
             captured_at, review_status.
    File entries include their presigned S3 URL in the file_url column.
    """
    profile = await svc.get_dataset(user.org_id, dataset_id)
    entries = await svc.get_entries(user.org_id, dataset_id)

    field_map = {f.id: f for f in profile.fields}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "entry_id", "field_label", "field_type",
        "text_value", "file_url",
        "collector_id", "captured_at", "review_status",
    ])
    for entry in entries:
        field = field_map.get(entry.get("field_id", ""))
        # file_url is the proxy path (/api/v1/…/file) or a MEDIA_BASE_URL public URL;
        # for the CSV export we want a direct download link so prefer a fresh presigned
        # URL from the raw file_key, falling back to the proxy path.
        from app.utils.s3_url import generate_presigned_url as _presign
        file_key = entry.get("file_key") or ""
        file_url = (_presign(file_key) if file_key else "") or entry.get("file_url") or ""
        writer.writerow([
            entry.get("id", ""),
            field.label if field else entry.get("field_id", ""),
            field.type if field else "",
            entry.get("text_value") or "",
            file_url,
            entry.get("collector_id", ""),
            entry.get("captured_at", ""),
            entry.get("review_status", ""),
        ])

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in profile.name)[:48]
    filename = f"{safe_name}_entries.csv"
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/by-slug/{slug}")
async def get_dataset_by_slug(slug: str, user: MLUser = RequireEngineer):
    """Look up a dataset by its slug (URL-friendly name) instead of ID."""
    profile = await svc.get_dataset_by_slug(user.org_id, slug)
    collectors = await svc.get_collectors(user.org_id, str(profile.id))
    resp = _profile_dict(profile)
    resp["collectors"] = [_collector_dict(c) for c in collectors]
    return resp


# ── Serialisers ────────────────────────────────────────────────────────────────

def _profile_dict(p) -> dict:
    d = p.model_dump()
    d["id"] = str(p.id)
    return d


def _collector_dict(c) -> dict:
    d = c.model_dump()
    d["id"] = str(c.id)
    return d


class EntryReviewRequest(BaseModel):
    status: str          # approved | rejected
    note: Optional[str] = None


@router.patch("/{dataset_id}/entries/{entry_id}/review")
async def review_entry(dataset_id: str, entry_id: str, body: EntryReviewRequest, user: MLUser = RequireEngineer):
    """Approve or reject a dataset entry."""
    return await svc.review_entry(user.org_id, dataset_id, entry_id, body.status, body.note)


@router.delete("/{dataset_id}/entries/{entry_id}", status_code=204)
async def delete_entry(dataset_id: str, entry_id: str, user: MLUser = RequireEngineer):
    """Permanently delete a dataset entry and its S3 file."""
    await svc.delete_entry(user.org_id, dataset_id, entry_id)


@router.get("/{dataset_id}/entries/{entry_id}/file")
async def proxy_entry_file(dataset_id: str, entry_id: str, user: MLUser = RequireEngineer):
    """
    Proxy an entry's S3 file through the backend.
    Used when MEDIA_BASE_URL / S3_PUBLIC_ENDPOINT_URL are not configured
    (e.g. dev with internal minio:9000).  Accepts auth via Bearer header
    or ?token= query param so <img src="…"> / <a href="…"> links work.
    """
    return await svc.proxy_entry_file(user.org_id, dataset_id, entry_id)
