"""Celery tasks for annotation project training and prediction."""
import asyncio
import io
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

import structlog

# Persistent event loop — same pattern as train_task.py
# asyncio.run() closes the loop after each call which breaks Motor's thread
# executor on subsequent tasks, so we reuse one loop per worker process.
_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)


def _run_async(coro):
    return _loop.run_until_complete(coro)


from app.core.celery_app import celery_app
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


# ── shared inference helper ────────────────────────────────────────────────────

def _infer(model, pil_img, img_w: int, img_h: int, classes: list) -> list:
    """Run YOLO inference and return a list of AnnotationShape dicts.

    Handles both standard detection (results.boxes) and OBB models (results.obb).
    Confidence threshold is lowered to 0.15 so small-dataset models surface more
    candidates for human review.
    """
    from app.models.annotation import AnnotationShape

    results = model(pil_img, verbose=False, conf=0.15)
    r = results[0]
    predictions = []

    # OBB model: results stored in r.obb  (xywhr = [cx, cy, w, h, angle_rad] pixels)
    obb = getattr(r, "obb", None)
    if obb is not None and len(obb) > 0:
        for box in obb:
            cls_idx = int(box.cls[0])
            label = classes[cls_idx] if cls_idx < len(classes) else "object"
            conf = float(box.conf[0])
            cx_px, cy_px, bw_px, bh_px, angle = box.xywhr[0].tolist()
            predictions.append(AnnotationShape(
                type="box", label=label,
                coords=[cx_px / img_w, cy_px / img_h, bw_px / img_w, bh_px / img_h, angle],
                confidence=round(conf, 3),
                approved=False, source="model",
            ))
        return predictions

    # Standard detection model: results stored in r.boxes  (xyxy pixels)
    for box in r.boxes:
        cls_idx = int(box.cls[0])
        label = classes[cls_idx] if cls_idx < len(classes) else "object"
        conf = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cx = (x1 + x2) / 2 / img_w
        cy = (y1 + y2) / 2 / img_h
        bw = (x2 - x1) / img_w
        bh = (y2 - y1) / img_h
        predictions.append(AnnotationShape(
            type="box", label=label,
            coords=[cx, cy, bw, bh],
            confidence=round(conf, 3),
            approved=False, source="model",
        ))
    return predictions


# ── training task ──────────────────────────────────────────────────────────────

