"""A/B test traffic routing and metrics."""
import random
from typing import Optional
import structlog
from fastapi import HTTPException

from app.models.ab_test import ABTest, VariantMetrics
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def create_test(name: str, model_a: str, model_b: str, traffic_pct_b: int, description: str = "", created_by: str = "", org_id: str = "") -> ABTest:
    if await ABTest.find_one({"name": name, "status": "active", "org_id": org_id}):
        raise HTTPException(status_code=409, detail="Active A/B test with this name already exists")
    test = ABTest(name=name, model_a=model_a, model_b=model_b, traffic_pct_b=traffic_pct_b, description=description, created_by=created_by, org_id=org_id)
    await test.insert()
    return test


async def list_tests(status: Optional[str] = None, org_id: str = "") -> list[ABTest]:
    q: dict = {"org_id": org_id}
    if status:
        q["status"] = status
    return await ABTest.find(q).sort("-created_at").to_list()


async def get_test(test_id: str) -> ABTest:
    t = await ABTest.get(test_id)
    if not t:
        raise HTTPException(status_code=404, detail="A/B test not found")
    return t


async def update_test(test_id: str, **kwargs) -> ABTest:
    t = await get_test(test_id)
    for k, v in kwargs.items():
        if v is not None:
            setattr(t, k, v)
    if kwargs.get("status") == "concluded":
        t.concluded_at = utc_now()
    await t.save()
    return t


async def delete_test(test_id: str) -> None:
    t = await get_test(test_id)
    await t.delete()


def route_request(test: ABTest) -> str:
    """Return 'a' or 'b' based on traffic split."""
    if random.randint(1, 100) <= test.traffic_pct_b:
        return "b"
    return "a"


async def get_active_test_for_trainer(trainer_name: str) -> Optional[ABTest]:
    """Return active A/B test where this trainer is model_a or model_b."""
    return await ABTest.find_one({
        "$and": [
            {"status": "active"},
            {"$or": [{"model_a": trainer_name}, {"model_b": trainer_name}]},
        ]
    })


async def record_request(test: ABTest, variant: str, latency_ms: float, error: bool = False) -> None:
    field = "metrics_a" if variant == "a" else "metrics_b"
    metrics: VariantMetrics = getattr(test, field)
    metrics.requests += 1
    metrics.total_latency_ms += latency_ms
    if error:
        metrics.errors += 1
    await test.save()
