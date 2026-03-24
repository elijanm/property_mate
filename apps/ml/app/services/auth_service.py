"""JWT authentication service for MLDock.io."""
import hashlib
import hmac
import os
import uuid
import random
import base64
from datetime import datetime, timedelta
from typing import Optional
import structlog
from jose import jwt, JWTError
from fastapi import HTTPException

from pathlib import Path
from app.core.config import settings
from app.models.ml_user import MLUser
from app.utils.datetime import utc_now


def _resolve_plugin_file(source, base_name: str, plugin_dir: str) -> "Path | None":
    """Resolve the actual trainer .py file, falling back to global_sample/ when
    source.plugin_file is a stale path from old entrypoint seeding."""
    if source.plugin_file:
        p = Path(source.plugin_file)
        if p.exists():
            return p
    global_sample = Path(plugin_dir) / "global_sample"
    for candidate in [
        global_sample / f"{base_name}.py",
        global_sample / f"sample_{base_name}.py",
    ]:
        if candidate.exists():
            return candidate
    return None

logger = structlog.get_logger(__name__)

ALGORITHM = "HS256"
_ITERATIONS = 260_000
_OTP_EXPIRY_MINUTES = 30
_TOKEN_EXPIRY_HOURS = 24
_RESET_EXPIRY_HOURS = 1


def _hash(password: str) -> str:
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return base64.b64encode(salt + key).decode()


def _verify(plain: str, stored: str) -> bool:
    try:
        data = base64.b64decode(stored.encode())
        salt, key = data[:32], data[32:]
        candidate = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, _ITERATIONS)
        return hmac.compare_digest(key, candidate)
    except Exception:
        return False


def _make_token(data: dict, expires_delta: timedelta) -> str:
    payload = data.copy()
    payload["exp"] = utc_now() + expires_delta
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def make_access_token(user: MLUser) -> str:
    return _make_token(
        {"sub": user.email, "role": user.role, "name": user.full_name, "org_id": user.org_id},
        timedelta(hours=settings.JWT_ACCESS_HOURS),
    )


