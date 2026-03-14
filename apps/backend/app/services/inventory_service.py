"""Inventory business-logic service."""
import asyncio
from datetime import date
from typing import Optional

from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.core.s3 import generate_presigned_url, get_s3_client, s3_path
from app.dependencies.auth import CurrentUser
from app.models.inventory import InventoryAuditEntry, InventoryItem, InventoryVariant, StockBatch, StockLevel, StockMovement, StockSerial
from app.repositories.inventory_repository import inventory_repository
from app.repositories.property_repository import property_repository
from app.repositories.store_repository import store_repository
from app.schemas.inventory import (
    InventoryAuditEntryResponse,
    InventoryCountsResponse,
    InventoryItemCreateRequest,
    InventoryItemResponse,
    InventoryItemUpdateRequest,
    InventoryListResponse,
    InventoryVariantCreateRequest,
    InventoryVariantResponse,
    InventoryVariantUpdateRequest,
    SerialMergeRequest,
    SerialSplitRequest,
    StockAdjustRequest,
    StockBatchResponse,
    StockDamagedRequest,
    StockInRequest,
    StockIssueRequest,
    StockLevelResponse,
    StockMovementResponse,
    StockOutRequest,
    StockReserveRequest,
    StockReturnRequest,
    StockSerialResponse,
    StockTransferRequest,
)
from app.utils.datetime import utc_now


async def _to_response(item: InventoryItem) -> InventoryItemResponse:
    today = date.today()
    has_expired = any(
        b.expiry_date and b.expiry_date < today and b.quantity_remaining > 0
        for b in item.batches
    )
    is_low_stock = item.total_available <= item.reorder_point

    # Presign item image
    item_image_url: Optional[str] = None
    if item.image_key:
        try:
            item_image_url = await generate_presigned_url(item.image_key)
        except Exception:
            pass

    # Presign variant images
    variant_responses = []
    for v in item.variants:
        v_image_url: Optional[str] = None
        if v.image_key:
            try:
                v_image_url = await generate_presigned_url(v.image_key)
            except Exception:
                pass
        variant_responses.append(InventoryVariantResponse(
            **{**v.model_dump(), "image_url": v_image_url}
        ))

    return InventoryItemResponse(
        id=str(item.id),
        org_id=item.org_id,
        item_id=item.item_id,
        barcode=item.barcode,
        qr_code_key=item.qr_code_key,
        name=item.name,
        description=item.description,
        category=item.category,
        subcategory=item.subcategory,
        tags=item.tags,
        custom_fields=item.custom_fields,
        hazard_classes=item.hazard_classes,
        safety_notes=item.safety_notes,
        requires_controlled_handling=item.requires_controlled_handling,
        unit_of_measure=item.unit_of_measure,
        units_per_package=item.units_per_package,
        sku=item.sku,
        vendor_name=item.vendor_name,
        manufacturer=item.manufacturer,
        manufacturer_part_number=item.manufacturer_part_number,
        purchase_cost=item.purchase_cost,
        markup_percent=item.markup_percent,
        selling_price=item.selling_price,
        min_stock_level=item.min_stock_level,
        max_stock_level=item.max_stock_level,
        reorder_point=item.reorder_point,
        reorder_quantity=item.reorder_quantity,
        storage_location=item.storage_location,
        store_location_id=item.store_location_id,
        store_location_path=item.store_location_path,
        property_id=item.property_id,
        property_name=item.property_name,
        weight_tracking_enabled=item.weight_tracking_enabled,
        tare_tracking_enabled=item.tare_tracking_enabled,
        weight_variance_soft_pct=item.weight_variance_soft_pct,
        weight_variance_hard_pct=item.weight_variance_hard_pct,
        status=item.status,
        batch_tracking_enabled=item.batch_tracking_enabled,
        expiry_tracking_enabled=item.expiry_tracking_enabled,
        total_quantity=item.total_quantity,
        total_reserved=item.total_reserved,
        total_available=item.total_available,
        total_serial_count=item.total_serial_count,
        is_serialized=item.is_serialized,
        weight_per_unit=item.weight_per_unit,
        stock_levels=[StockLevelResponse(**sl.model_dump()) for sl in item.stock_levels],
        batches=[StockBatchResponse(**b.model_dump()) for b in item.batches],
        movements=[StockMovementResponse(**m.model_dump()) for m in reversed(item.movements[-50:])],
        serials=[StockSerialResponse(**s.model_dump()) for s in item.serials],
        variants=variant_responses,
        audit_trail=[InventoryAuditEntryResponse(**e.model_dump()) for e in reversed(item.audit_trail[-200:])],
        attachment_keys=item.attachment_keys,
        image_key=item.image_key,
        image_url=item_image_url,
        notes=item.notes,
        created_by=item.created_by,
        created_at=item.created_at,
        updated_at=item.updated_at,
        is_low_stock=is_low_stock,
        has_expired_batches=has_expired,
    )


def _audit(action: str, current_user: CurrentUser, description: str,
           changes: Optional[dict] = None) -> InventoryAuditEntry:
    return InventoryAuditEntry(
        action=action,
        actor_id=current_user.user_id,
        description=description,
        changes=changes,
    )


def _recalc_totals(item: InventoryItem) -> None:
    if item.is_serialized:
        in_stock = [s for s in item.serials if s.status == "in_stock"]
        item.total_serial_count = len(in_stock)
        if item.weight_tracking_enabled:
            # total_quantity = sum of remaining weights — the primary measurement
            item.total_quantity = round(sum(s.quantity_remaining or 0.0 for s in in_stock), 6)
            item.total_reserved = 0.0
            item.total_available = item.total_quantity
        else:
            # Serialized without weight: total_quantity = count of in-stock serials
            item.total_quantity = float(item.total_serial_count)
            item.total_reserved = 0.0
            item.total_available = item.total_quantity
    else:
        item.total_serial_count = 0
        item.total_quantity = sum(sl.quantity for sl in item.stock_levels)
        item.total_reserved = sum(sl.reserved_quantity for sl in item.stock_levels)
        item.total_available = item.total_quantity - item.total_reserved

    if item.total_available <= 0:
        item.status = "out_of_stock"
    elif item.status == "out_of_stock":
        item.status = "active"


def _find_or_create_level(item: InventoryItem, location_key: str, location_label: str,
                           property_id: Optional[str] = None, unit_id: Optional[str] = None) -> StockLevel:
    for sl in item.stock_levels:
        if sl.location_key == location_key:
            return sl
    sl = StockLevel(
        location_key=location_key,
        location_label=location_label,
        property_id=property_id,
        unit_id=unit_id,
        quantity=0.0,
        reserved_quantity=0.0,
        available_quantity=0.0,
    )
    item.stock_levels.append(sl)
    return sl


async def create_item(request: InventoryItemCreateRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item_id = await inventory_repository.next_item_id(current_user.org_id)

    property_name = None
    if request.property_id:
        prop = await property_repository.get_by_id(request.property_id, current_user.org_id)
        if prop:
            property_name = prop.name

    selling_price = None
    if request.purchase_cost is not None:
        selling_price = round(request.purchase_cost * (1 + request.markup_percent / 100), 2)

    item = InventoryItem(
        org_id=current_user.org_id,
        item_id=item_id,
        name=request.name,
        description=request.description,
        category=request.category,
        subcategory=request.subcategory,
        tags=request.tags,
        custom_fields=request.custom_fields,
        hazard_classes=request.hazard_classes,
        safety_notes=request.safety_notes,
        requires_controlled_handling=request.requires_controlled_handling,
        unit_of_measure=request.unit_of_measure,
        units_per_package=request.units_per_package,
        barcode=request.barcode or None,
        sku=request.sku or None,
        vendor_name=request.vendor_name,
        manufacturer=request.manufacturer,
        manufacturer_part_number=request.manufacturer_part_number,
        purchase_cost=request.purchase_cost,
        markup_percent=request.markup_percent,
        selling_price=selling_price,
        min_stock_level=request.min_stock_level,
        max_stock_level=request.max_stock_level,
        reorder_point=request.reorder_point,
        reorder_quantity=request.reorder_quantity,
        storage_location=request.storage_location,
        store_location_id=request.store_location_id,
        store_location_path=request.store_location_path,
        property_id=request.property_id,
        property_name=property_name,
        is_serialized=request.is_serialized,
        weight_per_unit=request.weight_per_unit,
        weight_tracking_enabled=request.weight_tracking_enabled,
        tare_tracking_enabled=request.tare_tracking_enabled,
        weight_variance_soft_pct=request.weight_variance_soft_pct,
        weight_variance_hard_pct=request.weight_variance_hard_pct,
        batch_tracking_enabled=request.batch_tracking_enabled,
        expiry_tracking_enabled=request.expiry_tracking_enabled,
        notes=request.notes,
        created_by=current_user.user_id,
        audit_trail=[_audit("created", current_user, f"Item {item_id} created")],
    )
    await inventory_repository.create(item)
    return await _to_response(item)


async def get_item(item_id: str, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})
    return await _to_response(item)


