"""URL dataset fetch-and-store service.

Fetch → save all records to one S3 file → keep one DatasetEntry pointing at that file.
Re-fetch → overwrite S3 file → update the same DatasetEntry.
"""
from __future__ import annotations

import hashlib
import io
import json
import structlog
from datetime import timedelta
from typing import Any, List, Optional

import httpx

from app.core.config import settings
from app.models.url_dataset import UrlDataset
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_MEDIA_TYPES = ("image/", "video/", "audio/")
_TEXT_TYPES  = ("text/csv", "text/plain", "text/tab-separated")


# ── Public API ────────────────────────────────────────────────────────────────

async def get_or_create_by_slug(
    slug: str,
    org_id: str,
    source_url: str,
    refresh_interval_hours: int = 24,
    url_field: str | None = None,
    max_items: int | None = None,
    on_change_webhook_url: str | None = None,
    on_change_retrain: str | None = None,
    auto_create_spec: dict | None = None,
) -> UrlDataset:
    """Look up a UrlDataset by slug+org_id, creating it if it doesn't exist."""
    src = await UrlDataset.find_one({"slug": slug, "org_id": org_id, "deleted_at": None})
    if src:
        return src

    spec = auto_create_spec or {}
    name = spec.get("name") or slug.replace("-", " ").title()

    profile_id: str | None = None
    if auto_create_spec:
        profile_id = await _create_dataset_profile(slug, org_id, spec)

    src = UrlDataset(
        org_id=org_id,
        name=name,
        slug=slug,
        dataset_profile_id=profile_id,
        source_url=source_url,
        refresh_interval_hours=refresh_interval_hours,
        url_field=url_field,
        max_items=max_items,
        on_change_webhook_url=on_change_webhook_url,
        on_change_retrain=on_change_retrain,
    )
    await src.insert()

    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(fetch_and_store(str(src.id)))
    except RuntimeError:
        pass  # no running loop — load() will trigger fetch on first use
    return src


async def fetch_and_store(source_id: str) -> None:
    """Fetch the source URL, save all records to one S3 file, keep one entry reference."""
    src = await UrlDataset.get(source_id)
    if not src:
        raise ValueError(f"UrlDataset {source_id!r} not found")

    await src.set({"status": "fetching", "updated_at": utc_now()})

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=10, read=120, write=30, pool=5),
        ) as client:
            resp = await client.get(src.source_url)
            resp.raise_for_status()

        raw_content_type = resp.headers.get("content-type", "application/octet-stream")
        content_type     = raw_content_type.split(";")[0].strip().lower()
        prefix           = f"{src.org_id}/url_datasets/{source_id}/"
        new_hash         = hashlib.sha256(resp.content).hexdigest()

        # Save all records to the canonical S3 file (overwrites previous)
        item_count, size_bytes, s3_key = await _save_to_s3(
            content=resp.content,
            content_type=content_type,
            prefix=prefix,
            url_field=src.url_field,
            max_items=src.max_items,
        )

        next_fetch = (
            utc_now() + timedelta(hours=src.refresh_interval_hours)
            if src.refresh_interval_hours > 0 else None
        )

        await src.set({
            "status":          "ready",
            "content_type":    content_type,
            "s3_prefix":       prefix,
            "item_count":      item_count,
            "size_bytes":      size_bytes,
            "content_hash":    new_hash,
            "last_fetched_at": utc_now(),
            "next_fetch_at":   next_fetch,
            "fetch_error":     None,
            "updated_at":      utc_now(),
        })

        logger.info("url_dataset_fetched", source_id=source_id,
                    items=item_count, bytes=size_bytes, key=s3_key)

        # Ensure a companion dataset profile exists (auto-create if missing)
        if not src.dataset_profile_id:
            profile_slug = src.slug or source_id
            auto_spec = {"name": src.name, "description": src.source_url, "slug": profile_slug}
            new_profile_id = await _create_dataset_profile(profile_slug, src.org_id, auto_spec)
            await src.set({"dataset_profile_id": new_profile_id, "updated_at": utc_now()})
            src.dataset_profile_id = new_profile_id

        # Keep one DatasetEntry pointing at the S3 file (upsert)
        await _upsert_entry(src, s3_key, content_type, size_bytes, item_count)

        if new_hash != src.content_hash:
            await _fire_on_change_hooks(src, source_id, new_hash)

    except Exception as exc:
        try:
            await src.set({"status": "error", "fetch_error": str(exc), "updated_at": utc_now()})
        except Exception:
            pass
        logger.error("url_dataset_fetch_failed", source_id=source_id, error=str(exc))
        raise exc


