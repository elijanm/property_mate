"""
Trainer submission and approval API.

Handles the secure upload → security scan → admin review → approve/reject flow
for user-uploaded trainer plugins.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.dependencies.auth import get_current_user, require_roles
from app.models.ml_user import MLUser
from app.models.trainer_submission import TrainerSubmission
from app.models.admin_ticket import AdminTicket
from app.utils.datetime import utc_now

router = APIRouter(tags=["trainer-submissions"])

_TERMINAL_STATUSES = {"approved", "flagged", "pending_admin", "rejected"}


def _sub_channel(submission_id: str) -> str:
    return f"ml:sub_status:{submission_id}"


async def _publish_sub_event(submission_id: str, payload: dict) -> None:
    """Publish a submission status event to Redis so SSE clients receive it."""
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.publish(_sub_channel(submission_id), json.dumps(payload))
        await r.aclose()
    except Exception:
        pass  # SSE publish failure must never break the scan flow

RequireAdmin = Depends(require_roles("admin"))


def _submission_dict(s: TrainerSubmission) -> dict:
    return {
        "id": str(s.id),
        "org_id": s.org_id,
        "owner_email": s.owner_email,
        "trainer_name": s.trainer_name,
        "base_trainer_name": getattr(s, "base_trainer_name", s.trainer_name),
        "version_num": getattr(s, "version_num", 1),
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
        # True when identical hash was previously approved — no LLM scan was run
        "fast_path": getattr(s, "fast_path", False),
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
    """Background task: run security scan, update submission, create ticket/violation if needed."""
    from app.services.trainer_security_service import (
        scan_trainer_security,
        create_admin_ticket,
        create_violation,
    )

    try:
        submission = await TrainerSubmission.get(submission_id)
        if not submission:
            return

        await _publish_sub_event(submission_id, {
            "status": "scanning",
            "message": "Running LLM security analysis…",
        })

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
            # ── Registration (best-effort — never blocks approval) ─────────────
            try:
                import hashlib as _hashlib
                import os as _os
                import shutil as _shutil
                from pathlib import Path as _Path
                from app.core.config import settings as _settings
                from app.models.trainer_registration import TrainerRegistration

                # Copy to permanent plugin dir so trainer survives restarts
                installed_path: str = submission.file_key
                try:
                    _dest_dir = _Path(_settings.TRAINER_PLUGIN_DIR) / "running" / (org_id or "system")
                    _dest_dir.mkdir(parents=True, exist_ok=True)
                    _dest_file = _dest_dir / f"{trainer_name}.py"
                    _shutil.copy2(submission.file_key, str(_dest_file))
                    installed_path = str(_dest_file)
                except Exception:
                    pass  # stay with tmp path

                # Module-based registration
                try:
                    from app.services.registry_service import scan_and_register_plugins as _scan
                    await _scan(owner_email=owner_email, org_id=org_id, only_file=_Path(installed_path))
                except Exception:
                    pass

                # Find or create the TrainerRegistration record
                reg = await TrainerRegistration.find_one(
                    {"plugin_file": installed_path, "org_id": org_id}
                )
                if not reg and installed_path != submission.file_key:
                    reg = await TrainerRegistration.find_one(
                        {"plugin_file": submission.file_key, "org_id": org_id}
                    )
                if not reg:
                    reg = await TrainerRegistration.find_one(
                        TrainerRegistration.name == trainer_name,
                        TrainerRegistration.org_id == org_id,
                    )
                if not reg:
                    _parsed = submission.parsed_metadata or {}
                    reg = TrainerRegistration(
                        name=trainer_name,
                        base_name=submission.base_trainer_name or trainer_name,
                        org_id=org_id,
                        owner_email=owner_email,
                        plugin_file=installed_path,
                        namespace=org_id if org_id else "system",
                        full_name=f"{org_id or 'system'}/{trainer_name}",
                        alias=f"{(owner_email or '').split('@')[0]}/{trainer_name}" if owner_email else trainer_name,
                        description=_parsed.get("Description", ""),
                        approval_status="approved",
                        is_active=True,
                        visibility="private" if org_id else "public",
                        plugin_version=max(0, submission.version_num - 1),
                        submission_id=submission_id,
                    )
                    await reg.insert()
                else:
                    approved_hash = ""
                    _fp = installed_path if _os.path.exists(installed_path) else submission.file_key
                    if _os.path.exists(_fp):
                        with open(_fp, "rb") as _fh:
                            approved_hash = _hashlib.sha256(_fh.read()).hexdigest()
                    await reg.set({
                        "approval_status": "approved",
                        "is_active": True,
                        "submission_id": submission_id,
                        "approved_content_hash": approved_hash,
                        "plugin_file": installed_path,
                        "rejection_reason": "",
                        "updated_at": now,
                    })
            except Exception as _install_exc:
                import structlog as _sl
                _sl.get_logger(__name__).warning(
                    "trainer_post_approval_install_failed",
                    submission_id=submission_id,
                    error=str(_install_exc),
                )
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

            # Notify admin(s) by email
            try:
                from app.core.config import settings
                from app.core.email import send_trainer_flagged_admin
                admin_email = getattr(settings, "DEFAULT_ADMIN_EMAIL", None) or getattr(settings, "SMTP_FROM", "")
                if admin_email:
                    await send_trainer_flagged_admin(
                        admin_email=admin_email,
                        trainer_name=trainer_name,
                        owner_email=owner_email,
                        org_id=org_id,
                        severity=severity,
                        summary=scan_result.get("summary", ""),
                        issues=scan_result.get("issues", []),
                        submission_id=submission_id,
                    )
            except Exception:
                pass

        await submission.set({
            "status": new_status,
            "llm_scan_result": scan_result,
            "llm_model_used": scan_result.get("model_used", ""),
            "updated_at": now,
        })

        await _publish_sub_event(submission_id, {
            "status": new_status,
            "llm_scan_result": scan_result,
            "summary": scan_result.get("summary", ""),
            "severity": scan_result.get("severity", "low"),
        })

    except Exception as exc:
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
                err_scan = {
                    "passed": False,
                    "severity": "low",
                    "summary": f"Automated scan failed — manual review required. Error: {str(exc)[:200]}",
                    "issues": ["Scan process encountered an error; contents require manual review"],
                }
                # Create an admin ticket so the submission is visible in the review queue
                try:
                    from app.services.trainer_security_service import create_admin_ticket as _cat
                    ticket_id = await _cat(
                        submission_id=submission_id,
                        trainer_name=trainer_name,
                        scan_result=err_scan,
                        owner_email=owner_email,
                        org_id=org_id,
                    )
                except Exception:
                    ticket_id = None

                _now2 = utc_now()
                await submission.set({
                    "status": "pending_admin",
                    "llm_scan_result": err_scan,
                    "admin_ticket_id": ticket_id,
                    "updated_at": _now2,
                })
                await _publish_sub_event(submission_id, {
                    "status": "pending_admin",
                    "llm_scan_result": err_scan,
                    "summary": err_scan["summary"],
                })
                # Unstick any TrainerRegistration left at pending_review for this trainer
                try:
                    from app.models.trainer_registration import TrainerRegistration as _TR
                    stuck = await _TR.find_one({
                        "name": trainer_name,
                        "org_id": org_id,
                        "approval_status": "pending_review",
                    })
                    if stuck:
                        await stuck.set({
                            "approval_status": "pending_admin",
                            "updated_at": _now2,
                        })
                except Exception:
                    pass
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
    """Upload a .py trainer file. Triggers background security scan."""
    if not file.filename or not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only .py files are accepted")

    file_bytes = await file.read()
    if len(file_bytes) > 500_000:  # 500 KB limit
        raise HTTPException(status_code=400, detail="File too large (max 500 KB)")

    source = file_bytes.decode("utf-8", errors="replace")

    from app.api.v1.editor import _security_check
    violation = _security_check(source)
    if violation:
        raise HTTPException(status_code=400, detail=f"Security violation: {violation}")

    # Parse metadata header
    import re, os
    from app.services.registry_service import _parse_metadata_header, _compute_file_hash
    metadata = _parse_metadata_header(source)

    raw_name = metadata.get("Name") or file.filename.replace(".py", "")
    org_id = current_user.org_id or ""
    namespace = org_id if org_id else "system"
    submission_hash = _compute_file_hash(org_id, file_bytes)

    # ── Version lineage ────────────────────────────────────────────────────────
    # Strip any _vN suffix the client injected to get the canonical base name.
    base_trainer_name = re.sub(r"_v\d+$", "", raw_name)

    # Reject duplicate: same hash is actively being scanned right now (prevents double-click race).
    # Only "scanning" blocks — pending_admin/flagged are stuck/error states that the user
    # should be able to supersede by re-uploading.
    dup = await TrainerSubmission.find_one({
        "org_id": org_id,
        "submission_hash": submission_hash,
        "status": "scanning",
    })
    if dup:
        raise HTTPException(status_code=409, detail="Identical trainer code is already being scanned. Please wait for the current scan to finish.")

    # Block only if the registration is actively in pending_review AND there is a live
    # "scanning" submission — meaning a scan is genuinely in progress.
    # pending_admin / flagged are error/review states the user can supersede.
    from app.models.trainer_registration import TrainerRegistration as TR2
    pending_reg = await TR2.find_one({
        "org_id": org_id,
        "base_name": base_trainer_name,
        "approval_status": "pending_review",
    })
    if pending_reg:
        # Only block if there's actually an active scanning submission for this trainer
        active_scan = await TrainerSubmission.find_one({
            "org_id": org_id,
            "base_trainer_name": base_trainer_name,
            "status": "scanning",
        })
        if active_scan:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"'{pending_reg.name}' is currently being scanned. "
                    "Wait for the scan to complete before submitting a new version."
                ),
            )
    # Also check in-flight TrainerSubmission records (covers the race window before registration is written).
    # Only "scanning" is truly in-flight — pending_admin/flagged can be superseded.
    in_flight_sub = await TrainerSubmission.find_one({
        "org_id": org_id,
        "base_trainer_name": base_trainer_name,
        "status": "scanning",
    })
    if in_flight_sub:
        raise HTTPException(
            status_code=409,
            detail=(
                f"'{in_flight_sub.trainer_name}' is currently being scanned. "
                "Wait for it to complete before submitting a new version."
            ),
        )

    # Server-side version: find the highest version already recorded for this base name + org.
    existing = await TrainerSubmission.find({
        "org_id": org_id,
        "base_trainer_name": base_trainer_name,
        "status": {"$ne": "rejected"},
    }).to_list()

    if not existing:
        # Also check TrainerRegistration in case submissions were pruned
        from app.models.trainer_registration import TrainerRegistration
        reg_existing = await TrainerRegistration.find({
            "org_id": org_id,
            "base_name": base_trainer_name,
        }).to_list()
    else:
        reg_existing = []

    max_version = 1  # base (no suffix) = v1
    for s in existing:
        m = re.search(r"_v(\d+)$", s.trainer_name)
        if m:
            max_version = max(max_version, int(m.group(1)))
        # a record with no suffix counts as v1 (already initialised)

    from app.models.trainer_registration import TrainerRegistration as TR
    for r in reg_existing:
        max_version = max(max_version, r.version_num)

    if existing or reg_existing:
        # There are prior submissions/registrations — bump to next version
        version_num = max_version + 1
        trainer_name = f"{base_trainer_name}_v{version_num}"
    else:
        # Truly the first submission for this trainer in this org
        version_num = 1
        trainer_name = base_trainer_name

    # ── Persist file ───────────────────────────────────────────────────────────
    plugin_dir_base = "/tmp/ml_uploads"
    os.makedirs(plugin_dir_base, exist_ok=True)
    file_key = f"{plugin_dir_base}/{org_id or 'system'}_{trainer_name}_{submission_hash[:8]}.py"
    with open(file_key, "wb") as f:
        f.write(file_bytes)

    now = utc_now()

    # Fast-path: if this exact hash was previously approved for this org, skip the scan
    # and auto-approve immediately — the code is unchanged and was already vetted.
    prev_approved = await TrainerSubmission.find_one({
        "org_id": org_id,
        "submission_hash": submission_hash,
        "status": "approved",
    })

    initial_status = "approved" if prev_approved else "scanning"
    prior_scan = prev_approved.llm_scan_result if prev_approved else {}
    is_fast_path = bool(prev_approved)

    submission = TrainerSubmission(
        org_id=org_id,
        owner_email=current_user.email,
        trainer_name=trainer_name,
        base_trainer_name=base_trainer_name,
        version_num=version_num,
        namespace=namespace,
        file_key=file_key,
        submission_hash=submission_hash,
        status=initial_status,
        parsed_metadata=metadata,
        llm_scan_result=prior_scan,
        llm_model_used=prev_approved.llm_model_used if prev_approved else "",
        fast_path=is_fast_path,
        submitted_at=now,
        updated_at=now,
    )
    await submission.insert()

    submission_id = str(submission.id)

    if prev_approved:
        # Code is identical to a previously approved submission — activate immediately,
        # no LLM scan needed.
        try:
            import hashlib as _hashlib2, os as _os2, shutil as _shutil2
            from pathlib import Path as _Path2
            from app.core.config import settings as _settings2
            from app.models.trainer_registration import TrainerRegistration

            fast_installed_path: str = file_key
            try:
                _fd = _Path2(_settings2.TRAINER_PLUGIN_DIR) / "running" / (org_id or "system")
                _fd.mkdir(parents=True, exist_ok=True)
                _ff = _fd / f"{trainer_name}.py"
                _shutil2.copy2(file_key, str(_ff))
                fast_installed_path = str(_ff)
            except Exception:
                pass

            try:
                from app.services.registry_service import scan_and_register_plugins as _scan2
                await _scan2(owner_email=current_user.email, org_id=org_id, only_file=_Path2(fast_installed_path))
            except Exception:
                pass

            reg = await TrainerRegistration.find_one(
                {"plugin_file": fast_installed_path, "org_id": org_id}
            )
            if not reg:
                reg = await TrainerRegistration.find_one(
                    TrainerRegistration.name == trainer_name,
                    TrainerRegistration.org_id == org_id,
                )
            if reg:
                approved_hash = ""
                _fp2 = fast_installed_path if _os2.path.exists(fast_installed_path) else file_key
                if _os2.path.exists(_fp2):
                    with open(_fp2, "rb") as _fh:
                        approved_hash = _hashlib2.sha256(_fh.read()).hexdigest()
                await reg.set({
                    "approval_status": "approved",
                    "is_active": True,
                    "submission_id": submission_id,
                    "approved_content_hash": approved_hash,
                    "plugin_file": fast_installed_path,
                    "rejection_reason": "",
                    "updated_at": now,
                })
        except Exception as _fast_exc:
            import structlog as _sl3
            _sl3.get_logger(__name__).warning(
                "trainer_fast_approval_install_failed",
                submission_id=submission_id,
                error=str(_fast_exc),
            )
        await _publish_sub_event(submission_id, {
            "status": "approved",
            "instant": True,
            "message": "Previously verified — instant approval",
            "llm_scan_result": prior_scan,
        })
    else:
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
# SSE — per-submission status stream
# ═══════════════════════════════════════════════════════════════

async def _submission_sse_generator(
    submission_id: str,
    org_id: str,
) -> AsyncIterator[dict]:
    """Yield SSE events for a submission until it reaches a terminal state."""

    # Immediately emit current state so late-connecting clients don't wait
    sub = await TrainerSubmission.get(submission_id)
    if not sub or sub.org_id != org_id:
        yield {"event": "error", "data": json.dumps({"detail": "Not found"})}
        return

    yield {"event": "status", "data": json.dumps({
        "status": sub.status,
        "llm_scan_result": sub.llm_scan_result,
        "summary": (sub.llm_scan_result or {}).get("summary", ""),
    })}

    if sub.status in _TERMINAL_STATUSES:
        yield {"event": "done", "data": json.dumps({"status": sub.status})}
        return

    # Subscribe to Redis for live updates
    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = r.pubsub()
    channel = _sub_channel(submission_id)
    await pubsub.subscribe(channel)

    try:
        deadline = asyncio.get_event_loop().time() + 300  # 5-min max
        while asyncio.get_event_loop().time() < deadline:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
            if msg and msg["type"] == "message":
                try:
                    payload = json.loads(msg["data"])
                    yield {"event": "status", "data": json.dumps(payload)}
                    if payload.get("status") in _TERMINAL_STATUSES:
                        yield {"event": "done", "data": json.dumps({"status": payload["status"]})}
                        return
                except Exception:
                    pass
            else:
                yield {"event": "ping", "data": "{}"}
            await asyncio.sleep(0.05)

        # Timeout — emit current DB state
        sub = await TrainerSubmission.get(submission_id)
        if sub:
            yield {"event": "status", "data": json.dumps({"status": sub.status})}
            yield {"event": "done", "data": json.dumps({"status": sub.status, "timeout": True})}

    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await r.aclose()


@router.get("/trainer-submissions/{submission_id}/stream")
async def stream_submission_status(
    submission_id: str,
    current_user: MLUser = Depends(get_current_user),
):
    """SSE stream for a single submission's scan progress.

    Connect with EventSource at:
      /api/v1/trainer-submissions/{id}/stream?token=<jwt>
    (or via Authorization header for non-browser clients)

    Events emitted:
      status  — { status, llm_scan_result?, summary?, severity?, message? }
      ping    — heartbeat (ignore)
      done    — terminal event; close the EventSource
      error   — access/not-found error
    """
    org_id = current_user.org_id or ""
    return EventSourceResponse(_submission_sse_generator(submission_id, org_id))


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


@router.get("/trainer-submissions/{submission_id}/source", dependencies=[RequireAdmin])
async def get_submission_source(submission_id: str):
    """Return the raw source code of a submission (admin only)."""
    import os
    submission = await TrainerSubmission.get(submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    file_key = submission.file_key or ""
    if not file_key or not os.path.exists(file_key):
        raise HTTPException(status_code=404, detail="Source file not found on disk")
    with open(file_key, "r", errors="replace") as f:
        source = f.read()

    scan = submission.llm_scan_result or {}
    ast_violations = scan.get("ast_violations") or []
    # Fallback: if scan used old "issues" list with line numbers, surface those too
    if not ast_violations:
        ast_violations = [
            i for i in scan.get("issues", [])
            if isinstance(i, dict) and i.get("line")
        ]

    return {
        "submission_id": submission_id,
        "trainer_name": submission.trainer_name,
        "source": source,
        "scan_result": scan,
        "ast_violations": ast_violations,
    }


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

    # Activate trainer registration + store approved_content_hash
    import os
    import hashlib
    from app.models.trainer_registration import TrainerRegistration
    reg = await TrainerRegistration.find_one(
        TrainerRegistration.name == submission.trainer_name,
        TrainerRegistration.org_id == submission.org_id,
    )
    approved_hash = ""
    if submission.file_key and os.path.exists(submission.file_key):
        with open(submission.file_key, "rb") as fh:
            approved_hash = hashlib.sha256(fh.read()).hexdigest()
    if reg:
        await reg.set({
            "approval_status": "approved",
            "is_active": True,
            "submission_id": submission_id,
            "approved_content_hash": approved_hash,
            "rejection_reason": "",
            "base_name": getattr(submission, "base_trainer_name", "") or reg.name,
            "version_num": getattr(submission, "version_num", 1),
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

    # Send approval email
    try:
        from app.core.email import send_trainer_approved
        if submission.owner_email:
            await send_trainer_approved(
                owner_email=submission.owner_email,
                trainer_name=submission.trainer_name,
                reviewed_by=current_user.email,
            )
    except Exception:
        pass

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

    # Send rejection email
    try:
        from app.core.email import send_trainer_rejected
        if submission.owner_email:
            await send_trainer_rejected(
                owner_email=submission.owner_email,
                trainer_name=submission.trainer_name,
                reason=body.reason,
                reviewed_by=current_user.email,
            )
    except Exception:
        pass

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


@router.get("/debug/security-llm", dependencies=[RequireAdmin])
async def debug_security_llm():
    """
    Test the LLM configuration used by the trainer security scanner.
    Returns which provider responded and what env vars are visible.
    Admin only.
    """
    import os
    from app.services.trainer_security_service import _call_ollama, _call_openai

    test_prompt = 'Respond with JSON only: {"ok": true, "msg": "security LLM test"}'

    result = {
        "env": {
            "OLLAMA_BASE_URL": os.environ.get("OLLAMA_BASE_URL", ""),
            "OLLAMA_SECURITY_MODEL": os.environ.get("OLLAMA_SECURITY_MODEL", ""),
            "OLLAMA_MODEL": os.environ.get("OLLAMA_MODEL", ""),
            "OPENAI_API_KEY_set": bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")),
            "OPENAI_MODEL": os.environ.get("OPENAI_MODEL", ""),
            "LLM_PROVIDER": os.environ.get("LLM_PROVIDER", ""),
            "LLM_MODEL": os.environ.get("LLM_MODEL", ""),
            "LLM_BASE_URL": os.environ.get("LLM_BASE_URL", ""),
        },
        "ollama": {"ok": False, "error": None, "model": None},
        "openai": {"ok": False, "error": None, "model": None},
    }

    try:
        raw, model = await _call_ollama(test_prompt)
        result["ollama"] = {"ok": True, "model": model, "response_preview": raw[:120]}
    except Exception as exc:
        result["ollama"]["error"] = str(exc)

    try:
        raw, model = await _call_openai(test_prompt)
        result["openai"] = {"ok": True, "model": model, "response_preview": raw[:120]}
    except Exception as exc:
        result["openai"]["error"] = str(exc)

    result["will_scan"] = result["ollama"]["ok"] or result["openai"]["ok"]
    return result


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
