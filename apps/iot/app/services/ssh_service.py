"""
SSH access request lifecycle:
  1. User submits request (reason + duration) → status=pending
  2. Superadmin/owner approves → IoT calls Headscale to insert ACL rule → status=active
  3. Session start detected → SSHAuditLog created
  4. Expiry sweep (background task) OR manual revoke → remove ACL rule → status=expired/revoked
"""
from datetime import timedelta
from typing import Optional
from app.models.ssh_access_request import SSHAccessRequest
from app.models.ssh_audit_log import SSHAuditLog
from app.models.device import Device
from app.models.edge_gateway import EdgeGateway
from app.services import headscale_client
from app.core.exceptions import ResourceNotFoundError, ValidationError, ForbiddenError
from app.core.logging import get_logger
from app.core.metrics import IOT_SSH_GRANTS
from app.utils.datetime import utc_now

logger = get_logger(__name__)


async def create_request(
    org_id: str,
    requester_user_id: str,
    requester_email: Optional[str],
    target_type: str,
    target_id: str,
    reason: str,
    requested_duration_m: int,
    requester_tailscale_ip: Optional[str] = None,
    requester_ts_node_id: Optional[str] = None,
) -> SSHAccessRequest:
    from app.core.config import settings
    if requested_duration_m > settings.ssh_max_duration_m:
        raise ValidationError(f"Duration exceeds maximum of {settings.ssh_max_duration_m} minutes")

    # Resolve target
    target_tailscale_ip, target_name = await _resolve_target(org_id, target_type, target_id)
    if not target_tailscale_ip:
        raise ValidationError(f"Target {target_type} {target_id} has no Tailscale IP assigned")

    req = SSHAccessRequest(
        org_id=org_id,
        requester_user_id=requester_user_id,
        requester_email=requester_email,
        requester_tailscale_ip=requester_tailscale_ip,
        requester_tailscale_node_id=requester_ts_node_id,
        target_type=target_type,
        target_id=target_id,
        target_tailscale_ip=target_tailscale_ip,
        target_name=target_name,
        reason=reason,
        requested_duration_m=requested_duration_m,
        status="pending",
    )
    await req.insert()
    logger.info("ssh_request_created", resource_id=str(req.id), org_id=org_id, user_id=requester_user_id)

    # Generate approval token and send email notification
    import uuid as _uuid
    approval_token = str(_uuid.uuid4())
    await req.set({"approval_token": approval_token})

    # Build approve/deny URLs pointing at the public IoT service endpoint
    public_url = settings.iot_service_public_url.rstrip("/")
    approve_url = f"{public_url}/api/v1/ssh-requests/public/ssh-decision/{approval_token}?action=approve"
    deny_url = f"{public_url}/api/v1/ssh-requests/public/ssh-decision/{approval_token}?action=deny"

    try:
        from app.services.iot_email import send_ssh_approval_email
        notify_to = [requester_email] if requester_email else []
        if notify_to:
            await send_ssh_approval_email(
                to_emails=notify_to,
                device_name=target_name or target_id,
                requester_email=requester_email or requester_user_id,
                reason=reason,
                duration_m=requested_duration_m,
                approve_url=approve_url,
                deny_url=deny_url,
            )
    except Exception as e:
        logger.warning("ssh_approval_email_skipped", error=str(e))

    return req


async def approve_request(
    request_id: str,
    org_id: str,
    approver_user_id: str,
    approver_tailscale_ip: Optional[str],
) -> SSHAccessRequest:
    req = await _get_request(request_id, org_id)
    if req.status != "pending":
        raise ValidationError(f"Request is {req.status}, cannot approve")

    now = utc_now()
    expires_at = now + timedelta(minutes=req.requested_duration_m)

    # Use approver's Tailscale IP as the src, or requester's if provided
    src_ip = req.requester_tailscale_ip or approver_tailscale_ip
    if not src_ip:
        raise ValidationError("No Tailscale IP available for requester — cannot create ACL rule")

    # Insert ACL rule in Headscale
    comment = await headscale_client.add_ssh_acl_rule(
        src_ip=src_ip,
        dst_ip=req.target_tailscale_ip,
        ssh_request_id=request_id,
        expires_iso=expires_at.isoformat(),
        port=req.target_port,
    )

    await req.set({
        "status": "active",
        "approved_by_user_id": approver_user_id,
        "approved_at": now,
        "expires_at": expires_at,
        "headscale_acl_comment": comment,
        "updated_at": now,
    })

    IOT_SSH_GRANTS.labels(org_id=org_id).inc()
    logger.info("ssh_request_approved", resource_id=request_id, org_id=org_id, expires_at=expires_at.isoformat())
    return req


async def deny_request(
    request_id: str, org_id: str, denier_user_id: str, reason: Optional[str]
) -> SSHAccessRequest:
    req = await _get_request(request_id, org_id)
    if req.status != "pending":
        raise ValidationError(f"Request is {req.status}, cannot deny")
    now = utc_now()
    await req.set({"status": "denied", "denied_by_user_id": denier_user_id, "denied_at": now, "denial_reason": reason, "updated_at": now})
    return req


