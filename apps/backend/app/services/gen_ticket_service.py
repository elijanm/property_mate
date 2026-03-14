"""Comprehensive general-purpose ticket service."""
import asyncio
import secrets
from typing import List, Optional

import structlog

from app.core.email import _base, send_email
from app.core.exceptions import ForbiddenError, ResourceNotFoundError, ValidationError
from app.core.s3 import generate_presigned_url, s3_path, upload_file
from app.dependencies.auth import CurrentUser
from app.models.ticket import AttachmentFile, Ticket, TicketActivity, TicketComment, TicketTask
from app.models.user import User
from app.repositories.property_repository import property_repository
from app.repositories.ticket_repository import ticket_repository
from app.repositories.unit_repository import unit_repository
from app.repositories.user_repository import user_repository
from app.schemas.ticket import (
    BulkUtilityTicketRequest,
    GeneralTicketCreateRequest,
    GeneralTicketListResponse,
    GeneralTicketResponse,
    GeneralTicketUpdateRequest,
    OrgMemberResponse,
    SubmissionDataRequest,
    TicketActivityResponse,
    TicketCommentRequest,
    TicketCommentResponse,
    TicketCountsResponse,
    TicketTaskCreateRequest,
    TicketTaskResponse,
    TicketTaskUpdateRequest,
)
from app.services.ws_notification_service import publish_notification
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_ALLOWED_TRANSITIONS: dict = {
    "open": ["assigned", "in_progress", "cancelled"],
    "assigned": ["in_progress", "open", "cancelled"],
    "in_progress": ["pending_review", "resolved", "cancelled"],
    "pending_review": ["resolved", "in_progress"],
    "resolved": ["closed", "in_progress"],
    "closed": [],
    "cancelled": [],
}
_TERMINAL_STATUSES = {"closed", "cancelled"}


# ── Name helpers ──────────────────────────────────────────────────────────────

def _user_name(u: Optional[User]) -> Optional[str]:
    if not u:
        return None
    return f"{u.first_name} {u.last_name}".strip() or str(u.email)


async def _resolve_names(ticket: Ticket) -> dict:
    """Fetch property, unit, creator, assignee, tenant names in parallel."""
    async def _prop():
        try:
            p = await property_repository.get_by_id(ticket.property_id, ticket.org_id)
            return p.name if p else None
        except Exception:
            return None

    async def _unit():
        if not ticket.unit_id:
            return None
        try:
            u = await unit_repository.get_by_id(ticket.unit_id, ticket.org_id)
            return u.unit_code if u else ticket.unit_id
        except Exception:
            return None

    async def _creator():
        try:
            u = await user_repository.get_by_id(ticket.created_by)
            return u
        except Exception:
            return None

    async def _assignee():
        if not ticket.assigned_to:
            return None
        try:
            u = await user_repository.get_by_id(ticket.assigned_to)
            return u
        except Exception:
            return None

    async def _tenant():
        if not ticket.tenant_id:
            return None
        try:
            u = await user_repository.get_by_id(ticket.tenant_id)
            return u
        except Exception:
            return None

    prop_name, unit_label, creator, assignee, tenant = await asyncio.gather(
        _prop(), _unit(), _creator(), _assignee(), _tenant()
    )
    return {
        "property_name": prop_name,
        "unit_label": unit_label,
        "creator": creator,
        "assignee": assignee,
        "tenant": tenant,
    }


async def _presign_keys(keys: List[str]) -> List[str]:
    if not keys:
        return []
    urls = await asyncio.gather(*[generate_presigned_url(k) for k in keys])
    return list(urls)


async def _comment_to_response(c: TicketComment) -> TicketCommentResponse:
    return TicketCommentResponse(
        id=c.id,
        author_id=c.author_id,
        author_role=c.author_role,
        author_name=c.author_name,
        body=c.body,
        attachment_urls=await _presign_keys(c.attachment_keys),
        created_at=c.created_at,
    )


