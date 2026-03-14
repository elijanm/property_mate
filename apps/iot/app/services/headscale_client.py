"""
Headscale REST API client.

Critical: Headscale has no atomic "add one ACL rule" endpoint.
The entire policy JSON must be GET → modified → PUT atomically.
A Redis distributed lock prevents concurrent ACL modifications.
"""
import json
import asyncio
from typing import Any, Dict, List, Optional
import httpx
from app.core.config import settings
from app.core.redis import get_redis
from app.core.logging import get_logger
from app.core.metrics import IOT_HEADSCALE_CALLS

logger = get_logger(__name__)

_HS_URL = settings.headscale_url.rstrip("/")
_LOCK_KEY = "iot:headscale_acl_lock"
_LOCK_TTL = settings.headscale_acl_lock_ttl_s

_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            base_url=_HS_URL,
            headers={"Authorization": f"Bearer {settings.headscale_api_key}"},
            timeout=10.0,
        )
    return _http


# ── Node management ────────────────────────────────────────────────────────

async def list_nodes() -> List[Dict[str, Any]]:
    """Return all registered Tailscale nodes."""
    try:
        resp = await _client().get("/api/v1/node")
        resp.raise_for_status()
        IOT_HEADSCALE_CALLS.labels(operation="list_nodes", status="success").inc()
        return resp.json().get("nodes", [])
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="list_nodes", status="error").inc()
        raise RuntimeError(f"Headscale list_nodes failed: {e}") from e


async def get_node(node_id: str) -> Dict[str, Any]:
    try:
        resp = await _client().get(f"/api/v1/node/{node_id}")
        resp.raise_for_status()
        IOT_HEADSCALE_CALLS.labels(operation="get_node", status="success").inc()
        data = resp.json()
        # Headscale v1 wraps single-node responses: {"node": {...}}
        return data.get("node", data)
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="get_node", status="error").inc()
        raise RuntimeError(f"Headscale get_node {node_id} failed: {e}") from e


async def delete_node(node_id: str) -> None:
    try:
        resp = await _client().delete(f"/api/v1/node/{node_id}")
        resp.raise_for_status()
        IOT_HEADSCALE_CALLS.labels(operation="delete_node", status="success").inc()
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="delete_node", status="error").inc()
        logger.warning("headscale_delete_node_failed", node_id=node_id, error=str(e))


# ── ACL management ─────────────────────────────────────────────────────────

async def _get_acl() -> Dict[str, Any]:
    # Headscale ≥0.23 uses /api/v1/policy; response: {"policy": "<json-string>"}
    resp = await _client().get("/api/v1/policy")
    if resp.status_code == 500:
        # Headscale returns 500 when no policy has been stored yet ("acl policy not found").
        # Treat as empty policy — _put_acl will initialise it on the next write.
        body = resp.json() if resp.content else {}
        msg = body.get("message", "")
        if "not found" in msg or "acl policy" in msg:
            return {}
        resp.raise_for_status()
    else:
        resp.raise_for_status()
    data = resp.json()
    raw = data.get("policy", "")
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return {}


async def _put_acl(policy: Dict[str, Any]) -> None:
    # Headscale ≥0.23: PUT /api/v1/policy body = {"policy": "<json-string>"}
    resp = await _client().put(
        "/api/v1/policy",
        json={"policy": json.dumps(policy)},
    )
    resp.raise_for_status()


async def _acquire_lock(timeout_s: int = 10) -> bool:
    """Acquire Redis distributed lock for ACL modification."""
    redis = get_redis()
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        ok = await redis.set(_LOCK_KEY, "1", nx=True, ex=_LOCK_TTL)
        if ok:
            return True
        await asyncio.sleep(0.2)
    return False


async def _release_lock() -> None:
    await get_redis().delete(_LOCK_KEY)


async def add_ssh_acl_rule(
    src_ip: str,
    dst_ip: str,
    ssh_request_id: str,
    expires_iso: str,
    port: int = 22,
) -> str:
    """
    Insert a temporary SSH ACL rule into Headscale policy.
    Returns a fingerprint string used to identify/remove this rule later.

    Fingerprint format: "ssh-req:{request_id}|{src_ip}|{dst_ip}|{port}"
    The fingerprint is stored in SSHAccessRequest.headscale_acl_comment but is
    NOT embedded in the policy JSON (newer Headscale rejects unknown fields).
    Rule matching for removal is done by src/dst/port values parsed from the fingerprint.
    """
    fingerprint = f"ssh-req:{ssh_request_id}|{src_ip}|{dst_ip}|{port}"

    if not await _acquire_lock():
        raise RuntimeError("Could not acquire Headscale ACL lock — try again")

    try:
        policy = await _get_acl()
        acls = policy.get("acls", [])
        # Headscale rejects a policy with zero ACL rules — seed a base allow-all
        # if this is the first rule being written.
        if not acls:
            acls = [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]
        acls.append({
            "action": "accept",
            "src": [src_ip],
            "dst": [f"{dst_ip}:{port}"],
        })
        policy["acls"] = acls
        await _put_acl(policy)
        IOT_HEADSCALE_CALLS.labels(operation="add_acl_rule", status="success").inc()
        logger.info("headscale_acl_rule_added", fingerprint=fingerprint, src=src_ip, dst=dst_ip)
        return fingerprint
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="add_acl_rule", status="error").inc()
        raise
    finally:
        await _release_lock()


