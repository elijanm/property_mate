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

## EMQX TLS Certificates

EMQX listens on port **8883** for TLS MQTT. A self-signed internal CA is used so devices can verify the broker without a public CA.

### Generate Certs (first time or to rotate)

```bash
bash scripts/gen-certs.sh
# Optional flags:
#   --host <hostname>   SAN hostname for the server cert (default: localhost)
#   --days <n>          Server cert validity in days (default: 825)
```

Outputs to `infra/docker/certs/`:

| File | Purpose |
|---|---|
| `ca.key` | CA private key — **never commit, keep secret** |
| `ca.crt` | CA certificate — distribute to IoT devices so they trust the broker |
| `server.key` | EMQX server private key |
| `server.crt` | EMQX server certificate (signed by CA) |

### Load CA into `.env`

The iot-service uses the CA to sign per-device certificates. Export it into `infra/docker/.env`:

```bash
# Linux / macOS
echo "IOT_CA_CERT_PEM=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0}' infra/docker/certs/ca.crt)" >> infra/docker/.env
echo "IOT_CA_KEY_PEM=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0}' infra/docker/certs/ca.key)"  >> infra/docker/.env
```

### Restart Services

```bash
docker compose -f infra/docker/docker-compose.yml restart emqx iot-service
```

### Verify TLS

```bash
# Check broker certificate
openssl s_client -connect localhost:8883 -CAfile infra/docker/certs/ca.crt

# Subscribe via MQTT over TLS
mosquitto_sub -h localhost -p 8883 \
  --cafile infra/docker/certs/ca.crt \
  -t test/topic -d

# Subscribe with mutual TLS (device cert)
mosquitto_sub -h localhost -p 8883 \
  --cafile  infra/docker/certs/ca.crt \
  --cert    infra/docker/certs/device1.crt \
  --key     infra/docker/certs/device1.key \
  -t test/topic -d
```

### Issue a Device Certificate (manual)

```bash
# 1. Generate device key
openssl ecparam -name prime256v1 -genkey -noout -out infra/docker/certs/device1.key

# 2. Create CSR  (CN = device UID registered in the system)
openssl req -new \
  -key infra/docker/certs/device1.key \
  -out infra/docker/certs/device1.csr \
  -subj "/CN=edge-node-001/O=PMS/OU=IoT-Devices"

# 3. Sign with internal CA
openssl x509 -req \
  -in  infra/docker/certs/device1.csr \
  -CA  infra/docker/certs/ca.crt \
  -CAkey infra/docker/certs/ca.key \
  -CAcreateserial \
  -out infra/docker/certs/device1.crt \
  -days 365 -sha256

# 4. Clean up CSR
rm infra/docker/certs/device1.csr
```

> In production the iot-service issues device certs automatically via the device provisioning API — manual issuance is only needed for testing.

### `.gitignore` Note

Ensure private keys are never committed:

```
infra/docker/certs/ca.key
infra/docker/certs/server.key
infra/docker/certs/*.key
```

---

## EMQX Configuration

Config file: `infra/docker/emqx/emqx.conf` (mounted read-only into the container).

### Listeners

| Port | Protocol | Purpose |
|---|---|---|
| `1883` | MQTT TCP | Plain — **dev only**, disable in production |
| `8883` | MQTT TLS (mTLS) | Production device connections — requires certs |
| `8083` | MQTT WebSocket | Browser / web clients |
| `8084` | MQTT Secure WebSocket | WSS — uses same server cert as 8883 |
| `18083` | HTTP | EMQX Dashboard |

### mTLS Settings (`listeners.ssl.default`)

```hocon
ssl_options {
  certfile             = "/opt/emqx/etc/certs/server.crt"
  keyfile              = "/opt/emqx/etc/certs/server.key"
  cacertfile           = "/opt/emqx/etc/certs/ca.crt"
  verify               = verify_peer          # enforce client cert
  fail_if_no_peer_cert = true                 # reject connections without cert
  versions             = [tlsv1.3, tlsv1.2]  # TLS 1.0/1.1 disabled
}
```

`verify_peer` + `fail_if_no_peer_cert = true` means every device **must** present a valid certificate signed by the internal CA. Connections without a cert are rejected at the TLS handshake — before MQTT CONNECT is even reached.

### Authentication & ACL (HTTP Hooks)

EMQX delegates both authentication and authorisation to the iot-service over HTTP.

| Hook | Endpoint | What it checks |
|---|---|---|
| MQTT CONNECT | `POST /api/v1/internal/emqx/auth/connect` | device_uid + bcrypt password vs MongoDB; also accepts cert CN as identity |
| PUB / SUB | `POST /api/v1/internal/emqx/auth/acl` | device topic ownership; `no_match = deny` so any unchecked topic is blocked |

Both hooks require the `X-Internal-Secret` header. Set this in `.env` and keep it in sync with `emqx.conf`:

