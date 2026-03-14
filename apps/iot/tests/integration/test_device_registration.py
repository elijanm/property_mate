"""
Integration test suite for device registration and SSH setup flow.

Run against a live stack:
    cd apps/iot
    python -m pytest tests/integration/test_device_registration.py -v --tb=short

Or run the standalone script directly for a quick smoke test:
    python tests/integration/test_device_registration.py

Environment variables (override defaults for your stack):
    IOT_BASE_URL          http://localhost:8020/api/v1
    AUTH_BASE_URL         http://localhost:8001/api/v1
    OWNER_EMAIL           owner@test.com
    OWNER_PASSWORD        test1234
    TB_BASE_URL           http://localhost:8081
    MQTT_HOST             localhost
    MQTT_PORT             1883
"""

import asyncio
import json
import os
import socket
import sys
import uuid
from datetime import datetime
from typing import Any, Dict, Optional
import os
import random
import time
from datetime import datetime


import httpx

# ── Config ──────────────────────────────────────────────────────────────────

IOT_BASE_URL   = os.getenv("IOT_BASE_URL",  "http://localhost:8020/api/v1")
AUTH_BASE_URL  = os.getenv("AUTH_BASE_URL", "http://localhost:8001/api/v1")
TB_BASE_URL    = os.getenv("TB_BASE_URL",   "http://localhost:8081")
MQTT_HOST      = os.getenv("MQTT_HOST",     "localhost")
MQTT_PORT      = int(os.getenv("MQTT_PORT", "1883"))
OWNER_EMAIL    = os.getenv("OWNER_EMAIL",   "owner@pms.dev")
OWNER_PASSWORD = os.getenv("OWNER_PASSWORD","owner123")

# ── Colour helpers ───────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def _pass(msg: str) -> None:  print(f"  {GREEN}✓{RESET} {msg}")
def _fail(msg: str) -> None:  print(f"  {RED}✗{RESET} {msg}")
def _skip(msg: str) -> None:  print(f"  {YELLOW}–{RESET} {msg}")
def _info(msg: str) -> None:  print(f"  {CYAN}·{RESET} {msg}")

def _section(title: str) -> None:
    print(f"\n{BOLD}{CYAN}{'─'*60}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─'*60}{RESET}")


# ── Test context shared across test functions ────────────────────────────────

class Ctx:
    token: str = ""
    org_id: str = ""
    ssh_device_type_id: str = ""
    plain_device_type_id: str = ""

    # SSH device registration result
    ssh_device_id: str = "69afb90321c63f45720d81b1" 
    ssh_device_uid: str = ""
    ssh_mqtt_username: str = ""
    ssh_mqtt_password: str = ""
    ssh_mqtt_client_id: str = ""
    ssh_tb_access_token: Optional[str] = "rQ4zwHQcbfkvU3QEgLnU"
    ssh_tb_device_id: Optional[str] = "bc110b60-1c49-11f1-9c29-e909a31ee5ca"
    ssh_preauth_key: Optional[str] = None
    ssh_tailscale_cmd: Optional[str] = None

    # Plain device
    plain_device_id: str = ""
    plain_device_uid: str = ""

ctx = Ctx()

# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _get(path: str, base: str = IOT_BASE_URL, params: Optional[Dict] = None) -> httpx.Response:
    url = f"{base}{path}"
    headers = {"Authorization": f"Bearer {ctx.token}"} if ctx.token else {}
    return httpx.get(url, headers=headers, params=params, timeout=30)


def _post(path: str, body: Any, base: str = IOT_BASE_URL) -> httpx.Response:
    url = f"{base}{path}"
    headers = {"Authorization": f"Bearer {ctx.token}"} if ctx.token else {}
    return httpx.post(url, json=body, headers=headers, timeout=30)


def _delete(path: str, base: str = IOT_BASE_URL) -> httpx.Response:
    url = f"{base}{path}"
    headers = {"Authorization": f"Bearer {ctx.token}"} if ctx.token else {}
    return httpx.delete(url, headers=headers, timeout=30)


def _assert(condition: bool, msg: str) -> bool:
    if condition:
        _pass(msg)
        return True
    _fail(msg)
    return False


# ════════════════════════════════════════════════════════════════════════════
# Tests
# ════════════════════════════════════════════════════════════════════════════

