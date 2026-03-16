"""Wallet endpoints — balance, top-up via Paystack, transaction history."""
import json
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.models.wallet import Wallet, WalletTransaction
from app.models.platform_ledger import PlatformLedger
from app.services import wallet_service
from app.services.paystack_service import verify_webhook_signature

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/wallet", tags=["wallet"])


# ── request/response schemas ─────────────────────────────────────────────────

class TopupInitRequest(BaseModel):
    amount: float          # KES
    callback_url: str


class TopupVerifyRequest(BaseModel):
    reference: str


class PurchaseHoursRequest(BaseModel):
    hours: float           # additional local training hours to purchase (deducted from USD wallet)


class AdminRechargeRequest(BaseModel):
    user_email: str
    amount_usd: float
    note: str = ""


def _wallet_dict(wallet: Wallet) -> dict:
    std = round(wallet.standard_balance, 10)
    general = round(wallet.balance - wallet.standard_balance, 10)
    return {
        "id": str(wallet.id),
        "user_email": wallet.user_email,
        "balance": round(wallet.balance, 10),          # total available
        "standard_balance": std,                       # earmarked for standard compute only
        "general_balance": general,                    # usable for any compute (incl. cloud GPU)
        "reserved": round(wallet.reserved, 10),
        "currency": wallet.currency,
        "local_quota_seconds": wallet.local_quota_seconds,
        "local_used_seconds": round(wallet.local_used_seconds, 2),
        "local_quota_reset_at": wallet.local_quota_reset_at.isoformat() if wallet.local_quota_reset_at else None,
        "created_at": wallet.created_at.isoformat(),
        "updated_at": wallet.updated_at.isoformat(),
    }


def _tx_dict(tx: WalletTransaction) -> dict:
    return {
        "id": str(tx.id),
        "type": tx.type,
        "amount": round(tx.amount, 10),
        "standard_amount": round(tx.standard_amount, 10),
        "balance_after": round(tx.balance_after, 10),
        "standard_balance_after": round(tx.standard_balance_after, 10),
        "reserved_after": round(tx.reserved_after, 10),
        "description": tx.description,
        "reference": tx.reference,
        "job_id": tx.job_id,
        "created_at": tx.created_at.isoformat(),
    }


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def get_wallet(user=Depends(get_current_user)):
    """Return the caller's wallet balance, reserved amount, and currency."""
    w = await wallet_service.get_or_create(user.email, user.org_id)
    return _wallet_dict(w)


