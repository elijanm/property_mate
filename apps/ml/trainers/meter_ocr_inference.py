# @trainer
# Name: Meter OCR Inference
# Version: 1.0.0
# Author: Mldock Team
# Author Email: hello@mldock.io
# Author URL: https://mldock.io
# Description: Reads utility meter values from images using OCR and computer vision
# Commercial: public
# Downloadable: true
# Protect Model: false
# Icon: dataset:water-meter-data
# License: MIT
# Tags: ocr, image, meters, utilities

"""
Meter OCR inference script — upload this alongside model.pt via:
  POST /api/v1/models/deploy-pretrained/upload

  file             = model.pt
  inference_script = meter_ocr_inference.py
  name             = meter-ocr
  version          = 1.0.0

Then run inference via:
  POST /api/v1/inference/meter-ocr
  {
    "inputs": {
      "image_b64": "<base64-encoded image>",
      "reference": "MTR-001",
      "confidence_threshold": 0.5
    }
  }

Both the original and annotated images are saved to MinIO.
Response includes: reading, confidence_avg, digit_count, detections,
                   original_url, annotated_url  (presigned, 1-hour expiry)
"""
import base64
import io
import os
from datetime import datetime, timezone

import mlflow.pyfunc


def _utc_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class MeterOCRModel(mlflow.pyfunc.PythonModel):
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
        from ultralytics import YOLO
        self.model = YOLO(context.artifacts["model_file"])
        self.digit_labels = [str(i) for i in range(10)]

        # Resolve S3 credentials once at load time — os.environ is populated by now
        self.bucket = os.environ.get("S3_BUCKET") or "pms-ml"
        self.s3_endpoint = os.environ.get("S3_ENDPOINT_URL") or "http://minio:9000"
        self.s3_public_endpoint = (os.environ.get("S3_PUBLIC_ENDPOINT_URL") or self.s3_endpoint).rstrip("/")
        self.s3_access_key = os.environ.get("S3_ACCESS_KEY") or "minioadmin"
        self.s3_secret_key = os.environ.get("S3_SECRET_KEY") or "minioadmin"
        self.s3_region = os.environ.get("S3_REGION") or "us-east-1"

    def predict(self, context, model_input):
        import cv2
        import numpy as np

        # Accept dict or single-row DataFrame
        if hasattr(model_input, "to_dict"):
            row = model_input.iloc[0].to_dict() if len(model_input) else {}
        else:
            row = model_input

        image_b64 = row.get("image_b64", "")
        reference = str(row.get("reference", "unknown"))
        conf_thresh = float(row.get("confidence_threshold", 0.5))

        if not image_b64:
            return {"error": "image_b64 is required"}

        image_bytes = base64.b64decode(image_b64)
        npimg = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        if img is None:
            return {"error": "Invalid or unreadable image"}

        img = cv2.resize(img, (720, 525))

        # Save original to MinIO
        ts = _utc_ts()
        original_key = f"ocr/{reference}/{ts}_original.jpg"
        _, original_buf = cv2.imencode(".jpg", img)
        original_url = self._upload_and_sign(original_key, original_buf.tobytes(), "image/jpeg")

        # Run detection
        results = self.model.predict(img, conf=conf_thresh, verbose=False)[0]
        detections = []
        for x1, y1, x2, y2, score, cls in results.boxes.data.tolist():
            if score >= conf_thresh and (x2 - x1) > 10:
                detections.append({
                    "bbox": [int(x1), int(y1), int(x2), int(y2)],
                    "class_id": int(cls),
                    "score": round(float(score), 4),
                })

        if not detections:
            return {
                "reference": reference,
                "reading": "",
                "confidence_avg": 0.0,
                "digit_count": 0,
                "detections": [],
                "original_url": original_url,
                "annotated_url": None,
                "message": "No digits detected",
            }

        detections.sort(key=lambda d: d["bbox"][0])
        reading = "".join(self.digit_labels[d["class_id"]] for d in detections)
        avg_conf = round(sum(d["score"] for d in detections) / len(detections), 3)

        # Build annotated image and save to MinIO
        annotated_bytes = self._annotate_bytes(img, detections)
        annotated_key = f"ocr/{reference}/{ts}_annotated.jpg"
        annotated_url = self._upload_and_sign(annotated_key, annotated_bytes, "image/jpeg")

        return {
            "reference": reference,
            "reading": reading,
            "confidence_avg": avg_conf,
            "digit_count": len(detections),
            "detections": detections,
            "original_url": original_url,
            "annotated_url": annotated_url,
        }

    def _upload_and_sign(self, key: str, data: bytes, content_type: str, expiry: int = 3600) -> str:
        import boto3
        upload_client = boto3.client(
            "s3",
            endpoint_url=self.s3_endpoint,
            aws_access_key_id=self.s3_access_key,
            aws_secret_access_key=self.s3_secret_key,
            region_name=self.s3_region,
        )
        upload_client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

        # Sign with public endpoint so URLs work from browsers
        sign_client = boto3.client(
            "s3",
            endpoint_url=self.s3_public_endpoint,
            aws_access_key_id=self.s3_access_key,
            aws_secret_access_key=self.s3_secret_key,
            region_name=self.s3_region,
        )
        return sign_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expiry,
        )

    def _annotate_bytes(self, img_bgr, detections) -> bytes:
        import cv2
        import numpy as np
        from PIL import Image, ImageDraw

        annotated = img_bgr.copy()
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            label = self.digit_labels[det["class_id"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
            cv2.putText(annotated, label, (x1, y1 - 5),
                        cv2.FONT_HERSHEY_DUPLEX, 0.8, (0, 0, 255), 1)

        pil = Image.fromarray(cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB))
        pil = self._add_round_border(pil).convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, format="JPEG")
        return buf.getvalue()

    def _add_round_border(self, image, border_color=(232, 232, 232), border_radius=30, border_width=3):
        from PIL import Image, ImageDraw
        image = image.convert("RGBA")
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, image.size[0], image.size[1]], radius=border_radius, fill=255
        )
        mask_in = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask_in).rounded_rectangle(
            [border_width, border_width, image.size[0] - border_width, image.size[1] - border_width],
            radius=max(border_radius - border_width, 0), fill=255,
        )
        result = Image.new("RGBA", image.size, color=(220, 220, 65))
        result.paste(Image.new("RGBA", image.size, color=border_color), mask=mask)
        result.paste(image, mask=mask_in)
        return result
