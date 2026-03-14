"""Inventory model — consumable stock items tracked by location/property."""
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.utils.datetime import utc_now


class StockSerial(BaseModel):
    """A single serialized unit (e.g., one laptop with unique S/N)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    serial_number: str
    # in_stock | dispatched | returned | damaged | depleted | merged | split
    status: str = "in_stock"
    location_key: Optional[str] = None
    movement_ref: Optional[str] = None
    added_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # Weight at stock-in
    gross_weight_kg: Optional[float] = None     # weighed with tare container
    tare_weight_kg: Optional[float] = None      # weight of empty container
    net_weight_kg: Optional[float] = None       # gross - tare (or direct entry)

    # Partial depletion — starts == net_weight_kg; decremented on partial stock_out
    quantity_remaining: Optional[float] = None

    # At dispatch
    dispatch_gross_kg: Optional[float] = None
    dispatch_net_kg: Optional[float] = None

    # Fraud detection
    weight_variance_kg: Optional[float] = None
    weight_variance_pct: Optional[float] = None
    weight_flagged: bool = False
    weight_flag_reason: Optional[str] = None

    # Store location reference
    store_location_id: Optional[str] = None    # StoreLocation._id (str of ObjectId)
    store_location_path: Optional[str] = None  # breadcrumb: "WH-A / Aisle 3 / Bay 2"

    # Parentage (child-serial dispatch / merge / split)
    parent_serial_id: Optional[str] = None
    child_serial_ids: List[str] = []

    # Per-serial pricing recorded at stock-in
    purchase_cost: Optional[float] = None   # actual cost for this specific unit
    selling_price: Optional[float] = None  # intended selling price for this unit
    margin_pct: Optional[float] = None     # auto-computed: (selling - purchase) / purchase * 100

    # Variant this serial belongs to (references InventoryVariant.id)
    variant_id: Optional[str] = None


class StockBatch(BaseModel):
    """A discrete lot/batch of a stock item (for batch/expiry tracking)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    batch_number: str
    lot_number: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    purchase_date: Optional[date] = None
    expiry_date: Optional[date] = None
    purchase_cost: float = 0.0          # cost per unit for this batch
    quantity_received: float = 0.0
    quantity_remaining: float = 0.0
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class StockLevel(BaseModel):
    """Per-location stock quantity for an inventory item."""
    location_key: str                   # e.g., "property:{id}" or "unit:{id}" or free-text
    location_label: str
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    quantity: float = 0.0
    reserved_quantity: float = 0.0      # committed to work orders / issues
    available_quantity: float = 0.0     # quantity - reserved_quantity


