# @trainer
# Name: Object Detector
# Version: 1.0.0
# Author: Mldock Team
# Author Email: hello@mldock.io
# Author URL: https://mldock.io
# Description: Custom object detector using YOLOv8 fine-tuned on your labeled bounding box dataset
# Commercial: public
# Downloadable: true
# Protect Model: false
# Icon: dataset:object-detection-data
# License: MIT
# Tags: detection, image, pytorch, yolo

"""
Sample: Object Detector (YOLOv8)
=================================
Fine-tunes a pretrained YOLOv8 model to detect custom objects in images.

Quickstart
----------
1. Create a dataset in ML Studio with two fields:
      • image       — the photo (type: image)
      • annotations — bounding-box labels in YOLO format (type: text)

   YOLO annotation format (one line per object in the image):
       <class_idx> <cx> <cy> <width> <height>
   All values normalised 0–1. Example for a single cat in a 640×480 image:
       0 0.5 0.5 0.3 0.4

2. Define your class names in CLASS_NAMES below.
3. Set DATASET_ID, IMAGE_FIELD_ID, ANNOTATION_FIELD_ID.
4. Click ▶ Run.

Dataset alternative
-------------------
If you already have a YOLO-format dataset folder, set USE_LOCAL_DATASET = True
and point LOCAL_DATASET_YAML to your data.yaml file.  preprocess() will be
skipped and train() will use the path directly.

After training
--------------
The model is registered in MLflow.  Run inference at:
    POST /api/v1/inference/object_detector
    { "image_url": "https://..." }

Inference output
----------------
    {
      "detections": [
          {
              "label":      "maize_cob",
              "confidence": 0.91,
              "box":        [x1, y1, x2, y2]   ← pixel coords
          },
          ...
      ],
      "count": 3
    }
"""
# ── Configuration — edit these ─────────────────────────────────────────────────
DATASET_ID          = "PASTE_YOUR_DATASET_ID_HERE"
IMAGE_FIELD_ID      = "PASTE_IMAGE_FIELD_UUID_HERE"
ANNOTATION_FIELD_ID = "PASTE_ANNOTATION_FIELD_UUID_HERE"

CLASS_NAMES         = ["object_class_1", "object_class_2"]   # ← your classes

YOLO_MODEL          = "yolov8n.pt"    # nano (fastest) · yolov8s.pt · yolov8m.pt · yolov8l.pt
EPOCHS              = 50
IMG_SIZE            = 640
CONFIDENCE_THRESH   = 0.25           # detections below this score are discarded
IOU_THRESH          = 0.45           # NMS IoU threshold

# Set to True + fill LOCAL_DATASET_YAML to skip DatasetDataSource entirely
USE_LOCAL_DATASET   = False
LOCAL_DATASET_YAML  = "/tmp/yolo_dataset/data.yaml"
# ──────────────────────────────────────────────────────────────────────────────

import io
import os
import shutil
import random
import requests
import yaml
from pathlib import Path
from PIL import Image

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import DatasetDataSource, InMemoryDataSource


_TMP_DIR = Path("/tmp/yolo_detect_dataset")


