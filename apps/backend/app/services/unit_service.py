"""
Unit service — configuration, reservation, bulk updates.
Redis locking + atomic MongoDB updates for concurrent safety.
"""
import calendar
from datetime import date
from typing import Optional

import structlog
from redis.asyncio import Redis

from app.core.exceptions import ConflictError, ForbiddenError, ResourceNotFoundError, ValidationError
from app.core.metrics import (
    UNIT_ASSIGNMENTS,
    UNIT_BULK_UPDATES,
    UNIT_CONFIGURATION_CHANGES,
    UNIT_RESERVATION_CONFLICTS,
)
from app.core.rabbitmq import publish
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import PaginationParams
from app.models.unit import Unit
from app.repositories.audit_log_repository import audit_log_repository
from app.repositories.lease_repository import lease_repository
from app.repositories.onboarding_repository import onboarding_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.property_repository import property_repository
from app.schemas.lease import UnitPricingResponse, UtilityLineItem
from app.schemas.unit import (
    BulkUpdateRequest,
    BulkUpdateResponse,
    UnitListResponse,
    UnitResponse,
    UnitUpdateRequest,
)
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId
logger = structlog.get_logger(__name__)

_LOCK_TTL = 30  # seconds


# ── Redis lock helpers ────────────────────────────────────────────────────────

async def _acquire_lock(redis: Redis, org_id: str, unit_id: str) -> bool:
    key = f"lock:{org_id}:unit_assign:{unit_id}"
    return bool(await redis.set(key, "1", ex=_LOCK_TTL, nx=True))


async def _release_lock(redis: Redis, org_id: str, unit_id: str) -> None:
    await redis.delete(f"lock:{org_id}:unit_assign:{unit_id}")


# ── List / get ────────────────────────────────────────────────────────────────

