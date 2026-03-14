"""
Data drift detection service.

Compares current inference input distributions to a stored baseline.
Uses KS test (numeric) and PSI (categorical) when scipy is available,
falling back to Z-score comparison otherwise.

Drift alert lifecycle: open → acknowledged → resolved.
Notifications are published via Redis pub/sub (SSE channel).
"""
from __future__ import annotations

import math
import statistics
from collections import Counter
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

import structlog

from app.models.drift_alert import DriftAlert
from app.models.drift_baseline import (
    CategoricalStats,
    DriftBaseline,
    FeatureBaseline,
    NumericStats,
)
from app.models.inference_log import InferenceLog
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

# ── Thresholds ────────────────────────────────────────────────────────────────
_KS_THRESHOLD   = 0.2    # KS statistic D ≥ 0.2 → drift (0 = identical, 1 = max drift)
_PSI_THRESHOLD  = 0.2    # PSI ≥ 0.2 → significant shift (0.1–0.2 = moderate)
_ZSCORE_THRESHOLD = 2.5  # |Z| ≥ 2.5 for mean shift fallback
_MIN_SAMPLES    = 30     # skip feature if fewer samples than this


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_scalar_features(inputs: Any) -> Dict[str, Any]:
    """
    Flatten an inference input dict into scalar feature values.
    Skips binary/base64 fields and nested objects.
    """
    if not isinstance(inputs, dict):
        return {}
    result: Dict[str, Any] = {}
    for k, v in inputs.items():
        if k.endswith("_b64") or k.endswith("_key") or k == "file_b64":
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            result[k] = float(v)
        elif isinstance(v, str) and len(v) <= 256:
            result[k] = v
        elif isinstance(v, bool):
            result[k] = int(v)
    return result


def _build_numeric_stats(values: List[float]) -> NumericStats:
    n = len(values)
    if n == 0:
        return NumericStats()
    mean = statistics.mean(values)
    std = statistics.pstdev(values) if n > 1 else 0.0
    mn, mx = min(values), max(values)

    # 20-bucket histogram
    buckets = 20
    if mn == mx:
        histogram = [[mn, n]]
    else:
        step = (mx - mn) / buckets
        counts = [0] * buckets
        for v in values:
            idx = min(int((v - mn) / step), buckets - 1)
            counts[idx] += 1
        histogram = [[round(mn + i * step, 6), counts[i]] for i in range(buckets)]

    return NumericStats(count=n, mean=mean, std=std, min=mn, max=mx, histogram=histogram)


def _build_categorical_stats(values: List[str]) -> CategoricalStats:
    n = len(values)
    if n == 0:
        return CategoricalStats()
    c = Counter(values)
    freqs = {k: v / n for k, v in c.items()}
    return CategoricalStats(count=n, value_freqs=freqs)


# ── KS test (numeric) ─────────────────────────────────────────────────────────

def _ks_statistic(baseline: NumericStats, current: List[float]) -> float:
    """
    Approximate two-sample KS statistic without scipy.
    Uses the histogram of the baseline as the reference CDF.
    """
    if not current or not baseline.histogram:
        return 0.0
    # Reconstruct approximate CDF from baseline histogram
    edges = [row[0] for row in baseline.histogram]
    counts = [row[1] for row in baseline.histogram]
    total_baseline = sum(counts)
    if total_baseline == 0:
        return 0.0

    def baseline_cdf(x: float) -> float:
        cum = 0
        for edge, cnt in zip(edges, counts):
            if x < edge:
                break
            cum += cnt
        return cum / total_baseline

    # Current CDF at each point
    n = len(current)
    sorted_cur = sorted(current)
    max_d = 0.0
    for i, x in enumerate(sorted_cur):
        cur_cdf = (i + 1) / n
        ref_cdf = baseline_cdf(x)
        max_d = max(max_d, abs(cur_cdf - ref_cdf))
    return max_d


def _try_scipy_ks(baseline: NumericStats, current: List[float]) -> Tuple[float, float]:
    """Returns (ks_statistic, p_value). Falls back to (_ks_statistic, -1) on import error."""
    try:
        from scipy import stats
        # Reconstruct approximate baseline sample from histogram
        baseline_samples: List[float] = []
        for row in baseline.histogram:
            edge, cnt = row[0], int(row[1])
            baseline_samples.extend([edge] * cnt)
        if not baseline_samples:
            raise ValueError("empty baseline histogram")
        stat, pval = stats.ks_2samp(baseline_samples, current)
        return float(stat), float(pval)
    except Exception:
        return _ks_statistic(baseline, current), -1.0


# ── PSI (categorical) ─────────────────────────────────────────────────────────

