"""Inventory request/response schemas."""
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Audit entry response ───────────────────────────────────────────────────────

class InventoryAuditEntryResponse(BaseModel):
    id: str
    action: str
    actor_id: str
    actor_name: Optional[str] = None
    changes: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    timestamp: datetime


# ── Variant schemas ────────────────────────────────────────────────────────────

class InventoryVariantResponse(BaseModel):
    id: str
    name: str
    sku: Optional[str] = None
    image_key: Optional[str] = None      # S3 key; presign via separate endpoint if needed
    image_url: Optional[str] = None      # presigned S3 URL
    purchase_cost: Optional[float] = None
    selling_price: Optional[float] = None
    attributes: Dict[str, str] = {}
    status: str
    created_at: datetime
    updated_at: datetime


class InventoryVariantCreateRequest(BaseModel):
    name: str
    sku: Optional[str] = None
    purchase_cost: Optional[float] = None
    selling_price: Optional[float] = None
    attributes: Dict[str, str] = {}


class InventoryVariantUpdateRequest(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    purchase_cost: Optional[float] = None
    selling_price: Optional[float] = None
    attributes: Optional[Dict[str, str]] = None
    status: Optional[str] = None

# Type alias used in StockMovementResponse
_VarEvent = Dict[str, Any]


# ── Embedded response sub-models ──────────────────────────────────────────────

class StockSerialResponse(BaseModel):
    id: str
    serial_number: str
    status: str
    location_key: Optional[str]
    movement_ref: Optional[str]
    added_at: datetime
    updated_at: datetime
    gross_weight_kg: Optional[float] = None
    tare_weight_kg: Optional[float] = None
    net_weight_kg: Optional[float] = None
    quantity_remaining: Optional[float] = None
    dispatch_gross_kg: Optional[float] = None
    dispatch_net_kg: Optional[float] = None
    weight_variance_kg: Optional[float] = None
    weight_variance_pct: Optional[float] = None
    weight_flagged: bool = False
    weight_flag_reason: Optional[str] = None
    parent_serial_id: Optional[str] = None
    child_serial_ids: List[str] = []
    purchase_cost: Optional[float] = None
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    variant_id: Optional[str] = None
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None


class StockBatchResponse(BaseModel):
    id: str
    batch_number: str
    lot_number: Optional[str]
    supplier_name: Optional[str]
    purchase_date: Optional[date]
    expiry_date: Optional[date]
    purchase_cost: float
    quantity_received: float
    quantity_remaining: float
    notes: Optional[str]
    created_at: datetime


class StockLevelResponse(BaseModel):
    location_key: str
    location_label: str
    property_id: Optional[str]
    unit_id: Optional[str]
    quantity: float
    reserved_quantity: float
    available_quantity: float


class StockMovementResponse(BaseModel):
    id: str
    movement_type: str
    quantity: float
    unit_of_measure: str
    reference_no: Optional[str]
    batch_id: Optional[str]
    from_location_label: Optional[str]
    to_location_label: Optional[str]
    unit_cost: Optional[float]
    total_cost: Optional[float]
    performed_by_name: Optional[str]
    notes: Optional[str]
    serial_numbers: List[str] = []
    shipment_id: Optional[str] = None
    serial_weights: Dict[str, float] = {}
    serial_quantities_taken: Dict[str, float] = {}
    weight_variance_events: List[_VarEvent] = []
    serial_count: int = 0
    movement_net_qty: Optional[float] = None
    movement_dispatch_qty: Optional[float] = None
    movement_variance_pct: Optional[float] = None
    movement_weight_flagged: bool = False
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None
    created_at: datetime


# ── Inventory CRUD ────────────────────────────────────────────────────────────

class InventoryItemCreateRequest(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = []
    custom_fields: Dict[str, Any] = {}

    hazard_classes: List[str] = []
    safety_notes: Optional[str] = None
    requires_controlled_handling: bool = False

    unit_of_measure: str = "unit"
    units_per_package: float = 1.0

    barcode: Optional[str] = None
    sku: Optional[str] = None
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    manufacturer_part_number: Optional[str] = None

    purchase_cost: Optional[float] = None
    markup_percent: float = 0.0

    min_stock_level: float = 0.0
    max_stock_level: Optional[float] = None
    reorder_point: float = 0.0
    reorder_quantity: float = 0.0

    storage_location: Optional[str] = None
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None
    property_id: Optional[str] = None

    is_serialized: bool = False
    weight_per_unit: Optional[float] = None
    weight_tracking_enabled: bool = False
    tare_tracking_enabled: bool = False
    weight_variance_soft_pct: float = 2.0
    weight_variance_hard_pct: float = 5.0

    batch_tracking_enabled: bool = False
    expiry_tracking_enabled: bool = False
    notes: Optional[str] = None


class InventoryItemUpdateRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None

    hazard_classes: Optional[List[str]] = None
    safety_notes: Optional[str] = None
    requires_controlled_handling: Optional[bool] = None

    unit_of_measure: Optional[str] = None
    units_per_package: Optional[float] = None

    barcode: Optional[str] = None
    sku: Optional[str] = None
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    manufacturer_part_number: Optional[str] = None

    purchase_cost: Optional[float] = None
    markup_percent: Optional[float] = None

    min_stock_level: Optional[float] = None
    max_stock_level: Optional[float] = None
    reorder_point: Optional[float] = None
    reorder_quantity: Optional[float] = None

    storage_location: Optional[str] = None
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None
    property_id: Optional[str] = None

    is_serialized: Optional[bool] = None
    weight_per_unit: Optional[float] = None
    weight_tracking_enabled: Optional[bool] = None
    tare_tracking_enabled: Optional[bool] = None
    weight_variance_soft_pct: Optional[float] = None
    weight_variance_hard_pct: Optional[float] = None
    batch_tracking_enabled: Optional[bool] = None
    expiry_tracking_enabled: Optional[bool] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# ── Stock movement requests ───────────────────────────────────────────────────

class StockInRequest(BaseModel):
    """Receive new stock into a location."""
    quantity: float = Field(gt=0)
    location_key: str
    location_label: str
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    unit_cost: Optional[float] = None
    reference_no: Optional[str] = None
    # Batch info (used when batch_tracking_enabled)
    batch_number: Optional[str] = None
    lot_number: Optional[str] = None
    expiry_date: Optional[date] = None
    serial_numbers: Optional[List[str]] = None
    serial_weights: Optional[Dict[str, float]] = None        # {serial_number: net_qty} (serialized+weight)
    serial_tare_weights: Optional[Dict[str, float]] = None   # {serial_number: tare_qty} (tare mode)
    serial_purchase_costs: Optional[Dict[str, float]] = None # {serial_number: purchase_cost}
    serial_selling_prices: Optional[Dict[str, float]] = None # {serial_number: selling_price}
    serial_variant_ids: Optional[Dict[str, str]] = None      # {serial_number: variant_id}
    movement_net_qty: Optional[float] = None                 # total qty recorded at weigh-in (bulk+weight)
    store_location_id: Optional[str] = None                  # structured store location destination
    store_location_path: Optional[str] = None                # human-readable path
    notes: Optional[str] = None


class StockOutRequest(BaseModel):
    """Remove stock from a location (sale/use/waste)."""
    quantity: float = Field(gt=0)
    location_key: str
    reference_no: Optional[str] = None
    batch_id: Optional[str] = None
    serial_numbers: Optional[List[str]] = None
    serial_quantities: Optional[Dict[str, float]] = None        # {sn: qty_to_take}; default = full qty_remaining
    serial_dispatch_weights: Optional[Dict[str, float]] = None  # {sn: dispatch_net_qty} (serialized+weight)
    movement_dispatch_qty: Optional[float] = None               # measured total qty at dispatch (bulk+weight)
    force_override: bool = False                                 # bypass hard variance block
    store_location_id: Optional[str] = None                     # store location source (overrides serial's stored location)
    store_location_path: Optional[str] = None
    notes: Optional[str] = None


class StockAdjustRequest(BaseModel):
    """Set absolute quantity at a location (physical count reconciliation)."""
    quantity: float = Field(ge=0)
    location_key: str
    location_label: str
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    notes: Optional[str] = None


class StockTransferRequest(BaseModel):
    """Move stock between two locations."""
    quantity: float = Field(gt=0)
    from_location_key: str
    from_location_label: str
    to_location_key: str
    to_location_label: str
    to_property_id: Optional[str] = None
    batch_id: Optional[str] = None
    serial_numbers: Optional[List[str]] = None
    notes: Optional[str] = None


class StockReserveRequest(BaseModel):
    """Reserve stock for a work order or planned use."""
    quantity: float = Field(gt=0)
    location_key: str
    reference_no: Optional[str] = None   # work order / ticket id
    notes: Optional[str] = None


class StockIssueRequest(BaseModel):
    """Issue reserved or available stock against a reference."""
    quantity: float = Field(gt=0)
    location_key: str
    reference_no: Optional[str] = None
    batch_id: Optional[str] = None
    notes: Optional[str] = None


class StockReturnRequest(BaseModel):
    """Return previously issued stock back to a location."""
    quantity: float = Field(gt=0)
    location_key: str
    condition: Optional[str] = None   # good | damaged
    notes: Optional[str] = None


class StockDamagedRequest(BaseModel):
    """Record damaged/lost stock."""
    quantity: float = Field(gt=0)
    location_key: str
    # damaged | lost
    reason: str = "damaged"
    notes: Optional[str] = None


class SerialMergeRequest(BaseModel):
    """Merge one or more serials into a target (or new) serial."""
    target_serial: Optional[str] = None      # required when mode=keep_target
    source_serials: List[str]                # 1+ serials to absorb (must be in_stock)
    new_serial_number: Optional[str] = None  # required when mode=create_new
    notes: Optional[str] = None


class NewSerialSpec(BaseModel):
    serial_number: str
    quantity: float  # weight/volume/length for this portion


class SerialSplitRequest(BaseModel):
    """Split one serial into two or more new serials with specified weights."""
    source_serial: str
    new_serials: List[NewSerialSpec]         # at least 2
    notes: Optional[str] = None


# ── Response schemas ──────────────────────────────────────────────────────────

class InventoryItemResponse(BaseModel):
    id: str
    org_id: str
    item_id: str
    barcode: Optional[str]
    qr_code_key: Optional[str]

    name: str
    description: Optional[str]
    category: str
    subcategory: Optional[str]
    tags: List[str]
    custom_fields: Dict[str, Any]

    hazard_classes: List[str]
    safety_notes: Optional[str]
    requires_controlled_handling: bool

    unit_of_measure: str
    units_per_package: float

    sku: Optional[str]
    vendor_name: Optional[str]
    manufacturer: Optional[str]
    manufacturer_part_number: Optional[str]

    purchase_cost: Optional[float]
    markup_percent: float
    selling_price: Optional[float]

    min_stock_level: float
    max_stock_level: Optional[float]
    reorder_point: float
    reorder_quantity: float

    storage_location: Optional[str]
    store_location_id: Optional[str]
    store_location_path: Optional[str]
    property_id: Optional[str]
    property_name: Optional[str]

    is_serialized: bool
    weight_per_unit: Optional[float]
    weight_tracking_enabled: bool
    tare_tracking_enabled: bool
    weight_variance_soft_pct: float
    weight_variance_hard_pct: float
    status: str
    batch_tracking_enabled: bool
    expiry_tracking_enabled: bool

    total_quantity: float
    total_reserved: float
    total_available: float
    total_serial_count: int = 0

    stock_levels: List[StockLevelResponse]
    batches: List[StockBatchResponse]
    movements: List[StockMovementResponse]
    serials: List[StockSerialResponse] = []
    variants: List[InventoryVariantResponse] = []
    audit_trail: List[InventoryAuditEntryResponse] = []

    attachment_keys: List[str]
    image_key: Optional[str]
    image_url: Optional[str] = None      # presigned S3 URL
    notes: Optional[str]

    created_by: str
    created_at: datetime
    updated_at: datetime

    # Computed alert flags
    is_low_stock: bool = False
    has_expired_batches: bool = False


class InventoryListResponse(BaseModel):
    items: List[InventoryItemResponse]
    total: int
    page: int
    page_size: int


class InventoryCountsResponse(BaseModel):
    total: int
    active: int
    low_stock: int
    out_of_stock: int
    expiring_soon: int


# ── Shipment schemas ──────────────────────────────────────────────────────────

class ShipmentItemIn(BaseModel):
    item_id: str
    item_name: str
    quantity: float
    unit_of_measure: str
    serial_numbers: List[str] = []
    weight_per_unit: Optional[float] = None


class ShipmentCreateRequest(BaseModel):
    movement_type: str = "stock_out"   # stock_out | transfer
    items: List[ShipmentItemIn]
    tracking_number: Optional[str] = None
    driver_name: str
    driver_phone: Optional[str] = None
    driver_email: Optional[str] = None
    vehicle_number: Optional[str] = None
    destination: str
    receiver_name: Optional[str] = None
    receiver_phone: Optional[str] = None
    receiver_email: Optional[str] = None
    notes: Optional[str] = None


class ShipmentSignRequest(BaseModel):
    signed_by_name: str
    signature_b64: str   # base64-encoded PNG data URL or raw base64


class ShipmentItemResponse(BaseModel):
    id: str
    item_id: str
    item_name: str
    quantity: float
    unit_of_measure: str
    serial_numbers: List[str]
    weight_per_unit: Optional[float]
    line_weight: float


class ShipmentSignatureResponse(BaseModel):
    signed_by_name: str
    signed_at: datetime
    ip_address: Optional[str]
    signature_key: str


class ShipmentResponse(BaseModel):
    id: str
    org_id: str
    reference_number: str
    movement_type: str
    items: List[ShipmentItemResponse]
    total_weight: float
    tracking_number: Optional[str]
    driver_name: str
    driver_phone: Optional[str]
    driver_email: Optional[str]
    vehicle_number: Optional[str]
    destination: str
    receiver_name: Optional[str]
    receiver_phone: Optional[str]
    receiver_email: Optional[str]
    status: str
    driver_sign_token: Optional[str]
    driver_signature: Optional[ShipmentSignatureResponse]
    receiver_sign_token: Optional[str]
    receiver_signature: Optional[ShipmentSignatureResponse]
    pdf_key: Optional[str]
    notes: Optional[str]
    created_by: str
    created_at: datetime
    updated_at: datetime
    # URL helpers (populated by service)
    driver_sign_url: Optional[str] = None
    receiver_sign_url: Optional[str] = None
    pdf_url: Optional[str] = None


class ShipmentListResponse(BaseModel):
    items: List[ShipmentResponse]
    total: int
    page: int
    page_size: int


class ShipmentPublicContext(BaseModel):
    """Public context returned to driver/receiver sign pages (no auth)."""
    reference_number: str
    movement_type: str
    tracking_number: Optional[str]
    vehicle_number: Optional[str]
    driver_name: str
    destination: str
    receiver_name: Optional[str]
    items: List[ShipmentItemResponse]
    total_weight: float
    status: str
    org_name: Optional[str] = None
    org_logo_url: Optional[str] = None
    notes: Optional[str]
