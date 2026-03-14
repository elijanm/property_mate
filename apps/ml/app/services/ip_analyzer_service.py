"""IP threat analyzer — heuristic + ML-based detection of malicious IPs.

Decision pipeline
─────────────────
1. Instant ban lookup   — already banned → block immediately
2. Heuristic rules      — rate, error rate, suspicious paths, user-agent
3. ML score             — if a trained model exists use it; otherwise rule score
4. Write-back           — update IPRecord.threat_score and ban if threshold exceeded
"""
import re
import math
import asyncio
import structlog
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from app.models.ip_record import IPRecord, RequestSample
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

# ── Thresholds ────────────────────────────────────────────────────────────────

BAN_THRESHOLD = 0.90          # threat_score ≥ this → auto-ban (raised from 0.85)
REVIEW_THRESHOLD = 0.65       # log a warning but don't ban yet

# Max requests in rolling windows (per IP)
RATE_LIMIT_1MIN = 300         # requests per minute (raised — devs hit APIs fast)
RATE_LIMIT_10MIN = 1500

# IPs that are NEVER scored or banned regardless of activity
# Covers: loopback, Docker bridge (172.16-31.x), private LANs, Docker internal DNS
_WHITELIST_NETWORKS = (
    "127.",        # loopback IPv4
    "::1",         # loopback IPv6
    "10.",         # RFC-1918 class A
    "192.168.",    # RFC-1918 class C
    "172.16.", "172.17.", "172.18.", "172.19.",   # RFC-1918 class B + Docker default
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
    "fd",          # ULA IPv6
)

def _is_whitelisted(ip: str) -> bool:
    if any(ip.startswith(prefix) for prefix in _WHITELIST_NETWORKS):
        return True
    # Support comma-separated custom whitelist via env var
    import os
    extra = os.environ.get("SECURITY_WHITELIST_IPS", "")
    if extra:
        for entry in extra.split(","):
            if ip.startswith(entry.strip()):
                return True
    return False

# Paths that legitimate ML studio users should never hit
SUSPICIOUS_PATHS = re.compile(
    r"(/etc/|/proc/|/sys/|\.\.\/|/admin|/shell|/exec|/cmd|"
    r"/phpmyadmin|/wp-admin|\.env|/config\.php|/debug|"
    r"/actuator|/metrics/internal|/__debug__)",
    re.IGNORECASE,
)

SUSPICIOUS_UA = re.compile(
    r"(sqlmap|nikto|masscan|zgrab|nmap|hydra|burpsuite|"
    r"dirbuster|gobuster|wfuzz|havij|acunetix|nessus|"
    r"python-requests/2\.[01]|Go-http-client/1)",
    re.IGNORECASE,
)

# ── Public interface ──────────────────────────────────────────────────────────

async def check_ip(ip: str, path: str, user_agent: str = "") -> Tuple[bool, str]:
    """
    Returns (is_blocked, reason).
    Fast path: banned IPs are rejected in O(1) DB lookup.
    Private/loopback IPs are always allowed (never scored or banned).
    """
    if _is_whitelisted(ip):
        return False, ""

    record = await IPRecord.find_one({"ip": ip})
    if record and record.is_banned:
        # Check expiry
        if record.ban_expires_at and record.ban_expires_at < utc_now():
            await _lift_ban(record)
            return False, ""
        return True, record.ban_reason

    return False, ""


