"""
Sample: Instance Segmentation (YOLOv8-seg)
==========================================
Fine-tunes a pretrained YOLOv8-seg model to segment objects in images —
produces both bounding boxes AND pixel-level masks.

When to use segmentation vs. detection
---------------------------------------
• Object Detection  → you only need bounding boxes (faster, simpler data)
• Instance Segmen.  → you need exact pixel masks per object (more precise,
                       needs polygon annotations)

Quickstart
----------
1. Create a dataset with two fields:
      • image       — the photo (type: image)
      • annotations — segmentation labels in YOLO-seg format (type: text)

   YOLO-seg annotation format (one line per object):
       <class_idx> <x1> <y1> <x2> <y2> ... <xN> <yN>
   where (xi, yi) are normalised polygon vertices.  Example (rough box):
       0 0.10 0.20 0.50 0.20 0.50 0.80 0.10 0.80

   Tools to generate annotations:
       • Roboflow (roboflow.com)  — free tier, exports YOLO-seg format
       • Label Studio             — open-source, self-hostable
       • CVAT                     — open-source

2. Fill in the configuration block below.
3. Click ▶ Run.

Inference output
----------------
    {
      "detections": [
          {
              "label":      "leaf",
              "confidence": 0.88,
              "box":        [x1, y1, x2, y2],
              "mask_area":  12450          ← pixel count inside mask
          },
          ...
      ],
      "count": 2,
      "annotated_image_url": null   ← set SAVE_ANNOTATED = True to get S3 URL
    }
"""
# ── Configuration — edit these ─────────────────────────────────────────────────
DATASET_ID          = "PASTE_YOUR_DATASET_ID_HERE"
IMAGE_FIELD_ID      = "PASTE_IMAGE_FIELD_UUID_HERE"
ANNOTATION_FIELD_ID = "PASTE_ANNOTATION_FIELD_UUID_HERE"

CLASS_NAMES         = ["object_class_1", "object_class_2"]   # ← your classes

YOLO_MODEL          = "yolov8n-seg.pt"   # nano · yolov8s-seg.pt · yolov8m-seg.pt
EPOCHS              = 50
IMG_SIZE            = 640
CONFIDENCE_THRESH   = 0.25
IOU_THRESH          = 0.45

USE_LOCAL_DATASET   = False
LOCAL_DATASET_YAML  = "/tmp/yolo_seg_dataset/data.yaml"
# ──────────────────────────────────────────────────────────────────────────────

import io
import os
import shutil
import random
import requests
import yaml
from pathlib import Path
from PIL import Image

from app.abstract.base_trainer import BaseTrainer, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import DatasetDataSource, InMemoryDataSource


_TMP_DIR = Path("/tmp/yolo_seg_dataset")


