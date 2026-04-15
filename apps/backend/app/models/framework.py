from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Literal, Optional

from beanie import Document, Indexed
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel


# ── Embedded sub-models ───────────────────────────────────────────────────────

class RouteStop(BaseModel):
    sequence: int
    asset_id: str
    site_name: str
    site_code: str
    physical_address: str
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    estimated_arrival: Optional[str] = None
    actual_arrival: Optional[str] = None
    status: Literal["pending", "completed", "skipped"] = "pending"
    technician_notes: Optional[str] = None
    schedule_id: Optional[str] = None


class WorkOrderPart(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    part_name: str
    part_number: Optional[str] = None
    quantity: float = 1
    unit_cost: float = 0
    total_cost: float = 0
    kva_range: Optional[str] = None


class SlaEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
    penalty_pct: float = 5.0
    description: str
    resolved: bool = False


class PreInspectionItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    part_name: str
    part_number: Optional[str] = None
    kva_range: Optional[str] = None
    quantity: float = 1
    estimated_unit_cost: float = 0
    estimated_total_cost: float = 0
    notes: Optional[str] = None


class PreInspection(BaseModel):
    inspection_date: str                # YYYY-MM-DD
    technician_name: str
    condition_notes: str
    items: List[PreInspectionItem] = Field(default_factory=list)
    estimated_total: float = 0
    status: Literal["submitted", "approved", "rejected"] = "submitted"
    approval_notes: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


# ── Framework Contract ────────────────────────────────────────────────────────

class FrameworkSite(BaseModel):
    """A named site within a region — used as dropdown source across the contract."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    site_code: str
    site_name: str
    region: str
    physical_address: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


class Schedule4Entry(BaseModel):
    """One row in Schedule 4 – Schedule of Rates (per site/region/brand/KVA)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    site_code: Optional[str] = None
    site_name: str
    region: str
    brand: Optional[str] = None          # Engine make / generator brand
    kva_rating: Optional[str] = None     # e.g. "22-35" or free text
    # Cost A: 2 full PM services/year (labour + consumables + transport + accom, excl. spare parts)
    cost_a: float = 0
    # Cost B: 2 technical inspections/year (labour + accom + transport, excl. spare parts)
    cost_b: float = 0
    # Cost C: Annual unlimited attendance (labour + accom + transport, excl. spare parts)
    cost_c: float = 0
    # Cost D is computed: A + B + C
    notes: Optional[str] = None


class FrameworkContract(Document):
    org_id: Indexed(str)
    name: str
    client_name: str
    contract_number: str
    contract_start: str           # ISO date string YYYY-MM-DD
    contract_end: str             # ISO date string YYYY-MM-DD
    region: str
    description: Optional[str] = None
    status: Literal["active", "draft", "expired", "suspended"] = "draft"
    color: Optional[str] = "#D97706"

    # Structured regions + sites (used as dropdowns across assets/schedules/WOs)
    regions: List[str] = Field(default_factory=list)
    sites: List[FrameworkSite] = Field(default_factory=list)

    # Schedule 4 – Schedule of Rates (per-site/region/brand/KVA pricing)
    schedule4_entries: List[Schedule4Entry] = Field(default_factory=list)

    # Computed/cached counters (updated by service on mutation)
    total_assets: int = 0
    active_work_orders: int = 0
    overdue_schedules: int = 0
    sla_score: Optional[float] = None

    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "framework_contracts"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel(
                [("org_id", ASCENDING), ("contract_number", ASCENDING)],
                unique=True,
                partialFilterExpression={"deleted_at": None},
            ),
        ]


# ── Framework Asset ───────────────────────────────────────────────────────────

