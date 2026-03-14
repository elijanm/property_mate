"""
ThingsBoard Community Edition REST API client.

Auth flow:
  1. Sysadmin JWT → create Tenants (one per PMS Org)
  2. Tenant Admin JWT (per org, cached in Redis) → create Customers, Assets, Devices
  3. Device access token (per device) → ingest telemetry via TB device API

Token cache: Redis key {org_id}:iot:tb:token  (TTL = token_expiry - 60s)
             Redis key {org_id}:iot:tb:refresh (same TTL)
"""
import json
from typing import Any, Dict, Optional
from datetime import datetime, timezone, timedelta
import httpx
from app.core.config import settings
from app.core.redis import get_redis
from app.core.logging import get_logger
from app.core.metrics import IOT_TB_SYNC_ERRORS

logger = get_logger(__name__)

_TB_URL = settings.thingsboard_url.rstrip("/")

# Module-level shared httpx client (connection pooling)
_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(base_url=_TB_URL, timeout=10.0)
    return _http


# ── Sysadmin token ─────────────────────────────────────────────────────────

_sysadmin_token: Optional[str] = None
_sysadmin_expires: Optional[datetime] = None


async def _get_sysadmin_token() -> str:
    global _sysadmin_token, _sysadmin_expires
    now = datetime.now(timezone.utc)
    if _sysadmin_token and _sysadmin_expires and _sysadmin_expires > now:
        return _sysadmin_token
    resp = await _client().post(
        "/api/auth/login",
        json={"username": settings.thingsboard_sysadmin_email, "password": settings.thingsboard_sysadmin_password},
    )
    resp.raise_for_status()
    data = resp.json()
    _sysadmin_token = data["token"]
    _sysadmin_expires = now + timedelta(seconds=8900)
    return _sysadmin_token


# ── Tenant (per org) token ─────────────────────────────────────────────────

async def _get_tenant_token(org_id: str) -> str:
    """Return a cached Tenant Admin JWT for the given org. Refreshes if expired."""
    redis = get_redis()
    token = await redis.get(f"{org_id}:iot:tb:token")
    if token:
        return token

    # Try refresh
    refresh = await redis.get(f"{org_id}:iot:tb:refresh")
    if refresh:
        try:
            resp = await _client().post("/api/auth/token", json={"refreshToken": refresh})
            resp.raise_for_status()
            data = resp.json()
            await _cache_tenant_token(org_id, data["token"], data.get("refreshToken", refresh))
            return data["token"]
        except Exception:
            pass  # fall through to re-authenticate

    # Re-authenticate using stored tenant admin credentials.
    # If creds are missing from Redis (e.g. after a Redis restart), reconstruct
    # them from the deterministic formula used in create_tenant() and re-store.
    creds_raw = await redis.get(f"{org_id}:iot:tb:creds")
    if not creds_raw:
        creds = _default_tenant_creds(org_id)
        await redis.set(f"{org_id}:iot:tb:creds", json.dumps(creds))
        logger.info("tb_creds_reconstructed", org_id=org_id,
                    action="reconstruct_tenant_creds", status="ok")
    else:
        creds = json.loads(creds_raw)

    resp = await _client().post("/api/auth/login", json=creds)
    if resp.status_code == 401:
        # Password was never set or was reset — re-activate the tenant admin user
        logger.warning("tb_tenant_login_401_recovering", org_id=org_id,
                       action="recover_tenant_password", status="started")
        await _reset_tenant_password(org_id, creds)
        resp = await _client().post("/api/auth/login", json=creds)
    resp.raise_for_status()
    data = resp.json()
    await _cache_tenant_token(org_id, data["token"], data.get("refreshToken"))
    return data["token"]


def _default_tenant_creds(org_id: str) -> Dict[str, str]:
    """Deterministic tenant admin credentials — same formula used in create_tenant()."""
    return {
        "username": f"admin-{org_id}@iot.pms.internal",
        "password": f"PMS-{org_id}-TB!",
    }