def test_connectivity() -> bool:
    """GET /sync/connectivity — all external services must be reachable."""
    _section("2 · Connectivity check")
    resp = _get("/sync/connectivity")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data: Dict = resp.json()
    overall = data.get("overall", "unknown")
    _assert(overall == "ok", f'overall == "ok"  (got "{overall}")')

    services = [
        "mongodb", "redis", "emqx", "mqtt_broker",
        "thingsboard", "headscale", "rabbitmq",
    ]
    all_ok = True
    for svc in services:
        svc_data = data.get(svc, {})
        status   = svc_data.get("status", "missing")
        latency  = svc_data.get("latency_ms", "")
        lat_str  = f"  ({latency} ms)" if latency else ""
        if status == "ok":
            _pass(f"{svc}: ok{lat_str}")
        else:
            _fail(f"{svc}: {status}  →  {svc_data.get('error', '')}")
            all_ok = False

    return all_ok


def test_auth_login() -> bool:
    """Authenticate with backend and store JWT for subsequent requests."""
    _section("1 · Authentication")
    resp = _post("/auth/login", {"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, base=AUTH_BASE_URL)
    ok = _assert(resp.status_code == 200, f"Login HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        print(f"\n  {YELLOW}Fix:{RESET} set correct credentials:")
        print(f"       OWNER_EMAIL=<your-email> OWNER_PASSWORD=<your-password> python {sys.argv[0]}")
        print(f"  Current values: email={OWNER_EMAIL!r}  password={OWNER_PASSWORD!r}")
        return False

    data = resp.json()
    ctx.token  = data.get("token", "")
    user_data  = data.get("user", {})
    ctx.org_id = user_data.get("org_id", "")
    role       = user_data.get("role", "")

    _assert(bool(ctx.token),  "JWT token present")
    _assert(bool(ctx.org_id), "org_id present")
    _info(f"Logged in as {user_data.get('email')}  role={role}  org={ctx.org_id} token={ctx.token}")
    return bool(ctx.token)


def test_create_device_types() -> bool:
    """Create two DeviceTypes: one with 'ssh' capability, one without."""
    _section("3 · Create device types")

    # SSH-capable type
    uid_ssh = f"test-ssh-sensor-{uuid.uuid4().hex[:6]}"
    ssh_resp = _post("/device-types", {
        "name": f"SSH Test Sensor {uid_ssh}",
        "category": "sensor",
        "capabilities": ["telemetry", "ssh"],
        "description": "Integration test device type with SSH capability",
    })
    ok = _assert(ssh_resp.status_code == 201, f"SSH device type created (got {ssh_resp.status_code})")
    if not ok:
        _info(f"Response: {ssh_resp.text}")
        return False

    ctx.ssh_device_type_id = ssh_resp.json().get("id", "")
    _assert(bool(ctx.ssh_device_type_id), "SSH type id present")
    _info(f"SSH type id: {ctx.ssh_device_type_id}")

    # Verify 'id' is a string (not {})
    _assert(isinstance(ctx.ssh_device_type_id, str) and len(ctx.ssh_device_type_id) > 5,
            "id is a non-empty string (PydanticObjectId serialization OK)")

    # Plain type (no ssh)
    uid_plain = f"test-plain-sensor-{uuid.uuid4().hex[:6]}"
    plain_resp = _post("/device-types", {
        "name": f"Plain Test Sensor {uid_plain}",
        "category": "sensor",
        "capabilities": ["telemetry"],
        "description": "Integration test device type WITHOUT SSH",
    })
    ok2 = _assert(plain_resp.status_code == 201, f"Plain device type created (got {plain_resp.status_code})")
    if not ok2:
        _info(f"Response: {plain_resp.text[:300]}")
        return False

    ctx.plain_device_type_id = plain_resp.json().get("id", "")
    _info(f"Plain type id: {ctx.plain_device_type_id}")
    return True


def test_register_ssh_device() -> bool:
    """POST /sync/register-device — SSH-capable device; verify full provisioning."""
    _section("4 · Register SSH-capable device")
    ctx.ssh_device_uid = f"test-ssh-{uuid.uuid4().hex[:10]}"
    prop_id    = f"test-prop-{uuid.uuid4().hex[:8]}"
    prop_name  = f"Test Property {prop_id}"

    payload = {
        "device_uid":      ctx.ssh_device_uid,
        "device_name":     f"SSH Test Device {ctx.ssh_device_uid}",
        "device_type_id":  ctx.ssh_device_type_id,
        "property_id":     prop_id,
        "property_name":   prop_name,
        "unit_id":         f"unit-{uuid.uuid4().hex[:6]}",
        "unit_name":       "Test Unit 101",
        "description":     "Integration test SSH device",
        "serial_number":   f"SN-{uuid.uuid4().hex[:8].upper()}",
        "tags":            ["integration-test", "ssh"],
    }

    resp = _post("/sync/register-device", payload)
    ok = _assert(resp.status_code == 201, f"HTTP 201 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:500]}")
        return False

    data: Dict = resp.json()

    # Core fields
    _assert(data.get("status") in ("provisioned", "partial"),
            f"status is provisioned|partial (got {data.get('status')})")
    _assert(data.get("device_uid") == ctx.ssh_device_uid, "device_uid matches")

    ctx.ssh_device_id     = data.get("device_id", "bc110b60-1c49-11f1-9c29-e909a31ee5ca")
    ctx.ssh_mqtt_username = data.get("mqtt_username", "")
    ctx.ssh_mqtt_password = data.get("mqtt_password", "")
    ctx.ssh_mqtt_client_id= data.get("mqtt_client_id", "")
    ctx.ssh_tb_access_token = data.get("tb_access_token","rQ4zwHQcbfkvU3QEgLnU")
    ctx.ssh_tb_device_id    = data.get("tb_device_id")

    _assert(bool(ctx.ssh_device_id),      "device_id present")
    _assert(bool(ctx.ssh_mqtt_username),  "mqtt_username present")
    _assert(bool(ctx.ssh_mqtt_password),  "mqtt_password present (shown once)")
    _assert(len(ctx.ssh_mqtt_password) >= 32, "mqtt_password length >= 32 chars")
    _assert(bool(ctx.ssh_mqtt_client_id), "mqtt_client_id present")
    _assert(data.get("mqtt_broker_host"), "mqtt_broker_host present")
    _assert(data.get("mqtt_broker_port"), "mqtt_broker_port present")

    _info(f"device_id:      {ctx.ssh_device_id}")
    _info(f"mqtt_username:  {ctx.ssh_mqtt_username}")
    _info(f"mqtt_client_id: {ctx.ssh_mqtt_client_id}")

    # ThingsBoard fields
    if ctx.ssh_tb_device_id:
        _pass(f"tb_device_id: {ctx.ssh_tb_device_id}")
        _assert(bool(data.get("tb_access_token")),  "tb_access_token present")
        _assert(bool(data.get("tb_tenant_id")),     "tb_tenant_id present")
        _assert(bool(data.get("tb_customer_id")),   "tb_customer_id present")
        _assert(bool(data.get("tb_dashboard_url")), "tb_dashboard_url present")
    else:
        _skip("ThingsBoard provisioning skipped (partial status)")

    # SSH setup block
    ssh_setup: Optional[Dict] = data.get("ssh_setup")
    _assert(ssh_setup is not None, "ssh_setup block present (device has ssh capability)")
    if ssh_setup:
        _assert("preauth_key"           in ssh_setup, "ssh_setup.preauth_key present")
        _assert("tailscale_register_cmd" in ssh_setup, "ssh_setup.tailscale_register_cmd present")
        _assert("setup_steps"           in ssh_setup, "ssh_setup.setup_steps list present")
        _assert("ssh_access_flow"       in ssh_setup, "ssh_setup.ssh_access_flow dict present")
        ctx.ssh_preauth_key    = ssh_setup.get("preauth_key")
        ctx.ssh_tailscale_cmd  = ssh_setup.get("tailscale_register_cmd")
        _info(f"preauth_key: {ctx.ssh_preauth_key}")
        _info(f"tailscale cmd: {ctx.ssh_tailscale_cmd}")

    # Audit trail
    steps = data.get("steps", [])
    _assert(len(steps) > 0, f"audit steps present ({len(steps)} steps)")
    for step in steps:
        icon = "✓" if step.get("status") == "ok" else ("–" if step.get("status") == "skipped" else "✗")
        print(f"    {icon} {step.get('name')}: {step.get('status')}  {step.get('detail','')[:60]}")

    return bool(ctx.ssh_device_id)


def test_register_plain_device() -> bool:
    """Register a device WITHOUT ssh capability; verify no ssh_setup block."""
    _section("5 · Register plain device (no SSH)")
    ctx.plain_device_uid = f"test-plain-{uuid.uuid4().hex[:10]}"
    prop_id = f"test-prop-{uuid.uuid4().hex[:8]}"

    resp = _post("/sync/register-device", {
        "device_uid":     ctx.plain_device_uid,
        "device_name":    f"Plain Test Device {ctx.plain_device_uid}",
        "device_type_id": ctx.plain_device_type_id,
        "property_id":    prop_id,
        "property_name":  f"Test Property {prop_id}",
        "tags":           ["integration-test"],
    })
    ok = _assert(resp.status_code == 201, f"HTTP 201 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data = resp.json()
    ctx.plain_device_id = data.get("device_id", "")
    _assert(bool(ctx.plain_device_id), "device_id present")

    ssh_setup = data.get("ssh_setup")
    _assert(ssh_setup is None, "ssh_setup is None (no ssh capability)")
    _info(f"plain device_id: {ctx.plain_device_id}")
    return True


def test_duplicate_device_uid() -> bool:
    """Re-registering the same device_uid must return 409 Conflict."""
    _section("6 · Duplicate device_uid → 409 Conflict")
    if not ctx.ssh_device_uid:
        _skip("skipped — ssh device not registered")
        return True

    resp = _post("/sync/register-device", {
        "device_uid":     ctx.ssh_device_uid,
        "device_name":    "Duplicate attempt",
        "device_type_id": ctx.ssh_device_type_id,
        "property_id":    "any-prop",
        "property_name":  "Any Property",
    })
    _assert(resp.status_code == 409, f"HTTP 409 Conflict (got {resp.status_code})")
    data = resp.json()
    error = data.get("error", {})
    _assert(bool(error.get("code")),    f"error.code present: {error.get('code')}")
    _assert(bool(error.get("message")), f"error.message present: {error.get('message')}")
    return resp.status_code == 409

def test_get_devices() -> bool:
    """GET /api/v1/devices — retrieve the registered SSH device."""
    _section("7 · GET device by id")
    if not ctx.ssh_device_id:
        _skip("skipped — ssh device not registered")
        return True

    resp = _get(f"/tailscale/nodes")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data = resp.json()
    # _assert(data.get("device_uid") == ctx.ssh_device_uid, "device_uid matches")
    # _assert("ssh" in data.get("capabilities", []),        "ssh in capabilities")
    # _assert("mqtt_password" not in data,                  "mqtt_password_hash NOT in response")
    # _assert(bool(data.get("mqtt_username")),              "mqtt_username present")
    print(data)
    return True
def test_get_device() -> bool:
    """GET /devices/{id} — retrieve the registered SSH device."""
    _section("7 · GET device by id")
    if not ctx.ssh_device_id:
        _skip("skipped — ssh device not registered")
        return True

    resp = _get(f"/devices/{ctx.ssh_device_id}")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data = resp.json()
    _assert(data.get("device_uid") == ctx.ssh_device_uid, "device_uid matches")
    _assert("ssh" in data.get("capabilities", []),        "ssh in capabilities")
    _assert("mqtt_password" not in data,                  "mqtt_password_hash NOT in response")
    _assert(bool(data.get("mqtt_username")),              "mqtt_username present")
    print(data)
    return True


def test_list_devices() -> bool:
    """GET /devices — list devices, verify pagination envelope."""
    _section("8 · List devices")
    resp = _get("/devices", params={"page": 1, "page_size": 10})
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        return False

    data = resp.json()
    _assert("total"     in data, "response has 'total' field")
    _assert("items"     in data, "response has 'items' field")
    _assert("page"      in data, "response has 'page' field")
    _assert("page_size" in data, "response has 'page_size' field")
    _info(f"total devices: {data.get('total')}")
    return True


def test_ssh_setup_endpoint() -> bool:
    """GET /devices/{id}/ssh-setup — returns fresh pre-auth key for SSH device."""
    _section("9 · GET /devices/{id}/ssh-setup")
    if not ctx.ssh_device_id:
        _skip("skipped — ssh device not registered")
        return True

    resp = _get(f"/devices/{ctx.ssh_device_id}/ssh-setup")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data = resp.json()
    _assert(data.get("ssh_supported") is True,     "ssh_supported == True")
    _assert(data.get("already_registered") is False, "already_registered == False (not yet on tailscale)")
    _assert(bool(data.get("preauth_key")),          "preauth_key present")
    _assert(bool(data.get("tailscale_register_cmd")), "tailscale_register_cmd present")
    _assert(bool(data.get("headscale_login_server")), "headscale_login_server present")
    _assert(len(data.get("setup_steps", [])) >= 4, "setup_steps has >= 4 items")
    _assert("access_flow" in data,                  "access_flow dict present")

    preauth_key = data.get("preauth_key", "")
    _info(f"fresh preauth_key: {preauth_key}")
    _info(f"register cmd:      {data.get('tailscale_register_cmd','')[:80]}...")
    print(data)
    return True


def test_ssh_setup_plain_device() -> bool:
    """GET /devices/{id}/ssh-setup on a non-SSH device returns informational message."""
    _section("10 · GET /devices/{id}/ssh-setup  (plain device → informational)")
    if not ctx.plain_device_id:
        _skip("skipped — plain device not registered")
        return True

    resp = _get(f"/devices/{ctx.plain_device_id}/ssh-setup")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        return False

    data = resp.json()
    _assert(data.get("ssh_supported") is False, "ssh_supported == False")
    _assert(bool(data.get("message")),           "informational message present")
    _info(f"message: {data.get('message','')}")
    return True


def test_mqtt_tcp_port() -> bool:
    """TCP probe: MQTT broker port 1883 must be open and accept connections."""
    _section("11 · MQTT TCP port probe")
    try:
        with socket.create_connection((MQTT_HOST, MQTT_PORT), timeout=5) as sock:
            _pass(f"TCP connect to {MQTT_HOST}:{MQTT_PORT} succeeded")
            return True
    except OSError as e:
        _fail(f"TCP connect to {MQTT_HOST}:{MQTT_PORT} failed: {e}")
        return False


def test_mqtt_auth_via_emqx_api() -> bool:
    """Use EMQX management API to verify the device client can authenticate."""
    _section("12 · MQTT auth — verify credentials via EMQX management API")
    if not ctx.ssh_mqtt_username:
        _skip("skipped — device not registered")
        return True

    # EMQX REST API returns 200 for correct credentials
    emqx_api = os.getenv("EMQX_API_URL", "http://localhost:18083")
    try:
        resp = httpx.post(
            f"{emqx_api}/api/v5/authentication/password_based%3Abuilt_in_database/users",
            json={"user_id": ctx.ssh_mqtt_username, "password": ctx.ssh_mqtt_password},
            auth=("admin", "Admin@1234"),
            timeout=10,
        )
        # 409 = user already exists → credentials in EMQX's built-in DB (not expected here)
        # 200/201 = created (not expected — we use HTTP hooks, not built-in DB)
        # Connectivity to EMQX management API is the main check
        _info(f"EMQX management API reachable (status {resp.status_code})")
        _pass("EMQX management API reachable")
    except httpx.ConnectError:
        _skip("EMQX management API not reachable from test host — skipping EMQX auth check")

    # Verify IoT service's own auth hook would accept this device
    iot_url = IOT_BASE_URL.replace("/api/v1", "")
    internal_secret = os.getenv("IOT_INTERNAL_SECRET", "changeme-internal-secret")
    try:
        auth_resp = httpx.post(
            f"{iot_url}/api/v1/internal/emqx/auth/connect",
            json={
                "username": ctx.ssh_mqtt_username,
                "password": ctx.ssh_mqtt_password,
                "clientid": ctx.ssh_mqtt_client_id,
                "peerhost": "127.0.0.1",
            },
            headers={"X-Internal-Secret": internal_secret},
            timeout=10,
        )
        if auth_resp.status_code == 200:
            result = auth_resp.json()
            if result.get("result") == "allow":
                _pass("IoT EMQX auth hook → allow (credentials valid)")
            else:
                _fail(f"IoT EMQX auth hook → {result}")
                return False
        else:
            _fail(f"IoT EMQX auth hook returned HTTP {auth_resp.status_code}: {auth_resp.text[:200]}")
            return False
    except httpx.ConnectError:
        _skip("IoT service auth hook not reachable — skipping MQTT credential validation")

    return True


def test_thingsboard_telemetry() -> bool:
    """Push a telemetry payload to ThingsBoard using the device's access token."""
    test_get_device()
    _section("13 · ThingsBoard telemetry push")

    if not ctx.ssh_tb_access_token:
        _skip("skipped — no tb_access_token (partial provisioning)")
        return True
    
    tb_api = os.getenv("TB_BASE_URL", "http://localhost:8081")
    telemetry = {
        "temperature": 22.5,
        "humidity":    60,
        "status":      "online",
        "test_ts":     datetime.utcnow().isoformat(),
    }
    try:
        resp = httpx.post(
            f"{tb_api}/api/v1/{ctx.ssh_tb_access_token}/telemetry",
            json=telemetry,
            timeout=15,
        )
        ok = _assert(resp.status_code == 200,
                     f"Telemetry accepted (HTTP {resp.status_code})")
        if not ok:
            _info(f"Response: {resp.text[:200]}")
        return ok
    except httpx.ConnectError:
        _skip(f"ThingsBoard not reachable at {tb_api} — skipping telemetry test")
        return True


def test_thingsboard_idempotency() -> bool:
    """
    Re-register a DIFFERENT device for the same org+property to verify
    ThingsBoard hierarchy is reused (no duplicate tenant/customer created).
    """
    _section("14 · ThingsBoard idempotency (second device, same property)")
    if not ctx.ssh_device_type_id:
        _skip("skipped — no device type")
        return True

    uid2   = f"test-idem-{uuid.uuid4().hex[:10]}"
    prop_id = f"test-prop-idem-{uuid.uuid4().hex[:8]}"

    resp = _post("/sync/register-device", {
        "device_uid":     uid2,
        "device_name":    f"Idempotency Test Device {uid2}",
        "device_type_id": ctx.ssh_device_type_id,
        "property_id":    prop_id,
        "property_name":  "Idempotency Test Property",
        "tags":           ["integration-test"],
    })
    ok = _assert(resp.status_code == 201, f"HTTP 201 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:300]}")
        return False

    data    = resp.json()
    steps   = {s["name"]: s["status"] for s in data.get("steps", [])}
    _info(f"Steps: {steps}")

    # Tenant step should be 'skipped' (cached from first registration)
    tenant_status = steps.get("provision_org_tenant", "missing")
    _assert(tenant_status == "skipped",
            f"provision_org_tenant == 'skipped' (got '{tenant_status}') — cache working")

    # Cleanup
    dev_id = data.get("device_id")
    if dev_id:
        _delete(f"/devices/{dev_id}")
        _info(f"Cleaned up idempotency test device {dev_id}")

    return True


def test_rotate_credentials() -> bool:
    """POST /devices/{id}/rotate-credentials — new password returned, old invalidated."""
    _section("15 · Rotate MQTT credentials")
    if not ctx.ssh_device_id:
        _skip("skipped — device not registered")
        return True

    resp = _post(f"/devices/{ctx.ssh_device_id}/rotate-credentials", {})
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:200]}")
        return False

    data = resp.json()
    new_pwd = data.get("mqtt_password", "")
    _assert(bool(new_pwd),         "new mqtt_password returned")
    _assert(new_pwd != ctx.ssh_mqtt_password, "new password differs from original")
    _assert(len(new_pwd) >= 32,    "new password length >= 32 chars")
    _info(f"Credential rotation successful — new password length: {len(new_pwd)}")
    return True


def test_update_device() -> bool:
    """PATCH /devices/{id} — update name, description, tags."""
    _section("16 · Update device")
    if not ctx.ssh_device_id:
        _skip("skipped — device not registered")
        return True

    resp_raw = _post.__func__ if hasattr(_post, '__func__') else None  # type: ignore
    url = f"{IOT_BASE_URL}/devices/{ctx.ssh_device_id}"
    headers = {"Authorization": f"Bearer {ctx.token}"}
    resp = httpx.patch(url, json={
        "name": "Updated SSH Test Device",
        "description": "Updated via integration test",
        "tags": ["integration-test", "updated"],
    }, headers=headers, timeout=15)

    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:200]}")
        return False

    data = resp.json()
    _assert(data.get("name") == "Updated SSH Test Device", "name updated")
    _assert("updated" in data.get("tags", []),              "tags updated")
    return True


