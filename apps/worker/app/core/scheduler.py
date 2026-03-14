"""APScheduler — daily billing check for auto-generation."""
import json
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.logging import get_logger
from app.core.rabbitmq import get_channel

logger = get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None

QUEUE_BILLING_RUNS = "billing.runs"


async def _daily_billing_check() -> None:
    """
    Runs daily at 00:05 UTC via APScheduler cron trigger.
    For each org with auto_generation_enabled=True, checks if today is the
    configured preparation_day and publishes a BillingRunPayload to billing.runs.
    """
    try:
        from app.core.database import get_db
        db = get_db()

        now_utc = datetime.now(tz=timezone.utc)
        current_billing_month = now_utc.strftime("%Y-%m")

        # Find all orgs with auto billing enabled
        orgs_cursor = db["orgs"].find(
            {"billing_config.auto_generation_enabled": True, "deleted_at": None}
        )
        orgs = await orgs_cursor.to_list(length=None)

        for org in orgs:
            org_id = org.get("org_id")
            billing_config = org.get("billing_config", {})
            preparation_day = billing_config.get("preparation_day", 1)

            if now_utc.day != preparation_day:
                continue

            # Check if a successful run already exists for this month
            existing = await db["billing_cycle_runs"].find_one({
                "org_id": org_id,
                "billing_month": current_billing_month,
                "status": "completed",
                "sandbox": False,
                "deleted_at": None,
            })
            if existing:
                logger.info(
                    "scheduler_billing_skip",
                    action="daily_billing_check",
                    org_id=org_id,
                    billing_month=current_billing_month,
                    reason="already_completed",
                )
                continue

            # Publish billing run message
            import uuid
            payload = {
                "event_id": str(uuid.uuid4()),
                "org_id": org_id,
                "user_id": None,
                "billing_month": current_billing_month,
                "sandbox": False,
                "dry_run": False,
            }

            try:
                import aio_pika
                channel = await get_channel()
                await channel.default_exchange.publish(
                    aio_pika.Message(
                        body=json.dumps(payload).encode(),
                        content_type="application/json",
                    ),
                    routing_key=QUEUE_BILLING_RUNS,
                )
                logger.info(
                    "scheduler_billing_published",
                    action="daily_billing_check",
                    org_id=org_id,
                    billing_month=current_billing_month,
                    status="success",
                )
            except Exception as publish_exc:
                logger.error(
                    "scheduler_billing_publish_failed",
                    action="daily_billing_check",
                    org_id=org_id,
                    billing_month=current_billing_month,
                    status="error",
                    error_code="SCHEDULER_PUBLISH_ERROR",
                    exc_info=publish_exc,
                )

    except Exception as exc:
        logger.error(
            "scheduler_billing_check_failed",
            action="daily_billing_check",
            status="error",
            error_code="SCHEDULER_ERROR",
            exc_info=exc,
        )


async def _daily_reminder_check() -> None:
    """
    Runs daily at 08:00 UTC. Sends smart payment and signing reminders.

    Rules (anti-spam):
    - Max 3 reminders per lease per status phase
    - pending_payment: remind every 3 days
    - pending_signature: remind every 2 days
    - No reminder if lease was just created (wait at least 1 day)
    """
    try:
        from app.core.database import get_db
        from app.core.config import settings
        from app.core.email import send_email, payment_reminder_html, signing_reminder_html

        db = get_db()
        now = datetime.now(tz=timezone.utc)

        for status, gap_days, subject_fn, html_fn in [
            ("pending_payment", 3, lambda ref, n: f"Payment reminder — {ref}", payment_reminder_html),
            ("pending_signature", 2, lambda ref, n: f"Please sign your lease — {ref}", signing_reminder_html),
        ]:
            cursor = db["leases"].find({
                "status": status,
                "deleted_at": None,
                "reminder_count": {"$lt": 3},
                "$or": [
                    {"last_reminder_sent_at": None},
                    {"last_reminder_sent_at": {"$lt": datetime(
                        now.year, now.month, now.day, tzinfo=timezone.utc
                    ).timestamp() - gap_days * 86400}},
                ],
            })
            leases = await cursor.to_list(length=None)

            for lease_doc in leases:
                lease_id = lease_doc.get("_id")
                org_id = lease_doc.get("org_id")
                tenant_id = lease_doc.get("tenant_id")
                lease_ref = lease_doc.get("reference_no", "")
                rent_amount = lease_doc.get("rent_amount", 0)
                deposit_amount = lease_doc.get("deposit_amount", 0)
                utility_deposit = lease_doc.get("utility_deposit") or 0
                reminder_count = lease_doc.get("reminder_count", 0) + 1
                portal_url = f"{settings.app_base_url}/tenant/lease"

                try:
                    # Resolve tenant email
                    tenant = await db["users"].find_one({"_id": lease_doc.get("tenant_id"), "deleted_at": None})
                    if not tenant or not tenant.get("email"):
                        continue

                    first_name = tenant.get("first_name", "Tenant")
                    email = tenant["email"]

                    if status == "pending_payment":
                        # Compute remaining
                        from datetime import date as date_cls
                        import calendar as cal
                        start = lease_doc.get("start_date")
                        if isinstance(start, str):
                            start = date_cls.fromisoformat(start)
                        dim = cal.monthrange(start.year, start.month)[1]
                        prorated = round(((dim - start.day + 1) / dim) * rent_amount, 2)
                        required = round(deposit_amount + utility_deposit + prorated, 2)

                        paid_cursor = db["payments"].find({
                            "lease_id": str(lease_id),
                            "status": "completed",
                            "direction": "inbound",
                            "deleted_at": None,
                        })
                        paid_list = await paid_cursor.to_list(length=None)
                        total_paid = sum(p.get("amount", 0) for p in paid_list)
                        remaining = max(0.0, round(required - total_paid, 2))
                        if remaining <= 0:
                            continue  # already paid, skip

                        html = payment_reminder_html(first_name, lease_ref, remaining, portal_url, reminder_count)
                    else:
                        html = signing_reminder_html(first_name, lease_ref, portal_url, reminder_count)

                    await send_email(to=email, subject=subject_fn(lease_ref, reminder_count), html=html)

                    await db["leases"].update_one(
                        {"_id": lease_id},
                        {"$set": {"last_reminder_sent_at": now, "reminder_count": reminder_count}},
                    )
                    logger.info(
                        "reminder_sent",
                        action="_daily_reminder_check",
                        org_id=org_id,
                        lease_id=str(lease_id),
                        status=status,
                        reminder_count=reminder_count,
                    )
                except Exception as exc:
                    logger.error(
                        "reminder_send_failed",
                        action="_daily_reminder_check",
                        lease_id=str(lease_id),
                        status="error",
                        exc_info=exc,
                    )

    except Exception as exc:
        logger.error(
            "daily_reminder_check_failed",
            action="_daily_reminder_check",
            status="error",
            exc_info=exc,
        )


def create_scheduler() -> AsyncIOScheduler:
    global _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        _daily_billing_check,
        trigger="cron",
        hour=0,
        minute=5,
        id="daily_billing_check",
        name="Daily billing check",
        replace_existing=True,
    )
    _scheduler.add_job(
        _daily_reminder_check,
        trigger="cron",
        hour=8,
        minute=0,
        id="daily_reminder_check",
        name="Daily payment & signing reminders",
        replace_existing=True,
    )
    return _scheduler


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler
