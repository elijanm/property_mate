"""Alert rule evaluation and notification dispatcher."""
import httpx
import structlog
from datetime import timedelta
from typing import List

from app.models.alert_rule import AlertRule, AlertFire
from app.models.performance_snapshot import PerformanceSnapshot
from app.models.drift_alert import DriftAlert
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_OPS = {
    "gt":  lambda v, t: v > t,
    "lt":  lambda v, t: v < t,
    "gte": lambda v, t: v >= t,
    "lte": lambda v, t: v <= t,
}


async def evaluate_all_rules() -> None:
    rules = await AlertRule.find({"enabled": True}).to_list()
    for rule in rules:
        try:
            await _evaluate_rule(rule)
        except Exception as e:
            logger.error("alert_rule_eval_failed", rule=rule.name, error=str(e))


async def _evaluate_rule(rule: AlertRule) -> None:
    op = _OPS.get(rule.operator)
    if not op:
        return

    # Check cooldown — skip if last fire within cooldown window
    cooldown_start = utc_now() - timedelta(minutes=rule.cooldown_minutes)
    recent_fire = await AlertFire.find_one({
        "rule_id": str(rule.id),
        "fired_at": {"$gte": cooldown_start},
    })
    if recent_fire:
        return

    window_start = utc_now() - timedelta(minutes=rule.window_minutes)
    trainers = [rule.trainer_name] if rule.trainer_name else await _get_all_trainers()

    for trainer in trainers:
        value = await _get_metric_value(rule.metric, trainer, window_start)
        if value is None:
            continue
        if op(value, rule.threshold):
            await _fire(rule, trainer, value)


async def _get_all_trainers() -> list:
    from app.models.model_deployment import ModelDeployment
    deps = await ModelDeployment.find({"is_default": True}).to_list()
    return list({d.trainer_name for d in deps})


async def _get_metric_value(metric: str, trainer: str, window_start) -> float | None:
    from app.models.inference_log import InferenceLog

    if metric == "error_rate":
        total = await InferenceLog.find({"trainer_name": trainer, "created_at": {"$gte": window_start}}).count()
        if total == 0:
            return None
        errors = await InferenceLog.find({"trainer_name": trainer, "created_at": {"$gte": window_start}, "error": {"$ne": None}}).count()
        return errors / total

    if metric == "latency_p99":
        logs = await InferenceLog.find({"trainer_name": trainer, "created_at": {"$gte": window_start}}).to_list()
        if not logs:
            return None
        latencies = sorted(l.latency_ms for l in logs if l.latency_ms)
        idx = max(0, int(len(latencies) * 0.99) - 1)
        return latencies[idx] if latencies else None

    if metric == "drift_score":
        alert = await DriftAlert.find_one({"trainer_name": trainer, "status": "open"})
        return alert.drift_score if alert else None

    if metric == "request_volume":
        count = await InferenceLog.find({"trainer_name": trainer, "created_at": {"$gte": window_start}}).count()
        return float(count)

    return None


async def _fire(rule: AlertRule, trainer: str, value: float) -> None:
    msg = f"Alert '{rule.name}': {rule.metric} for {trainer} is {value:.4f} (threshold {rule.operator} {rule.threshold})"
    fire = AlertFire(
        rule_id=str(rule.id), rule_name=rule.name,
        trainer_name=trainer, metric=rule.metric,
        value=value, threshold=rule.threshold, message=msg,
    )
    await fire.insert()
    logger.warning("alert_fired", rule=rule.name, trainer=trainer, metric=rule.metric, value=value)

    for ch in rule.channels:
        if ch.type == "webhook" and ch.url:
            await _send_webhook(ch.url, {"rule": rule.name, "trainer": trainer, "metric": rule.metric, "value": value, "message": msg})
        fire.notified = True
    await fire.save()


async def _send_webhook(url: str, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(url, json=payload)
    except Exception as e:
        logger.error("webhook_send_failed", url=url, error=str(e))


async def list_fires(rule_id: str | None = None, limit: int = 100) -> list[AlertFire]:
    q = {}
    if rule_id:
        q["rule_id"] = rule_id
    return await AlertFire.find(q).sort("-fired_at").limit(limit).to_list()
