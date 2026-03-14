"""Ticket API endpoints.

Includes:
  - Comprehensive general-purpose ticket endpoints (new)
  - Legacy MaintenanceTicket endpoints (meter discrepancy from inspection flow)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.ticket import (
    BulkUtilityTicketRequest,
    GeneralTicketCreateRequest,
    GeneralTicketListResponse,
    GeneralTicketResponse,
    GeneralTicketUpdateRequest,
    MeterReadResponse,
    OrgMemberResponse,
    SubmissionDataRequest,
    TaskPublicUpdateRequest,
    TicketCommentRequest,
    TicketCountsResponse,
    TicketResolveRequest,
    TicketResponse,
    TicketTaskCreateRequest,
    TicketTaskResponse,
    TicketTaskUpdateRequest,
)
from app.services import ticket_service
from app.services import gen_ticket_service

router = APIRouter(tags=["tickets"])


# ─── General-purpose ticket endpoints ────────────────────────────────────────

@router.post(
    "/tickets",
    response_model=GeneralTicketResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "tenant", "superadmin"))],
)
async def create_ticket(
    request: GeneralTicketCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.create_ticket(request, current_user)


@router.post(
    "/tickets/bulk-utility",
    response_model=List[GeneralTicketResponse],
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_bulk_utility_tickets(
    request: BulkUtilityTicketRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[GeneralTicketResponse]:
    return await gen_ticket_service.create_bulk_utility_tickets(request, current_user)


@router.get(
    "/tickets/members",
    response_model=List[OrgMemberResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_org_members(
    current_user: CurrentUser = Depends(get_current_user),
) -> List[OrgMemberResponse]:
    return await gen_ticket_service.list_org_members(current_user)


@router.get(
    "/tickets/counts",
    response_model=TicketCountsResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_ticket_counts(
    property_id: Optional[str] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> TicketCountsResponse:
    return await gen_ticket_service.get_counts(current_user, property_id)


@router.get(
    "/tickets",
    response_model=GeneralTicketListResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant", "superadmin"))],
)
async def list_tickets(
    property_id: Optional[str] = Query(default=None),
    unit_id: Optional[str] = Query(default=None),
    tenant_id: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketListResponse:
    return await gen_ticket_service.list_tickets(
        current_user=current_user,
        property_id=property_id,
        unit_id=unit_id,
        tenant_id=tenant_id,
        category=category,
        status=status,
        priority=priority,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/tickets/{ticket_id}",
    response_model=GeneralTicketResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant", "superadmin"))],
)
async def get_ticket(
    ticket_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.get_ticket(ticket_id, current_user)


@router.patch(
    "/tickets/{ticket_id}",
    response_model=GeneralTicketResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "superadmin"))],
)
async def update_ticket(
    ticket_id: str,
    request: GeneralTicketUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.update_ticket(ticket_id, request, current_user)


@router.delete(
    "/tickets/{ticket_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_ticket(
    ticket_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    await gen_ticket_service.delete_ticket(ticket_id, current_user)


@router.post(
    "/tickets/{ticket_id}/comments",
    response_model=GeneralTicketResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant", "superadmin"))],
)
async def add_comment(
    ticket_id: str,
    request: TicketCommentRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.add_comment(ticket_id, request, current_user)


@router.post(
    "/tickets/{ticket_id}/attachments",
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "tenant", "superadmin"))],
)
async def upload_ticket_attachment(
    ticket_id: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload a file attachment to a ticket. Returns the AttachmentFile metadata with presigned URL."""
    data = await file.read()
    return await gen_ticket_service.upload_ticket_attachment_rich(
        ticket_id=ticket_id,
        file_bytes=data,
        content_type=file.content_type or "application/octet-stream",
        filename=file.filename or "attachment",
        current_user=current_user,
    )


