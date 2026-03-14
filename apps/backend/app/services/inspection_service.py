"""
Inspection service — manages pre-move-in and move-out inspection reports.
Public (token-based) routes allow tenants to fill reports without auth.
"""
import secrets
import uuid
from typing import List, Optional

import structlog

from app.core.email import send_email, _base
from app.core.config import settings
from app.core.exceptions import ConflictError, ResourceNotFoundError, ValidationError
from app.core.s3 import upload_file, generate_presigned_url, s3_path
from app.dependencies.auth import CurrentUser
from app.models.inspection_report import DefectItem, InspectionReport, MeterReadingItem
from app.repositories.inspection_repository import inspection_repository
from app.repositories.lease_repository import lease_repository
from app.repositories.user_repository import user_repository
from app.schemas.inspection import (
    DefectItemResponse,
    DefectRequest,
    InspectionCreateRequest,
    InspectionPublicResponse,
    InspectionResponse,
    MeterReadingItemResponse,
    MeterReadingRequest,
)
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _meter_reading_response(mr: MeterReadingItem) -> MeterReadingItemResponse:
    photo_url: Optional[str] = None
    if mr.photo_key:
        photo_url = await generate_presigned_url(mr.photo_key)
    return MeterReadingItemResponse(
        utility_key=mr.utility_key,
        utility_label=mr.utility_label,
        reading=mr.reading,
        unit_label=mr.unit_label,
        photo_url=photo_url,
    )


async def _defect_response(defect: DefectItem) -> DefectItemResponse:
    photo_urls = []
    for key in defect.photo_keys:
        photo_urls.append(await generate_presigned_url(key))
    return DefectItemResponse(
        id=defect.id,
        location=defect.location,
        description=defect.description,
        photo_urls=photo_urls,
    )


