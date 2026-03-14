from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from redis.asyncio import Redis

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.dependencies.redis import get_redis_dep
from app.schemas.lease import UnitPricingResponse
from app.schemas.unit import (
    BulkUpdateRequest,
    BulkUpdateResponse,
    UnitListResponse,
    UnitReserveRequest,
    UnitResponse,
    UnitUpdateRequest,
)
from app.services import unit_service
from app.utils.datetime import utc_now

router = APIRouter(tags=["units"])


@router.get(
    "/properties/{property_id}/units",
    response_model=UnitListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_units(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    pagination: PaginationParams = Depends(get_pagination),
    status: Optional[str] = Query(default=None),
    wing: Optional[str] = Query(default=None),
    floor: Optional[int] = Query(default=None),
    unit_type: Optional[str] = Query(default=None),
) -> UnitListResponse:
    return await unit_service.list_units(
        property_id=property_id,
        current_user=current_user,
        pagination=pagination,
        status=status,
        wing=wing,
        floor=floor,
        unit_type=unit_type,
    )


@router.patch(
    "/units/{unit_id}",
    response_model=UnitResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_unit(
    unit_id: str,
    request: UnitUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> UnitResponse:
    return await unit_service.update_unit(unit_id, request, current_user, redis)


@router.post(
    "/properties/{property_id}/units/bulk-update",
    response_model=BulkUpdateResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def bulk_update_units(
    property_id: str,
    request: BulkUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> BulkUpdateResponse:
    return await unit_service.bulk_update_units(property_id, request, current_user, redis)


@router.post(
    "/units/{unit_id}/reserve",
    response_model=UnitResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def reserve_unit(
    unit_id: str,
    request: UnitReserveRequest,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> UnitResponse:
    return await unit_service.reserve_unit(
        unit_id=unit_id,
        tenant_id=request.tenant_id,
        onboarding_id=request.onboarding_id,
        current_user=current_user,
        redis=redis,
    )


@router.post(
    "/units/{unit_id}/release-reservation",
    response_model=UnitResponse,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def release_reservation(
    unit_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> UnitResponse:
    return await unit_service.release_reservation(unit_id, current_user, redis)


@router.get(
    "/units/{unit_id}",
    response_model=UnitResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_unit(
    unit_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> UnitResponse:
    return await unit_service.get_unit(unit_id, current_user)


@router.get(
    "/units/{unit_id}/pricing",
    response_model=UnitPricingResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_unit_pricing(
    unit_id: str,
    move_in_date: Optional[date] = Query(default=None, description="Move-in date for pro-rated rent calculation (YYYY-MM-DD)"),
    current_user: CurrentUser = Depends(get_current_user),
) -> UnitPricingResponse:
    return await unit_service.get_unit_pricing(unit_id, current_user, move_in_date)


@router.post(
    "/units/{unit_id}/seed-water-readings",
    response_model=Dict[str, Any],
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def seed_water_readings(
    unit_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Seed 30 days of simulated hourly water meter readings for testing smart meter integration."""
    import random
    import math
    from datetime import timedelta
    from app.models.meter_reading import MeterReading
    from app.models.unit import Unit
    from beanie import PydanticObjectId as OID

    unit = await Unit.find_one({"_id": OID(unit_id), "org_id": current_user.org_id, "deleted_at": None})
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    now = utc_now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30)

    # Simulate realistic water usage: base daily usage 200-400L, peaks at 7am, 12pm, 7pm
    readings = []
    cumulative = random.uniform(1000, 5000)  # starting meter value (litres)
    prev = None

    for day in range(30):
        day_start = start + timedelta(days=day)
        # 3 readings per day at peak hours
        for hour in [7, 13, 19]:
            ts = day_start.replace(hour=hour)
            # Usage per session: base + day_of_month pattern + noise
            base_usage = random.uniform(15, 45)
            # Weekend spike
            if day_start.weekday() >= 5:
                base_usage *= 1.3
            # First few days of month tend to be higher (post-weekend cleaning)
            if day_start.day <= 3:
                base_usage *= 1.2
            # Add seasonal sine wave
            seasonal = 1 + 0.15 * math.sin(2 * math.pi * day / 30)
            usage = base_usage * seasonal + random.gauss(0, 3)
            usage = max(5, usage)
            cumulative += usage
            r = MeterReading(
                org_id=current_user.org_id,
                property_id=str(unit.property_id),
                unit_id=unit_id,
                utility_key="water",
                previous_reading=prev,
                current_reading=round(cumulative, 2),
                units_consumed=round(usage, 2),
                read_at=ts,
                read_by="system:seed",
                source="iot",
                notes="Seeded test data",
            )
            readings.append(r)
            prev = round(cumulative, 2)

    await MeterReading.insert_many(readings)

    # Update unit meter_reading_cache with latest
    latest = readings[-1]
    await unit.set({
        "meter_reading_cache": {
            "water": {
                "value": latest.current_reading,
                "read_at": latest.read_at,
                "read_by": "system:seed",
                "read_by_name": "Seeded Test Data",
            }
        },
        "updated_at": utc_now(),
    })

    return {
        "inserted": len(readings),
        "from": start.isoformat(),
        "to": now.isoformat(),
        "latest_reading": latest.current_reading,
        "total_consumed": round(sum(r.units_consumed or 0 for r in readings), 2),
        "utility_key": "water",
        "unit_id": unit_id,
    }
