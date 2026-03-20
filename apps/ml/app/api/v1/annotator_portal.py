"""Annotator portal API — profile, tasks, rewards, registration."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.dependencies.auth import require_roles, get_current_user
from app.models.ml_user import MLUser
import app.services.annotator_service as annotator_svc

router = APIRouter(prefix="/annotator", tags=["annotator"])

_annotator = Depends(require_roles("annotator", "engineer", "admin"))


# ── Request schemas ───────────────────────────────────────────────────────────

class RegisterAnnotatorRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    referral_code: Optional[str] = None


class UpdateProfileRequest(BaseModel):
    phone_number: Optional[str] = None
    country: Optional[str] = None
    county: Optional[str] = None
    bio: Optional[str] = None
    full_name: Optional[str] = None


class RedeemRequest(BaseModel):
    points: int
    phone_number: str


# ── Public registration (no auth) ─────────────────────────────────────────────

@router.post("/register", status_code=201)
async def register_annotator(body: RegisterAnnotatorRequest):
    """
    Self-registration for annotators. Creates MLUser with role='annotator' (no org_id)
    and an AnnotatorProfile.
    """
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    from app.services.auth_service import register as _register
    try:
        user = await _register(
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            role="annotator",
            org_id="",
            skip_verification=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Create annotator profile, linking referral if provided
    profile = await annotator_svc.get_or_create_profile(body.email, body.full_name)
    if body.referral_code:
        profile.referred_by = body.referral_code
        await profile.save()

    return {
        "message": "Registration successful. Check your email to verify your account.",
        "email": user.email,
        "referral_code": profile.referral_code,
    }


# ── Claim-account endpoints (no auth — uses collector token) ──────────────────

class ClaimPasswordRequest(BaseModel):
    password: str
    full_name: str = ""


class ClaimOtpRequest(BaseModel):
    otp: str


@router.get("/claim/{collector_token}/info")
async def claim_info(collector_token: str):
    """Return masked email + points for the claim page. No auth required."""
    try:
        return await annotator_svc.get_claim_info(collector_token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/claim/{collector_token}/set-password")
async def claim_set_password(collector_token: str, body: ClaimPasswordRequest):
    """Create annotator account with password (or login if account exists). Returns JWT."""
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        user, access_token, refresh_token = await annotator_svc.claim_with_password(
            collector_token, body.password, body.full_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"email": user.email, "role": user.role, "name": user.full_name},
    }


@router.post("/claim/{collector_token}/request-otp")
async def claim_request_otp(collector_token: str):
    """Send a one-time login code to the collector's email."""
    try:
        masked_email = await annotator_svc.send_claim_otp(collector_token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"sent": True, "masked_email": masked_email}


@router.post("/claim/{collector_token}/verify-otp")
async def claim_verify_otp(collector_token: str, body: ClaimOtpRequest):
    """Verify OTP and return JWT — creates account automatically if first time."""
    try:
        user, access_token, refresh_token = await annotator_svc.verify_claim_otp(
            collector_token, body.otp,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"email": user.email, "role": user.role, "name": user.full_name},
    }


# ── Authenticated annotator endpoints ─────────────────────────────────────────

@router.get("/profile")
async def get_profile(user: MLUser = _annotator):
    profile = await annotator_svc.get_profile(user.email)
    return _fmt_profile(profile)


@router.patch("/profile")
async def update_profile(body: UpdateProfileRequest, user: MLUser = _annotator):
    data = body.model_dump(exclude_none=True)
    profile = await annotator_svc.update_profile(user.email, data)
    return _fmt_profile(profile)


@router.get("/stats")
async def get_stats(user: MLUser = _annotator):
    return await annotator_svc.get_stats(user.email)


@router.get("/tasks")
async def get_available_tasks(page: int = 1, limit: int = 20, user: MLUser = _annotator):
    """Return public + points-enabled datasets available to join."""
    items = await annotator_svc.get_available_tasks(user.email, page=page, limit=limit)
    return {"items": items}


@router.get("/tasks/mine")
async def get_my_tasks(user: MLUser = _annotator):
    """Return datasets this annotator has joined."""
    items = await annotator_svc.get_my_tasks(user.email)
    return {"items": items}


@router.post("/tasks/{dataset_id}/join")
async def join_task(dataset_id: str, user: MLUser = _annotator):
    """Join a public points-enabled dataset task."""
    try:
        collector = await annotator_svc.join_task(user.email, dataset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "token": collector.token,
        "collector_id": str(collector.id),
        "dataset_id": collector.dataset_id,
    }


