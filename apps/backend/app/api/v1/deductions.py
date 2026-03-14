from fastapi import APIRouter, Depends

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.deduction import DeductionCreateRequest, DeductionResponse, DeductionSummary
from app.services import deduction_service

router = APIRouter(tags=["deductions"])


@router.post(
    "/leases/{lease_id}/deductions",
    response_model=DeductionResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_deduction(
    lease_id: str,
    request: DeductionCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> DeductionResponse:
    return await deduction_service.add_deduction(lease_id, request, current_user)


@router.get(
    "/leases/{lease_id}/deductions",
    response_model=DeductionSummary,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_deductions(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> DeductionSummary:
    return await deduction_service.list_deductions(lease_id, current_user)


@router.delete(
    "/deductions/{deduction_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def delete_deduction(
    deduction_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await deduction_service.delete_deduction(deduction_id, current_user)
