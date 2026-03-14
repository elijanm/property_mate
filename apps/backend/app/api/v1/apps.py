"""App Marketplace API — install, configure, and query installed apps.

Also proxies voice-agent call data from the shared MongoDB `call_sessions`
collection so the PMS backend is the single API surface for the frontend.
"""
from datetime import datetime, timezone
from typing import Any, Optional
import httpx
import motor.motor_asyncio
from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_motor_db
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.installed_app import InstalledApp
from app.models.app_waitlist import AppWaitlist
from app.models.user import User
from app.repositories.installed_app_repository import InstalledAppRepository

router = APIRouter(prefix="/apps", tags=["apps"])
repo = InstalledAppRepository()

CALL_SESSIONS = "call_sessions"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask_secrets(config: dict) -> dict:
    """Mask API key values so they are not returned in GET responses."""
    masked = dict(config)
    for key in ("llm_api_key", "elevenlabs_api_key", "deepgram_api_key"):
        val = masked.get(key, "")
        if val and len(val) > 4:
            masked[key] = "••••" + val[-4:]
        elif val:
            masked[key] = "••••"
    return masked


def _app_response(app: InstalledApp, mask: bool = True) -> dict:
    data = app.model_dump()
    data["id"] = str(app.id)
    if mask:
        data["config"] = _mask_secrets(data.get("config", {}))
    return data


# ── Schemas ───────────────────────────────────────────────────────────────────

class InstallAppRequest(BaseModel):
    app_name: str
    config: dict[str, Any] = {}


class UpdateConfigRequest(BaseModel):
    config: dict[str, Any]


# ── Installed apps CRUD ───────────────────────────────────────────────────────

@router.get("")
async def list_apps(
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    apps = await repo.list_for_org(current_user.org_id)
    return {"items": [_app_response(a) for a in apps]}


# ── Waitlist — must be declared before /{app_id} to avoid route shadowing ─────

@router.get("/waitlist")
async def get_waitlist(
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    """Return app_ids the current user has joined the waitlist for."""
    entries = await AppWaitlist.find(
        AppWaitlist.user_id == current_user.user_id,
        AppWaitlist.org_id == current_user.org_id,
        AppWaitlist.deleted_at == None,  # noqa: E711
    ).to_list()
    return {"app_ids": [e.app_id for e in entries]}


@router.post("/{app_id}/install")
async def install_app(
    app_id: str,
    request: InstallAppRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "superadmin")),
):
    existing = await repo.get_by_app_id(current_user.org_id, app_id)
    if existing:
        raise HTTPException(status_code=409, detail="App already installed for this org")

    app = InstalledApp(
        org_id=current_user.org_id,
        app_id=app_id,
        app_name=request.app_name,
        status="active",
        config=request.config,
        installed_by=current_user.user_id,
    )
    await repo.create(app)
    return _app_response(app)


@router.get("/{app_id}")
async def get_app(
    app_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    app = await repo.get_by_app_id(current_user.org_id, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not installed")
    return _app_response(app)


@router.patch("/{app_id}/config")
async def update_config(
    app_id: str,
    request: UpdateConfigRequest,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "superadmin")),
):
    app = await repo.get_by_app_id(current_user.org_id, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not installed")

    # Merge: preserve existing secrets if new value is masked
    merged = dict(app.config)
    for k, v in request.config.items():
        if isinstance(v, str) and v.startswith("••••"):
            continue  # client sent back masked value — keep original
        merged[k] = v

    await repo.update_config(app, merged)
    return _app_response(app)


@router.delete("/{app_id}")
async def uninstall_app(
    app_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "superadmin")),
):
    app = await repo.get_by_app_id(current_user.org_id, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="App not installed")
    await repo.soft_delete(app)
    return {"ok": True}


# ── Voice Agent: call history & metrics ───────────────────────────────────────

@router.get("/voice-agent/calls")
async def list_calls(
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    tenant_id: Optional[str] = Query(None),
    db: motor.motor_asyncio.AsyncIOMotorDatabase = Depends(get_motor_db),
):
    filt: dict = {"org_id": current_user.org_id}
    if status:
        filt["status"] = status
    if tenant_id:
        filt["tenant_id"] = tenant_id

    skip = (page - 1) * page_size
    cursor = db[CALL_SESSIONS].find(filt).sort("started_at", -1).skip(skip).limit(page_size)
    items = []
    async for doc in cursor:
        doc["id"] = str(doc.pop("_id", ""))
        items.append(doc)
    total = await db[CALL_SESSIONS].count_documents(filt)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/voice-agent/calls/{session_id}")
