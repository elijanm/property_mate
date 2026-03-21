"""ML billing service — plan management, free-tier tracking, cost enforcement."""
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog

from app.models.ml_plan import MLPlan, MLPricingConfig, MLUserPlan
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


# ── Revenue recording ─────────────────────────────────────────────────────────

async def record_revenue(
    type: str,
    amount_usd: float,
    user_email: str,
    org_id: str,
    description: str,
    plan_id: Optional[str] = None,
    plan_name: Optional[str] = None,
    reference: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    """Append an entry to the revenue ledger."""
    from app.models.revenue_ledger import RevenueLedger
    entry = RevenueLedger(
        org_id=org_id,
        user_email=user_email,
        type=type,
        amount_usd=amount_usd,
        plan_id=plan_id,
        plan_name=plan_name,
        description=description,
        reference=reference,
        metadata=metadata or {},
    )
    await entry.insert()


# ── Proration ─────────────────────────────────────────────────────────────────

def calculate_proration(
    old_price: float,
    new_price: float,
) -> dict:
    """
    Calculate proration amounts for a mid-month plan change.
    Returns:
        days_remaining   – calendar days left in the current month
        days_in_month    – total days in current month
        proration_fraction – days_remaining / days_in_month
        credit_usd       – refund for unused days on old plan
        charge_usd       – charge for remaining days on new plan
        net_usd          – net charge (positive = user owes, negative = platform owes user)
    """
    now = utc_now().replace(tzinfo=None)   # work in naive UTC throughout
    if now.month == 12:
        next_month_start = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month_start = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days_in_month = (next_month_start - month_start).days
    days_remaining = (next_month_start - now).days + 1

    frac = days_remaining / days_in_month
    credit = round(old_price * frac, 2)
    charge = round(new_price * frac, 2)
    net = round(charge - credit, 2)
    return {
        "days_remaining": days_remaining,
        "days_in_month": days_in_month,
        "proration_fraction": round(frac, 4),
        "credit_usd": credit,
        "charge_usd": charge,
        "net_usd": net,
    }


# ── Pricing config ────────────────────────────────────────────────────────────

async def get_pricing_config() -> MLPricingConfig:
    """Load (or create) the singleton pricing config document."""
    cfg = await MLPricingConfig.find_one(MLPricingConfig.key == "global")
    if not cfg:
        cfg = MLPricingConfig()
        await cfg.insert()
    return cfg


async def update_pricing_config(**kwargs) -> MLPricingConfig:
    cfg = await get_pricing_config()
    allowed = {
        "local_cpu_price_per_hour", "local_cpu_free",
        "local_gpu_price_per_hour", "local_gpu_free",
        "inference_price_per_call", "inference_free",
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if updates:
        updates["updated_at"] = utc_now()
        await cfg.set(updates)
    return cfg


# ── Plans ─────────────────────────────────────────────────────────────────────

async def list_plans(include_inactive: bool = False) -> list[MLPlan]:
    if include_inactive:
        return await MLPlan.find_all().to_list()
    return await MLPlan.find(MLPlan.is_active == True).to_list()  # noqa: E712


async def get_default_plan() -> Optional[MLPlan]:
    return await MLPlan.find_one(MLPlan.is_default == True, MLPlan.is_active == True)  # noqa: E712


# ── Period helpers ────────────────────────────────────────────────────────────

def _next_reset(period: str) -> Optional[datetime]:
    """Return the next reset datetime for a given period string (UTC, naive)."""
    now = utc_now().replace(tzinfo=None)   # store naive, consistent with MongoDB

    if period == "day":
        tomorrow = now.date() + timedelta(days=1)
        return datetime(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0)

    if period == "week":
        days_ahead = 7 - now.weekday()   # days until next Monday
        next_monday = now.date() + timedelta(days=days_ahead)
        return datetime(next_monday.year, next_monday.month, next_monday.day, 0, 0, 0)

    if period == "month":
        if now.month == 12:
            return datetime(now.year + 1, 1, 1, 0, 0, 0)
        return datetime(now.year, now.month + 1, 1, 0, 0, 0)

    # "none" = lifetime quota — never resets
    return None


def _is_past(dt: Optional[datetime]) -> bool:
    if dt is None:
        return False
    now = utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return now >= dt


# ── User plan ─────────────────────────────────────────────────────────────────

async def get_user_plan(user_email: str, org_id: str) -> Optional[MLUserPlan]:
    return await MLUserPlan.find_one(
        MLUserPlan.user_email == user_email,
        MLUserPlan.org_id == org_id,
    )


async def get_or_create_user_plan(user_email: str, org_id: str) -> Optional[MLUserPlan]:
    """
    Return the user's plan record.  If none exists, auto-assign the default plan.
    Also handles new-customer credit on first assignment.
    """
    user_plan = await get_user_plan(user_email, org_id)
    if user_plan:
        return user_plan

    default_plan = await get_default_plan()
    if not default_plan:
        return None   # no plan system configured yet

    user_plan = await _assign_plan(user_email, org_id, default_plan)
    return user_plan


async def assign_plan_to_user(
    user_email: str,
    org_id: str,
    plan_id: str,
) -> MLUserPlan:
    """Admin-triggered plan assignment. Replaces any existing plan."""
    from beanie import PydanticObjectId
    plan = await MLPlan.get(PydanticObjectId(plan_id))
    if not plan or not plan.is_active:
        raise ValueError(f"Plan {plan_id!r} not found or inactive")
    return await _assign_plan(user_email, org_id, plan)


async def _assign_plan(user_email: str, org_id: str, plan: MLPlan) -> MLUserPlan:
    """Create (or replace) the user's plan record."""
    now = utc_now()

    user_plan = await MLUserPlan.find_one(
        MLUserPlan.user_email == user_email,
        MLUserPlan.org_id == org_id,
    )

    plan_id_str = str(plan.id)

    if user_plan:
        # Changing plans — reset period counters
        await user_plan.set({
            "plan_id": plan_id_str,
            "plan_name": plan.name,
            "free_training_used_seconds": 0.0,
            "free_training_period_reset_at": _next_reset(plan.free_training_period),
            "free_inference_used": 0,
            "free_inference_period_reset_at": _next_reset(plan.free_inference_period),
            "assigned_at": now,
            "updated_at": now,
        })
    else:
        user_plan = MLUserPlan(
            user_email=user_email,
            org_id=org_id,
            plan_id=plan_id_str,
            plan_name=plan.name,
            free_training_period_reset_at=_next_reset(plan.free_training_period),
            free_inference_period_reset_at=_next_reset(plan.free_inference_period),
        )
        await user_plan.insert()

    # New customer credit — given only once; earmarked for standard compute
    if plan.new_customer_credit_usd > 0 and not user_plan.new_customer_credit_given:
        try:
            from app.services import wallet_service
            wallet = await wallet_service.get_or_create(user_email, org_id)
            await wallet_service.credit(
                wallet,
                plan.new_customer_credit_usd,
                reference=f"plan:new_customer:{plan_id_str}:{user_email}",
                description=f"New customer credit — {plan.name} plan (standard compute)",
                is_standard=True,   # plan credits are for standard compute
            )
            await user_plan.set({
                "new_customer_credit_given": True,
                "new_customer_credit_amount": plan.new_customer_credit_usd,
                "updated_at": utc_now(),
            })
            logger.info(
                "new_customer_credit_given",
                user=user_email,
                plan=plan.name,
                amount_usd=plan.new_customer_credit_usd,
            )
        except Exception as exc:
            logger.warning("new_customer_credit_failed", user=user_email, error=str(exc))

    return user_plan


# ── Period-reset helpers ──────────────────────────────────────────────────────

async def _reset_training_period_if_needed(user_plan: MLUserPlan, plan: MLPlan) -> MLUserPlan:
    if _is_past(user_plan.free_training_period_reset_at) and plan.free_training_period != "none":
        await user_plan.set({
            "free_training_used_seconds": 0.0,
            "free_training_period_reset_at": _next_reset(plan.free_training_period),
            "updated_at": utc_now(),
        })
    return user_plan


async def _reset_inference_period_if_needed(user_plan: MLUserPlan, plan: MLPlan) -> MLUserPlan:
    if _is_past(user_plan.free_inference_period_reset_at) and plan.free_inference_period != "none":
        await user_plan.set({
            "free_inference_used": 0,
            "free_inference_period_reset_at": _next_reset(plan.free_inference_period),
            "updated_at": utc_now(),
        })
    return user_plan


# ── Free quota checks ─────────────────────────────────────────────────────────

async def get_free_training_seconds_remaining(
    user_plan: MLUserPlan,
    plan: MLPlan,
) -> float:
    """Return how many free training seconds the user has left this period."""
    user_plan = await _reset_training_period_if_needed(user_plan, plan)
    quota_seconds = plan.free_training_hours * 3600
    return max(0.0, quota_seconds - user_plan.free_training_used_seconds)


async def get_free_inference_remaining(
    user_plan: MLUserPlan,
    plan: MLPlan,
) -> int:
    """Return how many free inference calls the user has left this period."""
    user_plan = await _reset_inference_period_if_needed(user_plan, plan)
    return max(0, plan.free_inference_calls - user_plan.free_inference_used)


# ── Usage recording ───────────────────────────────────────────────────────────

async def consume_training_seconds(user_plan: MLUserPlan, elapsed_seconds: float) -> None:
    new_used = round(user_plan.free_training_used_seconds + elapsed_seconds, 2)
    await user_plan.set({"free_training_used_seconds": new_used, "updated_at": utc_now()})


async def consume_inference_call(user_plan: MLUserPlan) -> None:
    await user_plan.set({
        "free_inference_used": user_plan.free_inference_used + 1,
        "updated_at": utc_now(),
    })


# ── Training billing check ────────────────────────────────────────────────────

async def check_local_training(
    user_email: str,
    org_id: str,
) -> tuple[bool, float, float]:
    """
    Determine whether a local training job should be charged.

    Returns (is_free, free_seconds_remaining, price_per_hour).
    - is_free=True  → job runs at no cost; caller should NOT reserve wallet
    - is_free=False → caller must reserve (price_per_hour × estimated_hours) from wallet

    A user is free only if:
      1. The global pricing config has local_gpu_free=True (admin override), OR
      2. The user's plan record has local_gpu_exempt=True (per-user exception set by admin).
    Plan-based free training hours do NOT make local training free here — they are
    informational usage counters only.
    """
    cfg = await get_pricing_config()

    # Global override: admin has set all local training to free
    if cfg.local_gpu_free:
        return True, float("inf"), 0.0

    # Per-user exception: admin explicitly marked this user as exempt
    user_plan = await get_or_create_user_plan(user_email, org_id)
    if user_plan and user_plan.local_gpu_exempt:
        return True, float("inf"), 0.0

    return False, 0.0, cfg.local_gpu_price_per_hour


# ── Inference billing ─────────────────────────────────────────────────────────

async def charge_inference(user_email: str, org_id: str, trainer_name: str) -> float:
    """
    Deduct inference cost from the user's wallet (if applicable).
    Returns the amount charged (0.0 if free).
    """
    cfg = await get_pricing_config()

    if cfg.inference_free:
        return 0.0

    user_plan = await get_or_create_user_plan(user_email, org_id)
    if user_plan:
        plan = await MLPlan.get(user_plan.plan_id) if user_plan.plan_id else None
        if plan:
            free_remaining = await get_free_inference_remaining(user_plan, plan)
            if free_remaining > 0:
                await consume_inference_call(user_plan)
                return 0.0

    # No free calls remaining — charge wallet
    price = cfg.inference_price_per_call
    if price <= 0:
        return 0.0

    try:
        from app.services import wallet_service
        wallet = await wallet_service.get_or_create(user_email, org_id)
        if wallet_service.available(wallet) < price:
            raise ValueError(
                f"Insufficient wallet balance for inference. "
                f"Need ${price:.4f}, available ${wallet_service.available(wallet):.4f}."
            )
        wallet.balance = round(wallet.balance - price, 10)
        wallet.updated_at = utc_now()
        await wallet.save()
        from app.models.wallet import WalletTransaction
        tx = WalletTransaction(
            org_id=org_id,
            user_email=user_email,
            type="debit",
            amount=price,
            balance_after=wallet.balance,
            reserved_after=wallet.reserved,
            description=f"Inference — {trainer_name} · ${price:.4f}/call",
        )
        await tx.insert()
        logger.debug("inference_charged", user=user_email, trainer=trainer_name, cost_usd=price)
        return price
    except ValueError:
        raise
    except Exception as exc:
        logger.warning("inference_charge_failed", user=user_email, error=str(exc))
        return 0.0
