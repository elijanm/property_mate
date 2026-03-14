from typing import Dict, List, Optional

from pydantic import BaseModel


class PropertyRevenue(BaseModel):
    property_id: str
    property_name: str
    invoiced: float
    collected: float
    outstanding: float


class AccountingSummaryResponse(BaseModel):
    total_invoiced: float
    total_collected: float
    total_outstanding: float
    collection_rate: float  # 0.0 – 1.0
    by_property: List[PropertyRevenue] = []
    by_status: Dict[str, float] = {}


class TenantBehaviorResponse(BaseModel):
    tenant_id: str
    tenant_name: str
    avg_payment_delay_days: float
    on_time_rate: float          # 0.0 – 1.0
    outstanding_balance: float
    reliability_score: float     # 0.0 – 1.0 composite score
    total_invoices: int
    partial_payments: int


class TenantBehaviorListResponse(BaseModel):
    items: List[TenantBehaviorResponse]
    total: int
    next_cursor: Optional[str] = None
    has_more: bool = False


class VacantUnitDetailResponse(BaseModel):
    property_id: str
    property_name: str
    unit_id: str
    unit_label: str
    days_vacant: int
    estimated_rent: float | None = None
    estimated_lost_rent: float | None = None


class VacancyReportResponse(BaseModel):
    id: str
    org_id: str
    billing_month: str
    billing_cycle_run_id: str
    total_units: int
    occupied_units: int
    vacant_units: int
    vacancy_rate: float
    vacant_details: List[VacantUnitDetailResponse] = []
    estimated_lost_rent: float


class VacancyLiveResponse(BaseModel):
    """Live vacancy snapshot computed directly from unit/lease state — no billing run required."""
    total_units: int
    occupied_units: int
    vacant_units: int
    vacancy_rate: float
    estimated_lost_rent: float          # aggregate for full set (not just current page)
    items: List[VacantUnitDetailResponse] = []
    next_cursor: Optional[str] = None   # base64-encoded offset; None means no more pages
    has_more: bool = False
