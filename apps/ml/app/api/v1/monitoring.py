"""
ML monitoring API — performance snapshots, rolling summaries, drift detection.

Endpoints:
  GET  /monitoring/overview                            — all-models 24h summary
  GET  /monitoring/performance/{trainer}               — hourly snapshots (last 24h)
  GET  /monitoring/performance/{trainer}/summary       — rolling summary (configurable window)
  POST /monitoring/performance/{trainer}/snapshot      — force-compute a snapshot now
  GET  /monitoring/drift/{trainer}/baseline            — current baseline info
  POST /monitoring/drift/{trainer}/baseline            — (re)set baseline from recent logs
  POST /monitoring/drift/{trainer}/check               — run drift check now
  GET  /monitoring/drift/{trainer}/alerts              — list drift alerts
  PATCH /monitoring/drift/alerts/{alert_id}            — acknowledge / resolve alert
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import require_roles, get_current_user

router = APIRouter(prefix="/monitoring", tags=["monitoring"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


# ── Performance ───────────────────────────────────────────────────────────────

@router.get("/overview")
async def overview(user=Depends(get_current_user)):
    """All-models 24-hour performance summary."""
    from app.services.performance_service import get_all_models_summary
    return {"models": await get_all_models_summary(user.org_id)}


@router.get("/performance/{trainer_name}")
async def get_performance_snapshots(
    trainer_name: str,
    hours: int = Query(24, ge=1, le=168),
    window_type: str = Query("hourly"),
    user=Depends(get_current_user),
):
    """
    Return pre-computed hourly snapshots for the given trainer.
    `hours` controls how far back to look (default 24, max 168 = 1 week).
    """
    from app.services.performance_service import get_performance_snapshots
    snaps = await get_performance_snapshots(trainer_name, hours=hours, window_type=window_type, org_id=user.org_id)
    return {
        "trainer_name": trainer_name,
        "window_type": window_type,
        "hours": hours,
        "snapshots": [
            {
                "window_start": s.window_start.isoformat(),
                "window_end": s.window_end.isoformat(),
                "total_requests": s.total_requests,
                "error_count": s.error_count,
                "error_rate": s.error_rate,
                "latency_avg": s.latency_avg,
                "latency_p50": s.latency_p50,
                "latency_p95": s.latency_p95,
                "latency_p99": s.latency_p99,
                "latency_max": s.latency_max,
                "top_errors": s.top_errors,
                "unique_orgs": s.unique_orgs,
            }
            for s in snaps
        ],
    }


@router.get("/performance/{trainer_name}/summary")
async def get_rolling_summary(
    trainer_name: str,
    hours: int = Query(24, ge=1, le=168),
    user=Depends(get_current_user),
):
    """Live rolling summary computed directly from InferenceLogs (no pre-aggregation)."""
    from app.services.performance_service import get_rolling_summary
    return await get_rolling_summary(trainer_name, hours=hours, org_id=user.org_id)


@router.post("/performance/{trainer_name}/snapshot", dependencies=[_engineer])
async def force_snapshot(trainer_name: str, hours_back: int = Query(1, ge=1, le=24)):
    """
    Force-compute a performance snapshot for the last `hours_back` hour(s).
    Useful for testing or backfilling.
    """
    from datetime import timedelta
    from app.utils.datetime import utc_now
    from app.services.performance_service import compute_performance_snapshot

    now = utc_now()
    window_end = now
    window_start = now - timedelta(hours=hours_back)
    snap = await compute_performance_snapshot(
        trainer_name, window_start, window_end, "hourly"
    )
    return {
        "trainer_name": trainer_name,
        "window_start": snap.window_start.isoformat(),
        "window_end": snap.window_end.isoformat(),
        "total_requests": snap.total_requests,
        "error_count": snap.error_count,
        "error_rate": snap.error_rate,
        "latency_avg": snap.latency_avg,
        "latency_p95": snap.latency_p95,
    }


# ── Drift ─────────────────────────────────────────────────────────────────────

@router.get("/drift/{trainer_name}/baseline")
async def get_baseline(trainer_name: str, user=Depends(get_current_user)):
    """Return the current baseline metadata (feature names, sample count, created_at)."""
    from app.models.drift_baseline import DriftBaseline
    bl = await DriftBaseline.find_one(DriftBaseline.trainer_name == trainer_name, DriftBaseline.org_id == user.org_id)
    if not bl:
        raise HTTPException(status_code=404, detail=f"No baseline found for '{trainer_name}'")
    return {
        "trainer_name": bl.trainer_name,
        "sample_count": bl.sample_count,
        "created_at": bl.created_at.isoformat(),
        "features": {
            fname: {
                "feature_type": fb.feature_type,
                **(
                    {
                        "count": fb.numeric.count,
                        "mean": round(fb.numeric.mean, 4),
                        "std": round(fb.numeric.std, 4),
                        "min": round(fb.numeric.min, 4),
                        "max": round(fb.numeric.max, 4),
                    }
                    if fb.feature_type == "numeric" and fb.numeric
                    else {}
                ),
                **(
                    {
                        "count": fb.categorical.count,
                        "top_values": sorted(
                            fb.categorical.value_freqs.items(),
                            key=lambda x: -x[1],
                        )[:10],
                    }
                    if fb.feature_type == "categorical" and fb.categorical
                    else {}
                ),
            }
            for fname, fb in bl.feature_baselines.items()
        },
    }


class BaselineRequest(BaseModel):
    sample_count: int = 500


@router.post("/drift/{trainer_name}/baseline", dependencies=[_engineer])
async def set_baseline(trainer_name: str, body: BaselineRequest = BaselineRequest()):
    """
    (Re)build the drift baseline from the most recent `sample_count` inference logs.
    Replaces any existing baseline for this trainer.
    """
    from app.services.drift_service import set_baseline
    try:
        bl = await set_baseline(trainer_name, sample_count=body.sample_count)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "trainer_name": bl.trainer_name,
        "sample_count": bl.sample_count,
        "features": list(bl.feature_baselines.keys()),
        "created_at": bl.created_at.isoformat(),
    }


class DriftCheckRequest(BaseModel):
    sample_count: int = 200
    hours: int = 6


@router.post("/drift/{trainer_name}/check", dependencies=[_engineer])
async def run_drift_check(trainer_name: str, body: DriftCheckRequest = DriftCheckRequest()):
    """
    Run a drift check against the stored baseline.
    Returns newly raised alerts (may be empty if no drift detected).
    SSE event `drift_alert` is published for each alert raised.
    """
    from app.services.drift_service import check_drift
    alerts = await check_drift(
        trainer_name,
        sample_count=body.sample_count,
        hours=body.hours,
    )
    return {
        "trainer_name": trainer_name,
        "alerts_raised": len(alerts),
        "alerts": [
            {
                "id": str(a.id),
                "feature_name": a.feature_name,
                "drift_method": a.drift_method,
                "drift_score": a.drift_score,
                "threshold": a.threshold,
                "sample_count": a.sample_count,
                "details": a.details,
                "detected_at": a.detected_at.isoformat(),
            }
            for a in alerts
        ],
    }


@router.get("/drift/{trainer_name}/alerts")
async def get_drift_alerts(
    trainer_name: str,
    status: Optional[str] = Query(None, description="Filter: open | acknowledged | resolved"),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    """List drift alerts for a trainer, newest first."""
    from app.services.drift_service import get_drift_alerts
    alerts = await get_drift_alerts(trainer_name, status=status, limit=limit, org_id=user.org_id)
    return {
        "trainer_name": trainer_name,
        "alerts": [
            {
                "id": str(a.id),
                "feature_name": a.feature_name,
                "drift_method": a.drift_method,
                "drift_score": a.drift_score,
                "threshold": a.threshold,
                "sample_count": a.sample_count,
                "baseline_count": a.baseline_count,
                "status": a.status,
                "details": a.details,
                "detected_at": a.detected_at.isoformat(),
                "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
                "notes": a.notes,
            }
            for a in alerts
        ],
    }


class AlertUpdateRequest(BaseModel):
    status: str                          # acknowledged | resolved
    notes: str = ""


@router.patch("/drift/alerts/{alert_id}", dependencies=[_engineer])
async def update_alert(alert_id: str, body: AlertUpdateRequest):
    """Acknowledge or resolve a drift alert."""
    if body.status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be 'acknowledged' or 'resolved'")
    from app.services.drift_service import update_alert_status
    try:
        alert = await update_alert_status(alert_id, body.status, body.notes)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {
        "id": str(alert.id),
        "trainer_name": alert.trainer_name,
        "feature_name": alert.feature_name,
        "status": alert.status,
        "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
        "notes": alert.notes,
    }
