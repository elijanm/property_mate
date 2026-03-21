"""User-facing billing endpoints (non-admin)."""
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/billing", tags=["billing"])


def _auth(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return authorization.split(" ", 1)[1]


@router.get("/my-plan")
async def get_my_plan(authorization: Optional[str] = Header(None)):
    """Return the current user's plan, usage, wallet balance, and available plans."""
    token = _auth(authorization)
    from app.services import auth_service
    from app.services.ml_billing_service import get_user_plan, get_pricing_config, list_plans
    from app.models.wallet import Wallet

    user = await auth_service.get_current_user(token)
    user_plan = await get_user_plan(user.email, user.org_id)
    pricing = await get_pricing_config()
    all_plans = await list_plans(include_inactive=False)

    wallet = await Wallet.find_one({"org_id": user.org_id})
    wallet_data = None
    if wallet:
        general_balance = float(wallet.balance) - float(wallet.standard_balance)
        wallet_data = {
            "balance": float(wallet.balance),
            "standard_balance": float(wallet.standard_balance),
            "general_balance": max(general_balance, 0.0),
            "reserved": float(wallet.reserved),
            "currency": getattr(wallet, "currency", "USD"),
        }

    current_plan = None
    if user_plan and user_plan.plan_id:
        from beanie import PydanticObjectId
        from app.models.ml_plan import MLPlan
        try:
            current_plan = await MLPlan.get(PydanticObjectId(user_plan.plan_id))
        except Exception:
            pass

    def _plan_dict(p):
        if not p:
            return None
        return {
            "id": str(p.id),
            "name": p.name,
            "description": getattr(p, "description", ""),
            "price_usd_per_month": p.price_usd_per_month,
            "included_period": p.included_period,
            "included_cpu_hours": p.included_cpu_hours,
            "included_local_gpu_hours": p.included_local_gpu_hours,
            "included_cloud_gpu_credit_usd": p.included_cloud_gpu_credit_usd,
            "free_inference_calls": p.free_inference_calls,
            "free_inference_period": p.free_inference_period,
            "new_customer_credit_usd": p.new_customer_credit_usd,
            "is_default": p.is_default,
            "included_compute_value_usd": getattr(p, "included_compute_value_usd", None),
        }

    usage = None
    if user_plan:
        usage = {
            "plan_name": user_plan.plan_name,
            "free_training_used_hours": round(user_plan.free_training_used_seconds / 3600, 2),
            "free_training_period_reset_at": (
                user_plan.free_training_period_reset_at.isoformat()
                if user_plan.free_training_period_reset_at else None
            ),
            "free_inference_used": user_plan.free_inference_used,
            "free_inference_period_reset_at": (
                user_plan.free_inference_period_reset_at.isoformat()
                if user_plan.free_inference_period_reset_at else None
            ),
            "new_customer_credit_given": user_plan.new_customer_credit_given,
            "new_customer_credit_amount": user_plan.new_customer_credit_amount,
        }

    return {
        "current_plan": _plan_dict(current_plan),
        "usage": usage,
        "wallet": wallet_data,
        "available_plans": [_plan_dict(p) for p in all_plans],
        "pricing": {
            "cpu_per_hour": pricing.local_cpu_price_per_hour,
            "gpu_per_hour": pricing.local_gpu_price_per_hour,
            "inference_per_call": pricing.inference_price_per_call,
        },
    }


class InitiatePlanUpgradeRequest(BaseModel):
    plan_id: str
    callback_url: str = ""


@router.post("/initiate-plan-upgrade")
async def initiate_plan_upgrade(body: InitiatePlanUpgradeRequest, authorization: Optional[str] = Header(None)):
    """
    For paid plans: initialize a Paystack payment.
    For free plans: switch immediately (no payment needed).
    Returns { free: true } for free plans, or { authorization_url, reference, proration } for paid.
    """
    token = _auth(authorization)
    from app.services import auth_service
    from app.services.ml_billing_service import get_user_plan, calculate_proration, list_plans
    from app.models.ml_plan import MLPlan
    from beanie import PydanticObjectId

    user = await auth_service.get_current_user(token)

    try:
        new_plan = await MLPlan.get(PydanticObjectId(body.plan_id))
    except Exception:
        new_plan = None
    if not new_plan or not new_plan.is_active:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Free plan — switch immediately
    if new_plan.price_usd_per_month == 0:
        from app.services.ml_billing_service import assign_plan_to_user
        user_plan = await assign_plan_to_user(user.email, user.org_id, body.plan_id)
        return {"free": True, "plan_name": user_plan.plan_name, "plan_id": user_plan.plan_id}

    # Paid plan — calculate proration and initiate Paystack
    current_user_plan = await get_user_plan(user.email, user.org_id)
    old_price = 0.0
    if current_user_plan and current_user_plan.plan_id:
        try:
            old_plan = await MLPlan.get(PydanticObjectId(current_user_plan.plan_id))
            old_price = old_plan.price_usd_per_month if old_plan else 0.0
        except Exception:
            pass

    proration = calculate_proration(old_price, new_plan.price_usd_per_month)
    amount_to_charge_usd = max(proration["net_usd"], 0.0)

    from app.core.config import settings
    amount_kes = round(amount_to_charge_usd * settings.USD_TO_KES_RATE * 100)  # kobo
    if amount_kes < 100:
        amount_kes = 100  # Paystack minimum (KES 1)

    import httpx
    payload = {
        "email": user.email,
        "amount": amount_kes,
        "currency": "KES",
        "metadata": {
            "plan_id": body.plan_id,
            "plan_name": new_plan.name,
            "org_id": user.org_id,
            "action": "plan_upgrade",
            "proration": proration,
        },
    }
    if body.callback_url:
        payload["callback_url"] = body.callback_url

    headers = {
        "Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post("https://api.paystack.co/transaction/initialize", json=payload, headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Payment gateway error — please try again")
    data = resp.json().get("data", {})

    return {
        "free": False,
        "authorization_url": data.get("authorization_url"),
        "reference": data.get("reference"),
        "access_code": data.get("access_code", ""),
        "amount_usd": amount_to_charge_usd,
        "amount_kes": amount_kes / 100,
        "proration": proration,
        "plan": {
            "id": str(new_plan.id),
            "name": new_plan.name,
            "price_usd_per_month": new_plan.price_usd_per_month,
        },
    }


class VerifyPlanUpgradeRequest(BaseModel):
    reference: str
    plan_id: str


@router.post("/verify-plan-upgrade")
async def verify_plan_upgrade(body: VerifyPlanUpgradeRequest, authorization: Optional[str] = Header(None)):
    """
    Verify a Paystack payment for a plan upgrade and activate the new plan.
    Also records proration credit in revenue ledger.
    """
    token = _auth(authorization)
    from app.services import auth_service
    from app.services.ml_billing_service import assign_plan_to_user, record_revenue, calculate_proration, get_user_plan
    from app.models.ml_plan import MLPlan
    from app.models.revenue_ledger import REV_PLAN_SUBSCRIPTION, REV_PRORATION_CREDIT
    from beanie import PydanticObjectId
    import httpx
    from app.core.config import settings

    user = await auth_service.get_current_user(token)

    # Verify with Paystack
    headers = {"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"https://api.paystack.co/transaction/verify/{body.reference}", headers=headers)
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Payment verification failed")
    pdata = resp.json()
    if not pdata.get("status") or pdata.get("data", {}).get("status") != "success":
        raise HTTPException(status_code=400, detail="Payment was not successful")

    tx_data = pdata["data"]
    amount_kes = tx_data.get("amount", 0) / 100
    amount_usd = round(amount_kes / settings.USD_TO_KES_RATE, 4)

    # Get old plan for proration credit recording
    old_price = 0.0
    current_user_plan = await get_user_plan(user.email, user.org_id)
    if current_user_plan and current_user_plan.plan_id:
        try:
            old_plan = await MLPlan.get(PydanticObjectId(current_user_plan.plan_id))
            old_price = old_plan.price_usd_per_month if old_plan else 0.0
        except Exception:
            pass

    try:
        new_plan = await MLPlan.get(PydanticObjectId(body.plan_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Plan not found")

    proration = calculate_proration(old_price, new_plan.price_usd_per_month)

    # Activate the plan
    user_plan = await assign_plan_to_user(user.email, user.org_id, body.plan_id)

    # Record revenue
    await record_revenue(
        type=REV_PLAN_SUBSCRIPTION,
        amount_usd=amount_usd,
        user_email=user.email,
        org_id=user.org_id,
        description=f"Plan upgrade: {new_plan.name} (prorated {proration['days_remaining']}/{proration['days_in_month']} days)",
        plan_id=str(new_plan.id),
        plan_name=new_plan.name,
        reference=body.reference,
        metadata={"proration": proration, "amount_kes": amount_kes},
    )

    # If old plan had remaining value, record as proration credit (negative revenue)
    if proration["credit_usd"] > 0 and old_price > 0:
        await record_revenue(
            type=REV_PRORATION_CREDIT,
            amount_usd=-proration["credit_usd"],
            user_email=user.email,
            org_id=user.org_id,
            description=f"Proration credit: {proration['days_remaining']} unused days on previous plan",
            reference=body.reference,
            metadata={"proration": proration},
        )

    return {
        "ok": True,
        "plan_name": user_plan.plan_name,
        "plan_id": user_plan.plan_id,
        "amount_charged_usd": amount_usd,
        "proration": proration,
    }


@router.get("/credit-log")
async def get_credit_log(authorization: Optional[str] = Header(None)):
    """Return the user's free credit and wallet transaction history."""
    token = _auth(authorization)
    from app.services import auth_service
    from app.models.wallet import WalletTransaction

    user = await auth_service.get_current_user(token)
    txns = await WalletTransaction.find(
        WalletTransaction.org_id == user.org_id
    ).sort(-WalletTransaction.created_at).limit(50).to_list()

    return {
        "transactions": [
            {
                "id": str(t.id),
                "type": t.type,
                "amount": float(t.amount),
                "standard_amount": float(t.standard_amount),
                "balance_after": float(t.balance_after),
                "description": t.description,
                "reference": t.reference,
                "job_id": t.job_id,
                "created_at": t.created_at.isoformat(),
            }
            for t in txns
        ]
    }


@router.get("/revenue")
async def get_revenue_summary(authorization: Optional[str] = Header(None)):
    """Admin-only — return revenue breakdown by type."""
    token = _auth(authorization)
    from app.services import auth_service
    user = await auth_service.get_current_user(token)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    from app.models.revenue_ledger import (
        RevenueLedger,
        REV_PLAN_SUBSCRIPTION, REV_WALLET_TOPUP,
        REV_GPU_STANDARD, REV_GPU_ACCELERATED,
        REV_INFERENCE_OPENAI, REV_INFERENCE_LOCAL,
        REV_FREE_CREDIT, REV_PRORATION_CREDIT,
    )

    all_entries = await RevenueLedger.find_all().to_list()
    total = sum(e.amount_usd for e in all_entries)

    breakdown: dict = {}
    for entry in all_entries:
        t = entry.type
        breakdown[t] = round(breakdown.get(t, 0.0) + entry.amount_usd, 4)

    # Last 30 entries for timeline
    recent = await RevenueLedger.find_all().sort(-RevenueLedger.created_at).limit(30).to_list()

    return {
        "total_usd": round(total, 2),
        "breakdown": breakdown,
        "labels": {
            REV_PLAN_SUBSCRIPTION: "Plan subscriptions",
            REV_WALLET_TOPUP: "Wallet top-ups",
            REV_GPU_STANDARD: "Standard GPU compute",
            REV_GPU_ACCELERATED: "Accelerated GPU compute",
            REV_INFERENCE_OPENAI: "Inference (OpenAI)",
            REV_INFERENCE_LOCAL: "Inference (Local LLM)",
            REV_FREE_CREDIT: "Free credits granted",
            REV_PRORATION_CREDIT: "Proration credits",
        },
        "recent": [
            {
                "id": str(e.id),
                "type": e.type,
                "amount_usd": e.amount_usd,
                "user_email": e.user_email,
                "plan_name": e.plan_name,
                "description": e.description,
                "reference": e.reference,
                "created_at": e.created_at.isoformat(),
            }
            for e in recent
        ],
    }
