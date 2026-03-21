"""Revenue ledger — every monetisable event creates one entry."""
from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


# Revenue type constants
REV_PLAN_SUBSCRIPTION = "plan_subscription"      # Monthly plan fee paid
REV_WALLET_TOPUP      = "wallet_topup"           # User topped up wallet via Paystack
REV_GPU_STANDARD      = "gpu_standard"           # Standard / local GPU compute charges
REV_GPU_ACCELERATED   = "gpu_accelerated"        # Cloud / accelerated GPU compute charges
REV_INFERENCE_OPENAI  = "inference_openai"       # Inference calls routed to OpenAI
REV_INFERENCE_LOCAL   = "inference_local"        # Inference calls served locally
REV_FREE_CREDIT       = "free_credit_grant"      # Negative — free credit given (cost)
REV_PRORATION_CREDIT  = "proration_credit"       # Negative — credit issued on plan downgrade/upgrade


class RevenueLedger(Document):
    """
    Append-only revenue ledger.
    Positive amount = revenue in.
    Negative amount = credit/refund issued (cost to platform).
    """
    class Settings:
        name = "revenue_ledger"

    org_id: str = ""
    user_email: str
    type: str                                    # one of REV_* constants above
    amount_usd: float                            # positive = revenue, negative = credit/cost
    plan_id: Optional[str] = None               # for plan_subscription events
    plan_name: Optional[str] = None
    description: str = ""
    reference: Optional[str] = None             # Paystack reference or internal job_id
    metadata: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