def make_refresh_token(user: MLUser) -> str:
    return _make_token(
        {"sub": user.email, "type": "refresh"},
        timedelta(days=settings.JWT_REFRESH_DAYS),
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def _gen_otp() -> str:
    return f"{random.SystemRandom().randint(0, 999999):06d}"


_SAMPLE_TRAINERS = ["iris_classifier", "wine_classifier", "digits_classifier"]


async def _init_trainer_workspace(owner_email: str, org_id: str) -> None:
    """Auto-clone all public trainers (global_sample/) into a new org's workspace."""
    if not org_id or org_id == "system":
        return
    try:
        import re as _re
        from app.models.trainer_registration import TrainerRegistration
        from app.utils.datetime import utc_now as _utc_now

        public = await TrainerRegistration.find(
            TrainerRegistration.org_id == "",
            TrainerRegistration.is_active == True,  # noqa: E712
        ).to_list()

        from pathlib import Path as _Path
        import shutil as _shutil
        from app.core.config import settings as _settings

        for source in public:
            base = source.base_name or _re.sub(r"_v\d+$", "", source.name)
            existing_copy = await TrainerRegistration.find_one({
                "org_id": org_id,
                "base_name": base,
            })
            if existing_copy:
                continue

            # Copy source file into org's running/ dir for isolation.
            # Resolve actual file — source.plugin_file may be a stale path from
            # the old entrypoint seeding; fall back to global_sample/ lookup.
            clone_plugin_file = source.plugin_file
            src_path = _resolve_plugin_file(source, base, _settings.TRAINER_PLUGIN_DIR)
            if src_path and src_path.exists():
                dest_dir = _Path(_settings.TRAINER_PLUGIN_DIR) / "running" / org_id
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_path = dest_dir / f"{base}.py"
                _shutil.copy2(src_path, dest_path)
                clone_plugin_file = str(dest_path)

            clone = TrainerRegistration(
                org_id=org_id,
                name=base,
                base_name=base,
                plugin_version=0,
                version_num=1,
                namespace=org_id,
                full_name=f"{org_id}/{base}",
                description=source.description,
                framework=source.framework,
                data_source_info=source.data_source_info,
                class_path=source.class_path,
                plugin_file=clone_plugin_file,
                tags=source.tags,
                author=source.author,
                author_email=source.author_email,
                author_url=source.author_url,
                icon_url=source.icon_url,
                license=source.license,
                parent_trainer_id=str(source.id),
                clone_depth=1,
                cloned_from_org_id="",
                is_active=True,
                approval_status="approved",
                visibility="private",
                owner_email=owner_email,
                registered_at=_utc_now(),
                updated_at=_utc_now(),
            )
            await clone.insert()
            logger.info("trainer_workspace_cloned", base=base, org_id=org_id)
    except Exception as exc:
        logger.warning("trainer_workspace_init_failed", org_id=org_id, error=str(exc))


async def _enqueue_sample_models(email: str, org_id: str) -> None:
    """Fire training jobs for sample datasets so the new user has working models immediately."""
    from app.tasks.train_task import enqueue_training
    from app.services.registry_service import get_trainer_class

    for trainer_name in _SAMPLE_TRAINERS:
        try:
            if not get_trainer_class(trainer_name):
                continue  # trainer plugin not yet loaded — skip silently
            job_id = await enqueue_training(
                trainer_name=trainer_name,
                trigger="sample_preinstall",
                owner_email=email,
                org_id=org_id,
            )
            logger.info("ml_sample_model_enqueued", trainer=trainer_name, owner=email, job_id=job_id)
        except Exception as exc:
            logger.warning("ml_sample_model_enqueue_failed", trainer=trainer_name, owner=email, error=str(exc))


async def _send_welcome_email(user: MLUser, otp: str, token: str) -> None:
    try:
        from app.core.email import send_email, _welcome_html
        await send_email(
            to=user.email,
            subject="Activate your MLDock.io account",
            html=_welcome_html(user.full_name, user.email, otp, token),
        )
    except Exception as exc:
        logger.warning("welcome_email_failed", email=user.email, error=str(exc))


async def register(
    email: str,
    password: str,
    full_name: str = "",
    role: str = "engineer",
    org_id: str = "",
    skip_verification: bool = False,
) -> MLUser:
    existing = await MLUser.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    # Annotators are platform-level — no org workspace
    # All other self-signups create an isolated workspace
    if not org_id and role != "annotator":
        org_id = str(uuid.uuid4())

    otp = _gen_otp()
    token = str(uuid.uuid4())

    user = MLUser(
        email=email,
        hashed_password=_hash(password),
        full_name=full_name,
        role=role,
        org_id=org_id,
        is_verified=skip_verification,
        verification_token=None if skip_verification else token,
        verification_otp=None if skip_verification else otp,
        otp_expires_at=None if skip_verification else (utc_now() + timedelta(minutes=_OTP_EXPIRY_MINUTES)),
    )
    await user.insert()
    logger.info("ml_user_registered", email=email, role=role, org_id=org_id)

    # Auto-create org config for non-annotators
    if role != "annotator" and org_id and org_id != "system":
        try:
            from app.models.org_config import OrgConfig
            from app.utils.datetime import utc_now as _utc_now
            existing_cfg = await OrgConfig.find_one(OrgConfig.org_id == org_id)
            if not existing_cfg:
                # Build org name from first name e.g. "Mike_org"
                first_name = (full_name or email.split("@")[0]).split()[0].capitalize()
                base_slug = re.sub(r"[^a-z0-9]", "", first_name.lower())[:12] or "user"
                short_id = str(uuid.uuid4()).replace("-", "")[:8]
                slug = f"{base_slug}-{short_id}"
                org_cfg = OrgConfig(
                    org_id=org_id,
                    org_name=f"{first_name}_org",
                    display_name=f"{first_name}_org",
                    slug=slug,
                    org_type="individual",
                    created_at=_utc_now(),
                    updated_at=_utc_now(),
                )
                await org_cfg.insert()
        except Exception as _cfg_err:
            logger.warning("ml_org_config_create_failed", email=email, org_id=org_id, error=str(_cfg_err))

    if not skip_verification:
        import asyncio
        asyncio.create_task(_send_welcome_email(user, otp, token))

    # Kick off sample model training in the background — non-blocking, non-fatal
    import asyncio
    asyncio.create_task(_enqueue_sample_models(email, org_id))
    # Auto-clone all public trainers (global_sample/) into this org's workspace
    asyncio.create_task(_init_trainer_workspace(email, org_id))
    return user


def _bootstrap_user_plan(email: str, org_id: str) -> None:
    """Fire-and-forget: assign default plan + give welcome credit + redeem pending coupon."""
    import asyncio
    async def _run():
        try:
            from app.services.ml_billing_service import get_or_create_user_plan
            await get_or_create_user_plan(email, org_id)
            logger.info("ml_user_plan_bootstrapped", email=email, org_id=org_id)
        except Exception as exc:
            logger.warning("ml_user_plan_bootstrap_failed", email=email, error=str(exc))
        # Redeem pending coupon code if present
        try:
            from app.models.ml_user import MLUser
            from app.services.coupon_service import get_coupon, redeem as redeem_coupon
            user = await MLUser.find_one({"email": email})
            if user and user.pending_coupon_code:
                coupon = await get_coupon(user.pending_coupon_code)
                if coupon:
                    credited = await redeem_coupon(coupon, email, org_id)
                    logger.info("coupon_redeemed", email=email, code=coupon.code, credit_usd=credited)
                await user.set({"pending_coupon_code": None})
        except Exception as exc:
            logger.warning("coupon_redeem_failed", email=email, error=str(exc))
    asyncio.create_task(_run())


async def verify_by_otp(email: str, otp: str) -> MLUser:
    user = await MLUser.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_verified:
        return user
    if not user.verification_otp or user.verification_otp != otp:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    if user.otp_expires_at and utc_now().replace(tzinfo=None) > user.otp_expires_at.replace(tzinfo=None):
        raise HTTPException(status_code=400, detail="Verification code has expired — please request a new one")
    await user.set({
        "is_verified": True,
        "verification_token": None,
        "verification_otp": None,
        "otp_expires_at": None,
    })
    logger.info("ml_user_verified", email=email, method="otp")
    _bootstrap_user_plan(email, user.org_id)
    return user


async def verify_by_token(token: str) -> MLUser:
    user = await MLUser.find_one({"verification_token": token})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired activation link")
    if user.is_verified:
        return user
    await user.set({
        "is_verified": True,
        "verification_token": None,
        "verification_otp": None,
        "otp_expires_at": None,
    })
    logger.info("ml_user_verified", email=user.email, method="link")
    _bootstrap_user_plan(user.email, user.org_id)
    return user


async def resend_verification(email: str) -> None:
    user = await MLUser.find_one({"email": email})
    if not user:
        return  # don't reveal existence
    if user.is_verified:
        return
    otp = _gen_otp()
    token = str(uuid.uuid4())
    await user.set({
        "verification_otp": otp,
        "verification_token": token,
        "otp_expires_at": utc_now() + timedelta(minutes=_OTP_EXPIRY_MINUTES),
    })
    import asyncio
    asyncio.create_task(_send_welcome_email(user, otp, token))
    logger.info("ml_verification_resent", email=email)


async def login(email: str, password: str) -> tuple[MLUser, str, str]:
    user = await MLUser.find_one({"email": email})
    if not user or not _verify(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")
    user.last_login_at = utc_now()
    await user.save()
    return user, make_access_token(user), make_refresh_token(user)


async def get_current_user(token: str) -> MLUser:
    payload = decode_token(token)
    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await MLUser.find_one({"email": email})
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


_SYSTEM_ORG_ID = "system"


async def forgot_password(email: str) -> None:
    user = await MLUser.find_one({"email": email})
    if not user:
        return  # don't reveal existence
    token = str(uuid.uuid4())
    await user.set({
        "password_reset_token": token,
        "password_reset_expires_at": utc_now() + timedelta(hours=_RESET_EXPIRY_HOURS),
    })
    reset_url = f"{settings.FRONTEND_BASE_URL}?reset_token={token}"
    try:
        from app.core.email import send_email, _password_reset_html
        name = user.full_name or email.split("@")[0]
        import asyncio
        asyncio.create_task(send_email(
            to=email,
            subject="Reset your MLDock.io password",
            html=_password_reset_html(name, reset_url),
        ))
    except Exception as exc:
        logger.warning("password_reset_email_failed", email=email, error=str(exc))
    logger.info("ml_password_reset_requested", email=email)


async def reset_password(token: str, new_password: str) -> None:
    user = await MLUser.find_one({"password_reset_token": token})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    expires = user.password_reset_expires_at
    if expires:
        # Normalise both sides to naive UTC for comparison (MongoDB may strip tzinfo)
        now_naive = utc_now().replace(tzinfo=None)
        exp_naive = expires.replace(tzinfo=None) if expires.tzinfo else expires
        if now_naive > exp_naive:
            raise HTTPException(status_code=400, detail="Reset link has expired — please request a new one")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    await user.set({
        "hashed_password": _hash(new_password),
        "password_reset_token": None,
        "password_reset_expires_at": None,
    })
    logger.info("ml_password_reset", email=user.email)


async def send_security_otp(user: MLUser, action: str = "change your password") -> None:
    """Generate a 6-digit OTP, save it on the user, and email it. Expires in 10 minutes."""
    import random
    otp = f"{random.randint(0, 999999):06d}"
    expires = utc_now() + timedelta(minutes=10)
    await user.set({
        "security_otp": otp,
        "security_otp_expires_at": expires,
    })
    from app.core.email import send_email, _security_otp_html
    import asyncio
    asyncio.create_task(
        send_email(
            user.email,
            "MLDock.io — Security verification code",
            _security_otp_html(user.full_name, otp, action),
        )
    )
    logger.info("security_otp_sent", email=user.email)


async def verify_security_otp(user: MLUser, otp: str) -> None:
    """Validate the security OTP. Raises HTTPException on failure."""
    if not user.security_otp or user.security_otp != otp:
        raise HTTPException(status_code=400, detail="Invalid security code")
    expires = user.security_otp_expires_at
    if expires:
        now_naive = utc_now().replace(tzinfo=None)
        exp_naive = expires.replace(tzinfo=None) if expires.tzinfo else expires
        if now_naive > exp_naive:
            raise HTTPException(status_code=400, detail="Security code has expired — please request a new one")
    await user.set({"security_otp": None, "security_otp_expires_at": None})


async def change_password(user: MLUser, current_password: str, new_password: str, otp: str = "") -> None:
    if not _verify(current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if otp:
        await verify_security_otp(user, otp)
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    await user.set({"hashed_password": _hash(new_password)})
    logger.info("ml_password_changed", email=user.email)


async def ensure_admin_exists():
    """Create default admin on first startup if no users exist."""
    count = await MLUser.count()
    if count == 0:
        await register(
            email=settings.DEFAULT_ADMIN_EMAIL,
            password=settings.DEFAULT_ADMIN_PASSWORD,
            full_name="System Admin",
            role="admin",
            org_id=_SYSTEM_ORG_ID,
            skip_verification=True,
        )
        logger.info("ml_default_admin_created", email=settings.DEFAULT_ADMIN_EMAIL)
    else:
        # Migration: ensure existing users have an org_id and are verified (legacy accounts)
        from app.core.database import get_db
        db = get_db()
        await db["ml_users"].update_many(
            {"org_id": {"$in": [None, ""]}},
            {"$set": {"org_id": _SYSTEM_ORG_ID}},
        )
        # Mark legacy accounts as verified so they are not locked out
        await db["ml_users"].update_many(
            {"is_verified": {"$in": [None, False]}, "verification_token": None},
            {"$set": {"is_verified": True}},
        )


async def ensure_sample_model_deployed():
    """On first startup, if iris_classifier is not yet deployed, trigger a training job."""
    import asyncio
    from app.models.model_deployment import ModelDeployment
    from app.services.registry_service import get_trainer_class

    try:
        if not get_trainer_class("iris_classifier"):
            return

        existing = await ModelDeployment.find_one({"trainer_name": "iris_classifier"})
        if existing:
            updates = {}
            if getattr(existing, "visibility", "engineer") != "viewer":
                updates["visibility"] = "viewer"
            if not existing.is_default:
                updates["is_default"] = True
            if updates:
                await existing.set(updates)
                logger.info("ml_sample_model_patched", trainer="iris_classifier", updates=list(updates.keys()))
            return

        from app.tasks.train_task import enqueue_training
        job_id = await enqueue_training(
            trainer_name="iris_classifier",
            trigger="sample_preinstall",
        )
        logger.info("ml_sample_model_enqueued", trainer="iris_classifier", job_id=job_id)
    except Exception as exc:
        logger.warning("ml_sample_model_preinstall_failed", error=str(exc))


async def oauth_login_or_register(
    provider: str,
    oauth_id: str,
    email: str,
    full_name: str = "",
) -> MLUser:
    """Find or create a user via OAuth. Verified by default; no password required."""
    # 1. Find by (provider, oauth_id) — most reliable link
    user = await MLUser.find_one({"oauth_provider": provider, "oauth_id": oauth_id})
    if user:
        await user.set({"last_login_at": utc_now()})
        return user

    # 2. Find by email — link OAuth to existing email/password account
    user = await MLUser.find_one(MLUser.email == email)
    if user:
        await user.set({
            "oauth_provider": provider,
            "oauth_id": oauth_id,
            "is_verified": True,
            "last_login_at": utc_now(),
        })
        return user

    # 3. New user — create account (no password, pre-verified)
    org_id = str(uuid.uuid4())
    user = MLUser(
        email=email,
        hashed_password="",
        full_name=full_name or email.split("@")[0],
        role="engineer",
        org_id=org_id,
        is_verified=True,
        is_onboarded=False,
        oauth_provider=provider,
        oauth_id=oauth_id,
    )
    await user.insert()
    logger.info("ml_user_oauth_registered", email=email, provider=provider, org_id=org_id)

    import asyncio as _asyncio
    _asyncio.create_task(_init_trainer_workspace(email, org_id))
    _asyncio.create_task(_create_org_config(email, org_id))
    return user


async def _create_org_config(email: str, org_id: str) -> None:
    try:
        from app.models.org_config import OrgConfig
        existing = await OrgConfig.find_one(OrgConfig.org_id == org_id)
        if not existing:
            await OrgConfig(org_id=org_id, owner_email=email).insert()
    except Exception as exc:
        logger.warning("ml_org_config_create_failed_oauth", email=email, org_id=org_id, error=str(exc))
