"""
Ticket service — manages maintenance tickets raised by inspection discrepancies.

When a tenant's submitted meter reading differs from the system's last recorded
reading, a meter_discrepancy ticket is created and assigned to the property agent
(first manager_id) or the org owner. On resolution the resolution_reading becomes
the official move-in meter value for that utility.
"""
from typing import List, Optional

import structlog

from app.core.email import send_email, _base
from app.core.exceptions import ConflictError, ResourceNotFoundError, ValidationError
from app.core.s3 import generate_presigned_url, s3_path, upload_file
from app.dependencies.auth import CurrentUser
from app.models.inspection_report import MeterReadingItem
from app.models.maintenance_ticket import MaintenanceTicket
from app.models.meter_reading import MeterReading
from app.repositories.inspection_repository import inspection_repository
from app.repositories.maintenance_ticket_repository import maintenance_ticket_repository as ticket_repository
from app.repositories.user_repository import user_repository
from app.schemas.ticket import TicketResolveRequest, TicketResponse
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def _to_response(ticket: MaintenanceTicket) -> TicketResponse:
    evidence_urls: List[str] = []
    for key in ticket.evidence_keys:
        evidence_urls.append(await generate_presigned_url(key))
    return TicketResponse(
        id=str(ticket.id),
        org_id=ticket.org_id,
        property_id=ticket.property_id,
        unit_id=ticket.unit_id,
        lease_id=ticket.lease_id,
        inspection_report_id=ticket.inspection_report_id,
        ticket_type=ticket.ticket_type,
        title=ticket.title,
        description=ticket.description,
        utility_key=ticket.utility_key,
        utility_label=ticket.utility_label,
        system_reading=ticket.system_reading,
        reported_reading=ticket.reported_reading,
        status=ticket.status,
        assigned_to=ticket.assigned_to,
        resolution_reading=ticket.resolution_reading,
        resolution_notes=ticket.resolution_notes,
        evidence_urls=evidence_urls,
        resolved_by=ticket.resolved_by,
        resolved_at=ticket.resolved_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


async def list_tickets(lease_id: str, current_user: CurrentUser) -> List[TicketResponse]:
    tickets = await ticket_repository.list_by_lease(lease_id, current_user.org_id)
    return [await _to_response(t) for t in tickets]


async def get_ticket(ticket_id: str, current_user: CurrentUser) -> TicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("MaintenanceTicket", ticket_id)
    return await _to_response(ticket)


async def resolve_ticket(
    ticket_id: str,
    request: TicketResolveRequest,
    evidence_bytes_list: Optional[List[bytes]] = None,
    evidence_content_types: Optional[List[str]] = None,
    evidence_filenames: Optional[List[str]] = None,
    current_user: CurrentUser = None,
) -> TicketResponse:
    ticket = await ticket_repository.get_by_id(ticket_id, current_user.org_id)
    if not ticket:
        raise ResourceNotFoundError("MaintenanceTicket", ticket_id)
    if ticket.status == "resolved":
        raise ConflictError("Ticket is already resolved")

    # Upload resolution evidence photos
    evidence_keys: List[str] = []
    if evidence_bytes_list:
        for i, data in enumerate(evidence_bytes_list):
            ct = (evidence_content_types or [])[i] if evidence_content_types and i < len(evidence_content_types) else "image/jpeg"
            fn = (evidence_filenames or [])[i] if evidence_filenames and i < len(evidence_filenames) else f"evidence_{i}.jpg"
            key = s3_path(ticket.org_id, "tickets", ticket.id, fn)
            await upload_file(key, data, ct)
            evidence_keys.append(key)

    # Resolve the ticket
    ticket.status = "resolved"
    ticket.resolution_reading = request.resolution_reading
    ticket.resolution_notes = request.resolution_notes
    ticket.evidence_keys = evidence_keys
    ticket.resolved_by = current_user.user_id
    ticket.resolved_at = utc_now()
    await ticket_repository.save(ticket)

    # Adopt the resolution reading as the official move-in meter value on the inspection report
    report = await inspection_repository.get_by_id(ticket.inspection_report_id, ticket.org_id)
    if report:
        # Replace or insert official reading for this utility
        official = [r for r in report.official_meter_readings if r.utility_key != ticket.utility_key]
        # Preserve photo from the submitted reading
        submitted_photo = next(
            (r.photo_key for r in report.meter_readings if r.utility_key == ticket.utility_key),
            None,
        )
        official.append(MeterReadingItem(
            utility_key=ticket.utility_key,
            utility_label=ticket.utility_label,
            reading=request.resolution_reading,
            unit_label=next(
                (r.unit_label for r in report.meter_readings if r.utility_key == ticket.utility_key),
                "",
            ),
            photo_key=submitted_photo,
        ))
        report.official_meter_readings = official
        await inspection_repository.save(report)

    # Record official move-in reading in the MeterReading collection (new baseline)
    system_reading_obj = MeterReading(
        org_id=ticket.org_id,
        property_id=ticket.property_id,
        unit_id=ticket.unit_id,
        utility_key=ticket.utility_key,
        current_reading=request.resolution_reading,
        previous_reading=ticket.system_reading,
        read_by=current_user.user_id,
        source="manual",
        notes=f"Move-in baseline adopted from ticket {ticket.id} resolution",
    )
    await system_reading_obj.insert()

    # Build evidence URLs for the email
    evidence_urls: List[str] = []
    for key in evidence_keys:
        evidence_urls.append(await generate_presigned_url(key))

    # Notify tenant
    try:
        if report and report.tenant_id:
            tenant = await user_repository.get_by_id(report.tenant_id)
            if tenant and tenant.email:
                html = _resolution_email_html(
                    utility_label=ticket.utility_label,
                    resolution_reading=request.resolution_reading,
                    resolution_notes=request.resolution_notes,
                    evidence_urls=evidence_urls,
                )
                await send_email(
                    to=str(tenant.email),
                    subject=f"Meter reading resolved — {ticket.utility_label}",
                    html=html,
                )
    except Exception:
        pass  # notification is non-critical

    logger.info(
        "ticket_resolved",
        action="resolve_ticket",
        resource_type="maintenance_ticket",
        resource_id=ticket.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        utility_key=ticket.utility_key,
        resolution_reading=request.resolution_reading,
        status="success",
    )
    return await _to_response(ticket)


def _resolution_email_html(
    utility_label: str,
    resolution_reading: float,
    resolution_notes: Optional[str],
    evidence_urls: List[str],
) -> str:
    photos_html = ""
    if evidence_urls:
        imgs = "".join(
            f'<a href="{u}" style="display:inline-block;margin:4px;">'
            f'<img src="{u}" style="max-width:200px;border-radius:6px;border:1px solid #e5e7eb;" /></a>'
            for u in evidence_urls
        )
        photos_html = f"<div style='margin-top:16px;'><strong>Evidence Photos</strong><br>{imgs}</div>"

    notes_html = f"<p><strong>Notes:</strong> {resolution_notes}</p>" if resolution_notes else ""

    body = f"""
<h2>Utility Meter Reading Resolved</h2>
<p>The meter reading discrepancy for <strong>{utility_label}</strong> in your unit has been reviewed
and resolved. The following reading has been adopted as your official move-in baseline:</p>
<table style="border-collapse:collapse;margin:16px 0;">
  <tr>
    <td style="padding:8px 16px 8px 0;color:#6b7280;">Utility</td>
    <td style="padding:8px 0;font-weight:600;">{utility_label}</td>
  </tr>
  <tr>
    <td style="padding:8px 16px 8px 0;color:#6b7280;">Official Move-In Reading</td>
    <td style="padding:8px 0;font-weight:600;">{resolution_reading:,.2f}</td>
  </tr>
</table>
{notes_html}
{photos_html}
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  This reading will be used as the starting point for all future utility billing.
</p>"""
    return _base("Meter Reading Resolved", body)