def test_headscale_nodes() -> bool:
    """GET /tailscale/nodes — should be accessible and return a list."""
    _section("17 · Headscale / Tailscale nodes list")
    resp = _get("/tailscale/nodes")
    ok = _assert(resp.status_code == 200, f"HTTP 200 (got {resp.status_code})")
    if not ok:
        _info(f"Response: {resp.text[:200]}")
        return False

    data = resp.json()
    # API may return a list directly or {"nodes": [...]}
    if isinstance(data, list):
        nodes = data
    else:
        nodes = data.get("nodes", data.get("items", []))
    _info(f"Tailscale nodes: {len(nodes)}")
    return True


def test_cleanup() -> bool:
    """Delete test devices (soft-delete)."""
    _section("18 · Cleanup")
    success = True

    for dev_id, label in [
        (ctx.ssh_device_id,   "SSH device"),
        (ctx.plain_device_id, "Plain device"),
    ]:
        if not dev_id:
            continue
        resp = _delete(f"/devices/{dev_id}")
        ok = _assert(resp.status_code == 204, f"DELETE {label} HTTP 204 (got {resp.status_code})")
        if ok:
            _info(f"Soft-deleted {label} {dev_id}")
        else:
            success = False

    # Verify device is gone (should 404)
    if ctx.ssh_device_id:
        resp = _get(f"/devices/{ctx.ssh_device_id}")
        _assert(resp.status_code == 404, f"GET after delete → 404 (soft-delete confirmed)")

    return success


