"""
Property service — Breeze config, unit generation, property management.
"""
import uuid
from typing import List, Optional, Tuple

import structlog
from redis.asyncio import Redis
from beanie import Document, PydanticObjectId
from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.core.metrics import PROPERTIES_CREATED, UNITS_GENERATED
from app.core.rabbitmq import publish
from app.dependencies.auth import CurrentUser
from app.dependencies.pagination import PaginationParams
from app.models.property import LeaseDefaults, Property, UnitPolicyDefaults, WingConfig
from app.models.unit import Unit
from app.repositories.audit_log_repository import audit_log_repository
from app.repositories.job_run_repository import job_run_repository
from app.repositories.property_repository import property_repository
from app.schemas.property import (
    PropertyCreateRequest,
    PropertyCreateResponse,
    PropertyInventoryConfigUpdateRequest,
    PropertyListResponse,
    PropertyResponse,
    PropertyUpdateRequest,
    UnitTemplateRequest,
)
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

UNIT_GENERATION_SYNC_THRESHOLD = 200
QUEUE_UNIT_GENERATION = "property.units.generate"


# ── Unit code generation (deterministic) ─────────────────────────────────────

def generate_unit_code(wing: Optional[str], floor: int, unit_number: str) -> str:
    """
    Deterministic scheme:
      With wing:    A-0102  (wing=A, floor=01, unit=02)
      Without wing: 0102    (floor=01, unit=02)
    """
    floor_part = f"{floor:02d}"
    try:
        unit_part = f"{int(unit_number):02d}"
    except ValueError:
        unit_part = unit_number.upper()

    if wing:
        return f"{wing.upper()}-{floor_part}{unit_part}"
    return f"{floor_part}{unit_part}"


def expand_templates(
    wings: List[WingConfig],
    unit_templates: List[UnitTemplateRequest],
) -> List[dict]:
    """
    Expand unit templates into a flat list of unit specs.
    Deterministic — same inputs always produce same ordered list.
    """
    units: List[dict] = []
    wing_names = [w.name for w in wings] if wings else [None]

    for template in unit_templates:
        target_wings = template.wings if template.wings else wing_names
        unit_ids = template.unit_identifiers()
        if not unit_ids:
            continue

        for wing_name in target_wings:
            for floor in range(template.floors_start, template.floors_end + 1):
                for unit_num in unit_ids:
                    units.append(
                        {
                            "wing": wing_name,
                            "floor": floor,
                            "unit_number": unit_num,
                            "unit_code": generate_unit_code(wing_name, floor, unit_num),
                            "unit_type": template.unit_type,
                            "rent_base": template.rent_base,
                            "deposit_amount": template.deposit_amount,
                            "deposit_rule": template.deposit_rule,
                            "size": template.size,
                            "furnished": template.furnished,
                            "is_premium": template.is_premium,
                        }
                    )

    # Deduplicate codes preserving first occurrence
    seen: set = set()
    deduped = []
    for u in units:
        if u["unit_code"] not in seen:
            seen.add(u["unit_code"])
            deduped.append(u)
    return deduped


# ── Idempotent unit upsert via Motor ─────────────────────────────────────────

async def _upsert_units(
    org_id: str,
    property_id: PydanticObjectId,
    unit_specs: List[dict],
) -> int:
    """
    Upsert units. Returns number of newly created units.
    Safe to call multiple times — $setOnInsert means retries are no-ops.
    """
    from app.models.unit import Unit as UnitDoc

    col = UnitDoc.get_pymongo_collection()
    now = utc_now()
    created = 0

    for spec in unit_specs:
        result = await col.update_one(
            {
                "org_id": org_id,
                "property_id": property_id,
                "unit_code": spec["unit_code"],
                "deleted_at": None,
            },
            {
                "$setOnInsert": {
                    "_id": PydanticObjectId(),
                    "org_id": org_id,
                    "property_id": property_id,
                    "unit_code": spec["unit_code"],
                    "wing": spec["wing"],
                    "floor": spec["floor"],
                    "unit_number": spec["unit_number"],
                    "unit_type": spec["unit_type"],
                    "size": spec["size"],
                    "furnished": spec["furnished"],
                    "is_premium": spec["is_premium"],
                    "status": "vacant",
                    "rent_base": spec["rent_base"],
                    "deposit_amount": spec["deposit_amount"],
                    "deposit_rule": spec["deposit_rule"],
                    "utility_overrides": None,
                    "meter_id": None,
                    "iot_device_id": None,
                    "deleted_at": None,
                    "created_at": now,
                    "updated_at": now,
                }
            },
            upsert=True,
        )
        if result.upserted_id:
            created += 1

    return created


