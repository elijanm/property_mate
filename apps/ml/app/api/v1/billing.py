"""User-facing billing endpoints (non-admin)."""
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/my-plan")
async def get_my_plan(authorization: Optional[str] = Header(None)):
    """Return the current user's plan, usage, wallet balance, and available plans."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    from app.services import auth_service
    from app.services.ml_billing_service import get_user_plan, get_pricing_config, list_plans
    from app.models.wallet import Wallet

    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    # Current plan + usage
    user_plan = await get_user_plan(user.email, user.org_id)
    pricing = await get_pricing_config()
    all_plans = await list_plans(include_inactive=False)

    # Wallet balance
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

    # Resolve current plan details
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


class SwitchPlanRequest(BaseModel):
    plan_id: str


@router.post("/switch-plan")
async def switch_plan(body: SwitchPlanRequest, authorization: Optional[str] = Header(None)):
    """Self-service plan switch — any authenticated user can change their own plan."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    from app.services import auth_service
    from app.services.ml_billing_service import assign_plan_to_user

    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    try:
        user_plan = await assign_plan_to_user(user.email, user.org_id, body.plan_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "ok": True,
        "plan_name": user_plan.plan_name,
        "plan_id": user_plan.plan_id,
    }
