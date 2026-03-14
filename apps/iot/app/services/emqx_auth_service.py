"""
EMQX v5 HTTP auth/ACL service.

EMQX calls these endpoints synchronously before allowing MQTT operations.
Response must always be HTTP 200 with JSON body: {"result": "allow"} or {"result": "deny"}.

Auth paths (evaluated in order on every MQTT CONNECT):
  1. mTLS / X.509 — username starts with "d:" or "gw:" AND password is empty.
       EMQX sets username = cert CN (e.g. "d:<device_uid>") via peer_cert_as_username = cn.
       No password check — the TLS handshake already verified the cert.
       Returns True/False (never "ignore") so the connection is decided here.

  2. Static service account — username matches settings.mqtt_username.
       Plain-text password comparison (IoT service's own MQTT subscriber).

  3. Device bcrypt — clientid starts with "d:", password verified against mongodb hash.

  4. Gateway bcrypt — clientid starts with "gw:".

  5. Anything else → deny.

  The function returns True, False, or the string "ignore".
  "ignore" tells EMQX to try the next authenticator in its chain (useful when
  the cert fields are absent but you have a built-in-database fallback configured).
"""
from typing import Optional, Union
import bcrypt as _bcrypt_lib
from app.models.device import Device
from app.models.edge_gateway import EdgeGateway
from app.core.logging import get_logger
from app.core.metrics import IOT_EMQX_AUTH
from app.core.redis import get_redis
from app.utils.mqtt_topic import (
    parse_device_topic,
    parse_gateway_topic,
    acl_allowed_publish_topics,
    acl_allowed_subscribe_topics,
)
from app.utils.datetime import utc_now

logger = get_logger(__name__)
def _verify_pw(pw: str, pw_hash: str) -> bool:
    return _bcrypt_lib.checkpw(pw.encode(), pw_hash.encode())


# Redis cache key — avoids repeat DB lookups on rapid reconnections
_DEVICE_CACHE_TTL = 60  # seconds


def _norm_device_uid(username: str) -> str:
    """Strip the 'd:' prefix that EMQX injects via peer_cert_as_username = cn."""
    return username[2:] if username.startswith("d:") else username


def _norm_gw_uid(username: str) -> str:
    """Strip the 'gw:' prefix that EMQX injects via peer_cert_as_username = cn."""
    return username[3:] if username.startswith("gw:") else username


async def _get_device_by_username(username: str) -> Optional[Device]:
    """Look up a device by MQTT username (= device_uid). Uses Redis cache.

    Accepts both the bare device_uid ("QWER-61") and the cert-CN form
    ("d:QWER-61") that EMQX injects when peer_cert_as_username = cn is active.
    """
    uid = _norm_device_uid(username)
    redis = get_redis()
    cache_key = f"iot:emqx:device:{uid}"
    cached = await redis.get(cache_key)
    if cached:
        return Device.model_validate_json(cached)

    device = await Device.find_one({"mqtt_username": uid, "deleted_at": None})
    if device:
        await redis.set(cache_key, device.model_dump_json(), ex=_DEVICE_CACHE_TTL)
    return device


async def _get_gateway_by_username(username: str) -> Optional[EdgeGateway]:
    """Look up a gateway by MQTT username. Accepts bare uid or 'gw:' prefixed form."""
    uid = _norm_gw_uid(username)
    redis = get_redis()
    cache_key = f"iot:emqx:gw:{uid}"
    cached = await redis.get(cache_key)
    if cached:
        return EdgeGateway.model_validate_json(cached)

    gw = await EdgeGateway.find_one({"mqtt_username": uid, "deleted_at": None})
    if gw:
        await redis.set(cache_key, gw.model_dump_json(), ex=_DEVICE_CACHE_TTL)
    return gw


