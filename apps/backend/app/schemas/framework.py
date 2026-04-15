from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel


# ── Framework Contract schemas ────────────────────────────────────────────────

class FrameworkContractCreateRequest(BaseModel):
    name: str
    client_name: str
    contract_number: str
    contract_start: str
    contract_end: str
    region: str
    description: Optional[str] = None
    color: Optional[str] = "#D97706"


class FrameworkContractUpdateRequest(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    region: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None


class FrameworkSitePayload(BaseModel):
    site_code: str
    site_name: str
    region: str
    physical_address: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


class FrameworkRegionsSitesRequest(BaseModel):
    regions: List[str]
    sites: List[FrameworkSitePayload]


class FrameworkSiteResponse(BaseModel):
    id: str
    site_code: str
    site_name: str
    region: str
    physical_address: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None


class Schedule4EntryPayload(BaseModel):
    site_code: Optional[str] = None
    site_name: str
    region: str
    brand: Optional[str] = None
    kva_rating: Optional[str] = None
    cost_a: float = 0
    cost_b: float = 0
    cost_c: float = 0
    notes: Optional[str] = None


class Schedule4EntryResponse(Schedule4EntryPayload):
    id: str
    cost_d: float = 0   # computed = cost_a + cost_b + cost_c


class Schedule4UpdateRequest(BaseModel):
    entries: List[Schedule4EntryPayload]


class FrameworkContractResponse(BaseModel):
    id: str
    org_id: str
    name: str
    client_name: str
    contract_number: str
    contract_start: str
    contract_end: str
    region: str
    description: Optional[str] = None
    status: str
    color: Optional[str] = None
    regions: List[str] = []
    sites: List[FrameworkSiteResponse] = []
    schedule4_entries: List[Schedule4EntryResponse] = []
    total_assets: int
    active_work_orders: int
    overdue_schedules: int
    sla_score: Optional[float] = None
    created_at: str
    updated_at: str


# ── Framework Asset schemas ───────────────────────────────────────────────────

class FrameworkAssetCreateRequest(BaseModel):
    site_name: str
    site_code: str
    kva_rating: str
    engine_make: str
    engine_model: Optional[str] = None
    serial_number: Optional[str] = None
    manufacture_year: Optional[int] = None
    fuel_type: str = "diesel"
    region: str
    physical_address: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    site_contact_name: Optional[str] = None
    site_contact_phone: Optional[str] = None
    operational_status: Optional[str] = "operational"
    installation_date: Optional[str] = None
    warranty_expiry: Optional[str] = None
    service_frequency: str = "biannual"
    last_service_date: Optional[str] = None
    next_service_date: Optional[str] = None
    notes: Optional[str] = None


class FrameworkAssetUpdateRequest(BaseModel):
    site_name: Optional[str] = None
    operational_status: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    site_contact_name: Optional[str] = None
    site_contact_phone: Optional[str] = None
    next_service_date: Optional[str] = None
    last_service_date: Optional[str] = None
    last_service_type: Optional[str] = None
    total_runtime_hours: Optional[float] = None
    notes: Optional[str] = None


class FrameworkAssetResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    asset_tag: str
    site_name: str
    site_code: str
    kva_rating: str
    engine_make: str
    engine_model: str
    serial_number: str
    manufacture_year: Optional[int] = None
    fuel_type: str
    region: str
    physical_address: str
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    site_contact_name: Optional[str] = None
    site_contact_phone: Optional[str] = None
    operational_status: str
    installation_date: Optional[str] = None
    warranty_expiry: Optional[str] = None
    service_frequency: str
    last_service_date: Optional[str] = None
    next_service_date: Optional[str] = None
    last_service_type: Optional[str] = None
    total_runtime_hours: Optional[float] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str


class FrameworkAssetListResponse(BaseModel):
    items: List[FrameworkAssetResponse]
    total: int
    page: int
    page_size: int


# ── Maintenance Schedule schemas ──────────────────────────────────────────────

class MaintenanceScheduleCreateRequest(BaseModel):
    asset_id: str
    asset_site_name: str
    asset_region: str
    service_type: str
    scheduled_date: str
    status: str = "pending"
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    estimated_duration_hours: Optional[float] = None
    notes: Optional[str] = None


class MaintenanceScheduleResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    asset_id: str
    asset_site_name: str
    asset_region: str
    service_type: str
    scheduled_date: str
    status: str
    work_order_id: Optional[str] = None
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    estimated_duration_hours: Optional[float] = None
    notes: Optional[str] = None
    created_at: str


# ── Work Order schemas ────────────────────────────────────────────────────────

class RouteStopPayload(BaseModel):
    sequence: int
    asset_id: str
    site_name: str
    site_code: str
    physical_address: str
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    status: str = "pending"
    schedule_id: Optional[str] = None


class WorkOrderPartPayload(BaseModel):
    part_name: str
    part_number: Optional[str] = None
    quantity: float = 1
    unit_cost: float = 0
    total_cost: float = 0
    kva_range: Optional[str] = None


class WorkOrderCreateRequest(BaseModel):
    title: str
    service_type: str
    planned_date: str
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    technician_names: Optional[List[str]] = None
    route_stops: Optional[List[RouteStopPayload]] = None
    total_assets: Optional[int] = None
    report_notes: Optional[str] = None


class GenerateRouteRequest(BaseModel):
    asset_ids: List[str]
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None


class WorkOrderUpdateRequest(BaseModel):
    status: Optional[str] = None
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    technician_names: Optional[List[str]] = None
    route_stops: Optional[List[RouteStopPayload]] = None
    parts_used: Optional[List[WorkOrderPartPayload]] = None
    labor_hours: Optional[float] = None
    transport_cost: Optional[float] = None
    accommodation_cost: Optional[float] = None
    total_cost: Optional[float] = None
    report_notes: Optional[str] = None
    start_date: Optional[str] = None
    completion_date: Optional[str] = None


class WorkOrderResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    work_order_number: str
    title: str
    service_type: str
    status: str
    assigned_vendor_id: Optional[str] = None
    assigned_vendor_name: Optional[str] = None
    technician_names: List[str]
    route_stops: list
    planned_date: str
    start_date: Optional[str] = None
    completion_date: Optional[str] = None
    total_assets: int
    parts_used: list
    labor_hours: Optional[float] = None
    transport_cost: Optional[float] = None
    accommodation_cost: Optional[float] = None
    total_cost: Optional[float] = None
    pre_inspection: Optional[dict] = None
    client_signature_url: Optional[str] = None
    technician_signature_url: Optional[str] = None
    report_notes: Optional[str] = None
    created_at: str
    updated_at: str


class WorkOrderListResponse(BaseModel):
    items: List[WorkOrderResponse]
    total: int
    page: int
    page_size: int


# ── Pre-Inspection schemas ────────────────────────────────────────────────────

class PreInspectionItemPayload(BaseModel):
    part_name: str
    part_number: Optional[str] = None
    kva_range: Optional[str] = None
    quantity: float = 1
    estimated_unit_cost: float = 0
    notes: Optional[str] = None


class PreInspectionSubmitRequest(BaseModel):
    inspection_date: str
    technician_name: str
    condition_notes: str
    items: List[PreInspectionItemPayload] = []


class PreInspectionApproveRequest(BaseModel):
    approved: bool
    approval_notes: Optional[str] = None


# ── SLA schemas ───────────────────────────────────────────────────────────────

class SlaEventPayload(BaseModel):
    event_type: str
    penalty_pct: float = 5.0
    description: str


class SlaRecordCreateRequest(BaseModel):
    asset_id: str
    site_name: str
    period_quarter: str
    response_time_hours: Optional[float] = None
    resolution_time_hours: Optional[float] = None
    sla_level: str = "exceptional"
    events: Optional[List[SlaEventPayload]] = None
    penalty_percentage: float = 0.0
    penalty_amount: Optional[float] = None
    notes: Optional[str] = None


class SlaRecordResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    asset_id: str
    site_name: str
    period_quarter: str
    response_time_hours: Optional[float] = None
    resolution_time_hours: Optional[float] = None
    sla_level: str
    events: list
    penalty_percentage: float
    penalty_amount: Optional[float] = None
    notes: Optional[str] = None
    created_at: str


# ── Spare Parts Kit schemas ───────────────────────────────────────────────────

class SparePartsKitItemPayload(BaseModel):
    part_number: Optional[str] = None
    part_name: str
    quantity: float = 1
    unit: str = "unit"
    unit_price: Optional[float] = None
    notes: Optional[str] = None


class SparePartsKitCreateRequest(BaseModel):
    kit_name: str
    validity_type: str = "standard"
    engine_make: Optional[str] = None
    engine_model: Optional[str] = None
    kva_min: Optional[float] = None
    kva_max: Optional[float] = None
    applicable_service_types: List[str] = []
    site_code: Optional[str] = None
    items: List[SparePartsKitItemPayload] = []
    notes: Optional[str] = None


class SparePartsKitUpdateRequest(BaseModel):
    kit_name: Optional[str] = None
    validity_type: Optional[str] = None
    engine_make: Optional[str] = None
    engine_model: Optional[str] = None
    kva_min: Optional[float] = None
    kva_max: Optional[float] = None
    applicable_service_types: Optional[List[str]] = None
    site_code: Optional[str] = None
    items: Optional[List[SparePartsKitItemPayload]] = None
    notes: Optional[str] = None


class SparePartsKitItemResponse(BaseModel):
    id: str
    part_number: Optional[str] = None
    part_name: str
    quantity: float
    unit: str
    unit_price: Optional[float] = None
    notes: Optional[str] = None


class SparePartsKitResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    kit_name: str
    validity_type: str
    engine_make: Optional[str] = None
    engine_model: Optional[str] = None
    kva_min: Optional[float] = None
    kva_max: Optional[float] = None
    applicable_service_types: List[str]
    site_code: Optional[str] = None
    items: List[SparePartsKitItemResponse]
    notes: Optional[str] = None
    created_at: str
    updated_at: str


# ── Rate Schedule schemas ─────────────────────────────────────────────────────

class LabourRatePayload(BaseModel):
    role: str
    rate_per_day: float = 0
    rate_per_hour: Optional[float] = None
    notes: Optional[str] = None


class AccommodationRatePayload(BaseModel):
    region: str
    rate_per_day: float = 0
    notes: Optional[str] = None


class PersonnelTransportRatePayload(BaseModel):
    region: str
    transport_mode: str = "road"
    rate_per_km: Optional[float] = None
    fixed_rate: Optional[float] = None
    notes: Optional[str] = None


class GeneratorTransportRatePayload(BaseModel):
    region: str
    description: str = "Emergency Generator Transport"
    rate_per_km: Optional[float] = None
    fixed_rate: Optional[float] = None
    notes: Optional[str] = None


class SiteRateOverridePayload(BaseModel):
    site_code: str
    site_name: str
    multiplier: Optional[float] = None
    notes: Optional[str] = None


class RateScheduleUpsertRequest(BaseModel):
    pricing_tier: str = "A"
    effective_date: str
    expiry_date: Optional[str] = None
    is_active: bool = True
    labour_rates: List[LabourRatePayload] = []
    accommodation_rates: List[AccommodationRatePayload] = []
    personnel_transport_rates: List[PersonnelTransportRatePayload] = []
    generator_transport_rates: List[GeneratorTransportRatePayload] = []
    site_overrides: List[SiteRateOverridePayload] = []
    notes: Optional[str] = None


class RateScheduleResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    pricing_tier: str
    effective_date: str
    expiry_date: Optional[str] = None
    is_active: bool
    labour_rates: List[dict]
    accommodation_rates: List[dict]
    personnel_transport_rates: List[dict]
    generator_transport_rates: List[dict]
    site_overrides: List[dict]
    notes: Optional[str] = None
    created_at: str
    updated_at: str


# ── Spare Parts schemas ───────────────────────────────────────────────────────

class SparePartsPricingRequest(BaseModel):
    part_name: str
    part_number: Optional[str] = None
    category: str
    unit: str = "unit"
    kva_pricing: Dict[str, float] = {}
    notes: Optional[str] = None


class SparePartsPricingResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    part_name: str
    part_number: Optional[str] = None
    category: str
    unit: str
    kva_pricing: Dict[str, float]
    notes: Optional[str] = None


# ── Transport Cost schemas ────────────────────────────────────────────────────

class TransportCostRequest(BaseModel):
    region: str
    description: str
    road_rate_per_km: Optional[float] = None
    air_rate: Optional[float] = None
    fixed_allowance: Optional[float] = None
    notes: Optional[str] = None


class TransportCostResponse(BaseModel):
    id: str
    org_id: str
    framework_id: str
    region: str
    description: str
    road_rate_per_km: Optional[float] = None
    air_rate: Optional[float] = None
    fixed_allowance: Optional[float] = None
    notes: Optional[str] = None


# ── Stats schema ──────────────────────────────────────────────────────────────

class FrameworkStatsResponse(BaseModel):
    total_assets: int
    operational: int
    under_maintenance: int
    fault: int
    standby: int
    decommissioned: int
    overdue_schedules: int
    open_work_orders: int
    completed_this_month: int
    avg_sla_score: float
    total_penalties_qtd: float