def _psi(baseline_freqs: Dict[str, float], current_values: List[str]) -> float:
    """
    Population Stability Index for a categorical feature.
    PSI = Σ (actual% - expected%) × ln(actual% / expected%)
    """
    if not current_values:
        return 0.0
    n = len(current_values)
    cur_counts = Counter(current_values)
    cur_freqs = {k: v / n for k, v in cur_counts.items()}

    all_cats = set(baseline_freqs) | set(cur_freqs)
    psi = 0.0
    for cat in all_cats:
        exp = baseline_freqs.get(cat, 1e-4)   # Laplace smoothing
        act = cur_freqs.get(cat, 1e-4)
        if exp <= 0 or act <= 0:
            continue
        psi += (act - exp) * math.log(act / exp)
    return psi


# ── Z-score fallback (numeric mean shift) ─────────────────────────────────────

def _z_score_drift(baseline: NumericStats, current: List[float]) -> float:
    """|Z| of the current mean relative to baseline distribution."""
    if not current or baseline.std == 0:
        return 0.0
    cur_mean = statistics.mean(current)
    return abs(cur_mean - baseline.mean) / (baseline.std or 1e-9)


# ── Public API ────────────────────────────────────────────────────────────────

async def set_baseline(trainer_name: str, sample_count: int = 500) -> DriftBaseline:
    """
    Build a drift baseline from the most recent `sample_count` inference logs.
    Overwrites any existing baseline for this trainer.
    """
    logs = await InferenceLog.find(
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.error == None,  # noqa: E711
    ).sort(-InferenceLog.created_at).limit(sample_count).to_list()

    if not logs:
        raise ValueError(f"No successful inference logs found for '{trainer_name}'")

    # Accumulate per-feature values
    numeric_vals: Dict[str, List[float]] = {}
    cat_vals: Dict[str, List[str]] = {}

    for log in logs:
        feats = _extract_scalar_features(log.inputs)
        for fname, fval in feats.items():
            if isinstance(fval, float):
                numeric_vals.setdefault(fname, []).append(fval)
            elif isinstance(fval, str):
                cat_vals.setdefault(fname, []).append(fval)

    feature_baselines: Dict[str, FeatureBaseline] = {}

    for fname, vals in numeric_vals.items():
        if len(vals) < _MIN_SAMPLES:
            continue
        feature_baselines[fname] = FeatureBaseline(
            feature_type="numeric",
            numeric=_build_numeric_stats(vals),
        )

    for fname, vals in cat_vals.items():
        if len(vals) < _MIN_SAMPLES:
            continue
        feature_baselines[fname] = FeatureBaseline(
            feature_type="categorical",
            categorical=_build_categorical_stats(vals),
        )

    # Upsert
    existing = await DriftBaseline.find_one(DriftBaseline.trainer_name == trainer_name)
    if existing:
        await existing.delete()

    baseline = DriftBaseline(
        trainer_name=trainer_name,
        sample_count=len(logs),
        feature_baselines=feature_baselines,
    )
    await baseline.insert()
    logger.info(
        "drift_baseline_set",
        trainer=trainer_name,
        sample_count=len(logs),
        features=list(feature_baselines.keys()),
    )
    return baseline


