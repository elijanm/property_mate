"""Wallet service — balance management, Paystack top-up, GPU cost reservation."""
from typing import Optional

import httpx
import structlog

from app.core.config import settings
from app.models.wallet import Wallet, WalletTransaction
from app.utils.datetime import utc_now

FREE_LOCAL_QUOTA_SECONDS: int = 36_000   # 10 hours/month

logger = structlog.get_logger(__name__)


async def get_or_create(user_email: str, org_id: str) -> Wallet:
    """Return existing wallet or create a new one for the user."""
    wallet = await Wallet.find_one(Wallet.user_email == user_email, Wallet.org_id == org_id)
    if wallet:
        return wallet
    wallet = Wallet(user_email=user_email, org_id=org_id)
    await wallet.insert()
    return wallet


def available(wallet: Wallet) -> float:
    """Return the spendable balance (balance is already the available amount)."""
    return round(wallet.balance, 2)


async def reserve(wallet: Wallet, amount: float, job_id: str, description: str) -> None:
    """
    Hold `amount` for a pending GPU job.
    Deducts from balance and adds to reserved.
    Raises ValueError if balance is insufficient.
    """
    if round(wallet.balance, 10) < round(amount, 10):
        raise ValueError("INSUFFICIENT_BALANCE")

    wallet.balance = round(wallet.balance - amount, 10)
    wallet.reserved = round(wallet.reserved + amount, 10)
    wallet.updated_at = utc_now()
    await wallet.save()

    tx = WalletTransaction(
        org_id=wallet.org_id,
        user_email=wallet.user_email,
        type="reserve",
        amount=amount,
        balance_after=wallet.balance,
        reserved_after=wallet.reserved,
        description=description,
        job_id=job_id,
    )
    await tx.insert()


async def release_and_charge(wallet: Wallet, job_id: str, actual_cost: float) -> float:
    """
    Release the reserved amount for `job_id` and charge actual cost.
    Returns the actual amount charged.
    """
    # Find the reserve transaction for this job
    reserve_tx = await WalletTransaction.find_one(
        WalletTransaction.job_id == job_id,
        WalletTransaction.type == "reserve",
        WalletTransaction.user_email == wallet.user_email,
    )
    reserved_amount = reserve_tx.amount if reserve_tx else 0.0

    # Cap actual at what was reserved
    actual = round(min(actual_cost, reserved_amount), 10)
    overage = round(reserved_amount - actual, 10)

    # Release reserved hold; refund overage back to balance
    wallet.reserved = round(wallet.reserved - reserved_amount, 10)
    wallet.balance = round(wallet.balance + overage, 10)
    wallet.updated_at = utc_now()
    await wallet.save()

    # Record release transaction (overage refund)
    if overage > 0:
        release_tx = WalletTransaction(
            org_id=wallet.org_id,
            user_email=wallet.user_email,
            type="release",
            amount=overage,
            balance_after=wallet.balance,
            reserved_after=wallet.reserved,
            description=f"GPU reservation refund for job {job_id}",
            job_id=job_id,
        )
        await release_tx.insert()

    # Record debit transaction (actual cost)
    if actual > 0:
        debit_tx = WalletTransaction(
            org_id=wallet.org_id,
            user_email=wallet.user_email,
            type="debit",
            amount=actual,
            balance_after=wallet.balance,
            reserved_after=wallet.reserved,
            description=f"GPU training charge for job {job_id}",
            job_id=job_id,
        )
        await debit_tx.insert()

    return actual


async def credit(wallet: Wallet, amount: float, reference: str, description: str) -> None:
    """Credit the wallet with a top-up amount."""
    wallet.balance = round(wallet.balance + amount, 10)
    wallet.updated_at = utc_now()
    await wallet.save()

    tx = WalletTransaction(
        org_id=wallet.org_id,
        user_email=wallet.user_email,
        type="credit",
        amount=amount,
        balance_after=wallet.balance,
        reserved_after=wallet.reserved,
        description=description,
        reference=reference,
    )
    await tx.insert()


def _next_reset_date():
    """First second of next calendar month at 00:00 UTC (naive, consistent with MongoDB storage)."""
    from datetime import datetime
    now = utc_now()
    if now.month == 12:
        return datetime(now.year + 1, 1, 1, 0, 0, 0)
    return datetime(now.year, now.month + 1, 1, 0, 0, 0)


async def check_and_reset_local_quota(wallet: Wallet) -> Wallet:
    """Reset monthly local quota if the reset date has passed."""
    from datetime import timezone
    now = utc_now()
    reset_at = wallet.local_quota_reset_at
    if reset_at is not None and reset_at.tzinfo is None:
        reset_at = reset_at.replace(tzinfo=timezone.utc)
    if reset_at is None or now >= reset_at:
        wallet.local_used_seconds = 0.0
        wallet.local_quota_reset_at = _next_reset_date()
        wallet.updated_at = utc_now()
        await wallet.save()
    return wallet


def local_quota_remaining(wallet: Wallet) -> float:
    """Remaining local training seconds for this billing cycle."""
    return max(0.0, wallet.local_quota_seconds - wallet.local_used_seconds)


async def consume_local_time(wallet: Wallet, elapsed_seconds: float) -> None:
    """Record local training time usage."""
    wallet.local_used_seconds = round(wallet.local_used_seconds + elapsed_seconds, 2)
    wallet.updated_at = utc_now()
    await wallet.save()


async def purchase_local_hours(wallet: Wallet, hours: float) -> None:
    """Permanently add purchased local training hours to quota (on top of free tier)."""
    wallet.local_quota_seconds += int(hours * 3600)
    wallet.updated_at = utc_now()
    await wallet.save()


async def initialize_topup(user_email: str, amount_kes: float, callback_url: str) -> dict:
    """
    Initialize a Paystack transaction for topping up the wallet.
    `amount_kes` is the KES amount — Paystack charges this and the wallet is credited in KES.
    Returns { authorization_url, reference, access_code }.
    """
    amount_kobo = int(round(amount_kes * 100))
    payload = {
        "email": user_email,
        "amount": amount_kobo,
        "callback_url": callback_url,
        "metadata": {"user_email": user_email},
        "currency": "KES",
    }
    headers = {
        "Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.paystack.co/transaction/initialize",
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    if not data.get("status"):
        raise ValueError(f"Paystack error: {data.get('message', 'Unknown error')}")

    d = data["data"]
    return {
        "authorization_url": d["authorization_url"],
        "reference": d["reference"],
        "access_code": d.get("access_code", ""),
    }


async def verify_topup(reference: str) -> dict:
    """
    Verify a Paystack transaction by reference.
    Returns { amount_kes, user_email } on success.
    Raises ValueError if payment was not successful.
    """
    headers = {
        "Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.paystack.co/transaction/verify/{reference}",
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    if not data.get("status"):
        raise ValueError(f"Paystack error: {data.get('message', 'Unknown error')}")

    tx_data = data["data"]
    if tx_data.get("status") != "success":
        raise ValueError("Payment not successful")

    amount_kobo = tx_data["amount"]
    amount_kes = round(amount_kobo / 100, 2)
    amount_usd = round(amount_kes / settings.USD_TO_KES_RATE, 4)
    user_email = (
        (tx_data.get("metadata") or {}).get("user_email")
        or tx_data.get("customer", {}).get("email", "")
    )
    return {"amount_usd": amount_usd, "user_email": user_email}
