"""Annotator portal service — profile, tasks, rewards, redemptions."""
from typing import Optional
import structlog

from app.core.config import settings
from app.models.annotator import AnnotatorProfile, RewardRedemption
from app.models.dataset import DatasetCollector, DatasetEntry, DatasetProfile
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def get_or_create_profile(email: str, full_name: str = "") -> AnnotatorProfile:
    """Return existing annotator profile or create a new one."""
    profile = await AnnotatorProfile.find_one({"email": email})
    if not profile:
        profile = AnnotatorProfile(email=email, full_name=full_name)
        await profile.insert()
        logger.info("annotator_profile_created", email=email)
    return profile


async def get_profile(email: str) -> AnnotatorProfile:
    """Return annotator profile. Raises ValueError if not found."""
    profile = await AnnotatorProfile.find_one({"email": email})
    if not profile:
        raise ValueError(f"Annotator profile not found for {email}")
    return profile


async def update_profile(email: str, data: dict) -> AnnotatorProfile:
    """Update mutable profile fields (phone_number, country, bio, full_name)."""
    profile = await get_profile(email)
    allowed = {"phone_number", "country", "county", "bio", "full_name"}
    for key, val in data.items():
        if key in allowed and val is not None:
            setattr(profile, key, val)
    await profile.save()
    return profile


async def get_stats(email: str) -> dict:
    """Return aggregated stats for an annotator."""
    profile = await get_profile(email)

    # Count rank by total_points_earned descending
    rank = None
    count_above = await AnnotatorProfile.find(
        {"total_points_earned": {"$gt": profile.total_points_earned}}
    ).count()
    rank = count_above + 1

    from app.services.reward_service import points_to_local
    local = await points_to_local(profile.redeemable_points, profile.country or "KE")
    kes_value = local["amount"]
    local_currency = local["currency"]
    local_formatted = local["formatted"]

    return {
        "total_entries": profile.total_entries_submitted,
        "total_points": profile.total_points_earned,
        "redeemable_points": profile.redeemable_points,
        "total_tasks": profile.total_tasks_completed,
        "tasks_completed": profile.total_tasks_completed,
        "kes_value": kes_value,
        "local_amount": kes_value,
        "local_currency": local_currency,
        "local_formatted": local_formatted,
        "rank": rank,
    }


async def get_available_tasks(email: str, page: int = 1, limit: int = 20) -> list:
    """Return all public active datasets, annotated with join/progress status."""
    skip = (page - 1) * limit
    datasets = await DatasetProfile.find(
        {"discoverable": True, "status": "active", "deleted_at": None}
    ).skip(skip).limit(limit).to_list()

    # Fetch which ones this annotator has already joined
    joined_ids: set = set()
    collector_map: dict = {}
    if datasets:
        dataset_ids = [str(d.id) for d in datasets]
        collectors = await DatasetCollector.find(
            {"email": email, "dataset_id": {"$in": dataset_ids}, "deleted_at": None}
        ).to_list()
        for c in collectors:
            joined_ids.add(c.dataset_id)
            collector_map[c.dataset_id] = c

    result = []
    for d in datasets:
        did = str(d.id)
        collector = collector_map.get(did)
        field_count = len(d.fields) if d.fields else 0
        is_repeatable = any(getattr(f, 'repeatable', False) for f in d.fields)
        required_count = sum(1 for f in d.fields if getattr(f, 'required', True))
        entry_count = collector.entry_count if collector else 0
        is_done = (not is_repeatable) and (entry_count >= required_count) and required_count > 0 and did in joined_ids
        result.append({
            "dataset_id": did,
            "name": d.name,
            "description": d.description,
            "category": d.category,
            "discoverable": d.discoverable,
            "points_enabled": d.points_enabled,
            "points_per_entry": d.points_per_entry if d.points_enabled else 0,
            "points_redemption_info": d.points_redemption_info,
            "require_location": d.require_location,
            "location_purpose": d.location_purpose,
            "field_count": field_count,
            "is_repeatable": is_repeatable,
            "required_fields_count": required_count,
            "entry_count": entry_count,
            "total_entries": d.entry_count_cache,
            "joined": did in joined_ids,
            "is_done": is_done,
            "token": collector.token if collector else None,
        })
    return result


