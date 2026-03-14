from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from beanie import PydanticObjectId
from app.dependencies.auth import get_current_user, require_roles, CurrentUser
from app.models.ssh_access_request import SSHAccessRequest
from app.models.ssh_audit_log import SSHAuditLog
from app.services import ssh_service
from app.core.exceptions import ResourceNotFoundError
from app.core.config import settings

router = APIRouter(prefix="/ssh-requests", tags=["ssh-access"])


class SSHRequestCreate(BaseModel):
    target_type: str           # device | gateway
    target_id: str
    reason: str
    requested_duration_m: int = 60
    requester_tailscale_ip: Optional[str] = None


class ApproveRequest(BaseModel):
    approver_tailscale_ip: Optional[str] = None


class DenyRequest(BaseModel):
    reason: Optional[str] = None


def _resp(req: SSHAccessRequest) -> Dict[str, Any]:
    return {
        "id": str(req.id),
        "org_id": req.org_id,
        "target_type": req.target_type,
        "target_id": req.target_id,
        "target_tailscale_ip": req.target_tailscale_ip,
        "target_name": req.target_name,
        "requester_user_id": req.requester_user_id,
        "requester_email": req.requester_email,
        "reason": req.reason,
        "requested_duration_m": req.requested_duration_m,
        "status": req.status,
        "approved_by_user_id": req.approved_by_user_id,
        "denied_by_user_id": req.denied_by_user_id,
        "approved_at": req.approved_at.isoformat() if req.approved_at else None,
        "denied_at": req.denied_at.isoformat() if req.denied_at else None,
        "expires_at": req.expires_at.isoformat() if req.expires_at else None,
        "denial_reason": req.denial_reason,
        "created_at": req.created_at.isoformat(),
    }


@router.post("", status_code=201)
async def create_ssh_request(
    body: SSHRequestCreate,
    current_user: CurrentUser = Depends(get_current_user),
):
    req = await ssh_service.create_request(
        org_id=current_user.org_id,
        requester_user_id=current_user.user_id,
        requester_email=None,
        target_type=body.target_type,
        target_id=body.target_id,
        reason=body.reason,
        requested_duration_m=body.requested_duration_m,
        requester_tailscale_ip=body.requester_tailscale_ip,
    )
    return _resp(req)


@router.get("")
async def list_ssh_requests(
    current_user: CurrentUser = Depends(require_roles("owner", "superadmin")),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    filt: Dict[str, Any] = {"deleted_at": None}
    if current_user.role != "superadmin":
        filt["org_id"] = current_user.org_id
    if status:
        filt["status"] = status
    total = await SSHAccessRequest.find(filt).count()
    reqs = await SSHAccessRequest.find(filt).sort(-SSHAccessRequest.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
    return {"total": total, "items": [_resp(r) for r in reqs]}


@router.get("/{request_id}")
async def get_ssh_request(request_id: str, current_user: CurrentUser = Depends(get_current_user)):
    req = await SSHAccessRequest.find_one({"_id": PydanticObjectId(request_id), "deleted_at": None})
    if not req or (current_user.role != "superadmin" and req.org_id != current_user.org_id):
        raise ResourceNotFoundError("SSHAccessRequest", request_id)
    return _resp(req)


@router.post("/{request_id}/approve",
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def approve_request(
    request_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    body: Optional[ApproveRequest] = Body(None),
):
    req = await ssh_service.approve_request(
        request_id=request_id,
        org_id=current_user.org_id,
        approver_user_id=current_user.user_id,
        approver_tailscale_ip=body.approver_tailscale_ip if body else None,
    )
    return _resp(req)


@router.post("/{request_id}/deny",
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def deny_request(
    request_id: str,
    body: DenyRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    req = await ssh_service.deny_request(
        request_id=request_id,
        org_id=current_user.org_id,
        denier_user_id=current_user.user_id,
        reason=body.reason,
    )
    return _resp(req)


@router.post("/{request_id}/revoke",
             dependencies=[Depends(require_roles("owner", "superadmin"))])
async def revoke_request(request_id: str, current_user: CurrentUser = Depends(get_current_user)):
    req = await ssh_service.revoke_access(
        request_id=request_id,
        org_id=current_user.org_id,
        revoker_user_id=current_user.user_id,
    )
    return _resp(req)


@router.post("/public/ssh-decision/{token}", response_class=HTMLResponse)
async def ssh_decision_by_token(
    token: str,
    action: str = Query(..., pattern="^(approve|deny)$"),
    reason: Optional[str] = Query(None),
):
    """
    Public endpoint for email approve/deny links.
    No auth required — token is a one-use UUID stored on the SSHAccessRequest.
    """
    req = await SSHAccessRequest.find_one({
        "approval_token": token,
        "status": "pending",
        "deleted_at": None,
    })
    if not req:
        return HTMLResponse(
            "<h2>This link is invalid or has already been used.</h2>",
            status_code=400,
        )

    if action == "approve":
        await ssh_service.approve_request(
            request_id=str(req.id),
            org_id=req.org_id,
            approver_user_id="email_link",
            approver_tailscale_ip=None,
        )
        await req.set({"approval_token": None})
        return HTMLResponse("<h2>SSH access approved. The session will expire automatically.</h2>")
    else:
        await ssh_service.deny_request(
            request_id=str(req.id),
            org_id=req.org_id,
            denier_user_id="email_link",
            reason=reason or "Denied via email link",
        )
        await req.set({"approval_token": None})
        return HTMLResponse("<h2>SSH access denied.</h2>")
