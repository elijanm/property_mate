"""MLDock.io authentication endpoints."""
from typing import Optional
from fastapi import APIRouter, Header, Request
from pydantic import BaseModel

from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    invite_code: str = ""
    coupon_code: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str


class ResendVerificationRequest(BaseModel):
    email: str


class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    otp: str = ""   # security OTP (required when sent via request-security-otp)


class RequestSecurityOtpRequest(BaseModel):
    action: str = "change your password"


@router.get("/validate-coupon")
async def validate_coupon(code: str) -> dict:
    """Public endpoint — check if a coupon code is valid before signup."""
    from app.services.coupon_service import validate_coupon as _validate
    try:
        coupon = await _validate(code)
        return {"valid": True, "credit_usd": coupon.credit_usd, "credit_type": coupon.credit_type, "code": coupon.code}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


@router.post("/register")
async def register(body: RegisterRequest):
    user = await auth_service.register(body.email, body.password, body.full_name)
    # Store coupon code on user for post-verification redemption
    if body.coupon_code.strip():
        try:
            from app.services.coupon_service import validate_coupon as _validate
            await _validate(body.coupon_code)  # validate only — redeem after email verification
            await user.set({"pending_coupon_code": body.coupon_code.upper().strip()})
        except Exception:
            pass  # invalid coupon — ignore silently

    # Disposable email check — non-blocking; log to audit trail if flagged
    try:
        check = await _run_disposable_check(body.email)
        if check.is_disposable and check.confidence != "unavailable":
            await user.set({"disposable_email_used": True, "disposable_email_attempts": 1})
            from app.services.audit_service import log_action as _audit
            await _audit(
                actor_email=body.email,
                action="disposable_email_registration",
                resource_type="user",
                resource_id=str(user.id),
                details={
                    "email": body.email,
                    "risk_score": check.risk_score,
                    "confidence": check.confidence,
                },
            )
    except Exception:
        pass  # never block registration on disposable check failure

    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "pending_verification": not user.is_verified,
    }


class InviteRegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str = ""
    invite_token: str


@router.post("/register-invite")
async def register_with_invite(body: InviteRegisterRequest):
    import jwt as pyjwt
    from fastapi import HTTPException
    from app.core.config import settings
    try:
        payload = pyjwt.decode(body.invite_token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("type") != "invite":
            raise ValueError("invalid type")
        org_id = payload["org_id"]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired invite token")
    user = await auth_service.register(
        body.email, body.password, body.full_name,
        role="viewer", org_id=org_id, skip_verification=True
    )
    # Invited users join an existing org — no workspace setup needed
    await user.set({"is_onboarded": True})
    user.is_onboarded = True
    token = auth_service.make_access_token(user)
    return {
        "token": token,
        "user": {"email": user.email, "full_name": user.full_name, "role": user.role, "org_id": user.org_id},
    }


@router.post("/verify")
async def verify_otp(body: VerifyOtpRequest):
    """Verify email with 6-digit OTP."""
    user = await auth_service.verify_by_otp(body.email, body.otp)
    return {"verified": True, "email": user.email}


@router.get("/verify/{token}")
async def verify_link(token: str):
    """Activate account via link click."""
    user = await auth_service.verify_by_token(token)
    return {"verified": True, "email": user.email}


@router.post("/resend-verification")
async def resend_verification(body: ResendVerificationRequest):
    """Resend OTP + activation link."""
    await auth_service.resend_verification(body.email)
    return {"sent": True}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    """Send password reset email. Always returns ok to avoid user enumeration."""
    await auth_service.forgot_password(body.email)
    return {"ok": True}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    """Set a new password using the reset token from the email link."""
    await auth_service.reset_password(body.token, body.new_password)
    return {"ok": True}


@router.post("/request-security-otp")
async def request_security_otp(body: RequestSecurityOtpRequest, authorization: Optional[str] = Header(None)):
    """Send a 6-digit OTP to the user's email for confirming a sensitive action."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await auth_service.send_security_otp(user, body.action)
    return {"ok": True, "message": f"Security code sent to {user.email}"}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    """Change password. Requires current_password + OTP (request via /request-security-otp first)."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await auth_service.change_password(user, body.current_password, body.new_password, body.otp)
    return {"ok": True}


@router.post("/login")
async def login(body: LoginRequest):
    user, access, refresh = await auth_service.login(body.email, body.password)
    # Auto-mark existing users as onboarded if they've already customised their workspace
    # (prevents the setup wizard from appearing for users who registered before this feature)
    if not user.is_onboarded and user.org_id:
        try:
            from app.models.org_config import OrgConfig
            cfg = await OrgConfig.find_one({"org_id": user.org_id})
            # Consider onboarded if slug exists AND org_name was manually set
            # (auto-generated names end with "_org", e.g. "Mike_org")
            if cfg and cfg.slug and cfg.org_name and not cfg.org_name.endswith("_org"):
                await user.set({"is_onboarded": True})
                user.is_onboarded = True
        except Exception:
            pass
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": _user_dict(user),
    }


