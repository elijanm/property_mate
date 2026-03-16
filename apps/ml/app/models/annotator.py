"""Platform-level annotator profiles and reward redemptions."""
import secrets
from typing import Optional
from datetime import datetime
from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field
from app.utils.datetime import utc_now


class AnnotatorProfile(Document):
    """One document per annotator user. Platform-scoped (no org_id)."""

    class Settings:
        name = "annotator_profiles"
        indexes = [IndexModel([("email", ASCENDING)], unique=True)]

    email: str
    full_name: str = ""
    phone_number: Optional[str] = None      # for airtime redemption
    country: str = "KE"                     # KE | TZ | UG | RW | ET | NG etc.
    county: str = ""            # county/state within country
    bio: str = ""
    total_points_earned: int = 0
    total_points_redeemed: int = 0
    redeemable_points: int = 0              # earned - redeemed
    total_entries_submitted: int = 0
    total_tasks_completed: int = 0
    referral_code: str = Field(default_factory=lambda: secrets.token_urlsafe(8))
    referred_by: Optional[str] = None       # referral_code of the referrer
    joined_at: datetime = Field(default_factory=utc_now)
    last_active_at: Optional[datetime] = None
    # KYC
    kyc_status: str = "none"   # none | pending | approved | rejected
    avatar_key: Optional[str] = None
    id_front_key: Optional[str] = None
    id_back_key: Optional[str] = None
    kyc_submitted_at: Optional[datetime] = None
    kyc_reviewed_at: Optional[datetime] = None
    kyc_rejection_reason: Optional[str] = None


class RewardRedemption(Document):
    """Airtime redemption record."""

    class Settings:
        name = "reward_redemptions"

    annotator_email: str
    points_redeemed: int
    kes_value: float                        # KES value sent
    phone_number: str
    at_transaction_id: Optional[str] = None  # Africa's Talking transaction ID
    status: str = "pending"                  # pending | sent | failed
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
