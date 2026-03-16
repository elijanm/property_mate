"""Annotation service — project CRUD, image upload, annotation save, training trigger."""
from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Optional, List

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
        "min_annotations_to_train": p.min_annotations_to_train,
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

        ann_img = AnnotationImage(
            id=img_id,
            filename=file.filename or safe_name,
            s3_key=key,
            width=width,
            height=height,
            status="unannotated",
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


async def list_images(org_id: str, project_id: str, status: Optional[str] = None) -> list:
    p = await get_project(org_id, project_id)
    imgs = p.images
    if status:
        imgs = [i for i in imgs if i.status == status]
    return [_image_to_dict(i, project_id) for i in imgs]


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

    shapes = []
    for a in annotations:
        shapes.append(AnnotationShape(
            id=a.get("id", str(uuid.uuid4())),
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
    """Background: download images, build YOLO dataset, train, upload weights, run predictions."""
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
        # Build class map
        class_map = {c: idx for idx, c in enumerate(p.classes)}

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "images" / "train").mkdir(parents=True)
            (tmp_path / "images" / "val").mkdir(parents=True)
            (tmp_path / "labels" / "train").mkdir(parents=True)
            (tmp_path / "labels" / "val").mkdir(parents=True)

            # 80/20 split
            val_indices = set(range(0, len(annotated), 5))

            download_tasks = []
            for idx, img in enumerate(annotated):
                split = "val" if idx in val_indices else "train"
                download_tasks.append((idx, img, split))

            async def dl(idx, img, split):
                data = await _download_bytes(img.s3_key)
                ext = Path(img.filename).suffix or ".jpg"
                stem = f"img_{idx:05d}"
                (tmp_path / "images" / split / f"{stem}{ext}").write_bytes(data)
                # Write YOLO label
                lines = []
                for ann in img.annotations:
                    cls_idx = class_map.get(ann.label, 0)
                    if ann.type == "box" and len(ann.coords) >= 4:
                        x, y, w, h = ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]
                        angle_rad = float(ann.coords[4]) if len(ann.coords) >= 5 else 0.0
                        if abs(angle_rad) > 0.001:
                            # OBB format: cls cx cy w h angle_degrees
                            angle_deg = angle_rad * 180.0 / 3.141592653589793
                            lines.append(f"{cls_idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f} {angle_deg:.4f}")
                        else:
                            lines.append(f"{cls_idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
                    elif ann.type == "polygon" and len(ann.coords) >= 3:
                        # Convert polygon to YOLO OBB / segment format
                        flat = " ".join(f"{pt[0]:.6f} {pt[1]:.6f}" for pt in ann.coords)
                        lines.append(f"{cls_idx} {flat}")
                (tmp_path / "labels" / split / f"{stem}.txt").write_text("\n".join(lines))

            await asyncio.gather(*[dl(idx, img, split) for idx, img, split in download_tasks])

            # Write data.yaml
            yaml_content = (
                f"path: {tmp_path}\n"
                f"train: images/train\n"
                f"val: images/val\n"
                f"nc: {len(p.classes)}\n"
                f"names: {p.classes}\n"
            )
            (tmp_path / "data.yaml").write_text(yaml_content)

            # Detect if any annotations use rotation → use OBB model
            has_rotation = any(
                ann.type == "box" and len(ann.coords) >= 5 and abs(float(ann.coords[4])) > 0.001
                for img in annotated for ann in img.annotations
            )
            n = len(annotated)
            if has_rotation:
                base_model = "yolov8n-obb.pt" if n < 50 else ("yolov8s-obb.pt" if n < 200 else "yolov8m-obb.pt")
            else:
                base_model = "yolov8n.pt" if n < 50 else ("yolov8s.pt" if n < 200 else "yolov8m.pt")

            # Train
            try:
                from ultralytics import YOLO
                model = YOLO(base_model)
                train_kwargs: dict = dict(
                    data=str(tmp_path / "data.yaml"),
                    epochs=mv.epochs,
                    imgsz=640,
                    batch=4,
                    project=str(tmp_path / "runs"),
                    name="train",
                    exist_ok=True,
                    verbose=False,
                    # Heavy augmentation to prevent overfitting on small datasets
                    hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
                    degrees=10.0, translate=0.1, scale=0.5,
                    shear=2.0, flipud=0.1, fliplr=0.5,
                    mosaic=1.0, mixup=0.1,
                    # Early stopping: stop if no improvement for 10 epochs
                    patience=10,
                    # Prevent overfitting: only save best val checkpoint
                    save_period=-1,
                )
                # For very small datasets, use the train set as val to avoid empty val
                train_images = list((tmp_path / "images" / "train").iterdir())
                val_images = list((tmp_path / "images" / "val").iterdir())
                if len(val_images) == 0 and len(train_images) > 0:
                    # Copy train → val so YOLO doesn't crash
                    import shutil
                    for f in train_images:
                        shutil.copy(f, tmp_path / "images" / "val" / f.name)
                    for f in (tmp_path / "labels" / "train").iterdir():
                        shutil.copy(f, tmp_path / "labels" / "val" / f.name)
                results = model.train(**train_kwargs)
                # Get best weights
                weights_path = tmp_path / "runs" / "train" / "weights" / "best.pt"
                if not weights_path.exists():
                    weights_path = tmp_path / "runs" / "train" / "weights" / "last.pt"

                # Extract mAP — standard detection uses mAP50(B), OBB uses mAP50(OBB)
                map50 = None
                map50_95 = None
                try:
                    metrics = results.results_dict
                    _m50 = metrics.get("metrics/mAP50(B)")
                    if _m50 is None:
                        _m50 = metrics.get("metrics/mAP50(OBB)")
                    _m50_95 = metrics.get("metrics/mAP50-95(B)")
                    if _m50_95 is None:
                        _m50_95 = metrics.get("metrics/mAP50-95(OBB)")
                    if _m50 is not None:
                        map50 = float(_m50)
                    if _m50_95 is not None:
                        map50_95 = float(_m50_95)
                except Exception:
                    pass

                # Upload weights to S3
                weights_key = f"{org_id}/annotate/{project_id}/models/v{mv.version}_best.pt"
                weights_data = weights_path.read_bytes()
                await _upload_bytes(weights_key, weights_data, "application/octet-stream")

                # Update model version
                mv.status = "ready"
                mv.map50 = map50
                mv.map50_95 = map50_95
                mv.weights_key = weights_key
                mv.completed_at = utc_now()
                p.active_model_version_id = mv.id
                p.status = "predicting"
                p.updated_at = utc_now()
                await p.save()

                # Run predictions on unannotated images (awaited directly — inside bg task)
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

async def export_dataset(org_id: str, project_id: str) -> dict:
    """Export all approved annotations as a YOLO-format ZIP, uploaded to S3."""
    p = await get_project(org_id, project_id)
    annotated = [i for i in p.images if i.annotations]
    if not annotated:
        raise HTTPException(status_code=400, detail="No annotated images to export")

    class_map = {c: idx for idx, c in enumerate(p.classes)}

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "images" / "train").mkdir(parents=True)
        (tmp_path / "labels" / "train").mkdir(parents=True)

        async def dl_export(idx, img):
            data = await _download_bytes(img.s3_key)
            ext = Path(img.filename).suffix or ".jpg"
            stem = f"img_{idx:05d}"
            (tmp_path / "images" / "train" / f"{stem}{ext}").write_bytes(data)
            lines = []
            for ann in img.annotations:
                cls_idx = class_map.get(ann.label, 0)
                if ann.type == "box" and len(ann.coords) == 4:
                    x, y, w, h = ann.coords
                    lines.append(f"{cls_idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
            (tmp_path / "labels" / "train" / f"{stem}.txt").write_text("\n".join(lines))

        await asyncio.gather(*[dl_export(i, img) for i, img in enumerate(annotated)])

        # data.yaml
        (tmp_path / "data.yaml").write_text(
            f"train: images/train\nval: images/train\n"
            f"nc: {len(p.classes)}\nnames: {p.classes}\n"
        )

        # Zip
        zip_path = tmp_path / "dataset.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in tmp_path.rglob("*"):
                if f != zip_path and f.is_file():
                    zf.write(f, f.relative_to(tmp_path))

        zip_key = f"{org_id}/annotate/{project_id}/exports/dataset_v{len(p.model_versions)}.zip"
        await _upload_bytes(zip_key, zip_path.read_bytes(), "application/zip")
        p.last_export_key = zip_key
        await p.save()

        url = generate_presigned_url(zip_key, expiry=3600)
        return {"url": url, "key": zip_key, "image_count": len(annotated)}


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