async def list_units(
    property_id: str,
    current_user: CurrentUser,
    pagination: PaginationParams,
    status: Optional[str] = None,
    wing: Optional[str] = None,
    floor: Optional[int] = None,
    unit_type: Optional[str] = None,
) -> UnitListResponse:
    items, total = await unit_repository.list(
        property_id=property_id,
        org_id=current_user.org_id,
        status=status,
        wing=wing,
        floor=floor,
        unit_type=unit_type,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return UnitListResponse(
        items=[_to_response(u) for u in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


# ── Update single unit ────────────────────────────────────────────────────────

async def update_unit(
    unit_id: str,
    request: UnitUpdateRequest,
    current_user: CurrentUser,
    redis: Redis,
) -> UnitResponse:
    unit = await unit_repository.get_by_id(unit_id, current_user.org_id)
    if not unit:
        raise ResourceNotFoundError("Unit", unit_id)

    # Cannot set occupied without active lease
    if request.status == "occupied":
        active_lease = await lease_repository.get_active_for_unit(unit_id, current_user.org_id)
        if not active_lease:
            raise ValidationError("Cannot set status=occupied without an active lease")

    # Cannot change rent if invoices already issued for current period (business rule)
    # Enforcement deferred to billing module; audit trail covers it

    before_snapshot = _to_response(unit).model_dump(mode="json")

    updates = request.model_dump(exclude_none=True)
    if updates:
        unit = await unit_repository.update(unit, updates)

    UNIT_CONFIGURATION_CHANGES.labels(org_id=current_user.org_id).inc()

    after_snapshot = _to_response(unit).model_dump(mode="json")

    await audit_log_repository.create(
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        resource_type="unit",
        resource_id=unit_id,
        action="update",
        before=before_snapshot,
        after=after_snapshot,
    )

    await _emit_cache_and_index(unit, current_user)

    logger.info(
        "unit_updated",
        action="update_unit",
        resource_type="unit",
        resource_id=unit_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(unit)


# ── Bulk update ───────────────────────────────────────────────────────────────

async def bulk_update_units(
    property_id: str,
    request: BulkUpdateRequest,
    current_user: CurrentUser,
    redis: Redis,
) -> BulkUpdateResponse:
    updated = 0
    failed = 0
    errors = []

    for item in request.updates:
        try:
            await update_unit(item.unit_id, item.updates, current_user, redis)
            updated += 1
        except Exception as exc:
            failed += 1
            errors.append({"unit_id": item.unit_id, "error": str(exc)})

    UNIT_BULK_UPDATES.labels(org_id=current_user.org_id).inc()

    logger.info(
        "bulk_units_updated",
        action="bulk_update_units",
        resource_type="unit",
        resource_id=property_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success" if failed == 0 else "partial",
    )
    return BulkUpdateResponse(updated=updated, failed=failed, errors=errors)


# ── Reserve ───────────────────────────────────────────────────────────────────

async def reserve_unit(
    unit_id: str,
    tenant_id: str,
    onboarding_id: Optional[str],
    current_user: CurrentUser,
    redis: Redis,
) -> UnitResponse:
    if not await _acquire_lock(redis, current_user.org_id, unit_id):
        UNIT_RESERVATION_CONFLICTS.labels(org_id=current_user.org_id).inc()
        raise ConflictError("Unit is currently being processed — please retry shortly")

    try:
        unit = await unit_repository.atomic_status_transition(
            unit_id=unit_id,
            org_id=current_user.org_id,
            expected_status="vacant",
            new_status="reserved",
        )
        if unit is None:
            UNIT_RESERVATION_CONFLICTS.labels(org_id=current_user.org_id).inc()
            raise ConflictError("Unit is not available for reservation")

        # Update or create onboarding record
        if onboarding_id:
            ob = await onboarding_repository.get_by_id(onboarding_id, current_user.org_id)
            if ob:
                ob.unit_id = unit_id
                ob.status = "unit_reserved"
                await onboarding_repository.save(ob)

        # Emit event
        await publish(
            "pms.events",
            {
                "org_id": current_user.org_id,
                "user_id": current_user.user_id,
                "action": "unit_reserved",
                "unit_id": unit_id,
                "unit_code": unit.unit_code,
                "property_id": unit.property_id,
                "tenant_id": tenant_id,
            },
        )

        await audit_log_repository.create(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            resource_type="unit",
            resource_id=unit_id,
            action="reserve",
            after={"status": "reserved", "tenant_id": tenant_id},
        )

        await _emit_cache_and_index(unit, current_user)

    finally:
        await _release_lock(redis, current_user.org_id, unit_id)

    logger.info(
        "unit_reserved",
        action="reserve_unit",
        resource_type="unit",
        resource_id=unit_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(unit)


# ── Release reservation ───────────────────────────────────────────────────────

async def release_reservation(
    unit_id: str,
    current_user: CurrentUser,
    redis: Redis,
) -> UnitResponse:
    if current_user.role not in ("owner", "superadmin"):
        raise ForbiddenError("Only owner or superadmin can release a unit reservation")

    if not await _acquire_lock(redis, current_user.org_id, unit_id):
        raise ConflictError("Unit is currently being processed — please retry shortly")

    try:
        unit = await unit_repository.atomic_status_transition(
            unit_id=unit_id,
            org_id=current_user.org_id,
            expected_status="reserved",
            new_status="vacant",
        )
        if unit is None:
            raise ConflictError("Unit is not in reserved status")

        await audit_log_repository.create(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            resource_type="unit",
            resource_id=unit_id,
            action="release",
            after={"status": "vacant"},
        )

        await _emit_cache_and_index(unit, current_user)

    finally:
        await _release_lock(redis, current_user.org_id, unit_id)

    return _to_response(unit)


# ── Private helpers ───────────────────────────────────────────────────────────

async def _emit_cache_and_index(unit: Unit, current_user: CurrentUser) -> None:
    await publish(
        "cache.invalidate",
        {
            "org_id": current_user.org_id,
            "user_id": current_user.user_id,
            "keys": [
                f"{current_user.org_id}:unit:{unit.id}",
                f"{current_user.org_id}:property:{unit.property_id}:units",
            ],
        },
    )
    await publish(
        "search.index",
        {
            "org_id": current_user.org_id,
            "user_id": current_user.user_id,
            "index_name": "units",
            "document_id": unit.id,
            "action": "upsert",
            "document": {
                "id": unit.id,
                "org_id": unit.org_id,
                "property_id": unit.property_id,
                "unit_code": unit.unit_code,
                "wing": unit.wing,
                "floor": unit.floor,
                "status": unit.status,
                "unit_type": unit.unit_type,
                "rent_base": unit.rent_base,
            },
        },
    )


# ── Pricing breakdown ─────────────────────────────────────────────────────────

async def get_unit_pricing(unit_id: str, current_user: CurrentUser, move_in_date: Optional[date] = None) -> UnitPricingResponse:
    unit = await unit_repository.get_by_id(PydanticObjectId(unit_id), current_user.org_id)
    if not unit:
        raise ResourceNotFoundError("Unit", unit_id)

    prop = await property_repository.get_by_id(unit.property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", unit.property_id)

    pd = prop.pricing_defaults
    ud = prop.utility_defaults

    # Resolve rent
    rent = unit.rent_base or pd.rent_base or 0.0

    # Resolve deposit
    if unit.deposit_amount is not None:
        deposit = unit.deposit_amount
        deposit_rule = unit.deposit_rule or "custom"
    elif pd.deposit_rule == "custom" and pd.deposit_amount is not None:
        deposit = pd.deposit_amount
        deposit_rule = "custom"
    elif pd.deposit_rule == "1x_rent":
        deposit = rent * 1
        deposit_rule = "1x_rent"
    elif pd.deposit_rule == "2x_rent":
        deposit = rent * 2
        deposit_rule = "2x_rent"
    elif pd.deposit_rule == "3x_rent":
        deposit = rent * 3
        deposit_rule = "3x_rent"
    else:
        deposit = 0.0
        deposit_rule = pd.deposit_rule

    # Build utility list from property defaults + unit overrides
    overrides = unit.utility_overrides
    lines: list[UtilityLineItem] = []
    std_utils = {
        "electricity": ud.electricity,
        "water": ud.water,
        "gas": ud.gas,
        "internet": ud.internet,
        "garbage": ud.garbage,
        "security": ud.security,
    }
    for key, prop_detail in std_utils.items():
        if prop_detail is None:
            continue
        override = getattr(overrides, key, None) if overrides else None
        detail = override or prop_detail
        lines.append(UtilityLineItem(
            key=key,
            label=detail.label or key.replace("_", " ").title(),
            type=detail.type,
            rate=detail.rate,
            unit_label=detail.unit,
            income_account=detail.income_account,
            deposit=detail.deposit,
        ))
    for cu in (ud.custom or []):
        lines.append(UtilityLineItem(
            key=cu.key,
            label=cu.label or cu.key,
            type=cu.type,
            rate=cu.rate,
            unit_label=cu.unit,
            income_account=cu.income_account,
            deposit=cu.deposit,
        ))

    # Utility deposit: explicit unit-level value wins; otherwise sum from utility_overrides deposits
    if unit.utility_deposit is not None:
        utility_deposit: Optional[float] = unit.utility_deposit
    else:
        summed = 0.0
        ut = overrides or std_utils
        if ut:
            for key in ("electricity", "water", "gas", "internet", "garbage", "security"):
                od = ut.get(key) if isinstance(ut, dict) else getattr(ut, key, None)
                if od is not None and od.deposit is not None:
                    summed += od.deposit
        utility_deposit = summed if summed > 0 else pd.utility_deposit

    # Pro-rated rent: remaining days of move-in month (inclusive) / days in month × monthly rent
    ref_date = move_in_date or date.today()
    dim = calendar.monthrange(ref_date.year, ref_date.month)[1]  # days in month
    remaining = dim - ref_date.day + 1                           # inclusive of move-in day
    prorated_rent = round((remaining / dim) * rent, 2)

    total_move_in = round(deposit + (utility_deposit or 0.0) + prorated_rent, 2)

    return UnitPricingResponse(
        unit_id=str(unit.id),
        unit_code=unit.unit_code,
        rent_amount=rent,
        deposit_amount=deposit,
        deposit_rule=deposit_rule,
        utility_deposit=utility_deposit,
        utilities=lines,
        prorated_rent=prorated_rent,
        prorated_days=remaining,
        days_in_month=dim,
        total_move_in=total_move_in,
    )


# ── Private helpers ───────────────────────────────────────────────────────────

async def get_unit(unit_id: str, current_user: CurrentUser) -> UnitResponse:
    unit = await unit_repository.get_by_id(unit_id, current_user.org_id)
    if not unit:
        raise ResourceNotFoundError("Unit", unit_id)
    return _to_response(unit)


def _to_response(unit: Unit) -> UnitResponse:
    return UnitResponse(
        id=str(unit.id),
        org_id=unit.org_id,
        property_id=str(unit.property_id),
        unit_code=unit.unit_code,
        wing=unit.wing,
        floor=unit.floor,
        unit_number=unit.unit_number,
        unit_type=unit.unit_type,
        size=unit.size,
        furnished=unit.furnished,
        is_premium=unit.is_premium,
        status=unit.status,
        rent_base=unit.rent_base,
        deposit_amount=unit.deposit_amount,
        deposit_rule=unit.deposit_rule,
        utility_deposit=unit.utility_deposit,
        utility_overrides=unit.utility_overrides,
        meter_id=unit.meter_id,
        iot_device_id=unit.iot_device_id,
        created_at=unit.created_at,
        updated_at=unit.updated_at,
    )
