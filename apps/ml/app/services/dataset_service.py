"""Dataset collection service — profile management, invites, entries, points."""
import asyncio
import io
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
        processed = []
        for f in fields_raw:
            if isinstance(f, dict):
                if not f.get("id"):
                    f = {**f, "id": str(uuid.uuid4())}
                processed.append(DatasetField(**f))
            else:
                processed.append(f)
        data["fields"] = processed
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

async def add_collector(org_id: str, dataset_id: str, name: str, email: str = "", phone: str = "") -> DatasetCollector:
    """Add a contributor manually without sending an invite email."""
    await get_dataset(org_id, dataset_id)
    collector = DatasetCollector(
        org_id=org_id,
        dataset_id=dataset_id,
        email=email,
        phone=phone or None,
        name=name or email.split("@")[0] if email else "Contributor",
    )
    await collector.insert()
    logger.info("collector_added", collector_id=str(collector.id), dataset_id=dataset_id)
    return collector


async def invite_collector(org_id: str, dataset_id: str, email: str, name: str = "", message: str = "") -> DatasetCollector:
    await get_dataset(org_id, dataset_id)

    existing = await DatasetCollector.find_one(
        DatasetCollector.dataset_id == dataset_id,
        DatasetCollector.email == email,
        DatasetCollector.deleted_at == None,
    )
    if existing:
        if email:
            await _send_invite_email(existing, message=message)
        return existing

    collector = DatasetCollector(
        org_id=org_id,
        dataset_id=dataset_id,
        email=email,
        name=name or (email.split("@")[0] if email else "Contributor"),
    )
    await collector.insert()
    if email:
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
    review_status: Optional[str] = None,
    quality: Optional[str] = None,       # good|poor|blurry|dark|overexposed|low_res
    include_archived: bool = False,
    page: int = 1,
    page_size: int = 48,
) -> dict:
    from datetime import datetime, timezone
    profile = await get_dataset(org_id, dataset_id)
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id
    # Use $ne: true for the "not archived" case so documents without the field still match
    if include_archived:
        archived_filter = DatasetEntry.archived == True
    else:
        archived_filter = {"archived": {"$ne": True}}
    filters = [DatasetEntry.dataset_id == resolve_id, archived_filter]
    if field_id:
        filters.append(DatasetEntry.field_id == field_id)
    if collector_id:
        filters.append(DatasetEntry.collector_id == collector_id)
    if review_status:
        filters.append(DatasetEntry.review_status == review_status)
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

    # Duplicate filter requires aggregation — detect by phash, file_hash, or file_key
    if quality == "duplicate":
        from motor.motor_asyncio import AsyncIOMotorCollection
        col: AsyncIOMotorCollection = DatasetEntry.get_motor_collection()
        base_match: dict = {"dataset_id": resolve_id, "archived": {"$ne": True}}

        dup_values: list = []

        # 1. phash duplicates (exact perceptual matches — most entries have this)
        phash_pipeline = [
            {"$match": {**base_match, "phash": {"$ne": None}}},
            {"$group": {"_id": "$phash", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]
        dup_phashes = [doc["_id"] async for doc in col.aggregate(phash_pipeline)]
        if dup_phashes:
            dup_values_filter = {"$or": [{"phash": {"$in": dup_phashes}}]}
        else:
            dup_values_filter = None

        # 2. file_hash duplicates (same content, different upload — SHA-256)
        fhash_pipeline = [
            {"$match": {**base_match, "file_hash": {"$ne": None}}},
            {"$group": {"_id": "$file_hash", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]
        dup_fhashes = [doc["_id"] async for doc in col.aggregate(fhash_pipeline)]

        # 3. file_key duplicates (same S3 object referenced multiple times)
        fkey_pipeline = [
            {"$match": {**base_match, "file_key": {"$ne": None}}},
            {"$group": {"_id": "$file_key", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gt": 1}}},
        ]
        dup_fkeys = [doc["_id"] async for doc in col.aggregate(fkey_pipeline)]

        # Build combined $or filter
        or_clauses = []
        if dup_phashes:
            or_clauses.append({"phash": {"$in": dup_phashes}})
        if dup_fhashes:
            or_clauses.append({"file_hash": {"$in": dup_fhashes}})
        if dup_fkeys:
            or_clauses.append({"file_key": {"$in": dup_fkeys}})

        if not or_clauses:
            return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0, "archived_count": 0}

        filters.append({"$or": or_clauses})
        q = DatasetEntry.find(*filters).sort(-DatasetEntry.captured_at)
        total = await q.count()
        entries = await q.skip((page - 1) * page_size).limit(page_size).to_list()
    else:
        q = DatasetEntry.find(*filters).sort(-DatasetEntry.captured_at)
        total = await q.count()
        entries = await q.skip((page - 1) * page_size).limit(page_size).to_list()

        # Apply in-memory quality filter (not indexed — acceptable for moderate dataset sizes)
        if quality == "good":
            entries = [e for e in entries if (e.quality_score or 0) >= 70 and not e.quality_issues]
        elif quality == "poor":
            entries = [e for e in entries if (e.quality_score or 100) < 70 or bool(e.quality_issues)]
        elif quality in ("blurry", "dark", "overexposed", "low_res"):
            entries = [e for e in entries if quality in (e.quality_issues or [])]

    # Archived count (always include)
    archived_count = await DatasetEntry.find(DatasetEntry.dataset_id == resolve_id, DatasetEntry.archived == True).count()

    return {
        "items": [_entry_to_dict(e) for e in entries],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
        "archived_count": archived_count,
    }


async def archive_entry(org_id: str, dataset_id: str, entry_id: str, archived: bool) -> dict:
    await get_dataset(org_id, dataset_id)
    entry = await DatasetEntry.find_one(DatasetEntry.id == _oid(entry_id), DatasetEntry.dataset_id == dataset_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.archived = archived
    await entry.save()
    return _entry_to_dict(entry)


async def find_similar_entries(org_id: str, dataset_id: str, entry_id: str, threshold: int = 12) -> List[dict]:
    """Find dataset entries similar to the given entry using pHash hamming distance.

    If images are missing phashes, downloads them from S3 concurrently to compute lazily.
    """
    profile = await get_dataset(org_id, dataset_id)
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id
    all_entries = await DatasetEntry.find(DatasetEntry.dataset_id == resolve_id).to_list()

    target = next((e for e in all_entries if str(e.id) == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Lazy compute missing phashes
    missing = [e for e in all_entries if not e.phash and e.file_key and e.file_mime and e.file_mime.startswith("image/")]
    if missing:
        sem = asyncio.Semaphore(10)

        async def _fill(e: DatasetEntry) -> None:
            async with sem:
                try:
                    data = await _download_from_s3(e.file_key)
                    e.phash = _dhash(data)
                    await e.save()
                except Exception:
                    pass

        await asyncio.gather(*[_fill(e) for e in missing])

    if not target.phash:
        return []

    results = []
    for e in all_entries:
        if str(e.id) == entry_id or not e.phash:
            continue
        dist = _hamming(target.phash, e.phash)
        if dist <= threshold:
            d = _entry_to_dict(e)
            d["similarity_distance"] = dist
            d["similarity_pct"] = round((64 - dist) / 64 * 100)
            results.append(d)
    results.sort(key=lambda x: x["similarity_distance"])
    return results


async def _download_from_s3(key: str) -> bytes:
    import aioboto3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        resp = await s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
        return await resp["Body"].read()


async def export_to_annotation_project(
    org_id: str,
    dataset_id: str,
    entry_ids: Optional[List[str]],
    project_id: Optional[str],
    project_name: str,
    classes: List[str],
    annotation_type: str,
) -> dict:
    """Copy (by reference) selected dataset image entries into an annotation project.

    No S3 data is duplicated — AnnotationImage.s3_key points to the same object.
    Skips entries already present in the project (matched by s3_key).
    """
    from app.models.annotation import AnnotationProject, AnnotationImage
    from beanie import PydanticObjectId as _OID

    # Resolve source entries
    profile = await get_dataset(org_id, dataset_id)
    resolve_id = profile.source_dataset_id if profile.reference_type == "reference" and profile.source_dataset_id else dataset_id

    flt = [DatasetEntry.dataset_id == resolve_id, {"archived": {"$ne": True}}]
    if entry_ids:
        from bson import ObjectId as _BsonOID
        oids = [_BsonOID(i) for i in entry_ids if i]
        flt.append({"_id": {"$in": oids}})
    entries = await DatasetEntry.find(*flt).to_list()
    image_entries = [e for e in entries if e.file_key and e.file_mime and e.file_mime.startswith("image/")]
    if not image_entries:
        raise HTTPException(status_code=400, detail="No image entries to export")

    # Find or create annotation project
    if project_id:
        ann_project = await AnnotationProject.find_one(
            AnnotationProject.id == _OID(project_id),
            AnnotationProject.org_id == org_id,
            AnnotationProject.deleted_at == None,
        )
        if not ann_project:
            raise HTTPException(status_code=404, detail="Annotation project not found")
    else:
        ann_project = AnnotationProject(
            org_id=org_id,
            name=project_name or f"From {profile.name}",
            description=f"Exported from dataset: {profile.name}",
            classes=classes or ["object"],
            annotation_type=annotation_type or "box",
        )
        await ann_project.insert()

    # Deduplicate by s3_key (same upload) AND file_hash (same content, different upload)
    existing_keys = {img.s3_key for img in ann_project.images}
    existing_hashes = {img.file_hash for img in ann_project.images if img.file_hash}

    added = 0
    skipped_dup = 0
    for e in image_entries:
        # Skip if same S3 object already in project
        if e.file_key in existing_keys:
            skipped_dup += 1
            continue
        # Skip if same content (duplicate upload) already in project
        if e.file_hash and e.file_hash in existing_hashes:
            skipped_dup += 1
            continue
        ann_img = AnnotationImage(
            filename=e.file_key.split("/")[-1],
            s3_key=e.file_key,
            file_hash=e.file_hash,
            blur_score=e.blur_score,
            brightness=e.brightness,
            quality_score=e.quality_score,
            quality_issues=e.quality_issues or [],
            phash=e.phash,
        )
        ann_project.images.append(ann_img)
        existing_keys.add(e.file_key)
        if e.file_hash:
            existing_hashes.add(e.file_hash)
        added += 1

    from app.utils.datetime import utc_now as _now
    ann_project.updated_at = _now()
    await ann_project.save()

    return {
        "project_id": str(ann_project.id),
        "project_name": ann_project.name,
        "added": added,
        "skipped": skipped_dup,
        "total_images": len(ann_project.images),
    }


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
    consent_record_id: Optional[str] = None,
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
    file_hash = None
    content = None
    if file and file.filename:
        content = await file.read()
        mime = file.content_type or "application/octet-stream"

        # ── Duplicate detection ───────────────────────────────────────────────
        import hashlib
        file_hash = hashlib.sha256(content).hexdigest()
        existing = await DatasetEntry.find_one(
            DatasetEntry.dataset_id == str(profile.id),
            DatasetEntry.field_id == field_id,
            DatasetEntry.file_hash == file_hash,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Duplicate file — this file has already been submitted.")

        # ── Model validation ──────────────────────────────────────────────────
        validation_prediction: Optional[str] = None
        if field.validation_model and content:
            validation_prediction = await _validate_with_model(field, content, mime)

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        s3_key = (
            f"{profile.org_id}/datasets/{str(profile.id)}"
            f"/entries/{str(collector.id)}/{field_id}/{uuid.uuid4()}.{ext}"
        )
        await _upload_to_s3(s3_key, content, mime)
        file_key = s3_key
        file_mime = mime
    else:
        validation_prediction = None

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
        file_hash=file_hash,
        text_value=text_value,
        description=description,
        points_awarded=profile.points_per_entry if profile.points_enabled else 0,
        location=location,
        validation_prediction=validation_prediction,
        consent_record_id=consent_record_id or None,
    )
    await entry.insert()

    # Link entry to consent record if provided
    if consent_record_id:
        try:
            from app.services.consent_service import link_entry_to_consent
            await link_entry_to_consent(consent_record_id, str(entry.id))
        except Exception as _exc:
            logger.warning("consent_link_failed", error=str(_exc), entry_id=str(entry.id))

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
        consent_record_id=consent_record_id,
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
    _raw_bytes: Optional[bytes] = None
    if file and file.filename:
        _raw_bytes = await file.read()
        mime = file.content_type or "application/octet-stream"
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        s3_key = (
            f"{profile.org_id}/datasets/{str(profile.id)}"
            f"/entries/{_ADMIN_COLLECTOR_ID}/{field_id}/{uuid.uuid4()}.{ext}"
        )
        await _upload_to_s3(s3_key, _raw_bytes, mime)
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
    if _raw_bytes and file_mime and file_mime.startswith("image/"):
        await _enrich_entry_quality(entry, _raw_bytes)
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
        {"field_id": fid, "label": field_label_map.get(fid, f"Deleted field ({fid[:8]}…)"), "count": cnt}
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


# ── Image quality helpers (PIL-only, no extra deps) ────────────────────────────

def _dhash(data: bytes) -> Optional[str]:
    try:
        from PIL import Image as _PIL
        img = _PIL.open(io.BytesIO(data)).convert("L").resize((9, 8))
        px = list(img.getdata())
        bits = [1 if px[r * 9 + c] > px[r * 9 + c + 1] else 0 for r in range(8) for c in range(8)]
        val = 0
        for b in bits:
            val = (val << 1) | b
        return f"{val:016x}"
    except Exception:
        return None


def _hamming(h1: str, h2: str) -> int:
    return bin(int(h1, 16) ^ int(h2, 16)).count("1")


def _compute_image_quality(data: bytes) -> dict:
    try:
        from PIL import Image as _PIL, ImageFilter, ImageStat
        img = _PIL.open(io.BytesIO(data)).convert("L")
        w, h = img.size
        edges = img.filter(ImageFilter.FIND_EDGES)
        blur = float(ImageStat.Stat(edges).var[0])
        brightness = float(ImageStat.Stat(img).mean[0])
        issues: List[str] = []
        if blur < 40: issues.append("blurry")
        if brightness < 40: issues.append("dark")
        if brightness > 220: issues.append("overexposed")
        if w < 200 or h < 200: issues.append("low_res")
        score = max(0, min(100, int(min(100.0, blur / 5.0) * 0.7 + (100.0 - abs(brightness - 128.0) / 128.0 * 100.0) * 0.3)))
        return {"blur_score": round(blur, 2), "brightness": round(brightness, 2), "quality_score": score, "quality_issues": issues}
    except Exception:
        return {"blur_score": None, "brightness": None, "quality_score": None, "quality_issues": []}


async def _enrich_entry_quality(entry: DatasetEntry, data: bytes) -> None:
    """Compute and assign quality + phash fields on the entry (does NOT save)."""
    if entry.file_mime and entry.file_mime.startswith("image/"):
        q = _compute_image_quality(data)
        entry.blur_score = q["blur_score"]
        entry.brightness = q["brightness"]
        entry.quality_score = q["quality_score"]
        entry.quality_issues = q["quality_issues"]
        entry.phash = _dhash(data)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _entry_to_dict(entry: DatasetEntry) -> dict:
    d = entry.model_dump()
    d["id"] = str(entry.id)
    if entry.file_key:
        # Always use the proxy endpoint for display — watermark is composited on-the-fly
        # there.  The original S3 file is never modified.
        # A direct presigned URL is stored separately as download_url for explicit downloads.
        proxy_url = f"/api/v1/datasets/{entry.dataset_id}/entries/{str(entry.id)}/file"
        d["file_url"] = proxy_url
        presigned = generate_presigned_url(entry.file_key)
        d["download_url"] = presigned or proxy_url
    return d


async def _validate_with_model(field, content: bytes, mime: str) -> Optional[str]:
    """Run the field's validation model on the uploaded file.

    Returns the model's top predicted label (always, even on acceptance) so the
    caller can store it on the entry for later feedback logging on human review.
    Raises HTTP 422 if the label is not in field.validation_labels.
    Returns None if the model errors or produces no label.
    """
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
        return None

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
        # No expected labels configured — model runs but always accepts; still return label
        return label

    if label is None:
        logger.warning("dataset_validation_no_label", trainer=field.validation_model, result=result)
        return None

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

    return label


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
    from botocore.config import Config
    endpoint = (settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL).rstrip("/")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
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
    file_hash: Optional[str] = None,
    consent_record_id: Optional[str] = None,
) -> dict:
    """Finalize the multipart upload and create a DatasetEntry."""
    import boto3
    collector = await get_collector_by_token(token)
    profile = await DatasetProfile.find_one(DatasetProfile.id == _oid(collector.dataset_id))
    if not profile or profile.status == "closed":
        raise HTTPException(status_code=410, detail="Dataset is closed")

    # ── Duplicate detection (hash provided by client before upload) ───────────
    if file_hash:
        existing = await DatasetEntry.find_one(
            DatasetEntry.dataset_id == str(profile.id),
            DatasetEntry.field_id == field_id,
            DatasetEntry.file_hash == file_hash,
        )
        if existing:
            raise HTTPException(status_code=409, detail="Duplicate file — this file has already been submitted.")

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
        file_hash=file_hash,
        description=description,
        points_awarded=profile.points_per_entry if profile.points_enabled else 0,
        location=location,
        consent_record_id=consent_record_id or None,
    )
    await entry.insert()

    # Link entry to consent record if provided
    if consent_record_id:
        try:
            from app.services.consent_service import link_entry_to_consent
            await link_entry_to_consent(consent_record_id, str(entry.id))
        except Exception as _exc:
            logger.warning("consent_link_failed", error=str(_exc), entry_id=str(entry.id))

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
        consent_record_id=consent_record_id,
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


async def review_entry(org_id: str, dataset_id: str, entry_id: str, status: str, note: Optional[str]) -> dict:
    from app.services import feedback_service as _fb

    if status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")
    profile = await get_dataset(org_id, dataset_id)  # permission check + profile for field lookup
    entry = await DatasetEntry.find_one(DatasetEntry.id == _oid(entry_id), DatasetEntry.dataset_id == dataset_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.review_status = status
    entry.review_note = note
    await entry.save()

    # ── Log human review as model feedback ───────────────────────────────────
    # This is what drives the confusion matrix / OCR metrics for the
    # validation_model configured on the field.
    # approved  → model prediction was correct  (actual == predicted)
    # rejected  → model prediction was wrong
    #             actual_label = review_note (reviewer should note the correct
    #             value, especially for OCR) or text_value on the entry.
    if entry.validation_prediction and entry.field_id:
        field = next((f for f in profile.fields if f.id == entry.field_id), None)
        if field and field.validation_model:
            is_correct = status == "approved"
            if is_correct:
                # Confirm: model read it correctly
                actual_label = entry.validation_prediction
            else:
                # Correction: reviewer note is the ground-truth label for OCR models.
                # Fall back to the entry's own text_value (collector-submitted reading).
                actual_label = note or entry.text_value or None

            await _fb.submit_feedback(
                trainer_name=field.validation_model,
                predicted_label=entry.validation_prediction,
                actual_label=actual_label,
                is_correct=is_correct,
                notes=note,
            )

    return _entry_to_dict(entry)


async def delete_entry(org_id: str, dataset_id: str, entry_id: str) -> None:
    await get_dataset(org_id, dataset_id)  # permission check
    entry = await DatasetEntry.find_one(DatasetEntry.id == _oid(entry_id), DatasetEntry.dataset_id == dataset_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    # Delete S3 file if present
    if entry.file_key:
        try:
            import aioboto3
            session = aioboto3.Session()
            async with session.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT_URL,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
                region_name=settings.S3_REGION,
            ) as s3:
                await s3.delete_object(Bucket=settings.S3_BUCKET, Key=entry.file_key)
        except Exception:
            pass
    await entry.delete()


async def proxy_entry_file(org_id: str, dataset_id: str, entry_id: str, viewer_user_id: Optional[str] = None):
    """Stream the S3 file for a dataset entry through the backend.

    For image entries with an active org watermark config, the watermark is
    composited on-the-fly and the watermarked JPEG is returned.  The original
    S3 file is NEVER modified — this is display-only watermarking.
    """
    from fastapi.responses import StreamingResponse as _SR, Response as _R
    await get_dataset(org_id, dataset_id)  # permission check
    entry = await DatasetEntry.find_one(DatasetEntry.id == _oid(entry_id), DatasetEntry.dataset_id == dataset_id)
    if not entry or not entry.file_key:
        raise HTTPException(status_code=404, detail="Entry file not found")

    mime = entry.file_mime or "application/octet-stream"
    filename = entry.file_key.split("/")[-1]

    # Apply watermark on-the-fly for image entries.
    # Original S3 file is NEVER modified.  Watermarked bytes are cached in Redis
    # for 1 hour so repeated requests don't re-download + re-composite.
    if mime.startswith("image/"):
        try:
            import hashlib
            import redis.asyncio as aioredis
            from app.services.watermark_service import maybe_watermark

            # Cache key: entry id + md5 of (entry.file_key) so it resets when file changes
            cfg_hash = hashlib.md5(entry.file_key.encode()).hexdigest()[:12]
            cache_key = f"wm:{str(entry.id)}:{cfg_hash}"

            # Try Redis cache first
            try:
                r = aioredis.from_url(settings.REDIS_URL)
                cached = await r.get(cache_key)
                await r.aclose()
                if cached:
                    return _R(
                        content=cached,
                        media_type="image/jpeg",
                        headers={"Content-Disposition": f'inline; filename="{filename.rsplit(".", 1)[0]}.jpg"'},
                    )
            except Exception:
                pass  # Redis unavailable — proceed without cache

            raw: bytes = await _download_from_s3(entry.file_key)
            watermarked = await maybe_watermark(org_id, viewer_user_id, raw, mime)

            # Cache the result (whether custom image or text fallback)
            try:
                r2 = aioredis.from_url(settings.REDIS_URL)
                await r2.set(cache_key, watermarked, ex=3600)
                await r2.aclose()
            except Exception:
                pass

            return _R(
                content=watermarked,
                media_type="image/jpeg",
                headers={
                    "Content-Disposition": f'inline; filename="{filename.rsplit(".", 1)[0]}.jpg"',
                    "Cache-Control": "no-store",
                },
            )
        except Exception as _wm_exc:
            logger.warning("watermark_proxy_skipped", error=str(_wm_exc))

    # No watermark — stream original
    raw: bytes = await _download_from_s3(entry.file_key)
    return _R(
        content=raw,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
