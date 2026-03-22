# ML Trainer Sandbox

The ML service supports three isolation modes for executing user-uploaded trainer code.
Set `TRAINER_SANDBOX` in `.env` or in `docker-compose.yml` to select a mode.

---

## Modes

| `TRAINER_SANDBOX` | Description | Latency | Security |
|---|---|---|---|
| `none` | Trainer runs in the Celery worker process | Fastest | No process isolation |
| `docker` | Cold `docker run` per job — new container every request | High (3–8 s cold start) | Full isolation |
| `docker-pool` | Pre-warmed container pool — containers stay alive between jobs | Low (<50 ms dispatch) | Full isolation + auto-scaling |

---

## none (default)

Trainer code is imported and executed inside the same process as the ml-worker. The AST
security gate and `scrubbed_env()` context manager are still active. No Docker required.

```env
TRAINER_SANDBOX=none
```

---

## docker

Each training or inference job spawns a fresh `docker run`, waits for it to finish, and
reads the result from a shared named volume. The container exits after the job completes.

```env
TRAINER_SANDBOX=docker
TRAINER_SANDBOX_IMAGE=pms-ml-sandbox:latest
TRAINER_SANDBOX_MEMORY=2g
TRAINER_SANDBOX_CPUS=2
TRAINER_SANDBOX_TIMEOUT=600
```

**Build the sandbox image first:**
```bash
docker build -t pms-ml-sandbox:latest apps/ml/sandbox/
```

**Requires** the ml-worker container to have:
- `/var/run/docker.sock` mounted (to spawn containers)
- `ml_sandbox_workspace` named volume mounted at `/sandbox_workspace`

---

## docker-pool

A pool of pre-warmed containers is maintained at all times. Each container runs
`agent.py` — a long-lived process that polls Redis for job assignments, forks
`runner.py` as a subprocess for each job, then returns to idle.

A predictive scaler monitors the 1-minute request rate and queue depth, pre-spawning
containers before demand arrives (configurable lead time, default 8 s).

```env
TRAINER_SANDBOX=docker-pool
TRAINER_SANDBOX_IMAGE=pms-ml-sandbox:latest
TRAINER_SANDBOX_MEMORY=2g
TRAINER_SANDBOX_CPUS=2
TRAINER_SANDBOX_TIMEOUT=600

# Pool sizing
SANDBOX_POOL_MIN_SIZE=2        # always-on minimum
SANDBOX_POOL_MAX_SIZE=10       # hard cap
SANDBOX_POOL_MIN_IDLE=1        # trigger scale-up when idle drops below this
```

---

## Architecture (docker-pool)

```
ml-worker process
├── PoolManager          (background loops: health, replenish, scaler, metrics)
├── PredictiveScaler     (sliding-window rate → desired_idle → spawn/drain)
└── pool_sandbox_runner  (acquire → dispatch → wait → read results)

Redis key space (ml:pool:*)
├── ml:pool:registry           SET   — all live container IDs
├── ml:pool:idle               SET   — idle container IDs (acquire source)
├── ml:pool:container:{cid}    HASH  — state, job_id, cpu_pct, mem_pct, etc.
├── ml:pool:container:{cid}:jobq LIST — BLPOP queue; orchestrator RPUSHes job_id:mode
├── ml:pool:heartbeat:{cid}    STRING TTL=30s — agent renews every 10 s
├── ml:pool:job:{job_id}:done  PUBSUB — agent publishes "1" (ok) or "error"
├── ml:pool:req_timestamps     ZSET  — request timestamps for rate calculation
└── ml:pool:metrics            HASH  — pool_size, idle_count, queue_depth, req_rate_1m

Shared volume
└── ml_sandbox_workspace/
    └── {job_id}/
        ├── trainer.py         ← user-uploaded trainer source
        ├── input/
        │   ├── data.pkl       ← training data (cloudpickle)
        │   ├── config.json    ← training config scalars
        │   ├── model.pkl      ← trained model (predict mode)
        │   └── inputs.json    ← inference inputs (predict mode)
        └── output/
            ├── model.pkl      ← trained model (train mode)
            └── result.json    ← metrics / prediction / error
```

