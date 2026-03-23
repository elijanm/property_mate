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

    # ── URL dataset refresh every 15 minutes ─────────────────────────────
    _scheduler.add_job(
        _run_url_dataset_refresh,
        CronTrigger(minute="*/15"),
        id="url_dataset_refresh",
        replace_existing=True,
    )

    # ── Wallet reservation reconciliation every 30 minutes ───────────────
    # Finds jobs stuck in queued/running for >2h with a wallet reservation
    # and releases the held funds back to the user's balance.
    _scheduler.add_job(
        _run_wallet_reconciliation,
        CronTrigger(minute="*/30"),
        id="wallet_reconciliation",
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


async def run_wallet_reconciliation(cutoff_hours: int = 2) -> dict:
    """
    Release wallet reservations for any job that has an open reserve transaction
    but no corresponding release transaction.  Returns a result dict so it can
    be called directly from an admin endpoint as well as from the scheduler.

    Covers two cases:
    1. Stale queued/running jobs (server crash, timeout) — mark them failed.
    2. Already-failed/completed jobs whose failure path skipped the release.

    cutoff_hours=0 bypasses the age filter (admin force-clear).
    """
    from datetime import datetime, timezone, timedelta
    from app.models.training_job import TrainingJob
    from app.models.wallet import WalletTransaction
    from app.services import wallet_service

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=cutoff_hours) if cutoff_hours > 0 else now + timedelta(seconds=1)

    # Case 1: stale active jobs
    stale_filter: dict = {"status": {"$in": ["queued", "running"]}}
    if cutoff_hours > 0:
        stale_filter["created_at"] = {"$lt": cutoff}
    stale_jobs = await TrainingJob.find(stale_filter).to_list()

    # Case 2: already-terminal jobs with wallet_reserved > 0 and no release tx
    orphaned_filter: dict = {"status": {"$in": ["failed", "completed"]}, "wallet_reserved": {"$gt": 0}}
    if cutoff_hours > 0:
        orphaned_filter["created_at"] = {"$lt": cutoff}
    orphaned_jobs = await TrainingJob.find(orphaned_filter).to_list()

    released = 0
    skipped = 0
    errors = 0
    items: list[dict] = []

    for job in stale_jobs + orphaned_jobs:
        if not job.owner_email:
            skipped += 1
            continue
        reserve_tx = await WalletTransaction.find_one(
            WalletTransaction.job_id == str(job.id),
            WalletTransaction.type == "reserve",
            WalletTransaction.user_email == job.owner_email,
        )
        if not reserve_tx:
            skipped += 1
            continue
        already_released = await WalletTransaction.find_one(
            WalletTransaction.job_id == str(job.id),
            WalletTransaction.type == "release",
            WalletTransaction.user_email == job.owner_email,
        )
        if already_released:
            skipped += 1
            continue

        try:
            w = await wallet_service.get_or_create(job.owner_email, job.org_id)
            await wallet_service.release_and_charge(w, str(job.id), actual_cost=0.0)
            if job.status in ("queued", "running"):
                await job.set({
                    "status": "failed",
                    "error": "Job timed out — reservation auto-released",
                    "finished_at": now,
                    "updated_at": now,
                })
            released += 1
            items.append({
                "job_id": str(job.id),
                "user_email": job.owner_email,
                "reserved_amount": reserve_tx.amount,
                "previous_status": job.status,
            })
            logger.info(
                "wallet_reconciliation_released",
                job_id=str(job.id),
                owner=job.owner_email,
                reserved=reserve_tx.amount,
            )
        except Exception as exc:
            errors += 1
            logger.warning("wallet_reconciliation_release_failed", job_id=str(job.id), error=str(exc))

    if released:
        logger.info("wallet_reconciliation_complete", released=released, errors=errors)

    return {"released": released, "skipped": skipped, "errors": errors, "items": items}


async def _run_wallet_reconciliation() -> None:
    """Scheduled wrapper — calls the public function and discards the result."""
    try:
        await run_wallet_reconciliation(cutoff_hours=2)
    except Exception as exc:
        logger.error("wallet_reconciliation_failed", error=str(exc))


async def _run_url_dataset_refresh() -> None:
    try:
        from app.services.url_dataset_service import refresh_due
        await refresh_due()
    except Exception as exc:
        logger.error("url_dataset_refresh_failed", error=str(exc))


async def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