@router.post("/refresh")
async def refresh(body: RefreshRequest):
    payload = auth_service.decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not a refresh token")
    user = await auth_service.get_current_user(body.refresh_token)
    access = auth_service.make_access_token(user)
    return {"access_token": access, "token_type": "bearer"}


@router.get("/me")
async def me(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    return {**_user_dict(user), "last_login_at": user.last_login_at}


class CheckEmailRequest(BaseModel):
    email: str


class CheckEmailResponse(BaseModel):
    is_disposable: bool
    risk_score: float
    confidence: str


async def _run_disposable_check(email: str) -> CheckEmailResponse:
    from app.core.config import settings
    import httpx
    if not settings.disposable_email_check_url:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            resp = await c.post(
                settings.disposable_email_check_url,
                headers={"X-Api-Key": settings.disposable_email_api_key, "Content-Type": "application/json"},
                json={"inputs": {"email": email}},
            )
            resp.raise_for_status()
            data = resp.json()
            pred = data.get("prediction", data)
            return CheckEmailResponse(
                is_disposable=bool(pred.get("is_disposable", False)),
                risk_score=float(pred.get("risk_score", 0.0)),
                confidence=str(pred.get("confidence", "low")),
            )
    except Exception:
        return CheckEmailResponse(is_disposable=False, risk_score=0.0, confidence="unavailable")


@router.post("/check-email", response_model=CheckEmailResponse)
async def check_email(body: CheckEmailRequest) -> CheckEmailResponse:
    """Check if an email is disposable. Safe fallback if inference is unavailable."""
    return await _run_disposable_check(body.email)


class UpdateEmailRequest(BaseModel):
    email: str


class UpdateEmailResponse(BaseModel):
    is_disposable: bool
    attempts: int
    email: str


@router.patch("/me/email", response_model=UpdateEmailResponse)
async def update_my_email(body: UpdateEmailRequest, authorization: Optional[str] = Header(None)) -> UpdateEmailResponse:
    """Update email — re-checks disposable service. Clean: saves + clears flags. Still disposable: increments counter."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    check = await _run_disposable_check(body.email)
    if check.is_disposable and check.confidence != "unavailable":
        user.disposable_email_attempts = (user.disposable_email_attempts or 0) + 1
        user.disposable_email_used = True
        await user.save()
        try:
            from app.services.audit_service import log_action as _audit
            await _audit(
                actor_email=user.email,
                action="disposable_email_update_attempt",
                resource_type="user",
                resource_id=str(user.id),
                details={
                    "attempted_email": body.email,
                    "risk_score": check.risk_score,
                    "confidence": check.confidence,
                    "attempts": user.disposable_email_attempts,
                },
            )
        except Exception:
            pass
        return UpdateEmailResponse(is_disposable=True, attempts=user.disposable_email_attempts, email=user.email)

    user.email = body.email
    user.disposable_email_used = False
    user.disposable_email_ignored = False
    user.disposable_email_attempts = 0
    await user.save()
    return UpdateEmailResponse(is_disposable=False, attempts=0, email=body.email)


@router.post("/me/email/ignore")
async def ignore_disposable_email(authorization: Optional[str] = Header(None)) -> dict:
    """User chose to keep their disposable email — flag the account."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    user.disposable_email_used = True
    user.disposable_email_ignored = True
    await user.save()
    try:
        from app.services.audit_service import log_action as _audit
        await _audit(
            actor_email=user.email,
            action="disposable_email_ignored",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": user.email},
        )
    except Exception:
        pass
    return {"ok": True}


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_onboarded: Optional[bool] = None


def _user_dict(user) -> dict:
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "is_onboarded": user.is_onboarded,
        "github_connected": bool(getattr(user, "github_access_token", None)),
        "avatar_url": getattr(user, "avatar_url", None) or "",
    }


