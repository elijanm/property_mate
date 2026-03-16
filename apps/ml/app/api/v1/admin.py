"""Super-admin analytics, email broadcast, pricing, and plan management API."""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from app.dependencies.auth import get_current_user, require_roles
from app.models.ml_user import MLUser
from app.models.training_job import TrainingJob
from app.models.model_deployment import ModelDeployment
from app.models.wallet import WalletTransaction
from app.models.inference_log import InferenceLog
from app.core.email import send_email
from app.core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

RequireAdmin = Depends(require_roles("admin"))


# ═══════════════════════════════════════════════════════════════
# PRICING CONFIG
# ═══════════════════════════════════════════════════════════════

class PricingConfigUpdateRequest(BaseModel):
    local_cpu_price_per_hour: Optional[float] = None   # e.g. 0.05
    local_cpu_free: Optional[bool] = None               # True = CPU training always free
    local_gpu_price_per_hour: Optional[float] = None   # e.g. 0.20
    local_gpu_free: Optional[bool] = None               # True = always free
    inference_price_per_call: Optional[float] = None   # e.g. 0.001
    inference_free: Optional[bool] = None               # True = always free


def _pricing_dict(cfg) -> dict:
    return {
        "local_cpu_price_per_hour": cfg.local_cpu_price_per_hour,
        "local_cpu_free": cfg.local_cpu_free,
        "local_gpu_price_per_hour": cfg.local_gpu_price_per_hour,
        "local_gpu_free": cfg.local_gpu_free,
        "inference_price_per_call": cfg.inference_price_per_call,
        "inference_free": cfg.inference_free,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
    }


@router.get("/pricing", dependencies=[RequireAdmin])
async def get_pricing(_=Depends(get_current_user)):
    """Return current global ML pricing configuration."""
    from app.services.ml_billing_service import get_pricing_config
    cfg = await get_pricing_config()
    return _pricing_dict(cfg)


@router.put("/pricing", dependencies=[RequireAdmin])
async def update_pricing(body: PricingConfigUpdateRequest, _=Depends(get_current_user)):
    """Update global ML pricing configuration."""
    from app.services.ml_billing_service import update_pricing_config
    cfg = await update_pricing_config(**body.model_dump(exclude_none=True))
    return _pricing_dict(cfg)


# ═══════════════════════════════════════════════════════════════
# PLANS
# ═══════════════════════════════════════════════════════════════

class PlanCreateRequest(BaseModel):
    name: str
    description: str = ""
    price_usd_per_month: float = 0.0
    included_period: str = "month"
    included_cpu_hours: float = 0.0
    included_local_gpu_hours: float = 0.0
    included_cloud_gpu_credit_usd: float = 0.0
    free_inference_calls: int = 0
    free_inference_period: str = "month"
    new_customer_credit_usd: float = 0.0
    is_default: bool = False


class PlanUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_usd_per_month: Optional[float] = None
    included_period: Optional[str] = None
    included_cpu_hours: Optional[float] = None
    included_local_gpu_hours: Optional[float] = None
    included_cloud_gpu_credit_usd: Optional[float] = None
    free_inference_calls: Optional[int] = None
    free_inference_period: Optional[str] = None
    new_customer_credit_usd: Optional[float] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


def _plan_dict(plan) -> dict:
    # Normalise: prefer new canonical fields, fall back to legacy fields
    cpu_hrs = getattr(plan, "included_cpu_hours", None)
    if cpu_hrs is None:
        cpu_hrs = getattr(plan, "free_training_hours", 0.0)
    gpu_hrs = getattr(plan, "included_local_gpu_hours", None)
    if gpu_hrs is None:
        gpu_hrs = getattr(plan, "free_local_gpu_hours", 0.0)
    period = getattr(plan, "included_period", None) or getattr(plan, "free_training_period", "month")
    cloud_credit = getattr(plan, "included_cloud_gpu_credit_usd", 0.0)
    return {
        "id": str(plan.id),
        "name": plan.name,
        "description": plan.description,
        "price_usd_per_month": plan.price_usd_per_month,
        "included_period": period,
        "included_cpu_hours": cpu_hrs,
        "included_local_gpu_hours": gpu_hrs,
        "included_cloud_gpu_credit_usd": cloud_credit,
        "free_inference_calls": plan.free_inference_calls,
        "free_inference_period": plan.free_inference_period,
        "new_customer_credit_usd": plan.new_customer_credit_usd,
        "is_active": plan.is_active,
        "is_default": plan.is_default,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
    }


@router.get("/plans", dependencies=[RequireAdmin])
async def list_plans(
    include_inactive: bool = Query(False),
    _=Depends(get_current_user),
):
    """List all billing plans."""
    from app.services.ml_billing_service import list_plans
    plans = await list_plans(include_inactive=include_inactive)
    return {"plans": [_plan_dict(p) for p in plans]}