async def list_items(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    low_stock_only: bool = False,
    hazard_class: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> InventoryListResponse:
    items, total = await inventory_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        entity_type=entity_type,
        entity_id=entity_id,
        category=category,
        status=status,
        low_stock_only=low_stock_only,
        hazard_class=hazard_class,
        search=search,
        page=page,
        page_size=page_size,
    )
    return InventoryListResponse(
        items=list(await asyncio.gather(*[_to_response(i) for i in items])),
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_counts(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> InventoryCountsResponse:
    counts = await inventory_repository.count_by_status(
        current_user.org_id, property_id, entity_type=entity_type, entity_id=entity_id
    )
    return InventoryCountsResponse(**counts)


async def update_item(item_id: str, request: InventoryItemUpdateRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    _NULLABLE_STRING_FIELDS = {"barcode", "sku"}
    updates = {}
    for k, v in request.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        # Coerce empty strings to None for unique-indexed fields
        if k in _NULLABLE_STRING_FIELDS and isinstance(v, str) and not v.strip():
            updates[k] = None
        else:
            updates[k] = v

    # Recalculate selling price if cost/markup changed
    new_cost = updates.get("purchase_cost", item.purchase_cost)
    new_markup = updates.get("markup_percent", item.markup_percent)
    if new_cost is not None:
        updates["selling_price"] = round(new_cost * (1 + new_markup / 100), 2)

    if "property_id" in updates and updates["property_id"]:
        prop = await property_repository.get_by_id(updates["property_id"], current_user.org_id)
        if prop:
            updates["property_name"] = prop.name

    audit = _audit("updated", current_user, "Item fields updated")
    updates["audit_trail"] = item.audit_trail + [audit]
    await inventory_repository.update(item, updates)
    return await _to_response(item)


async def stock_in(item_id: str, request: StockInRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    # ── Serialized item handling ───────────────────────────────────────────────
    serial_numbers: list[str] = []
    new_serials: list[StockSerial] = []

    if item.is_serialized:
        if not request.serial_numbers:
            raise HTTPException(status_code=400, detail={"code": "SERIALS_REQUIRED", "message": "serial_numbers is required for serialized items"})
        existing = {s.serial_number for s in item.serials}
        dups = [sn for sn in request.serial_numbers if sn in existing]
        if dups:
            raise HTTPException(status_code=400, detail={"code": "SERIAL_DUPLICATE", "message": f"Serial(s) already exist: {dups}"})
        serial_numbers = list(request.serial_numbers)

        # Build serial objects FIRST — qty is derived from their net weights when weight tracking
        for sn in serial_numbers:
            gross, tare, net = None, None, None
            if item.weight_tracking_enabled:
                if item.tare_tracking_enabled:
                    gross = (request.serial_weights or {}).get(sn)
                    tare = (request.serial_tare_weights or {}).get(sn)
                    net = round(gross - tare, 6) if (gross is not None and tare is not None) else None
                else:
                    net = (request.serial_weights or {}).get(sn)
            # Per-serial pricing — falls back to item-level cost/price
            pc = (request.serial_purchase_costs or {}).get(sn) or request.unit_cost or item.purchase_cost
            sp = (request.serial_selling_prices or {}).get(sn) or item.selling_price
            margin = round(((sp - pc) / pc) * 100, 2) if pc and sp and pc > 0 else None
            vid = (request.serial_variant_ids or {}).get(sn)
            new_serials.append(StockSerial(
                serial_number=sn,
                status="in_stock",
                location_key=request.location_key,
                gross_weight_kg=gross,
                tare_weight_kg=tare,
                net_weight_kg=net,
                quantity_remaining=net,
                purchase_cost=pc,
                selling_price=sp,
                margin_pct=margin,
                variant_id=vid,
                store_location_id=request.store_location_id,
                store_location_path=request.store_location_path,
            ))

        # qty = total net weight (primary measure) when weight tracking; else serial count
        if item.weight_tracking_enabled:
            total_net = round(sum(s.net_weight_kg or 0.0 for s in new_serials), 6)
            qty = total_net if total_net > 0 else float(len(serial_numbers))
        else:
            qty = float(len(serial_numbers))
    else:
        qty = request.quantity

    # For serialized+weight: stock_levels tracks total weight, not count
    # For serialized only: stock_levels tracks count
    # For non-serialized: stock_levels tracks qty as usual
    sl = _find_or_create_level(item, request.location_key, request.location_label,
                                request.property_id, request.unit_id)
    sl.quantity += qty
    sl.available_quantity = sl.quantity - sl.reserved_quantity

    # Bulk weight tracking: record movement_net_qty at stock-in (non-serialized only)
    movement_net_qty: float | None = None
    if item.weight_tracking_enabled and not item.is_serialized and request.movement_net_qty is not None:
        movement_net_qty = request.movement_net_qty
        item.audit_trail.append(InventoryAuditEntry(
            action="WEIGHT_RECORDED",
            actor_id=current_user.user_id,
            description=f"Stock-in: recorded {movement_net_qty} {item.unit_of_measure} for {qty} units",
            changes={"movement_net_qty": movement_net_qty, "quantity": qty},
        ))

    unit_cost = request.unit_cost or item.purchase_cost
    movement = StockMovement(
        movement_type="stock_in",
        quantity=qty,
        unit_of_measure=item.unit_of_measure,
        reference_no=request.reference_no,
        to_location_key=request.location_key,
        to_location_label=request.location_label,
        unit_cost=unit_cost,
        total_cost=(unit_cost or 0) * qty,
        performed_by=current_user.user_id,
        notes=request.notes,
        serial_numbers=serial_numbers,
        serial_count=len(serial_numbers),
        movement_net_qty=movement_net_qty,
        store_location_id=request.store_location_id,
        store_location_path=request.store_location_path,
    )
    item.movements.append(movement)

    # Attach movement_ref and add serials to item
    for serial in new_serials:
        serial.movement_ref = movement.id
        item.serials.append(serial)

    # Handle batch tracking
    if item.batch_tracking_enabled and request.batch_number:
        batch = StockBatch(
            batch_number=request.batch_number,
            lot_number=request.lot_number,
            purchase_date=request.reference_no and None,
            expiry_date=request.expiry_date,
            purchase_cost=request.unit_cost or item.purchase_cost or 0,
            quantity_received=qty,
            quantity_remaining=qty,
        )
        movement.batch_id = batch.id
        item.batches.append(batch)

    audit = _audit("stocked", current_user, f"+{qty} {item.unit_of_measure} added to {request.location_label}")
    item.audit_trail.append(audit)

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "stock_levels": item.stock_levels,
        "batches": item.batches,
        "movements": item.movements,
        "serials": item.serials,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "total_serial_count": item.total_serial_count,
        "status": item.status,
    })

    # Update store location occupancy if a structured location was provided
    if request.store_location_id:
        await store_repository.update_occupancy(current_user.org_id, request.store_location_id, qty)

    return await _to_response(item)


async def stock_out(item_id: str, request: StockOutRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    # ── Serialized item handling ───────────────────────────────────────────────
    serial_numbers: list[str] = []
    variance_events: list[dict] = []
    total_qty = 0.0

    if item.is_serialized:
        # Build {sn: qty_to_take} — from serial_quantities OR serial_numbers (full depletion)
        if request.serial_quantities:
            serial_qty_map: dict[str, float | None] = dict(request.serial_quantities)
        elif request.serial_numbers:
            serial_qty_map = {sn: None for sn in request.serial_numbers}
        else:
            raise HTTPException(status_code=400, detail={"code": "SERIALS_REQUIRED", "message": "serial_numbers or serial_quantities is required for serialized items"})

        for sn, qty_to_take in serial_qty_map.items():
            serial = next(
                (s for s in item.serials if s.serial_number == sn and s.status == "in_stock"),
                None,
            )
            if serial is None:
                raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_AVAILABLE", "message": f"Serial {sn} not in_stock"})

            avail = serial.quantity_remaining if serial.quantity_remaining is not None else 1.0
            if qty_to_take is None:
                qty_to_take = avail
            if qty_to_take > avail + 1e-6:
                raise HTTPException(status_code=400, detail={"code": "INSUFFICIENT_SERIAL_QTY", "message": f"Serial {sn}: requested {qty_to_take} > remaining {avail}"})

            # Weight/volume/length variance check — only when weight_tracking_enabled
            dispatch_wt = (request.serial_dispatch_weights or {}).get(sn) if item.weight_tracking_enabled else None
            if dispatch_wt is not None and serial.net_weight_kg:
                var_kg = abs(serial.net_weight_kg - dispatch_wt)
                var_pct = var_kg / serial.net_weight_kg * 100
                serial.dispatch_net_kg = dispatch_wt
                serial.weight_variance_kg = var_kg
                serial.weight_variance_pct = var_pct

                # ALWAYS write audit entry
                item.audit_trail.append(InventoryAuditEntry(
                    action="WEIGHT_VARIANCE",
                    actor_id=current_user.user_id,
                    description=f"Serial {sn}: {var_pct:.2f}% variance ({var_kg:.3f} kg)",
                    changes={
                        "serial": sn,
                        "variance_kg": var_kg,
                        "variance_pct": var_pct,
                        "soft_limit": item.weight_variance_soft_pct,
                        "hard_limit": item.weight_variance_hard_pct,
                    },
                ))

                if var_pct > item.weight_variance_soft_pct:
                    serial.weight_flagged = True
                    serial.weight_flag_reason = f"{var_pct:.2f}% variance at dispatch"

                if var_pct > item.weight_variance_hard_pct and not request.force_override:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "WEIGHT_VARIANCE_BLOCKED",
                            "message": (
                                f"Weight variance {var_pct:.1f}% exceeds hard limit "
                                f"{item.weight_variance_hard_pct}%. Pass force_override=true to proceed."
                            ),
                        },
                    )

                variance_events.append({
                    "serial": sn,
                    "variance_kg": var_kg,
                    "variance_pct": var_pct,
                    "flagged": serial.weight_flagged,
                    "ts": utc_now().isoformat(),
                })

            # Partial depletion with child-serial dispatch
            dispatched_sn = sn
            if serial.quantity_remaining is not None:
                if item.weight_tracking_enabled and qty_to_take < (serial.quantity_remaining - 1e-6):
                    # Partial dispatch: create a child serial for the dispatched portion
                    n = len(serial.child_serial_ids) + 1
                    child_sn = f"{sn}.{n:02d}"
                    child = StockSerial(
                        serial_number=child_sn,
                        status="dispatched",
                        net_weight_kg=qty_to_take,
                        quantity_remaining=0.0,
                        parent_serial_id=sn,
                        location_key=serial.location_key,
                        dispatch_net_kg=(request.serial_dispatch_weights or {}).get(sn),
                        weight_variance_kg=serial.weight_variance_kg,
                        weight_variance_pct=serial.weight_variance_pct,
                        weight_flagged=serial.weight_flagged,
                        weight_flag_reason=serial.weight_flag_reason,
                    )
                    serial.child_serial_ids.append(child_sn)
                    serial.quantity_remaining = round(serial.quantity_remaining - qty_to_take, 6)
                    # Parent stays in_stock — child carries the dispatched portion
                    item.serials.append(child)
                    dispatched_sn = child_sn
                else:
                    # Full or near-full depletion
                    serial.quantity_remaining = round(serial.quantity_remaining - qty_to_take, 6)
                    if serial.quantity_remaining <= 1e-6:
                        serial.status = "depleted"
                        serial.quantity_remaining = 0.0
                    # else stays dispatched but still has remainder
            else:
                serial.status = "dispatched"   # no weight tracking — classic full dispatch

            serial.movement_ref = utc_now().isoformat()  # will be overwritten after movement creation
            serial.updated_at = utc_now()
            total_qty += qty_to_take
            serial_numbers.append(dispatched_sn)

        qty = total_qty
    else:
        qty = request.quantity

    sl = next((s for s in item.stock_levels if s.location_key == request.location_key), None)
    if not sl or sl.available_quantity < qty:
        raise HTTPException(status_code=400, detail={"code": "INSUFFICIENT_STOCK", "message": "Insufficient available stock at location"})

    sl.quantity -= qty
    sl.available_quantity = sl.quantity - sl.reserved_quantity

    # ── Bulk (non-serialized) movement-level variance check ───────────────────
    movement_dispatch_qty: float | None = None
    movement_variance_pct: float | None = None
    movement_weight_flagged = False

    if item.weight_tracking_enabled and not item.is_serialized and request.movement_dispatch_qty is not None:
        movement_dispatch_qty = request.movement_dispatch_qty
        expected = qty * item.weight_per_unit if item.weight_per_unit else None
        if expected:
            var_pct = abs(expected - movement_dispatch_qty) / expected * 100
            movement_variance_pct = var_pct
            item.audit_trail.append(InventoryAuditEntry(
                action="WEIGHT_VARIANCE",
                actor_id=current_user.user_id,
                description=f"Dispatch: {var_pct:.2f}% variance (expected {expected:.3f}, got {movement_dispatch_qty:.3f} {item.unit_of_measure})",
                changes={"expected": expected, "dispatch": movement_dispatch_qty, "variance_pct": var_pct},
            ))
            if var_pct > item.weight_variance_soft_pct:
                movement_weight_flagged = True
            if var_pct > item.weight_variance_hard_pct and not request.force_override:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "WEIGHT_VARIANCE_BLOCKED",
                        "message": (
                            f"Dispatch variance {var_pct:.1f}% exceeds hard limit "
                            f"{item.weight_variance_hard_pct}%. Pass force_override=true to proceed."
                        ),
                    },
                )

    movement = StockMovement(
        movement_type="stock_out",
        quantity=qty,
        unit_of_measure=item.unit_of_measure,
        reference_no=request.reference_no,
        from_location_key=request.location_key,
        from_location_label=sl.location_label,
        batch_id=request.batch_id,
        performed_by=current_user.user_id,
        notes=request.notes,
        serial_numbers=serial_numbers,
        serial_count=len(serial_numbers),
        serial_weights=request.serial_dispatch_weights or {},
        serial_quantities_taken={sn: float(v) for sn, v in (request.serial_quantities or {}).items()},
        weight_variance_events=variance_events,
        movement_dispatch_qty=movement_dispatch_qty,
        movement_variance_pct=movement_variance_pct,
        movement_weight_flagged=movement_weight_flagged,
        store_location_id=request.store_location_id,
        store_location_path=request.store_location_path,
    )
    item.movements.append(movement)

    # Fix up movement_ref on serials now that we have the movement id
    serial_set = set(serial_numbers)
    for s in item.serials:
        if s.serial_number in serial_set:
            s.movement_ref = movement.id

    audit = _audit("stocked", current_user, f"-{qty} {item.unit_of_measure} removed from {sl.location_label}")
    item.audit_trail.append(audit)

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "stock_levels": item.stock_levels,
        "movements": item.movements,
        "serials": item.serials,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "total_serial_count": item.total_serial_count,
        "status": item.status,
    })

    # Decrement store location occupancy — prefer request override, then first serial's stored location
    out_location_id = request.store_location_id
    if not out_location_id and item.is_serialized and serial_numbers:
        dispatched_serial = next(
            (s for s in item.serials if s.serial_number == serial_numbers[0]),
            None,
        )
        if dispatched_serial:
            out_location_id = dispatched_serial.store_location_id
    if out_location_id:
        await store_repository.update_occupancy(current_user.org_id, out_location_id, -qty)

    return await _to_response(item)


