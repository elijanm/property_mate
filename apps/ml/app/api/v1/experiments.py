"""MLflow experiment management and comparison."""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.dependencies.auth import require_roles
from app.services import experiment_service
from app.services.circuit_breaker_service import get_all_states

router = APIRouter(prefix="/experiments", tags=["experiments"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class CompareRequest(BaseModel):
    run_ids: List[str]


@router.get("", dependencies=[_any_role])
async def list_experiments():
    return await experiment_service.list_experiments()


@router.get("/{experiment_id}/runs", dependencies=[_any_role])
async def list_runs(experiment_id: str, limit: int = Query(50)):
    return await experiment_service.list_runs(experiment_id, limit)


@router.post("/compare", dependencies=[_any_role])
async def compare_runs(body: CompareRequest):
    return await experiment_service.compare_runs(body.run_ids)


@router.get("/circuit-breakers", dependencies=[_any_role])
async def circuit_breaker_states():
    return await get_all_states()


@router.delete("/circuit-breakers/{trainer_name}", dependencies=[_engineer])
async def reset_circuit_breaker(trainer_name: str):
    from app.services.circuit_breaker_service import reset
    await reset(trainer_name)
    return {"reset": trainer_name}