async def get_my_tasks(email: str) -> list:
    """Return datasets the annotator has joined."""
    collectors = await DatasetCollector.find(
        {"email": email, "deleted_at": None}
    ).to_list()

    if not collectors:
        return []

    dataset_ids = [c.dataset_id for c in collectors]
    datasets = await DatasetProfile.find(
        {"_id": {"$in": [d for d in dataset_ids]}, "deleted_at": None}
    ).to_list()

    # Build map from dataset_id (str) to dataset
    ds_map = {str(d.id): d for d in datasets}
    collector_map = {c.dataset_id: c for c in collectors}

    result = []
    for did, c in collector_map.items():
        d = ds_map.get(did)
        if not d:
            continue
        is_repeatable = any(getattr(f, 'repeatable', False) for f in d.fields)
        required_count = sum(1 for f in d.fields if getattr(f, 'required', True))
        is_done = (not is_repeatable) and (c.entry_count >= required_count) and required_count > 0
        result.append({
            "dataset_id": did,
            "name": d.name,
            "description": d.description,
            "category": d.category,
            "points_enabled": d.points_enabled,
            "points_per_entry": d.points_per_entry if d.points_enabled else 0,
            "points_redemption_info": d.points_redemption_info,
            "require_location": d.require_location,
            "field_count": len(d.fields) if d.fields else 0,
            "entry_count": c.entry_count,
            "total_entries": d.entry_count_cache,
            "joined": True,
            "token": c.token,
            "status": c.status,
            "is_repeatable": is_repeatable,
            "is_done": is_done,
            "required_fields_count": required_count,
        })
    return result


async def join_task(email: str, dataset_id: str) -> DatasetCollector:
    """Join a public points-enabled dataset task. Returns existing collector if already joined."""
    # Validate dataset
    dataset = await DatasetProfile.find_one({"_id": dataset_id, "deleted_at": None})
    if not dataset:
        # Try with string comparison
        from beanie import PydanticObjectId
        try:
            oid = PydanticObjectId(dataset_id)
            dataset = await DatasetProfile.find_one({"_id": oid, "deleted_at": None})
        except Exception:
            pass
    if not dataset:
        raise ValueError("Dataset not found")
    if not dataset.discoverable:
        raise ValueError("Dataset is not open to contributors")
    if dataset.status != "active":
        raise ValueError("Dataset is not active")

    # Check for existing collector
    existing = await DatasetCollector.find_one(
        {"email": email, "dataset_id": dataset_id, "deleted_at": None}
    )
    if existing:
        return existing

    # Get annotator profile for name
    profile = await get_or_create_profile(email)

    # Create new collector
    collector = DatasetCollector(
        org_id=dataset.org_id,
        dataset_id=dataset_id,
        email=email,
        name=profile.full_name or email.split("@")[0],
        status="active",
    )
    await collector.insert()

    # Update annotator task count
    profile.total_tasks_completed = profile.total_tasks_completed  # will update on completion
    profile.last_active_at = utc_now()
    await profile.save()

    logger.info("annotator_joined_task", email=email, dataset_id=dataset_id)
    return collector


async def get_task_entries(email: str, dataset_id: str) -> list:
    """Return all entries submitted by this annotator for a specific task."""
    collector = await DatasetCollector.find_one(
        {"email": email, "dataset_id": dataset_id, "deleted_at": None}
    )
    if not collector:
        return []

    entries = await DatasetEntry.find(
        {"collector_id": str(collector.id), "dataset_id": dataset_id}
    ).sort("-captured_at").to_list()

    return [
        {
            "id": str(e.id),
            "field_id": e.field_id,
            "file_key": e.file_key,
            "file_mime": e.file_mime,
            "text_value": e.text_value,
            "description": e.description,
            "points_awarded": e.points_awarded,
            "captured_at": e.captured_at,
        }
        for e in entries
    ]


async def get_rewards(email: str) -> dict:
    """Return reward summary for an annotator."""
    profile = await get_profile(email)
    from app.services.reward_service import points_to_local, get_reward_config, withdrawal_needs_kyc
    cfg = await get_reward_config()
    local = await points_to_local(profile.redeemable_points, profile.country or "KE")
    kes_value = local["amount"]
    can_redeem = profile.redeemable_points >= cfg.min_redemption_points
    kyc_required = await withdrawal_needs_kyc(profile.redeemable_points, profile.country or "KE")

    return {
        "total_earned": profile.total_points_earned,
        "total_redeemed": profile.total_points_redeemed,
        "redeemable": profile.redeemable_points,
        "kes_value": kes_value,
        "local_amount": kes_value,
        "local_currency": local["currency"],
        "local_formatted": local["formatted"],
        "rate_label": local["rate_label"],
        "min_redemption_points": cfg.min_redemption_points,
        "can_redeem": can_redeem,
        "kyc_required": kyc_required,
        "kyc_status": profile.kyc_status,
    }