async def remove_ssh_acl_rule(fingerprint: str) -> bool:
    """
    Remove an SSH ACL rule identified by its fingerprint string.
    Fingerprint format: "ssh-req:{request_id}|{src_ip}|{dst_ip}|{port}"
    Falls back to legacy comment format: "ssh-req:{id}|expires:{iso}" (matched by _comment field).
    """
    if not await _acquire_lock():
        raise RuntimeError("Could not acquire Headscale ACL lock — try again")

    try:
        policy = await _get_acl()
        acls = policy.get("acls", [])
        before = len(acls)

        # Parse fingerprint: "ssh-req:{id}|{src}|{dst}|{port}"
        parts = fingerprint.split("|")
        if len(parts) == 4:
            # New format
            _, src_ip, dst_ip, port_str = parts
            dst_entry = f"{dst_ip}:{port_str}"
            policy["acls"] = [
                r for r in acls
                if not (r.get("src") == [src_ip] and r.get("dst") == [dst_entry])
            ]
        else:
            # Legacy format — remove by _comment field (won't match new rules, safe no-op)
            policy["acls"] = [r for r in acls if r.get("_comment") != fingerprint]

        if len(policy["acls"]) < before:
            await _put_acl(policy)
            IOT_HEADSCALE_CALLS.labels(operation="remove_acl_rule", status="success").inc()
            logger.info("headscale_acl_rule_removed", fingerprint=fingerprint)
            return True
        return False
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="remove_acl_rule", status="error").inc()
        raise
    finally:
        await _release_lock()


async def create_preauth_key(
    namespace: str,
    reusable: bool = False,
    ephemeral: bool = False,
    expiry_hours: int = 24,
) -> Dict[str, Any]:
    """
    Create a Headscale pre-auth key for a device to join the Tailscale network.

    Headscale v0.28+ requires a numeric user ID in the request body.
    Returns the full key object including `key` (the secret string).
    """
    from datetime import timezone, datetime, timedelta
    expiry = (datetime.now(timezone.utc) + timedelta(hours=expiry_hours)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    try:
        user_id = await ensure_user(namespace)
        resp = await _client().post(
            "/api/v1/preauthkey",
            json={
                "user": user_id,
                "reusable": reusable,
                "ephemeral": ephemeral,
                "expiration": expiry,
                "aclTags": [],
            },
        )
        resp.raise_for_status()
        IOT_HEADSCALE_CALLS.labels(operation="create_preauth_key", status="success").inc()
        return resp.json().get("preAuthKey", resp.json())
    except Exception as e:
        IOT_HEADSCALE_CALLS.labels(operation="create_preauth_key", status="error").inc()
        raise RuntimeError(f"Headscale create_preauth_key failed: {e}") from e


async def ensure_user(namespace: str) -> int:
    """Create the Headscale user if it doesn't exist and return its numeric ID.

    Headscale v0.23+ renamed namespaces → users. v0.28+ requires numeric user ID
    for pre-auth key creation, so we always return the integer ID.
    """
    try:
        # List all users and find by name (GET /api/v1/user/{name} was removed in v0.28)
        resp = await _client().get("/api/v1/user")
        resp.raise_for_status()
        users = resp.json().get("users", [])
        for u in users:
            if u.get("name") == namespace:
                return int(u["id"])

        # Not found — create it
        create_resp = await _client().post("/api/v1/user", json={"name": namespace})
        if create_resp.status_code in (200, 201):
            user = create_resp.json().get("user", create_resp.json())
            return int(user["id"])

        # 400 = likely already exists (race); retry list
        retry = await _client().get("/api/v1/user")
        retry.raise_for_status()
        for u in retry.json().get("users", []):
            if u.get("name") == namespace:
                return int(u["id"])
    except Exception as e:
        logger.warning("headscale_ensure_user_failed", namespace=namespace, error=str(e))
    raise RuntimeError(f"Could not find or create Headscale user '{namespace}'")


async def close() -> None:
    if _http and not _http.is_closed:
        await _http.aclose()
