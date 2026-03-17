"""
Water Meter OCR — inference entry point.

Accepts a base64-encoded meter image and returns the digit reading
plus annotated images saved to MinIO.

Input (POST /api/v1/inference/water-meter-ocr):
    {
        "inputs": {
            "image_b64":            "<base64-encoded JPEG/PNG>",
            "reference":            "MTR-001",         // meter serial / unit code
            "confidence_threshold": 0.5                // optional, default 0.5
        }
    }

Output:
    {
        "reference":       "MTR-001",
        "reading":         "04823",
        "confidence_avg":  0.912,
        "digit_count":     5,
        "detections":      [ { "bbox": [...], "class_id": 4, "score": 0.97 }, ... ],
        "original_url":    "http://localhost:9000/...",   // presigned, 1h expiry
        "annotated_url":   "http://localhost:9000/..."    // presigned, 1h expiry
    }

On no detections:
    { "reading": "", "confidence_avg": 0.0, "message": "No digits detected", ... }
"""
import base64
import io
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

    # ── lifecycle ──────────────────────────────────────────────────────────────

    def load_context(self, context):
        from ultralytics import YOLO

        self.model = YOLO(context.artifacts["model_file"])
        self.digit_labels = [str(i) for i in range(10)]

        # S3 credentials resolved once at load time
        self.bucket            = os.environ.get("S3_BUCKET")            or "pms-ml"
        self.s3_endpoint       = os.environ.get("S3_ENDPOINT_URL")      or "http://minio:9000"
        self.s3_public_endpoint = (
            os.environ.get("S3_PUBLIC_ENDPOINT_URL") or self.s3_endpoint
        ).rstrip("/")
        self.s3_access_key  = os.environ.get("S3_ACCESS_KEY")  or "minioadmin"
        self.s3_secret_key  = os.environ.get("S3_SECRET_KEY")  or "minioadmin"
        self.s3_region      = os.environ.get("S3_REGION")      or "us-east-1"

    # ── inference ──────────────────────────────────────────────────────────────

    def predict(self, context, model_input):
        import cv2
        import numpy as np

        row = self._to_dict(model_input)
        image_b64  = row.get("image_b64", "")
        reference  = str(row.get("reference", "unknown"))
        conf_thresh = float(row.get("confidence_threshold", 0.5))

        if not image_b64:
            return {"error": "image_b64 is required"}

        # Decode image
        image_bytes = base64.b64decode(image_b64)
        npimg = np.frombuffer(image_bytes, np.uint8)
        img_orig = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        if img_orig is None:
            return {"error": "Invalid or unreadable image"}

        # Save original bytes untouched — no resize, no re-encode
        ts = _utc_ts()
        original_key = f"ocr/water-meter/{reference}/{ts}_original.jpg"
        original_url = self._upload_and_sign(
            key=original_key,
            data=image_bytes,
            content_type="image/jpeg",
        )

        # Resize only for YOLO inference (keeps original unmodified)
        infer_w, infer_h = 720, 525
        orig_h, orig_w = img_orig.shape[:2]
        img_infer = cv2.resize(img_orig, (infer_w, infer_h))

        # Scale factors to map YOLO coords back to original resolution
        sx = orig_w / infer_w
        sy = orig_h / infer_h

        # Detect digits
        results = self.model.predict(img_infer, conf=conf_thresh, verbose=False)[0]
        detections = []
        for x1, y1, x2, y2, score, cls in results.boxes.data.tolist():
            if score >= conf_thresh and (x2 - x1) > 10:
                detections.append({
                    # Scale bboxes back to original image coordinates
                    "bbox":     [int(x1*sx), int(y1*sy), int(x2*sx), int(y2*sy)],
                    "class_id": int(cls),
                    "score":    round(float(score), 4),
                })

        if not detections:
            return {
                "reference":     reference,
                "reading":       "",
                "confidence_avg": 0.0,
                "digit_count":   0,
                "detections":    [],
                "original_url":  original_url,
                "original_key":  original_key,
                "annotated_url": None,
                "message":       "No digits detected — check image quality or lower confidence_threshold",
            }

        # Sort left → right, build reading
        detections.sort(key=lambda d: d["bbox"][0])
        reading  = "".join(self.digit_labels[d["class_id"]] for d in detections)
        avg_conf = round(sum(d["score"] for d in detections) / len(detections), 3)

        # Save annotated — draw boxes on original-resolution image
        annotated_key = f"ocr/water-meter/{reference}/{ts}_annotated.jpg"
        annotated_url = self._upload_and_sign(
            key=annotated_key,
            data=self._annotate(img_orig, detections),
            content_type="image/jpeg",
        )

        return {
            "reference":     reference,
            "reading":       reading,
            "confidence_avg": avg_conf,
            "digit_count":   len(detections),
            "detections":    detections,
            "original_url":  original_url,
            "original_key":  original_key,
            "annotated_url": annotated_url,
            "annotated_key": annotated_key,
        }

    # ── helpers ────────────────────────────────────────────────────────────────

    def _to_dict(self, model_input) -> dict:
        if hasattr(model_input, "to_dict"):
            return model_input.iloc[0].to_dict() if len(model_input) else {}
        return dict(model_input)

    def _annotate(self, img_bgr, detections) -> bytes:
        import cv2
        import numpy as np
        from PIL import Image, ImageDraw

        annotated = img_bgr.copy()
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            label = self.digit_labels[det["class_id"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 120, 255), 2)
            cv2.putText(
                annotated, label, (x1, y1 - 5),
                cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 120, 255), 1,
            )

        pil = Image.fromarray(cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB))
        pil = self._add_round_border(pil).convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=92)
        return buf.getvalue()

    def _add_round_border(
        self,
        image,
        border_color=(232, 232, 232),
        border_radius: int = 30,
        border_width: int = 3,
    ):
        from PIL import Image, ImageDraw

        image = image.convert("RGBA")
        w, h = image.size

        mask_outer = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask_outer).rounded_rectangle(
            [0, 0, w, h], radius=border_radius, fill=255
        )
        mask_inner = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask_inner).rounded_rectangle(
            [border_width, border_width, w - border_width, h - border_width],
            radius=max(border_radius - border_width, 0),
            fill=255,
        )
        result = Image.new("RGBA", (w, h), color=(220, 220, 65))
        result.paste(Image.new("RGBA", (w, h), color=border_color), mask=mask_outer)
        result.paste(image, mask=mask_inner)
        return result

    def _upload_and_sign(self, key: str, data: bytes, content_type: str, expiry: int = 3600) -> str:
        import boto3

        boto3.client(
            "s3",
            endpoint_url=self.s3_endpoint,
            aws_access_key_id=self.s3_access_key,
            aws_secret_access_key=self.s3_secret_key,
            region_name=self.s3_region,
        ).put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

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
