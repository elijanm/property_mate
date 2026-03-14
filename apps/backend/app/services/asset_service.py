"""Asset business-logic service."""
from typing import Optional

from fastapi import HTTPException

from app.dependencies.auth import CurrentUser
from app.models.asset import (
    Asset,
    AssetAuditEntry,
    AssetCheckoutRecord,
    AssetMaintenanceRecord,
    AssetTransferRecord,
    AssetValuation,
)
from app.repositories.asset_repository import asset_repository
from app.repositories.property_repository import property_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.schemas.asset import (
    AssetCheckinRequest,
    AssetCheckoutRequest,
    AssetCountsResponse,
    AssetCreateRequest,
    AssetDisposeRequest,
    AssetListResponse,
    AssetMaintenanceRequest,
    AssetResponse,
    AssetTransferRequest,
    AssetUpdateRequest,
    AssetValuationRequest,
    AssetWriteOffRequest,
)
from app.utils.datetime import utc_now


def _to_response(asset: Asset) -> AssetResponse:
    return AssetResponse(
        id=str(asset.id),
        org_id=asset.org_id,
        asset_id=asset.asset_id,
        barcode=asset.barcode,
        qr_code_key=asset.qr_code_key,
        name=asset.name,
        description=asset.description,
        category=asset.category,
        subcategory=asset.subcategory,
        tags=asset.tags,
        custom_fields=asset.custom_fields,
        property_id=asset.property_id,
        property_name=asset.property_name,
        unit_id=asset.unit_id,
        unit_code=asset.unit_code,
        location=asset.location,
        store_location_id=asset.store_location_id,
        store_location_path=asset.store_location_path,
        department=asset.department,
        assigned_to=asset.assigned_to,
        assigned_to_name=asset.assigned_to_name,
        vendor_name=asset.vendor_name,
        manufacturer=asset.manufacturer,
        model=asset.model,
        serial_number=asset.serial_number,
        purchase_date=asset.purchase_date,
        purchase_cost=asset.purchase_cost,
        markup_percent=asset.markup_percent,
        warranty_expiry=asset.warranty_expiry,
        warranty_notes=asset.warranty_notes,
        condition=asset.condition,
        lifecycle_status=asset.lifecycle_status,
        depreciation_method=asset.depreciation_method,
        useful_life_years=asset.useful_life_years,
        depreciation_rate=asset.depreciation_rate,
        salvage_value=asset.salvage_value,
        appreciation_rate=asset.appreciation_rate,
        current_value=asset.current_value,
        next_service_date=asset.next_service_date,
        service_interval_days=asset.service_interval_days,
        disposed_at=asset.disposed_at,
        disposal_reason=asset.disposal_reason,
        disposal_value=asset.disposal_value,
        written_off_at=asset.written_off_at,
        write_off_reason=asset.write_off_reason,
        valuation_history=[v.model_dump() for v in asset.valuation_history],
        maintenance_history=[m.model_dump() for m in asset.maintenance_history],
        transfer_history=[t.model_dump() for t in asset.transfer_history],
        checkout_history=[c.model_dump() for c in asset.checkout_history],
        audit_trail=[a.model_dump() for a in asset.audit_trail],
        attachment_keys=asset.attachment_keys,
        notes=asset.notes,
        created_by=asset.created_by,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


def _audit(action: str, current_user: CurrentUser, description: str, changes: Optional[dict] = None) -> AssetAuditEntry:
    return AssetAuditEntry(
        action=action,
        actor_id=current_user.user_id,
        description=description,
        changes=changes,
    )


async def create_asset(request: AssetCreateRequest, current_user: CurrentUser) -> AssetResponse:
    asset_id = await asset_repository.next_asset_id(current_user.org_id)

    # Resolve property/unit names
    property_name = None
    unit_code = None
    if request.property_id:
        prop = await property_repository.get_by_id(request.property_id, current_user.org_id)
        if prop:
            property_name = prop.name
    if request.unit_id:
        unit = await unit_repository.get_by_id(request.unit_id, current_user.org_id)
        if unit:
            unit_code = unit.unit_code

    # Resolve assignee name
    assigned_to_name = None
    if request.assigned_to:
        user = await user_repository.get_by_id(request.assigned_to, current_user.org_id)
        if user:
            assigned_to_name = f"{user.first_name} {user.last_name}".strip()

    asset = Asset(
        org_id=current_user.org_id,
        asset_id=asset_id,
        name=request.name,
        description=request.description,
        category=request.category,
        subcategory=request.subcategory,
        tags=request.tags,
        custom_fields=request.custom_fields,
        property_id=request.property_id,
        property_name=property_name,
        unit_id=request.unit_id,
        unit_code=unit_code,
        location=request.location,
        store_location_id=request.store_location_id,
        store_location_path=request.store_location_path,
        department=request.department,
        assigned_to=request.assigned_to,
        assigned_to_name=assigned_to_name,
        barcode=request.barcode,
        vendor_name=request.vendor_name,
        manufacturer=request.manufacturer,
        model=request.model,
        serial_number=request.serial_number,
        purchase_date=request.purchase_date,
        purchase_cost=request.purchase_cost,
        markup_percent=request.markup_percent,
        warranty_expiry=request.warranty_expiry,
        warranty_notes=request.warranty_notes,
        condition=request.condition,
        lifecycle_status=request.lifecycle_status,
        depreciation_method=request.depreciation_method,
        useful_life_years=request.useful_life_years,
        depreciation_rate=request.depreciation_rate,
        salvage_value=request.salvage_value,
        appreciation_rate=request.appreciation_rate,
        current_value=request.purchase_cost,
        next_service_date=request.next_service_date,
        service_interval_days=request.service_interval_days,
        notes=request.notes,
        created_by=current_user.user_id,
        audit_trail=[_audit("created", current_user, f"Asset {asset_id} created")],
    )
    await asset_repository.create(asset)
    return _to_response(asset)


async def get_asset(asset_id: str, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})
    return _to_response(asset)


