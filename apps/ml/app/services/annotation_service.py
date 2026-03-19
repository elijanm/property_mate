"""Annotation service — project CRUD, image upload, annotation save, training trigger."""
from __future__ import annotations

import asyncio
import io
import json
import math
import os
import random
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Optional, List, Tuple

import structlog
from beanie import PydanticObjectId
from bson import ObjectId
from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.models.annotation import AnnotationProject, AnnotationImage, AnnotationShape, ModelVersion
from app.utils.datetime import utc_now
from app.utils.s3_url import generate_presigned_url

logger = structlog.get_logger(__name__)


def _oid(s: str) -> Optional[ObjectId]:
    try:
        return ObjectId(s)
    except Exception:
        return None


# ── image quality analysis ────────────────────────────────────────────────────

def _dhash(data: bytes) -> Optional[str]:
    """Compute a 64-bit difference hash (dHash) using PIL only — no extra deps.

    Resize to 9×8 grayscale, compare adjacent pixels horizontally.
    Returns a 16-char hex string, or None on error.
    """
    try:
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(data)).convert("L").resize((9, 8))
        pixels = list(img.getdata())
        bits = [1 if pixels[r * 9 + c] > pixels[r * 9 + c + 1] else 0
                for r in range(8) for c in range(8)]
        val = 0
        for b in bits:
            val = (val << 1) | b
        return f"{val:016x}"
    except Exception:
        return None


def _hamming(h1: str, h2: str) -> int:
    """Hamming distance between two 16-char hex hash strings."""
    return bin(int(h1, 16) ^ int(h2, 16)).count("1")


def _compute_quality(data: bytes, width: Optional[int], height: Optional[int]) -> dict:
    """Compute blur score, brightness, quality issues, quality score, and pHash."""
    try:
        from PIL import Image as PILImage, ImageFilter, ImageStat

        img = PILImage.open(io.BytesIO(data)).convert("L")  # grayscale
        w, h = img.size

        # Blur score: variance of edge-detected image — higher means sharper
        edges = img.filter(ImageFilter.FIND_EDGES)
        blur_score = float(ImageStat.Stat(edges).var[0])

        # Brightness: mean pixel value 0-255
        brightness = float(ImageStat.Stat(img).mean[0])

        # Quality issues
        issues: List[str] = []
        if blur_score < 40:
            issues.append("blurry")
        if brightness < 40:
            issues.append("dark")
        if brightness > 220:
            issues.append("overexposed")
        if w < 200 or h < 200:
            issues.append("low_res")

        # Overall quality score 0-100
        blur_norm = min(100.0, blur_score / 5.0)
        brightness_norm = 100.0 - abs(brightness - 128.0) / 128.0 * 100.0
        raw_score = blur_norm * 0.7 + brightness_norm * 0.3
        quality_score = max(0, min(100, int(raw_score)))

        return {
            "blur_score": round(blur_score, 2),
            "brightness": round(brightness, 2),
            "quality_issues": issues,
            "quality_score": quality_score,
        }
    except Exception:
        return {
            "blur_score": None,
            "brightness": None,
            "quality_issues": [],
            "quality_score": None,
        }


# ── helpers ───────────────────────────────────────────────────────────────────

async def _upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    import aioboto3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        await s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type)


async def _download_bytes(key: str) -> bytes:
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


