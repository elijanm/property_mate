# We Built a Production-Grade ML Platform From Scratch — Here's What It Actually Takes

*Published on LinkedIn · [Your Name] · [Date]*

---

Most teams bolt ML onto their product as an afterthought. A notebook graduates to a Flask endpoint, someone wraps it in a Docker container, and suddenly it's "in production." Six months later nobody knows which model version is running, drift has gone undetected for weeks, and there's no way to roll back when something breaks.

We went a different route.

Over the past few months, we built **PMS ML Studio** — a fully self-hosted, production-grade machine learning platform embedded directly into our property management infrastructure. I want to share what we built, why we made the decisions we did, and what it actually takes to go from a model in a notebook to a system you can trust in production.

---

## The Problem We Were Solving

Our platform, PMS, is a multi-tenant property management system handling everything from tenant onboarding and lease signing to utility billing, maintenance ticketing, and financial settlements. Machine learning was a natural fit — meter reading OCR, ticket classification, IP threat scoring, rent prediction. But we needed these models to be:

- **Reliable** — a bad model rollout should never silently break a billing cycle
- **Observable** — we needed to know when a model's behavior changes before users notice
- **Auditable** — every deployment decision logged and traceable
- **Self-contained** — no dependency on a managed cloud ML service that would tie our data to a third-party

So we built our own.

---

## The Architecture

The platform runs as a standalone FastAPI service (`pms-ml`, port 8030) sitting alongside our main backend. It talks to the same MongoDB replica set, Redis cluster, and MinIO (S3-compatible) object store — no extra infrastructure.

**The key design insight:** ML operations are just another domain in the system. They deserve the same architecture discipline as payments or billing — proper models, repositories, services, and APIs.

The core stack:
- **FastAPI** (async, stateless)
- **MongoDB + Beanie ODM** for all state
- **MLflow** for experiment tracking and model registry
- **MinIO** for artifact storage (models, batch results, meter images)
- **Redis** for circuit breaker state, caching
- **APScheduler** for background jobs (performance snapshots, drift checks, alert evaluation)
- **React + Vite + TypeScript** for the internal UI

---

## The Plugin System

The most important architectural decision was making trainers **pluggable**.

Every model type is a Python class that inherits from `BaseTrainer`. Drop a `.py` file into the `/trainers` directory — the platform discovers it at startup, registers it, and it immediately appears in the UI. No restarts, no config changes.

```python
class WaterMeterOCR(BaseTrainer):
    name = "water-meter-ocr"

    def train(self, data, config):
        # fine-tune your OCR model
        ...

    def predict(self, inputs):
        # return meter reading from base64 image
        ...
```

This means data scientists can ship a new model type the same way an engineer ships a feature — via a pull request. The platform handles everything else: training job management, MLflow logging, deployment, versioning, inference routing, monitoring.

We currently have five trainer plugins in production: meter OCR (two variants), ticket classifier, rent predictor, and IP threat detector.

---

## What "Production-Grade" Actually Means

Here's what we built beyond the basics:

### 1. A/B Testing with Live Traffic Splitting

Before promoting a new model version, we route a configurable percentage of real traffic to the challenger. The platform tracks per-variant request volume, error rate, latency, and accuracy (when ground truth labels are available). Operators can declare a winner and conclude the test — or roll back instantly.

No more "we think v2 is better based on offline eval." Now we know.

### 2. Circuit Breakers

Every model has a Redis-backed circuit breaker. Five consecutive inference failures → the circuit opens → that model version is suspended and requests fail fast rather than piling up. After a two-minute recovery window, the circuit goes half-open: one test request goes through, and if it succeeds, normal service resumes.

This pattern, borrowed from distributed systems, turned out to be one of the most valuable additions. It saved us twice during the first month when a model artifact got corrupted during an upload.

### 3. Data Drift Detection

We maintain a statistical baseline for every model's input features. Every six hours, the scheduler runs a two-sample Kolmogorov–Smirnov test (numeric features) and Population Stability Index (categorical features) against recent inference inputs. If drift exceeds the configured threshold, a `DriftAlert` is raised and published as a Server-Sent Event to the monitoring dashboard.

This isn't novel ML research — KS and PSI are decades-old tools. But having them running automatically, on every model, every six hours, without any manual intervention, is the difference between "we have drift detection" and "we actually catch drift."

### 4. Hourly Performance Snapshots

