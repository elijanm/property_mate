"""Dataset collection service — profile management, invites, entries, points."""
import uuid
from typing import Optional, List
from fastapi import UploadFile, HTTPException
from beanie import PydanticObjectId
import structlog

from app.models.dataset import DatasetProfile, DatasetCollector, DatasetEntry, DatasetField, EntryLocation, slugify
from app.utils.s3_url import generate_presigned_url
from app.utils.datetime import utc_now
from app.core.config import settings


async def _check_rewards_balance(org_id: str, acting_email: str) -> None:
    """Raise 400 if the org's wallet balance is below the minimum required to enable rewards."""
    from app.services.reward_service import get_reward_config
    from app.models.wallet import Wallet
    cfg = await get_reward_config()
    wallet = await Wallet.find_one(Wallet.user_email == acting_email, Wallet.org_id == org_id)
    balance = wallet.balance if wallet else 0.0
    if balance < cfg.min_org_balance_usd:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient wallet balance to enable rewards. "
                f"Your balance is ${balance:.2f} USD. "
                f"A minimum of ${cfg.min_org_balance_usd:.2f} USD is required. "
                f"Please top up your wallet first."
            ),
        )


def _oid(value: str) -> PydanticObjectId:
    """Convert string to PydanticObjectId; raise 404 on invalid format."""
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid ID format")

logger = structlog.get_logger(__name__)


# ── IP geolocation ─────────────────────────────────────────────────────────────

async def _geolocate_ip(ip: str) -> dict:
    """Best-effort IP geolocation via ip-api.com (free, no key needed, 45 req/min)."""
    if not ip or ip in ("127.0.0.1", "::1", ""):
        return {}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(
                f"http://ip-api.com/json/{ip}",
                params={"fields": "status,country,countryCode,city,timezone,isp"},
            )
        data = r.json()
        if data.get("status") != "success":
            return {}
        return {
            "country": data.get("countryCode"),
            "country_name": data.get("country"),
            "city": data.get("city"),
            "timezone": data.get("timezone"),
            "isp": data.get("isp"),
        }
    except Exception:
        return {}


def _extract_client_ip(request_headers: dict, client_host: Optional[str]) -> Optional[str]:
    """Extract real client IP from request, preferring forwarded headers."""
    for header in ("x-forwarded-for", "x-real-ip", "cf-connecting-ip"):
        val = request_headers.get(header, "").split(",")[0].strip()
        if val:
            return val
    return client_host or None


# ── Dataset profile ────────────────────────────────────────────────────────────

async def list_datasets(org_id: str) -> List[DatasetProfile]:
    return await DatasetProfile.find(
        DatasetProfile.org_id == org_id,
        DatasetProfile.deleted_at == None,
    ).to_list()


async def list_public_datasets(exclude_org_id: str = "") -> List[DatasetProfile]:
    """Return all public datasets, optionally excluding caller's own org."""
    q = DatasetProfile.find(
        DatasetProfile.visibility == "public",
        DatasetProfile.deleted_at == None,
        DatasetProfile.reference_type == None,   # originals only, not re-references
    )
    items = await q.to_list()
    if exclude_org_id:
        items = [p for p in items if p.org_id != exclude_org_id]
    return items


async def _unique_slug(org_id: str, base_slug: str, exclude_id: str | None = None) -> str:
    """Return base_slug (or base_slug-2, base_slug-3 …) ensuring uniqueness per org."""
    candidate = base_slug
    n = 2
    while True:
        q = DatasetProfile.find(
            DatasetProfile.org_id == org_id,
            DatasetProfile.slug == candidate,
            DatasetProfile.deleted_at == None,
        )
        if exclude_id:
            existing = [p for p in await q.to_list() if str(p.id) != exclude_id]
        else:
            existing = await q.to_list()
        if not existing:
            return candidate
        candidate = f"{base_slug}-{n}"
        n += 1


async def create_dataset(org_id: str, data: dict, created_by: str, acting_email: str = "") -> DatasetProfile:
    if data.get("points_enabled"):
        await _check_rewards_balance(org_id, acting_email or created_by)
    fields_raw = data.pop("fields", [])
    fields = [DatasetField(**f) if isinstance(f, dict) else f for f in fields_raw]
    raw_slug = data.pop("slug", None)
    slug = await _unique_slug(org_id, slugify(raw_slug or data.get("name", "dataset")))
    profile = DatasetProfile(org_id=org_id, created_by=created_by, fields=fields, slug=slug, **data)
    await profile.insert()
    logger.info("dataset_created", dataset_id=str(profile.id), org_id=org_id, name=profile.name, slug=slug)
    return profile