async def _reset_tenant_password(org_id: str, creds: Dict[str, str]) -> None:
    """Re-activate tenant admin user to reset password. Called when login returns 401."""
    try:
        sysadmin_token = await _get_sysadmin_token()
        # Find the user: use cached tenant_id if available, otherwise find tenant by org_name
        redis = get_redis()
        tenant_id = await redis.get(f"{org_id}:iot:tb:tenant_id")
        user_id: Optional[str] = None
        if tenant_id:
            user = await _find_tenant_user_in_tenant(tenant_id, creds["username"], sysadmin_token)
            if user:
                user_id = user["id"]["id"]
        if not user_id:
            logger.error("tb_reset_password_user_not_found", org_id=org_id,
                         username=creds["username"])
            return
        # Get fresh activation link (TB CE generates a new token each time)
        link_resp = await _client().get(
            f"/api/user/{user_id}/activationLink",
            headers=_auth(sysadmin_token),
        )
        if link_resp.status_code != 200:
            logger.error("tb_reset_password_no_link", org_id=org_id, status=link_resp.status_code)
            return
        activation_link = link_resp.text.strip().strip('"')
        activate_token = activation_link.split("activateToken=")[-1]
        await _client().post(
            "/api/noauth/activate",
            params={"sendActivationMail": "false"},
            json={"activateToken": activate_token, "password": creds["password"]},
        )
        logger.info("tb_tenant_password_reset", org_id=org_id,
                    action="recover_tenant_password", status="ok")
    except Exception as e:
        logger.error("tb_reset_password_failed", org_id=org_id, error=str(e))


async def _cache_tenant_token(org_id: str, token: str, refresh: Optional[str]) -> None:
    redis = get_redis()
    await redis.set(f"{org_id}:iot:tb:token", token, ex=8900)
    if refresh:
        await redis.set(f"{org_id}:iot:tb:refresh", refresh, ex=86400)


def _auth(token: str) -> Dict[str, str]:
    return {"X-Authorization": f"Bearer {token}"}


# ── Tenant provisioning (sysadmin scope) ──────────────────────────────────

async def _find_tenant_by_org(org_id: str, org_name: str, token: str) -> Optional[Dict[str, Any]]:
    """Search for an existing TB Tenant for this PMS org.

    Strategy:
      1. Search tenants by title.
      2. If multiple match, prefer the one that already has our admin user.
         (TB CE allows duplicate tenant titles so we disambiguate by user.)
    """
    try:
        resp = await _client().get(
            "/api/tenants",
            params={"pageSize": 50, "page": 0, "textSearch": org_name},
            headers=_auth(token),
        )
        if resp.status_code != 200:
            return None
        candidates = [t for t in resp.json().get("data", []) if t.get("title") == org_name]
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]
        # Multiple tenants with same title — find the one that owns our admin user
        admin_email = _default_tenant_creds(org_id)["username"]
        for t in candidates:
            t_id = t["id"]["id"]
            user = await _find_tenant_user_in_tenant(t_id, admin_email, token)
            if user:
                return t
        # No tenant has the user yet — return the most recently created one (last in list)
        return candidates[-1]
    except Exception:
        pass
    return None


async def _find_tenant_user_in_tenant(tenant_id: str, admin_email: str, token: str) -> Optional[Dict]:
    """Return user dict if the tenant admin exists in the given TB tenant."""
    try:
        resp = await _client().get(
            f"/api/tenant/{tenant_id}/users",
            params={"pageSize": 20, "page": 0},
            headers=_auth(token),
        )
        if resp.status_code == 200:
            for u in resp.json().get("data", []):
                if u.get("email") == admin_email:
                    return u
    except Exception:
        pass
    return None


# Keep old name for backward compat — searches within a given tenant_id_obj
async def _find_tenant_user(tenant_id_obj: Dict, admin_email: str, token: str) -> Optional[str]:
    """Return user_id if the tenant admin user already exists within the given tenant."""
    tenant_id = tenant_id_obj.get("id") if tenant_id_obj else None
    if not tenant_id:
        return None
    user = await _find_tenant_user_in_tenant(tenant_id, admin_email, token)
    return user["id"]["id"] if user else None


