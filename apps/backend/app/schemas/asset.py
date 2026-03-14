"""Asset request/response schemas."""
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Embedded sub-models ──────────────────────────────────────────────────────

class AssetValuationResponse(BaseModel):
    id: str
    date: date
    value: float
    method: str
    notes: Optional[str]
    recorded_by: Optional[str]
    created_at: datetime


class AssetMaintenanceRecordResponse(BaseModel):
    id: str
    date: date
    maintenance_type: str
    description: str
    cost: Optional[float]
    performed_by: Optional[str]
    performed_by_name: Optional[str]
    next_due: Optional[date]
    attachment_keys: List[str]
    notes: Optional[str]
    created_at: datetime


class AssetTransferRecordResponse(BaseModel):
    id: str
    from_property_id: Optional[str]
    from_property_name: Optional[str]
    from_unit_id: Optional[str]
    from_location: Optional[str]
    to_property_id: Optional[str]
    to_property_name: Optional[str]
    to_unit_id: Optional[str]
    to_location: Optional[str]
    transferred_by: str
    transferred_by_name: Optional[str]
    transferred_at: datetime
    notes: Optional[str]


class AssetCheckoutRecordResponse(BaseModel):
    id: str
    checked_out_to: str
    checked_out_to_name: Optional[str]
    checked_out_at: datetime
    expected_return: Optional[date]
    returned_at: Optional[datetime]
    returned_condition: Optional[str]
    notes: Optional[str]


class AssetAuditEntryResponse(BaseModel):
    id: str
    action: str
    actor_id: str
    actor_name: Optional[str]
    changes: Optional[Dict[str, Any]]
    description: Optional[str]
    timestamp: datetime


# ── Asset CRUD ────────────────────────────────────────────────────────────────

class AssetCreateRequest(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = []
    custom_fields: Dict[str, Any] = {}

    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    location: Optional[str] = None
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None
    department: Optional[str] = None
    assigned_to: Optional[str] = None

    barcode: Optional[str] = None
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None

    purchase_date: Optional[date] = None
    purchase_cost: Optional[float] = None
    markup_percent: float = 0.0
    warranty_expiry: Optional[date] = None
    warranty_notes: Optional[str] = None

    condition: str = "good"
    lifecycle_status: str = "active"

    depreciation_method: Optional[str] = None
    useful_life_years: Optional[float] = None
    depreciation_rate: Optional[float] = None
    salvage_value: Optional[float] = None
    appreciation_rate: Optional[float] = None
    current_value: Optional[float] = None

    next_service_date: Optional[date] = None
    service_interval_days: Optional[int] = None

    notes: Optional[str] = None


class AssetUpdateRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None

    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    location: Optional[str] = None
    store_location_id: Optional[str] = None
    store_location_path: Optional[str] = None
    department: Optional[str] = None
    assigned_to: Optional[str] = None

    barcode: Optional[str] = None
    vendor_name: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None

    purchase_date: Optional[date] = None
    purchase_cost: Optional[float] = None
    markup_percent: Optional[float] = None
    warranty_expiry: Optional[date] = None
    warranty_notes: Optional[str] = None

    condition: Optional[str] = None
    lifecycle_status: Optional[str] = None

    depreciation_method: Optional[str] = None
    useful_life_years: Optional[float] = None
    depreciation_rate: Optional[float] = None
    salvage_value: Optional[float] = None
    appreciation_rate: Optional[float] = None
    current_value: Optional[float] = None

    next_service_date: Optional[date] = None
    service_interval_days: Optional[int] = None

    notes: Optional[str] = None


class AssetTransferRequest(BaseModel):
    to_property_id: Optional[str] = None
    to_property_name: Optional[str] = None
    to_unit_id: Optional[str] = None
    to_location: Optional[str] = None
    notes: Optional[str] = None


class AssetCheckoutRequest(BaseModel):
    checked_out_to: str
    checked_out_to_name: Optional[str] = None
    expected_return: Optional[date] = None
    notes: Optional[str] = None


class AssetCheckinRequest(BaseModel):
    returned_condition: Optional[str] = None
    notes: Optional[str] = None


class AssetMaintenanceRequest(BaseModel):
    date: date
    maintenance_type: str
    description: str
    cost: Optional[float] = None
    performed_by: Optional[str] = None
    performed_by_name: Optional[str] = None
    next_due: Optional[date] = None
    notes: Optional[str] = None


class AssetValuationRequest(BaseModel):
    date: date
    value: float
    method: str = "manual"
    notes: Optional[str] = None


class AssetDisposeRequest(BaseModel):
    disposal_reason: str
    disposal_value: Optional[float] = None
    notes: Optional[str] = None


class AssetWriteOffRequest(BaseModel):
    write_off_reason: str
    notes: Optional[str] = None


# ── Response schemas ──────────────────────────────────────────────────────────

class AssetResponse(BaseModel):
    id: str
    org_id: str
    asset_id: str
    barcode: Optional[str]
    qr_code_key: Optional[str]

    name: str
    description: Optional[str]
    category: str
    subcategory: Optional[str]
    tags: List[str]
    custom_fields: Dict[str, Any]

    property_id: Optional[str]
    property_name: Optional[str]
    unit_id: Optional[str]
    unit_code: Optional[str]
    location: Optional[str]
    store_location_id: Optional[str]
    store_location_path: Optional[str]
    department: Optional[str]
    assigned_to: Optional[str]
    assigned_to_name: Optional[str]

    vendor_name: Optional[str]
    manufacturer: Optional[str]
    model: Optional[str]
    serial_number: Optional[str]

    purchase_date: Optional[date]
    purchase_cost: Optional[float]
    markup_percent: float
    warranty_expiry: Optional[date]
    warranty_notes: Optional[str]

    condition: str
    lifecycle_status: str

    depreciation_method: Optional[str]
    useful_life_years: Optional[float]
    depreciation_rate: Optional[float]
    salvage_value: Optional[float]
    appreciation_rate: Optional[float]
    current_value: Optional[float]

    next_service_date: Optional[date]
    service_interval_days: Optional[int]

    disposed_at: Optional[datetime]
    disposal_reason: Optional[str]
    disposal_value: Optional[float]
    written_off_at: Optional[datetime]
    write_off_reason: Optional[str]

    valuation_history: List[AssetValuationResponse]
    maintenance_history: List[AssetMaintenanceRecordResponse]
    transfer_history: List[AssetTransferRecordResponse]
    checkout_history: List[AssetCheckoutRecordResponse]
    audit_trail: List[AssetAuditEntryResponse]

    attachment_keys: List[str]
    notes: Optional[str]

    created_by: str
    created_at: datetime
    updated_at: datetime


class AssetListResponse(BaseModel):
    items: List[AssetResponse]
    total: int
    page: int
    page_size: int


class AssetCountsResponse(BaseModel):
    total: int
    active: int
    in_maintenance: int
    checked_out: int
    retired: int
    disposed: int
    written_off: int
