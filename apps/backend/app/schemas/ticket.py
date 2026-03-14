"""Ticket schemas — covers both MaintenanceTicket (legacy) and new comprehensive Ticket."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Legacy MaintenanceTicket schemas (meter discrepancy) ──────────────────────

class TicketResolveRequest(BaseModel):
    resolution_reading: float = Field(gt=0, description="The official move-in meter reading adopted")
    resolution_notes: Optional[str] = None


class TicketResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    unit_id: str
    lease_id: str
    inspection_report_id: str
    ticket_type: str
    title: str
    description: str
    utility_key: str
    utility_label: str
    system_reading: Optional[float]
    reported_reading: float
    status: str
    assigned_to: Optional[str]
    resolution_reading: Optional[float]
    resolution_notes: Optional[str]
    evidence_urls: List[str] = []
    resolved_by: Optional[str]
    resolved_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


# ── New comprehensive Ticket schemas ──────────────────────────────────────────

class GeneralTicketCreateRequest(BaseModel):
    property_id: str
    unit_id: Optional[str] = None
    category: str
    priority: str = "normal"
    title: str
    description: Optional[str] = None
    tenant_id: Optional[str] = None
    org_id: Optional[str] = None


class GeneralTicketUpdateRequest(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    resolution_notes: Optional[str] = None


class TicketCommentRequest(BaseModel):
    body: str


class BulkUtilityTicketRequest(BaseModel):
    property_id: str
    unit_ids: List[str]
    title: str
    description: Optional[str] = None


class SubmissionDataRequest(BaseModel):
    data: Dict[str, Any]


# ── Task schemas ──────────────────────────────────────────────────────────────

class TicketTaskCreateRequest(BaseModel):
    title: str
    task_type: str = "custom"   # meter_reading | inspection_item | checklist_item | custom
    meter_number: Optional[str] = None
    previous_reading: Optional[float] = None
    unit_of_measure: Optional[str] = "units"
    room: Optional[str] = None
    notes: Optional[str] = None
    assigned_to: Optional[str] = None


class TicketTaskUpdateRequest(BaseModel):
    status: Optional[str] = None          # pending|in_progress|completed|skipped
    title: Optional[str] = None
    meter_number: Optional[str] = None
    previous_reading: Optional[float] = None
    current_reading: Optional[float] = None
    unit_of_measure: Optional[str] = None
    room: Optional[str] = None
    condition: Optional[str] = None       # good|fair|poor|damaged
    notes: Optional[str] = None
    assigned_to: Optional[str] = None


class TicketTaskResponse(BaseModel):
    id: str
    title: str
    task_type: str
    status: str
    meter_number: Optional[str] = None
    previous_reading: Optional[float] = None
    current_reading: Optional[float] = None
    unit_of_measure: Optional[str] = None
    room: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None
    attachment_urls: List[str] = []
    assigned_to: Optional[str] = None
    # billing linkage fields (present on meter_reading tasks)
    unit_id: Optional[str] = None
    unit_code: Optional[str] = None
    tenant_name: Optional[str] = None
    invoice_id: Optional[str] = None
    line_item_id: Optional[str] = None
    utility_key: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class TaskPublicUpdateRequest(BaseModel):
    current_reading: float
    notes: Optional[str] = None
    captured_by: Optional[str] = None  # user_id passed via query param
    photo_key: Optional[str] = None    # S3 key from prior photo upload
    meter_number: Optional[str] = None # meter identifier (sets on unit if not already set)


class MeterReadResponse(BaseModel):
    reading: Optional[float] = None
    confidence: float = 0.0
    raw_text: Optional[str] = None
    error: Optional[str] = None


# ── Enriched response schemas ─────────────────────────────────────────────────

class TicketCommentResponse(BaseModel):
    id: str
    author_id: str
    author_role: str
    author_name: Optional[str] = None
    body: str
    attachment_urls: List[str] = []
    created_at: datetime


class TicketActivityResponse(BaseModel):
    id: str
    type: str
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    actor_name: Optional[str] = None
    description: str
    created_at: datetime


class OrgMemberResponse(BaseModel):
    """Lightweight user record for assignment dropdowns."""
    id: str
    first_name: str
    last_name: str
    email: str
    role: str

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class GeneralTicketResponse(BaseModel):
    id: str
    reference_number: Optional[str] = None
    org_id: str
    property_id: str
    property_name: Optional[str] = None   # resolved
    unit_id: Optional[str] = None
    unit_label: Optional[str] = None      # resolved (unit_code / unit_number)
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None     # resolved
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None  # resolved
    creator_id: Optional[str] = None  # resolved
    creator_name: Optional[str] = None    # resolved
    creator_role: Optional[str] = None
    category: str
    priority: str
    status: str
    title: str
    description: Optional[str] = None
    attachment_urls: List[str] = []
    comments: List[TicketCommentResponse] = []
    activity: List[TicketActivityResponse] = []
    tasks: List[TicketTaskResponse] = []
    submission_token: Optional[str] = None
    submission_data: Optional[Dict[str, Any]] = None
    submitted_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    capture_started_at: Optional[datetime] = None
    capture_completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class GeneralTicketListResponse(BaseModel):
    items: List[GeneralTicketResponse]
    total: int
    page: int
    page_size: int


class TicketCountsResponse(BaseModel):
    open: int = 0
    assigned: int = 0
    in_progress: int = 0
    pending_review: int = 0
    resolved: int = 0
    closed: int = 0
    cancelled: int = 0
    total: int = 0