async def adjust_stock(item_id: str, request: StockAdjustRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    sl = _find_or_create_level(item, request.location_key, request.location_label,
                                request.property_id, request.unit_id)
    old_qty = sl.quantity
    sl.quantity = request.quantity
    sl.available_quantity = sl.quantity - sl.reserved_quantity

    diff = request.quantity - old_qty
    movement = StockMovement(
        movement_type="adjustment",
        quantity=abs(diff),
        unit_of_measure=item.unit_of_measure,
        to_location_key=request.location_key if diff >= 0 else None,
        to_location_label=sl.location_label if diff >= 0 else None,
        from_location_key=request.location_key if diff < 0 else None,
        from_location_label=sl.location_label if diff < 0 else None,
        performed_by=current_user.user_id,
        notes=request.notes or f"Physical count: {old_qty} → {request.quantity}",
    )
    item.movements.append(movement)
    audit = _audit("adjusted", current_user, f"Stock adjusted at {sl.location_label}: {old_qty} → {request.quantity}")
    item.audit_trail.append(audit)

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "stock_levels": item.stock_levels,
        "movements": item.movements,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "status": item.status,
    })
    return await _to_response(item)


async def transfer_stock(item_id: str, request: StockTransferRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    # ── Serialized item handling ───────────────────────────────────────────────
    serial_numbers: list[str] = []
    if item.is_serialized:
        if not request.serial_numbers:
            raise HTTPException(status_code=400, detail={"code": "SERIALS_REQUIRED", "message": "serial_numbers is required for serialized items"})
        serial_map = {s.serial_number: s for s in item.serials}
        for sn in request.serial_numbers:
            entry = serial_map.get(sn)
            if not entry:
                raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_FOUND", "message": f"Serial not found: {sn}"})
            if entry.status != "in_stock":
                raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_AVAILABLE", "message": f"Serial not available: {sn}"})
        serial_numbers = list(request.serial_numbers)
        qty = float(len(serial_numbers))
    else:
        qty = request.quantity

    from_sl = next((s for s in item.stock_levels if s.location_key == request.from_location_key), None)
    if not from_sl or from_sl.available_quantity < qty:
        raise HTTPException(status_code=400, detail={"code": "INSUFFICIENT_STOCK", "message": "Insufficient available stock at source location"})

    from_sl.quantity -= qty
    from_sl.available_quantity = from_sl.quantity - from_sl.reserved_quantity

    to_sl = _find_or_create_level(item, request.to_location_key, request.to_location_label,
                                   request.to_property_id)
    to_sl.quantity += qty
    to_sl.available_quantity = to_sl.quantity - to_sl.reserved_quantity

    movement = StockMovement(
        movement_type="transfer_out",
        quantity=qty,
        unit_of_measure=item.unit_of_measure,
        from_location_key=request.from_location_key,
        from_location_label=request.from_location_label,
        to_location_key=request.to_location_key,
        to_location_label=request.to_location_label,
        batch_id=request.batch_id,
        performed_by=current_user.user_id,
        notes=request.notes,
        serial_numbers=serial_numbers,
    )
    item.movements.append(movement)

    # Update serial location
    for s in item.serials:
        if s.serial_number in serial_numbers:
            s.location_key = request.to_location_key
            s.movement_ref = movement.id

    audit = _audit("transferred", current_user, f"{qty} transferred: {request.from_location_label} → {request.to_location_label}")
    item.audit_trail.append(audit)

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "stock_levels": item.stock_levels,
        "movements": item.movements,
        "serials": item.serials,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "status": item.status,
    })
    return await _to_response(item)


