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
    """Return the total spendable balance (standard + general). For standard compute jobs."""
    return round(wallet.balance, 2)


def available_for_cloud(wallet: Wallet) -> float:
    """Return the general (non-earmarked) spendable balance. Cloud GPU jobs may only use this."""
    return round(wallet.balance - wallet.standard_balance, 2)


async def reserve(
    wallet: Wallet,
    amount: float,
    job_id: str,
    description: str,
    compute_type: str = "local",
) -> None:
    """
    Hold `amount` for a pending job.

    compute_type="cloud_gpu":
        Can only draw from the general (non-earmarked) portion: balance - standard_balance.
        standard_balance is NOT touched.

    compute_type="local" (default, standard compute):
        Can draw from the full balance. standard_balance is reduced proportionally —
        standard portion used = min(standard_balance, amount).
    """
    amount = round(amount, 10)

    if compute_type == "cloud_gpu":
        general_available = round(wallet.balance - wallet.standard_balance, 10)
        if general_available < amount:
            raise ValueError("INSUFFICIENT_BALANCE")
        # standard_balance stays the same — cloud draws from general bucket only
        std_used = 0.0
    else:
        if round(wallet.balance, 10) < amount:
            raise ValueError("INSUFFICIENT_BALANCE")
        # Standard compute drains standard_balance first, then spills into general
        std_used = round(min(wallet.standard_balance, amount), 10)
        wallet.standard_balance = round(wallet.standard_balance - std_used, 10)

    wallet.balance = round(wallet.balance - amount, 10)
    wallet.reserved = round(wallet.reserved + amount, 10)
    wallet.updated_at = utc_now()
    await wallet.save()

    tx = WalletTransaction(
        org_id=wallet.org_id,
        user_email=wallet.user_email,
        type="reserve",
        amount=amount,
        standard_amount=std_used,
        balance_after=wallet.balance,
        standard_balance_after=wallet.standard_balance,
        reserved_after=wallet.reserved,
        description=description,
        job_id=job_id,
    )
    await tx.insert()


async def release_and_charge(wallet: Wallet, job_id: str, actual_cost: float) -> float:
    """
    Release the reserved amount for `job_id` and charge actual cost.
    Returns the actual amount charged.

    Precision guarantee:
    - All arithmetic is done at 10-decimal precision internally.
    - standard_balance is restored proportionally: if X% of the reservation came from
      standard_balance, then X% of the refund goes back to standard_balance.
    """
    # Find the reserve transaction for this job
    reserve_tx = await WalletTransaction.find_one(
        WalletTransaction.job_id == job_id,
        WalletTransaction.type == "reserve",
        WalletTransaction.user_email == wallet.user_email,
    )
    reserved_amount = round(reserve_tx.amount, 10) if reserve_tx else 0.0
    std_reserved = round(reserve_tx.standard_amount, 10) if reserve_tx else 0.0

    # Guard: if a release tx already exists for this job, do nothing (idempotent)
    already_released = await WalletTransaction.find_one(
        WalletTransaction.job_id == job_id,
        WalletTransaction.type == "release",
        WalletTransaction.user_email == wallet.user_email,
    )
    if already_released:
        logger.debug("release_and_charge_skipped_duplicate", job_id=job_id, user=wallet.user_email)
        return 0.0

    # Cap actual at what was reserved (never charge more than was held)
    actual = round(min(actual_cost, reserved_amount), 10)

    # Debit from reserved bucket — cap deduction to what's physically there (race-condition safety)
    deductible = round(min(reserved_amount, wallet.reserved), 10)
    wallet.reserved = max(0.0, round(wallet.reserved - deductible, 10))

    # Refund unused portion back to spendable balance
    actual_overage = max(0.0, round(deductible - actual, 10))
    wallet.balance = round(wallet.balance + actual_overage, 10)

    # Restore standard_balance proportionally.
    # If the reservation consumed std_reserved of standard_balance, the refund returns
    # that same proportion of the overage back to standard_balance.
    if reserved_amount > 0 and std_reserved > 0:
        std_proportion = round(std_reserved / reserved_amount, 10)
        std_refund = round(actual_overage * std_proportion, 10)
        # Never let standard_balance exceed balance (invariant)
        wallet.standard_balance = min(
            round(wallet.standard_balance + std_refund, 10),
            wallet.balance,
        )

    wallet.updated_at = utc_now()
    await wallet.save()

    short_id = job_id[:8]
    overage_for_log = actual_overage   # local alias for transaction records

    # Record debit transaction (actual cost charged)
    if actual > 0:
        debit_tx = WalletTransaction(
            org_id=wallet.org_id,
            user_email=wallet.user_email,
            type="debit",
            amount=actual,
            standard_amount=round(std_reserved - std_reserved * actual_overage / deductible, 10)
                if deductible > 0 else 0.0,
            balance_after=wallet.balance,
            standard_balance_after=wallet.standard_balance,
            reserved_after=wallet.reserved,
            description=(
                f"Compute charge — ${actual:.6f} used of ${reserved_amount:.6f} reserved · job {short_id}"
            ),
            job_id=job_id,
        )
        await debit_tx.insert()

    # Record release transaction (unused reservation refunded)
    if reserved_amount > 0:
        std_refund_val = round(wallet.standard_balance, 10) if actual_overage > 0 else 0.0
        if overage_for_log > 0:
            refund_desc = (
                f"Unused compute time refunded — reserved ${reserved_amount:.6f}, "
                f"used ${actual:.6f}, refund ${overage_for_log:.6f} · job {short_id}"
            )
        else:
            refund_desc = (
                f"Compute job completed — fully consumed reservation ${reserved_amount:.6f} · job {short_id}"
            )
        release_tx = WalletTransaction(
            org_id=wallet.org_id,
            user_email=wallet.user_email,
            type="release",
            amount=overage_for_log,
            standard_amount=round(actual_overage * (std_reserved / reserved_amount), 10)
                if reserved_amount > 0 and actual_overage > 0 else 0.0,
            balance_after=wallet.balance,
            standard_balance_after=wallet.standard_balance,
            reserved_after=wallet.reserved,
            description=refund_desc,
            job_id=job_id,
        )
        await release_tx.insert()

    return actual


