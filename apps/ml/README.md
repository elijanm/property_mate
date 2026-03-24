# PMS ML Service

Pluggable machine-learning platform for the PMS mono-repo.
Exposes a REST API for training, inference, deployment, and job tracking.
Models are versioned in MLflow, artifacts stored in MinIO, metadata in MongoDB.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Architecture](#2-architecture)
3. [Writing a Trainer Plugin](#3-writing-a-trainer-plugin)
4. [TrainingConfig Reference](#4-trainingconfig-reference)
5. [Data Sources](#5-data-sources)
6. [Utility Methods](#6-utility-methods)
7. [Developer Utilities — Logging, Plots & Requirements](#7-developer-utilities)
8. [ZIP Deploy (pre-trained models)](#8-zip-deploy-pre-trained-models)
9. [API Reference](#9-api-reference)
10. [Sample Trainers](#10-sample-trainers)
11. [Schema-Driven UI](#11-schema-driven-ui)
12. [GPU Optimization](#12-gpu-optimization)

---

## 1. Quick Start

```bash
# Start all services (MLflow, MinIO, MongoDB, Redis, Celery worker)
cd infra/docker && docker compose up ml-service ml-worker mlflow minio

# Check the ML Studio UI
open http://localhost:8030

# Trigger training for the built-in Iris example
curl -X POST http://localhost:8030/api/v1/training/start \
  -H "Content-Type: application/json" \
  -d '{"trainer_name": "iris_classifier"}'

# Run inference
curl -X POST http://localhost:8030/api/v1/inference/iris_classifier \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2}}'
```

---

## 2. Architecture

```
apps/ml/
├── app/
│   ├── abstract/
│   │   ├── base_trainer.py      ← BaseTrainer ABC + TrainingConfig + utilities
│   │   └── data_source.py       ← 16 data source implementations
│   ├── api/v1/                  ← FastAPI routers
│   ├── services/
│   │   ├── training_service.py  ← orchestrates train runs, MLflow logging
│   │   ├── inference_service.py ← model loading, prediction, fallbacks
│   │   ├── pretrained_deploy_service.py
│   │   └── zip_deploy_service.py
│   ├── models/                  ← Beanie MongoDB documents
│   └── tasks/                   ← Celery tasks
├── trainers/                    ← plugin directory (auto-discovered)
│   ├── example_classifier.py    ← tabular: auto_train_tabular
│   ├── example_regressor.py     ← regression: rent prediction
│   ├── example_pytorch_classifier.py  ← image: ResNet + auto_train_torch
│   ├── example_text_classifier.py     ← NLP: DistilBERT fine-tuning
│   └── base_model_zip/          ← ZIP deploy template
└── ui/                          ← React ML Studio frontend
```

**Flow:**
```
POST /training/start
  → Celery task
    → get_training_config()    (DB → env → per-job overrides)
    → trainer.preprocess()
    → trainer.train()          (returns model or (model, test_data))
    → trainer.evaluate()       (optional)
    → MLflow log + register
    → ModelDeployment saved to MongoDB

POST /inference/<name>
  → find active ModelDeployment (is_default=True or most recent)
  → _load_raw_model()          (sklearn → pytorch → tensorflow → keras → onnx → pyfunc)
  → trainer.predict()          (if trainer overrides it)
  → normalize_output()
  → InferenceLog saved
```

---

## 3. Writing a Trainer Plugin

Drop a `.py` file into `apps/ml/trainers/`. It is auto-discovered on startup.

### Minimal example

```python
from app.abstract.base_trainer import BaseTrainer, TrainingConfig
from app.abstract.data_source import S3DataSource

class MyClassifier(BaseTrainer):
    name        = "my_classifier"
    version     = "1.0.0"
    description = "Classifies widgets"
    framework   = "sklearn"
    data_source = S3DataSource(bucket="pms-ml", key="data/widgets.csv")
    category    = {"key": "classification", "label": "Classification"}

    def train(self, preprocessed, config: TrainingConfig):
        return self.auto_train_tabular(preprocessed, label_col="label", config=config)

    def predict(self, model, inputs):
        import pandas as pd
        df = pd.DataFrame([inputs])
        pred = int(model.predict(df)[0])
        return {"label": str(pred)}
```

### Class attributes

| Attribute | Type | Required | Description |
|---|---|---|---|
| `name` | `str` | **Yes** | Unique trainer ID used in API URLs |
| `data_source` | `DataSource` | **Yes** | Where to load training data |
| `version` | `str` | No | Semantic version (default `"1.0.0"`) |
| `description` | `str` | No | Shown in ML Studio |
| `framework` | `str` | No | `sklearn` \| `pytorch` \| `tensorflow` \| `custom` |
| `schedule` | `str` \| `None` | No | Cron expression for auto-training |
| `input_schema` | `dict` | No | Drives dynamic inference form (see §10) |
| `output_schema` | `dict` | No | Drives result rendering in UI |
| `category` | `dict` | No | `{"key": "ocr", "label": "OCR & Vision"}` — grid filter chip |
| `tags` | `dict` | No | Arbitrary MLflow tags |
| `requirements` | `List[str]` | No | Extra pip packages — installed automatically in the sandbox before your code runs |

### Methods to implement

| Method | Signature | Notes |
|---|---|---|
| `train` | `(preprocessed, config) → model or (model, test_data)` | **Required** |
| `predict` | `(model, inputs) → Any` | **Required** |
| `preprocess` | `(raw_data) → Any` | Optional, default passthrough |
| `postprocess` | `(predictions) → Any` | Optional, default `normalize_output()` |
| `evaluate` | `(model, test_data) → EvaluationResult` | Required if `train()` returns `(model, test_data)` |
| `get_class_names` | `() → List[str]` | Optional, for confusion matrix labels |
| `get_feature_names` | `() → List[str]` | Optional, for logging |
| `get_input_example` | `() → Any` | Optional, for MLflow signature inference |

---

## 4. TrainingConfig Reference

`TrainingConfig` is passed to every `train()` call. Configure it globally via the DB (`/api/v1/training/config`) or per-job via `training_config.extra`.

### Hardware

| Field | Default | Description |
|---|---|---|
| `device` | `"cpu"` | `cpu` \| `cuda` \| `cuda:0` \| `mps` \| `auto` |
| `workers` | `4` | DataLoader workers / sklearn `n_jobs` |
| `batch_size` | `32` | Batch size for DataLoader |
| `mixed_precision` | `"auto"` | `auto` \| `no` \| `fp16` \| `bf16` — auto selects fp16 on CUDA |
| `dataloader_pin_memory` | `True` | CUDA pinned memory (ignored on CPU) |
| `prefetch_factor` | `2` | DataLoader prefetch depth |
| `fp16` | `False` | Legacy alias for `mixed_precision="fp16"` |

### Training Loop

| Field | Default | Description |
|---|---|---|
| `max_epochs` | `100` | Maximum training epochs |
| `early_stopping` | `True` | Stop when val loss stops improving |
| `early_stopping_patience` | `5` | Epochs to wait before stopping |

### Data Splitting

| Field | Default | Description |
|---|---|---|
| `test_split` | `0.2` | Fraction held out for evaluation |
| `val_split` | `0.0` | Fraction of remaining data for validation (0 = skip) |
| `random_seed` | `42` | Reproducibility seed for all splits |

### Optimisation

| Field | Default | Description |
|---|---|---|
| `optimizer` | `"adam"` | `adam` \| `adamw` \| `sgd` \| `rmsprop` \| `adagrad` |
| `learning_rate` | `1e-3` | Initial learning rate |
| `weight_decay` | `1e-4` | L2 regularisation (AdamW / SGD) |
| `gradient_clip` | `0.0` | Max gradient norm — 0 disables clipping |
| `lr_scheduler` | `"cosine"` | `cosine` \| `linear` \| `step` \| `plateau` \| `none` |
| `warmup_ratio` | `0.0` | Warmup as fraction of total training steps |

### Task

| Field | Default | Description |
|---|---|---|
| `task` | `"classification"` | `classification` \| `regression` \| `detection` \| `segmentation` \| `nlp_classification` \| `generation` \| `embedding` \| `custom` |
| `num_classes` | `None` | Number of classes (inferred from data if None) |

### Extra overrides

```python
config.extra["my_param"] = "value"   # freeform dict for trainer-specific settings
```

### Configure via API

```bash
# Update global training config
curl -X PATCH http://localhost:8030/api/v1/training/config \
  -H "Content-Type: application/json" \
  -d '{
    "test_split": 0.15,
    "val_split": 0.1,
    "random_seed": 123,
    "optimizer": "adamw",
    "learning_rate": 5e-4,
    "mixed_precision": "fp16",
    "gradient_clip": 1.0
  }'
```

### Per-job overrides

```bash
curl -X POST http://localhost:8030/api/v1/training/start \
  -H "Content-Type: application/json" \
  -d '{
    "trainer_name": "rent_predictor",
    "training_config": {
      "extra": {"max_depth": 8}
    }
  }'
```

---

## 5. Data Sources

Import from `app.abstract.data_source`. All sources are async.

| Source | Import | Use case |
|---|---|---|
| `S3DataSource` | bucket, key | CSV / parquet / images in MinIO / S3 |
| `URLDataSource` | url | HTTP/HTTPS file download |
| `LocalFileDataSource` | path | Mounted Docker volume |
| `InMemoryDataSource` | data | Built-in datasets, tests |
| `UploadedFileDataSource` | — | File uploaded via `/training/start-with-data` |
| `MongoDBDataSource` | database, collection, query | Any MongoDB collection |
| `PostgreSQLDataSource` | dsn, query | PostgreSQL / CockroachDB |
| `SQLDataSource` | connection_string, query | MySQL / SQLite / MSSQL / Oracle |
| `HuggingFaceDataSource` | dataset_name, split | HuggingFace Hub datasets |
| `KafkaDataSource` | bootstrap_servers, topic | Real-time event streams |
| `GCSDataSource` | bucket, blob | Google Cloud Storage |
| `AzureBlobDataSource` | container, blob | Azure Blob Storage |
| `FTPDataSource` | host, path | FTP / SFTP |
| `PaginatedAPIDataSource` | url | Any paginated REST API |
| `RedisDataSource` | key | Redis list / set / zset / pattern scan |

### Examples

```python
# Single CSV from MinIO
data_source = S3DataSource(bucket="pms-ml", key="datasets/leases.csv")

# All images under a prefix
data_source = S3DataSource(bucket="pms-ml", key="datasets/meters/")

# MongoDB query — PMS leases
data_source = MongoDBDataSource(
    database="pms",
    collection="leases",
    query={"status": "active"},
    projection={"rent_amount": 1, "unit_type": 1, "location": 1, "_id": 0},
    limit=100000,
)

# Paginated REST API
data_source = PaginatedAPIDataSource(
    url="https://api.example.com/records",
    headers={"Authorization": "Bearer TOKEN"},
    data_key="results",
    page_size=200,
)

# HuggingFace dataset
data_source = HuggingFaceDataSource(
    dataset_name="imdb",
    split="train[:20%]",
)
```

---

## 6. Utility Methods

`BaseTrainer` provides ready-to-use helpers. Call them from `train()` and `predict()`.

### Data splitting

```python
# Three-way split for arrays/numpy
X_train, X_val, X_test, y_train, y_val, y_test = self.split_data(X, y, config)

# Three-way split for DataFrames
df_train, df_val, df_test = self.split_dataframe(df, label_col="target", config=config)
```

### GPU placement

```python
# Move a model or tensor to config.device
model  = self.move_to_device(model, config)
tensor = self.move_to_device(tensor, config)

# Full optimization: DataParallel + torch.compile
model = self.optimize_model(model, config)

# Log GPU name / VRAM / CUDA version to structlog
self.log_device_info(config)
```

### Mixed precision

```python
with self.get_amp_context(config):
    outputs = model(inputs)
    loss = criterion(outputs, targets)

scaler = self.get_grad_scaler(config)
scaler.scale(loss).backward()
scaler.step(optimizer)
scaler.update()
```

### Optimizer & scheduler

```python
optimizer = self.build_optimizer(model.parameters(), config)
# config.optimizer: "adam" | "adamw" | "sgd" | "rmsprop" | "adagrad"

total_steps = config.max_epochs * len(train_loader)
scheduler = self.build_scheduler(optimizer, config, total_steps)
# config.lr_scheduler: "cosine" | "linear" | "step" | "plateau" | "none"
```

### DataLoader (GPU-optimized)

```python
train_loader = self.build_dataloader(train_ds, config, shuffle=True)
val_loader   = self.build_dataloader(val_ds,   config, shuffle=False)
# Automatically: pin_memory=True on CUDA, prefetch_factor, persistent_workers
```

### Auto-training

```python
# One-liner tabular training — tries RF + GBM + LR + XGBoost + LightGBM
# Picks the best by 3-fold CV, returns (best_pipeline, (X_test, y_test))
model, test_data = self.auto_train_tabular(df, label_col="churn", config=config)

# Full PyTorch training loop — AMP + gradient clip + early stopping + scheduling
model = self.auto_train_torch(model, train_loader, config, val_loader=val_loader)
```

### Output normalization

```python
# Converts numpy arrays, torch tensors → JSON-serializable Python types
result = self.normalize_output(raw_prediction)
# Works recursively on dicts and lists
```

---

## 7. Developer Utilities

Three built-in utilities are available in every trainer via `self.*`. No imports needed.

### 7.1 Package Requirements

Declare extra pip packages your trainer needs. The sandbox installs them **before** importing your file — no `ModuleNotFoundError` on startup.

**Option A — class attribute (preferred)**
```python
class TimeSeriesForecaster(BaseTrainer):
    name    = "ts_forecaster"
    requirements = [
        "statsmodels",
        "prophet",
        "xgboost>=1.7",
    ]

    def train(self, preprocessed, config):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        ...
```

**Option B — comment header**
```python
# Requirements: statsmodels, prophet, xgboost>=1.7
from app.abstract.base_trainer import BaseTrainer
...
```

> **Note:** In the sandbox packages are installed into `/tmp/pip_user_pkgs` and cached for the container lifetime. In production (real training jobs) add packages to `apps/ml/requirements.txt` and rebuild the Docker image.

---

### 7.2 Structured Logging — `self.log`

Every trainer gets a built-in logger that emits JSON lines to stdout. Lines are forwarded in real time to the **Console** tab in ML Studio. `self.log.metric()` calls also populate the **Metrics** tab.

| Method | Use for |
|---|---|
| `self.log.info(msg, **kwargs)` | Progress, epoch summaries |
| `self.log.warning(msg, **kwargs)` | Non-fatal issues |
| `self.log.error(msg, **kwargs)` | Caught exceptions |
| `self.log.metric(name, value, **tags)` | Numeric metrics → Metrics tab |

```python
def train(self, preprocessed, config):
    X_train, _, X_test, y_train, _, y_test = self.split_data(
        preprocessed["features"], preprocessed["labels"], config
    )
    self.log.info("training_start", samples=len(X_train))

    from sklearn.ensemble import RandomForestClassifier
    clf = RandomForestClassifier(n_estimators=200, random_state=config.random_seed)
    clf.fit(X_train, y_train)

    acc = float(clf.score(X_test, y_test))
    self.log.metric("accuracy", acc)           # → Metrics tab
    self.log.info("done", accuracy=round(acc, 4))
    return clf, (X_test, y_test)
```

---

### 7.3 Plot Capture — `self.plot_context()`

Intercepts every `plt.show()` call inside the `with` block, captures the figure as a PNG, and streams it to the **Artifacts** tab in ML Studio. Nothing is displayed on screen.

- **Test/sandbox mode**: streamed live as base64 over SSE to the Artifacts tab
- **Production mode**: saved to MLflow as run artifacts under `plots/`

```python
def train(self, preprocessed, config):
    import matplotlib.pyplot as plt
    import numpy as np

    series = preprocessed["values"]
    # ... fit model ...

    # Wrap any plt block — plt.show() is intercepted
    with self.plot_context("forecast"):
        plt.figure(figsize=(12, 4))
        plt.plot(series, label="Actual")
        plt.plot(fitted, label="Fitted", linestyle="--")
        plt.plot(range(len(series), len(series) + 12), forecast,
                 label="Forecast", color="red")
        plt.title("ETS Forecast")
        plt.legend()
        plt.tight_layout()
        plt.show()   # → captured as "forecast_0.png" in Artifacts tab

    return model
```

Multiple `plt.show()` calls in the same block produce sequentially-named files (`forecast_0.png`, `forecast_1.png`, …). The prefix string names the files — use descriptive names like `"confusion_matrix"`, `"feature_importance"`, `"residuals"`.

---

## 8. ZIP Deploy (pre-trained models)

Deploy any pre-trained model without a training run. No Python class needed — just a ZIP.

### ZIP structure

```
my-model.zip
├── manifest.json       ← required
├── inference.py        ← PythonModel subclass (entry point)
├── model.pt            ← model weights
└── artifacts/          ← optional side-car files
    ├── scaler.pkl
    └── label_map.json
```

### manifest.json fields

```json
{
    "name":           "my-ocr-model",
    "version":        "1.0.0",
    "description":    "Classifies meter images",
    "tags":           {"domain": "utilities"},
    "category":       {"key": "ocr", "label": "OCR & Vision"},
    "model_file":     "model.pt",
    "entry_point":    "inference.py",
    "set_as_default": true,
    "input_schema": {
        "image_b64": { "type": "image",  "label": "Meter Image",  "required": true },
        "reference": { "type": "string", "label": "Meter Ref ID", "required": false }
    },
    "output_schema": {
        "reading":        { "type": "text",      "label": "Reading",  "editable": true },
        "confidence_avg": { "type": "number",     "label": "Confidence", "format": "percent" },
        "annotated_url":  { "type": "image_url",  "label": "Annotated Image" }
    }
}
```

### Deploy via curl

```bash
# Pack the ZIP
cd apps/ml/trainers/water_meter_ocr_zip
zip -r ../water_meter_ocr.zip manifest.json inference.py model.pt artifacts/

# Deploy — first time
curl -X POST http://localhost:8030/api/v1/models/deploy-pretrained/zip \
  -F "file=@../water_meter_ocr.zip"
# → { "job_id": "...", "model_name": "water-meter-ocr", "status": "queued" }

# Deploy — upgrade existing (add new MLflow version)
curl -X POST http://localhost:8030/api/v1/models/deploy-pretrained/zip \
  -F "file=@../water_meter_ocr.zip" \
  -F "action=upgrade"

# Deploy — replace (archive all previous deployments)
curl -X POST "..." -F "file=@..." -F "action=replace"
```

### Conflict detection

If the model name already exists and `action` is omitted, the API returns:
```json
{
    "conflict": true,
    "model_name": "water-meter-ocr",
    "new_version": "2.0.0",
    "existing_version": "1.0.0",
    "existing_mlflow_version": "3"
}
```
The ML Studio UI shows an Upgrade / Replace dialog automatically.

### inference.py template

```python
import mlflow.pyfunc

class MyModel(mlflow.pyfunc.PythonModel):

    def load_context(self, context):
        import joblib
        self.model  = joblib.load(context.artifacts["model_file"])
        self.scaler = joblib.load(context.artifacts["scaler"])   # from artifacts/

    def predict(self, context, model_input):
        # model_input is a plain dict
        features = [model_input["x1"], model_input["x2"]]
        pred = int(self.model.predict([features])[0])
        return {"label": str(pred), "confidence": 0.95}
```

See `trainers/base_model_zip/inference.py` for a full template with examples for
sklearn, PyTorch, ONNX, HuggingFace, YOLO, and Keras.

---

## 9. API Reference

### Training

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/training/trainers` | List registered trainers |
| `POST` | `/api/v1/training/start` | Trigger training run |
| `POST` | `/api/v1/training/start-with-data` | Trigger + upload training file |
| `GET` | `/api/v1/training/jobs` | List training jobs |
| `GET` | `/api/v1/training/jobs/{id}` | Job status + logs |
| `POST` | `/api/v1/training/jobs/{id}/cancel` | Cancel running job |
| `GET` | `/api/v1/training/config` | Get global training config |
| `PATCH` | `/api/v1/training/config` | Update global training config |

### Inference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/inference/{trainer_name}` | Run inference (default/latest version) |
| `POST` | `/api/v1/inference/{trainer_name}?version=3` | Run inference on specific version |
| `POST` | `/api/v1/inference/by-id/{deployment_id}` | Run inference on specific deployment |
| `GET` | `/api/v1/inference/logs` | List inference logs |
| `GET` | `/api/v1/inference/logs/{id}` | Single log with presigned image URLs |
| `GET` | `/api/v1/inference/stats` | Aggregated latency / error stats |

### Models (deployments)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/models` | List deployments (one per trainer by default) |
| `GET` | `/api/v1/models?include_all=true` | All deployment versions |
| `POST` | `/api/v1/models/deploy-pretrained` | Deploy from HuggingFace / S3 / URL / MLflow URI |
| `POST` | `/api/v1/models/deploy-pretrained/upload` | Deploy from uploaded model file |
| `POST` | `/api/v1/models/deploy-pretrained/zip` | Deploy from ZIP archive |
| `POST` | `/api/v1/models/{id}/set-default` | Set active default version |
| `GET` | `/api/v1/models/{id}/metric-history` | Per-epoch MLflow metric history |
| `GET` | `/api/v1/models/{id}/training-artifacts` | Confusion matrices, training plots |
| `DELETE` | `/api/v1/models/{id}` | Delete a deployment record |

---

## 10. Sample Trainers

| File | Name | Task | Demonstrates |
|---|---|---|---|
| `example_classifier.py` | `iris_classifier` | Tabular classification | `auto_train_tabular`, iris dataset, auto model selection |
| `example_regressor.py` | `rent_predictor` | Tabular regression | `auto_train_tabular` with `task="regression"`, rent prediction |
| `example_pytorch_classifier.py` | `meter_type_classifier` | Image classification | `auto_train_torch`, ResNet18, GPU + AMP, `build_dataloader` |
| `example_text_classifier.py` | `ticket_classifier` | Text / NLP | DistilBERT fine-tuning, `auto_train_torch`, HuggingFace |

### Running all samples

```bash
for trainer in iris_classifier rent_predictor meter_type_classifier ticket_classifier; do
  curl -s -X POST http://localhost:8030/api/v1/training/start \
    -H "Content-Type: application/json" \
    -d "{\"trainer_name\": \"$trainer\"}" | jq .
done
```

---

## 11. Schema-Driven UI

Define `input_schema` and `output_schema` on your trainer (or in `manifest.json` for ZIP models) to get a dynamic inference form in ML Studio — no frontend code needed.

### input_schema field types

| Type | Renders as | Notes |
|---|---|---|
| `number` | Numeric input with min/max/step | supports `unit`, `default`, `min`, `max` |
| `string` | Text input | |
| `boolean` | Toggle switch | |
| `image` | Drag-and-drop image uploader | Sends base64 to model |
| `file` | File picker | Sends base64 bytes |

### output_schema field types

| Type | Renders as |
|---|---|
| `text` | Editable text field (if `editable: true`) |
| `number` | Formatted number (`format: "percent"` → 0.97 → 97%) |
| `image_url` | Rendered image (fetches presigned URL) |
| `detections` | Bounding box overlay list |
| `json` | Collapsible JSON tree |
| `boolean` | Yes / No badge |
| `list` | Bulleted list |

### Example schemas

```python
input_schema = {
    "sepal_length": {
        "type": "number",
        "label": "Sepal Length",
        "unit": "cm",
        "required": True,
        "min": 4.0, "max": 8.0, "step": 0.1,
        "default": 5.1,
        "description": "Length of the sepal in centimetres",
    },
    "image": {
        "type": "image",
        "label": "Meter Photo",
        "required": True,
        "description": "Upload a clear photo of the meter face",
    },
}

output_schema = {
    "label": {
        "type": "text",
        "label": "Predicted Class",
        "editable": True,
    },
    "confidence": {
        "type": "number",
        "label": "Confidence",
        "format": "percent",
    },
    "annotated_url": {
        "type": "image_url",
        "label": "Annotated Image",
    },
}
```

### Category chips (grid filtering)

```python
category = {"key": "ocr",            "label": "OCR & Vision"}
category = {"key": "classification", "label": "Classification"}
category = {"key": "regression",     "label": "Regression"}
category = {"key": "nlp",            "label": "NLP"}
category = {"key": "detection",      "label": "Object Detection"}
category = {"key": "custom",         "label": "Custom Model"}
```

---

## 12. GPU Optimization

The service automatically selects CUDA when `CUDA_DEVICE=auto` (default). All helpers account for CPU / CUDA / MPS (Apple Silicon) transparently.

### Environment variables

```env
CUDA_DEVICE=auto              # auto | cpu | cuda | cuda:0 | cuda:1
TRAINING_MIXED_PRECISION=auto # auto | no | fp16 | bf16
TRAINING_WORKERS=4
TRAINING_BATCH_SIZE=32
TRAINING_GRADIENT_CLIP=0.0
TRAINING_LR_SCHEDULER=cosine
TRAINING_LEARNING_RATE=0.001
TRAINING_TEST_SPLIT=0.2
TRAINING_VAL_SPLIT=0.1
TRAINING_RANDOM_SEED=42
```

### What happens on CUDA

- `optimize_model()` — moves model to GPU, wraps in `DataParallel` if `device_count > 1`, applies `torch.compile`
- `build_dataloader()` — sets `pin_memory=True`, `persistent_workers=True`, `prefetch_factor=2`
- `get_amp_context()` — returns `torch.autocast(device_type="cuda", dtype=torch.float16)`
- `get_grad_scaler()` — returns `torch.cuda.amp.GradScaler()`
- `log_device_info()` — logs GPU name, VRAM, CUDA + cuDNN version

### Minimal GPU training loop

```python
def train(self, preprocessed, config: TrainingConfig):
    import torch.nn as nn

    model        = MyNet(num_classes=4)
    train_loader = self.build_dataloader(train_ds, config)
    val_loader   = self.build_dataloader(val_ds, config, shuffle=False)

    # All GPU logic (placement, AMP, clipping, early stopping) handled internally
    model = self.auto_train_torch(model, train_loader, config, val_loader=val_loader)
    return model, test_loader
```

### Manual loop with helpers

```python
model     = self.optimize_model(model, config)      # GPU + compile
optimizer = self.build_optimizer(model.parameters(), config)
scheduler = self.build_scheduler(optimizer, config, total_steps)
scaler    = self.get_grad_scaler(config)
amp_ctx   = self.get_amp_context(config)

for epoch in range(config.max_epochs):
    for batch in train_loader:
        optimizer.zero_grad()
        with amp_ctx:
            loss = model(batch)
        scaler.scale(loss).backward()
        if config.gradient_clip > 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), config.gradient_clip)
        scaler.step(optimizer)
        scaler.update()
        scheduler.step()
```
