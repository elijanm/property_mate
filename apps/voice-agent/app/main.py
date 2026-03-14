"""PMS Voice Agent — FastAPI application entry point.


Endpoints:
  POST /webhook/telnyx            — Telnyx call-control webhooks
  WS   /ws/media/{call_control_id} — Telnyx media stream (audio I/O)
  GET  /calls                     — list call sessions
  GET  /calls/{id}                — single call session
  POST /calls/{ccid}/answer       — staff manually starts AI on a ringing call
  POST /calls/{ccid}/hangup       — hang up
  GET  /health                    — liveness probe
"""
import asyncio
import json
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.agent.pipeline import run_call_pipeline

INSTALLED_APPS = "installed_apps"


async def _get_org_app_config(db, org_id: str | None) -> dict | None:
    """Fetch voice-agent InstalledApp config for the org from MongoDB."""
    if not org_id:
        return None
    try:
        doc = await db[INSTALLED_APPS].find_one(
            {"org_id": org_id, "app_id": "voice-agent", "deleted_at": None},
            {"config": 1},
        )
        return (doc or {}).get("config") or None
    except Exception:
        return None
from app.api.calls import router as calls_router
from app.api.webhooks import router as webhooks_router
from app.core.config import settings
from app.core.database import close_connections, get_db
from app.core.logging import configure_logging
from app.models.conversation import CallSessionDocument
from app.services import pms_api

configure_logging()
logger = structlog.get_logger(__name__)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("voice_agent_starting", app=settings.APP_NAME, port=settings.PORT, status="started")

    # Ensure S3 bucket exists
    try:
        import aioboto3
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        ) as s3:
            existing = [b["Name"] for b in (await s3.list_buckets())["Buckets"]]
            if settings.S3_BUCKET not in existing:
                await s3.create_bucket(Bucket=settings.S3_BUCKET)
                logger.info("s3_bucket_created", bucket=settings.S3_BUCKET)
    except Exception as exc:
        logger.warning("s3_init_failed", error=str(exc))

    # Ensure MongoDB index on call_sessions
    try:
        db = get_db()
        await db[CallSessionDocument.COLLECTION].create_index("call_control_id", unique=True, sparse=True)
        await db[CallSessionDocument.COLLECTION].create_index([("org_id", 1), ("started_at", -1)])
        await db[CallSessionDocument.COLLECTION].create_index("status")
    except Exception as exc:
        logger.warning("db_index_init_failed", error=str(exc))

    logger.info("voice_agent_ready", status="success")
    yield

    await pms_api.close()
    await close_connections()
    logger.info("voice_agent_shutdown", status="success")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="AI voice agent for PMS — powered by Pipecat + Telnyx",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhooks_router)
app.include_router(calls_router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.APP_NAME}


# ── WebSocket: Telnyx media stream ────────────────────────────────────────────

@app.websocket("/ws/media/{call_control_id}")
async def media_stream(websocket: WebSocket, call_control_id: str):
    """
    Telnyx connects here after streaming_start is called.
    We look up the in-memory session, then run the Pipecat pipeline.
    """
    await websocket.accept()

    db = get_db()
    session = await db[CallSessionDocument.COLLECTION].find_one(
        {"call_control_id": call_control_id}
    )
    if not session:
        logger.warning(
            "ws_no_session",
            call_control_id=call_control_id,
            action="media_stream",
            status="error",
        )
        await websocket.close(code=1008)
        return

    logger.info(
        "ws_media_connected",
        action="media_stream",
        resource_type="call_session",
        resource_id=str(session["_id"]),
        org_id=session.get("org_id"),
        caller=session.get("caller_number"),
        status="started",
    )

    # Pre-fetch supporting context (may have been fetched at call.initiated too)
    org_id = session.get("org_id")
    tenant_id = session.get("tenant_id")
    tenant_info: dict | None = None
    lease_info: dict | None = None
    open_tickets: list[dict] = []

    app_config = await _get_org_app_config(db, org_id)

    if tenant_id:
        tenant_info_task = asyncio.create_task(pms_api.get_tenant(tenant_id))
        tickets_task = asyncio.create_task(pms_api.get_tenant_tickets(tenant_id, page_size=10))
        lease_task = asyncio.create_task(pms_api.get_tenant_lease(tenant_id))
        tenant_info, raw_tickets, lease_info = await asyncio.gather(
            tenant_info_task, tickets_task, lease_task
        )
        open_tickets = [
            t for t in raw_tickets
            if t.get("status") not in ("resolved", "closed", "cancelled")
        ]

    try:
        await run_call_pipeline(
            websocket=websocket,
            call_control_id=call_control_id,
            caller_number=session.get("caller_number", ""),
            org_id=org_id,
            session_doc=session,
            tenant_info=tenant_info,
            lease_info=lease_info,
            open_tickets=open_tickets,
            auto_mode=session.get("auto_mode", False),
            recording_enabled=bool(session.get("recording_enabled")),
            app_config=app_config,
        )
    except WebSocketDisconnect:
        logger.info(
            "ws_disconnected",
            action="media_stream",
            resource_id=str(session["_id"]),
            status="success",
        )
    except Exception as exc:
        logger.error(
            "ws_pipeline_error",
            action="media_stream",
            resource_id=str(session["_id"]),
            error=str(exc),
            status="error",
        )