async def load_from_s3(src: UrlDataset) -> Any:
    """Load the cached S3 file and return parsed data."""
    import aioboto3

    if not src.s3_prefix:
        raise ValueError("URL dataset has no S3 content yet — wait for fetch to complete")

    content_type = src.content_type or ""
    filename     = _canonical_filename(content_type)
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
    ) as s3:
        
        if "json" in content_type and src.url_field:
            resp = await s3.get_object(Bucket=settings.S3_BUCKET,
                                       Key=f"{src.s3_prefix}manifest.json")
            return json.loads(await resp["Body"].read())
        
        resp = await s3.get_object(Bucket=settings.S3_BUCKET,
                                   Key=f"{src.s3_prefix}{filename}")
        raw  = await resp["Body"].read()
        if "json" in content_type:
            return json.loads(raw)

        if "csv" in content_type:
            import csv
            return list(csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace"))))

        if any(content_type.startswith(t) for t in _TEXT_TYPES):
            return raw.decode("utf-8", errors="replace")

        return raw  # bytes for media / raw


def load_from_s3_sync(src: "UrlDataset | str") -> Any:
    """Load the canonical S3 file synchronously — safe to call from preprocess().

    ``src`` can be:
    - a ``UrlDataset`` model instance (legacy), or
    - a plain S3 file key string — e.g. ``raw[0]['file_key']`` from preprocess().
    """
    import boto3

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
    )

    # Accept a plain file_key string (the common path from preprocess())
    if isinstance(src, str):
        file_key = src
        if not file_key:
            raise ValueError(
                "load_from_s3_sync: file_key is empty. "
                "Trigger a URL dataset refresh so the entry is re-saved with a valid S3 key."
            )
        resp = s3.get_object(Bucket=settings.S3_BUCKET, Key=file_key)
        raw  = resp["Body"].read()
        # Infer type from key extension
        if file_key.endswith(".json"):
            return json.loads(raw)
        if file_key.endswith(".csv"):
            import csv
            return list(csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace"))))
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            return raw

    # UrlDataset instance path (kept for backwards compatibility)
    if not src.s3_prefix:
        raise ValueError("URL dataset has no S3 content yet — wait for fetch to complete")

    content_type = src.content_type or ""
    filename     = _canonical_filename(content_type)

    if "json" in content_type and src.url_field:
        resp = s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{src.s3_prefix}manifest.json")
        return json.loads(resp["Body"].read())

    resp = s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{src.s3_prefix}{filename}")
    raw  = resp["Body"].read()

    if "json" in content_type:
        return json.loads(raw)
    if "csv" in content_type:
        import csv
        return list(csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace"))))
    if any(content_type.startswith(t) for t in _TEXT_TYPES):
        return raw.decode("utf-8", errors="replace")
    return raw


async def refresh_due() -> None:
    """Re-fetch all URL datasets whose next_fetch_at is past."""
    now = utc_now()
    due = await UrlDataset.find({
        "status":                 {"$in": ["ready", "error"]},
        "refresh_interval_hours": {"$gt": 0},
        "next_fetch_at":          {"$lte": now},
        "deleted_at":             None,
    }).to_list()

    for src in due:
        try:
            await fetch_and_store(str(src.id))
        except Exception:
            pass


# ── Internal helpers ──────────────────────────────────────────────────────────

def _canonical_filename(content_type: str) -> str:
    if "json" in content_type:
        return "data.json"
    if "csv" in content_type:
        return "data.csv"
    if any(content_type.startswith(t) for t in _TEXT_TYPES):
        return "data.txt"
    if any(content_type.startswith(t) for t in _MEDIA_TYPES):
        ext = content_type.split("/")[-1].split(";")[0].split("+")[0] or "bin"
        return f"media.{ext}"
    return "raw"


async def _save_to_s3(
    content: bytes,
    content_type: str,
    prefix: str,
    url_field: str | None,
    max_items: int | None,
) -> tuple[int, int, str]:
    """Write content to the canonical S3 file. Returns (item_count, size_bytes, s3_key)."""
    import aioboto3

    filename = _canonical_filename(content_type)
    key      = f"{prefix}{filename}"

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
    ) as s3:

        if "json" in content_type:
            data = json.loads(content)

            # JSON array of objects with a media URL field → download each item
            if isinstance(data, list) and url_field and data and isinstance(data[0], dict):
                count, total = await _fetch_media_items(s3, data, url_field, prefix, max_items)
                return count, total, f"{prefix}manifest.json"

            # Trim to max_items if set
            if isinstance(data, list) and max_items:
                data    = data[:max_items]
                content = json.dumps(data, ensure_ascii=False).encode()

            await s3.put_object(Bucket=settings.S3_BUCKET, Key=key,
                                Body=content, ContentType="application/json")
            count = len(data) if isinstance(data, list) else 1
            return count, len(content), key

        if any(content_type.startswith(t) for t in _TEXT_TYPES):
            if max_items:
                lines   = content.decode("utf-8", errors="replace").splitlines()
                content = "\n".join(lines[:max_items + 1]).encode()  # keep header
            await s3.put_object(Bucket=settings.S3_BUCKET, Key=key,
                                Body=content, ContentType=content_type)
            lines = max(0, content.count(b"\n") - 1)
            return lines or 1, len(content), key

        if any(content_type.startswith(t) for t in _MEDIA_TYPES):
            await s3.put_object(Bucket=settings.S3_BUCKET, Key=key,
                                Body=content, ContentType=content_type)
            return 1, len(content), key

        # Fallback: store raw bytes
        await s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content)
        return 1, len(content), key


