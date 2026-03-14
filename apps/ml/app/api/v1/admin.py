"""Super-admin analytics + email broadcast API."""
from datetime import datetime, timezone
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
