"""
Model performance monitoring service.

Aggregates InferenceLogs into PerformanceSnapshot documents on a schedule.
Provides summary APIs for the monitoring dashboard.
"""
from __future__ import annotations

import statistics
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import structlog

from app.models.inference_log import InferenceLog
from app.models.performance_snapshot import PerformanceSnapshot
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _percentile(sorted_vals: list, pct: float) -> float:
    """Return the pct-th percentile of a pre-sorted list (0–100 scale)."""
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * pct / 100
    f, c = int(k), int(k) + 1
    if c >= len(sorted_vals):
        return float(sorted_vals[-1])
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


async def compute_performance_snapshot(
    trainer_name: str,
    window_start: datetime,
    window_end: datetime,
    window_type: str = "hourly",
) -> PerformanceSnapshot:
    """
    Aggregate InferenceLogs in [window_start, window_end) into a PerformanceSnapshot.
    Upserts by (trainer_name, window_type, window_start).
    """
    logs = await InferenceLog.find(
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.created_at >= window_start,
        InferenceLog.created_at < window_end,
    ).to_list()

    total = len(logs)
    errors = [l for l in logs if l.error]
    error_count = len(errors)
    error_rate = error_count / total if total else 0.0

    latencies = sorted([l.latency_ms for l in logs if l.latency_ms is not None])
    latency_avg = statistics.mean(latencies) if latencies else 0.0
    latency_p50 = _percentile(latencies, 50)
    latency_p95 = _percentile(latencies, 95)
    latency_p99 = _percentile(latencies, 99)
    latency_max = latencies[-1] if latencies else 0.0

    # Top 5 error messages
    error_msgs = Counter(
        (e.error or "")[:200] for e in errors
    )
    top_errors = [
        {"msg": msg, "count": cnt}
        for msg, cnt in error_msgs.most_common(5)
    ]

    unique_orgs = len({l.caller_org_id for l in logs if l.caller_org_id})
    unique_sessions = len({l.session_id for l in logs if l.session_id})

    # Upsert — delete existing for this exact window then insert
    await PerformanceSnapshot.find(
        PerformanceSnapshot.trainer_name == trainer_name,
        PerformanceSnapshot.window_type == window_type,
        PerformanceSnapshot.window_start == window_start,
    ).delete()

    snap = PerformanceSnapshot(
        trainer_name=trainer_name,
        window_type=window_type,
        window_start=window_start,
        window_end=window_end,
        total_requests=total,
        error_count=error_count,
        error_rate=error_rate,
        latency_avg=round(latency_avg, 2),
        latency_p50=round(latency_p50, 2),
        latency_p95=round(latency_p95, 2),
        latency_p99=round(latency_p99, 2),
        latency_max=round(latency_max, 2),
        top_errors=top_errors,
        unique_orgs=unique_orgs,
        unique_sessions=unique_sessions,
    )
    await snap.insert()
    logger.info(
        "performance_snapshot_computed",
        trainer=trainer_name,
        window_type=window_type,
        window_start=window_start.isoformat(),
        total=total,
        error_rate=round(error_rate, 4),
    )
    return snap


async def compute_all_hourly_snapshots() -> None:
    """
    Called by the scheduler every hour.
    Computes a snapshot for each trainer that has logs in the last hour.
    """
    now = utc_now().replace(minute=0, second=0, microsecond=0)
    window_start = now - timedelta(hours=1)
    window_end = now

    # Find all trainer names with logs in the window
    pipeline = [
        {"$match": {
            "created_at": {"$gte": window_start, "$lt": window_end},
        }},
        {"$group": {"_id": "$trainer_name"}},
    ]
    results = await InferenceLog.get_motor_collection().aggregate(pipeline).to_list(length=None)
    trainer_names = [r["_id"] for r in results if r.get("_id")]

    for name in trainer_names:
        try:
            await compute_performance_snapshot(name, window_start, window_end, "hourly")
        except Exception as exc:
            logger.error("hourly_snapshot_failed", trainer=name, error=str(exc))


async def get_performance_snapshots(
    trainer_name: str,
    hours: int = 24,
    window_type: str = "hourly",
    org_id: str = "",
) -> List[PerformanceSnapshot]:
    """Return recent snapshots sorted oldest→newest.

    Snapshots are computed as cross-org aggregates so no org_id filter is applied here.
    The org_id parameter is kept for API compatibility but ignored.
    """
    since = utc_now() - timedelta(hours=hours)
    return await PerformanceSnapshot.find(
        PerformanceSnapshot.trainer_name == trainer_name,
        PerformanceSnapshot.window_type == window_type,
        PerformanceSnapshot.window_start >= since,
    ).sort(+PerformanceSnapshot.window_start).to_list()


async def get_rolling_summary(trainer_name: str, hours: int = 24, org_id: str = "") -> Dict[str, Any]:
    """
    Compute a rolling summary from InferenceLogs directly (no pre-aggregation).
    Shows all calls to the trainer regardless of caller org.
    The org_id parameter is kept for API compatibility but ignored.
    """
    since = utc_now() - timedelta(hours=hours)
    logs = await InferenceLog.find(
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.created_at >= since,
    ).to_list()

    total = len(logs)
    errors = [l for l in logs if l.error]
    latencies = sorted([l.latency_ms for l in logs if l.latency_ms is not None])

    return {
        "trainer_name": trainer_name,
        "window_hours": hours,
        "total_requests": total,
        "error_count": len(errors),
        "error_rate": round(len(errors) / total, 4) if total else 0.0,
        "latency_avg_ms": round(statistics.mean(latencies), 2) if latencies else 0.0,
        "latency_p95_ms": round(_percentile(latencies, 95), 2),
        "latency_p99_ms": round(_percentile(latencies, 99), 2),
        "latency_max_ms": round(latencies[-1], 2) if latencies else 0.0,
        "unique_orgs": len({l.caller_org_id for l in logs if l.caller_org_id}),
    }


async def get_all_models_summary(org_id: str = "") -> List[Dict[str, Any]]:
    """
    Return a one-row summary for every trainer with logs in the last 24 hours.
    Used for the monitoring overview dashboard.
    """
    since = utc_now() - timedelta(hours=24)
    pipeline = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id": "$trainer_name",
            "total": {"$sum": 1},
            "errors": {"$sum": {"$cond": [{"$ifNull": ["$error", False]}, 1, 0]}},
            "avg_latency": {"$avg": "$latency_ms"},
            "max_latency": {"$max": "$latency_ms"},
        }},
        {"$sort": {"total": -1}},
    ]
    results = await InferenceLog.get_motor_collection().aggregate(pipeline).to_list(length=None)
    return [
        {
            "trainer_name": r["_id"],
            "total_requests": r["total"],
            "error_count": r["errors"],
            "error_rate": round(r["errors"] / r["total"], 4) if r["total"] else 0.0,
            "avg_latency_ms": round(r.get("avg_latency") or 0, 2),
            "max_latency_ms": round(r.get("max_latency") or 0, 2),
        }
        for r in results
        if r.get("_id")
    ]
