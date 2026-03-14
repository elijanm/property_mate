# Water Meter OCR — model ZIP

## Structure
```
water_meter_ocr_zip/
├── manifest.json    ← model metadata + file references
├── inference.py     ← WaterMeterOCR(PythonModel) entry point
├── model.pt         ← place your YOLO .pt file here  ← NOT included in repo
└── artifacts/       ← optional extra files (empty for this model)
```

## Build the ZIP
```bash
cd apps/ml/trainers/water_meter_ocr_zip
# copy your trained model.pt here first
zip -r ../water_meter_ocr.zip manifest.json inference.py model.pt artifacts/
```

## Deploy
```bash
curl -X POST http://localhost:8030/api/v1/models/deploy-pretrained/zip \
  -F "file=@../water_meter_ocr.zip"
# returns: { "job_id": "...", "model_name": "water-meter-ocr", "status": "queued" }
```

## Poll job status
```bash
curl http://localhost:8030/api/v1/training/jobs/<job_id>
# wait for status == "completed"
```

## Run inference
```bash
IMAGE_B64=$(base64 -i /path/to/meter.jpg)
curl -X POST http://localhost:8030/api/v1/inference/water-meter-ocr \
  -H "Content-Type: application/json" \
  -d "{\"inputs\": {\"image_b64\": \"$IMAGE_B64\", \"reference\": \"MTR-001\"}}"
```

## Response
```json
{
  "reference":      "MTR-001",
  "reading":        "04823",
  "confidence_avg": 0.912,
  "digit_count":    5,
  "detections":     [...],
  "original_url":   "http://localhost:9000/pms-ml/ocr/water-meter/MTR-001/..._original.jpg",
  "annotated_url":  "http://localhost:9000/pms-ml/ocr/water-meter/MTR-001/..._annotated.jpg"
}
```
