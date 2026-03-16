"""
Kenyan License Plate Detector
==============================
Detects and reads Kenyan vehicle license plates from images using:
  • YOLOv8  — plate localisation (bounding-box detection)
  • EasyOCR — character recognition on the cropped plate region

Kenyan plate format: KAA 000A  (3 letters · space · 3 digits · 1 letter)
Examples: KDA 123A · KCB 456Z · KAA 001B

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUICKSTART
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Prepare your dataset ZIP (see "Dataset format" below).
2. Open the Dataset page → upload the ZIP to the auto-created
   "Kenyan Plate Dataset" dataset (field: "Dataset ZIP").
3. Click ▶ Run in the trainer.
4. After training, run inference at:

   POST /api/v1/inference/kenyan_plate_detector
   Content-Type: application/json
   { "image_b64": "<base64-encoded JPEG/PNG>" }

   — or —
   { "image_url": "https://your-cdn.com/car.jpg" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATASET FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Upload a single ZIP file with the following layout:

    plates_dataset.zip
    ├── images/
    │   ├── train/
    │   │   ├── car001.jpg
    │   │   ├── car002.jpg
    │   │   └── ...
    │   └── val/        ← optional; trainer auto-splits if absent
    │       └── ...
    ├── labels/
    │   ├── train/
    │   │   ├── car001.txt   ← YOLO annotation (one plate per line)
    │   │   └── ...
    │   └── val/
    │       └── ...
    └── data.yaml            ← optional; auto-generated if absent

YOLO annotation format  (one object per line, values 0–1 normalised):
    <class_idx> <centre_x> <centre_y> <width> <height>

Since we have only one class (license_plate), class_idx is always 0:
    0 0.512 0.723 0.281 0.062

Minimum recommended: 200 annotated images (more = better accuracy).

Tips
----
• Capture plates in varied lighting (day/night/rain/shade).
• Include partial occlusions and different distances.
• Use Roboflow, LabelImg, or CVAT to annotate; export in "YOLO v8" format.
• A free Roboflow Kenyan plates export already matches this format.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFERENCE OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "plates": [
    {
      "plate_text":   "KDA 123A",      // OCR result (normalised to Kenyan format)
      "raw_ocr":      "KDA123A",       // un-normalised OCR string
      "confidence":   0.94,            // YOLO detection confidence
      "box":          [x1, y1, x2, y2] // pixel coordinates in original image
    }
  ],
  "count": 1
}
"""
# ── Configuration — edit these ──────────────────────────────────────────────────
YOLO_MODEL          = "yolov8n.pt"    # nano (fastest) · yolov8s.pt · yolov8m.pt
EPOCHS              = 80
IMG_SIZE            = 640
CONFIDENCE_THRESH   = 0.30            # YOLO detections below this are discarded
IOU_THRESH          = 0.45            # NMS IoU threshold
PLATE_EXPAND_PX     = 4               # pixels to pad around plate crop before OCR
# ───────────────────────────────────────────────────────────────────────────────

import base64
import io
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import DatasetDataSource


_TMP_DIR    = Path("/tmp/kplates_dataset")
_CLASS_NAMES = ["license_plate"]


