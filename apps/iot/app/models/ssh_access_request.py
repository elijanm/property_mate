from typing import Optional
from datetime import datetime
from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import ASCENDING, IndexModel
from app.utils.datetime import utc_now


class SSHAccessRequest(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str

    # What is being accessed
    target_type: str                    # device | gateway
    target_id: str                      # Device._id or EdgeGateway._id as string
    target_tailscale_ip: str            # resolved at request time
    target_name: str                    # denormalised for display
    target_port: int = 22

    # Who is requesting
    requester_user_id: str
    requester_email: Optional[str] = None  # denormalised for display
    requester_tailscale_node_id: Optional[str] = None
    requester_tailscale_ip: Optional[str] = None

    # Justification (mandatory)
    reason: str
    requested_duration_m: int = 60

    # Headscale ACL handle — identifies the rule inserted into the policy file
    headscale_acl_comment: Optional[str] = None  # unique comment used to find/remove the rule

    # Lifecycle
    # pending → approved/denied → (approved) active → expired/revoked
    status: str = "pending"
    approved_by_user_id: Optional[str] = None
    denied_by_user_id: Optional[str] = None
    revoked_by_user_id: Optional[str] = None

    approved_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None   # set when approved

    denial_reason: Optional[str] = None

    approval_ticket_id: Optional[str] = None   # PMS ticket ID linked to this request
    approval_token: Optional[str] = None       # public token for approve/deny links (uuid)

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_ssh_requests"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING), ("created_at", ASCENDING)]),
            IndexModel([("requester_user_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("target_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel(
                [("expires_at", ASCENDING)],
                partialFilterExpression={"status": "active"},
            ),
        ]