async def redeem_rewards(email: str, points: int, phone: str) -> RewardRedemption:
    """Process an airtime redemption. Calls Africa's Talking and saves record."""
    profile = await get_profile(email)

    from app.services.reward_service import get_reward_config, points_to_local, withdrawal_needs_kyc
    cfg = await get_reward_config()
    if points < cfg.min_redemption_points:
        raise ValueError(f"Minimum redemption is {cfg.min_redemption_points} points")
    if points > profile.redeemable_points:
        raise ValueError(f"Not enough redeemable points. Have {profile.redeemable_points}, want {points}")

    needs_kyc = await withdrawal_needs_kyc(points, profile.country or "KE")
    if needs_kyc and profile.kyc_status != "approved":
        raise ValueError(f"KYC verification required to redeem this amount. Status: {profile.kyc_status}")

    local = await points_to_local(points, profile.country or "KE")
    kes_value = local["amount"]

    # Create redemption record in pending state
    redemption = RewardRedemption(
        annotator_email=email,
        points_redeemed=points,
        kes_value=kes_value,
        phone_number=phone,
        status="pending",
    )
    await redemption.insert()

    # Attempt airtime send
    try:
        from app.services.africastalking_service import send_airtime
        tx_id = await send_airtime(phone, kes_value)
        redemption.at_transaction_id = tx_id
        redemption.status = "sent"
        redemption.updated_at = utc_now()
        await redemption.save()

        # Deduct points
        profile.redeemable_points -= points
        profile.total_points_redeemed += points
        await profile.save()

        logger.info("reward_redeemed", email=email, points=points, kes=kes_value, tx_id=tx_id)

    except Exception as exc:
        redemption.status = "failed"
        redemption.error_message = str(exc)
        redemption.updated_at = utc_now()
        await redemption.save()
        logger.error("reward_redemption_failed", email=email, error=str(exc))
        raise ValueError(f"Airtime send failed: {exc}")

    return redemption


async def get_redemption_history(email: str) -> list:
    """Return all redemption records for an annotator."""
    redemptions = await RewardRedemption.find(
        {"annotator_email": email}
    ).sort("-created_at").to_list()

    return [
        {
            "id": str(r.id),
            "points_redeemed": r.points_redeemed,
            "kes_value": r.kes_value,
            "phone_number": r.phone_number,
            "status": r.status,
            "at_transaction_id": r.at_transaction_id,
            "error_message": r.error_message,
            "created_at": r.created_at,
        }
        for r in redemptions
    ]


_CLAIM_OTP_TTL = 600  # 10 minutes


def _redis_client():
    import redis.asyncio as aioredis
    from app.core.config import settings
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def _claim_otp_key(collector_token: str) -> str:
    return f"ml:claim_otp:{collector_token}"


async def _collector_by_token(token: str) -> DatasetCollector:
    """Lookup DatasetCollector by token — uses Beanie expression style (consistent with dataset_service)."""
    collector = await DatasetCollector.find_one(
        DatasetCollector.token == token,
        DatasetCollector.deleted_at == None,  # noqa: E711
    )
    if not collector:
        raise ValueError("Invalid or expired collection link")
    return collector


async def get_claim_info(collector_token: str) -> dict:
    """Return masked email + total points for the claim page."""
    collector = await _collector_by_token(collector_token)
    email = collector.email
    # Aggregate total points across all collectors for this email
    all_collectors = await DatasetCollector.find(
        DatasetCollector.email == email,
        DatasetCollector.deleted_at == None,  # noqa: E711
    ).to_list()
    total_points = sum(c.points_earned for c in all_collectors)
    # Check if account already exists
    from app.models.ml_user import MLUser
    existing = await MLUser.find_one({"email": email})
    has_account = existing is not None
    # Mask email: show first 2 chars + domain
    parts = email.split("@")
    masked = parts[0][:2] + "***@" + parts[1] if len(parts) == 2 else email
    return {
        "masked_email": masked,
        "collector_name": collector.name,
        "total_points": total_points,
        "has_account": has_account,
    }


async def claim_with_password(collector_token: str, password: str, full_name: str = "") -> tuple:
    """Create (or login to) an annotator account using a password. Returns (user, access_token, refresh_token)."""
    collector = await _collector_by_token(collector_token)
    email = collector.email

    from app.models.ml_user import MLUser
    from app.services.auth_service import _verify, make_access_token, make_refresh_token
    existing = await MLUser.find_one({"email": email})
    if existing:
        if not _verify(password, existing.hashed_password):
            raise ValueError("Incorrect password")
        # Sync points on login
        await sync_points_from_collectors(email)
        return existing, make_access_token(existing), make_refresh_token(existing)

    from app.services.auth_service import register as _register
    user = await _register(
        email=email,
        password=password,
        full_name=full_name or collector.name,
        role="annotator",
        org_id="",
        skip_verification=True,
    )
    await get_or_create_profile(email, full_name or collector.name)
    await sync_points_from_collectors(email)
    return user, make_access_token(user), make_refresh_token(user)


