"""ML billing plans and per-user plan state."""
from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class MLPricingConfig(Document):
    """
    Singleton admin-controlled pricing settings.
    Only one document exists — identified by key='global'.
    """
    class Settings:
        name = "ml_pricing_config"

    key: str = "global"   # always "global" — singleton

    # Local CPU training
    local_cpu_price_per_hour: float = 0.05   # USD/hr — charged for CPU-only training
    local_cpu_free: bool = False             # override: if True, CPU training is always free

    # Local GPU training
    local_gpu_price_per_hour: float = 0.20   # USD/hr charged when user has no free hours
    local_gpu_free: bool = False             # override: if True, all local GPU training is free

    # Inference
    inference_price_per_call: float = 0.001  # USD per inference call
    inference_free: bool = False             # override: if True, all inference is free regardless of plan

    updated_at: datetime = Field(default_factory=utc_now)


class MLPlan(Document):
    """
    Subscription plan template.  Admins create these; users are assigned one.
    """
    class Settings:
        name = "ml_plans"

    name: str                               # e.g. "Free", "Starter", "Pro", "Enterprise"
    description: str = ""

    price_usd_per_month: float = 0.0        # 0 = free tier; informational only (billing handled externally)

    # Reset period (shared across all included compute types)
    included_period: str = "month"          # "day" | "week" | "month" | "none"

    # Included compute hours per period (all charged at configured rates; plan covers the cost)
    included_cpu_hours: float = 0.0         # CPU training hours covered by plan
    included_local_gpu_hours: float = 0.0   # local GPU training hours covered by plan
    included_cloud_gpu_credit_usd: float = 0.0  # cloud GPU wallet credit added each period

    # Included inference calls per period
    free_inference_calls: int = 0
    free_inference_period: str = "month"

    # ── Legacy fields (kept for backward compat with existing user plans) ──────
    free_training_hours: float = 0.0        # old CPU hours — maps to included_cpu_hours
    free_training_period: str = "month"
    free_local_gpu_hours: float = 0.0       # old local GPU hours — maps to included_local_gpu_hours

    # One-time new-customer credit
    new_customer_credit_usd: float = 0.0    # added to wallet on first assignment

    is_active: bool = True
    is_default: bool = False                # auto-assigned to new users if no plan exists

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class MLUserPlan(Document):
    """
    Per-user plan assignment and period usage counters.
    One document per user.  Replaced (not versioned) when plan changes.
    """
    class Settings:
        name = "ml_user_plans"

    user_email: str
    org_id: str = ""
    plan_id: str                            # references MLPlan._id (as string)
    plan_name: str = ""                     # snapshot of plan name

    # Training usage this period
    free_training_used_seconds: float = 0.0
    free_training_period_reset_at: Optional[datetime] = None

    # Inference usage this period
    free_inference_used: int = 0
    free_inference_period_reset_at: Optional[datetime] = None

    # Admin-set per-user exemptions
    local_gpu_exempt: bool = False          # admin can mark this user as exempt from local GPU charges

    # One-time new customer credit state
    new_customer_credit_given: bool = False
    new_customer_credit_amount: float = 0.0

    assigned_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
