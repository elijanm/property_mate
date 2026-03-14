"""Email helper for MLDock.io — uses Resend. No-op if RESEND_API_KEY is unset."""
import base64
from typing import Optional
import httpx
import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)
_RESEND_URL = "https://api.resend.com/emails"


async def send_email(to: str, subject: str, html: str) -> None:
    if not settings.RESEND_API_KEY:
        logger.warning("email_skipped", reason="RESEND_API_KEY not configured", to=to, subject=subject)
        return
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html},
        )
        if resp.status_code >= 400:
            logger.error("email_send_failed", status=resp.status_code, body=resp.text, to=to)
        else:
            logger.info("email_sent", to=to, subject=subject)


def _welcome_html(full_name: str, email: str, otp: str, token: str) -> str:
    name = full_name or email.split("@")[0]
    activate_url = f"{settings.APP_BASE_URL}/verify?token={token}"
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">

          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Welcome, {name}!</h2>
          <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
            Your MLDock.io account has been created. Verify your email to activate it.
          </p>

          <!-- OTP box -->
          <div style="background:#1a1a2e;border:1px solid #3730a3;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:12px;color:#818cf8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Your verification code</p>
            <div style="font-size:36px;font-weight:800;letter-spacing:0.3em;color:#ffffff;font-family:monospace;">{otp}</div>
            <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Expires in 30 minutes</p>
          </div>

          <!-- Divider -->
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
            <div style="flex:1;height:1px;background:#222222;"></div>
            <span style="font-size:12px;color:#4b5563;">or</span>
            <div style="flex:1;height:1px;background:#222222;"></div>
          </div>

          <!-- Button -->
          <div style="text-align:center;margin-bottom:28px;">
            <a href="{activate_url}" style="display:inline-block;background:#6366f1;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;text-decoration:none;">
              Activate account
            </a>
          </div>

          <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
            If you didn't create this account, you can safely ignore this email.<br>
            Link expires in 24 hours.
          </p>

        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#374151;">MLDock.io · Internal Platform</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""
