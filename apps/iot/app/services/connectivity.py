"""
Connectivity health checker — probes all external services the IoT service
depends on and returns a structured report.
"""
import asyncio
from typing import Any, Dict
import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_TIMEOUT = 4.0


async def _check_mongodb() -> Dict[str, Any]:
    import time
    try:
        from app.core.database import get_motor_client
        from app.core.config import settings as cfg
        client = get_motor_client()
        t0 = time.monotonic()
        await client[cfg.mongo_db].command({"ping": 1})
        latency = round((time.monotonic() - t0) * 1000, 1)
        return {"status": "ok", "latency_ms": latency, "db": cfg.mongo_db}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_redis() -> Dict[str, Any]:
    try:
        import time
        from app.core.redis import get_redis
        redis = get_redis()
        t0 = time.monotonic()
        await redis.ping()
        latency = round((time.monotonic() - t0) * 1000, 1)
        return {"status": "ok", "latency_ms": latency}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_emqx() -> Dict[str, Any]:
    """
    Probes the EMQX management HTTP API.
    EMQX 5: GET /api/v5/status returns plain text "Node X is started\nemqx is running".
    Falls back to Basic-auth GET /api/v5/nodes for structured data.
    """
    url = settings.emqx_api_url.rstrip("/")
    auth = (settings.emqx_api_key, settings.emqx_api_secret) if settings.emqx_api_key else ("admin", "Admin@1234")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # Plain-text status (no auth required in most EMQX 5 setups)
            resp = await client.get(f"{url}/api/v5/status")
            if resp.status_code == 200 and "is running" in resp.text:
                # Also grab node info via authenticated endpoint
                try:
                    nodes_resp = await client.get(
                        f"{url}/api/v5/nodes",
                        auth=auth,
                    )
                    if nodes_resp.status_code == 200:
                        nodes = nodes_resp.json()
                        node = nodes[0] if nodes else {}
                        return {"status": "ok",
                                "node": node.get("node"),
                                "node_status": node.get("node_status", "running"),
                                "connections": node.get("connections", 0)}
                except Exception:
                    pass
                return {"status": "ok", "detail": resp.text.strip().split("\n")[0]}
            return {"status": "error", "http_status": resp.status_code, "body": resp.text[:200]}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_thingsboard() -> Dict[str, Any]:
    """
    Pings ThingsBoard by attempting sysadmin login.
    Success means TB is up and the configured credentials are valid.
    """
    url = settings.thingsboard_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{url}/api/auth/login",
                json={
                    "username": settings.thingsboard_sysadmin_email,
                    "password": settings.thingsboard_sysadmin_password,
                },
            )
        if resp.status_code == 200:
            return {"status": "ok", "auth": "sysadmin_login_ok"}
        return {"status": "error", "http_status": resp.status_code,
                "detail": "sysadmin login failed — check TB credentials in config"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_headscale() -> Dict[str, Any]:
    """
    Pings Headscale REST API health endpoint.
    Headscale 0.23 responds with 200 on GET /health.
    """
    url = settings.headscale_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{url}/health")
        if resp.status_code in (200, 204):
            return {"status": "ok"}
        # Some versions return 404 on /health but still run; try /api/v1/apikey
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp2 = await client.get(
                f"{url}/api/v1/apikey",
                headers={"Authorization": f"Bearer {settings.headscale_api_key}"},
            )
        if resp2.status_code in (200, 401, 403):
            return {"status": "ok", "note": "health endpoint absent, API responding"}
        return {"status": "error", "http_status": resp.status_code}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_rabbitmq() -> Dict[str, Any]:
    try:
        import app.core.rabbitmq as _rmq
        conn = getattr(_rmq, "_connection", None)
        if conn and not conn.is_closed:
            return {"status": "ok"}
        return {"status": "error", "error": "RabbitMQ connection is closed or not initialised"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_mqtt_port() -> Dict[str, Any]:
    """TCP-level check: can we open a socket to the MQTT broker?"""
    import time
    try:
        t0 = time.monotonic()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.mqtt_broker_host, settings.mqtt_broker_port),
            timeout=_TIMEOUT,
        )
        latency = round((time.monotonic() - t0) * 1000, 1)
        writer.close()
        await writer.wait_closed()
        return {"status": "ok", "latency_ms": latency,
                "host": settings.mqtt_broker_host, "port": settings.mqtt_broker_port}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def run_all() -> Dict[str, Any]:
    """Run all connectivity probes in parallel and return a consolidated report."""
    results = await asyncio.gather(
        _check_mongodb(),
        _check_redis(),
        _check_emqx(),
        _check_thingsboard(),
        _check_headscale(),
        _check_rabbitmq(),
        _check_mqtt_port(),
        return_exceptions=True,
    )

    keys = ["mongodb", "redis", "emqx", "thingsboard", "headscale", "rabbitmq", "mqtt_broker"]
    report: Dict[str, Any] = {}
    for key, result in zip(keys, results):
        if isinstance(result, Exception):
            report[key] = {"status": "error", "error": str(result)}
        else:
            report[key] = result

    all_ok = all(v.get("status") == "ok" for v in report.values())
    report["overall"] = "ok" if all_ok else "degraded"
    return report