@router.get("/transactions")
async def list_transactions(
    page: int = 1,
    page_size: int = 20,
    user=Depends(get_current_user),
):
    """Return paginated wallet transaction history for the caller."""
    skip = (page - 1) * page_size
    query = WalletTransaction.find(
        WalletTransaction.user_email == user.email,
        WalletTransaction.org_id == user.org_id,
    ).sort(-WalletTransaction.created_at)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).to_list()
    return {
        "items": [_tx_dict(t) for t in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/topup/initialize")
async def initialize_topup(body: TopupInitRequest, user=Depends(get_current_user)):
    """Initialize a Paystack payment to top up the wallet."""
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    try:
        result = await wallet_service.initialize_topup(
            user_email=user.email,
            amount_kes=body.amount,
            callback_url=body.callback_url,
        )
    except Exception as exc:
        logger.error("topup_initialize_failed", user_email=user.email, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {exc}")
    return {
        "authorization_url": result["authorization_url"],
        "reference": result["reference"],
    }


@router.post("/topup/verify")
async def verify_topup(body: TopupVerifyRequest, user=Depends(get_current_user)):
    """Verify a Paystack payment reference and credit the wallet."""
    try:
        payment = await wallet_service.verify_topup(body.reference)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("topup_verify_failed", user_email=user.email, error=str(exc))
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {exc}")

    # Guard: only credit the wallet of the email on the payment
    if payment["user_email"] and payment["user_email"] != user.email:
        raise HTTPException(status_code=403, detail="Payment does not belong to this account")

    # Idempotency: check if this reference was already credited
    existing = await WalletTransaction.find_one(
        WalletTransaction.reference == body.reference,
        WalletTransaction.type == "credit",
    )
    if existing:
        w = await wallet_service.get_or_create(user.email, user.org_id)
        return _wallet_dict(w)

    w = await wallet_service.get_or_create(user.email, user.org_id)
    await wallet_service.credit(
        wallet=w,
        amount=payment["amount_usd"],
        reference=body.reference,
        description=f"Wallet top-up via Paystack (ref: {body.reference})",
    )
    logger.info(
        "wallet_credited",
        user_email=user.email,
        amount_usd=payment["amount_usd"],
        reference=body.reference,
    )
    return _wallet_dict(w)


@router.get("/local-quota")
async def get_local_quota(user=Depends(get_current_user)):
    """Return local training quota status — used/remaining/reset date."""
    w = await wallet_service.get_or_create(user.email, user.org_id)
    w = await wallet_service.check_and_reset_local_quota(w)
    remaining = wallet_service.local_quota_remaining(w)
    return {
        "quota_seconds": w.local_quota_seconds,
        "used_seconds": round(w.local_used_seconds, 2),
        "remaining_seconds": round(remaining, 2),
        "quota_hours": round(w.local_quota_seconds / 3600, 2),
        "used_hours": round(w.local_used_seconds / 3600, 2),
        "remaining_hours": round(remaining / 3600, 2),
        "reset_at": w.local_quota_reset_at.isoformat() if w.local_quota_reset_at else None,
        "exhausted": remaining <= 0,
    }


# Price per additional hour of local training (USD)
_LOCAL_HOUR_PRICE_USD = 0.50


@router.post("/local-quota/purchase")
async def purchase_local_hours(body: PurchaseHoursRequest, user=Depends(get_current_user)):
    """
    Purchase additional local training hours.
    Hours are priced at $0.50 USD/hr and deducted from the wallet balance.
    """
    if body.hours <= 0:
        raise HTTPException(status_code=400, detail="Hours must be greater than 0")
    if body.hours > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 hours per purchase")

    cost_usd = round(body.hours * _LOCAL_HOUR_PRICE_USD, 2)

    w = await wallet_service.get_or_create(user.email, user.org_id)
    if wallet_service.available(w) < cost_usd:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Insufficient balance. Need ${cost_usd:.2f} USD, "
                f"available ${wallet_service.available(w):.2f} USD."
            ),
        )

    # Debit wallet
    w.balance = round(w.balance - cost_usd, 10)
    from app.utils.datetime import utc_now as _utc
    w.updated_at = _utc()
    await w.save()

    tx = WalletTransaction(
        org_id=w.org_id,
        user_email=w.user_email,
        type="debit",
        amount=cost_usd,
        balance_after=w.balance,
        reserved_after=w.reserved,
        description=f"Purchased {body.hours:.1f} hrs local training quota (${cost_usd:.2f} USD)",
    )
    await tx.insert()

    await wallet_service.purchase_local_hours(w, body.hours)
    logger.info(
        "local_hours_purchased",
        user_email=user.email,
        hours=body.hours,
        cost_usd=cost_usd,
    )
    return _wallet_dict(w)


def _ledger_dict(entry: PlatformLedger) -> dict:
    return {
        "id": str(entry.id),
        "amount_usd": round(entry.amount_usd, 4),
        "recipient_email": entry.recipient_email,
        "performed_by": entry.performed_by,
        "note": entry.note,
        "wallet_tx_id": entry.wallet_tx_id,
        "created_at": entry.created_at.isoformat(),
    }


# ── Admin-only endpoints ───────────────────────────────────────────────────────

@router.post("/admin/recharge", dependencies=[Depends(require_roles("admin"))])
async def admin_recharge(body: AdminRechargeRequest, user=Depends(get_current_user)):
    """
    Admin credits a user's wallet with the given USD amount and records it as a
    platform expense in the ledger.
    """
    if body.amount_usd <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    if not body.user_email:
        raise HTTPException(status_code=400, detail="user_email is required")

    # Look up target user to get their org_id
    from app.models.ml_user import MLUser
    target = await MLUser.find_one(MLUser.email == body.user_email)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    wallet, ledger = await wallet_service.admin_credit(
        user_email=body.user_email,
        org_id=target.org_id,
        amount_usd=body.amount_usd,
        performed_by=user.email,
        note=body.note,
    )
    return {
        "wallet": _wallet_dict(wallet),
        "ledger_entry": _ledger_dict(ledger),
    }


@router.get("/admin/ledger", dependencies=[Depends(require_roles("admin"))])
async def admin_ledger(page: int = 1, page_size: int = 30):
    """Paginated list of all admin-initiated wallet recharges (platform expenses)."""
    skip = (page - 1) * page_size
    query = PlatformLedger.find().sort(-PlatformLedger.created_at)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).to_list()

    total_spent = await PlatformLedger.find().sum(PlatformLedger.amount_usd) or 0.0

    return {
        "items": [_ledger_dict(e) for e in items],
        "total": total,
        "total_spent_usd": round(total_spent, 4),
        "page": page,
        "page_size": page_size,
    }


