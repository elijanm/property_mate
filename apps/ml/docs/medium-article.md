# Building a Self-Hosted Production ML Platform: Architecture, Hard Lessons, and Everything Between

*A deep dive into PMS ML Studio — a fully self-hosted machine learning platform with A/B testing, drift detection, circuit breakers, batch inference, and a pluggable trainer system, built on FastAPI, MongoDB, MLflow, and React.*

---

## Why We Didn't Use a Managed ML Service

The short answer: we wanted full control over our data, our deployment pipeline, and our costs.

The longer answer: we're building PMS — a multi-tenant property management platform. Our ML workloads include meter reading OCR (from camera photos), maintenance ticket classification, IP threat scoring, and rent prediction. The inputs to these models contain sensitive data: ID photos, meter images, financial histories. Routing that through a managed cloud ML provider meant accepting terms of service that our clients hadn't agreed to, latency we couldn't control, and vendor lock-in on a critical path.

So we built our own.

This article is a technical walkthrough of every meaningful decision we made — the architecture, the features, the bugs we hit, and what we'd do differently. It's long. Get a coffee.

---

## System Overview

PMS ML Studio is a standalone FastAPI service that sits alongside our main backend. It exposes a REST API on port 8030, has its own React UI on port 5200, and shares the infrastructure already running for the main platform: MongoDB, Redis, MinIO (S3-compatible storage), and MLflow.

```
┌─────────────────────────────────────────────────────┐
│                   PMS ML Studio                      │
│                                                      │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  React UI    │────▶│  FastAPI (port 8030)     │  │
│  │  (port 5200) │     │  - Trainer registry       │  │
│  └──────────────┘     │  - Inference routing      │  │
│                       │  - A/B test routing        │  │
│                       │  - Circuit breaker         │  │
│                       │  - Auth + API keys         │  │
│                       └──────────┬───────────────┘  │
│                                  │                   │
│          ┌───────────────────────┼───────────────┐  │
│          ▼               ▼       ▼       ▼        ▼  │
│       MongoDB         Redis   MLflow  MinIO  APScheduler │
└─────────────────────────────────────────────────────┘
```

The service is stateless. Every piece of mutable state lives in MongoDB. Redis handles coordination (circuit breaker state, rate limiting). MLflow tracks experiments. MinIO stores model artifacts and batch job results.

---

## The Plugin Architecture

The most important decision we made was making the trainer system pluggable from day one.

### The Contract

Every model type is a Python class that inherits from `BaseTrainer`:

```python
# apps/ml/app/abstract/base_trainer.py

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

class BaseTrainer(ABC):
    name: str                     # unique identifier — used as route key
    display_name: str = ""
    description: str = ""
    supports_batch: bool = True

    @abstractmethod
    def train(self, data: Any, config: Dict) -> Dict:
        """Train the model. Return metrics dict."""
        ...

    @abstractmethod
    def predict(self, inputs: Dict[str, Any]) -> Any:
        """Run inference on a single input dict."""
        ...

    def predict_batch(self, rows: list[Dict]) -> list[Any]:
        """Default: call predict() in a loop. Override for efficiency."""
        return [self.predict(r) for r in rows]
```

That's the entire contract. A data scientist who has never touched the platform can write a trainer in an afternoon.

### Plugin Discovery

At startup, the service scans the `/app/trainers` directory for any Python file containing a class that subclasses `BaseTrainer`:

```python
# services/registry_service.py (simplified)

import importlib.util, inspect, sys
from pathlib import Path
from app.abstract.base_trainer import BaseTrainer

async def scan_and_register_plugins():
    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    for py_file in plugin_dir.glob("*.py"):
        spec = importlib.util.spec_from_file_location(py_file.stem, py_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        for _, cls in inspect.getmembers(module, inspect.isclass):
            if issubclass(cls, BaseTrainer) and cls is not BaseTrainer:
                await _register(cls)
```

No config files. No service restarts. Drop a file, and the trainer appears in the UI. This turned out to be crucial for iteration speed — data scientists deploy a new trainer the same way engineers deploy a feature.

### MLflow Integration

Training jobs are tracked in MLflow automatically. The service creates a run, logs all hyperparameters and metrics, and registers the resulting model in the MLflow Model Registry. The UI can then browse runs, compare metrics across versions, and promote a run to "production" with a single click.