### Container lifecycle

```
spawn()
  ↓
[warming]  — container started, agent.py initialising
  ↓  agent heartbeat received
[idle]     — BLPOP on jobq, renewing heartbeat every 10 s
  ↓  orchestrator acquires + pushes job
[busy]     — runner.py subprocess executing trainer code
  ↓  subprocess exits
[idle]     — publishes done signal, returns to BLPOP
  ↓  pool manager decides to shrink
[draining] — agent finishes current job, exits
  ↓
[dead]     — removed from registry
```

### Job dispatch flow

```
pool_sandbox_runner.run_train_in_sandbox()
  1. Write trainer.py + input files to /sandbox_workspace/{job_id}/
  2. record_request()          → update ml:pool:req_timestamps
  3. pool_manager.acquire()    → Lua HSETNX on idle container, SREM from idle SET
  4. RPUSH container:jobq      → "job_id:train"
  5. SUBSCRIBE job:{id}:done   → wait for agent publish
  6. agent.py BLPOP            → wakes up, forks runner.py subprocess
  7. runner.py                 → runs trainer code, writes output/
  8. agent.py publish          → "1" (success) or "error"
  9. read output/result.json   → JSON only, no pickle exec in trusted process
 10. return model_bytes + metrics
 11. pool_manager.release()    → SADD idle SET, PUBLISH idle_available
 12. cleanup /sandbox_workspace/{job_id}/
```

---

## Network Model

Sandbox containers join the `pms_sandbox_net` Docker bridge network:

```
Internet
  │  (blocked — pms_sandbox_net is internal: true)
  ✗

pms_sandbox_net (internal bridge)
  ├── redis          ← only service reachable from sandbox containers
  ├── ml-worker      ← spawns containers on this network
  └── sandbox-{N}    ← agent.py has Redis access only

runner.py subprocess (inside sandbox container)
  └── NO network access — inherits none from agent subprocess env
```

The agent (`agent.py`) has Redis access for pool coordination.
The actual trainer code (`runner.py` subprocess) has **zero network access** — it runs
with an explicit minimal env dict that excludes `SANDBOX_REDIS_URL`.

---

## Security Properties

| Property | none | docker | docker-pool |
|---|---|---|---|
| Process isolation | No | Yes | Yes |
| Filesystem isolation (read-only) | No | Yes | Yes |
| Network isolation | No | Yes (none) | Yes (internal only) |
| Credential isolation | scrubbed_env() | Full | Full |
| AST gate | Yes | Yes | Yes |
| LLM intent scan | Yes | Yes | Yes |
| Resource caps (memory/CPU/PIDs) | No | Yes | Yes |
| Warm start | N/A | No (cold) | Yes |

### Trust boundary

- `pool_sandbox_runner.py` (trusted) reads **only** `result.json` (JSON).
  It never calls `pickle.loads()` on sandbox output.
- `model_bytes` are returned as raw bytes to `training_service.py`, which calls
  `cloudpickle.load()` — same as before, same accepted risk boundary.
- Inference results from `result.json` are already JSON primitives (sanitised by
  `_to_json_safe()` in `runner.py`). No deserialization occurs in the trusted process.
- `agent.py` receives only: `SANDBOX_CONTAINER_ID`, `SANDBOX_REDIS_URL`,
  `SANDBOX_JOB_TIMEOUT`, `TRAINING_*` scalars. No MongoDB, S3, JWT, or MLflow credentials.
- `runner.py` subprocess receives only: `SANDBOX_JOB_ID`, `SANDBOX_MODE`, `TRAINING_*`
  scalars. No Redis URL, no credentials of any kind.

---

## Predictive Scaler

The scaler runs every 20 seconds as a background asyncio task inside the ml-worker.

**Scale-up logic:**
```
req_rate_1m         = requests in last 60 s / 60
predicted_demand    = req_rate_1m × SANDBOX_POOL_SPAWN_LEAD_TIME_SECS   (default 8 s)
desired_idle        = ceil(predicted_demand × SANDBOX_POOL_IDLE_HEADROOM_FACTOR)  (default 1.5×)
effective_idle      = idle_count + warming_count
gap                 = desired_idle − effective_idle

if gap > 0 and pool_size < MAX_SIZE and cooldown_elapsed:
    spawn(gap)
```

