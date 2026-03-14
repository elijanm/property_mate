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

*For plugin development documentation see `docs/plugin-guide.html`. For architecture details see `docs/medium-article.md`.*
