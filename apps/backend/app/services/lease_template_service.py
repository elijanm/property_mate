import structlog

from app.core.exceptions import ResourceNotFoundError
from app.dependencies.auth import CurrentUser
from app.models.lease_template import LeaseTemplate
from app.repositories.lease_template_repository import lease_template_repository
from app.schemas.lease_template import (
    LeaseTemplateCreateRequest,
    LeaseTemplateUpdateRequest,
    LeaseTemplateResponse,
)

logger = structlog.get_logger(__name__)


def _to_response(t: LeaseTemplate) -> LeaseTemplateResponse:
    return LeaseTemplateResponse(
        id=str(t.id),
        org_id=t.org_id,
        name=t.name,
        description=t.description,
        rent_amount=t.rent_amount,
        deposit_amount=t.deposit_amount,
        deposit_rule=t.deposit_rule,
        utility_deposit=t.utility_deposit,
        utilities=[u.model_dump() for u in t.utilities],
        early_termination_penalty_type=t.early_termination_penalty_type,
        early_termination_penalty_value=t.early_termination_penalty_value,
        notice_days=t.notice_days,
        additional_clauses=t.additional_clauses,
        created_by=t.created_by,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
    )


async def list_templates(current_user: CurrentUser):
    templates = await lease_template_repository.list_by_org(current_user.org_id)
    return [_to_response(t) for t in templates]


async def create_template(data: LeaseTemplateCreateRequest, current_user: CurrentUser) -> LeaseTemplateResponse:
    from app.models.lease_template import LeaseTemplateUtility
    utilities = [LeaseTemplateUtility(**u.model_dump()) for u in data.utilities]
    t = LeaseTemplate(
        org_id=current_user.org_id,
        created_by=str(current_user.user_id),
        name=data.name,
        description=data.description,
        rent_amount=data.rent_amount,
        deposit_amount=data.deposit_amount,
        deposit_rule=data.deposit_rule,
        utility_deposit=data.utility_deposit,
        utilities=utilities,
        early_termination_penalty_type=data.early_termination_penalty_type,
        early_termination_penalty_value=data.early_termination_penalty_value,
        notice_days=data.notice_days,
        additional_clauses=data.additional_clauses,
    )
    await lease_template_repository.create(t)
    logger.info("lease_template_created", action="create_template", resource_type="lease_template",
                resource_id=str(t.id), org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(t)


async def update_template(template_id: str, data: LeaseTemplateUpdateRequest, current_user: CurrentUser) -> LeaseTemplateResponse:
    t = await lease_template_repository.get_by_id(template_id, current_user.org_id)
    if not t:
        raise ResourceNotFoundError("LeaseTemplate", template_id)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    await lease_template_repository.save(t)
    logger.info("lease_template_updated", action="update_template", resource_type="lease_template",
                resource_id=template_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
    return _to_response(t)


async def delete_template(template_id: str, current_user: CurrentUser) -> None:
    t = await lease_template_repository.get_by_id(template_id, current_user.org_id)
    if not t:
        raise ResourceNotFoundError("LeaseTemplate", template_id)
    await lease_template_repository.soft_delete(t)
    logger.info("lease_template_deleted", action="delete_template", resource_type="lease_template",
                resource_id=template_id, org_id=current_user.org_id,
                user_id=str(current_user.user_id), status="success")