async def check_drift(
    trainer_name: str,
    sample_count: int = 200,
    hours: int = 6,
) -> List[DriftAlert]:
    """
    Compare the most recent `sample_count` (or last `hours`) inference inputs
    against the stored baseline. Returns list of newly created DriftAlert docs.
    """
    baseline = await DriftBaseline.find_one(DriftBaseline.trainer_name == trainer_name)
    if not baseline or not baseline.feature_baselines:
        logger.info("drift_check_skipped_no_baseline", trainer=trainer_name)
        return []

    since = utc_now() - timedelta(hours=hours)
    logs = await InferenceLog.find(
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.error == None,  # noqa: E711
        InferenceLog.created_at >= since,
    ).sort(-InferenceLog.created_at).limit(sample_count).to_list()

    if len(logs) < _MIN_SAMPLES:
        logger.info("drift_check_skipped_too_few_samples", trainer=trainer_name, count=len(logs))
        return []

    # Accumulate current window values
    numeric_vals: Dict[str, List[float]] = {}
    cat_vals: Dict[str, List[str]] = {}

    for log in logs:
        feats = _extract_scalar_features(log.inputs)
        for fname, fval in feats.items():
            if isinstance(fval, float):
                numeric_vals.setdefault(fname, []).append(fval)
            elif isinstance(fval, str):
                cat_vals.setdefault(fname, []).append(fval)

    new_alerts: List[DriftAlert] = []

    for fname, feat_bl in baseline.feature_baselines.items():

        if feat_bl.feature_type == "numeric" and feat_bl.numeric and fname in numeric_vals:
            cur = numeric_vals[fname]
            if len(cur) < _MIN_SAMPLES:
                continue

            ks_stat, p_value = _try_scipy_ks(feat_bl.numeric, cur)
            z_score = _z_score_drift(feat_bl.numeric, cur)

            # Primary: KS test
            if ks_stat >= _KS_THRESHOLD:
                method = "ks_test"
                score = ks_stat
                threshold = _KS_THRESHOLD
                details: Dict[str, Any] = {
                    "ks_statistic": round(ks_stat, 4),
                    "p_value": round(p_value, 4) if p_value >= 0 else "n/a (scipy unavailable)",
                    "z_score": round(z_score, 4),
                    "baseline_mean": round(feat_bl.numeric.mean, 4),
                    "baseline_std": round(feat_bl.numeric.std, 4),
                    "current_mean": round(statistics.mean(cur), 4),
                    "current_std": round(statistics.pstdev(cur), 4) if len(cur) > 1 else 0.0,
                }
            elif z_score >= _ZSCORE_THRESHOLD:
                method = "z_score"
                score = z_score
                threshold = _ZSCORE_THRESHOLD
                details = {
                    "z_score": round(z_score, 4),
                    "baseline_mean": round(feat_bl.numeric.mean, 4),
                    "baseline_std": round(feat_bl.numeric.std, 4),
                    "current_mean": round(statistics.mean(cur), 4),
                }
            else:
                continue

            alert = DriftAlert(
                trainer_name=trainer_name,
                feature_name=fname,
                drift_method=method,
                drift_score=round(score, 4),
                threshold=threshold,
                sample_count=len(cur),
                baseline_count=feat_bl.numeric.count,
                details=details,
            )
            await alert.insert()
            new_alerts.append(alert)

        elif feat_bl.feature_type == "categorical" and feat_bl.categorical and fname in cat_vals:
            cur = cat_vals[fname]
            if len(cur) < _MIN_SAMPLES:
                continue

            psi = _psi(feat_bl.categorical.value_freqs, cur)
            if psi < _PSI_THRESHOLD:
                continue

            cur_counts = Counter(cur)
            cur_freqs = {k: v / len(cur) for k, v in cur_counts.items()}

            alert = DriftAlert(
                trainer_name=trainer_name,
                feature_name=fname,
                drift_method="psi",
                drift_score=round(psi, 4),
                threshold=_PSI_THRESHOLD,
                sample_count=len(cur),
                baseline_count=feat_bl.categorical.count,
                details={
                    "psi": round(psi, 4),
                    "baseline_top": sorted(
                        feat_bl.categorical.value_freqs.items(),
                        key=lambda x: -x[1],
                    )[:5],
                    "current_top": sorted(
                        cur_freqs.items(),
                        key=lambda x: -x[1],
                    )[:5],
                },
            )
            await alert.insert()
            new_alerts.append(alert)

    if new_alerts:
        # Publish SSE notification for each alert
        try:
            from app.api.v1.sse import publish_event
            for a in new_alerts:
                await publish_event("drift_alert", {
                    "trainer_name": trainer_name,
                    "feature_name": a.feature_name,
                    "drift_method": a.drift_method,
                    "drift_score": a.drift_score,
                    "threshold": a.threshold,
                    "alert_id": str(a.id),
                    "detected_at": a.detected_at.isoformat(),
                })
        except Exception as exc:
            logger.warning("drift_sse_failed", error=str(exc))

        logger.warning(
            "drift_detected",
            trainer=trainer_name,
            features=[a.feature_name for a in new_alerts],
            alert_count=len(new_alerts),
        )
    else:
        logger.info("drift_check_clean", trainer=trainer_name, samples=len(logs))

    return new_alerts


async def run_all_drift_checks() -> None:
    """
    Called by the scheduler every 6 hours.
    Runs drift check for every trainer that has a baseline.
    """
    baselines = await DriftBaseline.find_all().to_list()
    for bl in baselines:
        try:
            await check_drift(bl.trainer_name)
        except Exception as exc:
            logger.error("scheduled_drift_check_failed", trainer=bl.trainer_name, error=str(exc))


async def get_drift_alerts(
    trainer_name: str,
    status: Optional[str] = None,
    limit: int = 50,
    org_id: str = "",
) -> List[DriftAlert]:
    filters = [DriftAlert.trainer_name == trainer_name, DriftAlert.org_id == org_id]
    if status:
        filters.append(DriftAlert.status == status)
    return await DriftAlert.find(*filters).sort(-DriftAlert.detected_at).limit(limit).to_list()


async def update_alert_status(alert_id: str, status: str, notes: str = "") -> DriftAlert:
    alert = await DriftAlert.get(alert_id)
    if not alert:
        raise ValueError(f"DriftAlert '{alert_id}' not found")
    now = utc_now()
    alert.status = status
    if notes:
        alert.notes = notes
    if status == "acknowledged":
        alert.acknowledged_at = now
    elif status == "resolved":
        alert.resolved_at = now
    await alert.save()
    return alert