Model artifacts live in MinIO under a structured path: `{org_id}/mlflow/artifacts/{experiment_id}/{run_id}/`. The MLflow tracking server is a separate container, giving us a clean separation between tracking metadata (in MLflow's SQLite/Postgres backend) and binary artifacts (in MinIO).

---

## The Inference Pipeline

Every inference request goes through a chain of middleware before the model sees it:

```
Request
   │
   ▼
RequestLoggerMiddleware
   │  - Log request to MongoDB (RequestLog)
   │  - Check IP ban status (IPRecord)
   │  - Increment IP threat score on suspicious patterns
   │
   ▼
Auth middleware
   │  - Validate JWT (Bearer) OR API key (X-API-Key header)
   │  - Reject if neither present
   │
   ▼
inference_service.run_inference()
   │
   ├── Schema validation (if model has registered input schema)
   ├── Data quality check (null fields, Z-score outliers vs. recent history)
   ├── A/B test routing (is this trainer in an active test?)
   ├── Circuit breaker check (is this model suspended?)
   │
   ▼
mlflow.pyfunc.load_model() → model.predict(inputs)
   │
   ├── Record success / failure to circuit breaker
   ├── Log InferenceLog to MongoDB (inputs, output, latency, model version)
   ├── Update A/B test metrics (if routed)
   │
   ▼
Response
```

Let's walk through each stage.

---

## Stage 1: Schema Validation

Each deployed model can have a registered input schema — a lightweight JSON Schema-style definition:

```json
{
  "required": ["meter_image_b64", "unit_id"],
  "properties": {
    "meter_image_b64": { "type": "string" },
    "unit_id": { "type": "string" },
    "expected_reading": { "type": "number", "minimum": 0 }
  }
}
```

Before inference, the service validates the incoming dict against this schema and returns a structured error if validation fails:

```json
{
  "error": "SCHEMA_VALIDATION_FAILED",
  "violations": [
    "Required field 'meter_image_b64' is missing",
    "Field 'expected_reading' value -5 < minimum 0"
  ]
}
```

Schema violations are logged separately from inference errors — over time this builds a picture of which callers are sending malformed inputs, which often indicates a client integration bug rather than a model problem.

---

## Stage 2: Data Quality Checks

Even when a request passes schema validation, the *values* may be anomalous. We run a lightweight data quality check against every numeric input field:

```python
# services/experiment_service.py (simplified)

async def check_data_quality(inputs: Dict, trainer_name: str) -> Dict:
    # Pull the last 1000 inference logs for this model
    recent = await InferenceLog.find({"trainer_name": trainer_name}) \
        .sort("-created_at").limit(1000).to_list()

    warnings = []
    for field, value in inputs.items():
        if not isinstance(value, (int, float)):
            continue

        # Build distribution from recent history
        historical = [
            log.inputs[field] for log in recent
            if log.inputs and isinstance(log.inputs.get(field), (int, float))
        ]
        if len(historical) < 10:
            continue

        mean = sum(historical) / len(historical)
        std = (sum((x - mean)**2 for x in historical) / len(historical)) ** 0.5

        if std > 0:
            z = abs(value - mean) / std
            if z > 4.0:   # 4σ — very conservative threshold
                warnings.append({
                    "field": field, "value": value,
                    "z_score": round(z, 2),
                    "historical_mean": round(mean, 4),
                    "historical_std": round(std, 4),
                })

    return {"passed": len(warnings) == 0, "warnings": warnings}
```

Warnings are attached to the inference response — they don't block the request, but they alert the caller that the input looks unusual. We found a billing bug this way: a meter reading of `999999` (a sentinel value from a legacy system) was being passed to the OCR model, which confidently returned garbage.

---

## Stage 3: A/B Testing

When a model is part of an active A/B test, the inference router splits traffic probabilistically:

```python
# services/ab_test_service.py (simplified)

def route_request(test: ABTest) -> str:
    """Return 'a' or 'b' based on configured traffic split."""
    return "b" if random.randint(1, 100) <= test.traffic_pct_b else "a"

async def get_active_test_for_trainer(trainer_name: str) -> Optional[ABTest]:
    return await ABTest.find_one({
        "$and": [
            {"status": "active"},
            {"$or": [
                {"model_a": trainer_name},
                {"model_b": trainer_name}
            ]}
        ]
    })
```

The caller always gets a response from one of the two model variants — they don't know they're in a test. Per-variant metrics (request volume, error rate, latency, accuracy when labels are available) accumulate in real time.

The UI shows the comparison live:

```
┌─────────────────────────────────────────────────────────────┐
│  Test: v2-challenger · ACTIVE                               │
├──────────────────┬────────────┬───────────┬─────────────────┤
│ Variant          │ Requests   │ Error rate│ Avg latency     │
├──────────────────┼────────────┼───────────┼─────────────────┤
│ A · water-meter  │ 8,420      │ 0.82%     │ 241ms           │
│ B · water-meter  │ 943 ▶ 10% │ 0.31% ▲  │ 198ms ▲         │
└──────────────────┴────────────┴───────────┴─────────────────┘
```

The `▲` indicates the winning variant on each metric. When you're confident, click "B wins" → the test concludes, B becomes the default, and A is retired.

---

## Stage 4: Circuit Breakers

This is the safety net. Every model has a Redis-backed circuit breaker that tracks three states:

- **Closed** — normal operation
- **Open** — model suspended after N consecutive failures
- **Half-open** — recovery probe: one request let through after timeout

```python
# services/circuit_breaker_service.py (simplified)

_FAILURE_THRESHOLD = 5
_RECOVERY_TIMEOUT_SEC = 120
_HALF_OPEN_MAX = 3     # successes needed to close again

async def record_failure(trainer_name: str) -> None:
    state = await get_state(trainer_name)

    if state["state"] == "open":
        # Check if recovery timeout elapsed → half-open
        if utc_now().timestamp() - state["opened_at"] >= _RECOVERY_TIMEOUT_SEC:
            state.update({"state": "half-open", "successes": 0})
        return

    state["failures"] = state.get("failures", 0) + 1
    if state["failures"] >= _FAILURE_THRESHOLD:
        state.update({"state": "open", "opened_at": utc_now().timestamp()})
        logger.warning("circuit_breaker_opened", trainer=trainer_name)

    await _save(trainer_name, state)
```

When the circuit is open, `is_open()` returns `True` and the inference router immediately returns a `503 Service Unavailable` with `{"error": "MODEL_CIRCUIT_OPEN"}` rather than wasting time on a model it knows is broken.

This saved us twice in the first month. Both times, a model artifact got corrupted mid-upload to MinIO (partial writes during a network hiccup). Without the circuit breaker, every inference attempt would hang for 30 seconds on a `ConnectionTimeout` before failing. With it, the model suspended itself after five failures and failed fast until the artifact was restored.

---

## Stage 5: Inference Logging

Every inference — successful or failed — writes an `InferenceLog` document to MongoDB:

```python
class InferenceLog(Document):
    trainer_name: str
    model_version: str
    inputs: Optional[Dict[str, Any]]      # stored selectively (skip b64 blobs)
    output: Optional[Any]
    latency_ms: float
    error: Optional[str]
    ab_test_id: Optional[str]
    ab_variant: Optional[str]
    created_at: datetime

    class Settings:
        name = "inference_logs"
```

We don't store raw base64 images in the inference log — they'd balloon the collection to terabytes. Instead, `_prepare_inputs()` strips any field name containing `_b64` or `_key` before logging, and stores a reference to the S3 object key instead.

> **Hard-won lesson:** This stripping logic initially caused a bug. The early implementation passed the stripped dict (a DataFrame without `image_b64`) to the model itself, not just to the logger. The OCR model received a DataFrame without its primary input field and returned `{"error": "image_b64 is required"}` on every request. The fix: strip for logging only, always pass the original dict to the model.

---

## Data Drift Detection

Every six hours, the scheduler runs drift checks across all deployed models. We use two methods:

### Kolmogorov–Smirnov Test (numeric features)

```python
def _ks_drift(baseline_vals: list[float], current_vals: list[float]) -> tuple[float, bool]:
    try:
        from scipy.stats import ks_2samp
        stat, _ = ks_2samp(baseline_vals, current_vals)
        return stat, stat > _KS_THRESHOLD   # threshold = 0.20
    except ImportError:
        # Fallback: Z-score mean-shift comparison
        b_mean = sum(baseline_vals) / len(baseline_vals)
        c_mean = sum(current_vals) / len(current_vals)
        b_std = (sum((x-b_mean)**2 for x in baseline_vals)/len(baseline_vals))**0.5
        if b_std == 0:
            return 0.0, False
        z = abs(c_mean - b_mean) / b_std
        return z, z > _ZSCORE_THRESHOLD
```

### Population Stability Index (categorical features)

```python
def _psi(baseline_freqs: dict, current_freqs: dict) -> float:
    import math
    all_cats = set(baseline_freqs) | set(current_freqs)
    psi = 0.0
    for cat in all_cats:
        b = baseline_freqs.get(cat, 0.0001)
        c = current_freqs.get(cat, 0.0001)
        psi += (c - b) * math.log(c / b)
    return psi
```

PSI interpretation: < 0.1 no drift, 0.1–0.2 moderate drift, > 0.2 significant drift. When either test fires, a `DriftAlert` document is created and a Server-Sent Event is published to the monitoring UI.

The drift baseline is set manually (or automatically after a successful training run). You point it at the last N inference logs for a model, and it builds a statistical fingerprint of input distributions. All future checks compare against this fingerprint.

---

## The Monitoring Scheduler

Four jobs run on background schedules:

```python
# services/scheduler_service.py

_scheduler.add_job(
    _run_training_if_due,
    CronTrigger.from_crontab("*/30 * * * *"),     # every 30min — checks each trainer's schedule
    id="training_dispatcher",
)
_scheduler.add_job(
    _run_performance_snapshots,
    CronTrigger(minute=0),                         # top of every hour
    id="monitoring_performance_hourly",
)
_scheduler.add_job(
    _run_drift_checks,
    CronTrigger(hour="*/6", minute=5),             # every 6 hours
    id="monitoring_drift_check",
)
_scheduler.add_job(
    _run_alert_evaluation,
    CronTrigger(minute="*/5"),                     # every 5 minutes
    id="alert_evaluation",
)
```

The alert evaluator checks every enabled `AlertRule` against live metrics:

```python
# Supported metrics:
# - error_rate:     recent errors / recent requests (per model)
# - latency_p99:    99th percentile latency from recent logs
# - drift_score:    most recent open DriftAlert score
# - request_volume: request count in window
```

Each rule has a cooldown — it won't fire again until the cooldown expires, preventing alert storms during an incident.

---

## Authentication

The platform has two auth mechanisms:

### JWT (for human users)

Standard HS256 JWT with an 8-hour access token and 30-day refresh token. Password hashing uses stdlib PBKDF2-SHA256:

```python
_ITERATIONS = 260_000   # NIST recommended minimum for PBKDF2-SHA256

def _hash(password: str) -> str:
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return base64.b64encode(salt + key).decode()

def _verify(plain: str, stored: str) -> bool:
    data = base64.b64decode(stored.encode())
    salt, key = data[:32], data[32:]
    candidate = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, _ITERATIONS)
    return hmac.compare_digest(key, candidate)
```

> **Why not bcrypt?** We originally used `passlib[bcrypt]`. Passlib 1.7.4 is incompatible with `bcrypt >= 4.0` in a way that produces a runtime `ValueError: password cannot be longer than 72 bytes` — even for short passwords — due to an API change in the underlying `bcrypt` C library. Rather than pin to an old version, we dropped the dependency and used stdlib. PBKDF2-SHA256 at 260,000 iterations is entirely adequate for an internal tool.

### API Keys (for service-to-service)

Programmatic callers use `X-API-Key` headers. Keys are generated as `pms_ml_` + 32 random URL-safe bytes, stored as SHA-256 hashes (the raw key is shown once and never stored), with configurable per-minute rate limits and optional expiry:

```python
async def create_key(name: str, owner_email: str, ...) -> tuple[ApiKey, str]:
    raw_key = "pms_ml_" + secrets.token_urlsafe(32)
    record = ApiKey(
        name=name,
        key_prefix=raw_key[:12],        # displayed in UI — not sensitive
        key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
        owner_email=owner_email,
        ...
    )
    await record.insert()
    return record, raw_key    # raw_key returned once, never stored
```

---

## Batch Inference

The batch API accepts up to 10,000 rows as a JSON array, spins up an `asyncio.create_task()` to process them, and immediately returns a job ID:

```python
@router.post("/batch")
async def submit_batch(body: BatchRequest, ...):
    job = await batch_service.create_job(body.trainer_name, body.rows, user.email)
    return {"job_id": str(job.id), "status": "queued"}
```

The background task processes rows one at a time (respecting the circuit breaker and schema validation for each), writes results to MinIO as JSONL, and updates the job document with progress:

```python
async def _run_batch(job_id: str, rows: list[dict]) -> None:
    for i, row in enumerate(rows):
        try:
            result = await run_inference(job.trainer_name, row, log_result=False)
            results.append({"input": row, "output": result, "error": None})
            job.processed_rows += 1
        except Exception as e:
            results.append({"input": row, "output": None, "error": str(e)})
            job.failed_rows += 1
        await job.save()   # progress update after each row
```

Callers poll `GET /batch/{job_id}` for status. The UI shows a progress bar with live updates (5-second polling interval). When complete, results are available via `GET /batch/{job_id}/results` or downloadable as JSONL.

We deliberately didn't use a task queue (Celery, RabbitMQ) for this. `asyncio.create_task()` is sufficient for our batch sizes, and it keeps the architecture simpler. If we need to scale to millions of rows, we'll add a queue then.

---

## The Security Layer

Every request goes through `RequestLoggerMiddleware` before reaching any route handler. The middleware:

1. Looks up the requesting IP in the `IPRecord` collection
2. If banned → return `403` immediately, log the blocked request
3. Otherwise → let the request through, log metadata asynchronously
4. After the response → update the IP record's threat score

Threat scoring is incremental. Each request contributes a small positive or negative delta to the IP's score based on: HTTP method, path patterns (scanning `/admin`, `/wp-login`, etc.), response status, upload failure rate. The scheduler runs a nightly IP threat detector ML model (yes, a model that monitors the models) that re-scores all tracked IPs in bulk.

High-score IPs appear in the security dashboard for manual review. Operators can ban with a reason and optional expiry, or flag for investigation.

---

## What We'd Do Differently

**1. Use a proper task queue for batch jobs from day one.**
`asyncio.create_task()` works, but it means batch jobs die if the process restarts. A RabbitMQ-backed worker would be more robust. We're carrying this as technical debt.

**2. Design the plugin API with async in mind earlier.**
The original `BaseTrainer` had synchronous `train()` and `predict()` methods. Wrapping them in `asyncio.to_thread()` works, but it adds overhead and complexity. The new design has async-native versions.

**3. Separate the inference log store from the audit log.**
Both ended up in MongoDB, but with very different access patterns and retention requirements. Inference logs are high-volume, short-retention, append-only. Audit logs are low-volume, long-retention, compliance-sensitive. They should be in separate collections with separate indexes and retention policies from the start.

**4. Start with schema validation from day one.**
We added schema validation after the fact. Retrofitting it meant updating the inference pipeline, the trainer registration flow, and the UI simultaneously. If it had been part of the initial trainer contract, each plugin would have shipped with a schema by default.

---

## The Numbers

Since deploying:

- **5 trainer plugins** in production (meter OCR × 2, ticket classifier, rent predictor, IP threat detector)
- **~40,000 inference requests/day** at peak
- **2 circuit breaker trips** — both saved us from cascading failures during artifact corruption incidents
- **3 drift alerts** fired — one genuine (input distribution shifted after a meter reader hardware upgrade), two false positives (tuned the threshold after)
- **Zero auth incidents** — the API key system has made it straightforward to audit which integration is causing anomalous traffic

---

## Conclusion

Building your own ML platform is not for every team. Managed services exist for good reasons — they handle the infrastructure, the scaling, the security patching, and the MLOps primitives so you don't have to.

But if your threat model requires keeping data in-house, if you need the platform to integrate deeply with your existing infrastructure, or if you simply want to understand exactly what your production ML system is doing at every layer — it's entirely achievable with a disciplined team and the right architectural foundations.

The key principles that made this work:

1. **Treat ML infrastructure like any other backend domain.** Proper models, services, repositories, APIs. No special rules for the ML code.
2. **Observability first.** Drift detection, performance snapshots, and circuit breakers were designed in, not bolted on.
3. **The plugin system creates leverage.** A data scientist with no knowledge of the platform's internals can ship a new model type in a day.
4. **Prefer boring infrastructure.** MongoDB, Redis, S3 — tools the team already knows. The ML parts are interesting enough; the plumbing shouldn't be.

The codebase is part of the larger PMS monorepo. If you're building something similar, feel free to reach out — always happy to compare notes.

---

*Tagged: Python · FastAPI · Machine Learning · MLOps · React · MongoDB · System Design · Software Engineering*

---

**About this article:** This covers the architecture of PMS ML Studio, the ML inference and monitoring platform embedded in the PMS property management system. All code snippets are simplified for readability. The actual implementation handles additional edge cases, error handling, and multi-tenancy concerns not shown here.
