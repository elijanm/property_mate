"""
EMQX v5 HTTP auth/ACL hook endpoints.

EMQX calls these synchronously before allowing MQTT CONNECT / PUB / SUB.
All responses are HTTP 200 with JSON body {"result": "allow"} or {"result": "deny"}.

SECURITY: These endpoints are only callable from within the Docker internal network.
          The X-Internal-Secret header is validated on every request.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.dependencies.internal_auth import require_internal_secret
from app.services.emqx_auth_service import (
    authenticate_connect,
    authorize_publish,
    authorize_subscribe,
    handle_disconnect,
)

router = APIRouter(
    prefix="/internal/emqx",
    tags=["internal-emqx"],
    dependencies=[Depends(require_internal_secret)],
)

ALLOW = {"result": "allow"}
DENY  = {"result": "deny"}


class ConnectPayload(BaseModel):
    clientid: str
    username: str = ""
    password: str = ""
    peerhost: str = ""
    protocol: str = "mqtt"
    # cert_common_name is sent by EMQX only for mTLS connections (port 8883).
    # It contains the cert CN, e.g. "d:<device_uid>" or "gw:<gw_uid>".
    # Used as a fallback / confirmation when peer_cert_as_username substitution
    # has not yet overwritten the username field.
    cert_common_name: str = ""


class PubSubPayload(BaseModel):
    clientid: str
    username: str = ""
    topic: str
    action: str = "publish"   # publish | subscribe
    qos: int = 0
    retain: bool = False
    cert_common_name: str = ""   # cert CN for mTLS sessions; empty for plain TCP


class DisconnectPayload(BaseModel):
    clientid: str
    username: str = ""
    reason: str = ""


@router.post("/auth/connect")
async def emqx_connect(body: ConnectPayload):
    """EMQX calls this on MQTT CONNECT to validate credentials.

    Auth paths (tried in order inside authenticate_connect):
      1. mTLS — username starts with "d:" or "gw:" AND password is empty
                → device exists in DB, no bcrypt check needed (cert proved identity).
      2. Static service account — username == settings.mqtt_username.
      3. Device bcrypt — clientid starts with "d:", password verified.
      4. Gateway bcrypt — clientid starts with "gw:", password verified.
    """
    result = await authenticate_connect(
        body.clientid, body.username, body.password, body.cert_common_name
    )
    if result == "ignore":
        return {"result": "ignore"}
    return ALLOW if result else DENY


@router.post("/auth/publish")
async def emqx_publish(body: PubSubPayload):
    """EMQX calls this before allowing a PUBLISH."""
    allowed = await authorize_publish(body.clientid, body.username, body.topic, body.cert_common_name)
    return ALLOW if allowed else DENY


@router.post("/auth/subscribe")
async def emqx_subscribe(body: PubSubPayload):
    """EMQX calls this before allowing a SUBSCRIBE."""
    allowed = await authorize_subscribe(body.clientid, body.username, body.topic, body.cert_common_name)
    return ALLOW if allowed else DENY


@router.post("/auth/acl")
async def emqx_acl(body: PubSubPayload):
    """Combined ACL endpoint — EMQX v5 authz source sends action=publish|subscribe here."""
    if body.action == "subscribe":
        allowed = await authorize_subscribe(body.clientid, body.username, body.topic, body.cert_common_name)
    else:
        allowed = await authorize_publish(body.clientid, body.username, body.topic, body.cert_common_name)
    return ALLOW if allowed else DENY


@router.post("/auth/disconnect")
async def emqx_disconnect(body: DisconnectPayload):
    """EMQX calls this on DISCONNECT — used to update device status."""
    await handle_disconnect(body.clientid, body.username)
    return {"ok": True}