@router.patch("/profile")
async def update_profile(body: UpdateProfileRequest, authorization: Optional[str] = Header(None)):
    """Update the authenticated user's profile (full_name and/or role)."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    # Only allow valid role upgrades: viewer → engineer
    if body.role is not None:
        allowed_roles = {"viewer", "engineer", "admin", "annotator"}
        if body.role not in allowed_roles:
            raise HTTPException(status_code=400, detail="Invalid role")
        # Viewers can only upgrade to engineer; other roles unchanged by self
        if user.role == "viewer" and body.role not in ("viewer", "engineer"):
            raise HTTPException(status_code=403, detail="Viewers may only upgrade to engineer")
        user.role = body.role

    if body.full_name is not None:
        user.full_name = body.full_name.strip()

    if body.is_onboarded is not None:
        user.is_onboarded = body.is_onboarded

    await user.save()
    return _user_dict(user)


# ── OAuth (Google + GitHub) ────────────────────────────────────────────────────

import secrets as _secrets

# ── CLI Device Login ────────────────────────────────────────────────────────────

import secrets as _cli_secrets

_CLI_SESSION_TTL = 300  # 5 minutes


def _cli_redis():
    """Return a synchronous-compatible async Redis client for CLI session ops."""
    import redis.asyncio as aioredis
    from app.core.config import settings
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


@router.post("/cli-session/request")
async def cli_session_request():
    """
    CLI device flow — Step 1: Request a login link.
    Returns a login URL and a device_code for polling.
    No authentication required.
    """
    device_code = _cli_secrets.token_urlsafe(32)
    r = _cli_redis()
    try:
        await r.set(f"cli_session:{device_code}", "pending", ex=_CLI_SESSION_TTL)
    finally:
        await r.aclose()

    from app.core.config import settings
    base = (settings.FRONTEND_BASE_URL or settings.APP_BASE_URL).rstrip("/")
    login_url = f"{base}/cli-login?code={device_code}"
    return {
        "device_code": device_code,
        "login_url": login_url,
        "expires_in": _CLI_SESSION_TTL,
    }


@router.get("/cli-session/poll/{device_code}")
async def cli_session_poll(device_code: str):
    """
    CLI device flow — Step 2: Poll for authorization.
    Returns {"status": "pending"} or {"status": "authorized", "token": "...", "user": {...}}.
    """
    r = _cli_redis()
    try:
        value = await r.get(f"cli_session:{device_code}")
    finally:
        await r.aclose()

    if value is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Device code expired or not found")

    if value == "pending":
        return {"status": "pending"}

    # value is JSON-encoded token + user on authorized
    import json as _json
    data = _json.loads(value)
    return {"status": "authorized", "token": data["token"], "user": data["user"]}


@router.post("/cli-session/confirm/{device_code}")
async def cli_session_confirm(device_code: str, authorization: Optional[str] = Header(None)):
    """
    CLI device flow — Step 3: Authorize the device (called from web browser after login).
    Requires the user to be authenticated (Bearer token in header).
    """
    from fastapi import HTTPException
    import json as _json

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    r = _cli_redis()
    try:
        value = await r.get(f"cli_session:{device_code}")
        if value is None:
            raise HTTPException(status_code=404, detail="Device code expired or not found")
        if value != "pending":
            raise HTTPException(status_code=409, detail="Device code already used")

        # Store the access token and user info so the CLI can retrieve it
        access = auth_service.make_access_token(user)
        payload = _json.dumps({"token": access, "user": _user_dict(user)})
        await r.set(f"cli_session:{device_code}", payload, ex=60)  # 60s to retrieve
    finally:
        await r.aclose()

    return {"ok": True, "message": "CLI session authorized. You can close this tab."}


def _is_noreply_email(email: str) -> bool:
    """Return True for GitHub-generated no-reply addresses."""
    return bool(email and email.endswith("@users.noreply.github.com"))


class OAuthExchangeRequest(BaseModel):
    code: str
    redirect_uri: str


@router.get("/oauth/{provider}/url")
async def oauth_url(provider: str, redirect_uri: str):
    """Return the authorization URL to redirect the user to."""
    from fastapi import HTTPException
    from app.core.config import settings

    state = _secrets.token_urlsafe(16)

    if provider == "google":
        if not settings.GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=503, detail="Google OAuth not configured")
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
        }
        from urllib.parse import urlencode
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)

    elif provider == "github":
        if not settings.GITHUB_CLIENT_ID:
            raise HTTPException(status_code=503, detail="GitHub OAuth not configured")
        params = {
            "client_id": settings.GITHUB_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": "read:user user:email repo",
            "state": state,
        }
        from urllib.parse import urlencode
        url = "https://github.com/login/oauth/authorize?" + urlencode(params)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    return {"url": url, "state": state}


@router.post("/oauth/{provider}/exchange")
async def oauth_exchange(provider: str, body: OAuthExchangeRequest):
    """Exchange an authorization code for MLDock tokens."""
    from fastapi import HTTPException
    from app.core.config import settings
    import httpx

    try:
        _github_access_token: Optional[str] = None
        _github_avatar_url: str = ""
        if provider == "google":
            async with httpx.AsyncClient(timeout=10) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": body.code,
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "redirect_uri": body.redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                token_resp.raise_for_status()
                access_token = token_resp.json()["access_token"]

                info_resp = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                info_resp.raise_for_status()
                info = info_resp.json()

            oauth_id = info["id"]
            email = info.get("email", "")
            full_name = info.get("name", "")
            _github_avatar_url = info.get("picture", "")

        elif provider == "github":
            async with httpx.AsyncClient(timeout=10) as client:
                token_resp = await client.post(
                    "https://github.com/login/oauth/access_token",
                    data={
                        "code": body.code,
                        "client_id": settings.GITHUB_CLIENT_ID,
                        "client_secret": settings.GITHUB_CLIENT_SECRET,
                        "redirect_uri": body.redirect_uri,
                    },
                    headers={"Accept": "application/json"},
                )
                token_resp.raise_for_status()
                token_data = token_resp.json()
                access_token = token_data.get("access_token", "")
                if not access_token:
                    gh_error = token_data.get("error_description") or token_data.get("error") or "GitHub did not return an access token"
                    raise HTTPException(status_code=400, detail=gh_error)

                # GitHub OAuth tokens use "token <tok>" not "Bearer <tok>"
                # ("Bearer" is for GitHub Apps / JWTs and returns 401 for OAuth App tokens)
                gh_auth_header = f"token {access_token}"
                user_resp = await client.get(
                    "https://api.github.com/user",
                    headers={"Authorization": gh_auth_header, "Accept": "application/vnd.github+json"},
                )
                user_resp.raise_for_status()
                gh_user = user_resp.json()

                # GitHub may not expose email publicly — always fetch /user/emails for best result
                email = gh_user.get("email") or ""
                emails_resp = await client.get(
                    "https://api.github.com/user/emails",
                    headers={"Authorization": gh_auth_header, "Accept": "application/vnd.github+json"},
                )
                if emails_resp.status_code == 200:
                    all_emails = emails_resp.json()
                    real_emails = [e for e in all_emails if not _is_noreply_email(e.get("email", ""))]
                    # Preference: real primary+verified → real verified → real primary → real any
                    # → then fall back to noreply with same priority order
                    email = (
                        next((e["email"] for e in real_emails if e.get("primary") and e.get("verified")), None)
                        or next((e["email"] for e in real_emails if e.get("verified")), None)
                        or next((e["email"] for e in real_emails if e.get("primary")), None)
                        or next((e["email"] for e in real_emails if e.get("email")), None)
                        or next((e["email"] for e in all_emails if e.get("primary") and e.get("verified")), None)
                        or next((e["email"] for e in all_emails if e.get("verified")), None)
                        or next((e["email"] for e in all_emails if e.get("primary")), None)
                        or next((e["email"] for e in all_emails if e.get("email")), None)
                        or email  # keep profile email if emails list was unhelpful
                    )
                # Final fallback: synthesise noreply from GitHub login
                if not email or _is_noreply_email(email):
                    # If we already have something, keep it — only synthesise if truly nothing
                    if not email:
                        login = gh_user.get("login", "")
                        gh_id = gh_user.get("id", "")
                        if login:
                            email = f"{gh_id}+{login}@users.noreply.github.com"

            oauth_id = str(gh_user["id"])
            full_name = gh_user.get("name") or gh_user.get("login", "")
            _github_access_token = access_token  # store for repo access
            _github_avatar_url = gh_user.get("avatar_url", "")

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

        if not email:
            raise HTTPException(status_code=400, detail="Could not retrieve email from OAuth provider")

        user = await auth_service.oauth_login_or_register(provider, oauth_id, email, full_name)

        # Persist OAuth-sourced fields (token, avatar, real email upgrade)
        # Use raw Motor update to avoid Beanie RevisionIdWasChanged (oauth_login_or_register
        # already called user.set() which incremented revision_id, making our object stale).
        updates: dict = {}
        if _github_access_token:
            updates["github_access_token"] = _github_access_token
        if _github_avatar_url and not user.avatar_url:
            updates["avatar_url"] = _github_avatar_url
        # Upgrade noreply → real email on every login
        if _is_noreply_email(user.email) and email and not _is_noreply_email(email):
            updates["email"] = email
        if updates:
            from bson import ObjectId as _OID
            from pymongo.errors import DuplicateKeyError as _DupKey
            try:
                await user.get_motor_collection().update_one(
                    {"_id": _OID(str(user.id))},
                    {"$set": updates},
                )
                if "email" in updates:
                    user.email = email
            except _DupKey:
                # Real email already belongs to another account — skip email upgrade,
                # the user will be linked properly on next login via oauth_login_or_register.
                updates.pop("email", None)
                if updates:
                    await user.get_motor_collection().update_one(
                        {"_id": _OID(str(user.id))},
                        {"$set": updates},
                    )

        return {
            "access_token": auth_service.make_access_token(user),
            "refresh_token": auth_service.make_refresh_token(user),
            "token_type": "bearer",
            "user": {
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "org_id": user.org_id,
                "is_onboarded": user.is_onboarded,
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        import traceback as _tb
        detail = f"OAuth failed [{type(exc).__name__}]: {exc or '(no message)'}\n{_tb.format_exc()}"
        raise HTTPException(status_code=400, detail=detail)


# ── GitHub repo listing + disconnect ──────────────────────────────────────────

class GitHubConnectRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/github/connect")
async def github_connect(body: GitHubConnectRequest, authorization: Optional[str] = Header(None)):
    """Link GitHub to an existing MLDock account (for email/password users)."""
    from fastapi import HTTPException
    from app.core.config import settings
    import httpx

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)

    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_resp = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "code": body.code,
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "redirect_uri": body.redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            github_token = token_resp.json().get("access_token", "")
            if not github_token:
                raise HTTPException(status_code=400, detail="GitHub did not return an access token")

        await user.set({"github_access_token": github_token})
        return {"ok": True, "github_connected": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GitHub connect failed: {exc}")


@router.delete("/github/disconnect")
async def github_disconnect(authorization: Optional[str] = Header(None)):
    """Unlink GitHub from the current account."""
    from fastapi import HTTPException
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token)
    await user.set({"github_access_token": None})
    return {"ok": True, "github_connected": False}


_ML_INDICATORS = {
    "files": {
        "requirements.txt", "setup.py", "setup.cfg", "pyproject.toml",
        "Pipfile", "environment.yml", "conda.yml",
        "train.py", "training.py", "model.py", "predict.py",
        "inference.py", "evaluate.py",
    },
    "extensions": {".ipynb", ".pt", ".pth", ".pkl", ".h5", ".onnx", ".pb"},
    "content_keywords": {
        "torch", "tensorflow", "keras", "sklearn", "scikit-learn",
        "transformers", "numpy", "pandas", "xgboost", "lightgbm",
        "BaseTrainer", "nn.Module", "fit(", "predict(",
    },
}

_ML_TOPICS = {
    "machine-learning", "deep-learning", "neural-network", "pytorch", "tensorflow",
    "scikit-learn", "computer-vision", "nlp", "natural-language-processing",
    "data-science", "ai", "artificial-intelligence", "ml", "model-training",
}


def _detect_ml(repo: dict) -> bool:
    """Heuristically detect if a GitHub repo is an ML project."""
    # 1. Topics
    topics = set(repo.get("topics") or [])
    if topics & _ML_TOPICS:
        return True
    # 2. Language
    lang = (repo.get("language") or "").lower()
    if lang == "jupyter notebook":
        return True
    # 3. Description keywords
    desc = (repo.get("description") or "").lower()
    if any(kw in desc for kw in ("machine learning", "deep learning", "neural", "model", "train", "pytorch", "tensorflow")):
        return True
    return False


@router.get("/github/repos")
async def list_github_repos(
    page: int = 1,
    per_page: int = 30,
    authorization: Optional[str] = Header(None),
):
    """List the authenticated user's GitHub repos; annotate ML projects."""
    from fastapi import HTTPException
    import httpx

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_str = authorization.split(" ", 1)[1]
    user = await auth_service.get_current_user(token_str)

    if not user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub not connected. Connect via /auth/github/connect or sign in with GitHub.")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.github.com/user/repos",
                params={
                    "sort": "updated",
                    "per_page": per_page,
                    "page": page,
                    "affiliation": "owner,collaborator",
                },
                headers={
                    "Authorization": f"token {user.github_access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            if resp.status_code == 401:
                # Token revoked — clear it
                await user.set({"github_access_token": None})
                raise HTTPException(status_code=401, detail="GitHub token expired. Please reconnect GitHub.")
            resp.raise_for_status()
            repos = resp.json()

        result = []
        for r in repos:
            result.append({
                "id": r["id"],
                "name": r["name"],
                "full_name": r["full_name"],
                "description": r.get("description") or "",
                "html_url": r["html_url"],
                "clone_url": r["clone_url"],
                "ssh_url": r.get("ssh_url", ""),
                "default_branch": r.get("default_branch", "main"),
                "language": r.get("language") or "",
                "topics": r.get("topics") or [],
                "private": r.get("private", False),
                "updated_at": r.get("updated_at") or "",
                "stargazers_count": r.get("stargazers_count", 0),
                "is_ml_project": _detect_ml(r),
            })

        return {"repos": result, "page": page, "per_page": per_page, "total": len(result)}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {exc}")