async def record_request(
    ip: str,
    path: str,
    method: str,
    status_code: int,
    latency_ms: float,
    user_agent: str,
    payload_size: int,
    is_upload: bool,
) -> None:
    """
    Upsert the IPRecord for this IP and re-score asynchronously.
    Designed to be called from the middleware without blocking the response.
    Private/loopback IPs are skipped entirely — no tracking, no scoring.
    """
    if _is_whitelisted(ip):
        return

    now = utc_now()
    sample = RequestSample(
        timestamp=now,
        method=method,
        path=path,
        status_code=status_code,
        user_agent=user_agent,
        payload_size=payload_size,
        latency_ms=latency_ms,
    )

    record = await IPRecord.find_one({"ip": ip})
    if record is None:
        record = IPRecord(ip=ip, first_seen=now)

    record.last_seen = now
    record.total_requests += 1
    if is_upload:
        record.upload_attempts += 1
    if status_code >= 400:
        record.error_count += 1

    # Rolling sample buffer (keep last 500)
    record.recent_requests.append(sample)
    if len(record.recent_requests) > 500:
        record.recent_requests = record.recent_requests[-500:]

    # Track unique paths (keep last 200 unique)
    if path not in record.unique_paths:
        record.unique_paths.append(path)
        if len(record.unique_paths) > 200:
            record.unique_paths = record.unique_paths[-200:]

    if SUSPICIOUS_PATHS.search(path):
        record.suspicious_path_hits += 1

    await record.save()

    # Re-score in background — don't await so middleware returns fast
    asyncio.create_task(_score_and_act(record))


async def ban_ip(ip: str, reason: str, expires_hours: Optional[int] = None) -> IPRecord:
    """Manually ban an IP address."""
    record = await IPRecord.find_one({"ip": ip})
    if record is None:
        record = IPRecord(ip=ip)

    record.is_banned = True
    record.banned_at = utc_now()
    record.ban_reason = reason
    record.threat_score = 1.0
    if expires_hours:
        record.ban_expires_at = utc_now() + timedelta(hours=expires_hours)
    await record.save()
    logger.warning("ip_banned", ip=ip, reason=reason, expires_hours=expires_hours)
    return record


async def unban_ip(ip: str) -> Optional[IPRecord]:
    """Manually lift a ban."""
    record = await IPRecord.find_one({"ip": ip})
    if record:
        await _lift_ban(record)
    return record


# ── Scoring ───────────────────────────────────────────────────────────────────

async def _score_and_act(record: IPRecord) -> None:
    """Re-compute threat_score; auto-ban if above threshold."""
    try:
        score, reasons = _heuristic_score(record)

        # Try ML model if available
        ml_score = await _ml_score(record)
        if ml_score is not None:
            # Blend: 40% heuristic, 60% ML
            score = 0.4 * score + 0.6 * ml_score
            record.ml_score = ml_score

        record.threat_score = round(min(score, 1.0), 4)
        record.threat_reasons = reasons

        if record.threat_score >= BAN_THRESHOLD and not record.is_banned:
            record.is_banned = True
            record.banned_at = utc_now()
            record.ban_reason = f"Auto-banned: score={record.threat_score:.2f} — {'; '.join(reasons[:3])}"
            logger.warning(
                "ip_auto_banned",
                ip=record.ip,
                score=record.threat_score,
                reasons=reasons,
            )
        elif record.threat_score >= REVIEW_THRESHOLD:
            logger.info(
                "ip_suspicious",
                ip=record.ip,
                score=record.threat_score,
                reasons=reasons,
            )

        await record.save()
    except Exception as exc:
        logger.error("ip_score_error", ip=record.ip, error=str(exc))