@router.get("/admin/users", dependencies=[Depends(require_roles("admin"))])
async def admin_list_users():
    """Return a slim list of all users (email + org_id) for the admin recharge picker."""
    from app.models.ml_user import MLUser
    users = await MLUser.find(MLUser.is_active == True).to_list()
    return [
        {"email": u.email, "full_name": u.full_name, "org_id": u.org_id, "role": u.role}
        for u in users
    ]


@router.post("/webhook/paystack")
async def paystack_webhook(request: Request):
    """
    Paystack webhook receiver — no auth required (Paystack calls this directly).
    Verifies HMAC signature and credits wallet on charge.success.
    """
    payload = await request.body()
    signature = request.headers.get("x-paystack-signature", "")

    if not verify_webhook_signature(payload, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event = json.loads(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("event")
    if event_type != "charge.success":
        # Acknowledge but take no action for other events
        return {"received": True}

    from app.core.config import settings as _s
    data = event.get("data", {})
    reference = data.get("reference", "")
    amount_kobo = data.get("amount", 0)
    amount_usd = round(amount_kobo / 100 / _s.USD_TO_KES_RATE, 4)
    user_email = (
        (data.get("metadata") or {}).get("user_email")
        or data.get("customer", {}).get("email", "")
    )

    if not user_email or not reference:
        logger.warning("webhook_missing_fields", reference=reference, user_email=user_email)
        return {"received": True}

    # Idempotency check
    existing = await WalletTransaction.find_one(
        WalletTransaction.reference == reference,
        WalletTransaction.type == "credit",
    )
    if existing:
        return {"received": True}

    try:
        # Resolve org_id from user record if possible
        from app.models.ml_user import MLUser
        user_record = await MLUser.find_one(MLUser.email == user_email)
        org_id = getattr(user_record, "org_id", "") if user_record else ""

        w = await wallet_service.get_or_create(user_email, org_id)
        await wallet_service.credit(
            wallet=w,
            amount=amount_usd,
            reference=reference,
            description=f"Wallet top-up via Paystack webhook (ref: {reference})",
        )
        logger.info(
            "webhook_wallet_credited",
            user_email=user_email,
            amount_usd=amount_usd,
            reference=reference,
        )
    except Exception as exc:
        logger.error("webhook_credit_failed", reference=reference, error=str(exc))
        # Return 200 so Paystack doesn't retry endlessly
        return {"received": True, "error": str(exc)}

    return {"received": True}