async def record_damaged(item_id: str, request: StockDamagedRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    sl = next((s for s in item.stock_levels if s.location_key == request.location_key), None)
    if not sl or sl.quantity < request.quantity:
        raise HTTPException(status_code=400, detail={"code": "INSUFFICIENT_STOCK", "message": "Insufficient stock to record loss"})

    sl.quantity -= request.quantity
    sl.available_quantity = sl.quantity - sl.reserved_quantity

    movement = StockMovement(
        movement_type=request.reason,
        quantity=request.quantity,
        unit_of_measure=item.unit_of_measure,
        from_location_key=request.location_key,
        from_location_label=sl.location_label,
        performed_by=current_user.user_id,
        notes=request.notes,
    )
    item.movements.append(movement)
    audit = _audit("adjusted", current_user, f"{request.quantity} {item.unit_of_measure} recorded as {request.reason}")
    item.audit_trail.append(audit)

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "stock_levels": item.stock_levels,
        "movements": item.movements,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "status": item.status,
    })
    return await _to_response(item)


async def delete_item(item_id: str, current_user: CurrentUser) -> None:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})
    await inventory_repository.soft_delete(item)


async def merge_serials(item_id: str, request: SerialMergeRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    if not request.source_serials:
        raise HTTPException(status_code=400, detail={"code": "MERGE_NO_SOURCES", "message": "At least one source serial is required"})

    # Load property-level inventory config
    prop = await property_repository.get_by_id(item.property_id, current_user.org_id) if item.property_id else None
    merge_mode = prop.inventory_config.serial_merge_mode if prop and prop.inventory_config else "keep_target"

    serial_map = {s.serial_number: s for s in item.serials}

    # Validate source serials
    for sn in request.source_serials:
        s = serial_map.get(sn)
        if not s or s.status != "in_stock":
            raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_AVAILABLE", "message": f"Source serial {sn} not in_stock"})

    if merge_mode == "keep_target":
        if not request.target_serial:
            raise HTTPException(status_code=400, detail={"code": "MERGE_TARGET_REQUIRED", "message": "target_serial is required when mode=keep_target"})
        if request.target_serial in request.source_serials:
            raise HTTPException(status_code=400, detail={"code": "MERGE_TARGET_IN_SOURCES", "message": "target_serial must not be in source_serials"})
        target = serial_map.get(request.target_serial)
        if not target or target.status != "in_stock":
            raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_AVAILABLE", "message": f"Target serial {request.target_serial} not in_stock"})
    else:  # create_new
        if not request.new_serial_number:
            raise HTTPException(status_code=400, detail={"code": "MERGE_NEW_SN_REQUIRED", "message": "new_serial_number is required when mode=create_new"})
        if request.new_serial_number in serial_map:
            raise HTTPException(status_code=409, detail={"code": "SERIAL_DUPLICATE", "message": f"Serial {request.new_serial_number} already exists"})

    sources = [serial_map[sn] for sn in request.source_serials]
    total_qty = round(sum(s.quantity_remaining or 0.0 for s in sources), 6)
    total_net_weight = round(sum(s.net_weight_kg or 0.0 for s in sources), 6)

    if merge_mode == "keep_target":
        target = serial_map[request.target_serial]  # type: ignore[index]
        target.quantity_remaining = round((target.quantity_remaining or 0.0) + total_qty, 6)
        target.net_weight_kg = round((target.net_weight_kg or 0.0) + total_net_weight, 6)
        target.updated_at = utc_now()
        for s in sources:
            s.status = "merged"
            s.updated_at = utc_now()
        surviving_sn = request.target_serial
    else:
        for s in sources:
            s.status = "merged"
            s.updated_at = utc_now()
        new_s = StockSerial(
            serial_number=request.new_serial_number,  # type: ignore[arg-type]
            status="in_stock",
            net_weight_kg=total_qty,
            quantity_remaining=total_qty,
            location_key=sources[0].location_key if sources else None,
        )
        item.serials.append(new_s)
        surviving_sn = request.new_serial_number  # type: ignore[assignment]

    movement = StockMovement(
        movement_type="merge",
        quantity=total_qty,
        unit_of_measure=item.unit_of_measure,
        serial_numbers=[surviving_sn],
        serial_count=1,
        notes=request.notes,
        performed_by=current_user.user_id,
    )
    item.movements.append(movement)

    # Set movement_ref on surviving serial
    for s in item.serials:
        if s.serial_number == surviving_sn:
            s.movement_ref = movement.id

    item.audit_trail.append(_audit(
        "merge", current_user,
        f"Merged {request.source_serials} into {surviving_sn} ({total_qty} {item.unit_of_measure})",
        changes={"sources": request.source_serials, "surviving": surviving_sn, "total_qty": total_qty},
    ))

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "serials": item.serials,
        "movements": item.movements,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "total_serial_count": item.total_serial_count,
        "status": item.status,
    })
    return await _to_response(item)