async def list_assets(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    unit_id: Optional[str] = None,
    category: Optional[str] = None,
    lifecycle_status: Optional[str] = None,
    condition: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> AssetListResponse:
    items, total = await asset_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        entity_type=entity_type,
        entity_id=entity_id,
        unit_id=unit_id,
        category=category,
        lifecycle_status=lifecycle_status,
        condition=condition,
        assigned_to=assigned_to,
        search=search,
        page=page,
        page_size=page_size,
    )
    return AssetListResponse(
        items=[_to_response(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_asset_counts(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> AssetCountsResponse:
    counts = await asset_repository.count_by_status(
        current_user.org_id, property_id, entity_type=entity_type, entity_id=entity_id
    )
    return AssetCountsResponse(
        total=sum(counts.values()),
        active=counts.get("active", 0),
        in_maintenance=counts.get("in_maintenance", 0),
        checked_out=counts.get("checked_out", 0),
        retired=counts.get("retired", 0),
        disposed=counts.get("disposed", 0),
        written_off=counts.get("written_off", 0),
    )


async def update_asset(asset_id: str, request: AssetUpdateRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    updates = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}

    # Resolve names when IDs change
    if "property_id" in updates and updates["property_id"]:
        prop = await property_repository.get_by_id(updates["property_id"], current_user.org_id)
        if prop:
            updates["property_name"] = prop.name
    if "unit_id" in updates and updates["unit_id"]:
        unit = await unit_repository.get_by_id(updates["unit_id"], current_user.org_id)
        if unit:
            updates["unit_code"] = unit.unit_code
    if "assigned_to" in updates and updates["assigned_to"]:
        user = await user_repository.get_by_id(updates["assigned_to"], current_user.org_id)
        if user:
            updates["assigned_to_name"] = f"{user.first_name} {user.last_name}".strip()

    audit = _audit("updated", current_user, "Asset fields updated", updates)
    updates["audit_trail"] = asset.audit_trail + [audit]

    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def transfer_asset(asset_id: str, request: AssetTransferRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    # Resolve new property/unit names
    to_property_name = request.to_property_name
    if request.to_property_id and not to_property_name:
        prop = await property_repository.get_by_id(request.to_property_id, current_user.org_id)
        if prop:
            to_property_name = prop.name

    record = AssetTransferRecord(
        from_property_id=asset.property_id,
        from_property_name=asset.property_name,
        from_unit_id=asset.unit_id,
        from_location=asset.location,
        to_property_id=request.to_property_id,
        to_property_name=to_property_name,
        to_unit_id=request.to_unit_id,
        to_location=request.to_location,
        transferred_by=current_user.user_id,
        notes=request.notes,
    )

    audit = _audit("transferred", current_user, f"Asset transferred to {to_property_name or request.to_location or 'new location'}")
    updates = {
        "property_id": request.to_property_id,
        "property_name": to_property_name,
        "unit_id": request.to_unit_id,
        "location": request.to_location,
        "transfer_history": asset.transfer_history + [record],
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def checkout_asset(asset_id: str, request: AssetCheckoutRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})
    if asset.lifecycle_status != "active":
        raise HTTPException(status_code=400, detail={"code": "ASSET_NOT_AVAILABLE", "message": "Asset is not available for checkout"})

    record = AssetCheckoutRecord(
        checked_out_to=request.checked_out_to,
        checked_out_to_name=request.checked_out_to_name,
        expected_return=request.expected_return,
        notes=request.notes,
    )
    audit = _audit("checked_out", current_user, f"Asset checked out to {request.checked_out_to_name or request.checked_out_to}")
    updates = {
        "lifecycle_status": "checked_out",
        "checkout_history": asset.checkout_history + [record],
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def checkin_asset(asset_id: str, request: AssetCheckinRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    # Update the last open checkout record
    checkout_history = asset.checkout_history
    for record in reversed(checkout_history):
        if record.returned_at is None:
            record.returned_at = utc_now()
            record.returned_condition = request.returned_condition
            if request.notes:
                record.notes = (record.notes or "") + f" | {request.notes}"
            break

    audit = _audit("checked_in", current_user, "Asset returned")
    updates = {
        "lifecycle_status": "active",
        "condition": request.returned_condition or asset.condition,
        "checkout_history": checkout_history,
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def add_maintenance_record(asset_id: str, request: AssetMaintenanceRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    record = AssetMaintenanceRecord(
        date=request.date,
        maintenance_type=request.maintenance_type,
        description=request.description,
        cost=request.cost,
        performed_by=request.performed_by,
        performed_by_name=request.performed_by_name,
        next_due=request.next_due,
        notes=request.notes,
    )
    audit = _audit("maintenance_added", current_user, f"{request.maintenance_type} maintenance recorded")
    updates: dict = {
        "maintenance_history": asset.maintenance_history + [record],
        "audit_trail": asset.audit_trail + [audit],
    }
    if request.next_due:
        updates["next_service_date"] = request.next_due
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def add_valuation(asset_id: str, request: AssetValuationRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    record = AssetValuation(
        date=request.date,
        value=request.value,
        method=request.method,
        notes=request.notes,
        recorded_by=current_user.user_id,
    )
    audit = _audit("valuation_added", current_user, f"Valuation recorded: {request.value} via {request.method}")
    updates = {
        "current_value": request.value,
        "valuation_history": asset.valuation_history + [record],
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def dispose_asset(asset_id: str, request: AssetDisposeRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    audit = _audit("disposed", current_user, f"Asset disposed: {request.disposal_reason}")
    updates = {
        "lifecycle_status": "disposed",
        "disposed_at": utc_now(),
        "disposal_reason": request.disposal_reason,
        "disposal_value": request.disposal_value,
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def write_off_asset(asset_id: str, request: AssetWriteOffRequest, current_user: CurrentUser) -> AssetResponse:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})

    audit = _audit("written_off", current_user, f"Asset written off: {request.write_off_reason}")
    updates = {
        "lifecycle_status": "written_off",
        "written_off_at": utc_now(),
        "write_off_reason": request.write_off_reason,
        "current_value": 0.0,
        "audit_trail": asset.audit_trail + [audit],
    }
    await asset_repository.update(asset, updates)
    return _to_response(asset)


async def delete_asset(asset_id: str, current_user: CurrentUser) -> None:
    asset = await asset_repository.get_by_id(asset_id, current_user.org_id)
    if not asset:
        raise HTTPException(status_code=404, detail={"code": "ASSET_NOT_FOUND", "message": "Asset not found"})
    await asset_repository.soft_delete(asset)
