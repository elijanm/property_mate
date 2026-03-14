"""SHAP / explainability endpoints."""
from fastapi import APIRouter, Depends
from app.dependencies.auth import require_roles
from app.services import shap_service

router = APIRouter(prefix="/explain", tags=["explain"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))


@router.get("/{log_id}", dependencies=[_any_role])
async def explain_prediction(log_id: str):
    return await shap_service.explain_prediction(log_id)