Every hour, the scheduler aggregates the last hour of inference logs into a `PerformanceSnapshot`: request volume, error rate, p50/p95/p99 latency, unique callers. These are stored in MongoDB and visualised in the monitoring dashboard as time-series charts.

Combined with alert rules (configurable thresholds on any metric, with webhook notifications and configurable cooldowns), this means the on-call engineer gets paged before a degrading model becomes a user-facing incident.

### 5. Batch Inference

Not everything is real-time. Billing runs, bulk property reports, and data migration tasks need to run inference on thousands of rows. The batch API accepts up to 10,000 input rows as a JSON array, processes them asynchronously, stores results in S3 as JSONL, and exposes a polling endpoint. The UI shows live progress and lets you download the results.

### 6. SHAP Explainability

For every stored inference, you can request a SHAP explanation — feature importance scores showing which inputs drove that specific prediction. When SHAP isn't available for a model type, we fall back to a magnitude-proxy approximation. Not perfect, but always something.

This turned out to be essential for the maintenance ticket classifier. When property managers questioned why a ticket was routed to a specific vendor, we could show them the top contributing features.

### 7. API Key Management

Programmatic access to the inference API goes through scoped API keys — not JWTs. Keys are stored as SHA-256 hashes (never in plaintext), have configurable per-minute rate limits, optional expiry dates, and usage counters. The UI shows usage statistics and lets you revoke keys instantly.

### 8. Audit Trail

Every admin action — deployment, ban, rollback, key revocation, A/B test conclusion — writes an immutable `AuditLog` document. Actor email, action, resource type, resource ID, IP address, timestamp. No exceptions. This turned out to be more important than we expected during a post-incident review when we needed to establish exactly when and by whom a model was deployed.

### 9. Security Layer

Every incoming request is scored against a threat model. Unusual access patterns, scanning behaviour, repeated upload failures — these build up a threat score per IP address. High-score IPs can be banned automatically or manually. The security dashboard shows blocked request rates, top suspicious IPs, and recent threat events.

This isn't a replacement for a WAF — but for an internal ML API that handles sensitive inputs like ID photos and meter images, it's been worth having.

---

## The Part Nobody Talks About

The hardest part of this project wasn't the ML. It was the operational discipline.

**Model artifact integrity.** We discovered that MLflow's PythonModel serialisation uses cloudpickle, which embeds class method bytecode directly into the pickle. Patching a source file in S3 does nothing — you have to re-pickle the entire model instance. We found this out the hard way when an S3 path sanitisation bug needed an emergency fix in production.

**Dependency hell.** `passlib[bcrypt]` and `bcrypt>=4.0` are silently incompatible in a way that produces a cryptic runtime error. We switched the password hashing to stdlib PBKDF2-SHA256 and removed the dependency entirely.

**Async everywhere, or nowhere.** Mixing sync and async code in Python's asyncio is a footgun. One blocking `time.sleep()` in a trainer plugin stalled the entire inference loop. We enforce `await`-only patterns in the service layer and sandbox plugin execution.

---

## What's Next

A few things on the roadmap:

- **Label ingestion pipeline** — close the feedback loop by ingesting ground truth labels for accuracy tracking over time
- **Schema registry** — enforce input/output schemas at the API boundary to catch model regressions early
- **Shadow mode deployments** — run a challenger model in parallel without routing real traffic, purely for offline comparison
- **Experiment comparison UI** — side-by-side MLflow run comparison is in the codebase; the full visualisation is next

---

## Closing Thought

The gap between "a model that works in a notebook" and "a model you can trust in production" is enormous. Drift detection, circuit breakers, A/B testing, audit trails — none of this is intellectually complex. It's just disciplined engineering applied to the ML domain.

The teams that close that gap are the ones that treat ML infrastructure the same way they treat payments infrastructure: with the same rigor, the same observability requirements, and the same zero-tolerance for silent failures.

We're not a large team. But we now have a platform that would be recognisable to anyone who has worked at a company that takes ML seriously. That feels worth sharing.

---

*If you're building something similar or want to compare notes, reach out.*

*#MachineLearning #MLOps #SoftwareEngineering #ProductEngineering #Python #FastAPI #React*

---

> **Internal note:** This article covers the PMS ML Studio platform (`apps/ml/`). For technical documentation see `docs/plugin-guide.html`. Default admin access: `admin@pms-ml.local` / configured via `DEFAULT_ADMIN_PASSWORD` env var.
