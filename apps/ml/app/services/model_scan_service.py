"""Background security scan for pretrained model uploads.

Pipeline
────────
1. ClamAV virus scan on the whole archive/file
2. Static code analysis (regex + AST) on every file
3. LLM contextual scan on every .py file found inside a ZIP
4. If all checks pass → trigger deploy job
5. Publish real-time log events to Redis pub/sub throughout
"""
from __future__ import annotations

import asyncio
import io
import json
import zipfile
from typing import Any, AsyncIterator, Dict, Optional

import redis.asyncio as aioredis
import structlog

from app.core.config import settings
from app.models.model_scan_job import ModelScanJob
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_TERMINAL = {"passed", "failed", "deployed", "error"}


async def _audit_block(
    owner_email: str,
    scan_id: str,
    filename: str,
    reason: str,
    details: dict,
) -> None:
    """Write an audit-log entry whenever a model upload is blocked by security scan."""
    try:
        from app.services.audit_service import log_action
        await log_action(
            actor_email=owner_email,
            action="model_upload_blocked",
            resource_type="model_upload",
            resource_id=scan_id,
            details={"filename": filename, "reason": reason, **details},
        )
    except Exception as exc:
        logger.warning("audit_log_write_failed", scan_id=scan_id, error=str(exc))


def _scan_channel(scan_id: str) -> str:
    return f"ml:model_scan:{scan_id}"


# ── Redis pub/sub helpers ─────────────────────────────────────────────────────

async def _pub(scan_id: str, payload: dict) -> None:
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.publish(_scan_channel(scan_id), json.dumps(payload))
        await r.aclose()
    except Exception:
        pass


async def _log(scan_id: str, level: str, msg: str) -> None:
    """Publish a console log line to connected SSE clients."""
    await _pub(scan_id, {"type": "log", "level": level, "msg": msg})


# ── SSE generator (consumed by the stream endpoint) ──────────────────────────

async def model_scan_sse_generator(
    scan_id: str,
    org_id: str,
) -> AsyncIterator[dict]:
    scan_job = await ModelScanJob.get(scan_id)
    if not scan_job or scan_job.org_id != org_id:
        yield {"event": "error", "data": json.dumps({"detail": "Not found"})}
        return

    # If already terminal, emit final state immediately
    if scan_job.status in _TERMINAL:
        yield {"event": "status", "data": json.dumps({
            "status": scan_job.status,
            "job_id": scan_job.job_id,
            "model_name": scan_job.model_name,
        })}
        yield {"event": "done", "data": json.dumps({
            "status": scan_job.status,
            "job_id": scan_job.job_id,
            "model_name": scan_job.model_name,
        })}
        return

    r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe(_scan_channel(scan_id))

    try:
        deadline = asyncio.get_event_loop().time() + 300  # 5 min
        while asyncio.get_event_loop().time() < deadline:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
            if msg and msg["type"] == "message":
                try:
                    payload = json.loads(msg["data"])
                    event_type = payload.get("type", "status")
                    yield {"event": event_type, "data": json.dumps(payload)}
                    if event_type == "done":
                        return
                except Exception:
                    pass
            else:
                yield {"event": "ping", "data": "{}"}
            await asyncio.sleep(0.05)

        # Timeout — emit last DB state
        scan_job = await ModelScanJob.get(scan_id)
        if scan_job:
            yield {"event": "done", "data": json.dumps({"status": scan_job.status, "timeout": True})}
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(_scan_channel(scan_id))
        await r.aclose()


# ── Background scan task ──────────────────────────────────────────────────────