async def _fetch_media_items(
    s3: Any, items: List[dict], url_field: str, prefix: str, max_items: int | None
) -> tuple[int, int]:
    """Download each media URL and store individually + write manifest.json."""
    if max_items:
        items = items[:max_items]

    manifest    = []
    total_bytes = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            media_url = item.get(url_field)
            if not media_url:
                continue
            try:
                r  = await client.get(media_url)
                r.raise_for_status()
                ct  = r.headers.get("content-type", "application/octet-stream").split(";")[0]
                ext = ct.split("/")[-1].split("+")[0] or "bin"
                key = f"{prefix}items/{i}.{ext}"
                await s3.put_object(Bucket=settings.S3_BUCKET, Key=key,
                                    Body=r.content, ContentType=ct)
                total_bytes += len(r.content)
                manifest.append({**item, "_s3_key": key, "_index": i})
            except Exception as exc:
                logger.warning("url_dataset_media_item_failed",
                               index=i, url=media_url, error=str(exc))

    manifest_bytes = json.dumps(manifest).encode()
    await s3.put_object(Bucket=settings.S3_BUCKET, Key=f"{prefix}manifest.json",
                        Body=manifest_bytes, ContentType="application/json")
    total_bytes += len(manifest_bytes)
    return len(manifest), total_bytes