class FrameworkAsset(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)

    # Identity
    asset_tag: str
    site_name: str
    site_code: str

    # Technical specs
    kva_rating: str                    # "22-35" | "40-55" | "60-75" | "80-110" | "120-200" | "250-330"
    engine_make: str
    engine_model: Optional[str] = None
    serial_number: Optional[str] = None
    manufacture_year: Optional[int] = None
    fuel_type: Literal["diesel", "petrol", "gas", "hybrid"] = "diesel"

    # Location
    region: str
    physical_address: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    site_contact_name: Optional[str] = None
    site_contact_phone: Optional[str] = None

    # Operational
    operational_status: Literal[
        "operational", "under_maintenance", "fault", "standby", "decommissioned"
    ] = "operational"
    installation_date: Optional[str] = None
    warranty_expiry: Optional[str] = None

    # Service
    service_frequency: Literal["monthly", "quarterly", "biannual", "annual"] = "biannual"
    last_service_date: Optional[str] = None
    next_service_date: Optional[str] = None
    last_service_type: Optional[str] = None
    total_runtime_hours: Optional[float] = None

    notes: Optional[str] = None
    image_key: Optional[str] = None

    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "framework_assets"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("operational_status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("region", ASCENDING)]),
            IndexModel(
                [("org_id", ASCENDING), ("framework_id", ASCENDING), ("site_code", ASCENDING)],
                unique=True,
                partialFilterExpression={"deleted_at": None},
            ),
        ]


# ── Maintenance Schedule ──────────────────────────────────────────────────────

class MaintenanceSchedule(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)
    asset_id: str
    asset_site_name: str
    asset_region: str

    service_type: Literal[
        "biannual_a", "biannual_b", "quarterly", "corrective", "emergency"
    ]
    scheduled_date: str              # YYYY-MM-DD
    status: Literal[
        "pending", "scheduled", "in_progress", "completed", "overdue", "cancelled"
    ] = "pending"

    work_order_id: Optional[str] = None
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    estimated_duration_hours: Optional[float] = None
    notes: Optional[str] = None

    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "maintenance_schedules"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("scheduled_date", ASCENDING)]),
        ]


# ── Work Order ────────────────────────────────────────────────────────────────

class WorkOrder(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)
    work_order_number: str

    title: str
    service_type: Literal[
        "biannual_a", "biannual_b", "quarterly", "corrective", "emergency"
    ]
    status: Literal[
        "draft", "assigned", "en_route", "pre_inspection", "pending_approval",
        "in_progress", "completed", "signed_off", "cancelled"
    ] = "draft"

    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    technician_names: List[str] = Field(default_factory=list)

    route_stops: List[RouteStop] = Field(default_factory=list)
    planned_date: str
    start_date: Optional[str] = None
    completion_date: Optional[str] = None

    total_assets: int = 0
    parts_used: List[WorkOrderPart] = Field(default_factory=list)
    labor_hours: Optional[float] = None
    transport_cost: Optional[float] = None
    accommodation_cost: Optional[float] = None
    total_cost: Optional[float] = None

    pre_inspection: Optional[PreInspection] = None

    client_signature_url: Optional[str] = None
    technician_signature_url: Optional[str] = None
    report_notes: Optional[str] = None

    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "work_orders"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel(
                [("org_id", ASCENDING), ("work_order_number", ASCENDING)],
                unique=True,
                partialFilterExpression={"deleted_at": None},
            ),
        ]


# ── SLA Record ────────────────────────────────────────────────────────────────

class SlaRecord(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)
    asset_id: str
    site_name: str
    period_quarter: str             # e.g. "2026-Q1"

    response_time_hours: Optional[float] = None
    resolution_time_hours: Optional[float] = None
    sla_level: Literal[
        "exceptional", "very_good", "marginal", "unsatisfactory", "defective"
    ] = "exceptional"

    events: List[SlaEvent] = Field(default_factory=list)
    penalty_percentage: float = 0.0
    penalty_amount: Optional[float] = None
    notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "sla_records"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("period_quarter", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("asset_id", ASCENDING)]),
        ]


# ── Spare Parts Kit ───────────────────────────────────────────────────────────

class SparePartsKitItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    part_number: Optional[str] = None
    part_name: str
    quantity: float = 1
    unit: str = "unit"
    unit_price: Optional[float] = None
    notes: Optional[str] = None


class SparePartsKit(Document):
    """Engine/model-specific spare parts list (e.g. Genset V440c2 Standard Kit)."""
    org_id: Indexed(str)
    framework_id: Indexed(str)
    kit_name: str
    validity_type: Literal["standard", "emergency", "seasonal", "annual"] = "standard"
    engine_make: Optional[str] = None
    engine_model: Optional[str] = None
    kva_min: Optional[float] = None
    kva_max: Optional[float] = None
    applicable_service_types: List[str] = Field(default_factory=list)
    site_code: Optional[str] = None
    items: List[SparePartsKitItem] = Field(default_factory=list)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "spare_parts_kits"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("engine_make", ASCENDING)]),
        ]