class SampleImageSegmentation(BaseTrainer):
    name    = "image_segmentation"
    version = "1.0.0"
    description = "Instance segmentation — YOLOv8-seg fine-tuned on your dataset"
    framework   = "pytorch"
    category    = {"key": "segmentation", "label": "Segmentation"}

    output_display = [
        OutputFieldSpec("count",      "reading",   "Segments Found", primary=True,
                        hint="Enter the correct segment count"),
        OutputFieldSpec("detections", "bbox_list", "Detected Segments"),
    ]

    # Replace InMemoryDataSource with DatasetDataSource once you have a dataset:
    #   data_source = DatasetDataSource(dataset_id=DATASET_ID)
    data_source = InMemoryDataSource()

    input_schema = {
        "image_url": {
            "type":        "image_url",
            "label":       "Image URL",
            "description": "URL of the image to segment",
            "required":    True,
        }
    }
    output_schema = {
        "detections": {
            "type":  "json",
            "label": "Segmented Objects",
            "description": "List of {label, confidence, box, mask_area} per detected instance",
        },
        "count": {"type": "number", "label": "Instance Count"},
    }

    # ── Preprocess ─────────────────────────────────────────────────────────────
    def preprocess(self, raw: list) -> dict:
        """
        Builds a YOLO-seg directory layout under /tmp/yolo_seg_dataset/.
        Annotations must already be in YOLO polygon format (see docstring above).
        """
        if USE_LOCAL_DATASET:
            print(f"[preprocess] Using local dataset: {LOCAL_DATASET_YAML}")
            return {"yaml_path": LOCAL_DATASET_YAML}

        if not raw:
            raise ValueError(
                "No data. Set DATASET_ID / IMAGE_FIELD_ID / ANNOTATION_FIELD_ID "
                "or USE_LOCAL_DATASET = True."
            )

        collector_rows: dict = {}
        for entry in raw:
            key = entry.get("collector_id") or entry.get("entry_id", "?")
            collector_rows.setdefault(key, {})
            fid = entry["field_id"]
            collector_rows[key][fid] = entry.get("text_value") or entry.get("file_url")

        pairs = []
        for data in collector_rows.values():
            img_url  = data.get(IMAGE_FIELD_ID)
            ann_text = data.get(ANNOTATION_FIELD_ID, "")
            if img_url and ann_text:
                pairs.append((img_url, ann_text.strip()))

        if len(pairs) < 2:
            raise ValueError(f"Need ≥2 annotated images, found {len(pairs)}.")

        # Rebuild tmp dir
        if _TMP_DIR.exists():
            shutil.rmtree(_TMP_DIR)
        for split in ("train", "val"):
            (_TMP_DIR / "images" / split).mkdir(parents=True)
            (_TMP_DIR / "labels" / split).mkdir(parents=True)

        random.shuffle(pairs)
        split_at    = max(1, int(len(pairs) * 0.8))
        train_pairs = pairs[:split_at]
        val_pairs   = pairs[split_at:]

        def _write(split_pairs, split_name):
            for idx, (url, ann) in enumerate(split_pairs):
                stem = f"{split_name}_{idx:04d}"
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                img.save(_TMP_DIR / "images" / split_name / f"{stem}.jpg")
                with open(_TMP_DIR / "labels" / split_name / f"{stem}.txt", "w") as f:
                    f.write(ann + "\n")

        print(f"[preprocess] Downloading {len(train_pairs)} train / {len(val_pairs)} val images…")
        _write(train_pairs, "train")
        _write(val_pairs,   "val")

        yaml_path = _TMP_DIR / "data.yaml"
        with open(yaml_path, "w") as f:
            yaml.dump({
                "path":  str(_TMP_DIR),
                "train": "images/train",
                "val":   "images/val",
                "nc":    len(CLASS_NAMES),
                "names": CLASS_NAMES,
            }, f)

        print(f"[preprocess] Ready: {len(pairs)} images, {len(CLASS_NAMES)} classes")
        return {"yaml_path": str(yaml_path)}

    # ── Train ──────────────────────────────────────────────────────────────────
    def train(self, preprocessed: dict, config: TrainingConfig):
        from ultralytics import YOLO

        yaml_path = preprocessed["yaml_path"]
        print(f"[train] YOLOv8-seg fine-tune  model={YOLO_MODEL}  epochs={EPOCHS}")

        model = YOLO(YOLO_MODEL)
        model.train(
            data    = yaml_path,
            epochs  = EPOCHS,
            imgsz   = IMG_SIZE,
            batch   = -1,
            project = "/tmp/yolo_seg_runs",
            name    = "train",
            exist_ok= True,
        )

        metrics = model.val()
        print(
            f"[train] Box mAP50={metrics.box.map50:.4f}  "
            f"Mask mAP50={metrics.seg.map50:.4f}"
        )
        print("[train] ✓ Done")
        return {"model": model, "class_names": CLASS_NAMES}

    # ── Predict ────────────────────────────────────────────────────────────────
    def predict(self, bundle: dict, inputs: dict) -> dict:
        model       = bundle["model"]
        class_names = bundle.get("class_names", CLASS_NAMES)

        url = inputs.get("image_url")
        if not url:
            raise ValueError("Provide 'image_url' in inputs.")

        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")

        results = model.predict(source=img, conf=CONFIDENCE_THRESH, iou=IOU_THRESH, verbose=False)

        detections = []
        for r in results:
            # r.boxes contains bounding boxes; r.masks contains segmentation masks
            masks = r.masks  # may be None if no objects detected
            for i, box in enumerate(r.boxes):
                cls_idx = int(box.cls[0])
                det = {
                    "label":      class_names[cls_idx] if cls_idx < len(class_names) else str(cls_idx),
                    "confidence": round(float(box.conf[0]), 4),
                    "box":        [round(v, 1) for v in box.xyxy[0].tolist()],
                    "mask_area":  None,
                }
                # Compute mask area in pixels if mask is available
                if masks is not None and i < len(masks.data):
                    mask_tensor = masks.data[i]
                    det["mask_area"] = int(mask_tensor.sum().item())
                detections.append(det)

        return {"detections": detections, "count": len(detections)}

    def get_feature_names(self):
        return ["image_url"]