async def authenticate_connect(
    client_id: str,
    username: str,
    password: str,
    cert_common_name: str = "",
) -> Union[bool, str]:
    """
    Validate MQTT CONNECT credentials.

    Returns:
      True     — allow connection
      False    — deny connection
      "ignore" — no opinion; EMQX should try the next authenticator

    mTLS detection:
      With peer_cert_as_username = cn at the EMQX v5 listener level, the broker
      replaces the MQTT username with the cert CN (e.g. "d:<device_uid>").
      We also receive cert_common_name directly from EMQX as belt-and-suspenders:
      if username was not replaced, cert_common_name still carries the CN.
      Detection criteria:
        - password is empty  AND
        - username OR cert_common_name starts with "d:" or "gw:"
    """
    from app.core.config import settings

    # In EMQX v5, peer_cert_as_username does not exist. The cert CN is only
    # available via the cert_common_name placeholder in the HTTP auth body.
    # Use cert_common_name when present (mTLS connection), otherwise fall back
    # to the MQTT CONNECT username (password-auth connection).
    effective_username = cert_common_name if cert_common_name else username

    # ── Path 1: mTLS / X.509 ────────────────────────────────────────────────
    # Empty password + d:/gw: prefix = cert-authenticated connection.
    if not password:
        if effective_username.startswith("d:"):
            device_uid = _norm_device_uid(effective_username)
            device = await _get_device_by_username(device_uid)
            if not device or device.status in ("decommissioned", "quarantined"):
                logger.warning("mtls_auth_denied", username=effective_username, reason="device not found or decommissioned or quarantined")
                IOT_EMQX_AUTH.labels(result="deny").inc()
                return False
            await Device.find_one({"_id": device.id}).update(
                {"$set": {"last_seen_at": utc_now(), "status": "online"}}
            )
            await get_redis().delete(f"iot:emqx:device:{device_uid}")
            logger.info("mtls_auth_allowed", username=effective_username, device_uid=device_uid, org_id=device.org_id)
            IOT_EMQX_AUTH.labels(result="allow").inc()
            return True

        if effective_username.startswith("gw:"):
            gw_uid = _norm_gw_uid(effective_username)
            gw = await _get_gateway_by_username(gw_uid)
            if not gw or gw.status == "decommissioned":
                logger.warning("mtls_auth_denied", username=effective_username, reason="gateway not found or decommissioned")
                IOT_EMQX_AUTH.labels(result="deny").inc()
                return False
            logger.info("mtls_auth_allowed", username=effective_username, gw_uid=gw_uid, org_id=gw.org_id)
            IOT_EMQX_AUTH.labels(result="allow").inc()
            return True

        # Empty password but unrecognised username — could be IoT service
        # subscriber or something unknown; fall through to static password check.

    # ── Path 2: IoT service's own subscriber account (static password) ───────
    if username == settings.mqtt_username:
        result = password == settings.mqtt_password
        IOT_EMQX_AUTH.labels(result="allow" if result else "deny").inc()
        return result

    # ── Path 3: Device bcrypt ────────────────────────────────────────────────
    if client_id.startswith("d:"):
        device = await _get_device_by_username(username)
        if not device or device.status in ("decommissioned", "quarantined"):
            IOT_EMQX_AUTH.labels(result="deny").inc()
            return False
        ok = _verify_pw(password, device.mqtt_password_hash)
        if ok:
            await Device.find_one({"_id": device.id}).update(
                {"$set": {"last_seen_at": utc_now(), "status": "online"}}
            )
            await get_redis().delete(f"iot:emqx:device:{username}")
        IOT_EMQX_AUTH.labels(result="allow" if ok else "deny").inc()
        return ok

    # ── Path 4: Gateway bcrypt ───────────────────────────────────────────────
    if client_id.startswith("gw:"):
        gw = await _get_gateway_by_username(username)
        if not gw or gw.status == "decommissioned":
            IOT_EMQX_AUTH.labels(result="deny").inc()
            return False
        ok = _verify_pw(password, gw.mqtt_password_hash)
        IOT_EMQX_AUTH.labels(result="allow" if ok else "deny").inc()
        return ok

    IOT_EMQX_AUTH.labels(result="deny").inc()
    return False


async def authorize_publish(client_id: str, username: str, topic: str, cert_common_name: str = "") -> bool:
    """Validate that a client is allowed to publish to a topic."""
    from app.core.config import settings
    # Resolve effective username: cert CN takes precedence for mTLS sessions
    effective = cert_common_name if cert_common_name else username
    if effective == settings.mqtt_username or username == settings.mqtt_username:
        return True

    if client_id.startswith("d:"):
        device = await _get_device_by_username(effective)
        if not device:
            return False
        allowed = acl_allowed_publish_topics(device.org_id, device.property_id, device.device_uid)
        return topic in allowed

    if client_id.startswith("gw:"):
        gw = await _get_gateway_by_username(effective)
        if not gw:
            return False
        prefix = f"gw/{gw.org_id}/{gw.property_id}/{gw.gateway_uid}/"
        device_prefix = f"pms/{gw.org_id}/{gw.property_id}/"
        return topic.startswith(prefix) or topic.startswith(device_prefix)

    return False


async def authorize_subscribe(client_id: str, username: str, topic: str, cert_common_name: str = "") -> bool:
    """Validate that a client is allowed to subscribe to a topic."""
    from app.core.config import settings
    effective = cert_common_name if cert_common_name else username
    if effective == settings.mqtt_username or username == settings.mqtt_username:
        return True

    if client_id.startswith("d:"):
        device = await _get_device_by_username(effective)
        if not device:
            return False
        allowed = acl_allowed_subscribe_topics(device.org_id, device.property_id, device.device_uid)
        return topic in allowed

    if client_id.startswith("gw:"):
        gw = await _get_gateway_by_username(effective)
        if not gw:
            return False
        prefix = f"pms/{gw.org_id}/{gw.property_id}/"
        return topic.startswith(prefix) and ("/rpc/request" in topic or "/ota/command" in topic)

    return False


async def handle_disconnect(client_id: str, username: str) -> None:
    """Update device/gateway status to offline on disconnect."""
    if client_id.startswith("d:"):
        device = await _get_device_by_username(username)
        if device:
            await Device.find_one({"_id": device.id}).update(
                {"$set": {"status": "offline", "updated_at": utc_now()}}
            )
            await get_redis().delete(f"iot:emqx:device:{_norm_device_uid(username)}")
            logger.info(
                "device_disconnected",
                resource_type="device",
                resource_id=str(device.id),
                org_id=device.org_id,
            )
    elif client_id.startswith("gw:"):
        gw = await _get_gateway_by_username(username)
        if gw:
            await EdgeGateway.find_one({"_id": gw.id}).update(
                {"$set": {"status": "offline", "updated_at": utc_now()}}
            )
            await get_redis().delete(f"iot:emqx:gw:{_norm_gw_uid(username)}")