class StockMovement(BaseModel):
    """An individual stock movement record embedded in InventoryItem."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # stock_in | stock_out | adjustment | transfer_in | transfer_out
    # reserve | issue | return | damaged | lost | expired | write_off
    movement_type: str
    quantity: float
    unit_of_measure: str
    reference_no: Optional[str] = None  # PO number, work order id, etc.
    batch_id: Optional[str] = None
    from_location_key: Optional[str] = None
    from_location_label: Optional[str] = None
    to_location_key: Optional[str] = None
    to_location_label: Optional[str] = None
    store_location_id: Optional[str] = None    # structured store location (stock_in: destination, stock_out: source)
    store_location_path: Optional[str] = None  # human-readable path e.g. "WH-A / Aisle 3 / Bay 2"
    unit_cost: Optional[float] = None   # cost per unit at time of movement
    total_cost: Optional[float] = None
    performed_by: Optional[str] = None  # user_id
    performed_by_name: Optional[str] = None
    notes: Optional[str] = None
    serial_numbers: List[str] = []
    shipment_id: Optional[str] = None
    serial_count: int = 0                              # number of serials in this movement
    serial_weights: Dict[str, float] = {}              # {serial_number: net_qty_dispatched}
    serial_quantities_taken: Dict[str, float] = {}     # {serial_number: qty_taken}
    weight_variance_events: List[Dict[str, Any]] = []  # [{serial, variance_kg, variance_pct, flagged, ts}]
    # Movement-level weight (non-serialized items with weight_tracking_enabled)
    movement_net_qty: Optional[float] = None            # recorded qty/weight at stock-in
    movement_dispatch_qty: Optional[float] = None       # measured qty at dispatch
    movement_variance_pct: Optional[float] = None       # abs variance %
    movement_weight_flagged: bool = False
    created_at: datetime = Field(default_factory=utc_now)


class InventoryAuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # created | updated | stocked | issued | adjusted | transferred | disposed | alert_triggered
    action: str
    actor_id: str
    actor_name: Optional[str] = None
    changes: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    timestamp: datetime = Field(default_factory=utc_now)


class InventoryVariant(BaseModel):
    """A product variant (e.g. Red - Size M vs Blue - Size L)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str                            # e.g. "Red - Size M"
    sku: Optional[str] = None
    image_key: Optional[str] = None      # S3 key
    purchase_cost: Optional[float] = None
    selling_price: Optional[float] = None
    attributes: Dict[str, str] = {}      # e.g. {"Color": "Red", "Size": "M"}
    status: str = "active"               # active | discontinued
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class InventoryItem(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    item_id: str                        # human-readable: INV-000001
    barcode: Optional[str] = None
    qr_code_key: Optional[str] = None  # S3 key

    # ── Classification ────────────────────────────────────────────────────────
    name: str
    description: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    tags: List[str] = []
    custom_fields: Dict[str, Any] = {}

    # ── Hazard & Safety ───────────────────────────────────────────────────────
    # harmful | poisonous | flammable | explosive | corrosive | fragile | perishable | controlled
    hazard_classes: List[str] = []
    safety_notes: Optional[str] = None
    requires_controlled_handling: bool = False

    # ── Unit of Measure ───────────────────────────────────────────────────────
    unit_of_measure: str = "unit"       # unit | kg | litre | box | roll | pair | set
    units_per_package: float = 1.0

    # ── Supplier / Manufacturer ───────────────────────────────────────────────
    sku: Optional[str] = None
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    manufacturer_part_number: Optional[str] = None

    # ── Cost & Pricing ────────────────────────────────────────────────────────
    purchase_cost: Optional[float] = None   # default unit cost
    markup_percent: float = 0.0
    selling_price: Optional[float] = None   # cost * (1 + markup%)

    # ── Stock Thresholds ──────────────────────────────────────────────────────
    min_stock_level: float = 0.0
    max_stock_level: Optional[float] = None
    reorder_point: float = 0.0
    reorder_quantity: float = 0.0

    # ── Storage ───────────────────────────────────────────────────────────────
    storage_location: Optional[str] = None   # default storage location free-text (legacy)
    store_location_id: Optional[str] = None  # structured StoreLocation reference (item default)
    store_location_path: Optional[str] = None  # breadcrumb: "WH-A / Aisle 3 / Bay 2"
    property_id: Optional[str] = None        # primary property this item is managed under
    property_name: Optional[str] = None
    entity_type: str = "property"            # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None         # mirrors property_id; backfilled by migration script

    # ── Serialized tracking ───────────────────────────────────────────────────
    is_serialized: bool = False
    serials: List[StockSerial] = []

    # ── Weight / Volume / Length tracking (independent of serialization) ──────
    weight_tracking_enabled: bool = False       # track qty per movement (bulk) or per serial
    weight_per_unit: Optional[float] = None     # expected qty per unit — used for bulk variance
    tare_tracking_enabled: bool = False         # sub-option: gross+tare vs direct net entry
    weight_variance_soft_pct: float = 2.0       # % → soft-flag + audit entry
    weight_variance_hard_pct: float = 5.0       # % → hard-block (400) unless force_override

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    # active | discontinued | out_of_stock | on_order
    status: str = "active"
    batch_tracking_enabled: bool = False
    expiry_tracking_enabled: bool = False

    # ── Aggregated Stock ──────────────────────────────────────────────────────
    total_quantity: float = 0.0         # sum of weights when weight_tracking, else unit count
    total_reserved: float = 0.0
    total_available: float = 0.0        # total_quantity - total_reserved
    total_serial_count: int = 0         # count of in-stock serials (when is_serialized)

    # ── Embedded Data ─────────────────────────────────────────────────────────
    stock_levels: List[StockLevel] = []
    batches: List[StockBatch] = []
    movements: List[StockMovement] = []
    audit_trail: List[InventoryAuditEntry] = []

    # ── Variants ──────────────────────────────────────────────────────────────
    variants: List[InventoryVariant] = []

    # ── Attachments ───────────────────────────────────────────────────────────
    attachment_keys: List[str] = []
    image_key: Optional[str] = None     # primary product image
    notes: Optional[str] = None

    # ── Meta ──────────────────────────────────────────────────────────────────
    created_by: str
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "inventory_items"
        indexes = [
            IndexModel([(("org_id", ASCENDING)), ("item_id", ASCENDING)], unique=True),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("category", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel(
                [("barcode", ASCENDING)],
                unique=True,
                partialFilterExpression={"barcode": {"$type": "string"}},
            ),
            IndexModel(
                [("sku", ASCENDING)],
                sparse=True,
            ),
        ]