@router.get("/tasks/{dataset_id}/entries")
async def get_task_entries(dataset_id: str, user: MLUser = _annotator):
    """Return all entries submitted by this annotator for a specific task."""
    entries = await annotator_svc.get_task_entries(user.email, dataset_id)
    return {"items": entries}


@router.get("/rewards")
async def get_rewards(user: MLUser = _annotator):
    """Return reward summary."""
    return await annotator_svc.get_rewards(user.email)


@router.post("/rewards/redeem")
async def redeem_rewards(body: RedeemRequest, user: MLUser = _annotator):
    """Redeem points for airtime via Africa's Talking."""
    try:
        redemption = await annotator_svc.redeem_rewards(user.email, body.points, body.phone_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "id": str(redemption.id),
        "points_redeemed": redemption.points_redeemed,
        "kes_value": redemption.kes_value,
        "phone_number": redemption.phone_number,
        "status": redemption.status,
        "at_transaction_id": redemption.at_transaction_id,
        "created_at": redemption.created_at,
    }


@router.get("/redemptions")
async def get_redemption_history(user: MLUser = _annotator):
    """Return all redemption records for this annotator."""
    items = await annotator_svc.get_redemption_history(user.email)
    return {"items": items}


# ── KYC endpoints ─────────────────────────────────────────────────────────────

@router.post("/kyc/submit", status_code=200)
async def submit_kyc(
    avatar: Optional[UploadFile] = File(None),
    id_front: Optional[UploadFile] = File(None),
    id_back: Optional[UploadFile] = File(None),
    user: MLUser = _annotator,
):
    """Upload KYC documents (avatar + ID front + back)."""
    import asyncio
    import aioboto3
    from app.core.config import settings

    async def _upload(f: Optional[UploadFile], label: str):
        if not f:
            return None
        data = await f.read()
        key = f"kyc/{user.email}/{label}_{f.filename}"
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        ) as s3:
            await s3.put_object(
                Bucket=settings.S3_BUCKET,
                Key=key,
                Body=data,
                ContentType=f.content_type or "application/octet-stream",
            )
        return key

    avatar_key, id_front_key, id_back_key = await asyncio.gather(
        _upload(avatar, "avatar"),
        _upload(id_front, "id_front"),
        _upload(id_back, "id_back"),
    )
    profile = await annotator_svc.submit_kyc(user.email, avatar_key, id_front_key, id_back_key)
    return {"kyc_status": profile.kyc_status, "submitted_at": profile.kyc_submitted_at}


@router.get("/reward-rate")
async def get_reward_rate(user: MLUser = _annotator):
    """Return platform reward rate + annotator's local currency value."""
    from app.services.reward_service import get_reward_config, points_to_local, country_to_currency
    from app.models.annotator import AnnotatorProfile
    profile = await AnnotatorProfile.find_one(AnnotatorProfile.email == user.email)
    country = profile.country if profile else "KE"
    cfg = await get_reward_config()
    currency = country_to_currency(country)
    one_point = await points_to_local(1, country)
    hundred_points = await points_to_local(100, country)
    return {
        "point_value_usd": cfg.point_value_usd,
        "currency": currency,
        "one_point_value": one_point["formatted"],
        "hundred_points_value": hundred_points["formatted"],
        "rate_label": one_point["rate_label"],
        "exchange_rates": cfg.exchange_rates,
        "min_redemption_points": cfg.min_redemption_points,
        "withdrawal_kyc_threshold_usd": cfg.withdrawal_kyc_threshold_usd,
        "min_org_balance_usd": cfg.min_org_balance_usd,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_profile(p) -> dict:
    return {
        "email": p.email,
        "full_name": p.full_name,
        "phone_number": p.phone_number,
        "country": p.country,
        "county": p.county,
        "bio": p.bio,
        "total_points_earned": p.total_points_earned,
        "total_points_redeemed": p.total_points_redeemed,
        "redeemable_points": p.redeemable_points,
        "total_entries_submitted": p.total_entries_submitted,
        "total_tasks_completed": p.total_tasks_completed,
        "referral_code": p.referral_code,
        "referred_by": p.referred_by,
        "joined_at": p.joined_at,
        "last_active_at": p.last_active_at,
        "kyc_status": p.kyc_status,
        "avatar_key": p.avatar_key,
        "id_front_key": p.id_front_key,
        "id_back_key": p.id_back_key,
        "kyc_submitted_at": p.kyc_submitted_at,
        "kyc_rejection_reason": p.kyc_rejection_reason,
    }