async def split_serial(item_id: str, request: SerialSplitRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    # Load property-level inventory config
    prop = await property_repository.get_by_id(item.property_id, current_user.org_id) if item.property_id else None
    remainder_pct = prop.inventory_config.serial_split_remainder_pct if prop and prop.inventory_config else 0.0

    serial_map = {s.serial_number: s for s in item.serials}
    source = serial_map.get(request.source_serial)
    if not source or source.status != "in_stock":
        raise HTTPException(status_code=400, detail={"code": "SERIAL_NOT_AVAILABLE", "message": f"Source serial {request.source_serial} not in_stock"})

    if len(request.new_serials) < 2:
        raise HTTPException(status_code=400, detail={"code": "SPLIT_TOO_FEW", "message": "At least 2 new serials are required for a split"})

    # Validate no duplicate new S/Ns
    new_sns = [ns.serial_number for ns in request.new_serials]
    if len(new_sns) != len(set(new_sns)):
        raise HTTPException(status_code=400, detail={"code": "SPLIT_DUPLICATE_SNS", "message": "Duplicate serial numbers in new_serials"})
    for sn in new_sns:
        if sn in serial_map:
            raise HTTPException(status_code=409, detail={"code": "SERIAL_DUPLICATE", "message": f"Serial {sn} already exists"})

    source_qty = source.quantity_remaining or 0.0
    total_new = round(sum(ns.quantity for ns in request.new_serials), 6)
    remainder = round(source_qty - total_new, 6)

    if remainder < -1e-6:
        raise HTTPException(status_code=400, detail={"code": "SPLIT_EXCEEDS_REMAINING", "message": f"Total new quantities ({total_new}) exceed source remaining ({source_qty})"})

    allowable = source_qty * (remainder_pct / 100.0) if remainder_pct > 0 else 0.0
    if remainder > allowable + 1e-6:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "SPLIT_REMAINDER_EXCEEDED",
                "message": f"Unaccounted remainder {remainder} {item.unit_of_measure} exceeds allowed {remainder_pct}% ({allowable:.4f})",
            },
        )

    source.status = "split"
    source.quantity_remaining = 0.0
    source.updated_at = utc_now()

    for ns in request.new_serials:
        new_s = StockSerial(
            serial_number=ns.serial_number,
            status="in_stock",
            net_weight_kg=ns.quantity,
            quantity_remaining=ns.quantity,
            location_key=source.location_key,
            parent_serial_id=source.serial_number,
        )
        item.serials.append(new_s)

    if remainder > 1e-6:
        item.audit_trail.append(InventoryAuditEntry(
            action="SPLIT_REMAINDER",
            actor_id=current_user.user_id,
            description=f"Split remainder {remainder} {item.unit_of_measure} written off (threshold={remainder_pct}%)",
            changes={"source": request.source_serial, "remainder": remainder, "threshold_pct": remainder_pct},
        ))

    movement = StockMovement(
        movement_type="split",
        quantity=total_new,
        unit_of_measure=item.unit_of_measure,
        serial_numbers=new_sns,
        serial_count=len(new_sns),
        notes=request.notes,
        performed_by=current_user.user_id,
    )
    item.movements.append(movement)

    item.audit_trail.append(_audit(
        "split", current_user,
        f"Split {request.source_serial} ({source_qty} {item.unit_of_measure}) into {new_sns}",
        changes={"source": request.source_serial, "new_serials": new_sns, "remainder": remainder},
    ))

    _recalc_totals(item)
    await inventory_repository.update(item, {
        "serials": item.serials,
        "movements": item.movements,
        "audit_trail": item.audit_trail,
        "total_quantity": item.total_quantity,
        "total_reserved": item.total_reserved,
        "total_available": item.total_available,
        "total_serial_count": item.total_serial_count,
        "status": item.status,
    })
    return await _to_response(item)


