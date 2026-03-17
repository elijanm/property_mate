"""
Water Meter OCR via Roboflow serverless inference.

No local model file required — all detection runs on Roboflow's cloud API.
The config.json artifact carries the api_url and model_id.

Set ROBOFLOW_API_KEY env var (or pass api_key in inputs) to authenticate.

Input:
    {
        "image_b64":            "<base64 JPEG/PNG>",
        "reference":            "MTR-001",
        "confidence_threshold": 0.5,
        "api_key":              "optional-override"   // falls back to ROBOFLOW_API_KEY env var
    }

Output:
    {
        "reference":       "MTR-001",
        "reading":         "04823",
        "confidence_avg":  0.91,
        "digit_count":     5,
        "detections":      [...],
        "original_url":    "https://...",
        "annotated_url":   "https://..."
    }
"""
import base64
import io
import json
import os
from datetime import datetime, timezone

import mlflow.pyfunc


def _utc_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class WaterMeterOCR(mlflow.pyfunc.PythonModel):
    # Declare how predict() output should be displayed in the ML Studio UI.
    # The schema endpoint and InferenceResultRenderer use this spec.
    output_display = [
        {"key": "annotated_url",    "type": "image",      "label": "Annotated Image",   "primary": False, "hint": "", "span": 1},
        {"key": "original_url",     "type": "image",      "label": "Original Image",    "primary": False, "hint": "", "span": 1},
        {"key": "reading",          "type": "reading",    "label": "Meter Reading",      "primary": True,  "hint": "Enter the correct meter reading (digits only)", "span": 2},
        {"key": "confidence_avg",   "type": "confidence", "label": "Confidence",         "primary": False, "hint": "", "span": 1},
        {"key": "digit_count",      "type": "reading",    "label": "Digits Detected",    "primary": False, "hint": "", "span": 1},
        {"key": "detections",       "type": "json",       "label": "Detection Details",  "primary": False, "hint": "", "span": 2},
    ]
    derived_metrics = [
        {"key": "exact_match",    "label": "Exact Match Rate",  "description": "% of readings fully correct",               "unit": "%",     "higher_is_better": True,  "category": "accuracy"},
        {"key": "digit_accuracy", "label": "Digit Accuracy",    "description": "Per-character digit position accuracy",     "unit": "%",     "higher_is_better": True,  "category": "accuracy"},
        {"key": "edit_distance",  "label": "Edit Distance",     "description": "Mean Levenshtein distance (lower = better)", "unit": "chars", "higher_is_better": False, "category": "error"},
        {"key": "numeric_delta",  "label": "Billing Impact",    "description": "Mean abs(predicted − actual) in units",     "unit": "units", "higher_is_better": False, "category": "financial"},
    ]

    def load_context(self, context):
        with open(context.artifacts["model_file"]) as f:
            cfg = json.load(f)

        self.api_url  = cfg.get("api_url", "https://serverless.roboflow.com")
        self.model_id = cfg.get("model_id", "utility-meter-reading-dataset-for-automatic-reading-yolo/1")

        # S3 config for saving images
        self.bucket             = os.environ.get("S3_BUCKET")             or "pms-ml"
        self.s3_endpoint        = os.environ.get("S3_ENDPOINT_URL")       or "http://minio:9000"
        self.s3_public_endpoint = (os.environ.get("S3_PUBLIC_ENDPOINT_URL") or self.s3_endpoint).rstrip("/")
        self.s3_access_key      = os.environ.get("S3_ACCESS_KEY")         or "minioadmin"
        self.s3_secret_key      = os.environ.get("S3_SECRET_KEY")         or "minioadmin"
        self.s3_region          = os.environ.get("S3_REGION")             or "us-east-1"
        self.roboflow_api_key   = os.environ.get("ROBOFLOW_API_KEY")      or ""

    def predict(self, context, model_input):
        row             = self._to_dict(model_input)
        image_b64       = row.get("image_b64", "")
        reference       = str(row.get("reference", "unknown"))
        conf_thresh     = float(row.get("confidence_threshold", 0.5))
        api_key         = row.get("api_key") or self.roboflow_api_key

        if not image_b64:
            return {"error": "image_b64 is required"}
        if not api_key:
            return {"error": "ROBOFLOW_API_KEY env var not set and no api_key in inputs"}

        image_bytes = base64.b64decode(image_b64)

        # ── save original (raw bytes, no re-encode) ─────────────────────────────
        ts = _utc_ts()
        original_key = f"ocr/water-meter/{reference}/{ts}_original.jpg"
        original_url = self._upload_and_sign(
            key=original_key,
            data=image_bytes,
            content_type="image/jpeg",
        )

        # ── call Roboflow ───────────────────────────────────────────────────────
        from inference_sdk import InferenceHTTPClient

        client = InferenceHTTPClient(api_url=self.api_url, api_key=api_key)

        # InferenceHTTPClient accepts a PIL Image, numpy array, file path, or URL.
        # Pass a PIL Image decoded from the bytes.
        from PIL import Image as PILImage
        pil_img = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")

        raw = client.infer(pil_img, model_id=self.model_id)

        # ── parse predictions ───────────────────────────────────────────────────
        predictions = raw.get("predictions", []) if isinstance(raw, dict) else []
        detections = []
        for pred in predictions:
            score = float(pred.get("confidence", 0))
            if score < conf_thresh:
                continue
            x, y = pred.get("x", 0), pred.get("y", 0)
            w, h = pred.get("width", 0), pred.get("height", 0)
            x1, y1 = int(x - w / 2), int(y - h / 2)
            x2, y2 = int(x + w / 2), int(y + h / 2)
            cls_name = str(pred.get("class", ""))
            detections.append({
                "bbox":       [x1, y1, x2, y2],
                "class_name": cls_name,
                "score":      round(score, 4),
            })

        if not detections:
            return {
                "reference":      reference,
                "reading":        "",
                "confidence_avg": 0.0,
                "digit_count":    0,
                "detections":     [],
                "original_url":   original_url,
                "original_key":   original_key,
                "annotated_url":  None,
                "message":        "No digits detected — check image quality or lower confidence_threshold",
            }

        # Sort left → right by x1
        detections.sort(key=lambda d: d["bbox"][0])
        reading  = "".join(d["class_name"] for d in detections)
        avg_conf = round(sum(d["score"] for d in detections) / len(detections), 3)

        # ── annotate and save ───────────────────────────────────────────────────
        annotated_key = f"ocr/water-meter/{reference}/{ts}_annotated.jpg"
        annotated_url = self._upload_and_sign(
            key=annotated_key,
            data=self._annotate(pil_img, detections),
            content_type="image/jpeg",
        )

        return {
            "reference":      reference,
            "reading":        reading,
            "confidence_avg": avg_conf,
            "digit_count":    len(detections),
            "detections":     detections,
            "original_url":   original_url,
            "original_key":   original_key,
            "annotated_url":  annotated_url,
            "annotated_key":  annotated_key,
        }

    # ── helpers ─────────────────────────────────────────────────────────────────

    def _to_dict(self, model_input) -> dict:
        if hasattr(model_input, "to_dict"):
            return model_input.iloc[0].to_dict() if len(model_input) else {}
        return dict(model_input)

    def _annotate(self, pil_img, detections) -> bytes:
        from PIL import ImageDraw
        img = pil_img.copy()
        draw = ImageDraw.Draw(img)
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            draw.rectangle([x1, y1, x2, y2], outline=(0, 120, 255), width=2)
            draw.text((x1, max(y1 - 14, 0)), det["class_name"], fill=(0, 120, 255))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return buf.getvalue()

    def _upload_and_sign(self, key: str, data: bytes, content_type: str, expiry: int = 3600) -> str:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=self.s3_endpoint,
            aws_access_key_id=self.s3_access_key,
            aws_secret_access_key=self.s3_secret_key,
            region_name=self.s3_region,
        )
        s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

        return boto3.client(
            "s3",
            endpoint_url=self.s3_public_endpoint,
            aws_access_key_id=self.s3_access_key,
            aws_secret_access_key=self.s3_secret_key,
            region_name=self.s3_region,
        ).generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expiry,
        )