**Scale-down logic:**
```
if queue_depth == 0
   and req_rate_1m < SANDBOX_POOL_SCALE_DOWN_THRESHOLD   (default 0.1 req/s)
   and idle_count > MIN_IDLE
   and scale_down_cooldown_elapsed:
       drain oldest idle containers (up to SANDBOX_POOL_SCALE_DOWN_BATCH at a time)
```

---

## Configuration Reference

All settings are read from environment variables (or `.env` file via pydantic-settings).

### Shared (all sandbox modes)

| Variable | Default | Description |
|---|---|---|
| `TRAINER_SANDBOX` | `none` | `none` \| `docker` \| `docker-pool` |
| `TRAINER_SANDBOX_IMAGE` | `pms-ml-sandbox:latest` | Docker image for sandbox containers |
| `TRAINER_SANDBOX_VOLUME` | `ml_sandbox_workspace` | Named volume for data exchange |
| `TRAINER_SANDBOX_WORKSPACE` | `/sandbox_workspace` | Mount path inside ml-worker |
| `TRAINER_SANDBOX_MEMORY` | `2g` | Container memory limit |
| `TRAINER_SANDBOX_CPUS` | `2` | Container CPU limit |
| `TRAINER_SANDBOX_PIDS` | `128` | Container PID limit |
| `TRAINER_SANDBOX_TIMEOUT` | `600` | Seconds before container/job is killed |
| `TRAINER_SANDBOX_USER` | `65534` | UID to run container as (nobody) |

### docker-pool only

| Variable | Default | Description |
|---|---|---|
| `SANDBOX_POOL_AGENT_REDIS_URL` | `redis://redis:6379` | Redis URL seen by agent inside containers |
| `SANDBOX_POOL_NETWORK` | `pms_sandbox_net` | Internal Docker network name |
| `SANDBOX_POOL_MIN_SIZE` | `2` | Minimum total containers always running |
| `SANDBOX_POOL_MAX_SIZE` | `10` | Hard cap on pool size |
| `SANDBOX_POOL_MIN_IDLE` | `1` | Minimum idle containers before scale-up triggers |
| `SANDBOX_POOL_HEALTH_INTERVAL` | `15` | Seconds between health-check sweeps |
| `SANDBOX_POOL_REPLENISH_INTERVAL` | `10` | Seconds between replenishment checks |
| `SANDBOX_POOL_HEARTBEAT_TIMEOUT` | `30` | Seconds without heartbeat → container declared dead |
| `SANDBOX_POOL_ACQUIRE_TIMEOUT` | `30` | Seconds to wait for an idle container |
| `SANDBOX_POOL_SCALE_UP_COOLDOWN` | `30` | Seconds between scale-up events |
| `SANDBOX_POOL_SCALE_DOWN_COOLDOWN` | `120` | Seconds between scale-down events |
| `SANDBOX_POOL_SCALE_DOWN_THRESHOLD` | `0.1` | req/s below which scale-down is considered |
| `SANDBOX_POOL_SCALE_DOWN_BATCH` | `2` | Max containers drained per scale-down cycle |
| `SANDBOX_POOL_IDLE_HEADROOM_FACTOR` | `1.5` | Multiply predicted demand for idle target |
| `SANDBOX_POOL_SPAWN_LEAD_TIME_SECS` | `8.0` | Estimated container boot + warm time (s) |

---

## Recommended Settings by Environment

| Setting | Dev | Staging | Production |
|---|---|---|---|
| `SANDBOX_POOL_MIN_SIZE` | 1 | 2 | 4 |
| `SANDBOX_POOL_MAX_SIZE` | 3 | 8 | 20 |
| `SANDBOX_POOL_MIN_IDLE` | 1 | 1 | 2 |
| `SANDBOX_POOL_ACQUIRE_TIMEOUT` | 30 s | 20 s | 15 s |
| `SANDBOX_POOL_SCALE_DOWN_COOLDOWN` | 60 s | 120 s | 300 s |
| `SANDBOX_POOL_HEARTBEAT_TIMEOUT` | 60 s | 30 s | 30 s |