async def run_model_scan_background(
    scan_id: str,
    zip_bytes: Optional[bytes],
    file_bytes: Optional[bytes],
    script_bytes: Optional[bytes],
    filename: str,
    deploy_kwargs: Dict[str, Any],
    owner_email: str = "",
    org_id: str = "",
    # For ZIP conflict resolution (action already resolved by endpoint)
    zip_action: Optional[str] = None,
) -> None:
    """Fire-and-forget: scan → deploy on pass."""
    from app.services.file_scanner_service import scan_file

    scan_job = await ModelScanJob.get(scan_id)
    if not scan_job:
        return

    content = zip_bytes or file_bytes or b""
    is_zip = filename.lower().endswith(".zip")

    try:
        size_kb = len(content) / 1024
        await _log(scan_id, "info",
                   f"{'📦' if is_zip else '📄'} Received {filename} ({size_kb:.1f} KB)")

        # ── Step 1: ClamAV ───────────────────────────────────────────────────
        await _log(scan_id, "info", "🔍 ClamAV: scanning for known malware signatures…")
        scan_result = await scan_file(content, filename)

        if scan_result.clamav_result:
            await _log(scan_id, "error",
                       f"🚨 VIRUS DETECTED: {scan_result.clamav_result}")
        elif scan_result.clamav_result is None and not scan_result.code_threats:
            await _log(scan_id, "success", "✅ ClamAV: clean (no known viruses)")
        else:
            await _log(scan_id, "success", "✅ ClamAV: not available — skipping signature check")

        # ── Step 2: Static code analysis ────────────────────────────────────
        if scan_result.code_threats:
            await _log(scan_id, "warn", "⚠️  Static analysis found suspicious patterns:")
            for t in scan_result.code_threats:
                await _log(scan_id, "warn", f"   · {t}")

        if not scan_result.safe:
            rejection = "; ".join(scan_result.threats + scan_result.code_threats)
            await _log(scan_id, "error", f"❌ Upload BLOCKED — {rejection}")
            await _pub(scan_id, {"type": "status", "status": "failed"})
            now = utc_now()
            await scan_job.set({
                "status": "failed",
                "clamav_clean": scan_result.clamav_result is None,
                "virus_name": scan_result.clamav_result,
                "threats": scan_result.threats,
                "code_threats": scan_result.code_threats,
                "rejection_reason": rejection,
                "updated_at": now,
                "completed_at": now,
            })
            await _audit_block(
                owner_email=owner_email,
                scan_id=scan_id,
                filename=filename,
                reason="virus_or_static_threat",
                details={
                    "virus": scan_result.clamav_result,
                    "threats": scan_result.threats,
                    "code_threats": scan_result.code_threats,
                },
            )
            await _pub(scan_id, {"type": "done", "status": "failed"})
            return

        await _log(scan_id, "success", "✅ Static analysis: no suspicious patterns")
        await scan_job.set({
            "clamav_clean": True, "threats": [], "code_threats": [],
            "updated_at": utc_now(),
        })

        # ── Step 3: Python file security scan ───────────────────────────────
        py_scanned = 0
        blocking_issues: list = []

        if is_zip and zip_bytes:
            await _log(scan_id, "info", "🐍 Scanning Python files inside ZIP…")
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    py_names = [
                        n for n in zf.namelist()
                        if n.endswith(".py") and "__pycache__" not in n
                    ]
                    if not py_names:
                        await _log(scan_id, "info", "   No Python files found in ZIP")
                    for py_name in py_names:
                        try:
                            py_bytes = zf.read(py_name)
                        except Exception:
                            continue

                        kb = max(1, len(py_bytes) // 1024)
                        await _log(scan_id, "info", f"   📝 {py_name} ({kb} KB)")

                        # Quick static scan of this individual .py
                        py_static = await scan_file(py_bytes, py_name)
                        if not py_static.safe:
                            for t in py_static.code_threats:
                                await _log(scan_id, "warn", f"      ⚠ {t}")

                        # LLM contextual scan
                        try:
                            from app.services.trainer_security_service import scan_trainer_security
                            source = py_bytes.decode("utf-8", errors="replace")
                            result = await scan_trainer_security(
                                source=source,
                                org_id=org_id,
                                submission_id=scan_id,
                                trainer_name=py_name.replace("/", "_").replace(".py", ""),
                            )
                            passed_py = result.get("passed", True)
                            severity = result.get("severity", "none")
                            model_used = result.get("model_used", "")
                            issues = result.get("issues", [])

                            if not passed_py or severity in ("critical", "high", "malicious"):
                                for iss in issues:
                                    title = iss.get("title") or iss if isinstance(iss, str) else "Issue"
                                    detail = iss.get("detail", "") if isinstance(iss, dict) else ""
                                    await _log(scan_id, "error",
                                               f"      ❌ {title}" + (f": {detail}" if detail else ""))
                                blocking_issues.extend(issues)
                                await _log(scan_id, "error",
                                           f"      → {py_name} BLOCKED (severity: {severity})")
                            else:
                                model_note = f" [{model_used}]" if model_used else ""
                                await _log(scan_id, "success",
                                           f"      ✅ {py_name} OK (severity: {severity}){model_note}")
                        except Exception as llm_exc:
                            await _log(scan_id, "warn",
                                       f"      ⚠ LLM scan skipped for {py_name}: {llm_exc}")

                        py_scanned += 1
            except zipfile.BadZipFile:
                await _log(scan_id, "warn", "⚠️  ZIP appears malformed — skipping inner scan")

        elif file_bytes and filename.endswith(".py"):
            await _log(scan_id, "info", f"🐍 Running code analysis on {filename}…")
            try:
                from app.services.trainer_security_service import scan_trainer_security
                source = file_bytes.decode("utf-8", errors="replace")
                result = await scan_trainer_security(
                    source=source,
                    org_id=org_id,
                    submission_id=scan_id,
                    trainer_name=filename.replace(".py", ""),
                )
                passed_py = result.get("passed", True)
                severity = result.get("severity", "none")
                if not passed_py:
                    for iss in result.get("issues", []):
                        title = iss.get("title") or iss if isinstance(iss, str) else "Issue"
                        await _log(scan_id, "error", f"   ❌ {title}")
                    blocking_issues.extend(result.get("issues", []))
                else:
                    await _log(scan_id, "success",
                               f"   ✅ {filename} OK (severity: {severity})")
                py_scanned = 1
            except Exception as exc:
                await _log(scan_id, "warn", f"LLM scan skipped: {exc}")

        # Scan separately-uploaded inference script
        if script_bytes:
            await _log(scan_id, "info", "🐍 Scanning inference script…")
            try:
                from app.services.trainer_security_service import scan_trainer_security
                source = script_bytes.decode("utf-8", errors="replace")
                result = await scan_trainer_security(
                    source=source,
                    org_id=org_id,
                    submission_id=scan_id,
                    trainer_name="inference_script",
                )
                passed_py = result.get("passed", True)
                severity = result.get("severity", "none")
                if not passed_py:
                    for iss in result.get("issues", []):
                        title = iss.get("title") or iss if isinstance(iss, str) else "Issue"
                        await _log(scan_id, "error", f"   ❌ {title}")
                    blocking_issues.extend(result.get("issues", []))
                else:
                    await _log(scan_id, "success", f"   ✅ inference script OK (severity: {severity})")
                py_scanned += 1
            except Exception as exc:
                await _log(scan_id, "warn", f"   ⚠ Inference script scan skipped: {exc}")

        await scan_job.set({
            "python_files_scanned": py_scanned,
            "llm_issues": blocking_issues,
            "updated_at": utc_now(),
        })

        # ── Block if LLM found high-severity issues ───────────────────────
        if blocking_issues and any(
            (i.get("block") if isinstance(i, dict) else False)
            or (i.get("severity") in ("critical", "high", "malicious") if isinstance(i, dict) else False)
            for i in blocking_issues
        ):
            rejection = f"Malicious code detected in {py_scanned} Python file(s)"
            await _log(scan_id, "error", f"❌ Upload BLOCKED — {rejection}")
            await _pub(scan_id, {"type": "status", "status": "failed"})
            now = utc_now()
            await scan_job.set({
                "status": "failed", "rejection_reason": rejection,
                "updated_at": now, "completed_at": now,
            })
            await _audit_block(
                owner_email=owner_email,
                scan_id=scan_id,
                filename=filename,
                reason="malicious_python_code",
                details={
                    "python_files_scanned": py_scanned,
                    "issues": [
                        {k: i[k] for k in ("title", "severity", "detail") if k in i}
                        for i in blocking_issues if isinstance(i, dict)
                    ],
                },
            )
            await _pub(scan_id, {"type": "done", "status": "failed"})
            return

        # ── All clear ─────────────────────────────────────────────────────
        py_note = f"{py_scanned} Python file(s) scanned, " if py_scanned else ""
        await _log(scan_id, "success",
                   f"🎉 All security checks passed. {py_note}Queueing deploy job…")
        await _pub(scan_id, {"type": "status", "status": "deploying"})
        await scan_job.set({"status": "deploying", "updated_at": utc_now()})

        # ── Trigger deploy ────────────────────────────────────────────────
        try:
            job_id: str
            model_name: str = deploy_kwargs.get("name", filename)

            if zip_bytes:
                from app.services.zip_deploy_service import deploy_from_zip, ZipManifestError
                try:
                    job_id, model_name = await deploy_from_zip(
                        zip_bytes, owner_email=owner_email, org_id=org_id
                    )
                except ZipManifestError as exc:
                    await _log(scan_id, "error", f"❌ ZIP manifest error: {exc}")
                    await scan_job.set({
                        "status": "error", "rejection_reason": str(exc), "updated_at": utc_now()
                    })
                    await _pub(scan_id, {"type": "done", "status": "error"})
                    return
            else:
                from app.tasks.train_task import enqueue_pretrained_deploy
                job_id = await enqueue_pretrained_deploy(
                    deploy_kwargs,
                    file_bytes=file_bytes,
                    inference_script=script_bytes,
                    owner_email=owner_email,
                    org_id=org_id,
                )

            now = utc_now()
            await scan_job.set({
                "status": "deployed",
                "job_id": job_id,
                "model_name": model_name,
                "updated_at": now,
                "completed_at": now,
            })
            await _log(scan_id, "success", f"✅ Deploy job queued — Job ID: {job_id}")
            await _pub(scan_id, {
                "type": "done",
                "status": "deployed",
                "job_id": job_id,
                "model_name": model_name,
            })

        except Exception as deploy_exc:
            logger.error("model_scan_deploy_failed", scan_id=scan_id, error=str(deploy_exc))
            await _log(scan_id, "error", f"❌ Deploy failed: {deploy_exc}")
            await scan_job.set({
                "status": "error", "rejection_reason": str(deploy_exc), "updated_at": utc_now()
            })
            await _pub(scan_id, {"type": "done", "status": "error"})

    except Exception as exc:
        logger.error("model_scan_background_failed", scan_id=scan_id, error=str(exc))
        await _log(scan_id, "error", f"❌ Internal scan error: {exc}")
        try:
            await scan_job.set({
                "status": "error", "rejection_reason": str(exc), "updated_at": utc_now()
            })
        except Exception:
            pass
        await _pub(scan_id, {"type": "done", "status": "error"})
