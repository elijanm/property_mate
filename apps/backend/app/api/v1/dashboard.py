"""Dashboard API — single aggregated endpoint for the owner dashboard."""
from fastapi import APIRouter, Depends

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.dashboard import DashboardData
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "",
    response_model=DashboardData,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_dashboard(
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardData:
    return await dashboard_service.get_dashboard(current_user)