# ── Property creation ─────────────────────────────────────────────────────────

async def create_property(
    request: PropertyCreateRequest,
    current_user: CurrentUser,
    redis: Redis,
) -> PropertyCreateResponse:
    wings = request.wings or []
    unit_specs = expand_templates(wings, request.unit_templates)
    total_units = len(unit_specs)

    # Check Redis idempotency: prevent duplicate concurrent create requests
    idempotency_key = f"{current_user.org_id}:prop_create:{request.name.lower().strip()}"
    if not await redis.set(idempotency_key, "1", ex=30, nx=True):
        raise ConflictError(f"A property named '{request.name}' is already being created")

    try:
        prop = Property(
            org_id=current_user.org_id,
            name=request.name,
            property_type=request.property_type,
            region=request.region,
            timezone=request.timezone,
            address=request.address,
            wings=wings,
            pricing_defaults=request.pricing_defaults,
            utility_defaults=request.utility_defaults,
            billing_settings=request.billing_settings,
            lease_defaults=request.lease_defaults or LeaseDefaults(),
            unit_policies=request.unit_policies or UnitPolicyDefaults(),
            manager_ids=request.manager_ids or [],
            unit_count=0,
        )
        await property_repository.create(prop)

        job_id: Optional[str] = None
        units_created = 0

        if total_units <= UNIT_GENERATION_SYNC_THRESHOLD:
            # Inline generation
            units_created = await _upsert_units(current_user.org_id, prop.id, unit_specs)
            await property_repository.update_unit_count(prop.id, current_user.org_id, units_created)
            prop.unit_count = units_created

            UNITS_GENERATED.labels(org_id=current_user.org_id, generation_mode="sync").inc(
                units_created
            )

            # Emit search index events for each unit
            await publish(
                "search.index",
                {
                    "org_id": current_user.org_id,
                    "user_id": current_user.user_id,
                    "index_name": "units",
                    "document_id": prop.id,
                    "action": "bulk_upsert",
                    "document": {"property_id": prop.id, "count": units_created},
                },
            )
        else:
            # Async generation via worker
            job_id = str(uuid.uuid4())
            payload = {
                "job_id": job_id,
                "org_id": current_user.org_id,
                "user_id": current_user.user_id,
                "property_id": str(prop.id),
                "wings": [w.model_dump() for w in wings],
                "unit_templates": [t.model_dump() for t in request.unit_templates],
                "total_units": total_units,
                "correlation_id": job_id,
            }
            await job_run_repository.create(
                job_type="unit_generation",
                payload=payload,
                org_id=current_user.org_id,
                job_id=job_id,
            )
            await publish(QUEUE_UNIT_GENERATION, payload, correlation_id=job_id)

            UNITS_GENERATED.labels(org_id=current_user.org_id, generation_mode="async").inc(
                total_units
            )

        PROPERTIES_CREATED.labels(org_id=current_user.org_id).inc()

        # Cache invalidation
        await publish(
            "cache.invalidate",
            {
                "org_id": current_user.org_id,
                "user_id": current_user.user_id,
                "keys": [f"{current_user.org_id}:properties:list"],
            },
        )

        await audit_log_repository.create(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            resource_type="property",
            resource_id=prop.id,
            action="create",
            after={"name": prop.name, "unit_count": prop.unit_count},
        )

        logger.info(
            "property_created",
            action="create_property",
            resource_type="property",
            resource_id=prop.id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            status="success",
        )

    finally:
        await redis.delete(idempotency_key)

    return PropertyCreateResponse(
        property=_to_response(prop),
        units_generated=units_created,
        job_id=job_id,
    )


