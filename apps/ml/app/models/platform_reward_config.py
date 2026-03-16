"""Platform-level reward configuration — singleton document."""
from typing import Dict
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now

COUNTRY_CURRENCY: Dict[str, str] = {
    "KE": "KES", "TZ": "TZS", "UG": "UGX", "RW": "RWF",
    "ET": "ETB", "NG": "NGN", "GH": "GHS", "ZA": "ZAR",
    "US": "USD", "GB": "GBP",
}

DEFAULT_EXCHANGE_RATES: Dict[str, float] = {
    "USD": 1.0, "KES": 129.0, "TZS": 2540.0, "UGX": 3700.0,
    "RWF": 1300.0, "ETB": 57.0, "NGN": 1550.0, "GHS": 12.5,
    "ZAR": 18.5, "GBP": 0.79, "EUR": 0.92,
}

CURRENCY_SYMBOLS: Dict[str, str] = {
    "USD": "$", "GBP": "£", "EUR": "€",
    "KES": "KES", "TZS": "TZS", "UGX": "UGX",
    "RWF": "RWF", "ETB": "ETB", "NGN": "₦",
    "GHS": "GHS", "ZAR": "R",
}


class PlatformRewardConfig(Document):
    """Singleton — get_or_create via reward_service.get_reward_config()."""

    class Settings:
        name = "platform_reward_config"

    point_value_usd: float = 0.01           # 1 point = $0.01 USD
    exchange_rates: Dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_EXCHANGE_RATES))
    withdrawal_kyc_threshold_usd: float = 5.0  # points worth >= $5 requires KYC
    min_org_balance_usd: float = 10.0          # org must have $10 wallet balance to enable rewards
    min_redemption_points: int = 100
    auto_approve_kyc: bool = False
    updated_at: datetime = Field(default_factory=utc_now)
    updated_by: str = ""
