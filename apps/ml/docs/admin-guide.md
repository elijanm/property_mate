# PMS ML Studio — Administrator Guide

**Version:** 1.0 · **Service:** `pms-ml` (port 8030) · **UI:** port 5200

---

## Table of Contents

1. [First Login](#1-first-login)
2. [Role System](#2-role-system)
3. [User Management](#3-user-management)
4. [API Key Management](#4-api-key-management)
5. [Model Access & Visibility](#5-model-access--visibility)
6. [Security Controls](#6-security-controls)
7. [Audit Trail](#7-audit-trail)
8. [Environment Variables](#8-environment-variables)
9. [Rotating the Default Admin](#9-rotating-the-default-admin)
10. [Troubleshooting Auth Issues](#10-troubleshooting-auth-issues)
11. [Server Sizing & Traffic Capacity](#11-server-sizing--traffic-capacity)
12. [Platform Comparison: PMS ML Studio vs Replicate vs Hugging Face](#12-platform-comparison-pms-ml-studio-vs-replicate-vs-hugging-face)

---

## 1. First Login

On first startup, the service creates a default admin account if no users exist:

| Field | Default value |
|---|---|
| Email | `admin@pms-ml.local` |
| Password | `Admin@123456` |
| Role | `admin` |

**Change the default password immediately.** The default credentials are printed in the startup log:

```
ml_default_admin_created email=admin@pms-ml.local
```

To change, use the **Users** page in the UI or:

```bash
PATCH /api/v1/users/{user_id}
Authorization: Bearer <admin-token>

{ "full_name": "Your Name" }
```

> Password change via API is not yet exposed — reset by deactivating and recreating the user, or by directly updating the hash in MongoDB during initial setup only.

---

## 2. Role System

The platform has three roles. Every authenticated request carries the caller's role and is checked before the handler runs.

### Role overview

```
viewer ──────── Read-only: models, inference, logs, monitoring
    │
engineer ─────── viewer + write: train, deploy, A/B tests, alerts, batch, drift
    │
admin ────────── engineer + user management, security, audit, full config
```

### Permission matrix

| Action | viewer | engineer | admin |
|---|---|---|---|
| **Models & Inference** | | | |
| View deployments | ✅ | ✅ | ✅ |
| Run inference (UI + API) | ✅ | ✅ | ✅ |
| View inference logs | ✅ | ✅ | ✅ |
| Deploy / retire a model | ❌ | ✅ | ✅ |
| Trigger training | ❌ | ✅ | ✅ |
| **Monitoring** | | | |
| View performance dashboard | ✅ | ✅ | ✅ |
| View drift alerts | ✅ | ✅ | ✅ |
| Set drift baseline | ❌ | ✅ | ✅ |
| Run drift check | ❌ | ✅ | ✅ |
| Force performance snapshot | ❌ | ✅ | ✅ |
| **A/B Tests** | | | |
| View tests & metrics | ✅ | ✅ | ✅ |
| Create / pause / conclude | ❌ | ✅ | ✅ |
| **Alert Rules** | | | |
| View rules & fires | ✅ | ✅ | ✅ |
| Create / toggle / delete | ❌ | ✅ | ✅ |
| **Batch Inference** | | | |
| View jobs & results | ✅ | ✅ | ✅ |
| Submit batch job | ❌ | ✅ | ✅ |
| **API Keys** | | | |
| Create / view / revoke own keys | ✅ | ✅ | ✅ |
| Revoke any user's key | ❌ | ❌ | ✅ |
| **Experiments** | | | |
| View MLflow runs & compare | ✅ | ✅ | ✅ |
| Reset circuit breaker | ❌ | ✅ | ✅ |
| **Security** | | | |
| View IP records & logs | ✅ | ✅ | ✅ |
| Ban / unban IPs | ❌ | ❌ | ✅ |
| Delete IP records | ❌ | ❌ | ✅ |
| Clear request logs | ❌ | ❌ | ✅ |
| **Users** | | | |
| List / view users | ❌ | ❌ | ✅ |
| Create users | ❌ | ❌ | ✅ |
| Change roles | ❌ | ❌ | ✅ |
| Deactivate users | ❌ | ❌ | ✅ |
| **Audit Log** | | | |
| View audit trail | ❌ | ❌ | ✅ |
| **Config** | | | |
| View service config | ✅ | ✅ | ✅ |
| Update service config | ❌ | ✅ | ✅ |

### API key access level

When a request arrives via `X-Api-Key` header (rather than a JWT), the caller is treated as an **engineer** regardless of the key owner's role. This is intentional — API keys are for service-to-service inference calls, which need write access to trigger jobs but should not have admin-level destructive capabilities.

---

## 3. User Management

Only **admin** users can access the Users page or the `/api/v1/users` endpoints.

### Creating a user (UI)

1. Navigate to **Users** in the sidebar
2. Click **New user**
3. Fill in email, password, full name, and role
4. Click **Create**

The new user can log in immediately.

### Creating a user (API)

```bash
POST /api/v1/users
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "email": "jane@example.com",
  "password": "SecurePass@123",
  "full_name": "Jane Smith",
  "role": "engineer"
}
```

Response:
```json
{
  "id": "67d2a1f4...",
  "email": "jane@example.com",
  "full_name": "Jane Smith",
  "role": "engineer",
  "is_active": true,
  "created_at": "2026-03-13T09:44:26Z",
  "last_login_at": null
}
```

### Changing a user's role

```bash
PATCH /api/v1/users/{user_id}
Authorization: Bearer <admin-token>

{ "role": "admin" }
```

Valid roles: `viewer` | `engineer` | `admin`

### Deactivating a user

Deactivation is a **soft disable** — the user record is preserved (for audit trail integrity) but `is_active` is set to `false`. The user's tokens are immediately rejected.

```bash
DELETE /api/v1/users/{user_id}
Authorization: Bearer <admin-token>
```

Or toggle via the UI using the toggle switch in the Users table.

> **Note:** You cannot deactivate your own account via the UI. Use a second admin account or the API directly.

### Listing users

```bash
GET /api/v1/users?role=engineer&limit=100
Authorization: Bearer <admin-token>
```

---

## 4. API Key Management

API keys are for programmatic (service-to-service) access. They bypass the UI login flow but still require authentication.

### Key format

```
pms_ml_<32 random URL-safe bytes>
```

Example: `pms_ml_aB3xK9mQ2rT7vY4wZ1nL8pD5cF0eH6j...`

Keys are stored as SHA-256 hashes. The plaintext key is shown **once** at creation and cannot be recovered. If lost, revoke and regenerate.

### Using an API key

```bash
curl -X POST https://your-ml-host/api/v1/inference/run \
  -H "X-Api-Key: pms_ml_aB3xK9mQ..." \
  -H "Content-Type: application/json" \
  -d '{"trainer_name": "iris_classifier", "inputs": {"sepal_length": 5.1, ...}}'
```

### Rate limits

Each key has a configurable `rate_limit_per_min`. The default is 60 requests/minute. The middleware tracks usage per key in Redis with a 1-minute sliding window.

### Revoking a key

Admin users can revoke any key. Key owners can revoke their own keys.

```bash
DELETE /api/v1/api-keys/{key_id}
Authorization: Bearer <token>
```

---

## 5. Model Access & Visibility

**All authenticated users see all models.** There is no per-model access control — all models belong to the platform, not to individual users.

If you need model isolation (e.g. different teams working on different models), use separate deployments of the ML service with separate MongoDB databases.

### What new users see on first login

- All deployed model cards on the **Models** page
- All trainer plugins on the **Trainers** page
- Inference history (but cannot trigger new training)
- Monitoring dashboard (read-only)

Viewers **cannot** trigger training, deploy models, or perform any write operations. The UI hides write-action buttons based on role but the API also enforces this server-side.

---

## 6. Security Controls

### IP banning (admin only)

The security layer scores every inbound IP. Admins can manually ban IPs via the **Security** page or API:

```bash
POST /api/v1/security/ips/{ip}/ban
Authorization: Bearer <admin-token>
X-Admin-Password: <ADMIN_PASSWORD env var>

{
  "reason": "Repeated upload scan attempts",
  "expires_hours": 24    # null = permanent
}
```

> The `X-Admin-Password` header is an additional confirmation layer for destructive security actions, separate from the JWT role check. Set `ADMIN_PASSWORD` in the service environment.

### Threat scoring

The IP threat detector model (`ip_threat_detector`) runs every 30 minutes and re-scores all tracked IPs. Scores range 0.0 – 1.0:

| Score | Risk level | Action |
|---|---|---|
| 0.00 – 0.34 | Low | Monitor |
| 0.35 – 0.59 | Medium | Review |
| 0.60 – 0.84 | High | Consider ban |
| 0.85 – 1.00 | Critical | Auto-flag for ban |

---

## 7. Audit Trail

Every admin action writes an immutable `AuditLog` document. Admins can query the trail:

```bash
GET /api/v1/audit?resource_type=model&limit=100
Authorization: Bearer <admin-token>
```

| Queryable field | Description |
|---|---|
| `actor_email` | Who performed the action |
| `resource_type` | `model`, `ip`, `api_key`, `ab_test`, `alert_rule`, `user` |
| `action` | e.g. `deploy_model`, `ban_ip`, `create_ab_test` |

Audit logs are never deleted. They are stored in the `ml_audit_logs` MongoDB collection.

---

## 8. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `change-this-jwt-secret-in-production` | **Change this.** Signs all JWT tokens. |
| `JWT_ACCESS_HOURS` | `8` | Access token lifetime in hours |
| `JWT_REFRESH_DAYS` | `30` | Refresh token lifetime in days |
| `DEFAULT_ADMIN_EMAIL` | `admin@pms-ml.local` | Created on first startup if no users exist |
| `DEFAULT_ADMIN_PASSWORD` | `Admin@123456` | **Change this.** Default admin password |
| `ADMIN_PASSWORD` | `changeme` | Secondary confirmation for destructive security ops |
| `MONGODB_URL` | `mongodb://mongodb:27017` | MongoDB connection string |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `MLFLOW_TRACKING_URI` | `http://mlflow:5000` | MLflow server |
| `S3_ENDPOINT_URL` | `http://minio:9000` | MinIO / S3 endpoint |

### Production checklist

- [ ] `JWT_SECRET` set to a 64+ character random string
- [ ] `DEFAULT_ADMIN_PASSWORD` changed to something secure
- [ ] `ADMIN_PASSWORD` set to a secure value
- [ ] Default admin email updated to a real mailbox
- [ ] MongoDB authenticated (connection string includes credentials)
- [ ] Redis authenticated (`REDIS_URL` includes password)
- [ ] S3 credentials rotated from `minioadmin`/`minioadmin`

---

## 9. Rotating the Default Admin

After first startup:

1. Log in as `admin@pms-ml.local`
2. Create a new admin user with your real email via **Users → New user**
3. Log out
4. Log in as your new account
5. Deactivate `admin@pms-ml.local` via **Users → toggle**

The original account is soft-disabled and its history is preserved in the audit log.

---

## 10. Troubleshooting Auth Issues

### "Not authenticated" on all requests

The API requires `Authorization: Bearer <token>` or `X-Api-Key: <key>`. The token must be obtained from `POST /api/v1/auth/login`.

### "Role 'viewer' is not allowed"

The endpoint requires `engineer` or `admin`. Either elevate the user's role (admin action) or use a higher-privilege account.

### Token expired / 401 on refresh

Access tokens expire after `JWT_ACCESS_HOURS` (default 8h). The frontend automatically attempts a refresh using the refresh token. If the refresh token is also expired (default 30 days), the user must log in again.

### API key not working

- Verify the key is being sent as `X-Api-Key` header, not `Authorization`
- Check the key hasn't been revoked (Users → API Keys)
- Check expiry date if one was set
- The raw key is only shown once — if lost, revoke and generate a new one

### Cannot access Users page

Only `admin` role can access `/api/v1/users`. Check the user's role with:

```bash
GET /api/v1/auth/me
Authorization: Bearer <token>
```

If role is `viewer` or `engineer`, an admin must elevate it.

---

---

## 11. Server Sizing & Traffic Capacity

### Memory layout (all services on one host)

| Component | Idle RAM | Under load |
|---|---|---|
| FastAPI (uvicorn, 4 workers) | ~200 MB | ~600–900 MB |
| MongoDB | ~300 MB | ~1–2 GB |
| Redis | ~50 MB | ~200–400 MB |
| RabbitMQ | ~100 MB | ~200 MB |
| OS + misc | ~500 MB | ~500 MB |
| **Total** | **~1.2 GB** | **~3–4 GB** |

A box with 8 GB RAM has ~4 GB of safe working headroom after services settle.

### Request throughput

**Standard API requests** (list neurals, get submission, inference, etc.):
- FastAPI async + Motor handles ~800–1,500 req/s per uvicorn worker
- 4 workers → **~3,000–5,000 req/s** — bottleneck is MongoDB, not Python

**Neural uploads + security scans:**
- Each active LLM scan holds ~2–5 MB in Python heap (prompt + response buffers)
- Safe concurrent scans: **~20–30 simultaneous** before RAM pressure builds
- At ~30s average scan time → **~40–60 uploads/minute** sustained

**SSE streams** (submission status, real-time events):
- Each open SSE = 1 asyncio task + 1 Redis pubsub subscription
- Safe concurrent connections: **~500–800** before fd/Redis connection limits apply

**Training jobs:**
- Each job loads its dataset into Python memory — this is the single largest RAM consumer
- Dataset fits in RAM: **2–4 concurrent runs** safely on 8 GB
- Large dataset (>500 MB): **1 at a time**

**Inference requests:**
- Depends on loaded model size (sklearn/small torch: 50–200 MB each)
- **10–20 small models** can be cached simultaneously on 8 GB

### The critical variable: Ollama placement

> If Ollama is running on the same host as the ML service, a 7B parameter model alone consumes 5–6 GB of RAM. This leaves only 2–3 GB for everything else and will cause OOM under moderate load.

| Ollama placement | Practical concurrent users |
|---|---|
| Same box (7B model) | ~30 max |
| Separate host | ~300–500 comfortably |
| Remote API (OpenAI / Anthropic) | ~800–1,000 |

### Recommended server sizes

| Workload | Min RAM | Notes |
|---|---|---|
| Internal / ops tool (<50 users) | 8 GB | Move Ollama off-box |
| Small team (50–200 users) | 16 GB | Ollama can share if <13B model |
| Production (200–500 users) | 32 GB | Ollama on-box, 2–4 training workers |
| High-traffic (500+ users) | 32 GB + scale horizontally | Multiple API replicas behind a load balancer |

### Configuration knobs for 8 GB deployments

**`mongod.conf`** — cap WiredTiger cache so MongoDB doesn't eat all available RAM:
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1
```

**Redis** — set an eviction ceiling:
```
maxmemory 512mb
maxmemory-policy allkeys-lru
```

**uvicorn workers** — reduce to 2 if training jobs also run on the same box:
```bash
uvicorn app.main:app --workers 2
```

**Scan concurrency** — throttle simultaneous LLM scans via environment variable:
```
TRAINER_SCAN_CONCURRENCY=3
```

---

---

## 12. Platform Comparison: PMS ML Studio vs Replicate vs Hugging Face

### What each platform is solving

| | PMS ML Studio | Replicate | Hugging Face |
|---|---|---|---|
| **Purpose** | Operational ML layer inside a multi-tenant SaaS product | Serverless inference API for running any model with one call | Community hub for discovering, sharing, and running pre-trained models |
| **Primary audience** | Your org's engineers and their end-customers | Developers who want inference without infra | Researchers, companies, the entire AI community |
| **Compute ownership** | Self-hosted on your infrastructure | Replicate's cloud (billed per second) | HF's cloud (Inference API) or self-hosted (Transformers) |

---

### Pricing

Replicate bills per second of compute used:

| Instance | Replicate rate | Your infra cost (est.) | Your margin |
|---|---|---|---|
| CPU | ~$0.0001/sec | ~$0.000023/sec on a $20/mo VPS | ~4× |
| T4 GPU | ~$0.000225/sec | ~$0.00008/sec spot | ~3× |
| A40 GPU | ~$0.000725/sec | ~$0.00025/sec spot | ~3× |
| A100 GPU | ~$0.0023/sec | ~$0.0008/sec spot | ~3× |

HF Inference API is free for small models; pro tier starts at $9/mo with dedicated endpoints billed at similar GPU rates to Replicate.

PMS ML Studio has no per-second billing built in today — the wallet/credit system (`activation_cost_usd`) currently covers plugin activation, not compute time. Adding compute metering (track `training_duration_s` × rate per instance type → deduct credits) is the path to matching Replicate's model.

---

### Feature matrix

| Feature | PMS ML Studio | Replicate | Hugging Face |
|---|---|---|---|
| **Inference** | | | |
| Run a model via API | ✅ | ✅ Core product | ✅ Inference API |
| Serverless / scale-to-zero | ❌ always-warm | ✅ | ✅ Serverless endpoints |
| Streaming output (SSE) | ✅ | ✅ | ✅ |
| Batch inference | ✅ | ✅ | ✅ |
| Webhooks on completion | ❌ | ✅ | ❌ |
| **Models** | | | |
| Bring your own model code | ✅ BaseTrainer plugin | ✅ Cog container | ✅ push_to_hub |
| Pre-trained foundation models | ❌ | ✅ Llama, SD, Whisper… | ✅ 800k+ models |
| Model versioning | ✅ MLflow | ✅ | ✅ git-based |
| Public model hub / discovery | ❌ private only | ✅ | ✅ massive community |
| Model cards / documentation | ❌ | ✅ | ✅ |
| Fork a public model | ❌ | ✅ | ✅ |
| **Training** | | | |
| Trigger training runs | ✅ full pipeline | ✅ limited fine-tune API | ✅ AutoTrain |
| Training UI with live log stream | ✅ SSE console | ❌ | ❌ |
| Experiment tracking | ✅ MLflow | ❌ | ❌ |
| A/B testing | ✅ | ❌ | ❌ |
| Drift detection | ✅ | ❌ | ❌ |
| Alert rules on model metrics | ✅ | ❌ | ❌ |
| Custom trainer plugins | ✅ uploaded Python class | ❌ | ❌ |
| **Security** | | | |
| Code scanning before execution | ✅ AST + LLM scan | ❌ trusts your container | ❌ |
| Admin approval workflow | ✅ | ❌ | ❌ |
| IP threat scoring + banning | ✅ | ❌ | ❌ |
| Audit trail | ✅ | ❌ | ❌ |
| **Data** | | | |
| Dataset management | ✅ | ❌ | ✅ HF Datasets |
| Annotation pipeline integration | ✅ | ❌ | ❌ |
| Community datasets | ❌ | ❌ | ✅ |
| **Multi-tenancy** | | | |
| Hard per-org data isolation | ✅ first-class | ❌ single-tenant | ❌ namespace only |
| Per-org roles (viewer/engineer/admin) | ✅ | ❌ | ❌ |
| Per-org billing / wallets | ✅ | ❌ (billed to account) | ❌ |
| Commercial plugin marketplace | ✅ activation_cost_usd | ❌ | ❌ |
| **Ops** | | | |
| API keys with rate limits | ✅ | ✅ | ✅ |
| Prometheus + Grafana | ✅ | ❌ proprietary | ❌ proprietary |
| Self-hostable | ✅ fully | ❌ | ✅ (Transformers, not the hub) |

---

### Where each platform wins

**Replicate wins when:**
- You want to run a pre-trained model (Llama, Stable Diffusion, Whisper) in one API call with zero infra setup
- You need true scale-to-zero — pay nothing when idle
- Your use case is pure inference, no training, no custom code

**Hugging Face wins when:**
- You need access to 800k+ community models and datasets
- You're doing research and want to share/discover pre-trained weights
- Fine-tuning a foundation model is more useful than training from scratch

**PMS ML Studio wins when:**
- You're building a product where each customer must have fully isolated ML data — Replicate and HF cannot offer this without a complete architecture change
- You need to let untrusted users upload training code — the AST + LLM security gate is unique to this platform
- You need a full MLOps loop (training → experiment tracking → A/B → drift → alerts) not just inference
- You want a commercial plugin ecosystem where ML engineers sell trained models to other orgs

---

### Gaps to close before going public

1. **Compute metering** — track `training_duration_s` × rate per instance type → deduct from wallet (matches Replicate's billing model)
2. **Container-isolated training** — each job in its own Kubernetes pod with resource limits (today all jobs share the worker process)
3. **Serverless inference** — cold-start support so idle models don't hold RAM
4. **Public model hub** — `visibility: public` on `TrainerRegistration` + unauthenticated browse page
5. **Foundation model wrappers** — BaseTrainer plugins that wrap HF models for fine-tuning (bridges the pre-trained model gap without hosting weights yourself)

---

*For plugin development documentation see `docs/plugin-guide.html`. For architecture details see `docs/medium-article.md`.*