async def list_properties(
    current_user: CurrentUser,
    pagination: PaginationParams,
    status: Optional[str] = None,
    org_id:  Optional[str] = None
) -> PropertyListResponse:
    items, total = await property_repository.list(
        org_id= org_id or current_user.org_id,
        status=status,
        skip=pagination.skip,
        limit=pagination.page_size,
    )
    return PropertyListResponse(
        items=[_to_response(p) for p in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


async def update_property(
    current_user: CurrentUser,
    property_id: str,
    req: PropertyUpdateRequest,
) -> PropertyResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)

    # Build a flat updates dict from only the fields explicitly sent in the request.
    # Using model_fields_set (not exclude_none) so that:
    #   - fields absent from the request body are NOT overwritten
    #   - fields explicitly set to null ARE saved (e.g. clearing tax_config override)
    # Each nested Pydantic model is fully serialised via model_dump() so $set
    # replaces the whole sub-document rather than leaving stale nested keys.
    updates: dict = {}
    for key in req.model_fields_set:
        val = getattr(req, key)
        updates[key] = val.model_dump() if hasattr(val, "model_dump") else val

    updated = await property_repository.update(property_id, current_user.org_id, updates)
    await publish(
        "cache.invalidate",
        {
            "org_id": current_user.org_id,
            "user_id": current_user.user_id,
            "keys": [
                f"{current_user.org_id}:properties:list",
                f"{current_user.org_id}:property:{property_id}",
            ],
        },
    )
    logger.info(
        "property_updated",
        action="update_property",
        resource_type="property",
        resource_id=property_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(updated)


async def get_property(property_id: str, current_user: CurrentUser) -> PropertyResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    return _to_response(prop)


# ── Private helpers ───────────────────────────────────────────────────────────

def _to_response(prop: Property) -> PropertyResponse:
    from app.schemas.property import InventoryConfigResponse, LateFeeSettingResponse
    inv_cfg = prop.inventory_config if prop.inventory_config else None
    lfs = prop.late_fee_setting if prop.late_fee_setting else None
    late_fee_resp = LateFeeSettingResponse(
        enabled=lfs.enabled,
        grace_days=lfs.grace_days,
        fee_type=lfs.fee_type,
        fee_value=lfs.fee_value,
        max_applications=lfs.max_applications,
    ) if lfs else None
    return PropertyResponse(
        id=str(prop.id),
        org_id=prop.org_id,
        name=prop.name,
        property_type=prop.property_type,
        region=prop.region,
        timezone=prop.timezone,
        address=prop.address,
        wings=prop.wings,
        pricing_defaults=prop.pricing_defaults,
        utility_defaults=prop.utility_defaults,
        billing_settings=prop.billing_settings,
        lease_defaults=prop.lease_defaults,
        unit_policies=prop.unit_policies,
        tax_config=prop.tax_config,
        ledger_settings=prop.ledger_settings,
        payment_config=prop.payment_config,
        manager_ids=prop.manager_ids,
        unit_count=prop.unit_count,
        color=prop.color,
        installed_apps=prop.installed_apps,
        inventory_config=InventoryConfigResponse(
            serial_merge_mode=inv_cfg.serial_merge_mode if inv_cfg else "keep_target",
            serial_split_remainder_pct=inv_cfg.serial_split_remainder_pct if inv_cfg else 0.0,
        ),
        store_config=prop.store_config,
        late_fee_setting=late_fee_resp,
        status=prop.status,
        created_at=prop.created_at,
        updated_at=prop.updated_at,
    )


async def update_payment_config(
    property_id: str,
    request,
    current_user: CurrentUser,
) -> PropertyResponse:
    from app.models.property import PaymentConfig
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    existing = prop.payment_config or PaymentConfig()
    updates = request.model_dump(exclude_none=True)
    merged = existing.model_copy(update=updates)
    prop.payment_config = merged
    prop.updated_at = utc_now()
    await prop.save()
    logger.info(
        "property_payment_config_updated",
        action="update_payment_config",
        resource_type="property", resource_id=property_id,
        org_id=current_user.org_id, status="success",
    )
    return _to_response(prop)


async def install_app(property_id: str, app_id: str, current_user: CurrentUser) -> PropertyResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    if app_id not in prop.installed_apps:
        prop.installed_apps.append(app_id)
        prop.updated_at = utc_now()
        await prop.save()
    return _to_response(prop)


async def uninstall_app(property_id: str, app_id: str, current_user: CurrentUser) -> None:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    prop.installed_apps = [a for a in prop.installed_apps if a != app_id]
    prop.updated_at = utc_now()
    await prop.save()


async def update_inventory_config(
    property_id: str,
    request: PropertyInventoryConfigUpdateRequest,
    current_user: CurrentUser,
) -> PropertyResponse:
    prop = await property_repository.get_by_id(property_id, current_user.org_id)
    if not prop:
        raise ResourceNotFoundError("Property", property_id)
    if request.serial_merge_mode is not None:
        prop.inventory_config.serial_merge_mode = request.serial_merge_mode
    if request.serial_split_remainder_pct is not None:
        prop.inventory_config.serial_split_remainder_pct = request.serial_split_remainder_pct
    prop.updated_at = utc_now()
    await prop.save()
    return _to_response(prop)