@celery_app.task(name="ml_studio.annotate_train", bind=True, max_retries=0)
def annotate_train_task(self, project_id: str, version_id: str, org_id: str) -> dict:
    """Train a YOLO model on annotated images for an annotation project."""

    async def _run():
        from app.core.database import init_db
        await init_db()
        from beanie import PydanticObjectId
        from app.models.annotation import AnnotationProject, ModelVersion
        from app.services.annotation_service import (
            _upload_bytes, _download_bytes, _run_predictions
        )

        p = await AnnotationProject.find_one(
            AnnotationProject.id == PydanticObjectId(project_id)
        )
        if not p:
            logger.error("annotate_train_project_not_found", project_id=project_id)
            return

        mv = next((v for v in p.model_versions if v.id == version_id), None)
        if not mv:
            return

        # Mark running
        mv.status = "training"
        p.status = "training"
        p.updated_at = utc_now()
        await p.save()

        try:
            annotated = [i for i in p.images if i.annotations]
            class_map = {c: idx for idx, c in enumerate(p.classes)}

            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                for split in ("train", "val"):
                    (tmp_path / "images" / split).mkdir(parents=True)
                    (tmp_path / "labels" / split).mkdir(parents=True)

                # 80/20 split
                val_indices = set(range(0, len(annotated), 5))

                async def dl(idx, img, split):
                    import math
                    data = await _download_bytes(img.s3_key)
                    ext = Path(img.filename).suffix or ".jpg"
                    stem = f"img_{idx:05d}"
                    (tmp_path / "images" / split / f"{stem}{ext}").write_bytes(data)
                    lines = []
                    for ann in img.annotations:
                        cls_idx = class_map.get(ann.label, 0)
                        if ann.type == "box" and len(ann.coords) >= 4:
                            x, y, w, h = ann.coords[0], ann.coords[1], ann.coords[2], ann.coords[3]
                            angle_rad = float(ann.coords[4]) if len(ann.coords) >= 5 else 0.0
                            if abs(angle_rad) > 0.001:
                                angle_deg = angle_rad * 180.0 / math.pi
                                lines.append(f"{cls_idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f} {angle_deg:.4f}")
                            else:
                                lines.append(f"{cls_idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
                        elif ann.type == "polygon" and len(ann.coords) >= 3:
                            flat = " ".join(f"{pt[0]:.6f} {pt[1]:.6f}" for pt in ann.coords)
                            lines.append(f"{cls_idx} {flat}")
                    (tmp_path / "labels" / split / f"{stem}.txt").write_text("\n".join(lines))

                import asyncio as _asyncio
                await _asyncio.gather(*[
                    dl(idx, img, "val" if idx in val_indices else "train")
                    for idx, img in enumerate(annotated)
                ])

                # Ensure val set has at least 1 image
                train_imgs = list((tmp_path / "images" / "train").iterdir())
                val_imgs = list((tmp_path / "images" / "val").iterdir())
                if not val_imgs and train_imgs:
                    for f in train_imgs:
                        shutil.copy(f, tmp_path / "images" / "val" / f.name)
                    for f in (tmp_path / "labels" / "train").iterdir():
                        shutil.copy(f, tmp_path / "labels" / "val" / f.name)

                # Detect rotation (OBB)
                import math as _math
                has_rotation = any(
                    ann.type == "box" and len(ann.coords) >= 5 and abs(float(ann.coords[4])) > 0.001
                    for img in annotated for ann in img.annotations
                )
                n = len(annotated)
                nc = len(p.classes)

                # ── Hardware detection ───────────────────────────────────────────
                import torch
                gpu_available = torch.cuda.is_available()
                device = "0" if gpu_available else "cpu"

                # ── Model selection ──────────────────────────────────────────────
                # GPU: use 's' (small, 11M params) — better accuracy than 'n' (nano).
                # CPU: always use 'n' (nano, 3.2M params) — 's' is 3–5× slower on CPU.
                if gpu_available:
                    if has_rotation:
                        base_model = "yolov8m-obb.pt" if n >= 200 else "yolov8s-obb.pt"
                    else:
                        base_model = "yolov8m.pt" if n >= 200 else "yolov8s.pt"
                else:
                    base_model = "yolov8n-obb.pt" if has_rotation else "yolov8n.pt"

                # ── Epoch schedule ───────────────────────────────────────────────
                # GPU: more epochs — augmentation does the heavy lifting.
                # CPU: far fewer epochs so training completes in minutes not hours.
                if gpu_available:
                    if n < 10:    epochs = 100
                    elif n < 30:  epochs = 150
                    elif n < 100: epochs = 200
                    else:         epochs = min(200 + len(p.model_versions) * 20, 300)
                else:
                    # CPU budget: target ~5–10 min total training time
                    if n < 10:    epochs = 30
                    elif n < 30:  epochs = 50
                    elif n < 100: epochs = 80
                    else:         epochs = 100

                # ── Image size ───────────────────────────────────────────────────
                # GPU: 800px for better localisation on small datasets.
                # CPU: 416px — each pixel is compute; 800px is ~3.7× slower than 416.
                if gpu_available:
                    imgsz = 640 if n >= 100 else 800
                else:
                    imgsz = 416

                # ── Batch size ───────────────────────────────────────────────────
                # GPU: larger batches use VRAM and train faster.
                # CPU: small batch — no parallelism benefit; reduces memory pressure.
                if gpu_available:
                    batch = 8 if n >= 20 else 4
                else:
                    batch = 4

                # ── Workers ──────────────────────────────────────────────────────
                # CPU training: set workers=0 to avoid spawning extra processes
                # inside the Celery forked worker (would compete for CPU cores).
                workers = 4 if gpu_available else 0

                (tmp_path / "data.yaml").write_text(
                    f"path: {tmp_path}\ntrain: images/train\nval: images/val\n"
                    f"nc: {nc}\nnames: {p.classes}\n"
                )

                from ultralytics import YOLO
                model = YOLO(base_model)

                # Augmentation is cheaper on GPU; on CPU reduce heavy ops to save time.
                _mosaic      = 1.0  if gpu_available else 0.5
                _mixup       = 0.15 if gpu_available else 0.0
                _copy_paste  = 0.3  if gpu_available else 0.0
                _perspective = 0.0003 if gpu_available else 0.0
                _warmup_ep   = 5 if gpu_available else 3
                _patience    = 30 if gpu_available else 15
                _close_mosaic = max(10, epochs // 10)

                results = model.train(
                    data=str(tmp_path / "data.yaml"),
                    epochs=epochs,
                    imgsz=imgsz,
                    batch=batch,
                    workers=workers,
                    device=device,
                    project=str(tmp_path / "runs"),
                    name="train",
                    exist_ok=True,
                    verbose=False,

                    # ── Optimiser ────────────────────────────────────────────────
                    optimizer="AdamW",
                    lr0=0.001,
                    lrf=0.01,
                    momentum=0.937,
                    weight_decay=0.0005,
                    warmup_epochs=_warmup_ep,
                    warmup_momentum=0.8,
                    cos_lr=True,

                    # ── Augmentation ─────────────────────────────────────────────
                    hsv_h=0.02, hsv_s=0.9, hsv_v=0.5,
                    degrees=15.0,
                    translate=0.15,
                    scale=0.6,
                    shear=3.0,
                    perspective=_perspective,
                    flipud=0.2,
                    fliplr=0.5,
                    mosaic=_mosaic,
                    mixup=_mixup,
                    copy_paste=_copy_paste,
                    close_mosaic=_close_mosaic,

                    # ── Regularisation ───────────────────────────────────────────
                    dropout=0.0,
                    label_smoothing=0.05,

                    # ── Early stopping & checkpointing ───────────────────────────
                    patience=_patience,
                    save_period=-1,
                )

                weights_path = tmp_path / "runs" / "train" / "weights" / "best.pt"
                if not weights_path.exists():
                    weights_path = tmp_path / "runs" / "train" / "weights" / "last.pt"

                map50 = map50_95 = None
                try:
                    metrics = results.results_dict
                    # Standard detection uses mAP50(B); OBB uses mAP50(OBB).
                    # Use explicit key presence check (not `or`) so a real 0.0 value is kept.
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

                weights_key = f"{org_id}/annotate/{project_id}/models/v{mv.version}_best.pt"
                await _upload_bytes(weights_key, weights_path.read_bytes(), "application/octet-stream")

                mv.status = "predicting"
                mv.map50 = map50
                mv.map50_95 = map50_95
                mv.weights_key = weights_key
                mv.completed_at = utc_now()
                p.active_model_version_id = mv.id
                p.status = "predicting"
                p.updated_at = utc_now()
                await p.save()

                # Guarantee metrics are persisted — Beanie may not write Optional[float]
                # fields on embedded sub-documents reliably; raw $set ensures they land.
                coll = AnnotationProject.get_motor_collection()
                mv_idx = next((i for i, v in enumerate(p.model_versions) if v.id == mv.id), None)
                if mv_idx is not None:
                    await coll.update_one(
                        {"_id": p.id},
                        {"$set": {
                            f"model_versions.{mv_idx}.map50": map50,
                            f"model_versions.{mv_idx}.map50_95": map50_95,
                            f"model_versions.{mv_idx}.weights_key": weights_key,
                            f"model_versions.{mv_idx}.status": "predicting",
                        }}
                    )

                # Dispatch predict task
                task = annotate_predict_task.apply_async(
                    args=[project_id, mv.id, org_id]
                )
                mv.predict_task_id = task.id
                p.updated_at = utc_now()
                await p.save()

        except Exception as exc:
            logger.error("annotate_train_failed", project_id=project_id, error=str(exc))
            mv.status = "failed"
            mv.error = str(exc)
            p.status = "collecting"
            p.updated_at = utc_now()
            await p.save()
            raise

    _run_async(_run())
    return {"project_id": project_id, "version_id": version_id}


# ── prediction task ────────────────────────────────────────────────────────────

@celery_app.task(name="ml_studio.annotate_predict", bind=True, max_retries=0)
def annotate_predict_task(self, project_id: str, version_id: str, org_id: str) -> dict:
    """Run the trained model on all images without manual annotations."""

    async def _run():
        import io
        from app.core.database import init_db
        await init_db()
        from beanie import PydanticObjectId
        from app.models.annotation import AnnotationProject, AnnotationShape
        from app.services.annotation_service import _download_bytes, _upload_bytes

        p = await AnnotationProject.find_one(
            AnnotationProject.id == PydanticObjectId(project_id)
        )
        if not p:
            return

        mv = next((v for v in p.model_versions if v.id == version_id), None)
        if not mv:
            logger.warning("annotate_predict_version_not_found", project_id=project_id, version_id=version_id)
            return

        # If Beanie didn't deserialise weights_key, read it directly from Motor
        weights_key = mv.weights_key
        if not weights_key:
            raw = await AnnotationProject.get_motor_collection().find_one(
                {"_id": p.id}, {"model_versions": 1}
            )
            if raw:
                for mv_raw in raw.get("model_versions", []):
                    if mv_raw.get("id") == version_id:
                        weights_key = mv_raw.get("weights_key")
                        break

        if not weights_key:
            logger.warning("annotate_predict_no_weights", project_id=project_id, version_id=version_id, mv_status=mv.status)
            mv.status = "ready"
            p.status = "collecting"
            p.updated_at = utc_now()
            await p.save()
            return

        # Download weights to temp file
        with tempfile.TemporaryDirectory() as tmp:
            weights_path = Path(tmp) / "model.pt"
            weights_data = await _download_bytes(weights_key)
            weights_path.write_bytes(weights_data)

            from ultralytics import YOLO
            model = YOLO(str(weights_path))

            to_predict = [i for i in p.images if not any(a.source == "manual" for a in i.annotations)]
            predicted_count = 0

            for img in to_predict:
                try:
                    data = await _download_bytes(img.s3_key)
                    from PIL import Image as PILImage
                    pil_img = PILImage.open(io.BytesIO(data))
                    w, h = pil_img.size
                    predictions = _infer(model, pil_img, w, h, p.classes)
                    img.annotations = predictions
                    img.status = "predicted" if predictions else "unannotated"
                    predicted_count += 1
                except Exception as e:
                    logger.warning("annotate_predict_image_failed", image_id=img.id, error=str(e))

            mv.status = "ready"
            p.status = "collecting"
            p.updated_at = utc_now()
            await p.save()
            logger.info("annotate_predict_done", project_id=project_id, predicted=predicted_count)

    _run_async(_run())
    return {"project_id": project_id, "version_id": version_id}


# ── single-image prediction task ───────────────────────────────────────────────

@celery_app.task(name="ml_studio.annotate_predict_single", bind=True, max_retries=0)
def annotate_predict_single_task(self, project_id: str, version_id: str, image_id: str, org_id: str) -> dict:
    """Run the trained model on a single image."""

    async def _run():
        import io
        from app.core.database import init_db
        await init_db()
        from beanie import PydanticObjectId
        from app.models.annotation import AnnotationProject, AnnotationShape
        from app.services.annotation_service import _download_bytes

        p = await AnnotationProject.find_one(
            AnnotationProject.id == PydanticObjectId(project_id)
        )
        if not p:
            return

        mv = next((v for v in p.model_versions if v.id == version_id), None)
        if not mv:
            return

        weights_key = mv.weights_key
        if not weights_key:
            raw = await AnnotationProject.get_motor_collection().find_one(
                {"_id": p.id}, {"model_versions": 1}
            )
            if raw:
                for mv_raw in raw.get("model_versions", []):
                    if mv_raw.get("id") == version_id:
                        weights_key = mv_raw.get("weights_key")
                        break
        if not weights_key:
            logger.warning("annotate_predict_single_no_weights", image_id=image_id, version_id=version_id)
            return

        img = next((i for i in p.images if i.id == image_id), None)
        if not img:
            return

        with tempfile.TemporaryDirectory() as tmp:
            weights_path = Path(tmp) / "model.pt"
            weights_data = await _download_bytes(weights_key)
            weights_path.write_bytes(weights_data)

            from ultralytics import YOLO
            model = YOLO(str(weights_path))

            try:
                data = await _download_bytes(img.s3_key)
                from PIL import Image as PILImage
                pil_img = PILImage.open(io.BytesIO(data))
                w, h = pil_img.size
                predictions = _infer(model, pil_img, w, h, p.classes)
                img.annotations = predictions
                img.status = "predicted" if predictions else "unannotated"
            except Exception as e:
                logger.warning("annotate_predict_single_failed", image_id=image_id, error=str(e))

            p.updated_at = utc_now()
            await p.save()

    _run_async(_run())
    return {"project_id": project_id, "image_id": image_id}
