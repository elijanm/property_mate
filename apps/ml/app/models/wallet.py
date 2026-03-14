from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class Wallet(Document):
    class Settings:
        name = "wallets"

    org_id: str = ""
    user_email: str
    balance: float = 0.0      # total available (not including reserved)
    reserved: float = 0.0     # held for pending GPU jobs
    currency: str = "USD"

    # Monthly local training quota
    local_quota_seconds: int = 36_000      # 10 hrs free/month (configurable via purchase)
    local_used_seconds: float = 0.0        # seconds consumed this billing cycle
    local_quota_reset_at: Optional[datetime] = None  # when usage resets (start of next month)

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WalletTransaction(Document):
    class Settings:
        name = "wallet_transactions"

    org_id: str = ""
    user_email: str
    type: str   # credit | debit | reserve | release
    amount: float
    balance_after: float
    reserved_after: float
    description: str
    reference: Optional[str] = None   # Paystack reference
    job_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
