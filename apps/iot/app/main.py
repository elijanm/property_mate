import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db, close_db
from app.core.redis import init_redis, close_redis
from app.core.rabbitmq import init_rabbitmq, close_rabbitmq
from app.core.logging import configure_logging
from app.core.exceptions import add_exception_handlers
from app.core.middleware import RequestIDMiddleware, TimingMiddleware
from app.core.metrics import setup_metrics
from app.models.device import Device
from app.models.device_type import DeviceType
from app.models.edge_gateway import EdgeGateway
from app.models.device_command import DeviceCommand
from app.models.ssh_access_request import SSHAccessRequest
from app.models.ssh_audit_log import SSHAuditLog
from app.models.alert_rule import AlertRule
from app.models.device_group import DeviceGroup
from app.models.ota_update import OTAUpdate
from app.services.mqtt_subscriber import start_subscriber, stop_subscriber
from app.services import headscale_client, thingsboard_client
from app.services.ssh_service import expire_overdue_requests
from app.services.heartbeat_service import run_heartbeat_sweep
from app.services.cert_monitor_service import run_cert_expiry_sweep
from app.api.v1.router import api_router


async def _expiry_sweep():
    """Background task: expire SSH grants every 60s."""
    while True:
        await asyncio.sleep(60)
        try:
            count = await expire_overdue_requests()
            if count:
                from app.core.logging import get_logger
                get_logger(__name__).info("ssh_grants_expired", count=count)
        except Exception as e:
            from app.core.logging import get_logger
            get_logger(__name__).error("ssh_expiry_sweep_failed", error=str(e))


async def _heartbeat_sweep():
    """Background task: mark devices offline if they miss heartbeat — runs every 30s."""
    while True:
        await asyncio.sleep(30)
        try:
            count = await run_heartbeat_sweep()
            if count:
                from app.core.logging import get_logger
                get_logger(__name__).info("heartbeat_sweep_completed", devices_marked_offline=count)
        except Exception as e:
            from app.core.logging import get_logger
            get_logger(__name__).error("heartbeat_sweep_failed", error=str(e))


async def _ensure_ssh_console_key() -> None:
    """Auto-generate an Ed25519 SSH key pair for the WebSocket console proxy."""
    from app.core.config import settings
    key_path = settings.ssh_console_key_path
    if not key_path or os.path.exists(key_path):
        return
    try:
        import asyncssh
        os.makedirs(os.path.dirname(key_path), exist_ok=True)
        key = asyncssh.generate_private_key("ssh-ed25519", comment="pms-iot-console")
        key.write_private_key(key_path)
        key.write_public_key(key_path + ".pub")
        os.chmod(key_path, 0o600)
        from app.core.logging import get_logger
        get_logger(__name__).info("ssh_console_key_generated", key_path=key_path)
    except Exception as exc:
        from app.core.logging import get_logger
        get_logger(__name__).warning("ssh_console_key_generation_failed", error=str(exc))


async def _cert_expiry_sweep():
    """Background task: check certificate expiry — runs every 6 hours."""
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            count = await run_cert_expiry_sweep()
            if count:
                from app.core.logging import get_logger
                get_logger(__name__).info("cert_expiry_sweep_completed", alerted_count=count)
        except Exception as e:
            from app.core.logging import get_logger
            get_logger(__name__).error("cert_expiry_sweep_failed", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await init_db(app, document_models=[
        Device, DeviceType, EdgeGateway, DeviceCommand, SSHAccessRequest, SSHAuditLog,
        AlertRule, DeviceGroup, OTAUpdate,
    ])
    await init_redis(app)
    await init_rabbitmq(app)

    # Generate SSH console key pair if missing
    await _ensure_ssh_console_key()

    # Start background MQTT subscriber
    mqtt_task = asyncio.create_task(start_subscriber())
    # Start SSH expiry sweep
    expiry_task = asyncio.create_task(_expiry_sweep())
    # Start heartbeat monitor (marks offline devices)
    heartbeat_task = asyncio.create_task(_heartbeat_sweep())
    # Start certificate expiry monitor
    cert_task = asyncio.create_task(_cert_expiry_sweep())

    yield

    # Shutdown
    stop_subscriber()
    mqtt_task.cancel()
    expiry_task.cancel()
    heartbeat_task.cancel()
    cert_task.cancel()
    await close_rabbitmq(app)
    await close_redis(app)
    await close_db(app)
    await headscale_client.close()
    await thingsboard_client.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="PMS IoT Service",
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(TimingMiddleware)
    app.add_middleware(RequestIDMiddleware)

    add_exception_handlers(app)
    setup_metrics(app)
    app.include_router(api_router)

    @app.get("/api/v1/health")
    async def health():
        return {"status": "ok", "service": "iot"}

    return app


app = create_app()