async def get_call(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
    db: motor.motor_asyncio.AsyncIOMotorDatabase = Depends(get_motor_db),
):
    doc = await db[CALL_SESSIONS].find_one(
        {"_id": session_id, "org_id": current_user.org_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    doc["id"] = str(doc.pop("_id", ""))
    return doc


@router.post("/voice-agent/calls/{call_control_id}/hangup")
async def hangup_call(
    call_control_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
    db: motor.motor_asyncio.AsyncIOMotorDatabase = Depends(get_motor_db),
):
    """Proxy hangup request to the voice agent service.
    Verifies the call belongs to the org before forwarding.
    Also marks the session as completed in MongoDB so the Live Calls tab
    stops showing it even before the pipeline's finally block runs."""
    from datetime import datetime, timezone

    doc = await db[CALL_SESSIONS].find_one(
        {"call_control_id": call_control_id, "org_id": current_user.org_id},
        {"_id": 1, "status": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Active call not found for this org")

    # Signal the voice-agent pipeline to stop (fire-and-forget — best effort)
    from app.core.config import settings as _settings
    try:
        async with httpx.AsyncClient(timeout=5) as http:
            await http.post(
                f"{_settings.voice_agent_url}/calls/{call_control_id}/hangup"
            )
    except Exception:
        pass  # Voice agent may be unreachable; MongoDB update below handles UI

    # Optimistically mark as completed so the Live Calls refresh shows it gone.
    # The pipeline's finally block will overwrite with the real terminal status
    # (completed/transferred) and accurate duration/summary when it finishes.
    if doc.get("status") == "active":
        now = datetime.now(timezone.utc)
        await db[CALL_SESSIONS].update_one(
            {"_id": doc["_id"], "status": "active"},
            {"$set": {"status": "completed", "ended_at": now, "updated_at": now}},
        )

    return {"ok": True}


@router.get("/voice-agent/calls/{session_id}/recording")
async def get_call_recording(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
    db: motor.motor_asyncio.AsyncIOMotorDatabase = Depends(get_motor_db),
):
    """Proxy recording URL request to the voice agent service (holds S3 credentials)."""
    doc = await db[CALL_SESSIONS].find_one(
        {"_id": session_id, "org_id": current_user.org_id},
        {"recording_key": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Call session not found")
    if not doc.get("recording_key"):
        raise HTTPException(status_code=404, detail="No recording for this call")

    from app.core.config import settings as _settings
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.get(
            f"{_settings.voice_agent_url}/calls/{session_id}/recording"
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Recording not found")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Voice agent error")
    return resp.json()


@router.get("/voice-agent/metrics")
async def get_metrics(
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
    db: motor.motor_asyncio.AsyncIOMotorDatabase = Depends(get_motor_db),
):
    org_id = current_user.org_id
    filt = {"org_id": org_id}

    pipeline = [
        {"$match": filt},
        {
            "$group": {
                "_id": None,
                "total_calls": {"$sum": 1},
                "answered": {
                    "$sum": {"$cond": [{"$in": ["$status", ["completed", "transferred"]]}, 1, 0]}
                },
                "transferred": {
                    "$sum": {"$cond": [{"$eq": ["$status", "transferred"]}, 1, 0]}
                },
                "avg_duration": {"$avg": "$duration_seconds"},
                "tickets_created": {
                    "$sum": {
                        "$size": {
                            "$filter": {
                                "input": {"$ifNull": ["$actions_taken", []]},
                                "cond": {"$regexMatch": {"input": "$$this", "regex": "ticket"}},
                            }
                        }
                    }
                },
                "payment_links": {
                    "$sum": {
                        "$size": {
                            "$filter": {
                                "input": {"$ifNull": ["$actions_taken", []]},
                                "cond": {"$regexMatch": {"input": "$$this", "regex": "payment"}},
                            }
                        }
                    }
                },
                "unique_callers": {"$addToSet": "$caller_number"},
            }
        },
        {
            "$project": {
                "_id": 0,
                "total_calls": 1,
                "answered_calls": "$answered",
                "transferred_calls": "$transferred",
                "avg_duration_seconds": {"$round": ["$avg_duration", 0]},
                "tickets_created": 1,
                "payment_links_sent": "$payment_links",
                "unique_callers": {"$size": "$unique_callers"},
            }
        },
    ]

    agg = await db[CALL_SESSIONS].aggregate(pipeline).to_list(1)
    metrics = agg[0] if agg else {
        "total_calls": 0,
        "answered_calls": 0,
        "transferred_calls": 0,
        "avg_duration_seconds": 0,
        "tickets_created": 0,
        "payment_links_sent": 0,
        "unique_callers": 0,
    }

    # Calls per day (last 30 days)
    by_day_pipeline = [
        {"$match": {**filt, "started_at": {"$exists": True}}},
        {
            "$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m-%d", "date": "$started_at"}
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
        {"$limit": 30},
        {"$project": {"_id": 0, "date": "$_id", "count": 1}},
    ]
    calls_by_day = await db[CALL_SESSIONS].aggregate(by_day_pipeline).to_list(30)
    metrics["calls_by_day"] = calls_by_day

    return metrics


@router.get("/voice-agent/voices")
async def list_voices(
    provider: str = Query("elevenlabs"),
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    """Return available TTS voices for the given provider."""
    if provider == "openai":
        return {"voices": [
            {"id": "alloy", "name": "Alloy"},
            {"id": "echo", "name": "Echo"},
            {"id": "fable", "name": "Fable"},
            {"id": "onyx", "name": "Onyx"},
            {"id": "nova", "name": "Nova"},
            {"id": "shimmer", "name": "Shimmer"},
        ]}

    if provider == "deepgram":
        return {"voices": [
            {"id": "aura-asteria-en", "name": "Asteria (EN)"},
            {"id": "aura-luna-en", "name": "Luna (EN)"},
            {"id": "aura-stella-en", "name": "Stella (EN)"},
            {"id": "aura-athena-en", "name": "Athena (EN)"},
            {"id": "aura-hera-en", "name": "Hera (EN)"},
            {"id": "aura-orion-en", "name": "Orion (EN)"},
            {"id": "aura-arcas-en", "name": "Arcas (EN)"},
            {"id": "aura-perseus-en", "name": "Perseus (EN)"},
            {"id": "aura-orpheus-en", "name": "Orpheus (EN)"},
            {"id": "aura-zeus-en", "name": "Zeus (EN)"},
        ]}

    if provider == "elevenlabs":
        app = await repo.get_by_app_id(current_user.org_id, "voice-agent")
        if not app:
            raise HTTPException(status_code=404, detail="Voice agent not installed")
        api_key = app.config.get("elevenlabs_api_key", "")
        if not api_key:
            raise HTTPException(status_code=400, detail="ElevenLabs API key not configured")
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": api_key},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="ElevenLabs API error")
        voices = r.json().get("voices", [])
        return {"voices": [{"id": v["voice_id"], "name": v["name"]} for v in voices]}

    return {"voices": []}


@router.post("/voice-agent/sandbox")
async def sandbox_test(
    request: dict,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    """Simulate a call conversation without touching Telnyx.
    Returns what the LLM would say given a scenario.
    """
    app = await repo.get_by_app_id(current_user.org_id, "voice-agent")
    if not app:
        raise HTTPException(status_code=404, detail="Voice Agent not installed")

    cfg = app.config
    scenario = request.get("scenario", "")  # "known_tenant" | "unknown" | "prospect"
    phone = request.get("phone_number", "+254000000000")
    user_message = request.get("message", "Hello, I want to know my balance")

    # Real lookup by phone within org
    tenant = await User.find_one(
        User.phone == phone,
        User.role == "tenant",
        User.org_id == current_user.org_id,
        User.deleted_at == None,  # noqa: E711
    )
    tenant_matched = tenant is not None
    tenant_name = f"{tenant.first_name} {tenant.last_name}".strip() if tenant else None

    return {
        "scenario": scenario,
        "phone_number": phone,
        "tenant_matched": tenant_matched,
        "tenant_name": tenant_name,
        "agent_name": cfg.get("agent_name", "Alex"),
        "llm_provider": cfg.get("llm_provider", "openai"),
        "llm_model": cfg.get("llm_model", "gpt-4o"),
        "tts_provider": cfg.get("tts_provider", "openai"),
        "auto_mode": cfg.get("auto_mode", False),
        "greeting": (
            f"Hello, thank you for calling {cfg.get('company_name', 'us')}. "
            "This call may be recorded for quality and training purposes. "
            f"I'm {cfg.get('agent_name', 'Alex')}, your virtual assistant. How can I help you today?"
        ),
        "user_message": user_message,
        "note": "Full LLM simulation available when voice-agent service is running.",
    }


@router.post("/{app_id}/notify-me", status_code=200)
async def notify_me(
    app_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _: None = Depends(require_roles("owner", "agent", "superadmin")),
):
    """Add the current user to the waiting list for a coming-soon app."""
    # Upsert — ignore duplicates gracefully
    try:
        entry = AppWaitlist(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            app_id=app_id,
        )
        await entry.insert()
    except Exception:
        pass  # Already on waitlist — idempotent
    return {"ok": True, "app_id": app_id}