async def credit(
    wallet: Wallet,
    amount: float,
    reference: str,
    description: str,
    is_standard: bool = False,
) -> None:
    """
    Credit the wallet.

    is_standard=True  → earmarked for standard compute (admin grants, plan credits).
                        Both balance and standard_balance increase.
    is_standard=False → general credit (user self-top-up via Paystack).
                        Only balance increases; standard_balance unchanged.
    """
    amount = round(amount, 10)
    wallet.balance = round(wallet.balance + amount, 10)
    if is_standard:
        wallet.standard_balance = round(wallet.standard_balance + amount, 10)
    wallet.updated_at = utc_now()
    await wallet.save()

    tx = WalletTransaction(
        org_id=wallet.org_id,
        user_email=wallet.user_email,
        type="credit",
        amount=amount,
        standard_amount=amount if is_standard else 0.0,
        balance_after=wallet.balance,
        standard_balance_after=wallet.standard_balance,
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


async def admin_credit(
    user_email: str,
    org_id: str,
    amount_usd: float,
    performed_by: str,
    note: str = "",
) -> tuple:
    """
    Admin recharges a user's wallet with `amount_usd`.
    Always earmarked as standard compute credit (is_standard=True).
    Records a WalletTransaction (credit) and a PlatformLedger entry.
    Returns (wallet, ledger_entry).
    """
    from app.models.platform_ledger import PlatformLedger

    wallet = await get_or_create(user_email, org_id)
    await credit(
        wallet=wallet,
        amount=amount_usd,
        reference=f"admin:{performed_by}:{user_email}",
        description=f"Admin recharge by {performed_by}" + (f" — {note}" if note else ""),
        is_standard=True,    # admin grants are standard compute credits
    )

    # Find the transaction we just wrote so we can cross-reference it
    tx = await WalletTransaction.find_one(
        WalletTransaction.user_email == user_email,
        WalletTransaction.type == "credit",
        WalletTransaction.reference == f"admin:{performed_by}",
        sort=[("-created_at", 1)],
    )

    ledger = PlatformLedger(
        amount_usd=round(amount_usd, 4),
        recipient_email=user_email,
        performed_by=performed_by,
        note=note,
        wallet_tx_id=str(tx.id) if tx else "",
    )
    await ledger.insert()

    logger.info(
        "admin_wallet_recharged",
        recipient=user_email,
        amount_usd=amount_usd,
        admin=performed_by,
    )
    return wallet, ledger


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