async def _task_to_response(t: TicketTask) -> TicketTaskResponse:
    return TicketTaskResponse(
        id=t.id,
        title=t.title,
        task_type=t.task_type,
        status=t.status,
        meter_number=t.meter_number,
        previous_reading=t.previous_reading,
        current_reading=t.current_reading,
        unit_of_measure=t.unit_of_measure,
        room=t.room,
        condition=t.condition,
        notes=t.notes,
        attachment_urls=await _presign_keys(t.attachment_keys),
        assigned_to=t.assigned_to,
        unit_id=t.unit_id,
        unit_code=t.unit_code,
        tenant_name=t.tenant_name,
        invoice_id=t.invoice_id,
        line_item_id=t.line_item_id,
        utility_key=t.utility_key,
        completed_at=t.completed_at,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


async def _to_response(ticket: Ticket) -> GeneralTicketResponse:
    names = await _resolve_names(ticket)
    creator: Optional[User] = names["creator"]

    comments = await asyncio.gather(*[_comment_to_response(c) for c in ticket.comments])
    tasks = await asyncio.gather(*[_task_to_response(t) for t in ticket.tasks])

    activity = [
        TicketActivityResponse(
            id=a.id,
            type=a.type,
            actor_id=a.actor_id,
            actor_role=a.actor_role,
            actor_name=a.actor_name,
            description=a.description,
            created_at=a.created_at,
        )
        for a in ticket.activity
    ]

    return GeneralTicketResponse(
        id=str(ticket.id),
        reference_number=ticket.reference_number,
        org_id=ticket.org_id,
        property_id=ticket.property_id,
        property_name=names["property_name"],
        unit_id=ticket.unit_id,
        unit_label=names["unit_label"],
        tenant_id=ticket.tenant_id,
        tenant_name=_user_name(names["tenant"]),
        assigned_to=ticket.assigned_to,
        assigned_to_name=_user_name(names["assignee"]),
        creator_id=ticket.created_by,
        creator_name=_user_name(creator),
        creator_role=creator.role if creator else None,
        category=ticket.category,
        priority=ticket.priority,
        status=ticket.status,
        title=ticket.title,
        description=ticket.description,
        attachment_urls=await _presign_keys(ticket.attachment_keys),
        comments=list(comments),
        activity=activity,
        tasks=list(tasks),
        submission_token=ticket.submission_token,
        submission_data=ticket.submission_data,
        submitted_at=ticket.submitted_at,
        resolution_notes=ticket.resolution_notes,
        resolved_at=ticket.resolved_at,
        closed_at=ticket.closed_at,
        capture_started_at=ticket.capture_started_at,
        capture_completed_at=ticket.capture_completed_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


async def _publish_ticket_updated(ticket: Ticket, message: str = "Ticket updated") -> None:
    """Publish a ticket_updated WS notification (best-effort, non-blocking)."""
    try:
        await publish_notification(
            org_id=ticket.org_id,
            event_type="ticket_updated",
            title=ticket.title,
            message=message,
            data={"ticket_id": str(ticket.id), "status": ticket.status},
        )
    except Exception:
        pass


async def _actor_name(current_user: CurrentUser) -> Optional[str]:
    """Fetch the current user's display name for activity records."""
    try:
        u = await user_repository.get_by_id(current_user.user_id)
        return _user_name(u)
    except Exception:
        return None


def _make_activity(
    type_: str,
    description: str,
    current_user: Optional[CurrentUser] = None,
    actor_name: Optional[str] = None,
) -> TicketActivity:
    return TicketActivity(
        type=type_,
        actor_id=current_user.user_id if current_user else None,
        actor_role=current_user.role if current_user else None,
        actor_name=actor_name,
        description=description,
    )


# ── Public service functions ──────────────────────────────────────────────────

async def create_ticket(
    request: GeneralTicketCreateRequest,
    current_user: CurrentUser,
) -> GeneralTicketResponse:
    if current_user.role == "tenant" and not request.tenant_id:
        request = request.model_copy(update={"tenant_id": current_user.user_id})

    name = await _actor_name(current_user)
    # utility_reading tickets always get a public submission token so field capture links work
    token = secrets.token_urlsafe(32) if request.category == "utility_reading" else None
    # For superadmin service tokens (org_id=None), fall back to the org_id in the request body
    effective_org_id = current_user.org_id or request.org_id
    ref = await ticket_repository.next_reference_number(effective_org_id)
    ticket = Ticket(
        org_id=effective_org_id,
        property_id=request.property_id,
        unit_id=request.unit_id,
        tenant_id=request.tenant_id,
        category=request.category,
        priority=request.priority,
        title=request.title,
        description=request.description,
        reference_number=ref,
        submission_token=token,
        created_by=current_user.user_id,
        activity=[_make_activity("system", "Ticket opened", current_user, name)],
    )
    await ticket_repository.create(ticket)
    logger.info("ticket_created", action="create_ticket", resource_type="ticket",
                resource_id=str(ticket.id), org_id=effective_org_id,
                user_id=current_user.user_id, status="success")
    return await _to_response(ticket)


async def create_bulk_utility_tickets(
    request: BulkUtilityTicketRequest,
    current_user: CurrentUser,
) -> List[GeneralTicketResponse]:
    name = await _actor_name(current_user)
    tickets = []
    for unit_id in request.unit_ids:
        token = secrets.token_urlsafe(32)
        ref = await ticket_repository.next_reference_number(current_user.org_id)
        ticket = Ticket(
            org_id=current_user.org_id,
            property_id=request.property_id,
            unit_id=unit_id,
            category="utility_reading",
            priority="normal",
            title=request.title,
            description=request.description,
            reference_number=ref,
            submission_token=token,
            created_by=current_user.user_id,
            activity=[_make_activity("system", "Utility reading task created", current_user, name)],
        )
        await ticket_repository.create(ticket)
        tickets.append(ticket)
    logger.info("bulk_utility_tickets_created", action="create_bulk_utility_tickets",
                resource_type="ticket", org_id=current_user.org_id,
                user_id=current_user.user_id, count=len(tickets), status="success")
    return [await _to_response(t) for t in tickets]


async def get_ticket(ticket_id: str, current_user: CurrentUser) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=True)
    return await _to_response(ticket)


async def list_tickets(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    unit_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> GeneralTicketListResponse:
    filter_assigned_to: Optional[str] = None
    filter_tenant_id: Optional[str] = tenant_id

    if current_user.role == "service_provider":
        filter_assigned_to = current_user.user_id
    elif current_user.role == "tenant":
        filter_tenant_id = current_user.user_id

    items, total = await ticket_repository.list(
        org_id=current_user.org_id,
        property_id=property_id,
        entity_type=entity_type,
        entity_id=entity_id,
        unit_id=unit_id,
        tenant_id=filter_tenant_id,
        assigned_to=filter_assigned_to,
        category=category,
        status=status,
        priority=priority,
        page=page,
        page_size=page_size,
    )
    return GeneralTicketListResponse(
        items=[await _to_response(t) for t in items],
        total=total,
        page=page,
        page_size=page_size,
    )


async def get_counts(
    current_user: CurrentUser,
    property_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> TicketCountsResponse:
    counts = await ticket_repository.count_by_status(
        current_user.org_id, property_id, entity_type=entity_type, entity_id=entity_id
    )
    return TicketCountsResponse(
        open=counts.get("open", 0),
        assigned=counts.get("assigned", 0),
        in_progress=counts.get("in_progress", 0),
        pending_review=counts.get("pending_review", 0),
        resolved=counts.get("resolved", 0),
        closed=counts.get("closed", 0),
        cancelled=counts.get("cancelled", 0),
        total=sum(counts.values()),
    )


async def update_ticket(
    ticket_id: str,
    request: GeneralTicketUpdateRequest,
    current_user: CurrentUser,
) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=False)

    name = await _actor_name(current_user)
    fields: dict = {}
    new_activities: list = list(ticket.activity)

    if request.status is not None and request.status != ticket.status:
        allowed = _ALLOWED_TRANSITIONS.get(ticket.status, [])
        if request.status not in allowed:
            raise ValidationError(f"Cannot transition from '{ticket.status}' to '{request.status}'")
        if current_user.role == "tenant":
            raise ForbiddenError("Tenants cannot change ticket status")
        fields["status"] = request.status
        if request.status == "resolved":
            fields["resolved_at"] = utc_now()
        elif request.status == "closed":
            fields["closed_at"] = utc_now()
        new_activities.append(_make_activity(
            "status_change",
            f"Status changed from '{ticket.status}' to '{request.status}'",
            current_user, name,
        ))

    if request.assigned_to is not None and request.assigned_to != ticket.assigned_to:
        if current_user.role not in ("owner", "agent", "superadmin"):
            raise ForbiddenError("Only owner/agent can reassign tickets")
        fields["assigned_to"] = request.assigned_to
        if request.assigned_to and "status" not in fields and ticket.status == "open":
            fields["status"] = "assigned"
        # Resolve assignee name for activity description
        assignee_name = "unassigned"
        if request.assigned_to:
            assignee = await user_repository.get_by_id(request.assigned_to)
            assignee_name = _user_name(assignee) or request.assigned_to
        new_activities.append(_make_activity(
            "assignment",
            f"Assigned to {assignee_name}",
            current_user, name,
        ))
        if request.assigned_to:
            # Ensure utility_reading tickets have a submission token for the capture link
            if ticket.category == "utility_reading" and not ticket.submission_token:
                fields["submission_token"] = secrets.token_urlsafe(32)
            # Build a view of the ticket with the new token (if just generated) so the email link is correct
            notify_token = fields.get("submission_token") or ticket.submission_token
            notify_ticket = ticket.model_copy(update={"submission_token": notify_token}) if notify_token != ticket.submission_token else ticket
            await _notify_assignment(notify_ticket, request.assigned_to, assignee_name)

    if request.priority is not None:
        fields["priority"] = request.priority
    if request.title is not None:
        fields["title"] = request.title
    if request.description is not None:
        fields["description"] = request.description
    if request.resolution_notes is not None:
        fields["resolution_notes"] = request.resolution_notes

    fields["activity"] = new_activities
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    logger.info("ticket_updated", action="update_ticket", resource_type="ticket",
                resource_id=ticket_id, org_id=current_user.org_id,
                user_id=current_user.user_id, status="success")
    await _publish_ticket_updated(updated, f"Ticket status: {updated.status}")
    return await _to_response(updated)


async def add_comment(
    ticket_id: str,
    request: TicketCommentRequest,
    current_user: CurrentUser,
    file_keys: Optional[List[str]] = None,
) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=True)

    name = await _actor_name(current_user)
    comment = TicketComment(
        author_id=current_user.user_id,
        author_role=current_user.role,
        author_name=name,
        body=request.body,
        attachment_keys=file_keys or [],
    )
    new_activity = _make_activity(
        "comment",
        f"Comment added by {name or current_user.role}",
        current_user, name,
    )
    fields = {
        "comments": ticket.comments + [comment],
        "activity": ticket.activity + [new_activity],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if ticket.assigned_to and ticket.assigned_to != current_user.user_id:
        await _notify_comment(ticket, name or current_user.role)
    return await _to_response(updated)


async def upload_attachment(
    ticket_id: str,
    file_bytes: bytes,
    content_type: str,
    filename: str,
    current_user: CurrentUser,
) -> str:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=True)

    name = await _actor_name(current_user)
    key = s3_path(current_user.org_id, "tickets", ticket_id, filename)
    await upload_file(key, file_bytes, content_type)
    fields = {
        "attachment_keys": ticket.attachment_keys + [key],
        "activity": ticket.activity + [
            _make_activity("attachment", f"Attachment '{filename}' added", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    return await generate_presigned_url(key)


async def upload_ticket_attachment_rich(
    ticket_id: str,
    file_bytes: bytes,
    content_type: str,
    filename: str,
    current_user: CurrentUser,
) -> dict:
    """Upload a file attachment, store structured AttachmentFile metadata, return metadata + presigned URL."""
    import uuid as _uuid
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=True)

    name = await _actor_name(current_user)
    attachment_uuid = str(_uuid.uuid4())
    key = s3_path(current_user.org_id, "tickets", ticket_id, f"attachments/{attachment_uuid}_{filename}")
    await upload_file(key, file_bytes, content_type)

    attachment = AttachmentFile(
        id=attachment_uuid,
        s3_key=key,
        filename=filename,
        size_bytes=len(file_bytes),
        mime_type=content_type,
    )
    fields = {
        "attachments": ticket.attachments + [attachment],
        "attachment_keys": ticket.attachment_keys + [key],
        "activity": ticket.activity + [
            _make_activity("attachment", f"Attachment '{filename}' uploaded", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    url = await generate_presigned_url(key)
    return {
        "id": attachment.id,
        "s3_key": attachment.s3_key,
        "filename": attachment.filename,
        "size_bytes": attachment.size_bytes,
        "mime_type": attachment.mime_type,
        "uploaded_at": attachment.uploaded_at.isoformat(),
        "url": url,
    }


async def delete_ticket_attachment(
    ticket_id: str,
    attachment_id: str,
    current_user: CurrentUser,
) -> None:
    """Remove an attachment from a ticket (soft-removes from attachments list; does not delete from S3)."""
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=False)
    if current_user.role == "tenant":
        raise ForbiddenError("Tenants cannot remove ticket attachments")

    attachment = next((a for a in ticket.attachments if a.id == attachment_id), None)
    if not attachment:
        raise ResourceNotFoundError("AttachmentFile", attachment_id)

    name = await _actor_name(current_user)
    remaining_attachments = [a for a in ticket.attachments if a.id != attachment_id]
    remaining_keys = [k for k in ticket.attachment_keys if k != attachment.s3_key]
    fields = {
        "attachments": remaining_attachments,
        "attachment_keys": remaining_keys,
        "activity": ticket.activity + [
            _make_activity("attachment", f"Attachment '{attachment.filename}' removed", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    logger.info(
        "ticket_attachment_deleted",
        action="delete_ticket_attachment",
        resource_type="ticket",
        resource_id=ticket_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )


# ── Task CRUD ─────────────────────────────────────────────────────────────────

async def add_task(
    ticket_id: str,
    request: TicketTaskCreateRequest,
    current_user: CurrentUser,
) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=False)

    task = TicketTask(
        title=request.title,
        task_type=request.task_type,
        meter_number=request.meter_number,
        previous_reading=request.previous_reading,
        unit_of_measure=request.unit_of_measure or "units",
        room=request.room,
        notes=request.notes,
        assigned_to=request.assigned_to,
    )
    name = await _actor_name(current_user)
    fields = {
        "tasks": ticket.tasks + [task],
        "activity": ticket.activity + [
            _make_activity("task", f"Task added: '{task.title}'", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    return await _to_response(updated)


async def update_task(
    ticket_id: str,
    task_id: str,
    request: TicketTaskUpdateRequest,
    current_user: CurrentUser,
) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    _check_access(ticket, current_user, read_only=False)

    task = next((t for t in ticket.tasks if t.id == task_id), None)
    if not task:
        raise ResourceNotFoundError("TicketTask", task_id)

    if request.status is not None:
        task.status = request.status
        if request.status == "completed" and not task.completed_at:
            task.completed_at = utc_now()
    if request.title is not None:
        task.title = request.title
    if request.meter_number is not None:
        task.meter_number = request.meter_number
    if request.previous_reading is not None:
        task.previous_reading = request.previous_reading
    if request.current_reading is not None:
        task.current_reading = request.current_reading
    if request.unit_of_measure is not None:
        task.unit_of_measure = request.unit_of_measure
    if request.room is not None:
        task.room = request.room
    if request.condition is not None:
        task.condition = request.condition
    if request.notes is not None:
        task.notes = request.notes
    if request.assigned_to is not None:
        task.assigned_to = request.assigned_to
    task.updated_at = utc_now()

    name = await _actor_name(current_user)
    updated_tasks = [t if t.id != task_id else task for t in ticket.tasks]
    fields = {
        "tasks": updated_tasks,
        "activity": ticket.activity + [
            _make_activity("task", f"Task updated: '{task.title}'", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    return await _to_response(updated)


async def delete_task(
    ticket_id: str,
    task_id: str,
    current_user: CurrentUser,
) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    if current_user.role not in ("owner", "agent", "superadmin"):
        raise ForbiddenError("Only owner/agent can remove tasks")

    task = next((t for t in ticket.tasks if t.id == task_id), None)
    if not task:
        raise ResourceNotFoundError("TicketTask", task_id)

    name = await _actor_name(current_user)
    fields = {
        "tasks": [t for t in ticket.tasks if t.id != task_id],
        "activity": ticket.activity + [
            _make_activity("task", f"Task removed: '{task.title}'", current_user, name)
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    return await _to_response(updated)


# ── Org members (for assignment dropdown) ─────────────────────────────────────

async def list_org_members(
    current_user: CurrentUser,
    roles: Optional[List[str]] = None,
) -> List[OrgMemberResponse]:
    """Return org users suitable for ticket assignment."""
    all_users = await user_repository.list_by_org(current_user.org_id)
    allowed = set(roles) if roles else {"owner", "agent", "service_provider"}
    return [
        OrgMemberResponse(
            id=str(u.id),
            first_name=u.first_name,
            last_name=u.last_name,
            email=str(u.email),
            role=u.role,
        )
        for u in all_users
        if u.role in allowed
    ]


# ── Public ────────────────────────────────────────────────────────────────────

async def get_public_ticket(token: str) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    return await _to_response(ticket)


async def submit_public(token: str, request: SubmissionDataRequest) -> GeneralTicketResponse:
    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    if ticket.status in _TERMINAL_STATUSES:
        raise ValidationError("This task has already been completed or cancelled")
    if ticket.submitted_at:
        raise ValidationError("This task has already been submitted")

    fields = {
        "submission_data": request.data,
        "submitted_at": utc_now(),
        "status": "pending_review",
        "activity": ticket.activity + [
            TicketActivity(type="system", description="Public submission received")
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_token(token)
    return await _to_response(updated)


async def start_capture_public(token: str) -> GeneralTicketResponse:
    """Mark a public ticket as in_progress (capture session started)."""
    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    if ticket.status in _TERMINAL_STATUSES:
        raise ValidationError("This ticket is already closed")
    if ticket.status not in ("open", "assigned"):
        return await _to_response(ticket)  # already in progress — idempotent

    fields = {
        "status": "in_progress",
        "capture_started_at": utc_now(),
        "activity": ticket.activity + [
            TicketActivity(type="system", description="Capture session started")
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_token(token)
    await _publish_ticket_updated(updated, "Capture session started")
    return await _to_response(updated)


async def update_task_public(
    token: str,
    task_id: str,
    current_reading: float,
    notes: Optional[str],
    photo_key: Optional[str],
    captured_by: Optional[str],
    meter_number: Optional[str] = None,
) -> GeneralTicketResponse:
    """Update a meter_reading task with current reading, mark completed, apply to invoice."""
    from app.services.billing_service import apply_meter_reading_to_invoice

    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    if ticket.status in _TERMINAL_STATUSES:
        raise ValidationError("This ticket is already closed")

    task = next((t for t in ticket.tasks if t.id == task_id), None)
    if not task:
        raise ResourceNotFoundError("TicketTask", task_id)

    # Validate reading is not lower than previous
    prev = task.previous_reading
    if prev is not None and current_reading < prev:
        raise ValidationError(
            f"Current reading ({current_reading}) cannot be lower than previous reading ({prev})"
        )
    if current_reading < 0:
        raise ValidationError("Current reading cannot be negative")

    # Update meter_number on task (and on unit if not set yet)
    if meter_number:
        task.meter_number = meter_number
    effective_meter_number = task.meter_number

    task.current_reading = current_reading
    task.status = "completed"
    task.completed_at = utc_now()
    task.updated_at = utc_now()
    if notes:
        task.notes = notes
    if photo_key:
        task.attachment_keys = task.attachment_keys + [photo_key]

    description = f"Reading captured: {current_reading}"
    if captured_by:
        description += f" (by user {captured_by})"

    updated_tasks = [t if t.id != task_id else task for t in ticket.tasks]
    fields = {
        "tasks": updated_tasks,
        "activity": ticket.activity + [
            TicketActivity(type="task", description=description)
        ],
    }
    await ticket_repository.update(ticket, fields)

    # Update unit meter reading cache and meter_number (best-effort)
    if task.unit_id and task.utility_key:
        try:
            now = utc_now()
            reader_name = captured_by or "system"
            await unit_repository.cache_meter_reading(
                unit_id=task.unit_id,
                org_id=ticket.org_id,
                utility_key=task.utility_key,
                value=current_reading,
                read_at=now,
                read_by=captured_by or "public",
                read_by_name=reader_name,
            )
            # Set meter_number on unit if it doesn't have one yet
            if effective_meter_number:
                unit = await unit_repository.get_by_id(task.unit_id, ticket.org_id)
                if unit and not unit.meter_number:
                    await unit_repository.update(unit, {"meter_number": effective_meter_number})
        except Exception:
            pass

    # Apply reading to the linked invoice line item (best-effort)
    if task.invoice_id and task.line_item_id:
        try:
            await apply_meter_reading_to_invoice(
                invoice_id=task.invoice_id,
                line_item_id=task.line_item_id,
                current_reading=current_reading,
                previous_reading=task.previous_reading,
                meter_image_key=photo_key,
                org_id=ticket.org_id,
            )
        except Exception as _exc:
            import structlog as _sl
            _sl.get_logger(__name__).warning(
                "apply_meter_reading_failed",
                action="update_task_public",
                resource_type="invoice",
                resource_id=task.invoice_id,
                line_item_id=task.line_item_id,
                org_id=ticket.org_id,
                status="error",
                error=str(_exc),
            )

    updated = await ticket_repository.get_by_token(token)
    completed_count = sum(1 for t in updated.tasks if t.status == "completed")
    total_count = len(updated.tasks)
    await _publish_ticket_updated(updated, f"Reading captured ({completed_count}/{total_count} units done)")
    return await _to_response(updated)


async def upload_task_photo_public(
    token: str,
    task_id: str,
    file_bytes: bytes,
    content_type: str,
    filename: str,
) -> tuple:
    """Upload a meter photo for a public task. Returns (s3_key, presigned_url)."""
    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    key = s3_path(ticket.org_id, "meter_photos", str(ticket.id), f"{task_id}_{filename}")
    await upload_file(key, file_bytes, content_type)
    url = await generate_presigned_url(key)
    return key, url


async def read_meter_ai(
    token: str,
    task_id: str,
    file_bytes: bytes,
    content_type: str,
) -> "MeterReadResponse":
    """Use AI vision to extract meter reading from an image."""
    from app.schemas.ticket import MeterReadResponse
    import base64

    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)

    try:
        from app.core.config import settings as _settings
        import httpx

        b64 = base64.b64encode(file_bytes).decode()
        payload = {
            "model": _settings.openai_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{content_type};base64,{b64}"},
                        },
                        {
                            "type": "text",
                            "text": (
                                "This is a utility meter photo. "
                                "Extract the numeric meter reading shown on the display. "
                                "Reply with ONLY a JSON object: "
                                '{"reading": <number or null>, "confidence": <0.0-1.0>, "raw_text": "<digits seen>"}'
                            ),
                        },
                    ],
                }
            ],
            "max_tokens": 100,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_settings.openai_base_url.rstrip('/')}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {_settings.openai_api_key}"},
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()

        import json as _json
        data = _json.loads(content)
        return MeterReadResponse(
            reading=data.get("reading"),
            confidence=float(data.get("confidence", 0.5)),
            raw_text=data.get("raw_text"),
        )
    except Exception as exc:
        return MeterReadResponse(error=str(exc), confidence=0.0)


async def complete_session_public(token: str) -> GeneralTicketResponse:
    """End capture session — validate all tasks done, resolve ticket."""
    ticket = await ticket_repository.get_by_token(token)
    if not ticket:
        raise ResourceNotFoundError("Ticket", token)
    if ticket.status in _TERMINAL_STATUSES:
        raise ValidationError("This ticket is already closed")

    incomplete = [t for t in ticket.tasks if t.status not in ("completed", "skipped")]
    if incomplete:
        raise ValidationError(
            f"{len(incomplete)} task(s) still pending. Complete all units before ending the session."
        )

    now = utc_now()
    fields = {
        "status": "resolved",
        "resolved_at": now,
        "submitted_at": now,
        "capture_completed_at": now,
        "activity": ticket.activity + [
            TicketActivity(type="system", description="All meter readings captured. Session complete.")
        ],
    }
    await ticket_repository.update(ticket, fields)
    updated = await ticket_repository.get_by_token(token)
    await _publish_ticket_updated(updated, "All meter readings captured. Session complete.")
    return await _to_response(updated)


async def delete_ticket(ticket_id: str, current_user: CurrentUser) -> None:
    if current_user.role not in ("owner", "superadmin"):
        raise ForbiddenError("Only owner or superadmin can delete tickets")
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("Ticket", ticket_id)
    await ticket_repository.soft_delete(ticket)
    logger.info("ticket_deleted", action="delete_ticket", resource_type="ticket",
                resource_id=ticket_id, org_id=current_user.org_id,
                user_id=current_user.user_id, status="success")


# ── Internal ──────────────────────────────────────────────────────────────────

def _check_access(ticket: Ticket, current_user: CurrentUser, read_only: bool) -> None:
    role = current_user.role
    if role in ("owner", "agent", "superadmin"):
        return
    if role == "service_provider":
        if ticket.assigned_to != current_user.user_id:
            raise ForbiddenError("Service providers can only access assigned tickets")
        return
    if role == "tenant":
        if ticket.tenant_id != current_user.user_id:
            raise ForbiddenError("Tenants can only access their own tickets")
        return
    raise ForbiddenError("Insufficient permissions")


async def _notify_assignment(ticket: Ticket, assignee_id: str, assignee_name: str) -> None:
    try:
        from app.core.config import settings as _settings
        assignee = await user_repository.get_by_id(assignee_id)
        if assignee and assignee.email:
            # Build submission link for meter reading tickets that have a public token
            action_block = "<p>Log in to the PMS portal to view and action this ticket.</p>"
            if ticket.submission_token and ticket.category == "utility_reading":
                base_url = _settings.app_base_url.rstrip("/")
                link = f"{base_url}/task/{ticket.submission_token}?user_id={assignee_id}"
                action_block = (
                    f'<p>Use the link below to capture meter readings directly from the field:</p>'
                    f'<a href="{link}" class="btn">Start Meter Reading →</a>'
                    f'<p style="margin-top:12px;font-size:12px;color:#6b7280;">'
                    f'Or copy this link: <a href="{link}">{link}</a></p>'
                )
            html = _base(
                "New Ticket Assigned",
                f"""<h2>A ticket has been assigned to you</h2>
<p><strong>Ticket:</strong> {ticket.title}</p>
<p><strong>Category:</strong> {ticket.category.replace("_", " ").title()}</p>
<p><strong>Priority:</strong> {ticket.priority.title()}</p>
{action_block}""",
            )
            await send_email(to=str(assignee.email),
                             subject=f"Ticket assigned: {ticket.title}", html=html)
    except Exception:
        pass


async def _notify_comment(ticket: Ticket, commenter_name: str) -> None:
    try:
        assignee = await user_repository.get_by_id(ticket.assigned_to)
        if assignee and assignee.email:
            html = _base(
                "New Comment on Ticket",
                f"""<h2>New comment on your assigned ticket</h2>
<p><strong>Ticket:</strong> {ticket.title}</p>
<p>{commenter_name} has added a comment. Log in to the PMS portal to reply.</p>""",
            )
            await send_email(to=str(assignee.email),
                             subject=f"New comment: {ticket.title}", html=html)
    except Exception:
        pass