# ── WebSocket: Browser-based sandbox call ────────────────────────────────────

@app.websocket("/ws/browser-call")
async def browser_call(
    websocket: WebSocket,
    phone: str = Query(default=""),
    org_id: str = Query(default=""),
):
    """Browser-based sandbox call — accepts raw PCM audio from the browser."""
    await websocket.accept()

    db = get_db()

    # Look up tenant by phone
    tenant = await pms_api.find_tenant_by_phone(phone) if phone else None
    tenant_id: str | None = (tenant or {}).get("id") or (tenant or {}).get("_id") or None
    tenant_name: str | None = None
    effective_org_id: str | None = org_id or settings.DEFAULT_ORG_ID or None

    if tenant:
        tenant_name = (
            tenant.get("name")
            or f"{tenant.get('first_name', '')} {tenant.get('last_name', '')}".strip()
        )
        effective_org_id = tenant.get("org_id") or effective_org_id

    # Fetch context if tenant found
    open_tickets: list[dict] = []
    lease_info: dict | None = None
    balance_due: float = 0.0
    if tenant_id:
        invoices, tickets, lease_info = await asyncio.gather(
            pms_api.get_tenant_invoices(tenant_id, page_size=5),
            pms_api.get_tenant_tickets(tenant_id, page_size=10),
            pms_api.get_tenant_lease(tenant_id),
        )
        balance_due = sum(
            i.get("balance_due", 0) for i in invoices if (i.get("balance_due") or 0) > 0
        )
        open_tickets = [
            t for t in tickets if t.get("status") not in ("resolved", "closed", "cancelled")
        ]

    app_config = await _get_org_app_config(db, effective_org_id)

    # Create call session document
    call_control_id = f"browser-{uuid4().hex[:12]}"
    session = CallSessionDocument.new(
        call_control_id=call_control_id,
        caller_number=phone or "browser-sandbox",
        called_number=settings.TELNYX_PHONE_NUMBER or "sandbox",
        org_id=effective_org_id,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        auto_mode=True,
    )
    session["balance_due"] = balance_due
    session["recording_enabled"] = settings.RECORDING_ENABLED  # honour config for browser too
    await db[CallSessionDocument.COLLECTION].insert_one(session)

    logger.info(
        "browser_call_started",
        action="browser_call",
        resource_type="call_session",
        resource_id=session["_id"],
        org_id=effective_org_id,
        caller=phone,
        tenant_matched=tenant_name is not None,
        status="started",
    )

    # Send session metadata to the browser before audio pipeline starts.
    # call_control_id is sent so the browser can call the hangup API for clean shutdown.
    await websocket.send_text(json.dumps({
        "call_control_id": call_control_id,
        "tenant_name": tenant_name,
        "tenant_id": tenant_id,
        "balance_due": balance_due if balance_due else None,
        "org_id": effective_org_id,
    }))

    try:
        await run_call_pipeline(
            websocket=websocket,
            call_control_id=call_control_id,
            caller_number=phone or "browser-sandbox",
            org_id=effective_org_id,
            session_doc=session,
            tenant_info=tenant,
            lease_info=lease_info,
            open_tickets=open_tickets,
            auto_mode=True,
            browser_mode=True,
            recording_enabled=settings.RECORDING_ENABLED,
            app_config=app_config,
        )
    except WebSocketDisconnect:
        logger.info(
            "browser_call_disconnected",
            action="browser_call",
            resource_id=session["_id"],
            status="success",
        )
    except Exception as exc:
        logger.error(
            "browser_call_error",
            action="browser_call",
            resource_id=session["_id"],
            error=str(exc),
            status="error",
        )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level=settings.LOG_LEVEL.lower(),
    )
