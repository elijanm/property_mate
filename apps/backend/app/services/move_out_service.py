import copy
from datetime import date
from typing import Optional

import structlog

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.core.s3 import generate_presigned_url, s3_path, upload_file
from app.dependencies.auth import CurrentUser
from app.models.move_out import DEFAULT_CHECKLIST, DamageItem, MoveOutInspection
from app.repositories.lease_repository import lease_repository
from app.repositories.move_out_repository import move_out_repository
from app.schemas.move_out import (
    ChecklistItemResponse,
    ChecklistItemUpdateRequest,
    DamageItemCreateRequest,
    DamageItemResponse,
    MoveOutApproveRequest,
    MoveOutCreateRequest,
    MoveOutInspectionResponse,
)
from app.utils.datetime import utc_now
from fastapi import UploadFile

logger = structlog.get_logger(__name__)


def _to_response(m: MoveOutInspection, pdf_url: Optional[str] = None) -> MoveOutInspectionResponse:
    return MoveOutInspectionResponse(
        id=str(m.id),
        org_id=m.org_id,
        lease_id=m.lease_id,
        property_id=m.property_id,
        unit_id=m.unit_id,
        tenant_id=m.tenant_id,
        status=m.status,
        scheduled_date=m.scheduled_date,
        completed_date=m.completed_date,
        inspector_id=m.inspector_id,
        checklist=[ChecklistItemResponse(**c.model_dump()) for c in m.checklist],
        damages=[DamageItemResponse(**d.model_dump()) for d in m.damages],
        total_damage_cost=m.total_damage_cost,
        deposit_deduction=m.deposit_deduction,
        net_deposit_refund=m.net_deposit_refund,
        inspector_notes=m.inspector_notes,
        approved_by=m.approved_by,
        approved_at=m.approved_at,
        reconciliation_pdf_key=m.reconciliation_pdf_key,
        reconciliation_pdf_url=pdf_url,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


async def create_inspection(
    lease_id: str,
    data: MoveOutCreateRequest,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    existing = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if existing:
        raise ConflictError("Move-out inspection already exists for this lease")
    inspection = MoveOutInspection(
        org_id=current_user.org_id,
        lease_id=lease_id,
        property_id=lease.property_id,
        unit_id=lease.unit_id,
        tenant_id=lease.tenant_id,
        scheduled_date=data.scheduled_date,
        inspector_id=data.inspector_id,
        checklist=copy.deepcopy(DEFAULT_CHECKLIST),
    )
    await move_out_repository.create(inspection)
    logger.info(
        "move_out_inspection_created",
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        resource_type="move_out_inspection",
        resource_id=str(inspection.id),
        action="create_inspection",
        status="success",
    )
    return _to_response(inspection)


async def get_inspection(
    lease_id: str,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    m = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if not m:
        raise ResourceNotFoundError("MoveOutInspection", lease_id)
    pdf_url = None
    if m.reconciliation_pdf_key:
        pdf_url = await generate_presigned_url(m.reconciliation_pdf_key)
    return _to_response(m, pdf_url)


async def update_checklist_item(
    lease_id: str,
    item_id: str,
    data: ChecklistItemUpdateRequest,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    m = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if not m:
        raise ResourceNotFoundError("MoveOutInspection", lease_id)
    item = next((c for c in m.checklist if c.id == item_id), None)
    if not item:
        raise ResourceNotFoundError("ChecklistItem", item_id)
    if data.checked is not None:
        item.checked = data.checked
        item.checked_by = current_user.user_id
        item.checked_at = utc_now()
    if data.notes is not None:
        item.notes = data.notes
    await move_out_repository.save(m)
    return _to_response(m)


async def add_damage(
    lease_id: str,
    data: DamageItemCreateRequest,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    m = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if not m:
        raise ResourceNotFoundError("MoveOutInspection", lease_id)
    damage = DamageItem(
        **data.model_dump(),
        assessed_by=current_user.user_id,
        assessed_at=utc_now(),
    )
    m.damages.append(damage)
    m.total_damage_cost = round(sum(d.estimated_cost for d in m.damages), 2)
    await move_out_repository.save(m)
    return _to_response(m)


async def upload_damage_photo(
    lease_id: str,
    damage_id: str,
    file: UploadFile,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    m = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if not m:
        raise ResourceNotFoundError("MoveOutInspection", lease_id)
    damage = next((d for d in m.damages if d.id == damage_id), None)
    if not damage:
        raise ResourceNotFoundError("DamageItem", damage_id)
    content = await file.read()
    key = s3_path(
        current_user.org_id,
        "move_out",
        str(m.id),
        f"{damage_id}_{file.filename}",
    )
    await upload_file(key, content, file.content_type or "image/jpeg")
    damage.photo_keys.append(key)
    await move_out_repository.save(m)
    return _to_response(m)


async def approve_inspection(
    lease_id: str,
    data: MoveOutApproveRequest,
    current_user: CurrentUser,
) -> MoveOutInspectionResponse:
    m = await move_out_repository.get_by_lease(lease_id, current_user.org_id)
    if not m:
        raise ResourceNotFoundError("MoveOutInspection", lease_id)
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    deposit = (lease.deposit_amount if lease else 0.0)
    m.status = "approved"
    m.deposit_deduction = min(data.deposit_deduction, deposit)
    m.net_deposit_refund = max(0.0, round(deposit - m.deposit_deduction, 2))
    m.inspector_notes = data.inspector_notes
    m.approved_by = current_user.user_id
    m.approved_at = utc_now()
    m.completed_date = date.today()
    await move_out_repository.save(m)
    logger.info(
        "move_out_inspection_approved",
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        resource_type="move_out_inspection",
        resource_id=str(m.id),
        action="approve_inspection",
        status="success",
    )
    return _to_response(m)