async def get_dataset(org_id: str, dataset_id: str) -> DatasetProfile:
    profile = await DatasetProfile.find_one(
        {"_id": _oid(dataset_id), "org_id": {"$in": [org_id, ""]}, "deleted_at": None},
    )
    if not profile:
        # Also allow read access to public datasets from any org
        profile = await DatasetProfile.find_one(
            {"_id": _oid(dataset_id), "visibility": "public", "deleted_at": None},
        )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return profile


async def get_public_dataset(dataset_id: str) -> DatasetProfile:
    """Fetch a public dataset by ID (no org restriction)."""
    profile = await DatasetProfile.find_one(
        {"_id": _oid(dataset_id), "visibility": "public", "deleted_at": None},
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found or not public")
    return profile


async def clone_dataset(org_id: str, source_id: str, created_by: str) -> DatasetProfile:
    """
    Clone a public dataset into the caller's org.
    Copies the schema/fields — no entries are copied (user uploads their own data).
    Creates an independent dataset; modifications don't affect the original.
    """
    source = await get_public_dataset(source_id)
    slug = await _unique_slug(org_id, slugify(source.name))
    clone = DatasetProfile(
        org_id=org_id,
        name=source.name,
        slug=slug,
        description=source.description,
        category=source.category,
        fields=source.fields,
        status="active",
        visibility="private",
        source_dataset_id=str(source.id),
        reference_type="clone",
        points_enabled=source.points_enabled,
        points_per_entry=source.points_per_entry,
        points_redemption_info=source.points_redemption_info,
        created_by=created_by,
    )
    await clone.insert()
    logger.info("dataset_cloned", source_id=source_id, clone_id=str(clone.id), org_id=org_id)
    return clone


async def reference_dataset(org_id: str, source_id: str, created_by: str) -> DatasetProfile:
    """
    Add a read-only reference to a public dataset in the caller's org.
    No entries are copied — reads always proxy to the source dataset.
    The reference cannot be modified or have new entries added.
    """
    source = await get_public_dataset(source_id)

    # Prevent duplicate references in the same org
    existing = await DatasetProfile.find_one({
        "org_id": org_id,
        "source_dataset_id": str(source.id),
        "reference_type": "reference",
        "deleted_at": None,
    })
    if existing:
        return existing

    slug = await _unique_slug(org_id, slugify(f"ref-{source.name}"))
    ref = DatasetProfile(
        org_id=org_id,
        name=source.name,
        slug=slug,
        description=source.description,
        category=source.category,
        fields=source.fields,
        status="active",
        visibility="private",
        source_dataset_id=str(source.id),
        reference_type="reference",
        created_by=created_by,
    )
    await ref.insert()
    logger.info("dataset_referenced", source_id=source_id, ref_id=str(ref.id), org_id=org_id)
    return ref


async def set_visibility(org_id: str, dataset_id: str, visibility: str) -> DatasetProfile:
    """Toggle a dataset between private and public. References cannot be made public."""
    if visibility not in ("private", "public"):
        raise HTTPException(status_code=400, detail="visibility must be 'private' or 'public'")
    profile = await DatasetProfile.find_one(
        {"_id": _oid(dataset_id), "org_id": org_id, "deleted_at": None},
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if profile.reference_type == "reference":
        raise HTTPException(status_code=400, detail="Referenced datasets cannot be made public")
    profile.visibility = visibility
    profile.updated_at = utc_now()
    await profile.save()
    logger.info("dataset_visibility_set", dataset_id=dataset_id, visibility=visibility, org_id=org_id)
    return profile


async def update_dataset(org_id: str, dataset_id: str, data: dict, acting_email: str = "") -> DatasetProfile:
    profile = await get_dataset(org_id, dataset_id)
    # Enabling rewards for the first time → check wallet balance
    if data.get("points_enabled") and not profile.points_enabled:
        await _check_rewards_balance(org_id, acting_email or profile.created_by)
    if "fields" in data:
        fields_raw = data.pop("fields")
        data["fields"] = [DatasetField(**f) if isinstance(f, dict) else f for f in fields_raw]
    if "slug" in data and data["slug"]:
        data["slug"] = await _unique_slug(org_id, slugify(data["slug"]), exclude_id=dataset_id)
    for k, v in data.items():
        setattr(profile, k, v)
    profile.updated_at = utc_now()
    await profile.save()
    return profile


async def get_dataset_by_slug(org_id: str, slug: str) -> DatasetProfile:
    # Accept org-specific datasets OR system/shared datasets (org_id="")
    profile = await DatasetProfile.find_one(
        {"slug": slug, "org_id": {"$in": [org_id, ""]}, "deleted_at": None},
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return profile


async def get_entry_count(org_id: str, dataset_id: str) -> int:
    profile = await get_dataset(org_id, dataset_id)
    # For referenced datasets, count entries in the source
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id
    return await DatasetEntry.find(DatasetEntry.dataset_id == resolve_id).count()


async def delete_dataset(org_id: str, dataset_id: str) -> None:
    profile = await get_dataset(org_id, dataset_id)
    profile.deleted_at = utc_now()
    await profile.save()


# ── Collectors ─────────────────────────────────────────────────────────────────

async def invite_collector(org_id: str, dataset_id: str, email: str, name: str = "", message: str = "") -> DatasetCollector:
    await get_dataset(org_id, dataset_id)

    existing = await DatasetCollector.find_one(
        DatasetCollector.dataset_id == dataset_id,
        DatasetCollector.email == email,
        DatasetCollector.deleted_at == None,
    )
    if existing:
        await _send_invite_email(existing, message=message)
        return existing

    collector = DatasetCollector(
        org_id=org_id,
        dataset_id=dataset_id,
        email=email,
        name=name or email.split("@")[0],
    )
    await collector.insert()
    await _send_invite_email(collector, message=message)
    logger.info("collector_invited", collector_id=str(collector.id), email=email, dataset_id=dataset_id)
    return collector


async def get_collectors(org_id: str, dataset_id: str) -> List[DatasetCollector]:
    await get_dataset(org_id, dataset_id)
    return await DatasetCollector.find(
        DatasetCollector.dataset_id == dataset_id,
        DatasetCollector.deleted_at == None,
    ).to_list()


async def remove_collector(org_id: str, dataset_id: str, collector_id: str) -> None:
    collector = await DatasetCollector.find_one(
        DatasetCollector.id == collector_id,
        DatasetCollector.dataset_id == dataset_id,
    )
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    collector.deleted_at = utc_now()
    await collector.save()


# ── Entries (admin view) ───────────────────────────────────────────────────────

async def get_entries(
    org_id: str,
    dataset_id: str,
    field_id: Optional[str] = None,
    collector_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> List[dict]:
    from datetime import datetime, timezone
    profile = await get_dataset(org_id, dataset_id)
    # For referenced datasets, read entries from the source
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id
    filters = [DatasetEntry.dataset_id == resolve_id]
    if field_id:
        filters.append(DatasetEntry.field_id == field_id)
    if collector_id:
        filters.append(DatasetEntry.collector_id == collector_id)
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
            filters.append(DatasetEntry.captured_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
            filters.append(DatasetEntry.captured_at <= dt)
        except ValueError:
            pass
    entries = await DatasetEntry.find(*filters).sort(-DatasetEntry.captured_at).to_list()
    return [_entry_to_dict(e) for e in entries]


# ── Public collector endpoints ─────────────────────────────────────────────────

async def get_collector_by_token(token: str) -> DatasetCollector:
    collector = await DatasetCollector.find_one(
        DatasetCollector.token == token,
        DatasetCollector.deleted_at == None,
    )
    if not collector:
        raise HTTPException(status_code=404, detail="Invalid or expired collection link")
    return collector


async def get_form_definition(token: str) -> dict:
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(
        DatasetProfile.id == _oid(collector.dataset_id),
        DatasetProfile.deleted_at == None,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if profile.status == "closed":
        raise HTTPException(status_code=410, detail="This dataset is no longer accepting submissions")

    # Mark collector active on first visit
    collector.last_active_at = utc_now()
    if collector.status == "pending":
        collector.status = "active"
    await collector.save()

    return {
        "dataset": {
            "id": str(profile.id),
            "name": profile.name,
            "description": profile.description,
            "category": profile.category,
            "fields": [f.model_dump() for f in sorted(profile.fields, key=lambda x: x.order)],
            "points_enabled": profile.points_enabled,
            "points_per_entry": profile.points_per_entry,
            "points_redemption_info": profile.points_redemption_info,
            "require_location": profile.require_location,
            "location_purpose": profile.location_purpose,
        },
        "collector": {
            "id": str(collector.id),
            "name": collector.name,
            "email": collector.email,
            "entry_count": collector.entry_count,
            "points_earned": collector.points_earned,
        },
    }


async def submit_entry(
    token: str,
    field_id: str,
    file: Optional[UploadFile],
    text_value: Optional[str],
    description: Optional[str],
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    accuracy: Optional[float] = None,
    client_ip: Optional[str] = None,
) -> dict:
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    if not profile or profile.status == "closed":
        raise HTTPException(status_code=410, detail="Dataset is closed")

    field = next((f for f in profile.fields if f.id == field_id), None)
    if not field:
        raise HTTPException(status_code=400, detail=f"Field '{field_id}' not found in dataset")

    if field.description_required and not description:
        raise HTTPException(status_code=400, detail=f"Description is required for '{field.label}'")

    file_key = None
    file_mime = None
    content = None
    if file and file.filename:
        content = await file.read()
        mime = file.content_type or "application/octet-stream"

        # ── Model validation ──────────────────────────────────────────────────
        if field.validation_model and content:
            await _validate_with_model(field, content, mime)

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        s3_key = (
            f"{profile.org_id}/datasets/{str(profile.id)}"
            f"/entries/{str(collector.id)}/{field_id}/{uuid.uuid4()}.{ext}"
        )
        await _upload_to_s3(s3_key, content, mime)
        file_key = s3_key
        file_mime = mime

    # ── Location metadata ─────────────────────────────────────────────────────
    location: Optional[EntryLocation] = None
    if lat is not None and lng is not None:
        location = EntryLocation(lat=lat, lng=lng, accuracy=accuracy, source="gps", ip_address=client_ip)
    elif client_ip:
        geo = await _geolocate_ip(client_ip)
        location = EntryLocation(
            source="ip",
            ip_address=client_ip,
            **geo,
        )

    entry = DatasetEntry(
        org_id=profile.org_id,
        dataset_id=str(profile.id),
        collector_id=str(collector.id),
        field_id=field_id,
        file_key=file_key,
        file_mime=file_mime,
        text_value=text_value,
        description=description,
        points_awarded=profile.points_per_entry if profile.points_enabled else 0,
        location=location,
    )
    await entry.insert()

    # Update collector stats
    collector.entry_count += 1
    if profile.points_enabled:
        collector.points_earned += profile.points_per_entry
    collector.last_active_at = utc_now()
    await collector.save()
    # Keep public entry count cache fresh
    if profile.visibility == "public":
        profile.entry_count_cache = (profile.entry_count_cache or 0) + 1
        await profile.save()

    logger.info(
        "dataset_entry_submitted",
        entry_id=str(entry.id),
        field_id=field_id,
        collector_id=str(collector.id),
        dataset_id=str(profile.id),
        points_awarded=entry.points_awarded,
    )
    return _entry_to_dict(entry)


_ADMIN_COLLECTOR_ID = "__admin__"


async def upload_entry_direct(
    org_id: str,
    dataset_id: str,
    field_id: str,
    file: Optional[UploadFile],
    text_value: Optional[str],
    uploaded_by: str,
) -> dict:
    """Admin direct entry upload — bypasses collector token flow."""
    profile = await get_dataset(org_id, dataset_id)
    if profile.status == "closed":
        raise HTTPException(status_code=410, detail="Dataset is closed")

    field = next((f for f in profile.fields if f.id == field_id), None)
    if not field:
        raise HTTPException(status_code=400, detail=f"Field '{field_id}' not found in dataset")

    file_key = None
    file_mime = None
    if file and file.filename:
        content = await file.read()
        mime = file.content_type or "application/octet-stream"
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        s3_key = (
            f"{profile.org_id}/datasets/{str(profile.id)}"
            f"/entries/{_ADMIN_COLLECTOR_ID}/{field_id}/{uuid.uuid4()}.{ext}"
        )
        await _upload_to_s3(s3_key, content, mime)
        file_key = s3_key
        file_mime = mime

    entry = DatasetEntry(
        org_id=org_id,
        dataset_id=dataset_id,
        collector_id=_ADMIN_COLLECTOR_ID,
        field_id=field_id,
        file_key=file_key,
        file_mime=file_mime,
        text_value=text_value,
        points_awarded=0,
    )
    await entry.insert()
    logger.info("dataset_entry_admin_upload", dataset_id=dataset_id, field_id=field_id, uploaded_by=uploaded_by)
    return _entry_to_dict(entry)


async def get_collector_entries(token: str) -> List[dict]:
    collector = await get_collector_by_token(token)
    entries = await DatasetEntry.find(
        DatasetEntry.collector_id == str(collector.id)
    ).sort(-DatasetEntry.captured_at).to_list()
    return [_entry_to_dict(e) for e in entries]


async def get_collector_points(token: str) -> dict:
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    return {
        "points_earned": collector.points_earned,
        "entry_count": collector.entry_count,
        "points_enabled": profile.points_enabled if profile else False,
        "points_redemption_info": profile.points_redemption_info if profile else "",
    }


# ── Dataset overview / location analytics ──────────────────────────────────────

async def get_dataset_overview(org_id: str, dataset_id: str) -> dict:
    """Return a rich summary of a dataset: entry stats, collector stats, location breakdown, daily trend."""
    from collections import defaultdict
    from datetime import datetime, timezone, timedelta

    profile = await get_dataset(org_id, dataset_id)
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id

    entries = await DatasetEntry.find(DatasetEntry.dataset_id == resolve_id).to_list()
    collectors = await DatasetCollector.find(
        DatasetCollector.dataset_id == resolve_id,
        DatasetCollector.deleted_at == None,
    ).to_list()

    total_entries = len(entries)
    total_collectors = len(collectors)
    total_points_awarded = sum(e.points_awarded for e in entries)

    # ── Location breakdown ────────────────────────────────────────────────────
    gps_count = 0
    ip_count = 0
    no_location = 0
    country_counts: dict = defaultdict(int)
    city_counts: dict = defaultdict(int)
    gps_points: list = []

    for e in entries:
        if not e.location:
            no_location += 1
            continue
        if e.location.source == "gps":
            gps_count += 1
            if e.location.lat is not None and e.location.lng is not None:
                gps_points.append({"lat": e.location.lat, "lng": e.location.lng})
        else:
            ip_count += 1
        if e.location.country:
            country_counts[e.location.country] += 1
        if e.location.city and e.location.country:
            city_counts[f"{e.location.city}, {e.location.country}"] += 1

    countries = sorted(
        [{"code": k, "count": v} for k, v in country_counts.items()],
        key=lambda x: x["count"], reverse=True,
    )
    cities = sorted(
        [{"name": k, "count": v} for k, v in city_counts.items()],
        key=lambda x: x["count"], reverse=True,
    )[:10]

    # ── Daily trend (last 14 days) ────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    day_counts: dict = defaultdict(int)
    for e in entries:
        ts = e.captured_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if now - ts <= timedelta(days=14):
            day_counts[ts.strftime("%Y-%m-%d")] += 1

    daily_trend = []
    for i in range(13, -1, -1):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_trend.append({"date": d, "count": day_counts.get(d, 0)})

    # ── Top collectors ────────────────────────────────────────────────────────
    top_collectors = sorted(
        [{"name": c.name or c.email, "email": c.email, "entries": c.entry_count, "points": c.points_earned}
         for c in collectors],
        key=lambda x: x["entries"], reverse=True,
    )[:10]

    # ── Field breakdown ───────────────────────────────────────────────────────
    field_counts: dict = defaultdict(int)
    for e in entries:
        field_counts[e.field_id] += 1
    field_label_map = {f.id: f.label for f in profile.fields}
    field_breakdown = [
        {"field_id": fid, "label": field_label_map.get(fid, fid), "count": cnt}
        for fid, cnt in sorted(field_counts.items(), key=lambda x: x[1], reverse=True)
    ]

    return {
        "dataset_id": dataset_id,
        "name": profile.name,
        "status": profile.status,
        "require_location": profile.require_location,
        "summary": {
            "total_entries": total_entries,
            "total_collectors": total_collectors,
            "total_points_awarded": total_points_awarded,
            "active_collectors": sum(1 for c in collectors if c.status == "active"),
        },
        "location": {
            "gps_count": gps_count,
            "ip_count": ip_count,
            "no_location": no_location,
            "gps_pct": round(gps_count / total_entries * 100, 1) if total_entries else 0,
            "countries": countries,
            "cities": cities,
            "gps_points": gps_points[:500],  # cap for frontend rendering
        },
        "daily_trend": daily_trend,
        "top_collectors": top_collectors,
        "field_breakdown": field_breakdown,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _entry_to_dict(entry: DatasetEntry) -> dict:
    d = entry.model_dump()
    d["id"] = str(entry.id)
    if entry.file_key:
        d["file_url"] = generate_presigned_url(entry.file_key)
    return d


async def _validate_with_model(field, content: bytes, mime: str) -> None:
    """Run the field's validation model on the uploaded file and reject if the
    top predicted label is not in field.validation_labels."""
    import base64
    from app.services.inference_service import predict

    b64 = base64.b64encode(content).decode()
    inputs: dict = {"file_b64": b64, "file_name": "upload", "mime_type": mime}
    if mime.startswith("image/"):
        inputs["image_b64"] = b64

    try:
        result, _ = await predict(
            trainer_name=field.validation_model,
            inputs=inputs,
            org_id="",
        )
    except Exception as exc:
        logger.warning(
            "dataset_validation_model_error",
            trainer=field.validation_model,
            error=str(exc),
        )
        # If the model itself errors, let the submission through rather than
        # blocking the collector — log and continue.
        return

    # Extract the top label from the prediction result.
    # Handles common output shapes: str, {"label": ...}, {"class": ...},
    # {"prediction": ...}, {"top": [{"label": ...}]}, list of dicts.
    label: Optional[str] = None
    if isinstance(result, str):
        label = result
    elif isinstance(result, dict):
        label = (
            result.get("label") or result.get("class") or
            result.get("prediction") or result.get("predicted_class")
        )
        if label is None and "top" in result:
            top = result["top"]
            if isinstance(top, list) and top:
                label = top[0].get("label") or top[0].get("class")
        if label is not None:
            label = str(label)
    elif isinstance(result, list) and result:
        first = result[0]
        label = str(first.get("label") or first.get("class") or first) if isinstance(first, dict) else str(first)

    if not field.validation_labels:
        # No expected labels configured — model runs but always accepts
        return

    if label is None:
        logger.warning("dataset_validation_no_label", trainer=field.validation_model, result=result)
        return

    label_lower = label.lower().strip()
    accepted = [l.lower().strip() for l in field.validation_labels]
    if label_lower not in accepted:
        rejection = field.validation_message or (
            f"This image was identified as '{label}'. "
            f"Expected: {', '.join(field.validation_labels)}. Please re-capture."
        )
        logger.info(
            "dataset_entry_rejected",
            trainer=field.validation_model,
            predicted=label,
            expected=field.validation_labels,
        )
        raise HTTPException(status_code=422, detail=rejection)


async def initiate_multipart_upload(token: str, field_id: str, filename: str, content_type: str) -> dict:
    """Create an S3 multipart upload and return upload_id + key."""
    import boto3
    import uuid as _uuid
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    if not profile or profile.status == "closed":
        raise HTTPException(status_code=410, detail="Dataset is closed")
    field = next((f for f in profile.fields if f.id == field_id), None)
    if not field:
        raise HTTPException(status_code=400, detail=f"Field '{field_id}' not found")

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = (
        f"{profile.org_id}/datasets/{str(profile.id)}"
        f"/entries/{str(collector.id)}/{field_id}/{_uuid.uuid4()}.{ext}"
    )
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    )
    resp = s3.create_multipart_upload(
        Bucket=settings.S3_BUCKET, Key=key, ContentType=content_type
    )
    return {"upload_id": resp["UploadId"], "key": key}


def get_part_presigned_url(key: str, upload_id: str, part_number: int) -> str:
    """Return a presigned PUT URL for one multipart part. Browser uses this directly."""
    import boto3
    # Use the public endpoint so the presigned URL is reachable from browsers
    endpoint = (settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL).rstrip("/")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    )
    return s3.generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=3600,
    )


async def complete_multipart_upload(
    token: str,
    field_id: str,
    key: str,
    upload_id: str,
    parts: list,           # [{"part_number": int, "etag": str}, ...]
    file_mime: str,
    description: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    accuracy: Optional[float] = None,
    client_ip: Optional[str] = None,
) -> dict:
    """Finalize the multipart upload and create a DatasetEntry."""
    import boto3
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    if not profile or profile.status == "closed":
        raise HTTPException(status_code=410, detail="Dataset is closed")

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    )
    s3.complete_multipart_upload(
        Bucket=settings.S3_BUCKET,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={
            "Parts": [
                {"PartNumber": p["part_number"], "ETag": p["etag"]}
                for p in sorted(parts, key=lambda x: x["part_number"])
            ]
        },
    )

    location: Optional[EntryLocation] = None
    if lat is not None and lng is not None:
        location = EntryLocation(lat=lat, lng=lng, accuracy=accuracy, source="gps", ip_address=client_ip)
    elif client_ip:
        geo = await _geolocate_ip(client_ip)
        location = EntryLocation(source="ip", ip_address=client_ip, **geo)

    entry = DatasetEntry(
        org_id=profile.org_id,
        dataset_id=str(profile.id),
        collector_id=str(collector.id),
        field_id=field_id,
        file_key=key,
        file_mime=file_mime,
        description=description,
        points_awarded=profile.points_per_entry if profile.points_enabled else 0,
        location=location,
    )
    await entry.insert()

    # Update collector stats
    collector.entry_count += 1
    if profile.points_enabled:
        collector.points_earned += profile.points_per_entry
    collector.last_active_at = utc_now()
    await collector.save()

    logger.info(
        "dataset_entry_multipart_complete",
        dataset_id=str(profile.id),
        field_id=field_id,
        key=key,
        collector_id=str(collector.id),
    )
    return _entry_to_dict(entry)


async def _upload_to_s3(key: str, content: bytes, content_type: str) -> None:
    import aioboto3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        await s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=content,
            ContentType=content_type,
        )


async def _send_invite_email(collector: DatasetCollector, message: str = "") -> None:
    from app.core.email import send_email
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    if not profile:
        return
    collect_url = f"{settings.FRONTEND_BASE_URL}/collect/{collector.token}"
    html = _invite_html(
        name=collector.name,
        dataset_name=profile.name,
        dataset_description=profile.description,
        collect_url=collect_url,
        points_enabled=profile.points_enabled,
        points_info=profile.points_redemption_info,
        custom_message=message,
    )
    await send_email(
        to=collector.email,
        subject=f"You're invited to contribute to: {profile.name}",
        html=html,
    )


def _invite_html(name: str, dataset_name: str, dataset_description: str,
                 collect_url: str, points_enabled: bool, points_info: str,
                 custom_message: str = "") -> str:
    points_block = ""
    if points_enabled and points_info:
        points_block = f"""
        <div style="background:#052e16;border:1px solid #16a34a;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;color:#4ade80;font-weight:700;font-size:14px;">🎁 Earn Points</p>
          <p style="margin:0;color:#86efac;font-size:13px;">{points_info}</p>
        </div>"""
    desc_block = (
        f'<p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 20px;">{dataset_description}</p>'
        if dataset_description else ""
    )
    message_block = (
        f'<div style="background:#1e293b;border-left:3px solid #6366f1;border-radius:8px;padding:12px 16px;margin-bottom:20px;">'
        f'<p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.7;white-space:pre-line;">{custom_message}</p>'
        f'</div>'
        if custom_message.strip() else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    .wrapper{{width:100%;background:#0a0a0a;padding:32px 16px;box-sizing:border-box;}}
    .card{{background:#111;border:1px solid #1f2937;border-radius:16px;padding:32px;max-width:520px;margin:0 auto;}}
    @media only screen and (max-width:480px){{.wrapper{{padding:16px 10px;}}.card{{padding:20px 14px;}}}}
  </style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div class="wrapper"><div class="card">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:18px;font-weight:700;color:#fff;">🧠 MLDock.io</span>
    </div>
    <h2 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 8px;">Hi {name} 👋</h2>
    <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;">You've been invited to contribute data to:</p>
    <div style="background:#1f2937;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;color:#fff;font-weight:600;font-size:16px;">📦 {dataset_name}</p>
    </div>
    {desc_block}
    {message_block}
    {points_block}
    <a href="{collect_url}" style="display:block;text-align:center;background:#6366f1;color:#fff;font-weight:600;font-size:15px;padding:14px;border-radius:10px;text-decoration:none;margin-bottom:16px;">
      Start Contributing →
    </a>
    <p style="color:#4b5563;font-size:11px;text-align:center;margin:0;">
      This link is unique to you — please do not share it.
    </p>
  </div></div>
</body>
</html>"""