@router.delete(
    "/tickets/{ticket_id}/attachments/{attachment_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "superadmin"))],
)
async def delete_ticket_attachment(
    ticket_id: str,
    attachment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove an attachment from a ticket."""
    await gen_ticket_service.delete_ticket_attachment(ticket_id, attachment_id, current_user)


# ─── Task endpoints ───────────────────────────────────────────────────────────

@router.post(
    "/tickets/{ticket_id}/tasks",
    response_model=GeneralTicketResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def add_task(
    ticket_id: str,
    request: TicketTaskCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.add_task(ticket_id, request, current_user)


@router.patch(
    "/tickets/{ticket_id}/tasks/{task_id}",
    response_model=GeneralTicketResponse,
    dependencies=[Depends(require_roles("owner", "agent", "service_provider", "superadmin"))],
)
async def update_task(
    ticket_id: str,
    task_id: str,
    request: TicketTaskUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.update_task(ticket_id, task_id, request, current_user)


@router.delete(
    "/tickets/{ticket_id}/tasks/{task_id}",
    response_model=GeneralTicketResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def delete_task(
    ticket_id: str,
    task_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> GeneralTicketResponse:
    return await gen_ticket_service.delete_task(ticket_id, task_id, current_user)


# ─── Public token-based endpoints ────────────────────────────────────────────

@router.get(
    "/tickets/task/{token}",
    response_model=GeneralTicketResponse,
)
async def get_ticket_by_token(token: str) -> GeneralTicketResponse:
    return await gen_ticket_service.get_public_ticket(token)


@router.post(
    "/tickets/task/{token}/submit",
    response_model=GeneralTicketResponse,
)
async def submit_ticket_by_token(
    token: str,
    request: SubmissionDataRequest,
) -> GeneralTicketResponse:
    return await gen_ticket_service.submit_public(token, request)


@router.patch(
    "/tickets/task/{token}/start",
    response_model=GeneralTicketResponse,
)
async def start_capture(token: str) -> GeneralTicketResponse:
    """Mark ticket as in_progress (public — no auth required)."""
    return await gen_ticket_service.start_capture_public(token)


@router.patch(
    "/tickets/task/{token}/tasks/{task_id}",
    response_model=GeneralTicketResponse,
)
async def update_task_public(
    token: str,
    task_id: str,
    request: TaskPublicUpdateRequest,
) -> GeneralTicketResponse:
    """Submit meter reading for a single task (public — no auth required)."""
    return await gen_ticket_service.update_task_public(
        token=token,
        task_id=task_id,
        current_reading=request.current_reading,
        notes=request.notes,
        photo_key=request.photo_key,
        meter_number=request.meter_number,
        captured_by=request.captured_by,
    )


@router.post(
    "/tickets/task/{token}/complete",
    response_model=GeneralTicketResponse,
)
async def complete_session(token: str) -> GeneralTicketResponse:
    """End capture session, validate all tasks complete, resolve ticket (public — no auth required)."""
    return await gen_ticket_service.complete_session_public(token)


@router.post(
    "/tickets/task/{token}/tasks/{task_id}/photo",
)
async def upload_task_photo(
    token: str,
    task_id: str,
    file: UploadFile = File(...),
) -> dict:
    """Upload a meter photo for a task (public — no auth required). Returns S3 key + presigned URL."""
    data = await file.read()
    key, url = await gen_ticket_service.upload_task_photo_public(
        token=token,
        task_id=task_id,
        file_bytes=data,
        content_type=file.content_type or "image/jpeg",
        filename=file.filename or "meter.jpg",
    )
    return {"photo_key": key, "url": url}


@router.post(
    "/tickets/task/{token}/tasks/{task_id}/read-meter",
    response_model=MeterReadResponse,
)
async def read_meter_ai(
    token: str,
    task_id: str,
    file: UploadFile = File(...),
) -> MeterReadResponse:
    """Use AI vision to read meter value from uploaded image (public — no auth required)."""
    data = await file.read()
    return await gen_ticket_service.read_meter_ai(
        token=token,
        task_id=task_id,
        file_bytes=data,
        content_type=file.content_type or "image/jpeg",
    )


# ─── Legacy MaintenanceTicket endpoints (meter discrepancy) ───────────────────

@router.get(
    "/leases/{lease_id}/tickets",
    response_model=List[TicketResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_maintenance_tickets(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[TicketResponse]:
    return await ticket_service.list_tickets(lease_id, current_user)


@router.post(
    "/maintenance-tickets/{ticket_id}/resolve",
    response_model=TicketResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def resolve_maintenance_ticket(
    ticket_id: str,
    resolution_reading: float = Form(...),
    resolution_notes: Optional[str] = Form(default=None),
    evidence: List[UploadFile] = File(default=[]),
    current_user: CurrentUser = Depends(get_current_user),
) -> TicketResponse:
    evidence_bytes: List[bytes] = []
    evidence_cts: List[str] = []
    evidence_fns: List[str] = []
    for f in evidence:
        evidence_bytes.append(await f.read())
        evidence_cts.append(f.content_type or "image/jpeg")
        evidence_fns.append(f.filename or "evidence.jpg")

    return await ticket_service.resolve_ticket(
        ticket_id=ticket_id,
        request=TicketResolveRequest(
            resolution_reading=resolution_reading,
            resolution_notes=resolution_notes,
        ),
        evidence_bytes_list=evidence_bytes or None,
        evidence_content_types=evidence_cts or None,
        evidence_filenames=evidence_fns or None,
        current_user=current_user,
    )
