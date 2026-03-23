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
    Release every open wallet reservation that has no corresponding release
    transaction.  Uses WalletTransactions as the authoritative source — NOT
    TrainingJob.wallet_reserved (which is never zeroed after completion and
    therefore cannot be used to detect orphaned reserves).

    Algorithm:
      1. Find all "reserve" transactions (age-filtered if cutoff_hours > 0).
      2. For each, check if a matching "release" transaction exists by job_id.
      3. If not, call release_and_charge(actual_cost=0) to refund in full.
      4. If a stale queued/running TrainingJob matches, mark it failed.

    cutoff_hours=0  → release ALL open reserves regardless of age (force-clear).
    cutoff_hours=2  → only touch reserves created more than 2 hours ago (safe).
    """
    from datetime import datetime, timezone, timedelta
    from app.models.wallet import Wallet, WalletTransaction
    from app.models.training_job import TrainingJob
    from app.services import wallet_service

    now = datetime.now(timezone.utc)

    # Build age filter for reserve transactions
    reserve_filter: dict = {"type": "reserve"}
    if cutoff_hours > 0:
        cutoff = now - timedelta(hours=cutoff_hours)
        reserve_filter["created_at"] = {"$lt": cutoff}

    all_reserves = await WalletTransaction.find(reserve_filter).to_list()

    released = 0
    skipped = 0
    errors = 0
    items: list[dict] = []

    for reserve_tx in all_reserves:
        job_id = reserve_tx.job_id
        if not job_id:
            skipped += 1
            continue

        # Already released?
        already = await WalletTransaction.find_one(
            {"job_id": job_id, "type": "release", "user_email": reserve_tx.user_email}
        )
        if already:
            skipped += 1
            continue

        # Also skip if a debit already exists (job was charged — release may have been missed
        # but funds were already consumed, don't double-release)
        already_debited = await WalletTransaction.find_one(
            {"job_id": job_id, "type": "debit", "user_email": reserve_tx.user_email}
        )
        if already_debited:
            skipped += 1
            continue

        try:
            wallet = await Wallet.find_one(
                {"user_email": reserve_tx.user_email, "org_id": reserve_tx.org_id}
            )
            if not wallet:
                skipped += 1
                continue

            await wallet_service.release_and_charge(wallet, job_id, actual_cost=0.0)

            # If there's a matching stale job, mark it failed
            try:
                from bson import ObjectId as _ObjId
                job = await TrainingJob.find_one({"_id": _ObjId(job_id)})
            except Exception:
                job = None
            if job and job.status in ("queued", "running"):
                await job.set({
                    "status": "failed",
                    "error": "Reservation auto-released by admin reconciliation",
                    "finished_at": now,
                    "updated_at": now,
                })

            released += 1
            items.append({
                "job_id": job_id,
                "user_email": reserve_tx.user_email,
                "reserved_amount": reserve_tx.amount,
                "previous_status": job.status if job else "unknown",
            })
            logger.info(
                "wallet_reconciliation_released",
                job_id=job_id,
                user=reserve_tx.user_email,
                reserved=reserve_tx.amount,
            )
        except Exception as exc:
            errors += 1
            logger.warning("wallet_reconciliation_release_failed", job_id=job_id, error=str(exc))

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