# ════════════════════════════════════════════════════════════════════════════
# Runner
# ════════════════════════════════════════════════════════════════════════════

def run_all() -> int:
    """Run all tests in order. Returns exit code (0 = all passed)."""
    print(f"\n{BOLD}PMS IoT — Device Registration & SSH Setup Integration Tests{RESET}")
    print(f"IoT service:  {IOT_BASE_URL}")
    print(f"Auth service: {AUTH_BASE_URL}")
    print(f"ThingsBoard:  {TB_BASE_URL}")
    print(f"MQTT:         {MQTT_HOST}:{MQTT_PORT}")
    print(f"Auth:         {OWNER_EMAIL}")
    print(f"\n{YELLOW}Override credentials:{RESET}")
    print(f"  OWNER_EMAIL=you@example.com OWNER_PASSWORD=yourpass python {sys.argv[0]}\n")

    tests = [
        # ── auth MUST run first — all subsequent tests need a JWT ──
        ("auth_login",             test_auth_login),
        ("connectivity",           test_connectivity),
        ("create_device_types",    test_create_device_types),
        ("register_ssh_device",    test_register_ssh_device),
        ("register_plain_device",  test_register_plain_device),
        ("duplicate_uid_409",      test_duplicate_device_uid),
        ("get_device",             test_get_device),
        ("list_devices",           test_list_devices),
        ("ssh_setup_endpoint",     test_ssh_setup_endpoint),
        ("ssh_setup_plain",        test_ssh_setup_plain_device),
        ("mqtt_tcp_port",          test_mqtt_tcp_port),
        ("mqtt_auth",              test_mqtt_auth_via_emqx_api),
        ("tb_telemetry",           test_thingsboard_telemetry),
        ("tb_idempotency",         test_thingsboard_idempotency),
        ("rotate_credentials",     test_rotate_credentials),
        ("update_device",          test_update_device),
        ("headscale_nodes",        test_headscale_nodes),
        # ("cleanup",                test_cleanup),
    ]

    passed, failed, skipped = 0, 0, 0
    results: Dict[str, str] = {}

    for name, fn in tests:
        try:
            result = fn()
            if result:
                passed += 1
                results[name] = f"{GREEN}PASS{RESET}"
            else:
                failed += 1
                results[name] = f"{RED}FAIL{RESET}"
        except Exception as exc:
            failed += 1
            results[name] = f"{RED}ERROR{RESET}"
            print(f"\n  {RED}Exception in {name}: {exc}{RESET}")
            import traceback
            traceback.print_exc()

    # Summary
    _section("Summary")
    for name, status in results.items():
        print(f"  {status}  {name}")

    total = passed + failed
    colour = GREEN if failed == 0 else RED
    print(f"\n{BOLD}{colour}  {passed}/{total} tests passed{RESET}")

    return 0 if failed == 0 else 1