```env
IOT_INTERNAL_SECRET=your-strong-random-secret
```

Update `emqx.conf` header block to match:
```hocon
headers {
  "X-Internal-Secret" = "your-strong-random-secret"
}
```

ACL results are cached for 60 seconds (`ttl = 60s`, `max_size = 10000`) to reduce iot-service load under high device counts.

### MQTT Protocol Limits

| Setting | Value | Notes |
|---|---|---|
| `max_packet_size` | 1 MB | Increase if payloads are larger (e.g. image uploads) |
| `max_topic_levels` | 8 | Matches PMS topic hierarchy depth |
| `max_qos_allowed` | 2 | Full QoS support |
| `session_expiry_interval` | 2 h | Offline devices retain session for 2 hours |
| `max_inflight` | 128 | In-flight QoS 1/2 messages per client |
| `max_mqueue_len` | 1024 | Queued messages for offline clients |

### IoT Service Environment Variables

| Variable | Description | Default |
|---|---|---|
| `EMQX_API_URL` | EMQX management API base URL | `http://emqx:18083` |
| `MQTT_BROKER_HOST` | Broker hostname from iot-service | `emqx` |
| `MQTT_BROKER_PORT` | Broker port (plain TCP inside Docker network) | `1883` |
| `MQTT_USERNAME` | iot-service's own MQTT credential | `iot-service` |
| `MQTT_PASSWORD` | iot-service's own MQTT password | ⚠ change in prod |
| `IOT_INTERNAL_SECRET` | Shared secret on EMQX → iot-service hooks | ⚠ change in prod |
| `IOT_CA_CERT_PEM` | PEM-encoded CA cert (newlines as `\n`) | set after `gen-certs.sh` |
| `IOT_CA_KEY_PEM` | PEM-encoded CA private key | set after `gen-certs.sh` |
| `IOT_CERT_VALIDITY_DAYS` | Days issued device certs are valid | `365` |

### EMQX Dashboard Credentials

Default credentials (change immediately in production):

```env
EMQX_DASHBOARD__DEFAULT_USERNAME=admin
EMQX_DASHBOARD__DEFAULT_PASSWORD=Admin@1234
```

Dashboard: `http://localhost:18083`

### Node Identity

`EMQX_NODE__NAME` must match the `hostname` in `docker-compose.yml` for Erlang distribution (clustering). Both are set to `emqx@pms_emqx`. If you rename the container, update both.

---

## Production Considerations

### Security

- **Disable plain TCP (1883)** — remove or comment out `listeners.tcp.default` in `emqx.conf` so all traffic is forced through TLS on 8883.
- **Rotate `X-Internal-Secret`** — the default `changeme-internal-secret` must be replaced before going live.
- **Rotate EMQX dashboard password** — default `Admin@1234` is public knowledge.
- **Rotate `node.cookie`** — default `pms-emqx-secret-cookie` must be changed; this protects Erlang cluster communication.
- **Do not commit `ca.key` or `server.key`** — add `infra/docker/certs/*.key` to `.gitignore`.
- **Use short-lived device certs in production** — set `IOT_CERT_VALIDITY_DAYS=90` and implement cert rotation via the provisioning API.

### TLS

- Certs generated by `gen-certs.sh` use **EC P-256** (faster handshake than RSA, smaller keys).
- Server cert SAN includes `localhost`, `pms_emqx`, and `127.0.0.1` — sufficient for dev and internal Docker networking. For production add your public hostname: `bash scripts/gen-certs.sh --host mqtt.yourdomain.com`.
- The CA cert is valid for **10 years** (`CA_DAYS=3650`); server cert is **825 days** (`SERVER_DAYS=825`, the maximum trusted by Apple/Chrome). Plan a rotation schedule.
- For production, consider replacing the self-signed CA with a proper PKI (e.g. HashiCorp Vault PKI, AWS Private CA) to automate device cert issuance and revocation.

### Scaling

- EMQX supports horizontal clustering — add nodes to `docker-compose.yml` using the same `node.cookie` and a shared load balancer on 8883.
- ACL cache (`ttl = 60s`) is per-node; in a cluster each node maintains its own cache independently.
- The iot-service auth pool is set to `pool_size = 32` — increase if auth hook latency rises under load.
- ThingsBoard MQTT is disabled (`MQTT_ENABLED: "false"`) — EMQX is the sole broker. Do not re-enable it.

### Windows Dev

- Shell scripts (`entrypoint.sh`, `gen-certs.sh`) must have **LF** line endings. A `.gitattributes` file enforces this. If `gen-certs.sh` fails on Windows, run it inside WSL2 or Git Bash, or use: `dos2unix scripts/gen-certs.sh`.
- `openssl` and `mosquitto_sub` are available via WSL2, Git for Windows, or `choco install openssl mosquitto`.

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

Proprietary — Nexidra. All rights reserved