async def create_tenant(org_id: str, org_name: str) -> Dict[str, Any]:
    """
    Create a TB Tenant for a PMS Org and provision its Tenant Admin user.
    Idempotent: if the tenant already exists, reuses it and re-activates creds.

    Activation flow (TB CE):
      1. POST /api/tenant           → creates tenant (or find existing)
      2. POST /api/user             → creates TENANT_ADMIN (or find existing)
      3. GET  /api/user/{id}/activationLink → raw activation URL with token
      4. POST /api/noauth/activate  → sets deterministic password
    """
    try:
        token = await _get_sysadmin_token()
        creds = _default_tenant_creds(org_id)

        # 1. Find or create Tenant
        # TB CE allows duplicate titles — always search first, create only if absent.
        tenant = await _find_tenant_by_org(org_id, org_name, token)
        if not tenant:
            resp = await _client().post(
                "/api/tenant",
                json={"title": org_name, "name": org_name},
                headers=_auth(token),
            )
            resp.raise_for_status()
            tenant = resp.json()

        tenant_id_obj = tenant["id"]

        # 2. Find or create Tenant Admin user within this tenant.
        tenant_id_str = tenant_id_obj.get("id")
        existing_user = await _find_tenant_user_in_tenant(tenant_id_str, creds["username"], token)
        if existing_user:
            user_id = existing_user["id"]["id"]
        else:
            user_resp = await _client().post(
                "/api/user?sendActivationMail=false",
                json={
                    "tenantId": tenant_id_obj,
                    "authority": "TENANT_ADMIN",
                    "email": creds["username"],
                    "firstName": "PMS",
                    "lastName": org_id,
                },
                headers=_auth(token),
            )
            if user_resp.status_code in (200, 201):
                user_id = user_resp.json()["id"]["id"]
            elif user_resp.status_code == 400:
                # Duplicate email in another tenant — shouldn't happen after search, but handle it
                fallback = await _find_tenant_user(tenant_id_obj, creds["username"], token)
                if not fallback:
                    user_resp.raise_for_status()
                user_id = fallback
            else:
                user_resp.raise_for_status()

        # 3. Fetch activation link and set/reset the password
        link_resp = await _client().get(
            f"/api/user/{user_id}/activationLink",
            headers=_auth(token),
        )
        if link_resp.status_code == 200:
            activation_link = link_resp.text.strip().strip('"')
            activate_token = activation_link.split("activateToken=")[-1]

            # 4. Activate / re-set password
            await _client().post(
                "/api/noauth/activate",
                params={"sendActivationMail": "false"},
                json={"activateToken": activate_token, "password": creds["password"]},
            )

        # Store credentials in Redis (no TTL — must survive restarts)
        redis = get_redis()
        await redis.set(f"{org_id}:iot:tb:creds", json.dumps(creds))
        logger.info("tb_tenant_provisioned", org_id=org_id, org_name=org_name,
                    action="create_tenant", status="ok")
        return tenant
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="create_tenant").inc()
        logger.error("tb_create_tenant_failed", org_id=org_id, error=str(e))
        raise


async def get_or_create_tenant(org_id: str, org_name: str) -> str:
    """
    Return TB tenant ID for an org, creating if needed.
    - Redis cache hit: re-seeds creds if missing (survives Redis restart)
    - Cache miss: provisions (or finds) the TB tenant + admin user
    """
    redis = get_redis()
    cached = await redis.get(f"{org_id}:iot:tb:tenant_id")
    if cached:
        # Re-seed creds into Redis if they were evicted
        if not await redis.exists(f"{org_id}:iot:tb:creds"):
            creds = _default_tenant_creds(org_id)
            await redis.set(f"{org_id}:iot:tb:creds", json.dumps(creds))
        return cached
    tenant = await create_tenant(org_id, org_name)
    tb_tenant_id = tenant["id"]["id"]
    await redis.set(f"{org_id}:iot:tb:tenant_id", tb_tenant_id)
    return tb_tenant_id


# ── Customer (per property) ────────────────────────────────────────────────

async def get_or_create_customer(org_id: str, property_id: str, property_name: str) -> str:
    """Return TB Customer ID for a PMS property."""
    redis = get_redis()
    cache_key = f"{org_id}:iot:tb:customer:{property_id}"
    cached = await redis.get(cache_key)
    if cached:
        return cached
    try:
        token = await _get_tenant_token(org_id)
        title = property_name or property_id
        resp = await _client().post(
            "/api/customer",
            json={"title": title},
            headers=_auth(token),
        )
        if resp.status_code in (200, 201):
            customer_id = resp.json()["id"]["id"]
        elif resp.status_code == 400:
            # Customer title already exists — find it
            search_resp = await _client().get(
                "/api/customers",
                params={"pageSize": 20, "page": 0, "textSearch": title},
                headers=_auth(token),
            )
            search_resp.raise_for_status()
            found = next(
                (c for c in search_resp.json().get("data", []) if c.get("title") == title),
                None,
            )
            if not found:
                resp.raise_for_status()
            customer_id = found["id"]["id"]
        else:
            resp.raise_for_status()
        await redis.set(cache_key, customer_id)
        return customer_id
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="create_customer").inc()
        raise RuntimeError(f"TB customer create failed: {e}") from e


# ── Asset (per unit / store location) ─────────────────────────────────────

async def get_or_create_asset(
    org_id: str, customer_id: str, asset_id: str, asset_name: str, asset_type: str = "unit"
) -> str:
    redis = get_redis()
    cache_key = f"{org_id}:iot:tb:asset:{asset_id}"
    cached = await redis.get(cache_key)
    if cached:
        return cached
    try:
        token = await _get_tenant_token(org_id)
        resp = await _client().post(
            "/api/asset",
            json={"name": asset_name or asset_id, "type": asset_type},
            headers=_auth(token),
        )
        resp.raise_for_status()
        tb_asset_id = resp.json()["id"]["id"]
        # Assign to customer
        await _client().post(
            f"/api/customer/{customer_id}/asset/{tb_asset_id}",
            headers=_auth(token),
        )
        await redis.set(cache_key, tb_asset_id)
        return tb_asset_id
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="create_asset").inc()
        raise RuntimeError(f"TB asset create failed: {e}") from e


