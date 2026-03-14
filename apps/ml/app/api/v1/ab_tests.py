"""A/B test management endpoints."""
from typing import Optional
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
    model_a: str
    model_b: str
    traffic_pct_b: int = 10


class UpdateABTestRequest(BaseModel):
    traffic_pct_b: Optional[int] = None
    status: Optional[str] = None
    winner: Optional[str] = None
    description: Optional[str] = None


@router.post("", dependencies=[_engineer])
async def create_test(
    body: CreateABTestRequest,
    user=Depends(get_current_user),
):
    test = await ab_test_service.create_test(body.name, body.model_a, body.model_b, body.traffic_pct_b, body.description, user.email, user.org_id)
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
    from app.models.ab_test import ABTest
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    return _fmt(t)


@router.patch("/{test_id}", dependencies=[_engineer])
async def update_test(test_id: str, body: UpdateABTestRequest, user=Depends(get_current_user)):
    from app.models.ab_test import ABTest
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    t = await ab_test_service.update_test(test_id, **body.model_dump(exclude_none=True))
    return _fmt(t)


@router.delete("/{test_id}", status_code=204, dependencies=[_engineer])
async def delete_test(test_id: str, user=Depends(get_current_user)):
    from app.models.ab_test import ABTest
    t = await ab_test_service.get_test(test_id)
    if t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="A/B test not found")
    await ab_test_service.delete_test(test_id)


def _fmt(t):
    return {
        "id": str(t.id), "name": t.name, "description": t.description,
        "model_a": t.model_a, "model_b": t.model_b, "traffic_pct_b": t.traffic_pct_b,
        "status": t.status, "winner": t.winner,
        "metrics_a": {"requests": t.metrics_a.requests, "error_rate": t.metrics_a.error_rate, "avg_latency_ms": t.metrics_a.avg_latency_ms, "accuracy": t.metrics_a.accuracy},
        "metrics_b": {"requests": t.metrics_b.requests, "error_rate": t.metrics_b.error_rate, "avg_latency_ms": t.metrics_b.avg_latency_ms, "accuracy": t.metrics_b.accuracy},
        "created_by": t.created_by, "created_at": t.created_at, "concluded_at": t.concluded_at,
    }
