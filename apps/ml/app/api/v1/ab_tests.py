"""A/B test management endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.services import ab_test_service

router = APIRouter(prefix="/ab-tests", tags=["ab-tests"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class CreateABTestRequest(BaseModel):
    name: str
    description: str = ""
    trainer_name: str
    variant_a: str
    variant_b: str
    traffic_pct_b: int = 10
    metrics_to_use: List[str] = ["requests", "error_rate", "latency", "accuracy"]


class UpdateABTestRequest(BaseModel):
    traffic_pct_b: Optional[int] = None
    status: Optional[str] = None
    winner: Optional[str] = None
    description: Optional[str] = None
    metrics_to_use: Optional[List[str]] = None


@router.post("", dependencies=[_engineer])
async def create_test(
    body: CreateABTestRequest,
    user=Depends(get_current_user),
):
    test = await ab_test_service.create_test(
        name=body.name,
        trainer_name=body.trainer_name,
        variant_a=body.variant_a,
        variant_b=body.variant_b,
        traffic_pct_b=body.traffic_pct_b,
        metrics_to_use=body.metrics_to_use,
        description=body.description,
        created_by=user.email,
        org_id=user.org_id,
    )
    return _fmt(test)


@router.get("")
async def list_tests(
    status: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    tests = await ab_test_service.list_tests(status, user.org_id)
    return [_fmt(t) for t in tests]


@router.get("/{test_id}")
async def get_test(test_id: str, user=Depends(get_current_user)):
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    return _fmt(t)


@router.patch("/{test_id}", dependencies=[_engineer])
async def update_test(test_id: str, body: UpdateABTestRequest, user=Depends(get_current_user)):
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    t = await ab_test_service.update_test(test_id, **body.model_dump(exclude_none=True))
    return _fmt(t)


@router.delete("/{test_id}", status_code=204, dependencies=[_engineer])
async def delete_test(test_id: str, user=Depends(get_current_user)):
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    await ab_test_service.delete_test(test_id)


def _fmt(t):
    return {
        "id": str(t.id),
        "name": t.name,
        "description": t.description,
        "trainer_name": t.trainer_name,
        "variant_a": t.variant_a,
        "variant_b": t.variant_b,
        "traffic_pct_b": t.traffic_pct_b,
        "metrics_to_use": t.metrics_to_use,
        "status": t.status,
        "winner": t.winner,
        "metrics_a": {
            "requests": t.metrics_a.requests,
            "error_rate": t.metrics_a.error_rate,
            "avg_latency_ms": t.metrics_a.avg_latency_ms,
            "accuracy": t.metrics_a.accuracy,
        },
        "metrics_b": {
            "requests": t.metrics_b.requests,
            "error_rate": t.metrics_b.error_rate,
            "avg_latency_ms": t.metrics_b.avg_latency_ms,
            "accuracy": t.metrics_b.accuracy,
        },
        "created_by": t.created_by,
        "created_at": t.created_at,
        "concluded_at": t.concluded_at,
    }
