from fastapi import APIRouter, Depends, UploadFile, File

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.move_out import (
    MoveOutCreateRequest,
    MoveOutApproveRequest,
    ChecklistItemUpdateRequest,
    DamageItemCreateRequest,
    MoveOutInspectionResponse,
)
from app.services import move_out_service

router = APIRouter(tags=["Move Out"])


@router.post(
    "/leases/{lease_id}/move-out",
    response_model=MoveOutInspectionResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_inspection(
    lease_id: str,
    data: MoveOutCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.create_inspection(lease_id, data, current_user)


@router.get(
    "/leases/{lease_id}/move-out",
    response_model=MoveOutInspectionResponse,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def get_inspection(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.get_inspection(lease_id, current_user)


@router.patch(
    "/leases/{lease_id}/move-out/checklist/{item_id}",
    response_model=MoveOutInspectionResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_checklist(
    lease_id: str,
    item_id: str,
    data: ChecklistItemUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.update_checklist_item(lease_id, item_id, data, current_user)


@router.post(
    "/leases/{lease_id}/move-out/damages",
    response_model=MoveOutInspectionResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_damage(
    lease_id: str,
    data: DamageItemCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.add_damage(lease_id, data, current_user)


@router.post(
    "/leases/{lease_id}/move-out/damages/{damage_id}/photo",
    response_model=MoveOutInspectionResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def upload_damage_photo(
    lease_id: str,
    damage_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.upload_damage_photo(lease_id, damage_id, file, current_user)


@router.post(
    "/leases/{lease_id}/move-out/approve",
    response_model=MoveOutInspectionResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def approve_inspection(
    lease_id: str,
    data: MoveOutApproveRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    return await move_out_service.approve_inspection(lease_id, data, current_user)