class KenyanPlateDetector(BaseTrainer):
    """
    Kenyan vehicle license plate detector + OCR.

    Clone this trainer to your workspace — the dataset is auto-created on
    first run so you only need to upload a ZIP and click Run.
    """

    name        = "kenyan_plate_detector"
    version     = "1.0.0"
    description = (
        "Detects Kenyan license plates in vehicle images (YOLOv8) "
        "and reads the plate text via EasyOCR. "
        "Expected plate format: KAA 000A."
    )
    framework   = "pytorch"
    category    = {"key": "detection", "label": "Object Detection"}

    # ── Dataset: auto-created on first run ─────────────────────────────────────
    data_source = DatasetDataSource(
        slug="kenyan-plate-dataset",
        auto_create_spec={
            "name": "Kenyan Plate Dataset",
            "description": (
                "Upload a ZIP of YOLO-annotated license plate images. "
                "See trainer comments for exact folder layout and annotation format."
            ),
            "category": "training",
            "fields": [
                {
                    "label": "Dataset ZIP",
                    "type": "file",
                    "instruction": (
                        "Upload a ZIP containing images/ and labels/ folders "
                        "in YOLO format. One class only: license_plate (index 0). "
                        "See trainer docstring for full layout."
                    ),
                    "capture_mode": "upload_only",
                    "required": True,
                }
            ],
        },
    )

    # ── UI schemas ─────────────────────────────────────────────────────────────
    input_schema = {
        "image_b64": {
            "type":        "image_b64",
            "label":       "Image (base64)",
            "description": "Base64-encoded JPEG or PNG of the vehicle",
            "required":    False,
        },
        "image_url": {
            "type":        "image_url",
            "label":       "Image URL",
            "description": "Publicly accessible URL of the vehicle photo",
            "required":    False,
        },
    }
    output_schema = {
        "plates": {
            "type":  "json",
            "label": "Detected Plates",
            "description": "List of {plate_text, raw_ocr, confidence, box} dicts",
        },
        "count": {
            "type":  "number",
            "label": "Plate Count",
        },
    }

    # ── Preprocess: unzip dataset + build YOLO directory ───────────────────────

    def preprocess(self, raw: list) -> dict:
        """
        Extracts the uploaded ZIP, validates the YOLO layout, generates
        data.yaml if missing, and returns {"yaml_path": str}.
        """
        if not raw:
            raise ValueError(
                "No dataset entries found. "
                "Upload a ZIP file to the 'Kenyan Plate Dataset' dataset first."
            )

        # Find the ZIP entry
        zip_bytes: Optional[bytes] = None
        for entry in raw:
            field_type = entry.get("field_type", "")
            file_key   = entry.get("file_key") or ""
            file_url   = entry.get("file_url") or ""
            mime       = entry.get("file_mime") or ""

            if field_type == "file" or mime in ("application/zip", "application/x-zip-compressed"):
                zip_bytes = self._fetch_bytes(file_key, file_url)
                if zip_bytes:
                    break

        if not zip_bytes:
            raise ValueError(
                "No ZIP file found in the dataset entries. "
                "Please upload a ZIP with YOLO-format images and labels."
            )

        # Extract ZIP
        if _TMP_DIR.exists():
            shutil.rmtree(_TMP_DIR)
        _TMP_DIR.mkdir(parents=True)

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(_TMP_DIR)
            print(f"[preprocess] Extracted {len(zf.namelist())} files to {_TMP_DIR}")

        # Normalise: some ZIPs have a single top-level folder
        contents = list(_TMP_DIR.iterdir())
        if len(contents) == 1 and contents[0].is_dir():
            root = contents[0]
        else:
            root = _TMP_DIR

        images_dir = root / "images"
        labels_dir = root / "labels"

        if not images_dir.exists():
            raise ValueError(
                "ZIP must contain an 'images/' folder. "
                "Expected layout: images/train/, labels/train/ (and optionally /val/). "
                "See trainer docstring for details."
            )
        if not labels_dir.exists():
            raise ValueError(
                "ZIP must contain a 'labels/' folder with YOLO .txt annotation files."
            )

        # If val split is missing, auto-create it from 20% of train images
        train_imgs = list((images_dir / "train").glob("*")) if (images_dir / "train").exists() else []
        val_imgs   = list((images_dir / "val").glob("*"))   if (images_dir / "val").exists()   else []

        if train_imgs and not val_imgs:
            print("[preprocess] No val/ split found — auto-splitting 20% from train…")
            self._auto_split(images_dir, labels_dir)

        # Check/generate data.yaml
        yaml_path = root / "data.yaml"
        if not yaml_path.exists():
            self._write_yaml(root, images_dir, labels_dir, yaml_path)

        n_train = len(list((images_dir / "train").glob("*.jpg")) + list((images_dir / "train").glob("*.png")))
        n_val   = len(list((images_dir / "val").glob("*.jpg"))   + list((images_dir / "val").glob("*.png")))
        print(f"[preprocess] Dataset ready: {n_train} train / {n_val} val images")

        return {"yaml_path": str(yaml_path)}

    # ── Train ──────────────────────────────────────────────────────────────────

    def train(self, preprocessed: dict, config: TrainingConfig):
        from ultralytics import YOLO

        yaml_path = preprocessed["yaml_path"]
        device    = self._resolve_device(config)

        print(f"[train] YOLOv8 fine-tune on {yaml_path}")
        print(f"[train] Model={YOLO_MODEL}  epochs={EPOCHS}  imgsz={IMG_SIZE}  device={device}")

        model = YOLO(YOLO_MODEL)
        model.train(
            data     = yaml_path,
            epochs   = EPOCHS,
            imgsz    = IMG_SIZE,
            batch    = -1,           # auto batch size based on GPU VRAM
            device   = device,
            project  = "/tmp/kplates_runs",
            name     = "train",
            exist_ok = True,
            verbose  = True,
        )

        metrics = model.val()
        map50    = getattr(getattr(metrics, "box", None), "map50", None)
        map5095  = getattr(getattr(metrics, "box", None), "map", None)
        if map50 is not None:
            print(f"[train] mAP50={map50:.4f}  mAP50-95={map5095:.4f}")
        print("[train] ✓ Training complete")

        return {"model": model, "class_names": _CLASS_NAMES}

    # ── Evaluate ───────────────────────────────────────────────────────────────

    def evaluate(self, bundle: dict, test_data=None) -> EvaluationResult:
        model = bundle["model"]
        metrics = model.val()
        box     = getattr(metrics, "box", None)
        return EvaluationResult(
            precision          = round(float(box.mp),    4) if box else None,
            recall             = round(float(box.mr),    4) if box else None,
            extra_metrics      = {
                "mAP50":    round(float(box.map50), 4) if box else 0.0,
                "mAP50_95": round(float(box.map),   4) if box else 0.0,
            },
        )

    # ── Predict ────────────────────────────────────────────────────────────────

    def predict(self, bundle: dict, inputs: dict) -> dict:
        """
        Inputs (one of):
          • image_b64 — base64-encoded JPEG/PNG string
          • image_url — public HTTPS URL

        Returns:
          { "plates": [{plate_text, raw_ocr, confidence, box}], "count": N }
        """
        from PIL import Image

        model       = bundle["model"]
        class_names = bundle.get("class_names", _CLASS_NAMES)

        # ── Load image ────────────────────────────────────────────────────────
        img = self._load_image(inputs)
        img_w, img_h = img.size

        # ── YOLO detection ────────────────────────────────────────────────────
        results = model.predict(
            source  = img,
            conf    = CONFIDENCE_THRESH,
            iou     = IOU_THRESH,
            verbose = False,
        )

        plates = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = [round(v, 1) for v in box.xyxy[0].tolist()]
                confidence      = round(float(box.conf[0]), 4)

                # Crop plate region with small padding
                cx1 = max(0, int(x1) - PLATE_EXPAND_PX)
                cy1 = max(0, int(y1) - PLATE_EXPAND_PX)
                cx2 = min(img_w, int(x2) + PLATE_EXPAND_PX)
                cy2 = min(img_h, int(y2) + PLATE_EXPAND_PX)
                crop = img.crop((cx1, cy1, cx2, cy2))

                # ── EasyOCR ───────────────────────────────────────────────────
                raw_ocr, plate_text = self._ocr_plate(crop)

                plates.append({
                    "plate_text": plate_text,
                    "raw_ocr":    raw_ocr,
                    "confidence": confidence,
                    "box":        [x1, y1, x2, y2],
                })

        return {"plates": plates, "count": len(plates)}

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _load_image(inputs: dict):
        """Load PIL image from base64 string or URL."""
        from PIL import Image

        b64 = inputs.get("image_b64")
        url = inputs.get("image_url")

        if b64:
            # Strip optional data URI prefix: data:image/jpeg;base64,...
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            raw = base64.b64decode(b64)
            return Image.open(io.BytesIO(raw)).convert("RGB")

        if url:
            import requests
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")

        raise ValueError("Provide either 'image_b64' or 'image_url' in inputs.")

    @staticmethod
    def _ocr_plate(crop) -> tuple[str, str]:
        """
        Run EasyOCR on a cropped plate image.
        Returns (raw_ocr, normalised_plate_text).

        Normalised format: KAA 000A (upper-case, space inserted after 3rd char).
        """
        try:
            import easyocr
            import numpy as np

            reader = easyocr.Reader(["en"], gpu=False, verbose=False)
            ocr_results = reader.readtext(
                np.array(crop),
                detail=0,
                paragraph=False,
                allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
            )
            raw = " ".join(ocr_results).upper().replace(" ", "").strip()
        except ImportError:
            # EasyOCR not installed — return empty OCR result gracefully
            return "", ""

        # Normalise to Kenyan format: KAA 000A → 3 letters + 3 digits + 1 letter
        normalised = _normalise_kenyan_plate(raw)
        return raw, normalised

    @staticmethod
    def _fetch_bytes(file_key: str, file_url: str) -> Optional[bytes]:
        """Download file bytes from S3 key (preferred) or public URL."""
        if file_key:
            try:
                import asyncio
                import aioboto3
                from app.core.config import settings as _s

                async def _get():
                    session = aioboto3.Session()
                    async with session.client(
                        "s3",
                        endpoint_url    = _s.S3_ENDPOINT_URL,
                        aws_access_key_id     = _s.S3_ACCESS_KEY,
                        aws_secret_access_key = _s.S3_SECRET_KEY,
                    ) as s3:
                        resp = await s3.get_object(Bucket=_s.S3_BUCKET, Key=file_key)
                        return await resp["Body"].read()

                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                            future = ex.submit(asyncio.run, _get())
                            return future.result()
                    return loop.run_until_complete(_get())
                except RuntimeError:
                    return asyncio.run(_get())
            except Exception as exc:
                print(f"[preprocess] S3 fetch failed ({exc}), falling back to URL…")

        if file_url:
            try:
                import requests
                resp = requests.get(file_url, timeout=120)
                resp.raise_for_status()
                return resp.content
            except Exception as exc:
                print(f"[preprocess] URL fetch failed: {exc}")

        return None

    @staticmethod
    def _auto_split(images_dir: Path, labels_dir: Path, val_pct: float = 0.2) -> None:
        """Move val_pct of train images+labels into val/ sub-folder."""
        import random

        (images_dir / "val").mkdir(exist_ok=True)
        (labels_dir / "val").mkdir(exist_ok=True)

        train_imgs = sorted(
            list((images_dir / "train").glob("*.jpg"))
            + list((images_dir / "train").glob("*.png"))
        )
        random.Random(42).shuffle(train_imgs)
        n_val = max(1, int(len(train_imgs) * val_pct))

        for img_path in train_imgs[:n_val]:
            # Move image
            (images_dir / "val" / img_path.name).write_bytes(img_path.read_bytes())
            img_path.unlink()
            # Move matching label
            lbl_src = labels_dir / "train" / (img_path.stem + ".txt")
            lbl_dst = labels_dir / "val"   / (img_path.stem + ".txt")
            if lbl_src.exists():
                lbl_dst.write_bytes(lbl_src.read_bytes())
                lbl_src.unlink()

        print(f"[preprocess] Auto-split: moved {n_val} images → val/")

    @staticmethod
    def _write_yaml(root: Path, images_dir: Path, labels_dir: Path, yaml_path: Path) -> None:
        """Generate a minimal data.yaml for YOLO training."""
        import yaml

        content = {
            "path":  str(root),
            "train": str(images_dir / "train"),
            "val":   str(images_dir / "val"),
            "nc":    1,
            "names": _CLASS_NAMES,
        }
        with open(yaml_path, "w") as f:
            yaml.dump(content, f, default_flow_style=False)
        print(f"[preprocess] Generated data.yaml at {yaml_path}")


# ── Kenyan plate normalisation helper ─────────────────────────────────────────

# Standard Kenyan civilian plates: K + 2 letters + space + 3 digits + 1 letter
# e.g. KDA 123A  KCB 456Z  KAA 001B
_PLATE_RE = re.compile(r"^(K[A-Z]{2})(\d{3})([A-Z])$")


def _normalise_kenyan_plate(raw: str) -> str:
    """
    Attempt to normalise an OCR string into standard Kenyan plate format KAA 000A.
    Returns the normalised string, or the original (upper-cased) if it doesn't match.
    """
    # Strip whitespace + common OCR noise characters
    cleaned = re.sub(r"[^A-Z0-9]", "", raw.upper())

    m = _PLATE_RE.match(cleaned)
    if m:
        return f"{m.group(1)} {m.group(2)}{m.group(3)}"

    # Fallback: insert space after position 3 if we have 7 chars (KAA000A → KAA 000A)
    if len(cleaned) == 7 and cleaned[:3].isalpha() and cleaned[3:6].isdigit() and cleaned[6].isalpha():
        return f"{cleaned[:3]} {cleaned[3:]}"

    # Return best-effort upper-cased OCR if format is unrecognised
    return raw.upper() if raw else ""