async def send_claim_otp(collector_token: str) -> str:
    """Send a 6-digit OTP to the collector's email for passwordless claim/login. Returns masked email."""
    collector = await _collector_by_token(collector_token)
    email = collector.email

    # Aggregate points for email body
    all_collectors = await DatasetCollector.find(
        DatasetCollector.email == email,
        DatasetCollector.deleted_at == None,  # noqa: E711
    ).to_list()
    total_points = sum(c.points_earned for c in all_collectors)

    import random
    otp = f"{random.SystemRandom().randint(0, 999999):06d}"

    r = _redis_client()
    try:
        await r.set(_claim_otp_key(collector_token), otp, ex=_CLAIM_OTP_TTL)
    finally:
        await r.aclose()

    name = collector.name or email.split("@")[0]
    import asyncio
    from app.core.email import send_email, _annotator_login_otp_html
    asyncio.create_task(send_email(
        to=email,
        subject="Your MLDock.io login code",
        html=_annotator_login_otp_html(name, otp, total_points),
    ))

    parts = email.split("@")
    return parts[0][:2] + "***@" + parts[1] if len(parts) == 2 else email


async def verify_claim_otp(collector_token: str, otp: str) -> tuple:
    """Verify OTP and return (user, access_token, refresh_token), creating account if needed."""
    collector = await _collector_by_token(collector_token)
    email = collector.email

    r = _redis_client()
    try:
        stored = await r.get(_claim_otp_key(collector_token))
        if not stored or stored != otp:
            raise ValueError("Invalid or expired code")
        await r.delete(_claim_otp_key(collector_token))
    finally:
        await r.aclose()

    from app.models.ml_user import MLUser
    from app.services.auth_service import make_access_token, make_refresh_token
    existing = await MLUser.find_one({"email": email})
    if existing:
        await sync_points_from_collectors(email)
        return existing, make_access_token(existing), make_refresh_token(existing)

    # Create account with a random password (user can set one later)
    import secrets
    from app.services.auth_service import register as _register
    random_password = secrets.token_urlsafe(24)
    user = await _register(
        email=email,
        password=random_password,
        full_name=collector.name,
        role="annotator",
        org_id="",
        skip_verification=True,
    )
    await get_or_create_profile(email, collector.name)
    await sync_points_from_collectors(email)
    return user, make_access_token(user), make_refresh_token(user)


async def submit_kyc(email: str, avatar_key: Optional[str], id_front_key: Optional[str], id_back_key: Optional[str]) -> AnnotatorProfile:
    from app.services.reward_service import get_reward_config
    profile = await get_profile(email)
    if avatar_key:
        profile.avatar_key = avatar_key
    if id_front_key:
        profile.id_front_key = id_front_key
    if id_back_key:
        profile.id_back_key = id_back_key
    from app.utils.datetime import utc_now
    profile.kyc_submitted_at = utc_now()
    cfg = await get_reward_config()
    if cfg.auto_approve_kyc:
        profile.kyc_status = "approved"
        profile.kyc_reviewed_at = utc_now()
    else:
        profile.kyc_status = "pending"
    await profile.save()
    logger.info("annotator_kyc_submitted", email=email, status=profile.kyc_status)
    return profile


async def approve_kyc(email: str, approved: bool, rejection_reason: str = "") -> AnnotatorProfile:
    profile = await get_profile(email)
    from app.utils.datetime import utc_now
    profile.kyc_status = "approved" if approved else "rejected"
    profile.kyc_reviewed_at = utc_now()
    profile.kyc_rejection_reason = rejection_reason if not approved else None
    await profile.save()
    logger.info("annotator_kyc_reviewed", email=email, approved=approved)
    return profile


async def sync_points_from_collectors(email: str) -> None:
    """Recalculate total_points_earned from all DatasetCollector records for this annotator."""
    profile = await get_or_create_profile(email)

    collectors = await DatasetCollector.find(
        DatasetCollector.email == email,
        DatasetCollector.deleted_at == None,  # noqa: E711
    ).to_list()
    total_earned = sum(c.points_earned for c in collectors)
    total_entries = sum(c.entry_count for c in collectors)

    profile.total_points_earned = total_earned
    profile.total_entries_submitted = total_entries
    # redeemable = earned - redeemed (never go below 0)
    profile.redeemable_points = max(0, total_earned - profile.total_points_redeemed)
    await profile.save()

    logger.info("annotator_points_synced", email=email, total_earned=total_earned)