# ── Variant CRUD ──────────────────────────────────────────────────────────────

async def create_variant(item_id: str, data: InventoryVariantCreateRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    variant = InventoryVariant(
        name=data.name,
        sku=data.sku,
        purchase_cost=data.purchase_cost,
        selling_price=data.selling_price,
        attributes=data.attributes,
    )
    item.variants.append(variant)
    item.audit_trail.append(_audit("variant_created", current_user, f"Variant '{data.name}' added"))
    await inventory_repository.update(item, {"variants": item.variants, "audit_trail": item.audit_trail})
    return await _to_response(item)


async def update_variant(item_id: str, variant_id: str, data: InventoryVariantUpdateRequest, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    variant = next((v for v in item.variants if v.id == variant_id), None)
    if not variant:
        raise HTTPException(status_code=404, detail={"code": "VARIANT_NOT_FOUND", "message": "Variant not found"})

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)
    variant.updated_at = utc_now()

    item.audit_trail.append(_audit("variant_updated", current_user, f"Variant '{variant.name}' updated"))
    await inventory_repository.update(item, {"variants": item.variants, "audit_trail": item.audit_trail})
    return await _to_response(item)


async def delete_variant(item_id: str, variant_id: str, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    variant = next((v for v in item.variants if v.id == variant_id), None)
    if not variant:
        raise HTTPException(status_code=404, detail={"code": "VARIANT_NOT_FOUND", "message": "Variant not found"})

    item.variants = [v for v in item.variants if v.id != variant_id]
    item.audit_trail.append(_audit("variant_deleted", current_user, f"Variant '{variant.name}' deleted"))
    await inventory_repository.update(item, {"variants": item.variants, "audit_trail": item.audit_trail})
    return await _to_response(item)


async def upload_variant_image(item_id: str, variant_id: str, file: UploadFile, current_user: CurrentUser) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail={"code": "ITEM_NOT_FOUND", "message": "Inventory item not found"})

    variant = next((v for v in item.variants if v.id == variant_id), None)
    if not variant:
        raise HTTPException(status_code=404, detail={"code": "VARIANT_NOT_FOUND", "message": "Variant not found"})

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail={"code": "INVALID_FILE", "message": "File must be an image"})

    ext = (file.filename or "image").rsplit(".", 1)[-1].lower()
    key = s3_path(current_user.org_id, "inventory", f"{item_id}/variants/{variant_id}", f"image.{ext}")

    async with get_s3_client() as s3:
        await s3.upload_fileobj(
            file.file,
            settings.s3_bucket_name,
            key,
            ExtraArgs={"ContentType": file.content_type},
        )

    variant.image_key = key
    variant.updated_at = utc_now()
    item.audit_trail.append(_audit("variant_image_uploaded", current_user, f"Image uploaded for variant '{variant.name}'"))
    await inventory_repository.update(item, {"variants": item.variants, "audit_trail": item.audit_trail})
    return await _to_response(item)


async def upload_item_image(
    item_id: str,
    file: UploadFile,
    current_user: CurrentUser,
) -> InventoryItemResponse:
    item = await inventory_repository.get_by_id(item_id, current_user.org_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    content = await file.read()
    ext = (file.filename or "image").rsplit(".", 1)[-1].lower() or "jpg"
    key = s3_path(current_user.org_id, "inventory", item_id, f"image.{ext}")

    async with get_s3_client() as s3:
        await s3.put_object(
            Bucket=settings.s3_bucket_name,
            Key=key,
            Body=content,
            ContentType=file.content_type or "image/jpeg",
        )

    item.image_key = key
    item.audit_trail.append(_audit("image_uploaded", current_user, "Primary product image uploaded"))
    item.updated_at = utc_now()
    await item.save()
    return await _to_response(item)