---

## Prometheus Metrics

The pool manager publishes metrics to `ml:pool:metrics` in Redis, scraped by the
existing Prometheus config at `:8030/metrics`.

| Metric | Type | Description |
|---|---|---|
| `ml_sandbox_pool_size_total` | gauge | Total containers in registry |
| `ml_sandbox_pool_idle_total` | gauge | Idle containers |
| `ml_sandbox_pool_busy_total` | gauge | Busy containers |
| `ml_sandbox_pool_warming_total` | gauge | Containers still warming up |
| `ml_sandbox_pool_queue_depth` | gauge | Jobs waiting for a container |
| `ml_sandbox_pool_acquire_duration_seconds` | histogram | Time from acquire() to container assigned |
| `ml_sandbox_pool_job_duration_seconds` | histogram | Time from dispatch to done signal |
| `ml_sandbox_pool_spawns_total` | counter | Cumulative containers spawned |
| `ml_sandbox_pool_drains_total` | counter | Cumulative graceful drains |
| `ml_sandbox_pool_dead_evictions_total` | counter | Containers declared dead by health check |

Grafana alert recommendations:
- `ml_sandbox_pool_size_total < SANDBOX_POOL_MIN_SIZE` → pool below minimum
- `ml_sandbox_pool_queue_depth > 5` for more than 60 s → insufficient capacity
- `ml_sandbox_pool_dead_evictions_total` rate > 1/min → containers crashing

---

## Operational Runbook

### Build and push the sandbox image

```bash
docker build -t pms-ml-sandbox:latest apps/ml/sandbox/
# For a registry (needed for multi-node deployments):
docker tag pms-ml-sandbox:latest registry.example.com/pms-ml-sandbox:latest
docker push registry.example.com/pms-ml-sandbox:latest
```

### Enable docker-pool mode

```bash
# In .env:
TRAINER_SANDBOX=docker-pool
SANDBOX_POOL_MIN_SIZE=2
SANDBOX_POOL_MAX_SIZE=10
```

Restart ml-worker — pool manager starts automatically and spawns `MIN_SIZE` containers.

### Inspect pool state

```bash
# All registered containers
redis-cli SMEMBERS ml:pool:registry

# Idle containers
redis-cli SMEMBERS ml:pool:idle

# Details of a specific container
redis-cli HGETALL ml:pool:container:<cid>

# Pool metrics
redis-cli HGETALL ml:pool:metrics

# Request rate
redis-cli HGET ml:pool:metrics req_rate_1m
```

### Force drain a container

```bash
redis-cli HSET ml:pool:container:<cid> state draining
# Agent will exit after finishing its current job; pool manager spawns a replacement.
```

### Scale pool manually

```bash
# Temporarily raise max and the replenishment loop will spawn
redis-cli HSET ml:pool:metrics pool_size 0   # NOT recommended — use config
# Better: update SANDBOX_POOL_MIN_SIZE in .env and restart ml-worker
```

---

## Files

| File | Purpose |
|---|---|
| `apps/ml/sandbox/runner.py` | One-shot job runner (used by both `docker` and `docker-pool` modes) |
| `apps/ml/sandbox/agent.py` | Long-lived pool agent (`docker-pool` only) |
| `apps/ml/sandbox/Dockerfile` | Sandbox image definition |
| `apps/ml/app/services/sandbox_runner.py` | Orchestrator for `docker` mode |
| `apps/ml/app/services/pool_sandbox_runner.py` | Orchestrator for `docker-pool` mode |
| `apps/ml/app/services/pool_manager.py` | Pool lifecycle management + background loops |
| `apps/ml/app/services/predictive_scaler.py` | Request-rate-based auto-scaling logic |
| `apps/ml/app/core/config.py` | All `TRAINER_SANDBOX_*` and `SANDBOX_POOL_*` settings |
| `infra/docker/docker-compose.yml` | `pms_sandbox_net`, volume mounts, env vars |
