"""APScheduler integration for scheduled training jobs + monitoring tasks."""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import structlog

from app.services.registry_service import list_trainer_classes

logger = structlog.get_logger(__name__)
_scheduler = AsyncIOScheduler()


async def start_scheduler() -> None:
    """Load scheduled trainers and start the scheduler."""
    for name, cls in list_trainer_classes().items():
        schedule = getattr(cls, "schedule", None)
        if schedule:
            _add_job(name, schedule)

    # ── Monitoring: hourly performance snapshots ──────────────────────────
    _scheduler.add_job(
        _run_performance_snapshots,
        CronTrigger(minute=0),           # top of every hour
        id="monitoring_performance_hourly",
        replace_existing=True,
    )

    # ── Monitoring: drift checks every 6 hours ────────────────────────────
    _scheduler.add_job(
        _run_drift_checks,
        CronTrigger(hour="*/6", minute=5),  # :05 past every 6th hour
        id="monitoring_drift_check",
        replace_existing=True,
    )

    # ── Alert rule evaluation every 5 minutes ────────────────────────────
    _scheduler.add_job(
        _run_alert_evaluation,
        CronTrigger(minute="*/5"),   # every 5 minutes
        id="alert_evaluation",
        replace_existing=True,
    )

    _scheduler.start()
    logger.info("ml_scheduler_started", jobs=len(_scheduler.get_jobs()))


def _add_job(trainer_name: str, cron_expr: str) -> None:
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        logger.warning("invalid_cron_expression", trainer=trainer_name, cron=cron_expr)
        return
    minute, hour, day, month, day_of_week = parts
    _scheduler.add_job(
        _trigger_training,
        CronTrigger(
            minute=minute, hour=hour, day=day,
            month=month, day_of_week=day_of_week,
        ),
        args=[trainer_name],
        id=f"train_{trainer_name}",
        replace_existing=True,
    )
    logger.info("training_scheduled", trainer=trainer_name, cron=cron_expr)


async def _trigger_training(trainer_name: str) -> None:
    from app.tasks.train_task import enqueue_training
    logger.info("scheduled_training_triggered", trainer=trainer_name)
    await enqueue_training(trainer_name, trigger="scheduled")


async def _run_performance_snapshots() -> None:
    try:
        from app.services.performance_service import compute_all_hourly_snapshots
        await compute_all_hourly_snapshots()
    except Exception as exc:
        logger.error("scheduled_performance_snapshots_failed", error=str(exc))


async def _run_drift_checks() -> None:
    try:
        from app.services.drift_service import run_all_drift_checks
        await run_all_drift_checks()
    except Exception as exc:
        logger.error("scheduled_drift_checks_failed", error=str(exc))


async def _run_alert_evaluation() -> None:
    try:
        from app.services.alert_service import evaluate_all_rules
        await evaluate_all_rules()
    except Exception as e:
        logger.error("alert_evaluation_failed", error=str(e))


async def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