def _project_to_dict(p: AnnotationProject) -> dict:
    annotated_count = sum(1 for img in p.images if img.annotations)
    approved_count = sum(
        1 for img in p.images
        for ann in img.annotations if ann.approved or ann.source == "manual"
    )
    versions = []
    for v in p.model_versions:
        versions.append({
            "id": v.id, "version": v.version, "status": v.status,
            "trained_on": v.trained_on, "map50": v.map50, "map50_95": v.map50_95,
            "epochs": v.epochs, "created_at": v.created_at.isoformat(),
            "completed_at": v.completed_at.isoformat() if v.completed_at else None,
            "error": v.error,
        })
    archived_count = sum(1 for img in p.images if img.archived)
    return {
        "id": str(p.id),
        "org_id": p.org_id,
        "name": p.name,
        "description": p.description,
        "classes": p.classes,
        "annotation_type": p.annotation_type,
        "status": p.status,
        "image_count": len(p.images),
        "annotated_count": annotated_count,
        "approved_count": approved_count,
        "archived_count": archived_count,
        "min_annotations_to_train": p.min_annotations_to_train,
        "auto_finetune": p.auto_finetune,
        "finetune_lr": p.finetune_lr,
        "base_lr": p.base_lr,
        "train_imgsz": p.train_imgsz,
        "active_model_version_id": p.active_model_version_id,
        "model_versions": versions,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


def _image_to_dict(img: AnnotationImage, project_id: str) -> dict:
    url = generate_presigned_url(img.s3_key) if img.s3_key else None
    anns = []
    for a in img.annotations:
        anns.append({
            "id": a.id, "type": a.type, "label": a.label,
            "coords": a.coords, "confidence": a.confidence,
            "approved": a.approved, "source": a.source,
        })
    return {
        "id": img.id,
        "project_id": project_id,
        "filename": img.filename,
        "url": url,
        "width": img.width,
        "height": img.height,
        "status": img.status,
        "annotations": anns,
        "blur_score": img.blur_score,
        "brightness": img.brightness,
        "quality_score": img.quality_score,
        "quality_issues": img.quality_issues,
        "phash": img.phash,
        "archived": img.archived,
        "added_at": img.added_at.isoformat(),
    }


# ── project CRUD ──────────────────────────────────────────────────────────────

async def list_projects(org_id: str) -> list:
    projects = await AnnotationProject.find(
        AnnotationProject.org_id == org_id,
        AnnotationProject.deleted_at == None,
    ).to_list()
    return [_project_to_dict(p) for p in projects]


async def create_project(
    org_id: str,
    name: str,
    description: str,
    classes: List[str],
    annotation_type: str,
    created_by: str,
) -> dict:
    p = AnnotationProject(
        org_id=org_id,
        name=name,
        description=description,
        classes=classes or ["object"],
        annotation_type=annotation_type or "box",
        created_by=created_by,
    )
    await p.insert()
    return _project_to_dict(p)


async def get_project(org_id: str, project_id: str) -> AnnotationProject:
    p = await AnnotationProject.find_one(
        AnnotationProject.id == PydanticObjectId(project_id),
        AnnotationProject.org_id == org_id,
        AnnotationProject.deleted_at == None,
    )
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


async def update_project(org_id: str, project_id: str, **kwargs) -> dict:
    p = await get_project(org_id, project_id)
    for k, v in kwargs.items():
        if v is not None and hasattr(p, k):
            setattr(p, k, v)
    p.updated_at = utc_now()
    await p.save()
    return _project_to_dict(p)


async def delete_project(org_id: str, project_id: str) -> None:
    p = await get_project(org_id, project_id)
    p.deleted_at = utc_now()
    await p.save()


# ── image management ──────────────────────────────────────────────────────────

async def add_images(org_id: str, project_id: str, files: List[UploadFile]) -> dict:
    p = await get_project(org_id, project_id)
    added = []
    upload_tasks = []

    new_images = []
    for file in files:
        img_id = str(uuid.uuid4())
        ext = Path(file.filename or "image.jpg").suffix or ".jpg"
        safe_name = f"{img_id}{ext}"
        key = f"{org_id}/annotate/{project_id}/{img_id}/{safe_name}"
        data = await file.read()
        upload_tasks.append(_upload_bytes(key, data, file.content_type or "image/jpeg"))

        # Try to get dimensions
        width, height = None, None
        try:
            from PIL import Image as PILImage
            img_obj = PILImage.open(io.BytesIO(data))
            width, height = img_obj.size
        except Exception:
            pass

        quality = _compute_quality(data, width, height)
        ann_img = AnnotationImage(
            id=img_id,
            filename=file.filename or safe_name,
            s3_key=key,
            width=width,
            height=height,
            status="unannotated",
            blur_score=quality["blur_score"],
            brightness=quality["brightness"],
            quality_score=quality["quality_score"],
            quality_issues=quality["quality_issues"],
            phash=_dhash(data),
        )
        new_images.append(ann_img)
        added.append(_image_to_dict(ann_img, project_id))

    await asyncio.gather(*upload_tasks)
    p.images.extend(new_images)
    p.updated_at = utc_now()
    await p.save()

    # Auto-predict newly uploaded images if there is a trained model ready
    if p.active_model_version_id:
        from app.tasks.annotate_task import annotate_predict_single_task
        for img in new_images:
            annotate_predict_single_task.apply_async(
                args=[str(p.id), p.active_model_version_id, img.id, org_id]
            )

    return {"added": len(added), "images": added, "auto_predicting": bool(p.active_model_version_id)}


async def list_images(
    org_id: str,
    project_id: str,
    status: Optional[str] = None,
    quality: Optional[str] = None,
    include_archived: bool = False,
) -> list:
    """List images with optional status, quality, and archive filters.

    quality values: 'good' (score>=70, no issues), 'poor' (score<70 or has issues),
                    'blurry', 'dark', 'overexposed', 'low_res'
    include_archived: when True, returns ONLY archived images; when False (default), excludes them.
    """
    p = await get_project(org_id, project_id)
    imgs = p.images
    imgs = [i for i in imgs if i.archived == include_archived]
    if status:
        imgs = [i for i in imgs if i.status == status]
    if quality == "good":
        imgs = [i for i in imgs if (i.quality_score or 0) >= 70 and not i.quality_issues]
    elif quality == "poor":
        imgs = [i for i in imgs if (i.quality_score or 100) < 70 or bool(i.quality_issues)]
    elif quality in ("blurry", "dark", "overexposed", "low_res"):
        imgs = [i for i in imgs if quality in (i.quality_issues or [])]
    return [_image_to_dict(i, project_id) for i in imgs]


async def archive_image(org_id: str, project_id: str, image_id: str, archived: bool) -> dict:
    p = await get_project(org_id, project_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img.archived = archived
    p.updated_at = utc_now()
    await p.save()
    return _image_to_dict(img, project_id)


async def find_similar_images(
    org_id: str,
    project_id: str,
    image_id: str,
    threshold: int = 12,
) -> list:
    """Return images sorted by perceptual similarity to the target image.

    threshold: maximum hamming distance to include (0=identical, 64=totally different).
               Default 12 catches near-duplicates and slightly cropped/resized copies.
    """
    p = await get_project(org_id, project_id)
    target = next((i for i in p.images if i.id == image_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Image not found")

    # Lazy: compute missing pHashes for every image in this project (including target).
    # Download up to 20 concurrently; skip failures silently.
    missing = [img for img in p.images if not img.phash and img.s3_key]
    if missing:
        sem = asyncio.Semaphore(10)

        async def _fill(img: AnnotationImage) -> None:
            async with sem:
                try:
                    data = await _download_bytes(img.s3_key)
                    img.phash = _dhash(data)
                except Exception:
                    pass

        await asyncio.gather(*[_fill(img) for img in missing])
        await p.save()

    if not target.phash:
        return []  # couldn't compute hash for this image

    results = []
    for img in p.images:
        if img.id == image_id or not img.phash:
            continue
        dist = _hamming(target.phash, img.phash)
        if dist <= threshold:
            d = _image_to_dict(img, project_id)
            d["similarity_distance"] = dist
            d["similarity_pct"] = round((64 - dist) / 64 * 100)
            results.append(d)

    results.sort(key=lambda x: x["similarity_distance"])
    return results


async def get_image(org_id: str, project_id: str, image_id: str) -> dict:
    p = await get_project(org_id, project_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return _image_to_dict(img, project_id)


async def delete_image(org_id: str, project_id: str, image_id: str) -> None:
    p = await get_project(org_id, project_id)
    p.images = [i for i in p.images if i.id != image_id]
    p.updated_at = utc_now()
    await p.save()


async def set_active_model_version(org_id: str, project_id: str, version_id: str) -> dict:
    p = await get_project(org_id, project_id)
    mv = next((v for v in p.model_versions if v.id == version_id), None)
    if not mv:
        raise HTTPException(status_code=404, detail="Model version not found")
    if mv.status != "ready":
        raise HTTPException(status_code=400, detail=f"Model v{mv.version} is not ready (status: {mv.status})")
    p.active_model_version_id = version_id
    p.updated_at = utc_now()
    await p.save()
    return _project_to_dict(p)


async def cancel_model_version(org_id: str, project_id: str, version_id: str) -> dict:
    p = await get_project(org_id, project_id)
    mv = next((v for v in p.model_versions if v.id == version_id), None)
    if not mv:
        raise HTTPException(status_code=404, detail="Model version not found")
    if mv.status not in ("training", "predicting", "queued"):
        raise HTTPException(status_code=400, detail=f"Model v{mv.version} is not running (status: {mv.status})")

    # Revoke Celery tasks — terminate=True sends SIGTERM to the worker process
    from app.core.celery_app import celery_app
    for task_id in filter(None, [mv.celery_task_id, mv.predict_task_id]):
        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")

    mv.status = "failed"
    mv.error = "Cancelled by user"
    # Only reset project status if it was still in training/predicting for this version
    if p.status in ("training", "predicting"):
        p.status = "collecting"
    p.updated_at = utc_now()
    await p.save()
    return _project_to_dict(p)


async def delete_model_version(org_id: str, project_id: str, version_id: str) -> dict:
    p = await get_project(org_id, project_id)
    mv = next((v for v in p.model_versions if v.id == version_id), None)
    if not mv:
        raise HTTPException(status_code=404, detail="Model version not found")
    if mv.status in ("training", "predicting"):
        raise HTTPException(status_code=400, detail="Cannot delete a model that is currently training or predicting")
    # Remove version
    p.model_versions = [v for v in p.model_versions if v.id != version_id]
    # If deleted version was the active one, promote the latest remaining ready version
    if p.active_model_version_id == version_id:
        ready = [v for v in reversed(p.model_versions) if v.status == "ready"]
        p.active_model_version_id = ready[0].id if ready else None
    p.updated_at = utc_now()
    await p.save()
    return _project_to_dict(p)


# ── annotation save ───────────────────────────────────────────────────────────

async def save_annotations(
    org_id: str,
    project_id: str,
    image_id: str,
    annotations: List[dict],
) -> dict:
    p = await get_project(org_id, project_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    # Build lookup of existing shape IDs so updates preserve stable IDs
    existing_ids = {s.id for s in (img.annotations or [])}
    shapes = []
    for a in annotations:
        sid = a.get("id")
        if not sid or sid not in existing_ids:
            sid = sid or str(uuid.uuid4())
        shapes.append(AnnotationShape(
            id=sid,
            type=a.get("type", "box"),
            label=a.get("label", p.classes[0] if p.classes else "object"),
            coords=a.get("coords", []),
            confidence=a.get("confidence"),
            approved=a.get("approved", True),
            source=a.get("source", "manual"),
        ))
    img.annotations = shapes
    img.status = "annotated" if shapes else "unannotated"
    p.updated_at = utc_now()
    await p.save()

    # Check if we should trigger training
    annotated_count = sum(1 for i in p.images if i.annotations)
    result = _image_to_dict(img, project_id)
    result["annotated_count"] = annotated_count
    result["can_train"] = annotated_count >= p.min_annotations_to_train
    return result


async def approve_predictions(
    org_id: str,
    project_id: str,
    image_id: str,
    annotation_ids: Optional[List[str]] = None,  # None = approve all
) -> dict:
    """Mark model-predicted annotations as approved (or all predictions)."""
    p = await get_project(org_id, project_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    for ann in img.annotations:
        if ann.source == "model":
            if annotation_ids is None or ann.id in annotation_ids:
                ann.approved = True
    img.status = "approved"
    p.updated_at = utc_now()
    await p.save()
    return _image_to_dict(img, project_id)


# ── training ──────────────────────────────────────────────────────────────────

async def trigger_training(org_id: str, project_id: str) -> dict:
    """Build a YOLO dataset from approved annotations and fine-tune a model."""
    p = await get_project(org_id, project_id)

    annotated = [i for i in p.images if i.annotations]
    if len(annotated) < p.min_annotations_to_train:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {p.min_annotations_to_train} annotated images (have {len(annotated)})"
        )

    # Create new model version record
    version_num = len(p.model_versions) + 1
    n = len(annotated)
    # Fewer epochs on tiny datasets to avoid overfitting memorisation
    if n < 10:
        epochs = 15
    elif n < 30:
        epochs = 30
    elif n < 100:
        epochs = 50
    else:
        epochs = min(50 + version_num * 10, 150)
    mv = ModelVersion(version=version_num, status="training", trained_on=len(annotated), epochs=epochs)
    p.model_versions.append(mv)
    p.status = "training"
    p.updated_at = utc_now()
    await p.save()

    # Dispatch Celery training task
    from app.tasks.annotate_task import annotate_train_task
    task = annotate_train_task.apply_async(args=[str(p.id), mv.id, org_id])
    mv.celery_task_id = task.id
    await p.save()
    return {"version_id": mv.id, "version": version_num, "status": "training", "trained_on": len(annotated)}


async def _run_training(p_id: str, version_id: str, org_id: str, project_id: str) -> None:
    """Background: download images, build YOLO dataset, train, upload weights, run predictions.

    Transfer learning: if auto_finetune=True and the active model has weights_key,
    download those weights and fine-tune with finetune_lr (lower LR). Otherwise start
    fresh from a pretrained COCO base with base_lr.

    mAP50 comparison: only promote the new model to active if its mAP50 >= active model's mAP50.
    """
    import traceback

    async def _fail(p: AnnotationProject, mv: ModelVersion, error: str) -> None:
        mv.status = "failed"
        mv.error = error
        p.status = "collecting"
        p.updated_at = utc_now()
        await p.save()

    try:
        p = await AnnotationProject.find_one(AnnotationProject.id == PydanticObjectId(p_id))
        if not p:
            return
        mv = next((v for v in p.model_versions if v.id == version_id), None)
        if not mv:
            return

        annotated = [i for i in p.images if i.annotations]
        class_map = {c: idx for idx, c in enumerate(p.classes)}

        # Detect annotation format for the correct YOLO task variant
        has_rotation = any(
            ann.type == "box" and len(ann.coords) >= 5 and abs(float(ann.coords[4])) > 0.001
            for img in annotated for ann in img.annotations
        )
        has_polygons = any(
            ann.type == "polygon"
            for img in annotated for ann in img.annotations
        )
        # Choose YOLO label format: obb for rotated boxes, seg for polygons, detect otherwise
        if has_rotation:
            train_fmt = "yolo-obb"
        elif has_polygons:
            train_fmt = "yolo-seg"
        else:
            train_fmt = "yolo-detect"

        # Determine base model size
        n = len(annotated)
        obb_suffix = "-obb" if train_fmt == "yolo-obb" else ("-seg" if train_fmt == "yolo-seg" else "")
        if n < 50:
            base_arch = f"yolov8n{obb_suffix}.pt"
        elif n < 200:
            base_arch = f"yolov8s{obb_suffix}.pt"
        else:
            base_arch = f"yolov8m{obb_suffix}.pt"

        # 80/20 stratified split
        indices = list(range(len(annotated)))
        random.shuffle(indices)
        split_at = max(1, int(len(indices) * 0.2))
        val_set = set(indices[:split_at])

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for split in ("train", "val"):
                (tmp_path / "images" / split).mkdir(parents=True)
                (tmp_path / "labels" / split).mkdir(parents=True)

            # Batched download + label writing (200 concurrent)
            _BATCH = 200

            async def dl_and_label(idx: int, img: AnnotationImage, split: str) -> None:
                data = await _download_bytes(img.s3_key)
                ext = Path(img.filename).suffix or ".jpg"
                stem = f"img_{idx:05d}"
                (tmp_path / "images" / split / f"{stem}{ext}").write_bytes(data)
                lines = []
                for ann in img.annotations:
                    cls_idx = class_map.get(ann.label, 0)
                    line = _annotation_to_yolo_line(ann, cls_idx, train_fmt)
                    if line:
                        lines.append(line)
                (tmp_path / "labels" / split / f"{stem}.txt").write_text("\n".join(lines))

            tasks = [
                (idx, img, "val" if idx in val_set else "train")
                for idx, img in enumerate(annotated)
            ]
            for batch_start in range(0, len(tasks), _BATCH):
                batch = tasks[batch_start: batch_start + _BATCH]
                await asyncio.gather(*[dl_and_label(idx, img, split) for idx, img, split in batch])

            # Fallback: if val is empty copy from train
            val_images = list((tmp_path / "images" / "val").iterdir())
            if not val_images:
                for f in list((tmp_path / "images" / "train").iterdir()):
                    shutil.copy(f, tmp_path / "images" / "val" / f.name)
                for f in list((tmp_path / "labels" / "train").iterdir()):
                    shutil.copy(f, tmp_path / "labels" / "val" / f.name)

            (tmp_path / "data.yaml").write_text(
                f"path: {tmp_path}\ntrain: images/train\nval: images/val\n"
                f"nc: {len(p.classes)}\nnames: {p.classes}\n"
            )

            # ── Transfer learning ───────────────────────────────────────────────
            prev_weights_path: Optional[Path] = None
            lr0 = p.base_lr

            if p.auto_finetune and p.active_model_version_id:
                active_mv = next(
                    (v for v in p.model_versions if v.id == p.active_model_version_id and v.weights_key),
                    None,
                )
                if active_mv and active_mv.weights_key:
                    try:
                        prev_bytes = await _download_bytes(active_mv.weights_key)
                        prev_weights_path = tmp_path / "prev_best.pt"
                        prev_weights_path.write_bytes(prev_bytes)
                        lr0 = p.finetune_lr
                        logger.info(
                            "training_finetune",
                            project_id=project_id,
                            base_version=active_mv.version,
                            lr0=lr0,
                        )
                    except Exception as e:
                        logger.warning("training_finetune_load_failed", error=str(e))
                        prev_weights_path = None
                        lr0 = p.base_lr

            model_weights = str(prev_weights_path) if prev_weights_path else base_arch

            # ── YOLO training ───────────────────────────────────────────────────
            try:
                from ultralytics import YOLO
                model = YOLO(model_weights)
                results = model.train(
                    data=str(tmp_path / "data.yaml"),
                    epochs=mv.epochs,
                    imgsz=p.train_imgsz,
                    batch=4,
                    lr0=lr0,
                    project=str(tmp_path / "runs"),
                    name="train",
                    exist_ok=True,
                    verbose=False,
                    hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
                    degrees=10.0, translate=0.1, scale=0.5,
                    shear=2.0, flipud=0.1, fliplr=0.5,
                    mosaic=1.0, mixup=0.1,
                    patience=10,
                    save_period=-1,
                )
                weights_path = tmp_path / "runs" / "train" / "weights" / "best.pt"
                if not weights_path.exists():
                    weights_path = tmp_path / "runs" / "train" / "weights" / "last.pt"

                # Extract mAP metrics
                map50: Optional[float] = None
                map50_95: Optional[float] = None
                try:
                    metrics = results.results_dict
                    _m50 = metrics.get("metrics/mAP50(B)") or metrics.get("metrics/mAP50(OBB)")
                    _m95 = metrics.get("metrics/mAP50-95(B)") or metrics.get("metrics/mAP50-95(OBB)")
                    if _m50 is not None:
                        map50 = float(_m50)
                    if _m95 is not None:
                        map50_95 = float(_m95)
                except Exception:
                    pass

                # Upload new weights
                weights_key = f"{org_id}/annotate/{project_id}/models/v{mv.version}_best.pt"
                await _upload_bytes(weights_key, weights_path.read_bytes(), "application/octet-stream")

                mv.status = "ready"
                mv.map50 = map50
                mv.map50_95 = map50_95
                mv.weights_key = weights_key
                mv.completed_at = utc_now()

                # ── mAP50 comparison: only promote if new model is better ───────
                active_map50: float = 0.0
                if p.active_model_version_id:
                    cur = next(
                        (v for v in p.model_versions if v.id == p.active_model_version_id),
                        None,
                    )
                    if cur and cur.map50 is not None:
                        active_map50 = cur.map50

                new_map50 = map50 if map50 is not None else 0.0
                if new_map50 >= active_map50:
                    p.active_model_version_id = mv.id
                    logger.info(
                        "training_promoted",
                        project_id=project_id,
                        version=mv.version,
                        new_map50=new_map50,
                        prev_map50=active_map50,
                    )
                else:
                    logger.info(
                        "training_not_promoted",
                        project_id=project_id,
                        version=mv.version,
                        new_map50=new_map50,
                        prev_map50=active_map50,
                    )

                p.status = "predicting"
                p.updated_at = utc_now()
                await p.save()

                await _run_predictions(str(p.id), mv.id, weights_path, org_id)

            except Exception as e:
                logger.error("training_failed", project_id=project_id, error=str(e))
                await _fail(p, mv, str(e))

    except Exception as e:
        logger.error("training_task_error", project_id=project_id, error=traceback.format_exc())


async def _run_predictions(p_id: str, version_id: str, weights_path: Path, org_id: str) -> None:
    """Run the trained model on unannotated/predicted images."""
    try:
        from ultralytics import YOLO
        model = YOLO(str(weights_path))

        p = await AnnotationProject.find_one(AnnotationProject.id == PydanticObjectId(p_id))
        if not p:
            return

        # Find images without manual annotations
        to_predict = [i for i in p.images if not any(a.source == "manual" for a in i.annotations)]

        for img in to_predict:
            try:
                data = await _download_bytes(img.s3_key)
                import numpy as np
                from PIL import Image as PILImage
                pil_img = PILImage.open(io.BytesIO(data))
                w, h = pil_img.size

                results = model(pil_img, verbose=False)
                predictions = []
                for box in results[0].boxes:
                    cls_idx = int(box.cls[0])
                    label = p.classes[cls_idx] if cls_idx < len(p.classes) else "object"
                    conf = float(box.conf[0])
                    # Convert xyxy to normalised xywh
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    cx = (x1 + x2) / 2 / w
                    cy = (y1 + y2) / 2 / h
                    bw = (x2 - x1) / w
                    bh = (y2 - y1) / h
                    predictions.append(AnnotationShape(
                        type="box",
                        label=label,
                        coords=[cx, cy, bw, bh],
                        confidence=round(conf, 3),
                        approved=False,
                        source="model",
                    ))

                img.annotations = predictions
                img.status = "predicted" if predictions else "unannotated"
            except Exception as e:
                logger.warning("predict_image_failed", image_id=img.id, error=str(e))

        p.status = "collecting"
        p.updated_at = utc_now()
        await p.save()

    except Exception as e:
        logger.error("prediction_task_error", p_id=p_id, error=str(e))


async def _resolve_weights(p: AnnotationProject) -> tuple[Optional[str], Optional[str]]:
    """Return (version_id, weights_key) for the best available trained model.

    Tries Beanie-deserialized objects first; falls back to a raw Motor read
    because Beanie occasionally fails to deserialize Optional[str] fields on
    embedded sub-documents when the worker saves them via a separate Motor client.
    """
    # 1) Try Beanie objects
    for v in reversed(p.model_versions):
        if v.weights_key:
            if v.id == p.active_model_version_id:
                return v.id, v.weights_key
    for v in reversed(p.model_versions):
        if v.weights_key:
            return v.id, v.weights_key

    # 2) Raw Motor fallback
    raw = await AnnotationProject.get_motor_collection().find_one(
        {"_id": p.id}, {"model_versions": 1, "active_model_version_id": 1}
    )
    if not raw:
        return None, None
    active_id = raw.get("active_model_version_id")
    mvs = raw.get("model_versions", [])
    fallback_id = fallback_key = None
    for mv_raw in reversed(mvs):
        wk = mv_raw.get("weights_key")
        if wk:
            if mv_raw.get("id") == active_id:
                return mv_raw["id"], wk
            if fallback_id is None:
                fallback_id, fallback_key = mv_raw["id"], wk
    return fallback_id, fallback_key


async def run_predictions_now(org_id: str, project_id: str) -> dict:
    """Dispatch Celery predict task for all images without manual annotations."""
    p = await get_project(org_id, project_id)
    mv_id, weights_key = await _resolve_weights(p)
    if not mv_id:
        raise HTTPException(status_code=400, detail="No model weights available — train a model first")
    to_predict = [i for i in p.images if not any(a.source == "manual" for a in i.annotations)]
    from app.tasks.annotate_task import annotate_predict_task
    annotate_predict_task.apply_async(args=[str(p.id), mv_id, org_id])
    return {"status": "started", "images_queued": len(to_predict), "model_version_id": mv_id}


async def predict_single_image(org_id: str, project_id: str, image_id: str) -> dict:
    """Dispatch Celery predict task for a single image."""
    p = await get_project(org_id, project_id)
    mv_id, weights_key = await _resolve_weights(p)
    if not mv_id:
        raise HTTPException(status_code=400, detail="No model weights available — train a model first")
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    from app.tasks.annotate_task import annotate_predict_single_task
    annotate_predict_single_task.apply_async(args=[str(p.id), mv_id, image_id, org_id])
    return {"status": "started", "image_id": image_id, "model_version_id": mv_id}


async def get_training_status(org_id: str, project_id: str, version_id: str) -> dict:
    p = await get_project(org_id, project_id)
    mv = next((v for v in p.model_versions if v.id == version_id), None)
    if not mv:
        raise HTTPException(status_code=404, detail="Model version not found")
    return {
        "version_id": mv.id,
        "version": mv.version,
        "status": mv.status,
        "trained_on": mv.trained_on,
        "map50": mv.map50,
        "map50_95": mv.map50_95,
        "epochs": mv.epochs,
        "error": mv.error,
        "completed_at": mv.completed_at.isoformat() if mv.completed_at else None,
    }


# ── export ────────────────────────────────────────────────────────────────────

def _box_to_corners(cx: float, cy: float, w: float, h: float, angle: float = 0.0) -> List[List[float]]:
    """Convert YOLO box [cx,cy,w,h,angle_rad] to 4 corner points (normalised)."""
    dx, dy = w / 2, h / 2
    corners = [(-dx, -dy), (dx, -dy), (dx, dy), (-dx, dy)]
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    return [
        [cx + cos_a * px - sin_a * py, cy + sin_a * px + cos_a * py]
        for px, py in corners
    ]


def _polygon_to_bbox(pts: List) -> Tuple[float, float, float, float]:
    """Axis-aligned bounding box from polygon points → (cx, cy, w, h)."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x_min, x_max, y_min, y_max = min(xs), max(xs), min(ys), max(ys)
    return (x_min + x_max) / 2, (y_min + y_max) / 2, x_max - x_min, y_max - y_min


def _polygon_to_obb(pts: List) -> Tuple[float, float, float, float, float]:
    """Minimum-area oriented bounding box from polygon → (cx, cy, w, h, angle_rad)."""
    n = len(pts)
    best: Tuple[float, float, float, float, float] = (0.0, 0.0, 0.0, 0.0, 0.0)
    min_area = float("inf")
    for i in range(n):
        x1, y1 = pts[i][0], pts[i][1]
        x2, y2 = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        angle = math.atan2(y2 - y1, x2 - x1)
        cos_a, sin_a = math.cos(-angle), math.sin(-angle)
        rotated = [(p[0] * cos_a - p[1] * sin_a, p[0] * sin_a + p[1] * cos_a) for p in pts]
        min_x = min(p[0] for p in rotated)
        max_x = max(p[0] for p in rotated)
        min_y = min(p[1] for p in rotated)
        max_y = max(p[1] for p in rotated)
        area = (max_x - min_x) * (max_y - min_y)
        if area < min_area:
            min_area = area
            cx_r = (min_x + max_x) / 2
            cy_r = (min_y + max_y) / 2
            # rotate center back to original space
            best = (
                cx_r * math.cos(angle) - cy_r * math.sin(angle),
                cx_r * math.sin(angle) + cy_r * math.cos(angle),
                max_x - min_x,
                max_y - min_y,
                angle,
            )
    return best


def _annotation_to_yolo_line(ann, cls_idx: int, fmt: str) -> Optional[str]:
    """Convert a single AnnotationShape to a YOLO label line for the given format."""
    if fmt == "yolo-detect":
        if ann.type == "box" and len(ann.coords) >= 4:
            cx, cy, w, h = ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]
            return f"{cls_idx} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"
        if ann.type == "polygon" and len(ann.coords) >= 3:
            cx, cy, w, h = _polygon_to_bbox(ann.coords)
            return f"{cls_idx} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"

    elif fmt == "yolo-obb":
        if ann.type == "box" and len(ann.coords) >= 4:
            cx, cy, w, h = ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]
            angle_rad = ann.coords[4] if len(ann.coords) >= 5 else 0.0
            angle_deg = math.degrees(angle_rad)
            return f"{cls_idx} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} {angle_deg:.4f}"
        if ann.type == "polygon" and len(ann.coords) >= 3:
            cx, cy, w, h, angle_rad = _polygon_to_obb(ann.coords)
            angle_deg = math.degrees(angle_rad)
            return f"{cls_idx} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} {angle_deg:.4f}"

    elif fmt == "yolo-seg":
        if ann.type == "polygon" and len(ann.coords) >= 3:
            pts = " ".join(f"{p[0]:.6f} {p[1]:.6f}" for p in ann.coords)
            return f"{cls_idx} {pts}"
        if ann.type == "box" and len(ann.coords) >= 4:
            cx, cy, w, h = ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]
            angle_rad = ann.coords[4] if len(ann.coords) >= 5 else 0.0
            corners = _box_to_corners(cx, cy, w, h, angle_rad)
            pts = " ".join(f"{p[0]:.6f} {p[1]:.6f}" for p in corners)
            return f"{cls_idx} {pts}"

    return None


_EXPORT_DOWNLOAD_BATCH = 200   # concurrent S3 downloads per batch


async def export_dataset(
    org_id: str,
    project_id: str,
    fmt: str = "yolo-detect",
    train_ratio: float = 0.8,
    val_ratio: float = 0.2,
    test_ratio: float = 0.0,
    requester_email: str = "",
) -> dict:
    """Queue a background export job and return its id immediately."""
    from app.models.annotation_export_job import AnnotationExportJob

    if fmt not in ("yolo-detect", "yolo-obb", "yolo-seg"):
        raise HTTPException(status_code=400, detail=f"Unknown format '{fmt}'. Use yolo-detect, yolo-obb, or yolo-seg.")

    total = train_ratio + val_ratio + test_ratio
    if not math.isclose(total, 1.0, abs_tol=0.01):
        raise HTTPException(status_code=400, detail=f"Split ratios must sum to 1.0 (got {total:.2f}).")

    p = await get_project(org_id, project_id)
    annotated = [i for i in p.images if i.annotations]
    if not annotated:
        raise HTTPException(status_code=400, detail="No annotated images to export.")

    # ── Compute split sizes upfront so we can report them immediately ────────
    shuffled = annotated.copy()
    random.shuffle(shuffled)
    n = len(shuffled)
    n_train = max(1, round(n * train_ratio))
    n_val   = min(max(1, round(n * val_ratio)), n - n_train)
    n_test  = n - n_train - n_val if test_ratio > 0 else 0

    split_map: dict = {"train": shuffled[:n_train], "val": shuffled[n_train:n_train + n_val]}
    if n_test > 0:
        split_map["test"] = shuffled[n_train + n_val:]

    split_counts = {s: len(imgs) for s, imgs in split_map.items()}

    job = AnnotationExportJob(
        org_id=org_id,
        project_id=project_id,
        project_name=p.name,
        format=fmt,
        status="queued",
        total_images=len(annotated),
        splits=split_counts,
        requested_by_email=requester_email,
    )
    await job.insert()

    # ── Fire and forget ──────────────────────────────────────────────────────
    asyncio.create_task(
        _run_export_job(str(job.id), p, split_map, fmt, requester_email)
    )

    return {
        "job_id": str(job.id),
        "status": "queued",
        "total_images": len(annotated),
        "splits": split_counts,
        "format": fmt,
    }


async def _run_export_job(
    job_id: str,
    p,
    split_map: dict,
    fmt: str,
    requester_email: str,
) -> None:
    """Background task: download images in batches, build YOLO ZIP, upload, notify."""
    from app.models.annotation_export_job import AnnotationExportJob
    from app.core.email import send_email
    from app.utils.datetime import utc_now

    job = await AnnotationExportJob.get(job_id)
    job.status = "running"
    job.started_at = utc_now()
    await job.save()

    class_map = {c: idx for idx, c in enumerate(p.classes)}

    # Flatten all (idx, img, split_name) work items
    work: list = []
    for split_name, imgs in split_map.items():
        for idx, img in enumerate(imgs):
            work.append((idx, img, split_name))

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for split_name in split_map:
                (tmp_path / "images" / split_name).mkdir(parents=True)
                (tmp_path / "labels"  / split_name).mkdir(parents=True)

            async def _process(idx: int, img, split_name: str) -> None:
                data = await _download_bytes(img.s3_key)
                ext  = Path(img.filename).suffix or ".jpg"
                stem = f"img_{idx:05d}"
                (tmp_path / "images" / split_name / f"{stem}{ext}").write_bytes(data)
                lines = []
                for ann in img.annotations:
                    cls_idx = class_map.get(ann.label, 0)
                    line = _annotation_to_yolo_line(ann, cls_idx, fmt)
                    if line:
                        lines.append(line)
                (tmp_path / "labels" / split_name / f"{stem}.txt").write_text("\n".join(lines))

            # ── Process in batches — avoids opening 100k S3 connections at once
            processed = 0
            for batch_start in range(0, len(work), _EXPORT_DOWNLOAD_BATCH):
                batch = work[batch_start:batch_start + _EXPORT_DOWNLOAD_BATCH]
                await asyncio.gather(*[_process(*item) for item in batch])
                processed += len(batch)
                job.processed_images = processed
                await job.save()

            # ── data.yaml ────────────────────────────────────────────────────
            yaml_lines = [f"{s}: images/{s}" for s in split_map]
            yaml_lines += [f"nc: {len(p.classes)}", f"names: {p.classes}"]
            (tmp_path / "data.yaml").write_text("\n".join(yaml_lines) + "\n")

            # ── Zip ──────────────────────────────────────────────────────────
            zip_path = tmp_path / "dataset.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in tmp_path.rglob("*"):
                    if f != zip_path and f.is_file():
                        zf.write(f, f.relative_to(tmp_path))

            version = len(p.model_versions)
            zip_key = f"{p.org_id}/annotate/{p.id}/exports/dataset_v{version}_{fmt}.zip"
            await _upload_bytes(zip_key, zip_path.read_bytes(), "application/zip")
            p.last_export_key = zip_key
            await p.save()

            url = generate_presigned_url(zip_key, expiry=86400)   # 24h link

            job.status       = "completed"
            job.download_url = url
            job.s3_key       = zip_key
            job.completed_at = utc_now()
            await job.save()

            if requester_email:
                split_summary = ", ".join(f"{s}: {n}" for s, n in job.splits.items())
                await send_email(
                    to=requester_email,
                    subject=f"Export ready — {p.name} ({fmt})",
                    html=f"""
                    <p>Your dataset export for <strong>{p.name}</strong> is ready.</p>
                    <p><strong>Format:</strong> {fmt}<br>
                    <strong>Images:</strong> {job.total_images} ({split_summary})</p>
                    <p><a href="{url}" style="background:#6366f1;color:#fff;padding:10px 20px;
                    border-radius:6px;text-decoration:none;display:inline-block">
                    Download Dataset</a></p>
                    <p><em>Link expires in 24 hours.</em></p>
                    """,
                )

    except Exception as exc:
        logger.error("export_job_failed", job_id=job_id, error=str(exc))
        job.status = "failed"
        job.error  = str(exc)
        job.completed_at = utc_now()
        await job.save()

        if requester_email:
            await send_email(
                to=requester_email,
                subject=f"Export failed — {p.name}",
                html=f"<p>Your dataset export for <strong>{p.name}</strong> failed.</p>"
                     f"<p><code>{exc}</code></p>",
            )


async def get_export_job(org_id: str, job_id: str) -> dict:
    from app.models.annotation_export_job import AnnotationExportJob
    job = await AnnotationExportJob.get(job_id)
    if not job or job.org_id != org_id:
        raise HTTPException(status_code=404, detail="Export job not found.")
    return {
        "job_id": str(job.id),
        "status": job.status,
        "format": job.format,
        "total_images": job.total_images,
        "processed_images": job.processed_images,
        "progress_pct": job.progress_pct,
        "splits": job.splits,
        "download_url": job.download_url,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


async def export_model(org_id: str, project_id: str) -> dict:
    """Return a presigned download URL for the latest trained model weights."""
    p = await get_project(org_id, project_id)
    if not p.active_model_version_id:
        raise HTTPException(status_code=404, detail="No trained model available")
    mv = next((v for v in p.model_versions if v.id == p.active_model_version_id), None)
    if not mv or not mv.weights_key:
        raise HTTPException(status_code=404, detail="Model weights not found")
    url = generate_presigned_url(mv.weights_key, expiry=3600)
    return {"url": url, "version": mv.version, "map50": mv.map50}
