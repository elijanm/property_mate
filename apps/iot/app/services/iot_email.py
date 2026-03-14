"""
Email notifications for IoT events (SSH approvals, cert expiry, device alerts).
Uses same Resend API as PMS backend.
"""
from typing import List

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_ssh_approval_email(
    to_emails: List[str],
    device_name: str,
    requester_email: str,
    reason: str,
    duration_m: int,
    approve_url: str,
    deny_url: str,
    org_name: str = "Your Organisation",
) -> None:
    """Send SSH access approval request email with Approve/Deny buttons."""
    if not settings.resend_api_key:
        logger.warning("resend_not_configured_skipping_ssh_email")
        return

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1e293b;padding:24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:20px;">SSH Access Request</h1>
        <p style="color:#94a3b8;margin:8px 0 0 0;">{org_name}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr><td style="padding:8px 0;color:#64748b;width:140px;">Device</td><td style="padding:8px 0;font-weight:600;">{device_name}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Requested by</td><td style="padding:8px 0;">{requester_email}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Reason</td><td style="padding:8px 0;">{reason}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Duration</td><td style="padding:8px 0;">{duration_m} minutes</td></tr>
        </table>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <a href="{approve_url}" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Approve</a>
          <a href="{deny_url}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Deny</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:20px;">These links are single-use. Access will expire automatically after the approved duration.</p>
      </div>
    </div>
    """

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                _RESEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.email_from or "noreply@pms.app",
                    "to": to_emails,
                    "subject": f"SSH Access Request: {device_name}",
                    "html": html,
                },
            )
            resp.raise_for_status()
            logger.info("ssh_approval_email_sent", to=to_emails, device=device_name)
    except Exception as e:
        logger.error("ssh_approval_email_failed", error=str(e))
