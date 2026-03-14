from fastapi import APIRouter, Depends

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.lease_template import (
    LeaseTemplateCreateRequest,
    LeaseTemplateUpdateRequest,
    LeaseTemplateResponse,
)
from app.services import lease_template_service

router = APIRouter(tags=["Lease Templates"])


@router.get(
    "/lease-templates",
    response_model=list[LeaseTemplateResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_templates(current_user: CurrentUser = Depends(get_current_user)):
    return await lease_template_service.list_templates(current_user)


@router.post(
    "/lease-templates",
    response_model=LeaseTemplateResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def create_template(
    data: LeaseTemplateCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await lease_template_service.create_template(data, current_user)


@router.patch(
    "/lease-templates/{template_id}",
    response_model=LeaseTemplateResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def update_template(
    template_id: str,
    data: LeaseTemplateUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await lease_template_service.update_template(template_id, data, current_user)


@router.delete(
    "/lease-templates/{template_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    await lease_template_service.delete_template(template_id, current_user)
