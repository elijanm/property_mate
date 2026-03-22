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
    activate_url = f"{settings.FRONTEND_BASE_URL}/verify?token={token}"
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


def _staff_invite_html(inviter: str, org_name: str, email: str, temp_password: str, login_url: str) -> str:
    """Email sent to newly invited staff member."""
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">You've been invited!</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
            <strong style="color:#e5e7eb;">{inviter}</strong> has invited you to join the team on MLDock.io.
          </p>

          <div style="background:#1a1a2e;border:1px solid #3730a3;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 12px;font-size:12px;color:#818cf8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Your login credentials</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="font-size:12px;color:#6b7280;padding:4px 0;width:80px;">Email</td>
                <td style="font-size:13px;color:#e5e7eb;font-family:monospace;padding:4px 0;">{email}</td>
              </tr>
              <tr>
                <td style="font-size:12px;color:#6b7280;padding:4px 0;">Password</td>
                <td style="font-size:13px;color:#e5e7eb;font-family:monospace;padding:4px 0;font-weight:700;letter-spacing:0.05em;">{temp_password}</td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:11px;color:#6b7280;">Please change your password after first login.</p>
          </div>

          <div style="text-align:center;margin-bottom:24px;">
            <a href="{login_url}" style="display:inline-block;background:#6366f1;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;text-decoration:none;">
              Sign in to MLDock.io
            </a>
          </div>

          <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
            If you didn't expect this invitation, you can safely ignore this email.
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


def _annotator_invite_html(referrer_name: str, referral_link: str) -> str:
    """Referral invite email for annotators."""
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Earn rewards contributing data!</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
            <strong style="color:#e5e7eb;">{referrer_name}</strong> thinks you'd enjoy contributing to AI datasets and earning airtime rewards on MLDock.io.
          </p>

          <div style="background:#0f2f1f;border:1px solid #166534;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:22px;text-align:center;">🏆</p>
            <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#4ade80;text-align:center;">Earn points for every photo or data entry</p>
            <p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">Redeem for airtime directly to your phone</p>
          </div>

          <div style="text-align:center;margin-bottom:24px;">
            <a href="{referral_link}" style="display:inline-block;background:#6366f1;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;text-decoration:none;">
              Join now &amp; start earning
            </a>
          </div>

          <p style="margin:0;font-size:11px;color:#374151;text-align:center;word-break:break-all;">
            {referral_link}
          </p>
        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#374151;">MLDock.io · Data Contributor Programme</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _annotator_login_otp_html(name: str, otp: str, points: int) -> str:
    """OTP email for annotator account claim / passwordless login."""
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Your login code</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6;">
            Hi {name},<br><br>
            Use this one-time code to access your rewards portal{f" and claim your <strong style='color:#fbbf24;'>{points} points</strong>" if points > 0 else ""}.
          </p>

          <div style="background:#1a1a2e;border:1px solid #3730a3;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:12px;color:#818cf8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">One-time login code</p>
            <div style="font-size:36px;font-weight:800;letter-spacing:0.3em;color:#ffffff;font-family:monospace;">{otp}</div>
            <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Expires in 10 minutes</p>
          </div>

          <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
            If you didn't request this code, you can safely ignore this email.
          </p>
        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#374151;">MLDock.io · Data Contributor Programme</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _security_otp_html(name: str, otp: str, action: str = "change your password") -> str:
    """OTP for sensitive account actions (password change, etc.)."""
    display = name or "there"
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Security verification</h2>
          <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
            Hi {display},<br><br>
            Use the code below to {action}. This code expires in <strong style="color:#e5e7eb;">10 minutes</strong>.
          </p>

          <div style="background:#1a1a2e;border:1px solid #3730a3;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 8px;font-size:12px;color:#818cf8;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Your security code</p>
            <div style="font-size:36px;font-weight:800;letter-spacing:0.3em;color:#ffffff;font-family:monospace;">{otp}</div>
            <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Expires in 10 minutes</p>
          </div>

          <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
            If you didn't request this, please secure your account immediately by resetting your password.
          </p>
        </td></tr>

        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#374151;">MLDock.io · Security</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _password_reset_html(name: str, reset_url: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;background:#6366f1;display:inline-block;text-align:center;line-height:40px;font-size:20px;">🧠</div>
            <span style="font-size:20px;font-weight:700;color:#ffffff;">MLDock.io</span>
          </div>
        </td></tr>

        <tr><td style="background:#111111;border:1px solid #222222;border-radius:16px;padding:36px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">Reset your password</h2>
          <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
            Hi {name},<br><br>
            We received a request to reset the password for your MLDock.io account.
            Click the button below to choose a new password.
          </p>

          <div style="text-align:center;margin-bottom:28px;">
            <a href="{reset_url}" style="display:inline-block;background:#6366f1;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;text-decoration:none;">
              Reset password
            </a>
          </div>

          <p style="margin:0 0 16px;font-size:12px;color:#6b7280;text-align:center;">
            This link expires in <strong style="color:#9ca3af;">1 hour</strong>.
          </p>
          <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
            If you didn't request a password reset, you can safely ignore this email.<br>
            Your password will not be changed.
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


