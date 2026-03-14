"""Store / warehouse location request and response schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from app.models.store import StoreConfig


# ── Requests ──────────────────────────────────────────────────────────────────

class StoreCreateRequest(BaseModel):
    name: str
    code: Optional[str] = None   # auto-generated if omitted
    label: Optional[str] = None
    description: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: str = "units"
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    sort_order: int = 0


class StoreLocationCreateRequest(BaseModel):
    """Create a child location under a store or parent location."""
    name: str
    code: Optional[str] = None   # auto-generated if omitted
    label: Optional[str] = None
    description: Optional[str] = None
    location_type: str                  # zone | aisle | rack | bay | level | bin
    parent_id: Optional[str] = None    # parent location id; if None, parent = store root
    capacity_value: Optional[float] = None
    capacity_unit: str = "units"
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    sort_order: int = 0


class StoreLocationUpdateRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    label: Optional[str] = None
    description: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: Optional[str] = None
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None


class StoreConfigUpdateRequest(BaseModel):
    allow_segmentation: Optional[bool] = None
    allow_labelling: Optional[bool] = None
    allow_owner_assignment: Optional[bool] = None
    default_capacity_unit: Optional[str] = None


# ── Responses ─────────────────────────────────────────────────────────────────

class StoreLocationResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    name: str
    code: str
    label: Optional[str] = None
    description: Optional[str] = None
    location_type: str
    parent_id: Optional[str] = None
    store_id: Optional[str] = None
    path: str
    depth: int
    sort_order: int
    capacity_value: Optional[float] = None
    capacity_unit: str
    current_occupancy: float
    occupancy_pct: float
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    attributes: Dict[str, Any] = {}
    status: str
    created_at: datetime
    updated_at: datetime
    # Nested children (populated in tree endpoint)
    children: List['StoreLocationResponse'] = []


StoreLocationResponse.model_rebuild()


class StoreListResponse(BaseModel):
    stores: List[StoreLocationResponse]
    total: int


class StoreConfigResponse(BaseModel):
    allow_segmentation: bool
    allow_labelling: bool
    allow_owner_assignment: bool
    default_capacity_unit: str


class StoreCapacitySummary(BaseModel):
    location_id: str
    location_name: str
    path: str
    capacity_value: Optional[float]
    capacity_unit: str
    current_occupancy: float
    occupancy_pct: float
    status: str
