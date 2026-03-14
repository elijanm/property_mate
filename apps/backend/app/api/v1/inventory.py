"""Inventory API endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.inventory import (
    InventoryCountsResponse,
    InventoryItemCreateRequest,
    InventoryItemResponse,
    InventoryItemUpdateRequest,
    InventoryListResponse,
    InventoryVariantCreateRequest,
    InventoryVariantUpdateRequest,
    SerialMergeRequest,
    SerialSplitRequest,
    ShipmentCreateRequest,
    ShipmentListResponse,
    ShipmentPublicContext,
    ShipmentResponse,
    ShipmentSignRequest,
    StockAdjustRequest,
    StockDamagedRequest,
    StockInRequest,
    StockOutRequest,
    StockTransferRequest,
)
from app.services import inventory_service
from app.services import shipment_service

router = APIRouter(tags=["inventory"])
shipment_sign_router = APIRouter(tags=["shipment-sign"])


@router.post(
    "/inventory",
    response_model=InventoryItemResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_item(
    request: InventoryItemCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.create_item(request, current_user)


@router.get(
    "/inventory/counts",
    response_model=InventoryCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_counts(
    property_id: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryCountsResponse:
    return await inventory_service.get_counts(current_user, property_id)


@router.get(
    "/inventory",
    response_model=InventoryListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_items(
    property_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    low_stock_only: bool = Query(False),
    hazard_class: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryListResponse:
    return await inventory_service.list_items(
        current_user,
        property_id=property_id,
        category=category,
        status=status,
        low_stock_only=low_stock_only,
        hazard_class=hazard_class,
        search=search,
        page=page,
        page_size=page_size,
    )


# ── Shipment admin endpoints (must be before /{item_id} to avoid route conflict) ─

@router.post(
    "/inventory/shipments",
    response_model=ShipmentResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_shipment(
    request: ShipmentCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> ShipmentResponse:
    return await shipment_service.create_shipment(request, current_user)


@router.get(
    "/inventory/shipments",
    response_model=ShipmentListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_shipments(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> ShipmentListResponse:
    return await shipment_service.list_shipments(current_user, status, page, page_size)


@router.get(
    "/inventory/shipments/{shipment_id}",
    response_model=ShipmentResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_shipment(
    shipment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> ShipmentResponse:
    return await shipment_service.get_shipment(shipment_id, current_user)


@router.get(
    "/inventory/shipments/{shipment_id}/pdf",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_shipment_pdf(
    shipment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    url = await shipment_service.get_shipment_pdf_url(shipment_id, current_user)
    return {"url": url}


# ── Per-item endpoints ─────────────────────────────────────────────────────────

@router.get(
    "/inventory/{item_id}",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.get_item(item_id, current_user)


@router.patch(
    "/inventory/{item_id}",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_item(
    item_id: str,
    request: InventoryItemUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.update_item(item_id, request, current_user)


@router.delete(
    "/inventory/{item_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await inventory_service.delete_item(item_id, current_user)


@router.post(
    "/inventory/{item_id}/stock-in",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def stock_in(
    item_id: str,
    request: StockInRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.stock_in(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/stock-out",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def stock_out(
    item_id: str,
    request: StockOutRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.stock_out(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/adjust",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def adjust_stock(
    item_id: str,
    request: StockAdjustRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.adjust_stock(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/transfer",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def transfer_stock(
    item_id: str,
    request: StockTransferRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.transfer_stock(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/damaged",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def record_damaged(
    item_id: str,
    request: StockDamagedRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.record_damaged(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/serials/merge",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def merge_serials(
    item_id: str,
    request: SerialMergeRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.merge_serials(item_id, request, current_user)


@router.post(
    "/inventory/{item_id}/serials/split",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def split_serial(
    item_id: str,
    request: SerialSplitRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.split_serial(item_id, request, current_user)


# ── Variant endpoints ──────────────────────────────────────────────────────────

@router.post(
    "/inventory/{item_id}/variants",
    response_model=InventoryItemResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_variant(
    item_id: str,
    request: InventoryVariantCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.create_variant(item_id, request, current_user)


@router.patch(
    "/inventory/{item_id}/variants/{variant_id}",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_variant(
    item_id: str,
    variant_id: str,
    request: InventoryVariantUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.update_variant(item_id, variant_id, request, current_user)


@router.delete(
    "/inventory/{item_id}/variants/{variant_id}",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def delete_variant(
    item_id: str,
    variant_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.delete_variant(item_id, variant_id, current_user)


@router.post(
    "/inventory/{item_id}/variants/{variant_id}/image",
    response_model=InventoryItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def upload_variant_image(
    item_id: str,
    variant_id: str,
    file: UploadFile,
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.upload_variant_image(item_id, variant_id, file, current_user)


@router.post(
    "/inventory/{item_id}/image",
    response_model=InventoryItemResponse,
    summary="Upload primary product image",
)
async def upload_item_image(
    item_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryItemResponse:
    return await inventory_service.upload_item_image(item_id, file, current_user)


# ── Public shipment sign endpoints ────────────────────────────────────────────

@shipment_sign_router.get(
    "/shipment-sign/{token}/driver",
    response_model=ShipmentPublicContext,
)
async def driver_context(token: str) -> ShipmentPublicContext:
    return await shipment_service.get_driver_sign_context(token)


@shipment_sign_router.post("/shipment-sign/{token}/driver/sign")
async def driver_sign(
    token: str,
    request: ShipmentSignRequest,
    http_request: Request,
) -> dict:
    ip = http_request.client.host if http_request.client else None
    return await shipment_service.sign_driver(token, request, ip)


@shipment_sign_router.get(
    "/shipment-sign/{token}/receiver",
    response_model=ShipmentPublicContext,
)
async def receiver_context(token: str) -> ShipmentPublicContext:
    return await shipment_service.get_receiver_sign_context(token)


@shipment_sign_router.post("/shipment-sign/{token}/receiver/sign")
async def receiver_sign(
    token: str,
    request: ShipmentSignRequest,
    http_request: Request,
) -> dict:
    ip = http_request.client.host if http_request.client else None
    return await shipment_service.sign_receiver(token, request, ip)
