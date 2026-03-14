"""Dashboard response schemas."""
from typing import Optional

from pydantic import BaseModel


class OccupancyKpi(BaseModel):
    total_units: int
    occupied: int
    vacant: int
    occupancy_rate: float  # 0-100


class FinancialKpi(BaseModel):
    outstanding_balance: float
    this_month_invoiced: float
    this_month_collected: float
    collection_rate_30d: Optional[float] = None  # 0-100; None if no invoices


class AlertCounts(BaseModel):
    open_tickets: int
    pending_meter_readings: int
    leases_expiring_30d: int
    overdue_invoices: int


class RecentPayment(BaseModel):
    id: str
    tenant_name: str
    amount: float
    method: str
    payment_date: str  # ISO date string


class RecentTicket(BaseModel):
    id: str
    title: str
    category: str
    status: str
    property_id: str
    created_at: str  # ISO datetime string


class CollectionTrendEntry(BaseModel):
    month: str  # YYYY-MM
    invoiced: float
    collected: float
    rate: Optional[float] = None  # 0-100; None if no invoices


class DashboardData(BaseModel):
    occupancy: OccupancyKpi
    financial: FinancialKpi
    alerts: AlertCounts
    recent_payments: list[RecentPayment]
    recent_tickets: list[RecentTicket]
    collection_trend: list[CollectionTrendEntry]