# ── Device provisioning ────────────────────────────────────────────────────

async def _find_tb_device_by_name(org_id: str, name: str, token: str) -> Optional[Dict[str, Any]]:
    """Search for an existing TB device by name within the tenant."""
    try:
        resp = await _client().get(
            "/api/tenant/devices",
            params={"pageSize": 10, "page": 0, "textSearch": name},
            headers=_auth(token),
        )
        if resp.status_code != 200:
            return None
        for d in resp.json().get("data", []):
            if d.get("name") == name:
                return d
    except Exception:
        pass
    return None


async def provision_device(
    org_id: str, customer_id: str, device_uid: str, device_name: str, device_type: str
) -> Dict[str, str]:
    """
    Idempotent: get-or-create a TB Device under the given customer.
    - Does not pass `type` (deprecated in TB CE 3.x; use default device profile).
    - On 400 (name already exists) falls back to a tenant-level device search.
    Returns {"tb_device_id": ..., "tb_access_token": ..., "tb_customer_id": ...}
    """
    try:
        token = await _get_tenant_token(org_id)

        async def _create_or_find() -> Dict[str, Any]:
            resp = await _client().post(
                "/api/device",
                json={"name": device_uid, "label": device_name},
                headers=_auth(token),
            )
            if resp.status_code in (200, 201):
                return resp.json()
            if resp.status_code == 400:
                # Device name already exists — look it up
                existing = await _find_tb_device_by_name(org_id, device_uid, token)
                if existing:
                    return existing
            resp.raise_for_status()
            return resp.json()  # unreachable but satisfies type checker

        # Retry once on stale token
        try:
            device = await _create_or_find()
        except Exception:
            redis = get_redis()
            await redis.delete(f"{org_id}:iot:tb:token")
            await redis.delete(f"{org_id}:iot:tb:refresh")
            token = await _get_tenant_token(org_id)
            device = await _create_or_find()

        tb_device_id = device["id"]["id"]

        # Assign to customer (safe to call even if already assigned)
        await _client().post(
            f"/api/customer/{customer_id}/device/{tb_device_id}",
            headers=_auth(token),
        )

        # Get device credentials (access token)
        creds_resp = await _client().get(
            f"/api/device/{tb_device_id}/credentials",
            headers=_auth(token),
        )
        creds_resp.raise_for_status()
        tb_access_token = creds_resp.json()["credentialsId"]

        return {"tb_device_id": tb_device_id, "tb_access_token": tb_access_token, "tb_customer_id": customer_id}
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="provision_device").inc()
        raise RuntimeError(f"TB device provision failed: {e}") from e


async def delete_device(org_id: str, tb_device_id: str) -> None:
    try:
        token = await _get_tenant_token(org_id)
        await _client().delete(f"/api/device/{tb_device_id}", headers=_auth(token))
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="delete_device").inc()
        logger.warning("tb_delete_device_failed", tb_device_id=tb_device_id, error=str(e))


# ── Telemetry ingest ────────────────────────────────────────────────────────

async def push_telemetry(tb_access_token: str, payload: Dict[str, Any]) -> None:
    """
    Push telemetry to ThingsBoard via device API (no JWT needed — uses device access token).
    POST /api/v1/{access_token}/telemetry
    """
    try:
        resp = await _client().post(f"/api/v1/{tb_access_token}/telemetry", json=payload)
        resp.raise_for_status()
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="push_telemetry").inc()
        logger.warning("tb_push_telemetry_failed", error=str(e))
        raise


async def get_telemetry(org_id: str, tb_device_id: str, keys: str, start_ts: int, end_ts: int) -> Dict:
    """Fetch timeseries from ThingsBoard for proxy endpoint."""
    try:
        token = await _get_tenant_token(org_id)
        resp = await _client().get(
            f"/api/plugins/telemetry/DEVICE/{tb_device_id}/values/timeseries",
            params={"keys": keys, "startTs": start_ts, "endTs": end_ts, "limit": 1000},
            headers=_auth(token),
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        IOT_TB_SYNC_ERRORS.labels(operation="get_telemetry").inc()
        raise RuntimeError(f"TB telemetry fetch failed: {e}") from e


async def close() -> None:
    if _http and not _http.is_closed:
        await _http.aclose()