# ---------------------------------------------------------------------------
# Trainer approval / rejection / flagged email templates
# ---------------------------------------------------------------------------

def _trainer_base_html(header_color: str, icon: str, title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:{header_color};padding:32px 40px;text-align:center;">
          <div style="font-size:40px;">{icon}</div>
          <h1 style="margin:12px 0 0;color:#ffffff;font-size:22px;font-weight:700;">{title}</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          {body_html}
        </td></tr>
        <tr><td style="padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">MLDock.io · Internal Platform</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def trainer_approved_html(trainer_name: str, reviewed_by: str) -> str:
    body = f"""
      <p style="margin:0 0 16px;font-size:15px;color:#111827;">
        Your trainer <strong>{trainer_name}</strong> has been <strong style="color:#16a34a;">approved</strong>
        and is now active on the platform.
      </p>
      <p style="margin:0 0 16px;font-size:14px;color:#4b5563;">
        You can now run inference and training jobs using this trainer from the ML workspace.
      </p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Reviewed by: {reviewed_by}</p>
    """
    return _trainer_base_html("#16a34a", "✅", "Trainer Approved", body)


def trainer_rejected_html(trainer_name: str, reason: str, reviewed_by: str) -> str:
    body = f"""
      <p style="margin:0 0 16px;font-size:15px;color:#111827;">
        Your trainer <strong>{trainer_name}</strong> has been <strong style="color:#dc2626;">rejected</strong>.
      </p>
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin-bottom:16px;">
        <p style="margin:0;font-size:13px;color:#991b1b;"><strong>Reason:</strong> {reason}</p>
      </div>
      <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">
        Please review the feedback, make the necessary corrections, and resubmit your trainer for review.
      </p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Reviewed by: {reviewed_by}</p>
    """
    return _trainer_base_html("#dc2626", "❌", "Trainer Rejected", body)


def trainer_flagged_admin_html(
    trainer_name: str,
    owner_email: str,
    org_id: str,
    severity: str,
    summary: str,
    issues: list,
    submission_id: str,
) -> str:
    sev_color = {"high": "#dc2626", "medium": "#d97706", "low": "#2563eb"}.get(severity.lower(), "#6b7280")
    def _fmt_issue(i: Any) -> str:
        if isinstance(i, dict):
            line = f'<strong>Line {i["line"]}:</strong> ' if i.get("line") else ""
            src = f' <span style="color:#9ca3af;font-size:11px;">[{i["source"]}]</span>' if i.get("source") else ""
            return f'{line}[{i.get("rule","?")}] {i.get("detail") or i.get("message","")}{src}'
        return str(i)

    issues_html = "".join(
        f'<li style="margin-bottom:8px;font-size:13px;color:#374151;">{_fmt_issue(i)}</li>'
        for i in (issues or [])
    )
    body = f"""
      <p style="margin:0 0 16px;font-size:15px;color:#111827;">
        A trainer submission requires your review.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">Trainer</td>
            <td style="padding:6px 0;font-size:13px;color:#111827;"><strong>{trainer_name}</strong></td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Submitted by</td>
            <td style="padding:6px 0;font-size:13px;color:#111827;">{owner_email}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Org ID</td>
            <td style="padding:6px 0;font-size:13px;color:#111827;font-family:monospace;">{org_id}</td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Severity</td>
            <td style="padding:6px 0;"><span style="background:{sev_color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;">{severity.upper()}</span></td></tr>
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Submission ID</td>
            <td style="padding:6px 0;font-size:13px;color:#111827;font-family:monospace;">{submission_id}</td></tr>
      </table>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:16px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;">Security Scan Summary</p>
        <p style="margin:0;font-size:13px;color:#4b5563;">{summary}</p>
      </div>
      {'<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;">Flagged Issues</p><ul style="margin:0;padding-left:20px;">' + issues_html + '</ul>' if issues_html else ''}
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Log in to the admin panel to review the source code and approve or reject this submission.</p>
    """
    return _trainer_base_html("#d97706", "🚨", "Trainer Flagged for Review", body)


async def send_trainer_approved(owner_email: str, trainer_name: str, reviewed_by: str) -> None:
    await send_email(
        to=owner_email,
        subject=f"✅ Trainer '{trainer_name}' Approved",
        html=trainer_approved_html(trainer_name, reviewed_by),
    )


async def send_trainer_rejected(owner_email: str, trainer_name: str, reason: str, reviewed_by: str) -> None:
    await send_email(
        to=owner_email,
        subject=f"❌ Trainer '{trainer_name}' Rejected",
        html=trainer_rejected_html(trainer_name, reason, reviewed_by),
    )


async def send_trainer_flagged_admin(
    admin_email: str,
    trainer_name: str,
    owner_email: str,
    org_id: str,
    severity: str,
    summary: str,
    issues: list,
    submission_id: str,
) -> None:
    await send_email(
        to=admin_email,
        subject=f"🚨 Trainer Review Required: '{trainer_name}' [{severity.upper()}]",
        html=trainer_flagged_admin_html(
            trainer_name, owner_email, org_id, severity, summary, issues, submission_id
        ),
    )
