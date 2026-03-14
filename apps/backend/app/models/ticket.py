import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class AttachmentFile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    s3_key: str
    filename: str
    size_bytes: int
    mime_type: str
    uploaded_at: datetime = Field(default_factory=utc_now)


class TicketComment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author_id: str
    author_role: str
    author_name: Optional[str] = None
    body: str
    body_html: Optional[str] = None
    attachments: List[AttachmentFile] = []
    attachment_keys: List[str] = []
    created_at: datetime = Field(default_factory=utc_now)


class TicketActivity(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # type: status_change | assignment | comment | attachment | task | system
    type: str
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    actor_name: Optional[str] = None   # denormalised at write time
    description: str
    created_at: datetime = Field(default_factory=utc_now)


class TicketTask(BaseModel):
    """A unit of work attached to a ticket.

    task_type controls what fields are expected:
      meter_reading    – meter_number, previous_reading, current_reading, unit_of_measure
      inspection_item  – room, condition, notes
      checklist_item   – title, notes, completion toggle
      custom           – title, notes
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    task_type: str = "custom"  # meter_reading | inspection_item | checklist_item | custom
    status: str = "pending"   # pending | in_progress | completed | skipped

    # meter_reading fields
    meter_number: Optional[str] = None
    previous_reading: Optional[float] = None
    current_reading: Optional[float] = None
    unit_of_measure: Optional[str] = "units"

    # inspection_item fields
    room: Optional[str] = None
    condition: Optional[str] = None   # good | fair | poor | damaged

    # generic
    notes: Optional[str] = None
    body_html: Optional[str] = None
    attachments: List[AttachmentFile] = []
    attachment_keys: List[str] = []
    assigned_to: Optional[str] = None

    # billing linkage (set by billing service for meter_reading tasks)
    unit_id: Optional[str] = None
    unit_code: Optional[str] = None
    tenant_name: Optional[str] = None
    invoice_id: Optional[str] = None
    line_item_id: Optional[str] = None
    utility_key: Optional[str] = None

    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Ticket(Document):
    """Comprehensive general-purpose ticket model.

    Separate from MaintenanceTicket (meter_discrepancy disputes from inspection flow).
    """
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script
    unit_id: Optional[str] = None
    tenant_id: Optional[str] = None
    assigned_to: Optional[str] = None

    category: str          # maintenance|utility_reading|move_in_inspection|…|<custom>
    priority: str = "normal"   # low|normal|high|urgent
    status: str = "open"       # open|assigned|in_progress|pending_review|resolved|closed|cancelled

    title: str
    description: Optional[str] = None
    body_html: Optional[str] = None
    attachments: List[AttachmentFile] = []
    attachment_keys: List[str] = []
    comments: List[TicketComment] = []
    activity: List[TicketActivity] = []
    tasks: List[TicketTask] = []

    # Human-readable reference number (e.g. TKT-000001)
    reference_number: Optional[str] = None

    # Token-based public submission
    submission_token: Optional[str] = None
    submission_data: Optional[Dict[str, Any]] = None
    submitted_at: Optional[datetime] = None

    resolution_notes: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None

    # Analytics: capture session timing
    capture_started_at: Optional[datetime] = None
    capture_completed_at: Optional[datetime] = None

    created_by: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "tickets"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING), ("created_at", -1)]),
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("assigned_to", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("tenant_id", ASCENDING)]),
            IndexModel(
                [("submission_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"submission_token": {"$type": "string"}},
            ),
            IndexModel(
                [("org_id", ASCENDING), ("reference_number", ASCENDING)],
                unique=True,
                partialFilterExpression={"reference_number": {"$type": "string"}},
            ),
        ]
