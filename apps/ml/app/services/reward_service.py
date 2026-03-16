"""Platform reward helpers — currency conversion, KYC checks."""
from app.models.platform_reward_config import (
    PlatformRewardConfig, COUNTRY_CURRENCY, DEFAULT_EXCHANGE_RATES, CURRENCY_SYMBOLS
)


async def get_reward_config() -> PlatformRewardConfig:
    config = await PlatformRewardConfig.find_one()
    if not config:
        config = PlatformRewardConfig()
        await config.insert()
    return config


def country_to_currency(country_code: str) -> str:
    return COUNTRY_CURRENCY.get(country_code.upper(), "USD")


def points_to_amount(points: int, point_value_usd: float, exchange_rates: dict, currency: str) -> float:
    rate = exchange_rates.get(currency, exchange_rates.get("USD", 1.0))
    return round(points * point_value_usd * rate, 2)


def format_amount(amount: float, currency: str) -> str:
    sym = CURRENCY_SYMBOLS.get(currency, currency)
    if currency in ("USD", "GBP", "EUR"):
        return f"{sym}{amount:,.2f}"
    # Use decimals for small amounts so e.g. KES 1.29 isn't rounded to KES 1
    if amount < 100:
        return f"{sym} {amount:,.2f}"
    return f"{sym} {amount:,.0f}"


async def points_to_local(points: int, country_code: str) -> dict:
    """Convert points to local currency dict for a given country."""
    cfg = await get_reward_config()
    currency = country_to_currency(country_code)
    amount = points_to_amount(points, cfg.point_value_usd, cfg.exchange_rates, currency)
    usd = round(points * cfg.point_value_usd, 4)
    return {
        "amount": amount,
        "currency": currency,
        "formatted": format_amount(amount, currency),
        "usd_value": usd,
        "rate_label": f"1 pt = {format_amount(cfg.point_value_usd * cfg.exchange_rates.get(currency, 1.0), currency)}",
    }


async def withdrawal_needs_kyc(points: int, country_code: str) -> bool:
    cfg = await get_reward_config()
    usd = round(points * cfg.point_value_usd, 4)
    return usd >= cfg.withdrawal_kyc_threshold_usd
