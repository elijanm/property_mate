# PMS Cluster — Admin Operations Guide

## Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Starting the Cluster](#3-starting-the-cluster)
4. [GPU Cluster](#4-gpu-cluster)
5. [Split Sandbox](#5-split-sandbox)
6. [Service Port Reference](#6-service-port-reference)
7. [Environment Variables](#7-environment-variables)
8. [Monitoring & Dashboards](#8-monitoring--dashboards)
9. [Scaling](#9-scaling)
10. [Backup & Restore](#10-backup--restore)
11. [Runbooks](#11-runbooks)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker Engine | ≥ 26 | `docker --version` |
| Docker Compose plugin | ≥ 2.27 | `docker compose version` |
| Available RAM | ≥ 16 GB | 32 GB recommended with ML stack |
| Disk space | ≥ 40 GB | For volumes, images, model artifacts |
| nvidia-container-toolkit | Latest | GPU nodes only — `nvidia-smi` must work |

**Verify Docker is running:**
```bash
docker info
docker compose version
```

---

## 2. First-Time Setup

### 2.1 Clone and configure environment

```bash
cd infra/docker

# Copy example env and fill in secrets
cp .env.example .env
nano .env   # or use your editor
```

Minimum required changes in `.env`:

```env
# Change from defaults before exposing to any network
GF_SECURITY_ADMIN_PASSWORD=your-secure-grafana-password
WUZAPI_ADMIN_TOKEN=your-wuzapi-token

# External access URLs (used in email links, OAuth callbacks)
ML_APP_BASE_URL=http://your-server-ip:8030
ML_FRONTEND_BASE_URL=http://your-server-ip:5200
```

### 2.2 Generate TLS certs (optional — required for MQTT over TLS)

```bash
bash ../../scripts/gen-certs.sh
# Copies certs to infra/docker/certs/
```

### 2.3 Build all images

Build from source once before first `up`:

```bash
# From repo root
docker compose -f infra/docker/docker-compose.yml build
```

This builds: `backend`, `worker`, `frontend`, `ml-service`, `ml-worker`, `ml-ui`, `iot-service`.

### 2.4 Start the cluster

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

### 2.5 Wait for health checks

```bash
# Watch until all services are healthy
watch -n 3 'docker compose -f infra/docker/docker-compose.yml ps'
```

Services start in dependency order. Allow up to 2–3 minutes for ThingsBoard's JVM to boot.

### 2.6 Verify the stack

```bash
# Quick smoke test — all should return HTTP 200
curl -sf http://localhost:8001/api/v1/health && echo "backend OK"
curl -sf http://localhost:8030/health          && echo "ml-service OK"
curl -sf http://localhost:8020/api/v1/health   && echo "iot-service OK"
curl -sf http://localhost:5510/health          && echo "mlflow OK"
curl -sf http://localhost:9090/-/healthy       && echo "prometheus OK"
```

---

## 3. Starting the Cluster

### Full stack (all services)

```bash
cd infra/docker
docker compose up -d
```

### Core infra only (no ML, no IoT)

```bash
docker compose up -d mongodb redis rabbitmq opensearch minio backend worker frontend
```

### ML stack only (start after core infra)

```bash
docker compose up -d mlflow ml-service ml-worker ml-ui
```

### IoT stack only

```bash
docker compose up -d emqx thingsboard-db thingsboard headscale iot-service
```

### Restart a single service

```bash
docker compose restart ml-service

# Or rebuild and restart after a code change
docker compose up -d --build ml-service
```

### Stop the cluster (keep volumes)

```bash
docker compose down
```

### Destroy everything including volumes (DESTRUCTIVE)

```bash
docker compose down -v
```

---

## 4. GPU Cluster

GPU services require:
- Linux host (Docker Desktop on macOS/Windows does NOT support GPU passthrough)
- NVIDIA driver installed (`nvidia-smi` must return output)
- `nvidia-container-toolkit` installed

### Install nvidia-container-toolkit (Ubuntu)

```bash
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Start with GPU support

Apply the GPU overlay on top of the base compose file:

```bash
docker compose \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.gpu.yml \
  up -d
```

This passes 1 GPU to `ml-service`. The base services are unchanged.

### Start with GPU + split sandbox

```bash
docker compose \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.gpu.yml \
  --profile split-sandbox \
  up -d
```

This brings up `sandbox-prod-gpu` (and `sandbox-test-gpu`) in addition to the base services.

### Build GPU sandbox image

```bash
docker build \
  -t pms-ml-sandbox-gpu:latest \
  -f apps/ml/Dockerfile.sandbox-gpu \
  apps/ml/
```

### Verify GPU is visible inside container

```bash
docker compose exec ml-service python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Expected output: `True NVIDIA GeForce ...` (or your GPU model).

---

## 5. Split Sandbox

Split sandbox mode routes trainer execution to dedicated, isolated containers:

| Tier | Queue | Data | Use case |
|---|---|---|---|
| `sandbox-test` | `sandbox:test:jobs` | Fixture (no real data) | Editor "Test" button |
| `sandbox-prod-cpu` | `sandbox:prod:cpu:jobs` | Real org data | Production training (CPU) |
| `sandbox-prod-gpu` | `sandbox:prod:gpu:jobs` | Real org data | Production training (GPU) |

### Enable split sandbox

In `.env`:

```env
SANDBOX_SPLIT_MODE=true
```

### Build sandbox images

```bash
# CPU sandbox (used by sandbox-test and sandbox-prod-cpu)
docker build -t pms-ml-sandbox:latest -f apps/ml/Dockerfile.sandbox apps/ml/

# GPU sandbox (used by sandbox-prod-gpu — Linux + NVIDIA only)
docker build -t pms-ml-sandbox-gpu:latest -f apps/ml/Dockerfile.sandbox-gpu apps/ml/
```

### Start with split sandbox profile

```bash
docker compose --profile split-sandbox up -d
```

### Scale the test sandbox (handle more concurrent editor tests)

```bash
docker compose up -d --scale sandbox-test=4
```

### Monitor sandbox queues

```bash
# Job counts per tier (live)
watch -n 2 "redis-cli -h localhost -p 6379 \
  LLEN sandbox:test:jobs \
  LLEN sandbox:prod:cpu:jobs \
  LLEN sandbox:prod:gpu:jobs"
```

### Force drain a stuck job

```bash
# List all keys for a specific job
redis-cli --scan --pattern "sandbox:job:<JOB_ID>:*"

# Remove a stuck job from the queue
redis-cli LREM sandbox:prod:cpu:jobs 0 "<JOB_ID>"
```

---

## 6. Service Port Reference

| Service | Host Port | Description |
|---|---|---|
| **backend** | 8001 | PMS API (FastAPI) |
| **worker** | — | Background job worker (no HTTP port) |
| **frontend** | 5174 | React UI (HTTP) |
| **ml-service** | 8030 | ML API (FastAPI) |
| **ml-worker** | — | ML training worker (no HTTP port) |
| **ml-ui** | 5200 (HTTP) / 5443 (HTTPS) | MLDock UI |
| **iot-service** | 8020 | IoT management API |
| **voice-agent** | 8010 | Voice call handling |
| **mongodb** | 27018 | MongoDB (maps to 27017 inside) |
| **redis** | 6379 | Redis |
| **rabbitmq** | 5672 (AMQP) / 15672 (Management) / 15692 (Prometheus) | RabbitMQ |
| **opensearch** | 9200 | OpenSearch REST API |
| **minio** | 9000 (API) / 9001 (Console) | MinIO object storage |
| **mlflow** | 5510 | MLflow tracking UI + API |
| **emqx** | 1883 (MQTT) / 8883 (MQTT TLS) / 18083 (Dashboard) / 8083 (MQTT-WS) | EMQX broker |
| **thingsboard** | 8081 | ThingsBoard UI + REST API |
| **headscale** | 8085 | Headscale VPN API |
| **wuzapi** | 3100 | WhatsApp API |
| **prometheus** | 9090 | Prometheus TSDB + query UI |
| **alertmanager** | 9093 | Alert routing |
| **grafana** | 3004 | Grafana dashboards |

### Internal-only (no host port)

| Service | Internal |
|---|---|
| cadvisor | :8080 (scraped by Prometheus) |
| node-exporter | :9100 (host network) |
| redis-exporter | :9121 |
| mongodb-exporter | :9216 |

---

## 7. Environment Variables

All variables are read from `infra/docker/.env`. See `.env.example` for defaults.

### Secrets to change before production

```env
GF_SECURITY_ADMIN_PASSWORD=        # Grafana admin password
WUZAPI_ADMIN_TOKEN=                 # WhatsApp API token
JWT_SECRET=                         # Backend JWT signing secret
ML_JWT_SECRET=                      # ML service JWT signing secret
EMQX_DASHBOARD__DEFAULT_PASSWORD=   # EMQX dashboard password (in docker-compose.yml)
S3_ACCESS_KEY= / S3_SECRET_KEY=     # MinIO credentials
MONGODB_INITDB_ROOT_PASSWORD=       # MongoDB root password (if auth enabled)
```

### OAuth variables (Google + GitHub login)

```env
GOOGLE_CLIENT_ID=                 # From console.cloud.google.com → Credentials → OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=                 # From github.com/settings/applications/new
GITHUB_CLIENT_SECRET=
```

**Setup — Google:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → **Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Add authorised redirect URI: `https://<your-domain>/oauth/callback/google` (and `http://localhost:5200/oauth/callback/google` for local dev)
4. Copy **Client ID** and **Client secret** into `.env`

**Setup — GitHub:**
1. Go to [github.com/settings/applications/new](https://github.com/settings/applications/new)
2. Homepage URL: `https://<your-domain>`
3. Authorization callback URL: `https://<your-domain>/oauth/callback/github`
4. Copy **Client ID** and generate a **Client secret**, paste into `.env`

Both providers are disabled when the corresponding client ID is empty — no restart needed, the UI buttons stay functional and show a `503` if clicked without credentials.

---

### ML-specific variables

```env
TRAINER_SANDBOX=none|docker|docker-pool    # Sandbox execution mode
SANDBOX_SPLIT_MODE=true|false              # Enable tiered split sandbox
SANDBOX_POOL_MIN_SIZE=2                    # docker-pool min containers
SANDBOX_POOL_MAX_SIZE=10                   # docker-pool hard cap
CUDA_DEVICE=auto|cpu|cuda|cuda:0           # GPU selection in ml-worker
ML_RESEND_API_KEY=                         # Email API key for ML service
```

### GPU-specific variables

```env
SANDBOX_PROD_GPU_TIMEOUT=28800     # GPU job timeout (seconds, default 8h)
SANDBOX_PROD_GPU_CPUS=8            # CPU limit for GPU sandbox container
SANDBOX_PROD_GPU_MEMORY=16g        # RAM limit for GPU sandbox container
SANDBOX_GPU_RATE_PER_HOUR=2.40     # USD/hour charged to user balance
```

---

## 8. Monitoring & Dashboards

### Access URLs

| Tool | URL | Default credentials |
|---|---|---|
| Grafana | http://localhost:3004 | admin / (from .env) |
| Prometheus | http://localhost:9090 | None |
| Alertmanager | http://localhost:9093 | None |
| RabbitMQ | http://localhost:15672 | guest / guest |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| EMQX Dashboard | http://localhost:18083 | admin / Admin@1234 |
| MLflow | http://localhost:5510 | None |
| ThingsBoard | http://localhost:8081 | sysadmin@thingsboard.org / sysadmin |

### Grafana dashboards

Two dashboards auto-provision on Grafana startup (no manual import needed):

| Dashboard | UID | Description |
|---|---|---|
| PMS Overview | `pms-overview` | High-level service health + HTTP traffic |
| PMS Cluster Health | `pms-cluster` | Full stack: host, containers, ML, Redis, MongoDB, RabbitMQ |

Navigate to **Grafana → Dashboards → PMS** to find them.

If dashboards are missing after first start:

```bash
# Restart Grafana to re-run provisioning
docker compose restart grafana
```

### Key metrics to watch

| Metric | Alert threshold | Dashboard panel |
|---|---|---|
| `up == 0` | Any | Service Health row |
| Host CPU % | > 85% for 5 min | Host Resources |
| Host memory % | > 85% for 5 min | Host Resources |
| Disk used % | > 85% | Cluster Overview gauge |
| Backend p95 latency | > 2s | HTTP Traffic row |
| ML inference p95 latency | > 5s | ML Platform row |
| `ml_sandbox_queue_depth` | > 20 | Sandbox Queue Depth panel |
| RabbitMQ DLQ depth | > 0 | Dead Letter Queue panel |
| Redis evictions | > 0 / 5 min | Redis row |
| MongoDB connections | > 500 | MongoDB row |

### Prometheus targets health

Check which scrape targets are down:

```
http://localhost:9090/targets
```

All targets should show **UP**. If a target is down, the corresponding service is either not running or not exposing `/metrics`.

### Check Prometheus rules and alerts

```bash
# See all alert rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[] | {name:.name, state:.state}'

# See currently firing alerts
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {labels:.labels, state:.state}'
```

### Alertmanager

Configure alert routing in `infra/docker/prometheus/alertmanager.yml`.

To test that alerts reach Alertmanager:

```bash
curl -s http://localhost:9093/api/v2/alerts | jq .
```

---

## 9. Scaling

### Horizontal scaling (multiple replicas)

**Backend API:**
```bash
docker compose up -d --scale backend=3
# Put a load balancer (nginx/traefik) in front of backends
```

**ML worker (parallel training):**
```bash
docker compose up -d --scale ml-worker=2
```

**Sandbox test tier:**
```bash
docker compose up -d --scale sandbox-test=5
```

**Sandbox CPU prod tier:**
```bash
docker compose up -d --scale sandbox-prod-cpu=3
```

### Vertical scaling

Edit resource limits in `docker-compose.yml` under `deploy.resources.limits`:

```yaml
sandbox-prod-cpu:
  deploy:
    resources:
      limits:
        cpus: "8"        # increase from 4
        memory: "8g"     # increase from 4g
```

### Docker pool auto-scaling (ML sandbox)

When `TRAINER_SANDBOX=docker-pool`, the pool manager auto-scales between `SANDBOX_POOL_MIN_SIZE` and `SANDBOX_POOL_MAX_SIZE` based on 1-minute request rate. See `infra/docker/docs/ml-sandbox.md` for tuning parameters.

Check current pool state:

```bash
redis-cli HGETALL ml:pool:metrics
```

Expected fields: `pool_size`, `idle_count`, `busy_count`, `warming_count`, `queue_depth`, `req_rate_1m`.

### Multi-node (scale to multiple machines)

See `infra/docker/scale/` for machine1/machine2/machine3 compose files and the MongoDB replica set init scripts.

---

## 10. Backup & Restore

### MongoDB

**Backup:**
```bash
docker compose exec mongodb mongodump \
  --out /tmp/mongo-backup-$(date +%Y%m%d)
docker cp $(docker compose ps -q mongodb):/tmp/mongo-backup-$(date +%Y%m%d) ./backups/
```

**Restore:**
```bash
docker cp ./backups/mongo-backup-20260324 $(docker compose ps -q mongodb):/tmp/restore
docker compose exec mongodb mongorestore /tmp/restore
```

### Redis

**Backup (RDB snapshot):**
```bash
docker compose exec redis redis-cli BGSAVE
docker cp $(docker compose ps -q redis):/data/dump.rdb ./backups/redis-$(date +%Y%m%d).rdb
```

**Restore:**
```bash
docker compose stop redis
docker cp ./backups/redis-20260324.rdb $(docker compose ps -q redis):/data/dump.rdb
docker compose start redis
```

### MinIO (model artifacts + media)

**Full bucket sync to local:**
```bash
docker run --rm --network infra_default \
  minio/mc:latest \
  mirror local/pms-ml /backup/pms-ml
```

Or configure `mc mirror` with `--watch` for continuous sync to an offsite S3 bucket.

### MLflow

MLflow uses SQLite (`mlflow.db` inside the `mlflow_data` volume) + MinIO artifacts.

**Backup MLflow DB:**
```bash
docker compose exec mlflow sqlite3 /mlflow/mlflow.db ".dump" > ./backups/mlflow-$(date +%Y%m%d).sql
```

### Grafana dashboards

Dashboards are file-provisioned — they live in `infra/docker/grafana/provisioning/dashboards/*.json` and are in source control. No separate backup needed.

---

## 11. Runbooks

### R1 — Service is down

1. Check container state:
   ```bash
   docker compose ps <service-name>
   docker compose logs --tail=50 <service-name>
   ```

2. Restart the service:
   ```bash
   docker compose restart <service-name>
   ```

3. If the container keeps crashing, check for OOM kills:
   ```bash
   docker inspect $(docker compose ps -q <service-name>) | jq '.[0].State.OOMKilled'
   ```
   If true → increase memory limit in `deploy.resources.limits` or reduce load.

4. Rebuild if caused by code change:
   ```bash
   docker compose up -d --build <service-name>
   ```

---

### R2 — RabbitMQ queue backlog / consumer missing

```bash
# Check queue lengths
curl -s -u guest:guest http://localhost:15672/api/queues | \
  jq '.[] | {name:.name, messages:.messages, consumers:.consumers}'

# If a queue has messages but 0 consumers, restart the worker
docker compose restart worker          # PMS worker
docker compose restart ml-worker       # ML worker

# If messages piled up in DLQ, inspect them
curl -s -u guest:guest "http://localhost:15672/api/queues/%2F/billing.runs.dlq/get" \
  -d '{"count":5,"requeue":false,"encoding":"auto"}' -X POST
```

---

### R3 — ML training job stuck / not completing

```bash
# Check job status in MongoDB
docker compose exec mongodb mongosh pms_ml --eval \
  "db.training_jobs.find({status:{$in:['queued','running']}}).sort({created_at:-1}).limit(10).pretty()"

# Check ML worker logs
docker compose logs --tail=100 -f ml-worker

# Check sandbox queue depth
redis-cli LLEN sandbox:prod:cpu:jobs
redis-cli LLEN sandbox:prod:gpu:jobs

# Cancel a stuck job (sets status=failed in DB)
docker compose exec mongodb mongosh pms_ml --eval \
  "db.training_jobs.updateOne({_id: ObjectId('<JOB_ID>')}, {\$set: {status:'failed', error:'manually cancelled'}})"
```

---

### R4 — Redis out of memory / evicting keys

```bash
# Check memory
redis-cli INFO memory | grep -E "used_memory_human|maxmemory_human|mem_fragmentation"

# Check current eviction policy
redis-cli CONFIG GET maxmemory-policy

# See which keys are taking the most space (top 10 by type)
redis-cli --bigkeys

# Flush only ML pool keys (NOT the full DB!)
redis-cli --scan --pattern "ml:pool:*" | xargs redis-cli DEL
```

If consistently hitting the limit, increase `maxmemory` in `redis.conf` or expand the VM.

---

### R5 — Disk space low

```bash
# Check disk usage
df -h /

# Find large Docker volumes
docker system df -v | sort -k4 -rh | head -20

# Remove unused Docker images and stopped containers
docker system prune -f

# Remove old MLflow artifacts (keep last N runs per experiment)
# Use MLflow CLI or UI to delete old runs
docker compose exec mlflow mlflow gc --backend-store-uri sqlite:////mlflow/mlflow.db
```

---

### R6 — MongoDB slow queries

```bash
# Enable profiling (logs queries > 100ms)
docker compose exec mongodb mongosh pms --eval \
  "db.setProfilingLevel(1, {slowms: 100})"

# View slow queries
docker compose exec mongodb mongosh pms --eval \
  "db.system.profile.find().sort({ts:-1}).limit(10).pretty()"

# Check current operations
docker compose exec mongodb mongosh --eval "db.currentOp({active:true})"
```

---

### R7 — Grafana shows "No data" on all panels

1. Check that Prometheus is reachable from Grafana:
   ```bash
   docker compose exec grafana wget -qO- http://prometheus:9090/-/healthy
   ```

2. Verify the datasource is configured with uid `prometheus`:
   - Go to **Grafana → Connections → Data Sources → Prometheus**
   - The UID shown should be `prometheus`
   - If not, the dashboard JSON's `"uid": "prometheus"` references won't match — delete and re-provision:
     ```bash
     docker compose restart grafana
     ```

3. If Prometheus has no data, check scrape targets:
   ```
   http://localhost:9090/targets
   ```

---

### R8 — Sandbox containers fail to install trainer requirements (pip fails)

Sandbox containers join `pms_pip_net` for internet egress. If pip fails:

```bash
# Check if pms_pip_net has internet access
docker run --rm --network pms_pip_net alpine ping -c2 pypi.org

# Check sandbox container logs
docker compose logs --tail=50 sandbox-prod-cpu
```

If the network doesn't exist yet:
```bash
docker network create pms_pip_net
docker compose up -d sandbox-prod-cpu
```

---

### R9 — Check ML inference model loaded / not loaded

```bash
# List loaded models via ML API
curl -s -H "Authorization: Bearer <TOKEN>" \
  http://localhost:8030/api/v1/ml/models | jq '.[].trainer_name'

# Check if a specific model version is registered in MLflow
curl -s http://localhost:5510/api/2.0/mlflow/registered-models/list | \
  jq '.registered_models[].name'
```

---

### R10 — View structured logs for a service

All services emit JSON-structured logs via structlog.

```bash
# Pretty-print JSON logs for backend
docker compose logs --tail=100 backend | jq -r '. | "\(.timestamp) [\(.level)] \(.action) \(.status // "") \(.error_code // "")"'

# Filter for errors only
docker compose logs backend 2>&1 | grep '"level":"error"' | jq .

# Follow ML worker logs with pretty print
docker compose logs -f ml-worker | python3 -c "
import sys, json
for line in sys.stdin:
    try: print(json.dumps(json.loads(line), indent=2))
    except: print(line, end='')
"
```

---

### R11 — OAuth login not working ("503 not configured" or redirect loop)

**Symptom:** Clicking "Sign in with Google/GitHub" returns 503, or the user is redirected back to the login page with no error.

**Check 1 — credentials are set:**
```bash
docker compose exec ml-service env | grep -E "GOOGLE|GITHUB"
```
All four vars must be non-empty. If blank, fill in `.env` and restart:
```bash
docker compose up -d --force-recreate ml-service
```

**Check 2 — redirect URI is registered:**
The callback URL `https://<domain>/oauth/callback/google` (or `/github`) must be listed in the provider's console exactly — no trailing slash, correct scheme (http vs https). Mismatch causes a `redirect_uri_mismatch` error from the provider.

**Check 3 — exchange endpoint reachable from browser:**
```bash
curl -s http://localhost:8030/api/v1/auth/oauth/google/url?redirect_uri=http://localhost:5200/oauth/callback/google | jq .
```
Should return `{"url": "https://accounts.google.com/...", "state": "..."}`.

**Check 4 — ml-service can reach Google/GitHub (outbound HTTPS):**
```bash
docker compose exec ml-service python3 -c "import httpx; print(httpx.get('https://accounts.google.com').status_code)"
```
Expected: `200`. If it fails, check firewall/proxy rules on the host.