@router.post("/plans", dependencies=[RequireAdmin])
async def create_plan(body: PlanCreateRequest, _=Depends(get_current_user)):
    """Create a new billing plan."""
    from app.models.ml_plan import MLPlan
    from app.utils.datetime import utc_now

    if body.free_training_period not in ("day", "week", "month", "none"):
        raise HTTPException(status_code=400, detail="free_training_period must be 'day', 'week', 'month', or 'none'")
    if body.free_inference_period not in ("day", "week", "month", "none"):
        raise HTTPException(status_code=400, detail="free_inference_period must be 'day', 'week', 'month', or 'none'")

    # Only one default plan at a time
    if body.is_default:
        await MLPlan.find(MLPlan.is_default == True).update({"$set": {"is_default": False}})  # noqa: E712

    plan = MLPlan(**body.model_dump())
    await plan.insert()
    return _plan_dict(plan)


@router.put("/plans/{plan_id}", dependencies=[RequireAdmin])
async def update_plan(plan_id: str, body: PlanUpdateRequest, _=Depends(get_current_user)):
    """Update a billing plan."""
    from app.models.ml_plan import MLPlan
    from beanie import PydanticObjectId
    from app.utils.datetime import utc_now

    try:
        plan = await MLPlan.get(PydanticObjectId(plan_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return _plan_dict(plan)

    if updates.get("free_training_period") and updates["free_training_period"] not in ("day", "week", "month", "none"):
        raise HTTPException(status_code=400, detail="free_training_period must be 'day', 'week', 'month', or 'none'")
    if updates.get("free_inference_period") and updates["free_inference_period"] not in ("day", "week", "month", "none"):
        raise HTTPException(status_code=400, detail="free_inference_period must be 'day', 'week', 'month', or 'none'")

    if updates.get("is_default"):
        await MLPlan.find(MLPlan.is_default == True).update({"$set": {"is_default": False}})  # noqa: E712

    updates["updated_at"] = utc_now()
    await plan.set(updates)
    return _plan_dict(plan)


@router.post("/plans/seed", dependencies=[RequireAdmin])
async def seed_plans(_=Depends(get_current_user)):
    """
    Seed 3 profitability-optimised plans based on current pricing config.
    CPU, local GPU, and cloud GPU credits are all paid — no free CPU tier.
    Margins are calculated live from the current pricing config.
    Skips any plan whose name already exists.
    """
    from app.models.ml_plan import MLPlan
    from app.services.ml_billing_service import get_pricing_config

    cfg = await get_pricing_config()
    cpu_rate = cfg.local_cpu_price_per_hour        # e.g. 0.05
    gpu_rate = cfg.local_gpu_price_per_hour        # e.g. 0.20
    inf_rate = cfg.inference_price_per_call        # e.g. 0.001

    # ── Compute cost of each plan's included compute ───────────────────────────
    # Starter  ($0): acquisition tier — $5 credit one-time, 500 inference calls
    #   cost = $5 (credit) + 500×inf_rate = $5 + $0.50 = ~$5.50 one-time; no recurring cost
    # Developer ($19): 30h CPU + 10h GPU + $2 cloud credit + 2000 calls
    #   cost = 30×cpu_rate + 10×gpu_rate + $2 + 2000×inf_rate
    # Pro ($79): 100h CPU + 40h GPU + $8 cloud credit + 10000 calls
    #   cost = 100×cpu_rate + 40×gpu_rate + $8 + 10000×inf_rate

    dev_cost  = round(30*cpu_rate + 10*gpu_rate + 2.0 + 2000*inf_rate, 2)
    pro_cost  = round(100*cpu_rate + 40*gpu_rate + 8.0 + 10000*inf_rate, 2)
    dev_margin  = round((19.0 - dev_cost) / 19.0 * 100, 1)
    pro_margin  = round((79.0 - pro_cost) / 79.0 * 100, 1)

    SEED_PLANS = [
        {
            "name": "Starter",
            "description": (
                f"Pay-as-you-go. No monthly fee — just pre-fund your wallet and pay for what you use. "
                f"CPU from ${cpu_rate}/hr, local GPU from ${gpu_rate}/hr. "
                f"$5 welcome credit to get you started."
            ),
            "price_usd_per_month": 0.0,
            "included_period": "month",
            "included_cpu_hours": 0.0,
            "included_local_gpu_hours": 0.0,
            "included_cloud_gpu_credit_usd": 0.0,
            "free_inference_calls": 500,
            "free_inference_period": "month",
            "new_customer_credit_usd": 5.0,
            "is_default": True,
        },
        {
            "name": "Developer",
            "description": (
                f"30 CPU hrs + 10 local GPU hrs + $2 cloud GPU credit every month. "
                f"Included compute value: ~${dev_cost}. Monthly fee: $19 (~{dev_margin}% margin)."
            ),
            "price_usd_per_month": 19.0,
            "included_period": "month",
            "included_cpu_hours": 30.0,
            "included_local_gpu_hours": 10.0,
            "included_cloud_gpu_credit_usd": 2.0,
            "free_inference_calls": 2000,
            "free_inference_period": "month",
            "new_customer_credit_usd": 10.0,
            "is_default": False,
        },
        {
            "name": "Pro",
            "description": (
                f"100 CPU hrs + 40 local GPU hrs + $8 cloud GPU credit every month. "
                f"Included compute value: ~${pro_cost}. Monthly fee: $79 (~{pro_margin}% margin)."
            ),
            "price_usd_per_month": 79.0,
            "included_period": "month",
            "included_cpu_hours": 100.0,
            "included_local_gpu_hours": 40.0,
            "included_cloud_gpu_credit_usd": 8.0,
            "free_inference_calls": 10000,
            "free_inference_period": "month",
            "new_customer_credit_usd": 25.0,
            "is_default": False,
        },
    ]

    existing_names = {p.name for p in await MLPlan.find_all().to_list()}

    if "Starter" not in existing_names:
        await MLPlan.find(MLPlan.is_default == True).update({"$set": {"is_default": False}})  # noqa: E712

    created = []
    for seed in SEED_PLANS:
        if seed["name"] in existing_names:
            continue
        plan = MLPlan(**seed)
        await plan.insert()
        created.append(seed["name"])

    return {
        "created": created,
        "skipped": [s["name"] for s in SEED_PLANS if s["name"] in existing_names],
        "margins": {"Developer": f"{dev_margin}%", "Pro": f"{pro_margin}%"},
        "rates_used": {"cpu": cpu_rate, "gpu": gpu_rate, "inference": inf_rate},
    }


@router.delete("/plans/{plan_id}", dependencies=[RequireAdmin])
async def delete_plan(plan_id: str, _=Depends(get_current_user)):
    """Deactivate a plan (soft-delete — existing user plans are unaffected)."""
    from app.models.ml_plan import MLPlan
    from beanie import PydanticObjectId
    from app.utils.datetime import utc_now

    try:
        plan = await MLPlan.get(PydanticObjectId(plan_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    await plan.set({"is_active": False, "is_default": False, "updated_at": utc_now()})
    return {"deactivated": True}


# ═══════════════════════════════════════════════════════════════
# USER PLAN ASSIGNMENT
# ═══════════════════════════════════════════════════════════════

class AssignPlanRequest(BaseModel):
    user_email: str
    org_id: str = ""


@router.post("/plans/{plan_id}/assign", dependencies=[RequireAdmin])
async def assign_plan(plan_id: str, body: AssignPlanRequest, _=Depends(get_current_user)):
    """Assign a plan to a user. Replaces their current plan and resets period counters."""
    from app.services.ml_billing_service import assign_plan_to_user
    try:
        user_plan = await assign_plan_to_user(body.user_email, body.org_id, plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _user_plan_dict(user_plan)


@router.get("/users/{user_email}/plan", dependencies=[RequireAdmin])
async def get_user_plan_info(user_email: str, org_id: str = Query(""), _=Depends(get_current_user)):
    """Get a user's current plan assignment and usage."""
    from app.services.ml_billing_service import get_user_plan, get_pricing_config
    from app.models.ml_plan import MLPlan
    from beanie import PydanticObjectId

    user_plan = await get_user_plan(user_email, org_id)
    if not user_plan:
        cfg = await get_pricing_config()
        return {
            "user_email": user_email,
            "plan": None,
            "pricing": {
                "local_gpu_price_per_hour": cfg.local_gpu_price_per_hour,
                "local_gpu_free": cfg.local_gpu_free,
                "inference_price_per_call": cfg.inference_price_per_call,
                "inference_free": cfg.inference_free,
            },
        }

    plan = None
    if user_plan.plan_id:
        try:
            plan = await MLPlan.get(PydanticObjectId(user_plan.plan_id))
        except Exception:
            pass

    return {
        "user_email": user_email,
        "plan": _plan_dict(plan) if plan else None,
        "usage": _user_plan_dict(user_plan),
    }


class SetExemptRequest(BaseModel):
    org_id: str = ""
    local_gpu_exempt: bool


@router.patch("/users/{user_email}/exempt", dependencies=[RequireAdmin])
async def set_user_exempt(user_email: str, body: SetExemptRequest, _=Depends(get_current_user)):
    """Set or clear a user's local GPU training exemption."""
    from app.services.ml_billing_service import get_user_plan
    from app.utils.datetime import utc_now

    user_plan = await get_user_plan(user_email, body.org_id)
    if not user_plan:
        raise HTTPException(status_code=404, detail="User has no plan record. Assign a plan first.")
    await user_plan.set({"local_gpu_exempt": body.local_gpu_exempt, "updated_at": utc_now()})
    return _user_plan_dict(user_plan)


def _user_plan_dict(up) -> dict:
    return {
        "id": str(up.id),
        "user_email": up.user_email,
        "org_id": up.org_id,
        "plan_id": up.plan_id,
        "plan_name": up.plan_name,
        "local_gpu_exempt": getattr(up, "local_gpu_exempt", False),
        "free_training_used_seconds": up.free_training_used_seconds,
        "free_training_used_hours": round(up.free_training_used_seconds / 3600, 3),
        "free_training_period_reset_at": up.free_training_period_reset_at.isoformat() if up.free_training_period_reset_at else None,
        "free_inference_used": up.free_inference_used,
        "free_inference_period_reset_at": up.free_inference_period_reset_at.isoformat() if up.free_inference_period_reset_at else None,
        "new_customer_credit_given": up.new_customer_credit_given,
        "new_customer_credit_amount": up.new_customer_credit_amount,
        "assigned_at": up.assigned_at.isoformat() if up.assigned_at else None,
    }


# ═══════════════════════════════════════════════════════════════
# PUBLIC PRICING (no auth — used by landing page)
# ═══════════════════════════════════════════════════════════════

@router.get("/public/pricing")
async def public_pricing():
    """Return current pricing + active plans for the public landing page. No auth required."""
    from app.services.ml_billing_service import get_pricing_config
    from app.models.ml_plan import MLPlan

    cfg = await get_pricing_config()
    plans = await MLPlan.find(MLPlan.is_active == True).sort("+price_usd_per_month").to_list()  # noqa: E712

    # Annotate each plan with computed included compute value (so UI can show "value: $X")
    cpu_rate = cfg.local_cpu_price_per_hour
    gpu_rate = cfg.local_gpu_price_per_hour
    inf_rate = cfg.inference_price_per_call

    enriched = []
    for p in plans:
        d = _plan_dict(p)
        included_value = round(
            d["included_cpu_hours"] * cpu_rate
            + d["included_local_gpu_hours"] * gpu_rate
            + d["included_cloud_gpu_credit_usd"]
            + d["free_inference_calls"] * inf_rate,
            2,
        )
        d["included_compute_value_usd"] = included_value
        enriched.append(d)

    return {
        "pricing": {
            "local_cpu_price_per_hour": cfg.local_cpu_price_per_hour,
            "local_gpu_price_per_hour": cfg.local_gpu_price_per_hour,
            "inference_price_per_call": cfg.inference_price_per_call,
            "cloud_gpu_min_price_per_hour": 0.28,  # lowest available RunPod tier
        },
        "plans": enriched,
    }


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure datetime is timezone-aware UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/analytics", dependencies=[RequireAdmin])
async def get_analytics(
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    _user=Depends(get_current_user),
):
    from_dt = _utc(from_date)
    to_dt = _utc(to_date)

    date_filter: dict = {}
    if from_dt:
        date_filter["$gte"] = from_dt
    if to_dt:
        date_filter["$lte"] = to_dt

    # ── Users ──────────────────────────────────────────────────────────
    user_filter = {}
    if date_filter:
        user_filter["created_at"] = date_filter

    total_users = await MLUser.find(user_filter).count()
    admin_users = await MLUser.find({**user_filter, "role": "admin"}).count()
    engineer_users = await MLUser.find({**user_filter, "role": "engineer"}).count()
    viewer_users = await MLUser.find({**user_filter, "role": "viewer"}).count()
    active_users = await MLUser.find({**user_filter, "is_active": True}).count()
    verified_users = await MLUser.find({**user_filter, "is_verified": True}).count()

    # ── Training Jobs ──────────────────────────────────────────────────
    job_filter: dict = {}
    if date_filter:
        job_filter["created_at"] = date_filter

    total_jobs = await TrainingJob.find(job_filter).count()
    running_jobs = await TrainingJob.find({**job_filter, "status": "running"}).count()
    completed_jobs = await TrainingJob.find({**job_filter, "status": "completed"}).count()
    failed_jobs = await TrainingJob.find({**job_filter, "status": "failed"}).count()
    queued_jobs = await TrainingJob.find({**job_filter, "status": "queued"}).count()
    local_jobs = await TrainingJob.find({**job_filter, "compute_type": "local"}).count()
    cloud_jobs = await TrainingJob.find({**job_filter, "compute_type": "cloud_gpu"}).count()

    # GPU hours — sum wallet_charged for cloud jobs
    cloud_jobs_docs = await TrainingJob.find(
        {**job_filter, "compute_type": "cloud_gpu", "wallet_charged": {"$gt": 0}}
    ).to_list()
    total_gpu_revenue = sum(j.wallet_charged for j in cloud_jobs_docs)

    # Approximate GPU hours from charged amount (avg $0.476/hr as baseline)
    AVG_GPU_RATE = 0.476
    gpu_hours_estimate = total_gpu_revenue / AVG_GPU_RATE if AVG_GPU_RATE > 0 else 0.0

    # Local CPU hours — sum local_used_seconds across all wallets for period
    # We use WalletTransaction debits tagged with local quota description as proxy
    local_hour_txns = await WalletTransaction.find(
        {"description": {"$regex": "local.*hour", "$options": "i"},
         **({"created_at": date_filter} if date_filter else {})}
    ).to_list()
    local_hours_purchased = sum(abs(t.amount) / 0.50 for t in local_hour_txns)

    # ── Revenue ────────────────────────────────────────────────────────
    txn_filter: dict = {"type": "credit"}
    if date_filter:
        txn_filter["created_at"] = date_filter

    credit_txns = await WalletTransaction.find(txn_filter).to_list()
    total_topup_revenue = sum(t.amount for t in credit_txns)

    # Breakdown: GPU charges
    gpu_charge_filter: dict = {"type": "debit", "description": {"$regex": "gpu|cloud|job", "$options": "i"}}
    if date_filter:
        gpu_charge_filter["created_at"] = date_filter
    gpu_txns = await WalletTransaction.find(gpu_charge_filter).to_list()
    total_gpu_charges = sum(abs(t.amount) for t in gpu_txns)

    # ── Models ─────────────────────────────────────────────────────────
    model_filter: dict = {}
    if date_filter:
        model_filter["deployed_at"] = date_filter

    total_models = await ModelDeployment.find(model_filter).count()
    active_models = await ModelDeployment.find({**model_filter, "status": "active"}).count()

    # ── Inferences ─────────────────────────────────────────────────────
    inf_filter: dict = {}
    if date_filter:
        inf_filter["created_at"] = date_filter

    total_inferences = await InferenceLog.find(inf_filter).count()
    error_inferences = await InferenceLog.find({**inf_filter, "error": {"$ne": None}}).count()

    # Avg latency
    latency_docs = await InferenceLog.find(
        {**inf_filter, "latency_ms": {"$ne": None}}
    ).to_list()
    avg_latency = (
        sum(d.latency_ms for d in latency_docs if d.latency_ms) / len(latency_docs)
        if latency_docs else 0.0
    )

    # ── Top trainers by job count ───────────────────────────────────────
    all_jobs = await TrainingJob.find(job_filter).to_list()
    trainer_counts: dict[str, int] = {}
    for j in all_jobs:
        trainer_counts[j.trainer_name] = trainer_counts.get(j.trainer_name, 0) + 1
    top_trainers = sorted(trainer_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "period": {
            "from": from_dt.isoformat() if from_dt else None,
            "to": to_dt.isoformat() if to_dt else None,
        },
        "users": {
            "total": total_users,
            "active": active_users,
            "verified": verified_users,
            "by_role": {"admin": admin_users, "engineer": engineer_users, "viewer": viewer_users},
        },
        "training": {
            "total_jobs": total_jobs,
            "running": running_jobs,
            "queued": queued_jobs,
            "completed": completed_jobs,
            "failed": failed_jobs,
            "local_jobs": local_jobs,
            "cloud_jobs": cloud_jobs,
            "gpu_hours_estimate": round(gpu_hours_estimate, 2),
            "local_hours_purchased": round(local_hours_purchased, 2),
        },
        "revenue": {
            "total_topups_usd": round(total_topup_revenue, 2),
            "gpu_charges_usd": round(total_gpu_charges, 2),
            "gpu_revenue_usd": round(total_gpu_revenue, 2),
        },
        "models": {
            "total": total_models,
            "active": active_models,
        },
        "inference": {
            "total": total_inferences,
            "errors": error_inferences,
            "error_rate_pct": round(error_inferences / total_inferences * 100, 1) if total_inferences else 0.0,
            "avg_latency_ms": round(avg_latency, 1),
        },
        "top_trainers": [{"name": name, "jobs": count} for name, count in top_trainers],
    }


# ── Email broadcast ────────────────────────────────────────────────────────────

class BroadcastRequest(BaseModel):
    subject: str
    html: str
    recipient_filter: str = "all"   # "all" | "active" | "verified" | "engineers"
    preview_to: Optional[str] = None  # send preview to a single address only
    raw: bool = False  # if True, html is a full standalone template — skip _marketing_html wrapper


def _marketing_html(body_html: str) -> str:
    """Wrap body in the standard MLDock marketing shell."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body {{ margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }}
    .wrapper {{ width:100%;background:#0a0a0a;padding:32px 16px;box-sizing:border-box; }}
    .inner {{ max-width:560px;margin:0 auto;width:100%; }}
    .logo {{ text-align:center;padding-bottom:24px; }}
    .card {{ background:#111111;border:1px solid #1f2937;border-radius:16px;padding:32px;box-sizing:border-box;width:100%; }}
    .footer {{ margin-top:28px;padding-top:20px;border-top:1px solid #1f2937;text-align:center; }}
    @media only screen and (max-width:480px) {{
      .wrapper {{ padding:16px 12px; }}
      .card {{ padding:20px 16px;border-radius:12px; }}
    }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="inner">
      <div class="logo">
        <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">MLDock<span style="color:#38bdf8;">.io</span></span>
      </div>
      <div class="card">
        {body_html}
        <div class="footer">
          <p style="margin:0;font-size:11px;color:#4b5563;line-height:1.6;">
            You're receiving this because you have an account on MLDock.io.<br>
            <a href="{settings.APP_BASE_URL}" style="color:#6b7280;text-decoration:none;">mldock.io</a>
            &nbsp;·&nbsp; Kreateyou Technologies Ltd, Kenya
          </p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>"""


@router.post("/broadcast", dependencies=[RequireAdmin])
async def broadcast_email(
    body: BroadcastRequest,
    _user=Depends(get_current_user),
):
    """Send a broadcast email to platform users. Use preview_to to test before a real send."""
    if body.raw:
        wrapped_html = f'<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;">{body.html}</body></html>'
    else:
        wrapped_html = _marketing_html(body.html)

    # Preview mode — single recipient, no DB query
    if body.preview_to:
        await send_email(body.preview_to, f"[PREVIEW] {body.subject}", wrapped_html)
        return {"sent": 1, "skipped": 0, "preview": True}

    # Build recipient list
    filters: dict = {"is_active": True, "is_verified": True}
    if body.recipient_filter == "engineers":
        filters["role"] = {"$in": ["engineer", "admin"]}

    users: List[MLUser] = await MLUser.find(filters).to_list()
    if not users:
        raise HTTPException(status_code=400, detail="No recipients matched the filter")

    sent = 0
    skipped = 0
    for u in users:
        try:
            await send_email(u.email, body.subject, wrapped_html)
            sent += 1
        except Exception:
            skipped += 1

    return {"sent": sent, "skipped": skipped, "preview": False}


# ═══════════════════════════════════════════════════════════════
# USAGE TRACKER
# ═══════════════════════════════════════════════════════════════

def _period_start(reset_at: Optional[datetime], period: str) -> Optional[datetime]:
    """Compute the start of the current period from the next reset date."""
    if not reset_at:
        return None
    reset = reset_at.replace(tzinfo=None) if reset_at.tzinfo else reset_at
    if period == "month":
        # Go back one month
        month = reset.month - 1 or 12
        year = reset.year - (1 if reset.month == 1 else 0)
        day = min(reset.day, [31,28+int(year%4==0),31,30,31,30,31,31,30,31,30,31][month-1])
        return reset.replace(year=year, month=month, day=day)
    elif period == "week":
        return reset - timedelta(weeks=1)
    elif period == "day":
        return reset - timedelta(days=1)
    return None


def _compute_latency_stats(latency_values: list[float]) -> dict:
    """Return avg and p95 latency from a list of ms values."""
    if not latency_values:
        return {}
    s = sorted(latency_values)
    avg = sum(s) / len(s)
    p95_idx = max(0, int(len(s) * 0.95) - 1)
    return {"avg": avg, "p95": s[p95_idx]}


async def _build_user_usage(user: MLUser, user_plan, plan, now_naive: datetime,
                             cloud_charges_by_org: dict, model_counts_by_org: dict,
                             inf_counts_by_org: dict,
                             inf_cost_by_org: dict | None = None,
                             dataset_counts_by_org: dict | None = None,
                             storage_bytes_by_org: dict | None = None,
                             inf_latency_by_org: dict | None = None,
                             inf_last_called_by_org: dict | None = None) -> dict:
    """Build a single user's usage summary dict."""
    # ── Local compute (CPU + local GPU combined) ────────────────────────────
    used_seconds = user_plan.free_training_used_seconds if user_plan else 0.0
    used_hours = round(used_seconds / 3600, 3)
    cpu_hrs = (getattr(plan, "included_cpu_hours", 0.0) or 0.0) if plan else 0.0
    gpu_hrs = (getattr(plan, "included_local_gpu_hours", 0.0) or 0.0) if plan else 0.0
    limit_hours = cpu_hrs + gpu_hrs
    training_period = (getattr(plan, "included_period", "month") or "month") if plan else "month"
    training_reset_at = (
        user_plan.free_training_period_reset_at.isoformat()
        if user_plan and user_plan.free_training_period_reset_at else None
    )

    # ── Cloud GPU credit ────────────────────────────────────────────────────
    cloud_used = round(cloud_charges_by_org.get(user.org_id or "", 0.0), 4)
    cloud_limit = (getattr(plan, "included_cloud_gpu_credit_usd", 0.0) or 0.0) if plan else 0.0

    # ── Inference calls (plan-period free quota) ────────────────────────────
    inf_used_quota = user_plan.free_inference_used if user_plan else 0
    inf_limit = (plan.free_inference_calls if plan else 0)
    inf_period = (plan.free_inference_period if plan else "month") if plan else "month"
    inf_reset_at = (
        user_plan.free_inference_period_reset_at.isoformat()
        if user_plan and user_plan.free_inference_period_reset_at else None
    )

    # ── Cumulative inferences this calendar month ───────────────────────────
    month_start = now_naive.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    org_key = user.org_id or ""
    inf_month_total = inf_counts_by_org.get(org_key, 0)
    inf_month_cost = round((inf_cost_by_org or {}).get(org_key, 0.0), 4)

    # ── Latency stats ────────────────────────────────────────────────────────
    latency_stats = (inf_latency_by_org or {}).get(org_key, {})
    avg_latency_ms = latency_stats.get("avg")
    p95_latency_ms = latency_stats.get("p95")
    last_called_at = (inf_last_called_by_org or {}).get(org_key)

    # ── Storage ─────────────────────────────────────────────────────────────
    model_count = model_counts_by_org.get(org_key, 0)
    dataset_count = (dataset_counts_by_org or {}).get(org_key, 0)
    storage_bytes = (storage_bytes_by_org or {}).get(org_key, 0)

    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "plan_name": (user_plan.plan_name if user_plan else None),
        "local_compute": {
            "used_hours": used_hours,
            "limit_hours": limit_hours,
            "pct": round(used_hours / limit_hours * 100, 1) if limit_hours > 0 else 0.0,
            "period": training_period,
            "reset_at": training_reset_at,
        },
        "cloud_gpu": {
            "used_usd": cloud_used,
            "limit_usd": cloud_limit,
            "pct": round(cloud_used / cloud_limit * 100, 1) if cloud_limit > 0 else 0.0,
            "reset_at": training_reset_at,
        },
        "inference": {
            "quota_used": inf_used_quota,
            "quota_limit": inf_limit,
            "quota_pct": round(inf_used_quota / inf_limit * 100, 1) if inf_limit > 0 else 0.0,
            "period": inf_period,
            "reset_at": inf_reset_at,
            "month_total": inf_month_total,
            "month_cost_usd": inf_month_cost,
            "avg_latency_ms": round(avg_latency_ms, 1) if avg_latency_ms is not None else None,
            "p95_latency_ms": round(p95_latency_ms, 1) if p95_latency_ms is not None else None,
            "last_called_at": last_called_at,
        },
        "storage": {
            "model_count": model_count,
            "dataset_count": dataset_count,
            "storage_bytes": storage_bytes,
        },
    }


@router.get("/usage", dependencies=[RequireAdmin])
async def get_all_user_usage(_user=Depends(get_current_user)):
    """Return per-user usage summary for all users (admin only)."""
    from app.models.ml_plan import MLUserPlan, MLPlan
    from beanie import PydanticObjectId

    now_naive = datetime.utcnow()
    month_start = now_naive.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Bulk-load users
    users = await MLUser.find({"is_active": True}).sort("email").to_list()

    # Bulk-load user plans (keyed by user_email)
    user_plans: dict[str, MLUserPlan] = {}
    for up in await MLUserPlan.find_all().to_list():
        user_plans[up.user_email] = up

    # Bulk-load distinct plans
    plan_ids = {up.plan_id for up in user_plans.values() if up.plan_id}
    plans: dict[str, MLPlan] = {}
    for pid in plan_ids:
        try:
            p = await MLPlan.get(PydanticObjectId(pid))
            if p:
                plans[str(p.id)] = p
        except Exception:
            pass

    # Cloud GPU charges per org in current training period
    cloud_jobs = await TrainingJob.find(
        {"compute_type": "cloud_gpu", "wallet_charged": {"$gt": 0}}
    ).to_list()
    cloud_charges_by_org: dict[str, float] = {}
    for j in cloud_jobs:
        org = getattr(j, "org_id", "") or ""
        cloud_charges_by_org[org] = cloud_charges_by_org.get(org, 0.0) + j.wallet_charged

    # Model count per org
    model_counts_by_org: dict[str, int] = {}
    for dep in await ModelDeployment.find_all().to_list():
        org = getattr(dep, "org_id", "") or ""
        model_counts_by_org[org] = model_counts_by_org.get(org, 0) + 1

    # Cumulative inference calls + cost this calendar month
    month_start_aware = month_start.replace(tzinfo=timezone.utc)
    inf_logs = await InferenceLog.find({"created_at": {"$gte": month_start_aware}}).to_list()
    inf_counts_by_org: dict[str, int] = {}
    inf_cost_by_org: dict[str, float] = {}
    inf_latencies_by_org: dict[str, list[float]] = {}
    inf_last_called_by_org: dict[str, str] = {}
    for log in inf_logs:
        org = getattr(log, "org_id", "") or ""
        inf_counts_by_org[org] = inf_counts_by_org.get(org, 0) + 1
        inf_cost_by_org[org] = inf_cost_by_org.get(org, 0.0) + (log.cost_usd or 0.0)
        if log.latency_ms is not None:
            inf_latencies_by_org.setdefault(org, []).append(log.latency_ms)
        ts = log.created_at.isoformat() if log.created_at else None
        if ts and ts > inf_last_called_by_org.get(org, ""):
            inf_last_called_by_org[org] = ts
    inf_latency_by_org = {org: _compute_latency_stats(lats) for org, lats in inf_latencies_by_org.items()}

    # Dataset entry count + storage bytes per org
    from app.models.dataset import DatasetEntry
    dataset_counts_by_org: dict[str, int] = {}
    storage_bytes_by_org: dict[str, int] = {}
    for entry in await DatasetEntry.find_all().to_list():
        org = getattr(entry, "org_id", "") or ""
        dataset_counts_by_org[org] = dataset_counts_by_org.get(org, 0) + 1
        storage_bytes_by_org[org] = storage_bytes_by_org.get(org, 0) + (entry.file_size_bytes or 0)

    # Model storage bytes per org
    for dep in await ModelDeployment.find_all().to_list():
        org = getattr(dep, "org_id", "") or ""
        storage_bytes_by_org[org] = storage_bytes_by_org.get(org, 0) + (getattr(dep, "model_size_bytes", None) or 0)

    results = []
    for u in users:
        up = user_plans.get(u.email)
        plan = plans.get(up.plan_id) if up and up.plan_id else None
        row = await _build_user_usage(u, up, plan, now_naive,
                                      cloud_charges_by_org, model_counts_by_org, inf_counts_by_org,
                                      inf_cost_by_org, dataset_counts_by_org, storage_bytes_by_org,
                                      inf_latency_by_org, inf_last_called_by_org)
        results.append(row)

    return {"users": results, "total": len(results), "month_start": month_start.isoformat()}


@router.get("/usage/me", dependencies=[Depends(get_current_user)])
async def get_my_usage(current_user=Depends(get_current_user)):
    """Return the current authenticated user's own usage summary."""
    from app.models.ml_plan import MLUserPlan, MLPlan
    from beanie import PydanticObjectId

    now_naive = datetime.utcnow()
    month_start = now_naive.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start_aware = month_start.replace(tzinfo=timezone.utc)

    user = await MLUser.find_one({"email": current_user.email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    up = await MLUserPlan.find_one({"user_email": current_user.email})
    plan = None
    if up and up.plan_id:
        try:
            plan = await MLPlan.get(PydanticObjectId(up.plan_id))
        except Exception:
            pass

    # Cloud GPU charges (this user's org)
    org = user.org_id or ""
    cloud_jobs = await TrainingJob.find(
        {"compute_type": "cloud_gpu", "wallet_charged": {"$gt": 0},
         **({"org_id": org} if org else {})}
    ).to_list()
    cloud_charges_by_org = {org: sum(j.wallet_charged for j in cloud_jobs)}

    # Model count
    model_deps = await ModelDeployment.find(
        {"org_id": org} if org else {}
    ).to_list()
    model_counts_by_org = {org: len(model_deps)}

    # Cumulative inferences this month + cost
    inf_filter: dict = {"created_at": {"$gte": month_start_aware}}
    if org:
        inf_filter["org_id"] = org
    inf_logs = await InferenceLog.find(inf_filter).to_list()
    inf_counts_by_org = {org: len(inf_logs)}
    inf_cost_by_org = {org: sum(log.cost_usd or 0.0 for log in inf_logs)}
    lats = [log.latency_ms for log in inf_logs if log.latency_ms is not None]
    inf_latency_by_org = {org: _compute_latency_stats(lats)}
    last_ts = max((log.created_at.isoformat() for log in inf_logs if log.created_at), default=None)
    inf_last_called_by_org = {org: last_ts} if last_ts else {}

    # Dataset entries + storage bytes
    from app.models.dataset import DatasetEntry
    ds_filter: dict = {}
    if org:
        ds_filter["org_id"] = org
    entries = await DatasetEntry.find(ds_filter).to_list()
    dataset_counts_by_org = {org: len(entries)}
    storage_bytes_by_org = {org: sum(e.file_size_bytes or 0 for e in entries)}
    for dep in model_deps:
        storage_bytes_by_org[org] = storage_bytes_by_org.get(org, 0) + (getattr(dep, "model_size_bytes", None) or 0)

    row = await _build_user_usage(user, up, plan, now_naive,
                                  cloud_charges_by_org, model_counts_by_org, inf_counts_by_org,
                                  inf_cost_by_org, dataset_counts_by_org, storage_bytes_by_org,
                                  inf_latency_by_org, inf_last_called_by_org)
    return {**row, "month_start": month_start.isoformat()}


@router.post("/backfill/model-sizes", dependencies=[RequireAdmin])
async def backfill_model_sizes():
    """One-shot: populate model_size_bytes on existing ModelDeployment records that have it unset."""
    from app.models.model_deployment import ModelDeployment
    from app.services.pretrained_deploy_service import _mlflow_artifact_size
    import asyncio

    deps = await ModelDeployment.find({"model_size_bytes": None}).to_list()
    updated = 0
    for dep in deps:
        run_id = getattr(dep, "run_id", None)
        if not run_id:
            continue
        size = await asyncio.get_event_loop().run_in_executor(None, _mlflow_artifact_size, run_id)
        if size:
            await dep.set({"model_size_bytes": size})
            updated += 1
    return {"checked": len(deps), "updated": updated}