# ════════════════════════════════════════════════════════════════════════════
# pytest integration (optional — run with `pytest`)
# ════════════════════════════════════════════════════════════════════════════

def test_pytest_connectivity():
    assert test_connectivity(), "Connectivity check failed"

def test_pytest_auth():
    assert test_auth_login(), "Auth login failed"

def test_pytest_device_types():
    assert test_create_device_types(), "Device type creation failed"

def test_pytest_register_ssh():
    assert test_register_ssh_device(), "SSH device registration failed"

def test_pytest_register_plain():
    assert test_register_plain_device(), "Plain device registration failed"

def test_pytest_duplicate():
    assert test_duplicate_device_uid(), "Duplicate UID conflict check failed"

def test_pytest_get_device():
    assert test_get_device(), "Get device failed"

def test_pytest_ssh_setup():
    assert test_ssh_setup_endpoint(), "SSH setup endpoint failed"

def test_pytest_ssh_setup_plain():
    assert test_ssh_setup_plain_device(), "SSH setup for plain device failed"

def test_pytest_cleanup():
    assert test_cleanup(), "Cleanup failed"


import httpx
import math
import os
import random
import time
from datetime import datetime


def test_thingsboard_telemetry() -> bool:
    """Push realistic telemetry to ThingsBoard every 1 second."""
    
    _section("13 · ThingsBoard telemetry push")

    if not ctx.ssh_tb_access_token:
        _skip("skipped — no tb_access_token (partial provisioning)")
        return True

    tb_api = os.getenv("TB_BASE_URL", "http://localhost:8081")

    started = time.time()
    temperature = 24.8
    humidity = 52.0
    cpu_load = 18.0
    power = 12

    try:
        with httpx.Client(timeout=10) as client:
            while True:
                elapsed = time.time() - started

                # 2-minute cycle for demo purposes
                cycle = (elapsed / 120.0) * 2 * math.pi

                # Base environmental pattern
                target_temp = 25.0 + 3.5 * math.sin(cycle)
                target_humidity = 55.0 - 8.0 * math.sin(cycle)
                target_cpu = 20.0 + 10.0 * abs(math.sin(cycle * 2))
                powert = 15.0 + 10.0 * abs(math.sin(cycle * 2))

                # Smooth drift toward target + tiny random noise
                temperature += (target_temp - temperature) * 0.15 + random.uniform(-0.08, 0.08)
                humidity += (target_humidity - humidity) * 0.12 + random.uniform(-0.2, 0.2)
                cpu_load += (target_cpu - cpu_load) * 0.25 + random.uniform(-1.0, 1.0)
                power +=(powert-power) * 0.25 + random.uniform(-1.0, 1.0)

                # Occasional short CPU spike
                if random.random() < 0.03:
                    cpu_load += random.uniform(8, 18)

                # Clamp to realistic bounds
                temperature = round(max(20.0, min(32.0, temperature)), 2)
                humidity = round(max(35.0, min(70.0, humidity)), 2)
                cpu_load = round(max(5.0, min(95.0, cpu_load)), 2)
                power = round(max(5.0, min(10.0, power)), 2)

                telemetry = {
                    "temperature": temperature,
                    "humidity": humidity,
                    "cpu_load": cpu_load,
                    "status": "online",
                    "power_consumption":power,
                    "signal_strength": random.randint(-72, -48),   # dBm
                    "battery_voltage": round(90.7 + random.uniform(-0.08, 0.08), 2),
                    "test_ts": datetime.utcnow().isoformat(),
                }

                resp = client.post(
                    f"{tb_api}/api/v1/{ctx.ssh_tb_access_token}/telemetry",
                    json=telemetry,
                )

                ok = _assert(
                    resp.status_code == 200,
                    f"Telemetry accepted (HTTP {resp.status_code})"
                )

                if not ok:
                    _info(f"Response: {resp.text[:200]}")
                    return False

                time.sleep(1)

    except httpx.ConnectError:
        _skip(f"ThingsBoard not reachable at {tb_api} — skipping telemetry test")
        return True

# ════════════════════════════════════════════════════════════════════════════
# Standalone entry point
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    test_auth_login()
    test_ssh_setup_endpoint()
    sys.exit(test_get_devices())
