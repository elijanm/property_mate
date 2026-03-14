"""Asset model — long-term physical assets tracked across properties."""
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.utils.datetime import utc_now


class AssetValuation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: date
    value: float
    method: str = "manual"  # purchase | manual | appraised | depreciated
    notes: Optional[str] = None
    recorded_by: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class AssetMaintenanceRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    date: date
    # preventive | corrective | inspection | cleaning | calibration
    maintenance_type: str
    description: str
    cost: Optional[float] = None
    performed_by: Optional[str] = None  # user_id or free-text name
    performed_by_name: Optional[str] = None
    next_due: Optional[date] = None
    attachment_keys: List[str] = []
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class AssetTransferRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    from_property_id: Optional[str] = None
    from_property_name: Optional[str] = None
    from_unit_id: Optional[str] = None
    from_location: Optional[str] = None
    to_property_id: Optional[str] = None
    to_property_name: Optional[str] = None
    to_unit_id: Optional[str] = None
    to_location: Optional[str] = None
    transferred_by: str
    transferred_by_name: Optional[str] = None
    transferred_at: datetime = Field(default_factory=utc_now)
    notes: Optional[str] = None


class AssetCheckoutRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    checked_out_to: str  # user_id or free-text
    checked_out_to_name: Optional[str] = None
    checked_out_at: datetime = Field(default_factory=utc_now)
    expected_return: Optional[date] = None
    returned_at: Optional[datetime] = None
    returned_condition: Optional[str] = None
    notes: Optional[str] = None


class AssetAuditEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # created|updated|transferred|checked_out|checked_in|maintenance_added|
    # valuation_added|disposed|written_off|status_changed
    action: str
    actor_id: str
    actor_name: Optional[str] = None
    changes: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    timestamp: datetime = Field(default_factory=utc_now)


class Asset(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    asset_id: str            # human-readable: ASSET-000001
    barcode: Optional[str] = None
    qr_code_key: Optional[str] = None  # S3 key for generated QR image

    # ── Classification ────────────────────────────────────────────────────────
    name: str
    description: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    tags: List[str] = []
    custom_fields: Dict[str, Any] = {}

    # ── Location & Assignment ─────────────────────────────────────────────────
    property_id: Optional[str] = None
    property_name: Optional[str] = None
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script
    unit_id: Optional[str] = None
    unit_code: Optional[str] = None
    location: Optional[str] = None      # free-text: "Store Room A", "Lobby"
    store_location_id: Optional[str] = None    # structured StoreLocation reference
    store_location_path: Optional[str] = None  # breadcrumb: "WH-A / Aisle 3 / Bay 2"
    department: Optional[str] = None
    assigned_to: Optional[str] = None   # user_id
    assigned_to_name: Optional[str] = None

    # ── Vendor / Manufacturer ─────────────────────────────────────────────────
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None

    # ── Purchase & Warranty ───────────────────────────────────────────────────
    purchase_date: Optional[date] = None
    purchase_cost: Optional[float] = None
    markup_percent: float = 0.0          # markup on purchase cost
    warranty_expiry: Optional[date] = None
    warranty_notes: Optional[str] = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    # new | excellent | good | fair | poor | damaged
    condition: str = "good"
    # active | in_maintenance | checked_out | retired | disposed | written_off
    lifecycle_status: str = "active"

    # ── Depreciation / Appreciation ───────────────────────────────────────────
    # straight_line | declining_balance | sum_of_years | units_of_production | none
    depreciation_method: Optional[str] = None
    useful_life_years: Optional[float] = None
    depreciation_rate: Optional[float] = None   # % per year (declining balance)
    salvage_value: Optional[float] = None
    # positive = appreciation rate % per year
    appreciation_rate: Optional[float] = None
    current_value: Optional[float] = None       # last computed/recorded value

    # ── Service Schedule ──────────────────────────────────────────────────────
    next_service_date: Optional[date] = None
    service_interval_days: Optional[int] = None

    # ── Disposal ──────────────────────────────────────────────────────────────
    disposed_at: Optional[datetime] = None
    disposal_reason: Optional[str] = None
    disposal_value: Optional[float] = None      # proceeds from sale/scrap
    written_off_at: Optional[datetime] = None
    write_off_reason: Optional[str] = None

    # ── Embedded history ──────────────────────────────────────────────────────
    valuation_history: List[AssetValuation] = []
    maintenance_history: List[AssetMaintenanceRecord] = []
    transfer_history: List[AssetTransferRecord] = []
    checkout_history: List[AssetCheckoutRecord] = []
    audit_trail: List[AssetAuditEntry] = []

    # ── Attachments & Notes ───────────────────────────────────────────────────
    attachment_keys: List[str] = []
    notes: Optional[str] = None

    # ── Meta ──────────────────────────────────────────────────────────────────
    created_by: str
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "assets"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("asset_id", ASCENDING)], unique=True),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("lifecycle_status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("lifecycle_status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("category", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("lifecycle_status", ASCENDING), ("created_at", DESCENDING)]),
            IndexModel(
                [("barcode", ASCENDING)],
                unique=True,
                partialFilterExpression={"barcode": {"$type": "string"}},
            ),
        ]
