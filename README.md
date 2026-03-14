# PMS — Property Management System

A high-scale, multi-tenant property management platform built for portfolios of any size. Covers the full lifecycle: tenant onboarding, lease management, utilities & metering, billing, maintenance, inventory, IoT devices, voice agents, and ML training — all within isolated org tenants.

---

## Monorepo Structure

```
apps/
  backend/        FastAPI API service (stateless, port 8000)
  worker/         RabbitMQ background worker
  frontend/       React + Vite SPA (port 5173)
  iot/            IoT device gateway (EMQX hooks + device API, port 8020)
  voice-agent/    Pipecat voice agent service (Telnyx + Deepgram + LLM, port 8010)
  ml/             MLDock — ML training platform (FastAPI + MLflow, port 8030)
packages/
  shared/         Pydantic event payloads + queue/key constants (used by backend + worker)
infra/
  docker/         docker-compose.yml + .env.example
  k8s/            Kubernetes manifests
scripts/          Dev and maintenance scripts
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | FastAPI (async) |
| Database | MongoDB 7 (motor + beanie) |
| Cache / Locks | Redis 7 |
| Message Queue | RabbitMQ 3.13 (aio-pika, durable + retry + DLQ) |
| Search | OpenSearch 2.17 |
| Storage | S3-compatible (MinIO in dev, aioboto3) |
| ML | MLflow, PyTorch, custom trainer plugins |
| Voice | Pipecat, Telnyx, Deepgram STT, OpenAI/Anthropic/ElevenLabs |
| IoT | EMQX v5, ThingsBoard CE, Headscale |
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind CSS 3 |
| Observability | Prometheus, Grafana, Alertmanager, OpenTelemetry, structlog |

---

## Getting Started

### Prerequisites

- Docker + Docker Compose
- Node 20
- Python 3.12
- NVIDIA Container Toolkit (for GPU workloads)

### 1. Environment

```bash
cp infra/docker/.env.example infra/docker/.env
cp apps/frontend/.env.example apps/frontend/.env
# Fill in secrets: MONGODB_URL, REDIS_URL, JWT_SECRET, RESEND_API_KEY, S3 creds, etc.
```

### 2. Start Infrastructure

```bash
./scripts/dev.sh
# or
cd infra/docker && docker compose up -d
```

Services started:
- MongoDB (27017), Redis (6379), RabbitMQ (5672 / 15672), MinIO (9000 / 9001)
- OpenSearch (9200), MLflow (5000), EMQX (1883 / 18083), ThingsBoard (8080)
- backend (8000), worker, iot-service (8020), voice-agent (8010), ml-service (8030)
- frontend (5200)

### 3. Run Frontend Locally

```bash
cd apps/frontend
npm install
npm run dev          # http://localhost:5173
```

### 4. Run Backend Locally

```bash
cd apps/backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 5. Run Worker Locally

```bash
cd apps/worker
pip install -r requirements.txt
python -m app.main
```

---

## Key Concepts

### Multi-Tenancy

Every request is scoped to an `org_id` extracted from the JWT. All MongoDB queries, Redis keys, S3 paths, and OpenSearch documents are filtered by `org_id`. Cross-org data leakage is impossible by design.

### Auth Flow

```
POST /api/v1/auth/login → JWT
  ↓ Authorization: Bearer <jwt>
  ↓ get_current_user dependency → CurrentUser(user_id, org_id, role)
  ↓ require_roles("owner", "agent") → 403 if role mismatch
```

### Background Jobs

All async work (billing runs, PDF generation, settlements, media processing) is dispatched via RabbitMQ. Job status is tracked in the `job_runs` MongoDB collection and polled via `GET /api/v1/jobs/{job_id}`.

### Queue Pattern

Each queue has three variants:

```
<name>          main queue (x-dead-letter → retry exchange)
<name>.retry    TTL 30s then re-routes to main exchange
<name>.dlq      messages exhausting retries
```

### Soft Deletes

Hard deletes are forbidden on all org-scoped collections. Every document has `deleted_at: Optional[datetime]` — deletion sets this field. All queries filter `{"deleted_at": null}`.

---

## API

Base URL (production): `https://api.mldock.io` (ML service) / `https://api.pms.io` (core)

Interactive docs:
- Backend: `http://localhost:8000/docs`
- ML service: `http://localhost:8030/docs`
- IoT service: `http://localhost:8020/docs`

---

## ML Platform (MLDock)

Standalone ML training platform at `apps/ml/`. Features:

- Upload custom trainer plugins (Python classes)
- Train on CPU or NVIDIA GPU (auto-detected)
- MLflow experiment + model registry integration
- A/B testing, batch inference, model comparison APIs
- API key management for external access
- Web UI at port 5200

See the [API docs page](http://localhost:5200) for full endpoint reference with curl/Python samples.

---

## Voice Agent

Pipecat-based telephony AI at `apps/voice-agent/`. Handles inbound calls via Telnyx, transcribes with Deepgram, responds via configurable LLM (OpenAI / Anthropic / Ollama), and synthesizes speech via OpenAI TTS / ElevenLabs / Deepgram.

LLM tools available to the agent: tenant lookup, account summary, open tickets, lease details, STK push payment, maintenance ticket creation, human transfer, lease renewal, unit listings, lead capture, viewing scheduling.

---

## IoT

Device gateway at `apps/iot/`. EMQX authenticates devices via HTTP hook → iot-service. Events (meter readings, lock events, alerts, device status, lifecycle changes) are published to RabbitMQ and consumed by the worker.

---

## Testing

```bash
# Backend
pytest apps/backend/tests/ -v --asyncio-mode=auto

# Frontend
cd apps/frontend && npm run test

# Lint
./scripts/lint.sh
```

---

## Roles

| Role | Access |
|---|---|
| `superadmin` | Platform-wide, bypasses org scoping |
| `owner` | Full access within their org |
| `agent` | Assigned properties/tenants, no financial settings |
| `tenant` | Own lease, invoices, tickets |
| `service_provider` | Assigned maintenance tickets only |

---

## License

Proprietary — Nexidra. All rights reserved.