class SampleObjectDetector(BaseTrainer):
    name    = "object_detector"
    version = "1.0.0"
    description = "Custom object detector — YOLOv8 fine-tuned on your dataset"
    framework   = "pytorch"
    category    = {"key": "detection", "label": "Object Detection"}

    output_display = [
        OutputFieldSpec("count",      "reading",    "Objects Detected", primary=True,
                        hint="Enter the correct object count"),
        OutputFieldSpec("detections", "bbox_list",  "Detections"),
    ]

    # Replace InMemoryDataSource with DatasetDataSource once you have a dataset:
    #   data_source = DatasetDataSource(dataset_id=DATASET_ID)
    data_source = InMemoryDataSource()

    input_schema = {
        "image_url": {
            "type":        "image_url",
            "label":       "Image URL",
            "description": "URL of the image to run detection on",
            "required":    True,
        }
    }
    output_schema = {
        "detections": {
            "type":  "json",
            "label": "Detected Objects",
            "description": "List of {label, confidence, box} dicts",
        },
        "count": {
            "type":  "number",
            "label": "Object Count",
        },
    }

    # ── Preprocess ─────────────────────────────────────────────────────────────
    def preprocess(self, raw: list) -> dict:
        """
        Downloads images from DatasetDataSource and builds a YOLO-format
        directory structure under /tmp/yolo_detect_dataset/:

            /tmp/yolo_detect_dataset/
              images/train/  ← .jpg files
              images/val/
              labels/train/  ← .txt YOLO annotation files
              labels/val/
              data.yaml

        Returns the path to data.yaml.
        """
        if USE_LOCAL_DATASET:
            print(f"[preprocess] Using local dataset: {LOCAL_DATASET_YAML}")
            return {"yaml_path": LOCAL_DATASET_YAML}

        if not raw:
            raise ValueError(
                "No data found. Set DATASET_ID / IMAGE_FIELD_ID / ANNOTATION_FIELD_ID "
                "or set USE_LOCAL_DATASET = True."
            )

        # Pivot by collector_id
        collector_rows: dict = {}
        for entry in raw:
            key = entry.get("collector_id") or entry.get("entry_id", "?")
            collector_rows.setdefault(key, {})
            fid = entry["field_id"]
            collector_rows[key][fid] = entry.get("text_value") or entry.get("file_url")

        pairs = []   # [(image_url, annotation_text), ...]
        for data in collector_rows.values():
            img_url   = data.get(IMAGE_FIELD_ID)
            ann_text  = data.get(ANNOTATION_FIELD_ID, "")
            if img_url and ann_text:
                pairs.append((img_url, ann_text.strip()))

        if len(pairs) < 2:
            raise ValueError(
                f"Only {len(pairs)} annotated image(s). Need ≥2. "
                "Collect more data or add annotation text to existing images."
            )

        # Clear and rebuild tmp dir
        if _TMP_DIR.exists():
            shutil.rmtree(_TMP_DIR)
        for split in ("train", "val"):
            (_TMP_DIR / "images" / split).mkdir(parents=True)
            (_TMP_DIR / "labels" / split).mkdir(parents=True)

        # 80/20 split
        random.shuffle(pairs)
        split_at    = max(1, int(len(pairs) * 0.8))
        train_pairs = pairs[:split_at]
        val_pairs   = pairs[split_at:]

        def _write_split(split_pairs, split_name):
            for idx, (url, ann) in enumerate(split_pairs):
                stem = f"{split_name}_{idx:04d}"
                # Download image
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                img.save(_TMP_DIR / "images" / split_name / f"{stem}.jpg")
                # Write annotation file
                with open(_TMP_DIR / "labels" / split_name / f"{stem}.txt", "w") as f:
                    f.write(ann + "\n")

        print(f"[preprocess] Downloading {len(train_pairs)} train / {len(val_pairs)} val images…")
        _write_split(train_pairs, "train")
        _write_split(val_pairs,   "val")

        # Write data.yaml
        yaml_path = _TMP_DIR / "data.yaml"
        yaml_content = {
            "path":  str(_TMP_DIR),
            "train": "images/train",
            "val":   "images/val",
            "nc":    len(CLASS_NAMES),
            "names": CLASS_NAMES,
        }
        with open(yaml_path, "w") as f:
            yaml.dump(yaml_content, f)

        print(f"[preprocess] Dataset ready: {len(pairs)} images, {len(CLASS_NAMES)} classes")
        return {"yaml_path": str(yaml_path)}

    # ── Train ──────────────────────────────────────────────────────────────────
    def train(self, preprocessed: dict, config: TrainingConfig):
        from ultralytics import YOLO

        yaml_path = preprocessed["yaml_path"]
        print(f"[train] Starting YOLOv8 fine-tune on {yaml_path}")
        print(f"[train] Model={YOLO_MODEL}  epochs={EPOCHS}  imgsz={IMG_SIZE}")

        model = YOLO(YOLO_MODEL)
        results = model.train(
            data    = yaml_path,
            epochs  = EPOCHS,
            imgsz   = IMG_SIZE,
            batch   = -1,          # auto batch size
            project = "/tmp/yolo_detect_runs",
            name    = "train",
            exist_ok= True,
            verbose = True,
        )

        # Validate on val split
        metrics = model.val()
        print(f"[train] mAP50={metrics.box.map50:.4f}  mAP50-95={metrics.box.map:.4f}")
        print("[train] ✓ Training complete")
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

        results = model.predict(
            source = img,
            conf   = CONFIDENCE_THRESH,
            iou    = IOU_THRESH,
            verbose= False,
        )

        detections = []
        for r in results:
            for box in r.boxes:
                cls_idx = int(box.cls[0])
                detections.append({
                    "label":      class_names[cls_idx] if cls_idx < len(class_names) else str(cls_idx),
                    "confidence": round(float(box.conf[0]), 4),
                    "box":        [round(v, 1) for v in box.xyxy[0].tolist()],  # [x1,y1,x2,y2]
                })

        return {"detections": detections, "count": len(detections)}

    def get_feature_names(self):
        return ["image_url"]