async def revoke_access(
    request_id: str, org_id: str, revoker_user_id: str
) -> SSHAccessRequest:
    req = await _get_request(request_id, org_id)
    if req.status not in ("active", "approved"):
        raise ValidationError(f"Request is {req.status}, cannot revoke")
    return await _do_revoke(req, revoker_user_id, reason="revoked")


async def expire_overdue_requests() -> int:
    """Background sweep — expire active requests past their expiry time."""
    now = utc_now()
    expired = await SSHAccessRequest.find({
        "status": "active",
        "expires_at": {"$lte": now},
        "deleted_at": None,
    }).to_list()

    count = 0
    for req in expired:
        try:
            await _do_revoke(req, revoker_user_id="system", reason="expired")
            count += 1
        except Exception as e:
            logger.error("ssh_expiry_failed", resource_id=str(req.id), error=str(e))
    return count


async def record_session_start(
    request_id: str, source_ip: str, destination_ip: str, user_id: str, user_email: Optional[str]
) -> SSHAuditLog:
    req = await SSHAccessRequest.find_one({"_id": request_id, "deleted_at": None})
    if not req:
        raise ResourceNotFoundError("SSHAccessRequest", request_id)
    log = SSHAuditLog(
        org_id=req.org_id,
        ssh_request_id=request_id,
        session_start=utc_now(),
        source_ip=source_ip,
        destination_ip=destination_ip,
        destination_port=req.target_port,
        user_id=user_id,
        user_email=user_email,
        status="active",
    )
    await log.insert()
    return log


async def record_session_end(audit_log_id: str, termination_reason: str = "normal") -> None:
    log = await SSHAuditLog.find_one({"_id": audit_log_id, "deleted_at": None})
    if not log:
        return
    end = utc_now()
    duration = int((end - log.session_start).total_seconds())
    await log.set({
        "session_end": end,
        "duration_seconds": duration,
        "status": "completed",
        "termination_reason": termination_reason,
        "updated_at": end,
    })


# ── Helpers ────────────────────────────────────────────────────────────────

async def _tailscale_ip_from_headscale(uid: str) -> Optional[str]:
    """Look up a Tailscale IP for a device/gateway by hostname (== device_uid/gateway_uid).
    Falls back to Headscale when the entity record has no tailscale_ip yet."""
    try:
        nodes = await headscale_client.list_nodes()
        for n in nodes:
            if n.get("name") == uid:
                ips = n.get("ipAddresses", [])
                return ips[0] if ips else None
    except Exception as e:
        logger.warning("headscale_lookup_failed", uid=uid, error=str(e))
    return None


async def _resolve_target(org_id: str, target_type: str, target_id: str):
    from beanie import PydanticObjectId
    if target_type == "gateway":
        gw = await EdgeGateway.find_one({"_id": PydanticObjectId(target_id), "org_id": org_id, "deleted_at": None})
        if not gw:
            raise ResourceNotFoundError("EdgeGateway", target_id)
        ip = gw.tailscale_ip or await _tailscale_ip_from_headscale(gw.gateway_uid)
        return ip, gw.name
    elif target_type == "device":
        dev = await Device.find_one({"_id": PydanticObjectId(target_id), "org_id": org_id, "deleted_at": None})
        if not dev:
            raise ResourceNotFoundError("Device", target_id)
        ip = dev.tailscale_ip or await _tailscale_ip_from_headscale(dev.device_uid)
        # Persist the discovered IP so future calls skip Headscale lookup
        if ip and not dev.tailscale_ip:
            await dev.set({"tailscale_ip": ip, "updated_at": utc_now()})
            logger.info("tailscale_ip_auto_synced", device_id=target_id, ip=ip)
        return ip, dev.name
    else:
        raise ValidationError(f"Unknown target_type: {target_type}")


async def _get_request(request_id: str, org_id: str) -> SSHAccessRequest:
    from beanie import PydanticObjectId
    req = await SSHAccessRequest.find_one({"_id": PydanticObjectId(request_id), "org_id": org_id, "deleted_at": None})
    if not req:
        raise ResourceNotFoundError("SSHAccessRequest", request_id)
    return req


async def _do_revoke(req: SSHAccessRequest, revoker_user_id: str, reason: str) -> SSHAccessRequest:
    # Remove Headscale ACL rule
    if req.headscale_acl_comment:
        try:
            await headscale_client.remove_ssh_acl_rule(req.headscale_acl_comment)
        except Exception as e:
            logger.error("headscale_acl_remove_failed", comment=req.headscale_acl_comment, error=str(e))

    now = utc_now()
    new_status = "expired" if reason == "expired" else "revoked"
    await req.set({
        "status": new_status,
        "revoked_by_user_id": revoker_user_id if reason != "expired" else None,
        "revoked_at": now,
        "updated_at": now,
    })

    IOT_SSH_GRANTS.labels(org_id=req.org_id).dec()
    logger.info("ssh_access_revoked", resource_id=str(req.id), reason=reason)

    # Terminate any active audit logs
    active_logs = await SSHAuditLog.find({"ssh_request_id": str(req.id), "status": "active"}).to_list()
    for log in active_logs:
        await record_session_end(str(log.id), termination_reason=reason)

    return req
