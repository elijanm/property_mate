from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.s3 import generate_presigned_url, get_s3_client, s3_path
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.models.org import BusinessDetails, LedgerSettings, TaxConfig
from app.repositories.org_repository import org_repository
from app.repositories.user_repository import user_repository
from app.schemas.org import AIConfigResponse, AIConfigUpdateRequest, BillingConfigUpdateRequest, DepositInterestSettingRequest, OrgResponse, OrgUpdateRequest, SignatureConfigUpdateRequest, VoiceSettingsUpdateRequest

router = APIRouter(prefix="/org", tags=["org"])


class OrgUserSummary(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email


async def _to_response(org) -> OrgResponse:
    """Build OrgResponse, replacing any stored S3 key in logo_url with a fresh presigned URL."""
    from app.models.org import SignatureConfig as _SigCfg
    business = org.business
    if business and business.logo_url and not business.logo_url.startswith("http"):
        # logo_url holds an S3 key — swap in a presigned URL for this response
        presigned = await generate_presigned_url(business.logo_url)
        business = BusinessDetails(**{**business.model_dump(), "logo_url": presigned})

    # Resolve signature_config — generate presigned URL for signature_key if present
    sig_cfg = org.signature_config if hasattr(org, "signature_config") else _SigCfg()
    if sig_cfg and sig_cfg.signature_key:
        try:
            sig_url = await generate_presigned_url(sig_cfg.signature_key)
            sig_cfg = _SigCfg(**{**sig_cfg.model_dump(), "signature_key": sig_url})
        except Exception:
            pass

    from app.schemas.org import DepositInterestSettingResponse as _DepositInterestResp
    dep_int = getattr(org, "deposit_interest", None)
    deposit_interest_resp = _DepositInterestResp(
        enabled=dep_int.enabled,
        annual_rate_pct=dep_int.annual_rate_pct,
        compound=dep_int.compound,
        apply_on_refund=dep_int.apply_on_refund,
    ) if dep_int else None

    ai_cfg = getattr(org, "ai_config", None)
    ai_config_resp = AIConfigResponse(
        provider=ai_cfg.provider if ai_cfg else "custom",
        base_url=ai_cfg.base_url if ai_cfg else None,
        model=ai_cfg.model if ai_cfg else None,
        api_key_set=bool(ai_cfg.api_key) if ai_cfg else False,
    )

    return OrgResponse(
        org_id=org.org_id,
        business=business,
        tax_config=org.tax_config,
        ledger_settings=org.ledger_settings,
        billing_config=org.billing_config,
        signature_config=sig_cfg,
        ticket_categories=org.ticket_categories,
        voice_api_audit_enabled=getattr(org, "voice_api_audit_enabled", True),
        deposit_interest=deposit_interest_resp,
        ai_config=ai_config_resp,
        setup_complete=org.setup_complete,
    )


@router.get(
    "/profile",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_org_profile(
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    org = await org_repository.get_or_create(current_user.org_id)
    return await _to_response(org)


@router.patch(
    "/profile",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def update_org_profile(
    req: OrgUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    updates: dict = {}

    if req.business is not None:
        business_data = req.business.model_dump()
        # logo_url is managed exclusively via POST /org/logo.
        # If the frontend sends back a presigned URL (starts with "http"), restore the
        # stored S3 key so we never overwrite a key with a time-limited URL.
        incoming_logo = business_data.get("logo_url")
        if incoming_logo and str(incoming_logo).startswith("http"):
            org_current = await org_repository.get_or_create(current_user.org_id)
            business_data["logo_url"] = org_current.business.logo_url if org_current.business else None
        updates["business"] = business_data

    if req.tax_config is not None:
        updates["tax_config"] = req.tax_config.model_dump()

    if req.ledger_settings is not None:
        updates["ledger_settings"] = req.ledger_settings.model_dump()

    if req.ticket_categories is not None:
        updates["ticket_categories"] = [c.model_dump() for c in req.ticket_categories]

    if req.setup_complete is not None:
        updates["setup_complete"] = req.setup_complete

    if not updates:
        org = await org_repository.get_or_create(current_user.org_id)
        return await _to_response(org)

    org = await org_repository.update(current_user.org_id, updates)
    return await _to_response(org)


@router.post(
    "/logo",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def upload_logo(
    file: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    ext = (file.filename or "logo").rsplit(".", 1)[-1].lower()
    key = s3_path(current_user.org_id, "org", "logo", f"logo.{ext}")

    async with get_s3_client() as s3:
        await s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            key,
            ExtraArgs={"ContentType": file.content_type},
        )

    # Store the S3 key (not a URL) so we can regenerate presigned URLs on each GET
    org = await org_repository.get_or_create(current_user.org_id)
    business_data = org.business.model_dump() if org.business else {"name": ""}
    business_data["logo_url"] = key  # key, not a full URL
    org = await org_repository.update(current_user.org_id, {"business": business_data})
    return await _to_response(org)


@router.post(
    "/signature",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def upload_org_signature(
    file: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    """Upload the org-level default countersignature image."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    ext = (file.filename or "sig").rsplit(".", 1)[-1].lower()
    key = s3_path(current_user.org_id, "org", "signature", f"signature.{ext}")

    async with get_s3_client() as s3:
        await s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            key,
            ExtraArgs={"ContentType": file.content_type},
        )

    org = await org_repository.get_or_create(current_user.org_id)
    sig_data = org.signature_config.model_dump() if org.signature_config else {}
    sig_data["signature_key"] = key
    org = await org_repository.update(current_user.org_id, {"signature_config": sig_data})
    return await _to_response(org)


@router.patch(
    "/signature-config",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def update_org_signature_config(
    req: SignatureConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    """Update the org-level signatory name and title."""
    org = await org_repository.get_or_create(current_user.org_id)
    sig_data = org.signature_config.model_dump() if org.signature_config else {}
    if req.signatory_name is not None:
        sig_data["signatory_name"] = req.signatory_name
    if req.signatory_title is not None:
        sig_data["signatory_title"] = req.signatory_title
    org = await org_repository.update(current_user.org_id, {"signature_config": sig_data})
    return await _to_response(org)


@router.delete(
    "/signature",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def delete_org_signature(
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    """Remove the org-level default signature image."""
    org = await org_repository.get_or_create(current_user.org_id)
    sig_data = org.signature_config.model_dump() if org.signature_config else {}
    sig_data["signature_key"] = None
    org = await org_repository.update(current_user.org_id, {"signature_config": sig_data})
    return await _to_response(org)


@router.patch(
    "/billing-config",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def update_billing_config(
    req: BillingConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    org = await org_repository.get_or_create(current_user.org_id)
    current = org.billing_config.model_dump()
    updates = req.model_dump(exclude_none=True)
    current.update(updates)
    org = await org_repository.update(current_user.org_id, {"billing_config": current})
    return await _to_response(org)


@router.patch(
    "/voice-settings",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner"))],
)
async def update_voice_settings(
    req: VoiceSettingsUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    updates: dict = {}
    if req.voice_api_audit_enabled is not None:
        updates["voice_api_audit_enabled"] = req.voice_api_audit_enabled
    if updates:
        org = await org_repository.update(current_user.org_id, updates)
    else:
        org = await org_repository.get_or_create(current_user.org_id)
    return await _to_response(org)


@router.patch(
    "/deposit-interest",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_deposit_interest(
    data: DepositInterestSettingRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    from app.models.org import DepositInterestSetting
    from app.utils.datetime import utc_now
    org = await org_repository.get_or_create(current_user.org_id)
    org.deposit_interest = DepositInterestSetting(**data.model_dump())
    org.updated_at = utc_now()
    await org.save()
    return await _to_response(org)


@router.patch(
    "/ai-config",
    response_model=OrgResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_ai_config(
    req: AIConfigUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OrgResponse:
    """Update the org-level AI provider configuration."""
    from app.models.org import AIConfig
    org = await org_repository.get_or_create(current_user.org_id)
    existing = org.ai_config.model_dump() if org.ai_config else {}
    updates_dict = req.model_dump(exclude_none=True)
    existing.update(updates_dict)
    org = await org_repository.update(current_user.org_id, {"ai_config": existing})
    return await _to_response(org)


@router.get(
    "/users",
    response_model=List[OrgUserSummary],
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_org_users(
    current_user: CurrentUser = Depends(get_current_user),
) -> List[OrgUserSummary]:
    """Return all staff users in the org (owner + agent roles) for picker dropdowns."""
    users = await user_repository.list_by_org(current_user.org_id)
    return [
        OrgUserSummary(
            id=str(u.id),
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            role=u.role,
        )
        for u in users
        if u.role in ("owner", "agent")
    ]