async def _to_response(report: InspectionReport) -> InspectionResponse:
    meter_readings = [await _meter_reading_response(mr) for mr in report.meter_readings]
    official_meter_readings = [await _meter_reading_response(mr) for mr in report.official_meter_readings]
    defects = [await _defect_response(d) for d in report.defects]
    return InspectionResponse(
        id=str(report.id),
        org_id=report.org_id,
        lease_id=report.lease_id,
        property_id=report.property_id,
        unit_id=report.unit_id,
        tenant_id=report.tenant_id,
        type=report.type,
        status=report.status,
        token=report.token,
        meter_readings=meter_readings,
        defects=defects,
        official_meter_readings=official_meter_readings,
        submitted_at=report.submitted_at,
        reviewed_at=report.reviewed_at,
        reviewed_by=report.reviewed_by,
        notes=report.notes,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


async def _to_public_response(report: InspectionReport) -> InspectionPublicResponse:
    meter_readings = [await _meter_reading_response(mr) for mr in report.meter_readings]
    defects = [await _defect_response(d) for d in report.defects]
    return InspectionPublicResponse(
        id=str(report.id),
        lease_id=report.lease_id,
        type=report.type,
        status=report.status,
        meter_readings=meter_readings,
        defects=defects,
        expires_at=report.expires_at,
        window_days=report.window_days,
        submitted_at=report.submitted_at,
        notes=report.notes,
        created_at=report.created_at,
    )


# ── Service methods ──────────────────────────────────────────────────────────

async def create_inspection(
    lease_id: str,
    request: InspectionCreateRequest,
    current_user: CurrentUser,
) -> InspectionResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    # Check for existing non-deleted report of same type
    existing = await inspection_repository.list_by_lease(lease_id, current_user.org_id)
    for rep in existing:
        if rep.type == request.type:
            raise ConflictError(f"An inspection report of type '{request.type}' already exists for this lease")

    token = secrets.token_urlsafe(32)
    report = InspectionReport(
        org_id=current_user.org_id,
        lease_id=lease_id,
        property_id=lease.property_id,
        unit_id=lease.unit_id,
        tenant_id=lease.tenant_id,
        type=request.type,
        token=token,
        notes=request.notes,
    )
    await inspection_repository.create(report)

    # Send email for pre-move-in inspections
    if request.type == "pre_move_in":
        tenant = await user_repository.get_by_id(lease.tenant_id)
        if tenant and tenant.email:
            inspection_url = f"{settings.app_base_url}/inspection/{token}"
            html = _inspection_invite_html(inspection_url, report.type)
            await send_email(
                to=str(tenant.email),
                subject="Complete your pre-move-in inspection",
                html=html,
            )

    logger.info(
        "inspection_created",
        action="create_inspection",
        resource_type="inspection_report",
        resource_id=report.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return await _to_response(report)


def _inspection_invite_html(inspection_url: str, inspection_type: str) -> str:
    label = "Pre-Move-In Inspection" if inspection_type == "pre_move_in" else "Move-Out Inspection"
    body = f"""
<h2>Complete your {label}</h2>
<p>Please follow the link below to record meter readings and document the condition of your unit.</p>
<a href="{inspection_url}" class="btn">Start {label} →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{inspection_url}" style="color:#1d4ed8;">{inspection_url}</a>
</p>"""
    return _base(label, body)


async def get_by_token(token: str) -> InspectionPublicResponse:
    report = await inspection_repository.get_by_token(token)
    if not report:
        raise ResourceNotFoundError("InspectionReport", token)
    return await _to_public_response(report)


async def add_meter_reading(
    token: str,
    data: MeterReadingRequest,
    photo_bytes: Optional[bytes] = None,
    photo_content_type: str = "image/jpeg",
    photo_filename: str = "photo.jpg",
) -> InspectionPublicResponse:
    report = await inspection_repository.get_by_token(token)
    if not report:
        raise ResourceNotFoundError("InspectionReport", token)
    if report.status == "submitted":
        raise ValidationError("Cannot modify a submitted inspection")
    if report.expires_at and utc_now() > report.expires_at:
        raise ValidationError("Inspection window has expired")

    photo_key: Optional[str] = None
    if photo_bytes:
        photo_key = s3_path(
            report.org_id, "inspections", report.id, f"meter_{data.utility_key}_{photo_filename}"
        )
        await upload_file(photo_key, photo_bytes, photo_content_type)

    # Replace existing reading for same utility_key or append
    readings = [mr for mr in report.meter_readings if mr.utility_key != data.utility_key]
    readings.append(
        MeterReadingItem(
            utility_key=data.utility_key,
            utility_label=data.utility_label,
            reading=data.reading,
            unit_label=data.unit_label,
            photo_key=photo_key,
        )
    )
    report.meter_readings = readings
    await inspection_repository.save(report)
    return await _to_public_response(report)


async def add_defect(
    token: str,
    data: DefectRequest,
    photo_bytes_list: Optional[List[bytes]] = None,
    photo_content_types: Optional[List[str]] = None,
    photo_filenames: Optional[List[str]] = None,
) -> InspectionPublicResponse:
    report = await inspection_repository.get_by_token(token)
    if not report:
        raise ResourceNotFoundError("InspectionReport", token)
    if report.status == "submitted":
        raise ValidationError("Cannot modify a submitted inspection")
    if report.expires_at and utc_now() > report.expires_at:
        raise ValidationError("Inspection window has expired")

    defect_id = str(uuid.uuid4())
    photo_keys: List[str] = []
    if photo_bytes_list:
        for i, photo_bytes in enumerate(photo_bytes_list):
            ct = (photo_content_types or [])[i] if photo_content_types and i < len(photo_content_types) else "image/jpeg"
            fn = (photo_filenames or [])[i] if photo_filenames and i < len(photo_filenames) else f"photo_{i}.jpg"
            key = s3_path(report.org_id, "inspections", report.id, f"defect_{defect_id}_{fn}")
            await upload_file(key, photo_bytes, ct)
            photo_keys.append(key)

    defect = DefectItem(
        id=defect_id,
        location=data.location,
        description=data.description,
        photo_keys=photo_keys,
    )
    report.defects.append(defect)
    await inspection_repository.save(report)
    return await _to_public_response(report)


async def submit_inspection(token: str) -> InspectionPublicResponse:
    report = await inspection_repository.get_by_token(token)
    if not report:
        raise ResourceNotFoundError("InspectionReport", token)
    if report.status == "submitted":
        raise ConflictError("Inspection already submitted")
    if report.expires_at and utc_now() > report.expires_at:
        raise ValidationError("Inspection window has expired")

    report.status = "submitted"
    report.submitted_at = utc_now()
    await inspection_repository.save(report)

    # Best-effort: detect meter discrepancies + notify owner
    try:
        await _handle_post_submission(report)
    except Exception:
        pass

    logger.info(
        "inspection_submitted",
        action="submit_inspection",
        resource_type="inspection_report",
        resource_id=report.id,
        org_id=report.org_id,
        status="success",
    )
    return await _to_public_response(report)


async def _handle_post_submission(report: InspectionReport) -> None:
    """
    After submission:
    1. Compare each meter reading against the last system reading. If different,
       create a meter_discrepancy ticket assigned to the property agent
       (first manager_id) or the org owner.
    2. Notify owner/manager that the report is ready for review.
    """
    from app.models.maintenance_ticket import MaintenanceTicket
    from app.models.user import User
    from app.repositories.meter_reading_repository import meter_reading_repository
    from app.repositories.org_repository import org_repository
    from app.repositories.property_repository import property_repository
    from app.repositories.maintenance_ticket_repository import maintenance_ticket_repository as ticket_repository

    prop = await property_repository.get_by_id(report.property_id, report.org_id)
    org = await org_repository.get_by_id(report.org_id)

    # Determine assignee: first property manager, or org owner
    assigned_to: Optional[str] = None
    if prop and prop.manager_ids:
        assigned_to = prop.manager_ids[0]
    else:
        owner = await User.find_one(
            User.org_id == report.org_id,
            User.role == "owner",
            User.deleted_at == None,  # noqa: E711
        )
        if owner:
            assigned_to = owner.id

    # Compare each submitted meter reading against the last system reading
    for mr in report.meter_readings:
        system_mr = await meter_reading_repository.get_latest(
            org_id=report.org_id,
            unit_id=report.unit_id,
            utility_key=mr.utility_key,
        )
        if system_mr is None:
            continue  # no baseline to compare against — skip
        if abs(system_mr.current_reading - mr.reading) < 0.001:
            continue  # readings match — no discrepancy

        ticket = MaintenanceTicket(
            org_id=report.org_id,
            property_id=report.property_id,
            unit_id=report.unit_id,
            lease_id=report.lease_id,
            inspection_report_id=report.id,
            title=f"Meter discrepancy — {mr.utility_label}",
            description=(
                f"Tenant submitted a {mr.utility_label} reading of "
                f"{mr.reading:,.2f} {mr.unit_label} but the system shows "
                f"{system_mr.current_reading:,.2f} {mr.unit_label}. "
                f"Please investigate and resolve the correct move-in meter value."
            ),
            utility_key=mr.utility_key,
            utility_label=mr.utility_label,
            system_reading=system_mr.current_reading,
            reported_reading=mr.reading,
            assigned_to=assigned_to,
        )
        await ticket_repository.create(ticket)

        logger.info(
            "meter_discrepancy_ticket_created",
            action="create_ticket",
            resource_type="maintenance_ticket",
            resource_id=ticket.id,
            org_id=report.org_id,
            utility_key=mr.utility_key,
            system_reading=system_mr.current_reading,
            reported_reading=mr.reading,
            status="success",
        )

    # Notify owner/manager about submitted inspection
    owner_email = org.business.email if org and org.business else None
    if owner_email:
        label = "Pre-Move-In" if report.type == "pre_move_in" else "Move-Out"
        html = _base(
            f"{label} Inspection Submitted",
            f"<h2>{label} Inspection Submitted</h2>"
            f"<p>A tenant has submitted their {label.lower()} inspection. "
            f"Please review it in your dashboard.</p>",
        )
        await send_email(
            to=owner_email,
            subject=f"{label} Inspection Submitted",
            html=html,
        )


async def list_inspections(lease_id: str, current_user: CurrentUser) -> List[InspectionResponse]:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    reports = await inspection_repository.list_by_lease(lease_id, current_user.org_id)
    return [await _to_response(r) for r in reports]


async def review_inspection(
    report_id: str,
    current_user: CurrentUser,
) -> InspectionResponse:
    report = await inspection_repository.get_by_id(report_id, current_user.org_id)
    if not report:
        raise ResourceNotFoundError("InspectionReport", report_id)
    if report.status != "submitted":
        raise ValidationError(f"Cannot review inspection in status '{report.status}'")

    report.status = "reviewed"
    report.reviewed_at = utc_now()
    report.reviewed_by = current_user.user_id
    await inspection_repository.save(report)

    logger.info(
        "inspection_reviewed",
        action="review_inspection",
        resource_type="inspection_report",
        resource_id=report_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return await _to_response(report)
