"""Dataset collection service — profile management, invites, entries, points."""
import uuid
from typing import Optional, List
from fastapi import UploadFile, HTTPException
from beanie import PydanticObjectId
import structlog

from app.models.dataset import DatasetProfile, DatasetCollector, DatasetEntry, DatasetField
from app.utils.s3_url import generate_presigned_url
from app.utils.datetime import utc_now
from app.core.config import settings


def _oid(value: str) -> PydanticObjectId:
    """Convert string to PydanticObjectId; raise 404 on invalid format."""
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(status_code=404, detail="Invalid ID format")

logger = structlog.get_logger(__name__)


# ── Dataset profile ────────────────────────────────────────────────────────────

async def list_datasets(org_id: str) -> List[DatasetProfile]:
    return await DatasetProfile.find(
        DatasetProfile.org_id == org_id,
        DatasetProfile.deleted_at == None,
    ).to_list()


async def create_dataset(org_id: str, data: dict, created_by: str) -> DatasetProfile:
    fields_raw = data.pop("fields", [])
    fields = [DatasetField(**f) if isinstance(f, dict) else f for f in fields_raw]
    profile = DatasetProfile(org_id=org_id, created_by=created_by, fields=fields, **data)
    await profile.insert()
    logger.info("dataset_created", dataset_id=str(profile.id), org_id=org_id, name=profile.name)
    return profile


async def get_dataset(org_id: str, dataset_id: str) -> DatasetProfile:
    profile = await DatasetProfile.find_one(
        DatasetProfile.id == _oid(dataset_id),
        DatasetProfile.org_id == org_id,
        DatasetProfile.deleted_at == None,
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return profile


async def update_dataset(org_id: str, dataset_id: str, data: dict) -> DatasetProfile:
    profile = await get_dataset(org_id, dataset_id)
    if "fields" in data:
        fields_raw = data.pop("fields")
        data["fields"] = [DatasetField(**f) if isinstance(f, dict) else f for f in fields_raw]
    for k, v in data.items():
        setattr(profile, k, v)
    profile.updated_at = utc_now()
    await profile.save()
    return profile


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
    await get_dataset(org_id, dataset_id)
    filters = [DatasetEntry.dataset_id == dataset_id]
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
    )
    await entry.insert()

    # Update collector stats
    collector.entry_count += 1
    if profile.points_enabled:
        collector.points_earned += profile.points_per_entry
    collector.last_active_at = utc_now()
    await collector.save()

    logger.info(
        "dataset_entry_submitted",
        entry_id=str(entry.id),
        field_id=field_id,
        collector_id=str(collector.id),
        dataset_id=str(profile.id),
        points_awarded=entry.points_awarded,
    )
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
