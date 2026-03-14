"""Platform expense ledger — tracks admin-initiated wallet recharges."""
from datetime import datetime, timezone
from typing import Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class PlatformLedger(Document):
    """One entry per admin wallet recharge. Treated as a platform expense."""

    class Settings:
        name = "platform_ledger"

    amount_usd: float
    recipient_email: str          # user whose wallet was credited
    performed_by: str             # admin email who triggered the recharge
    note: str = ""                # optional memo / reason
    wallet_tx_id: str = ""        # WalletTransaction id for cross-reference
    created_at: datetime = Field(default_factory=utc_now)