async def _upsert_entry(
    src: UrlDataset,
    file_key: str,
    file_mime: str,
    file_size_bytes: int,
    item_count: int,
) -> None:
    """Upsert the single file-reference entry for this URL dataset (race-safe)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings as _s

    client = AsyncIOMotorClient(_s.MONGODB_URL)
    db     = client[_s.MONGODB_DATABASE]
    try:
        now = utc_now()
        # replace_one + upsert=True is atomic — safe against concurrent fetch_and_store calls
        await db["dataset_entries"].replace_one(
            {"dataset_id": src.dataset_profile_id, "collector_id": "__url_fetch__"},
            {
                "org_id":                 src.org_id,
                "dataset_id":             src.dataset_profile_id,
                "collector_id":           "__url_fetch__",
                "field_id":               "source_data",
                "file_key":               file_key,
                "file_mime":              file_mime,
                "file_size_bytes":        file_size_bytes,
                "text_value":             None,
                "description":            f"{item_count} records · {file_size_bytes // 1024} KB",
                "points_awarded":         0,
                "location":               None,
                "captured_at":            now,
                "review_status":          "approved",
                "review_note":            None,
                "validation_prediction":  None,
                "validation_confidence":  None,
                "blur_score":             None,
                "brightness":             None,
                "quality_score":          None,
                "quality_issues":         [],
                "phash":                  None,
                "file_hash":              None,
                "consent_record_id":      None,
                "archived":               False,
            },
            upsert=True,
        )
        logger.info("url_dataset_entry_upserted", source_id=str(src.id), key=file_key)
    except Exception as exc:
        logger.warning("url_dataset_entry_upsert_failed", source_id=str(src.id), error=str(exc))
    finally:
        client.close()


async def _create_dataset_profile(slug: str, org_id: str, spec: dict) -> str:
    """Create a DatasetProfile from auto_create_spec and return its string ID."""
    import uuid as _uuid
    from bson import ObjectId as _OID
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings as _s

    client = AsyncIOMotorClient(_s.MONGODB_URL)
    db     = client[_s.MONGODB_DATABASE]
    try:
        existing = await db["dataset_profiles"].find_one(
            {"slug": slug, "org_id": org_id, "deleted_at": None}
        )
        if existing:
            return str(existing["_id"])

        raw_fields = spec.get("fields", [])
        fields = []
        for i, f in enumerate(raw_fields):
            fields.append({
                "id":                   str(_uuid.uuid4()),
                "label":                f.get("label", "Field"),
                "instruction":          f.get("instruction", ""),
                "type":                 f.get("type", "text"),
                "capture_mode":         f.get("capture_mode", "upload_only"),
                "required":             f.get("required", True),
                "description_mode":     "none",
                "description_presets":  f.get("options", []),
                "description_required": False,
                "order":                i,
                "repeatable":           f.get("repeatable", False),
                "max_repeats":          f.get("max_repeats", 0),
                "validation_model":     None,
                "validation_labels":    [],
                "validation_message":   "",
            })

        # System field: S3 file reference (the canonical data file)
        fields.append({
            "id":                   "source_data",
            "label":                "Source Data",
            "instruction":          "URL dataset source file (auto-managed)",
            "type":                 "file",
            "capture_mode":         "upload_only",
            "required":             False,
            "description_mode":     "none",
            "description_presets":  [],
            "description_required": False,
            "order":                999,
            "repeatable":           False,
            "max_repeats":          0,
            "validation_model":     None,
            "validation_labels":    [],
            "validation_message":   "",
        })

        now = utc_now()
        oid = _OID()
        await db["dataset_profiles"].insert_one({
            "_id":                    oid,
            "org_id":                 org_id,
            "name":                   spec.get("name", slug.replace("-", " ").title()),
            "slug":                   slug,
            "description":            spec.get("description", ""),
            "category":               spec.get("category", "url_dataset"),
            "fields":                 fields,
            "status":                 "active",
            "visibility":             "private",
            "points_enabled":         False,
            "points_per_entry":       1,
            "points_redemption_info": "",
            "require_location":       False,
            "location_purpose":       "",
            "require_consent":        False,
            "consent_template_id":    None,
            "discoverable":           False,
            "contributor_allowlist":  [],
            "created_by":             "system",
            "created_at":             now,
            "updated_at":             now,
            "deleted_at":             None,
        })
        return str(oid)
    finally:
        client.close()


async def _fire_on_change_hooks(src: UrlDataset, source_id: str, new_hash: str) -> None:
    if src.on_change_webhook_url:
        payload = {
            "event":        "url_dataset_changed",
            "source_id":    source_id,
            "name":         src.name,
            "org_id":       src.org_id,
            "content_hash": new_hash,
            "item_count":   src.item_count,
            "fetched_at":   utc_now().isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(src.on_change_webhook_url, json=payload)
                r.raise_for_status()
            logger.info("url_dataset_webhook_fired", source_id=source_id)
        except Exception as exc:
            logger.warning("url_dataset_webhook_failed", source_id=source_id, error=str(exc))

    if src.on_change_retrain:
        try:
            from app.tasks.train_task import enqueue_training
            await enqueue_training(src.on_change_retrain, trigger="url_dataset_changed",
                                   org_id=src.org_id)
            logger.info("url_dataset_retrain_enqueued", source_id=source_id)
        except Exception as exc:
            logger.warning("url_dataset_retrain_failed", source_id=source_id, error=str(exc))
