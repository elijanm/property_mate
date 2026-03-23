"""Coupon codes — admin-created codes that credit a user's wallet on signup."""
from typing import Optional
from datetime import datetime
from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field
from app.utils.datetime import utc_now


class Coupon(Document):
    code: str                              # e.g. "LAUNCH50" — unique, case-insensitive stored UPPER
    description: str = ""                  # internal note
    credit_usd: float                      # amount to credit (standard balance)
    max_uses: int = 0                      # 0 = unlimited
    uses_count: int = 0                    # incremented atomically on redemption
    is_active: bool = True
    expires_at: Optional[datetime] = None  # None = never expires
    created_by: str = ""                   # admin email
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "coupons"
        indexes = [IndexModel([("code", ASCENDING)], unique=True)]


class CouponRedemption(Document):
    """One record per user per coupon — prevents double redemption."""
    coupon_code: str
    user_email: str
    org_id: str
    credit_usd: float
    redeemed_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "coupon_redemptions"
        indexes = [
            IndexModel([("coupon_code", ASCENDING), ("user_email", ASCENDING)], unique=True),
            IndexModel([("coupon_code", ASCENDING)]),
            IndexModel([("user_email", ASCENDING)]),
        ]
