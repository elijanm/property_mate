"""Security API — IP ban management, request logs, threat dashboard."""
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, Query, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import require_roles
from app.models.ip_record import IPRecord
from app.models.request_log import RequestLog
from app.services import ip_analyzer_service
from app.utils.datetime import utc_now

router = APIRouter(prefix="/security", tags=["security"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_admin = Depends(require_roles("admin"))


# ── Schemas ───────────────────────────────────────────────────────────────────

class BanRequest(BaseModel):
    reason: str
    expires_hours: Optional[int] = None   # None = permanent


class IPSummary(BaseModel):
    ip: str
    threat_score: float
    is_banned: bool
    ban_reason: str
    total_requests: int
    upload_attempts: int
    blocked_uploads: int
    suspicious_path_hits: int
    first_seen: str
    last_seen: str
    risk_level: str


def _risk(score: float) -> str:
    if score >= 0.85: return "critical"
    if score >= 0.60: return "high"
    if score >= 0.35: return "medium"
    return "low"


# ── IP endpoints ──────────────────────────────────────────────────────────────

@router.get("/ips", dependencies=[_admin])
async def list_ips(
    banned_only: bool = Query(False),
    min_threat: float = Query(0.0),
    limit: int = Query(100, le=500),
    skip: int = Query(0),
):
    """List tracked IPs, optionally filtered to banned/suspicious."""
    q = {}
    if banned_only:
        q["is_banned"] = True
    if min_threat > 0:
        q["threat_score"] = {"$gte": min_threat}

    records = await IPRecord.find(q).sort("-threat_score").skip(skip).limit(limit).to_list()
    total = await IPRecord.find(q).count()

    return {
        "total": total,
        "items": [_to_summary(r) for r in records],
    }


@router.get("/ips/{ip}", dependencies=[_admin])
async def get_ip(ip: str):
    """Get full details for a specific IP."""
    record = await IPRecord.find_one({"ip": ip})
    if not record:
        raise HTTPException(status_code=404, detail="IP not tracked")
    return record.model_dump()


@router.post("/ips/{ip}/ban", dependencies=[_admin])
async def ban_ip(ip: str, body: BanRequest):
    """Manually ban an IP address. Requires admin role."""
    record = await ip_analyzer_service.ban_ip(ip, body.reason, body.expires_hours)
    return _to_summary(record)


@router.delete("/ips/{ip}/ban", dependencies=[_admin])
async def unban_ip(ip: str):
    """Lift a ban on an IP address. Requires admin role."""
    record = await ip_analyzer_service.unban_ip(ip)
    if not record:
        raise HTTPException(status_code=404, detail="IP not tracked")
    return _to_summary(record)


@router.delete("/ips/{ip}", dependencies=[_admin])
async def delete_ip(ip: str):
    """Remove all tracking data for an IP (GDPR erasure). Requires admin role."""
    record = await IPRecord.find_one({"ip": ip})
    if not record:
        raise HTTPException(status_code=404, detail="IP not tracked")
    await record.delete()
    return {"deleted": ip}


# ── Request log endpoints ─────────────────────────────────────────────────────

@router.get("/logs", dependencies=[_admin])
async def list_logs(
    ip: Optional[str] = Query(None),
    path: Optional[str] = Query(None),
    blocked_only: bool = Query(False),
    upload_only: bool = Query(False),
    limit: int = Query(100, le=1000),
    skip: int = Query(0),
):
    """Paginated request log — newest first."""
    q = {}
    if ip:
        q["ip"] = ip
    if path:
        q["path"] = {"$regex": path, "$options": "i"}
    if blocked_only:
        q["blocked"] = True
    if upload_only:
        q["is_upload"] = True

    logs = await RequestLog.find(q).sort("-timestamp").skip(skip).limit(limit).to_list()
    total = await RequestLog.find(q).count()

    return {
        "total": total,
        "items": [log.model_dump() for log in logs],
    }


@router.delete("/logs", dependencies=[_admin])
async def clear_logs(older_than_days: int = Query(30)):
    """Delete request logs older than N days."""
    cutoff = utc_now()
    from datetime import timedelta
    cutoff = cutoff.replace(day=cutoff.day - older_than_days) if older_than_days <= cutoff.day else \
        utc_now() - timedelta(days=older_than_days)
    result = await RequestLog.find({"timestamp": {"$lt": cutoff}}).delete()
    return {"deleted": result}


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/dashboard", dependencies=[_admin])
async def dashboard():
    """Aggregate security statistics for the UI dashboard."""
    from datetime import timedelta

    now = utc_now()
    last_1h = now - timedelta(hours=1)
    last_24h = now - timedelta(hours=24)

    total_ips = await IPRecord.count()
    banned_count = await IPRecord.find({"is_banned": True}).count()
    critical_count = await IPRecord.find({"threat_score": {"$gte": 0.85}, "is_banned": False}).count()
    high_count = await IPRecord.find({"threat_score": {"$gte": 0.60, "$lt": 0.85}}).count()

    requests_1h = await RequestLog.find({"timestamp": {"$gte": last_1h}}).count()
    blocked_1h = await RequestLog.find({"timestamp": {"$gte": last_1h}, "blocked": True}).count()
    uploads_1h = await RequestLog.find({"timestamp": {"$gte": last_1h}, "is_upload": True}).count()
    blocked_uploads_1h = await RequestLog.find(
        {"timestamp": {"$gte": last_1h}, "is_upload": True, "blocked": True}
    ).count()
    requests_24h = await RequestLog.find({"timestamp": {"$gte": last_24h}}).count()

    # Top 10 most suspicious IPs not yet banned
    suspicious = await IPRecord.find(
        {"is_banned": False, "threat_score": {"$gte": 0.35}}
    ).sort("-threat_score").limit(10).to_list()

    # Recent blocked requests
    recent_blocks = await RequestLog.find({"blocked": True}).sort("-timestamp").limit(20).to_list()

    return {
        "ip_counts": {
            "total": total_ips,
            "banned": banned_count,
            "critical": critical_count,
            "high": high_count,
        },
        "requests": {
            "last_1h": requests_1h,
            "blocked_1h": blocked_1h,
            "block_rate_1h": round(blocked_1h / max(requests_1h, 1), 4),
            "uploads_1h": uploads_1h,
            "blocked_uploads_1h": blocked_uploads_1h,
            "last_24h": requests_24h,
        },
        "top_suspicious": [_to_summary(r) for r in suspicious],
        "recent_blocks": [log.model_dump() for log in recent_blocks],
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_summary(r: IPRecord) -> dict:
    return {
        "ip":                    r.ip,
        "threat_score":          r.threat_score,
        "is_banned":             r.is_banned,
        "ban_reason":            r.ban_reason,
        "total_requests":        r.total_requests,
        "upload_attempts":       r.upload_attempts,
        "blocked_uploads":       r.blocked_uploads,
        "suspicious_path_hits":  r.suspicious_path_hits,
        "first_seen":            r.first_seen.isoformat(),
        "last_seen":             r.last_seen.isoformat(),
        "risk_level":            _risk(r.threat_score),
        "threat_reasons":        r.threat_reasons,
    }