def _heuristic_score(record: IPRecord) -> Tuple[float, list]:
    """Return (score 0-1, list of reason strings) from heuristic rules."""
    score = 0.0
    reasons = []
    now = utc_now()

    def _ts(t: datetime) -> datetime:
        """Ensure timestamp is UTC-aware (fix legacy naive records)."""
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)

    # ── Rate: requests in last 1 min ────────────────────────────────────────
    cutoff_1m = now - timedelta(minutes=1)
    rate_1m = sum(1 for r in record.recent_requests if _ts(r.timestamp) >= cutoff_1m)
    if rate_1m > RATE_LIMIT_1MIN:
        factor = min(rate_1m / RATE_LIMIT_1MIN, 3.0)
        score += 0.3 * (factor - 1) / 2
        reasons.append(f"High rate: {rate_1m} req/min")

    # ── Rate: requests in last 10 min ───────────────────────────────────────
    cutoff_10m = now - timedelta(minutes=10)
    rate_10m = sum(1 for r in record.recent_requests if _ts(r.timestamp) >= cutoff_10m)
    if rate_10m > RATE_LIMIT_10MIN:
        score += 0.15
        reasons.append(f"Sustained high rate: {rate_10m} req/10min")

    # ── Error rate ───────────────────────────────────────────────────────────
    if record.total_requests >= 10:
        error_rate = record.error_count / record.total_requests
        if error_rate > 0.6:
            score += 0.25
            reasons.append(f"High error rate: {error_rate:.0%}")
        elif error_rate > 0.4:
            score += 0.10

    # ── Suspicious paths ─────────────────────────────────────────────────────
    if record.suspicious_path_hits > 0:
        score += min(0.35 * math.log1p(record.suspicious_path_hits), 0.50)
        reasons.append(f"Suspicious paths: {record.suspicious_path_hits} hits")

    # ── Suspicious user-agent ────────────────────────────────────────────────
    for sample in record.recent_requests[-50:]:
        if sample.user_agent and SUSPICIOUS_UA.search(sample.user_agent):
            score += 0.40
            reasons.append(f"Suspicious UA: {sample.user_agent[:60]}")
            break

    # ── Massive payload attempts ─────────────────────────────────────────────
    huge_payloads = sum(
        1 for r in record.recent_requests if r.payload_size > 50 * 1024 * 1024
    )  # > 50 MB
    if huge_payloads > 5:
        score += 0.15
        reasons.append(f"Repeated huge uploads: {huge_payloads}")

    # ── Blocked upload ratio ─────────────────────────────────────────────────
    if record.upload_attempts > 3 and record.blocked_uploads > 0:
        blocked_ratio = record.blocked_uploads / record.upload_attempts
        if blocked_ratio > 0.5:
            score += 0.20
            reasons.append(f"Many blocked uploads: {record.blocked_uploads}/{record.upload_attempts}")

    return min(score, 1.0), reasons


async def _ml_score(record: IPRecord) -> Optional[float]:
    """Query the trained IP threat model if deployed."""
    try:
        from app.services.inference_service import run_inference
        from app.models.model_deployment import ModelDeployment

        deployment = await ModelDeployment.find_one(
            {"trainer_name": "ip_threat_detector", "is_default": True, "status": "active"}
        )
        if deployment is None:
            return None

        # Build feature vector
        now = utc_now()
        cutoff_1m  = now - timedelta(minutes=1)
        cutoff_10m = now - timedelta(minutes=10)
        cutoff_1h  = now - timedelta(hours=1)

        def _ts(t: datetime) -> datetime:
            return t if t.tzinfo else t.replace(tzinfo=timezone.utc)

        rate_1m  = sum(1 for r in record.recent_requests if _ts(r.timestamp) >= cutoff_1m)
        rate_10m = sum(1 for r in record.recent_requests if _ts(r.timestamp) >= cutoff_10m)
        rate_1h  = sum(1 for r in record.recent_requests if _ts(r.timestamp) >= cutoff_1h)
        error_rate = record.error_count / max(record.total_requests, 1)
        susp_path_ratio = record.suspicious_path_hits / max(len(record.unique_paths), 1)
        blocked_ratio = record.blocked_uploads / max(record.upload_attempts, 1)

        inputs = {
            "rate_1m":          float(rate_1m),
            "rate_10m":         float(rate_10m),
            "rate_1h":          float(rate_1h),
            "error_rate":       float(error_rate),
            "susp_path_ratio":  float(susp_path_ratio),
            "blocked_ratio":    float(blocked_ratio),
            "upload_attempts":  float(record.upload_attempts),
            "unique_paths":     float(len(record.unique_paths)),
            "total_requests":   float(record.total_requests),
        }

        result = await run_inference("ip_threat_detector", inputs)
        return float(result.get("threat_probability", result.get("score", 0.0)))
    except Exception:
        return None


async def _lift_ban(record: IPRecord) -> None:
    record.is_banned = False
    record.ban_reason = ""
    record.ban_expires_at = None
    record.threat_score = max(record.threat_score - 0.3, 0.0)
    await record.save()
    logger.info("ip_unbanned", ip=record.ip)