# ── Rate Schedule ─────────────────────────────────────────────────────────────

class LabourRateEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str
    rate_per_day: float = 0
    rate_per_hour: Optional[float] = None
    notes: Optional[str] = None


class AccommodationRateEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    region: str
    rate_per_day: float = 0
    notes: Optional[str] = None


class PersonnelTransportRate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    region: str
    transport_mode: Literal["road", "air"] = "road"
    rate_per_km: Optional[float] = None
    fixed_rate: Optional[float] = None
    notes: Optional[str] = None


class GeneratorTransportRate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    region: str
    description: str = "Emergency Generator Transport"
    rate_per_km: Optional[float] = None
    fixed_rate: Optional[float] = None
    notes: Optional[str] = None


class SiteRateOverride(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    site_code: str
    site_name: str
    multiplier: Optional[float] = None
    notes: Optional[str] = None


class RateSchedule(Document):
    """Full schedule of rates per pricing tier (A/B/C) for a framework contract."""
    org_id: Indexed(str)
    framework_id: Indexed(str)
    pricing_tier: Literal["A", "B", "C"] = "A"
    effective_date: str
    expiry_date: Optional[str] = None
    is_active: bool = True
    labour_rates: List[LabourRateEntry] = Field(default_factory=list)
    accommodation_rates: List[AccommodationRateEntry] = Field(default_factory=list)
    personnel_transport_rates: List[PersonnelTransportRate] = Field(default_factory=list)
    generator_transport_rates: List[GeneratorTransportRate] = Field(default_factory=list)
    site_overrides: List[SiteRateOverride] = Field(default_factory=list)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "rate_schedules"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("pricing_tier", ASCENDING)]),
        ]


# ── Parts Catalog (org-level, shared across all framework contracts) ──────────

class PartsCatalogItem(Document):
    """Org-wide master catalog of spare parts — referenced in pricing matrices and kits."""
    org_id: Indexed(str)
    part_name: str
    part_number: Optional[str] = None
    category: Optional[str] = None
    unit: str = "unit"
    unit_cost: Optional[float] = None   # default/reference cost per unit (KES)
    notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "parts_catalog"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("part_name", ASCENDING)]),
        ]


# ── Spare Parts Pricing ───────────────────────────────────────────────────────

class SparePartsPricing(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)
    part_name: str
    part_number: Optional[str] = None
    category: str
    unit: str = "unit"
    # KVA range → unit price
    kva_pricing: dict = Field(default_factory=dict)   # {"22-35": 1500, "40-55": 1800, ...}
    notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "spare_parts_pricing"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
        ]


# ── Invited Vendor ────────────────────────────────────────────────────────────

class FrameworkInvitedVendor(Document):
    """Vendor/service-provider invited to a framework contract."""
    org_id: Indexed(str)
    framework_id: Indexed(str)
    name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    mobile: Optional[str] = None            # updated by vendor on portal
    specialization: Optional[str] = None
    regions: Optional[str] = None           # comma-separated coverage regions
    site_codes: List[str] = Field(default_factory=list)   # sites they cover (from framework sites)

    # Portal auth
    portal_token: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None           # linked User after activation

    # KYC / onboarding
    status: str = "invited"                  # invited | pending_review | active | suspended
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    selfie_key: Optional[str] = None        # S3 key for selfie photo
    id_front_key: Optional[str] = None      # S3 key for ID front photo
    id_back_key: Optional[str] = None       # S3 key for ID back photo
    badge_key: Optional[str] = None         # S3 key for generated contractor badge PDF

    invited_at: datetime = Field(default_factory=datetime.utcnow)
    reinvited_at: Optional[datetime] = None
    activated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "framework_invited_vendors"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("portal_token", ASCENDING)], unique=True, sparse=True),
            IndexModel([("user_id", ASCENDING)], sparse=True),
        ]


# ── Transport Cost ────────────────────────────────────────────────────────────

class TransportCostEntry(Document):
    org_id: Indexed(str)
    framework_id: Indexed(str)
    region: str
    description: str
    road_rate_per_km: Optional[float] = None
    air_rate: Optional[float] = None
    fixed_allowance: Optional[float] = None
    notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "transport_costs"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("framework_id", ASCENDING), ("deleted_at", ASCENDING)]),
        ]
