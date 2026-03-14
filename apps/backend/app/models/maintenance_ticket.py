import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class MaintenanceTicket(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    unit_id: str
    lease_id: str
    inspection_report_id: str
    # ticket_type: meter_discrepancy (expandable in future)
    ticket_type: str = "meter_discrepancy"
    title: str
    description: str
    utility_key: str
    utility_label: str
    system_reading: Optional[float] = None   # latest reading the system had
    reported_reading: float                  # reading submitted by tenant
    # status: open | resolved
    status: str = "open"
    assigned_to: Optional[str] = None        # user_id (agent or owner)
    resolution_reading: Optional[float] = None   # adopted as official move-in meter value
    resolution_notes: Optional[str] = None
    evidence_keys: List[str] = []            # S3 keys for resolution photos
    resolved_by: Optional[str] = None        # user_id
    resolved_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "maintenance_tickets"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("lease_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("inspection_report_id", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("assigned_to", ASCENDING), ("status", ASCENDING)]),
        ]
