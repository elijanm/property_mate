from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.exceptions import ResourceNotFoundError
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.dependencies.pagination import PaginationParams, get_pagination
from app.models.meter_reading import MeterReading
from app.repositories.meter_reading_repository import meter_reading_repository
from app.repositories.property_repository import property_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.schemas.meter_reading import (
    MeterReadingCreateRequest,
    MeterReadingListResponse,
    MeterReadingResponse,
)
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId
router = APIRouter(prefix="/properties/{property_id}/meter-readings", tags=["meter-readings"])


def _resolve_name(user) -> str:
    """Always returns a non-empty display string — never a bare UUID."""
    if not user:
        return "Unknown"
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or str(user.email) or "Unknown"


def _to_response(r: MeterReading, read_by_name: str = "Unknown") -> MeterReadingResponse:
    return MeterReadingResponse(
        id=str(r.id),
        org_id=r.org_id,
        property_id=r.property_id,
        unit_id=r.unit_id,
        utility_key=r.utility_key,
        previous_reading=r.previous_reading,
        current_reading=r.current_reading,
        units_consumed=r.units_consumed,
        read_at=r.read_at,
        read_by=r.read_by,
        read_by_name=read_by_name,
        source=r.source,
        notes=r.notes,
        created_at=r.created_at,
    )


@router.post(
    "",
    response_model=MeterReadingResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def record_meter_reading(
    property_id: str,
    req: MeterReadingCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MeterReadingResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    if req.unit_id is not None:
        unit = await unit_repository.get_by_id(req.unit_id, current_user.org_id)
        if not unit or str(unit.property_id) != property_id:
            raise ResourceNotFoundError("Unit", req.unit_id)

    # Fetch the previous reading to compute consumption
    prev = await meter_reading_repository.get_latest(
        org_id=current_user.org_id,
        unit_id=req.unit_id,
        utility_key=req.utility_key,
    )
    previous_reading = prev.current_reading if prev else None
    units_consumed: Optional[float] = None
    if previous_reading is not None:
        units_consumed = max(0.0, req.current_reading - previous_reading)

    reading = MeterReading(
        org_id=current_user.org_id,
        property_id=property_id,
        unit_id=req.unit_id,
        utility_key=req.utility_key,
        previous_reading=previous_reading,
        current_reading=req.current_reading,
        units_consumed=units_consumed,
        read_at=req.read_at or utc_now(),
        read_by=current_user.user_id,
        source=req.source,
        notes=req.notes,
    )
    await meter_reading_repository.create(reading)

    actor = await user_repository.get_by_id(current_user.user_id)
    actor_name = _resolve_name(actor)

    # Keep unit's cache in sync so billing and UI always have fast access
    if req.unit_id:
        await unit_repository.cache_meter_reading(
            unit_id=req.unit_id,
            org_id=current_user.org_id,
            utility_key=req.utility_key,
            value=req.current_reading,
            read_at=reading.read_at,
            read_by=current_user.user_id,
            read_by_name=actor_name,
        )

    return _to_response(reading, actor_name)


@router.get(
    "",
    response_model=MeterReadingListResponse,
    dependencies=[Depends(require_roles("owner", "agent"))],
)
async def list_meter_readings(
    property_id: str,
    unit_id: Optional[str] = Query(default=None),
    utility_key: Optional[str] = Query(default=None),
    pagination: PaginationParams = Depends(get_pagination),
    current_user: CurrentUser = Depends(get_current_user),
) -> MeterReadingListResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    items, total = await meter_reading_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        unit_id=unit_id,
        utility_key=utility_key,
        skip=pagination.skip,
        limit=pagination.page_size,
    )

    # Batch resolve user names
    user_ids = list({r.read_by for r in items if r.read_by})
    users: dict = {}
    for uid in user_ids:
        u = await user_repository.get_by_id(uid)
        users[uid] = _resolve_name(u)   # always a non-empty string

    return MeterReadingListResponse(
        items=[_to_response(r, users.get(r.read_by)) for r in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )
