"""
Trainer submission and approval API.

Handles the secure upload → LLM scan → admin review → approve/reject flow
for user-uploaded trainer plugins.
"""
from __future__ import annotations

import asyncio
import tempfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.models.ml_user import MLUser
from app.models.trainer_submission import TrainerSubmission
from app.models.admin_ticket import AdminTicket
from app.utils.datetime import utc_now

router = APIRouter(tags=["trainer-submissions"])

RequireAdmin = Depends(require_roles("admin"))


def _submission_dict(s: TrainerSubmission) -> dict:
    return {
        "id": str(s.id),
        "org_id": s.org_id,
        "owner_email": s.owner_email,
        "trainer_name": s.trainer_name,
        "namespace": s.namespace,
        "file_key": s.file_key,
        "submission_hash": s.submission_hash,
        "status": s.status,
        "llm_scan_result": s.llm_scan_result,
        "llm_model_used": s.llm_model_used,
        "admin_ticket_id": s.admin_ticket_id,
        "reviewed_by": s.reviewed_by,
        "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        "approved_at": s.approved_at.isoformat() if s.approved_at else None,
        "rejection_reason": s.rejection_reason,
        "parsed_metadata": s.parsed_metadata,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _ticket_dict(t: AdminTicket) -> dict:
    return {
        "id": str(t.id),
        "category": t.category,
        "title": t.title,
        "body": t.body,
        "related_id": t.related_id,
        "org_id": t.org_id,
        "owner_email": t.owner_email,
        "severity": t.severity,
        "status": t.status,
        "assigned_to": t.assigned_to,
        "resolved_by": t.resolved_by,
        "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
        "metadata": t.metadata,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


async def _run_security_scan_background(
    submission_id: str,
    source: str,
    org_id: str,
    trainer_name: str,
    owner_email: str,
) -> None:
    """Background task: run LLM scan, update submission, create ticket/violation if needed."""
    from app.services.trainer_security_service import (
        scan_trainer_security,
        create_admin_ticket,
        create_violation,
    )

    try:
        submission = await TrainerSubmission.get(submission_id)
        if not submission:
            return

        scan_result = await scan_trainer_security(
            source=source,
            org_id=org_id,
            submission_id=submission_id,
            trainer_name=trainer_name,
        )

        passed = scan_result.get("passed", False)
        severity = scan_result.get("severity", "low")

        now = utc_now()

        if passed:
            new_status = "approved"
            # Auto-activate trainer registration
            from app.models.trainer_registration import TrainerRegistration
            reg = await TrainerRegistration.find_one(
                TrainerRegistration.name == trainer_name,
                TrainerRegistration.org_id == org_id,
            )
            if reg:
                await reg.set({
                    "approval_status": "approved",
                    "is_active": True,
                    "submission_id": submission_id,
                    "updated_at": now,
                })
        else:
            new_status = "flagged" if severity in ("high", "critical", "malicious") else "pending_admin"

            # Create admin ticket for review
            ticket_id = await create_admin_ticket(
                submission_id=submission_id,
                trainer_name=trainer_name,
                scan_result=scan_result,
                owner_email=owner_email,
                org_id=org_id,
            )

            # Create violation record for serious issues
            if severity in ("high", "critical", "malicious"):
                await create_violation(
                    submission_id=submission_id,
                    trainer_name=trainer_name,
                    org_id=org_id,
                    owner_email=owner_email,
                    severity=severity,
                    summary=scan_result.get("summary", ""),
                    issues=scan_result.get("issues", []),
                )

            await submission.set({
                "admin_ticket_id": ticket_id,
                "updated_at": now,
            })

        await submission.set({
            "status": new_status,
            "llm_scan_result": scan_result,
            "llm_model_used": scan_result.get("model_used", ""),
            "updated_at": now,
        })

    except Exception as exc:
        from app.core.config import settings
        import structlog
        log = structlog.get_logger(__name__)
        log.error(
            "trainer_submission_scan_failed",
            submission_id=submission_id,
            error=str(exc),
        )
        try:
            submission = await TrainerSubmission.get(submission_id)
            if submission:
                await submission.set({
                    "status": "pending_admin",
                    "llm_scan_result": {
                        "passed": False,
                        "severity": "low",
                        "summary": f"Scan error: {str(exc)[:200]}",
                        "issues": ["Automated scan failed — manual review required"],
                    },
                    "updated_at": utc_now(),
                })
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════
# UPLOAD
# ═══════════════════════════════════════════════════════════════

@router.post("/trainer-submissions/upload")
async def upload_trainer(
    file: UploadFile = File(...),
    current_user: MLUser = Depends(get_current_user),
):
    """Upload a .py trainer file. Triggers background LLM security scan."""
    if not file.filename or not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only .py files are accepted")

    file_bytes = await file.read()
    if len(file_bytes) > 500_000:  # 500 KB limit
        raise HTTPException(status_code=400, detail="File too large (max 500 KB)")

    source = file_bytes.decode("utf-8", errors="replace")

    # Parse metadata header
    from app.services.registry_service import _parse_metadata_header, _compute_file_hash
    metadata = _parse_metadata_header(source)

    trainer_name = metadata.get("Name") or file.filename.replace(".py", "")
    org_id = current_user.org_id or ""
    namespace = org_id if org_id else "system"
    submission_hash = _compute_file_hash(org_id, file_bytes)

    # Persist file to a temp path (or S3 in production)
    import os
    plugin_dir_base = "/tmp/ml_uploads"
    os.makedirs(plugin_dir_base, exist_ok=True)
    file_key = f"{plugin_dir_base}/{org_id or 'system'}_{trainer_name}_{submission_hash[:8]}.py"
    with open(file_key, "wb") as f:
        f.write(file_bytes)

    now = utc_now()

    submission = TrainerSubmission(
        org_id=org_id,
        owner_email=current_user.email,
        trainer_name=trainer_name,
        namespace=namespace,
        file_key=file_key,
        submission_hash=submission_hash,
        status="scanning",
        parsed_metadata=metadata,
        submitted_at=now,
        updated_at=now,
    )
    await submission.insert()

    submission_id = str(submission.id)

    # Trigger background scan (fire-and-forget)
    asyncio.create_task(
        _run_security_scan_background(
            submission_id=submission_id,
            source=source,
            org_id=org_id,
            trainer_name=trainer_name,
            owner_email=current_user.email,
        )
    )

    return _submission_dict(submission)


# ═══════════════════════════════════════════════════════════════
# LIST / GET
# ═══════════════════════════════════════════════════════════════

@router.get("/trainer-submissions")
async def list_submissions(
    current_user: MLUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List trainer submissions. Admins see all; engineers see only their own."""
    skip = (page - 1) * page_size

    if current_user.role == "admin":
        query = TrainerSubmission.find_all()
    else:
        query = TrainerSubmission.find(
            TrainerSubmission.org_id == (current_user.org_id or ""),
            TrainerSubmission.owner_email == current_user.email,
        )

    total = await query.count()
    items = await query.skip(skip).limit(page_size).sort(-TrainerSubmission.submitted_at).to_list()

    return {"items": [_submission_dict(s) for s in items], "total": total}


@router.get("/trainer-submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    current_user: MLUser = Depends(get_current_user),
):
    """Get a single submission by ID."""
    submission = await TrainerSubmission.get(submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Non-admins can only view their own
    if current_user.role != "admin":
        if submission.owner_email != current_user.email or submission.org_id != (current_user.org_id or ""):
            raise HTTPException(status_code=403, detail="Access denied")

    return _submission_dict(submission)


# ═══════════════════════════════════════════════════════════════
# APPROVE / REJECT
# ═══════════════════════════════════════════════════════════════

@router.post("/trainer-submissions/{submission_id}/approve", dependencies=[RequireAdmin])
async def approve_submission(
    submission_id: str,
    current_user: MLUser = Depends(get_current_user),
):
    """Admin approves a submission → activates trainer registration."""
    submission = await TrainerSubmission.get(submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    if submission.status == "approved":
        return {"ok": True, "message": "Already approved"}

    now = utc_now()

    await submission.set({
        "status": "approved",
        "reviewed_by": current_user.email,
        "reviewed_at": now,
        "approved_at": now,
        "updated_at": now,
    })

    # Activate trainer registration
    from app.models.trainer_registration import TrainerRegistration
    reg = await TrainerRegistration.find_one(
        TrainerRegistration.name == submission.trainer_name,
        TrainerRegistration.org_id == submission.org_id,
    )
    if reg:
        await reg.set({
            "approval_status": "approved",
            "is_active": True,
            "submission_id": submission_id,
            "updated_at": now,
        })

    # Close admin ticket if present
    if submission.admin_ticket_id:
        ticket = await AdminTicket.get(submission.admin_ticket_id)
        if ticket:
            await ticket.set({
                "status": "resolved",
                "resolved_by": current_user.email,
                "resolved_at": now,
                "updated_at": now,
            })

    return {"ok": True}


class RejectRequest(BaseModel):
    reason: str = ""


@router.post("/trainer-submissions/{submission_id}/reject", dependencies=[RequireAdmin])
async def reject_submission(
    submission_id: str,
    body: RejectRequest,
    current_user: MLUser = Depends(get_current_user),
):
    """Admin rejects a submission with an optional reason."""
    submission = await TrainerSubmission.get(submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    now = utc_now()

    await submission.set({
        "status": "rejected",
        "rejection_reason": body.reason,
        "reviewed_by": current_user.email,
        "reviewed_at": now,
        "updated_at": now,
    })

    # Deactivate trainer registration
    from app.models.trainer_registration import TrainerRegistration
    reg = await TrainerRegistration.find_one(
        TrainerRegistration.name == submission.trainer_name,
        TrainerRegistration.org_id == submission.org_id,
    )
    if reg:
        await reg.set({
            "approval_status": "rejected",
            "is_active": False,
            "updated_at": now,
        })

    # Close admin ticket
    if submission.admin_ticket_id:
        ticket = await AdminTicket.get(submission.admin_ticket_id)
        if ticket:
            await ticket.set({
                "status": "dismissed",
                "resolved_by": current_user.email,
                "resolved_at": now,
                "updated_at": now,
            })

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# ADMIN TICKETS
# ═══════════════════════════════════════════════════════════════

@router.get("/admin-tickets", dependencies=[RequireAdmin])
async def list_admin_tickets(
    _: MLUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
):
    """List all ML admin tickets (admin only)."""
    skip = (page - 1) * page_size

    filters = []
    if status:
        filters.append(AdminTicket.status == status)

    query = AdminTicket.find(*filters)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).sort(-AdminTicket.created_at).to_list()

    return {"items": [_ticket_dict(t) for t in items], "total": total}


class TicketUpdateRequest(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    admin_note: Optional[str] = None


@router.patch("/admin-tickets/{ticket_id}", dependencies=[RequireAdmin])
async def update_admin_ticket(
    ticket_id: str,
    body: TicketUpdateRequest,
    current_user: MLUser = Depends(get_current_user),
):
    """Update an admin ticket status (admin only)."""
    ticket = await AdminTicket.get(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update: dict = {"updated_at": utc_now()}
    if body.status:
        update["status"] = body.status
        if body.status in ("resolved", "dismissed"):
            update["resolved_by"] = current_user.email
            update["resolved_at"] = utc_now()
    if body.assigned_to is not None:
        update["assigned_to"] = body.assigned_to

    await ticket.set(update)
    # Re-fetch
    ticket = await AdminTicket.get(ticket_id)
    return _ticket_dict(ticket)
