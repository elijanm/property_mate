"""
Resend email helper + preset HTML templates.
If RESEND_API_KEY is not configured, send_email() is a no-op (dev/test safety).
"""
import base64
from typing import Optional

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

_RESEND_URL = "https://api.resend.com/emails"


async def send_email(
    to: str,
    subject: str,
    html: str,
    attachments: Optional[list[dict]] = None,
) -> None:
    """
    Send an email via Resend.

    `attachments` is an optional list of dicts:
      [{"filename": "lease.pdf", "content": <bytes>}]
    Resend expects the content as a base64-encoded string.
    """
    if not settings.resend_api_key:
        logger.warning("email_skipped", reason="RESEND_API_KEY not configured", to=to, subject=subject)
        return

    payload: dict = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html,
    }

    if attachments:
        payload["attachments"] = [
            {
                "filename": att["filename"],
                "content": base64.b64encode(att["content"]).decode()
                if isinstance(att["content"], bytes)
                else att["content"],
            }
            for att in attachments
        ]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
        )
        if resp.status_code >= 400:
            logger.error("email_send_failed", status=resp.status_code, body=resp.text, to=to)
        else:
            logger.info("email_sent", to=to, subject=subject, status="success")


# ── Templates ────────────────────────────────────────────────────────────────

def _base(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body {{ font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f9fafb; margin:0; padding:0; }}
  .wrap {{ max-width:560px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb; }}
  .header {{ background:#1d4ed8; padding:28px 32px; }}
  .header h1 {{ color:#fff; margin:0; font-size:20px; font-weight:600; }}
  .body {{ padding:32px; color:#374151; font-size:15px; line-height:1.6; }}
  .body h2 {{ color:#111827; font-size:18px; margin-top:0; }}
  .btn {{ display:inline-block; margin-top:24px; padding:12px 28px; background:#1d4ed8; color:#fff !important;
          text-decoration:none; border-radius:8px; font-weight:600; font-size:15px; }}
  .footer {{ padding:20px 32px; border-top:1px solid #f3f4f6; color:#9ca3af; font-size:12px; }}
  .pill {{ display:inline-block; background:#dbeafe; color:#1e40af; padding:4px 10px; border-radius:20px; font-size:13px; font-weight:500; }}
</style></head>
<body><div class="wrap">
  <div class="header"><h1>PMS Portal</h1></div>
  <div class="body">{body}</div>
  <div class="footer">This email was sent automatically — please do not reply.</div>
</div></body></html>"""


def tenant_invite_html(invite_url: str, property_name: str, org_name: str) -> str:
    body = f"""
<h2>You've been invited to onboard</h2>
<p>Hello,</p>
<p><strong>{org_name}</strong> has invited you to complete your tenant onboarding for
<span class="pill">{property_name}</span>.</p>
<p>Click the button below to start the process. You'll be guided through uploading your ID,
taking a selfie, and filling in your details — it takes about 5 minutes.</p>
<a href="{invite_url}" class="btn">Start Onboarding →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{invite_url}" style="color:#1d4ed8;">{invite_url}</a>
</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  This link expires in 7 days.
</p>"""
    return _base("Tenant Onboarding Invitation", body)


def onboarding_complete_html(first_name: str, property_name: str) -> str:
    body = f"""
<h2>Onboarding complete, {first_name}!</h2>
<p>Thank you for completing your onboarding for <strong>{property_name}</strong>.</p>
<p>Your landlord / property manager will review your submission and get back to you shortly
with next steps regarding your lease agreement.</p>
<p>If you have any questions, please contact your property manager directly.</p>"""
    return _base("Onboarding Submitted", body)


def payment_confirmation_html(
    first_name: str, lease_ref: str, amount_paid: float, remaining: float, portal_url: str
) -> str:
    fmt = lambda n: f"KES {n:,.2f}"
    body = f"""
<h2>Payment received, {first_name}</h2>
<p>We've received a payment of <strong>{fmt(amount_paid)}</strong> for lease <span class="pill">{lease_ref}</span>.</p>
<p>You still have <strong>{fmt(remaining)}</strong> remaining to complete your move-in payment.</p>
<p>Please log in to your tenant portal to complete the payment and sign your lease.</p>
<a href="{portal_url}" class="btn">Go to Tenant Portal →</a>"""
    return _base("Payment Received", body)


def lease_signing_invite_html(first_name: str, lease_ref: str, portal_url: str) -> str:
    body = f"""
<h2>Your lease is ready to sign, {first_name}!</h2>
<p>Your full move-in payment has been received for lease <span class="pill">{lease_ref}</span>.</p>
<p>The next step is to review and sign your lease agreement. Once signed, your unit will be
officially activated and you'll receive your pre-move-in inspection link.</p>
<a href="{portal_url}" class="btn">Review &amp; Sign Lease →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  If you have any questions, please contact your property manager.
</p>"""
    return _base("Sign Your Lease", body)


def payment_reminder_html(first_name: str, lease_ref: str, remaining: float, portal_url: str, reminder_number: int) -> str:
    fmt = lambda n: f"KES {n:,.2f}"
    urgency = ["gentle", "friendly", "final"][min(reminder_number - 1, 2)]
    body = f"""
<h2>A {urgency} reminder, {first_name}</h2>
<p>Your lease <span class="pill">{lease_ref}</span> is awaiting a balance payment of
<strong>{fmt(remaining)}</strong> to complete your move-in.</p>
<p>Please log in to your tenant portal to complete the payment and get your unit activated.</p>
<a href="{portal_url}" class="btn">Complete Payment →</a>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  If you've already paid, please ignore this message — it may take a few hours to reflect.
</p>"""
    return _base("Complete Your Move-In Payment", body)


def lease_created_tenant_html(first_name: str, lease_ref: str, onboarding_url: str) -> str:
    body = f"""
<h2>Welcome, {first_name}! Let's get you onboarded.</h2>
<p>Your landlord has set up lease <span class="pill">{lease_ref}</span> for your new home.</p>
<p>Click the button below to complete your onboarding — upload your ID, review your lease agreement,
and add your signature. The whole process takes about 5 minutes.</p>
<a href="{onboarding_url}" class="btn">Start Onboarding →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  If you have any questions, please contact your property manager.
</p>"""
    return _base("Complete Your Tenant Onboarding", body)


def welcome_move_in_html(
    first_name: str, property_name: str, inspection_url: str, window_days: int
) -> str:
    body = f"""
<h2>Welcome home, {first_name}! 🎉</h2>
<p>Your lease is now fully activated and your unit at <strong>{property_name}</strong> is ready for you.</p>
<p>Before you move in, please complete a <strong>pre-move-in self-inspection</strong>. This protects
you by documenting any existing issues or defects in the unit so they cannot be charged to you later.</p>
<div style="background:#dbeafe;border-radius:8px;padding:16px 20px;margin:20px 0;">
  <p style="margin:0;color:#1e40af;font-weight:600;">📋 You have {window_days} days to complete the inspection</p>
  <p style="margin:6px 0 0;color:#3b82f6;font-size:13px;">
    Once the window closes, no new defects can be added. Complete it as soon as you move in.
  </p>
</div>
<a href="{inspection_url}" class="btn">Start Move-In Inspection →</a>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{inspection_url}" style="color:#1d4ed8;">{inspection_url}</a>
</p>"""
    return _base("Welcome — Complete Your Move-In Inspection", body)


def lease_signed_pdf_html(first_name: str, lease_ref: str, activated: bool) -> str:
    if activated:
        next_step = (
            "<p>Your lease is now <strong>fully active</strong>. Check your inbox for the "
            "move-in inspection link — complete it before you move in to protect yourself.</p>"
        )
    else:
        next_step = (
            "<p>Your lease will be activated once the outstanding move-in payment is received. "
            "Log in to your tenant portal to complete the payment.</p>"
        )
    body = f"""
<h2>Lease signed, {first_name}!</h2>
<p>Thank you for signing your lease agreement <span class="pill">{lease_ref}</span>.</p>
<p>A complete copy of your signed lease is attached to this email as a PDF. Please save it for your records.</p>
{next_step}
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  If you have any questions, please contact your property manager.
</p>"""
    return _base("Your Signed Lease Agreement", body)


def vendor_application_received_html(company_name: str, listing_title: str, org_name: str) -> str:
    body = f"""
<h2>Application received, {company_name}!</h2>
<p>Thank you for applying to <span class="pill">{listing_title}</span> with <strong>{org_name}</strong>.</p>
<p>Your application is under review. We will contact you with next steps within a few business days.</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  If you have questions, please contact the organisation directly.
</p>"""
    return _base("Vendor Application Received", body)


def vendor_approved_html(contact_name: str, onboarding_url: str, org_name: str) -> str:
    body = f"""
<h2>Your application has been approved, {contact_name}!</h2>
<p><strong>{org_name}</strong> has approved your vendor application.</p>
<p>Click the button below to complete your vendor onboarding. You'll be guided through your
company details, services, and compliance documents — it takes about 10 minutes.</p>
<a href="{onboarding_url}" class="btn">Complete Onboarding →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{onboarding_url}" style="color:#1d4ed8;">{onboarding_url}</a>
</p>"""
    return _base("Vendor Application Approved", body)


def vendor_rejected_html(contact_name: str, reason: str, org_name: str) -> str:
    body = f"""
<h2>Application update, {contact_name}</h2>
<p>Thank you for your interest in working with <strong>{org_name}</strong>.</p>
<p>After careful review, we are unable to proceed with your vendor application at this time.</p>
<div style="background:#fef2f2;border-radius:8px;padding:16px 20px;margin:20px 0;border-left:4px solid #ef4444;">
  <p style="margin:0;color:#7f1d1d;font-weight:600;">Reason:</p>
  <p style="margin:6px 0 0;color:#991b1b;">{reason}</p>
</div>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  If you believe this is an error, please contact the organisation directly.
</p>"""
    return _base("Vendor Application Status", body)


def vendor_contract_sent_html(
    contact_name: str, contract_url: str, contract_title: str, org_name: str
) -> str:
    body = f"""
<h2>Contract ready for review, {contact_name}</h2>
<p><strong>{org_name}</strong> has sent you a contract to review and sign:</p>
<p><span class="pill">{contract_title}</span></p>
<p>Please review the contract carefully and add your signature to proceed.</p>
<a href="{contract_url}" class="btn">Review &amp; Sign Contract →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{contract_url}" style="color:#1d4ed8;">{contract_url}</a>
</p>"""
    return _base("Contract Ready to Sign", body)


def vendor_contract_signed_html(admin_email: str, vendor_name: str, contract_title: str) -> str:
    body = f"""
<h2>Contract signed by vendor</h2>
<p><strong>{vendor_name}</strong> has signed the contract:</p>
<p><span class="pill">{contract_title}</span></p>
<p>Please log in to the admin portal to review and countersign the contract.</p>"""
    return _base("Vendor Contract Signed", body)


def vendor_setup_html(contact_name: str, setup_url: str, org_name: str) -> str:
    body = f"""
<h2>Set up your vendor account, {contact_name}!</h2>
<p>You've been approved to work with <strong>{org_name}</strong>.</p>
<p>Click the button below to set your password and activate your vendor portal account.</p>
<a href="{setup_url}" class="btn">Activate Your Account →</a>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  Or paste this link in your browser:<br>
  <a href="{setup_url}" style="color:#1d4ed8;">{setup_url}</a>
</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  This link expires in 7 days. If you need a new link, please contact the organisation.
</p>"""
    return _base("Set Up Your Vendor Account", body)


def vendor_ticket_assigned_html(
    contact_name: str, ticket_title: str, portal_url: str, org_name: str
) -> str:
    body = f"""
<h2>New ticket assigned, {contact_name}</h2>
<p><strong>{org_name}</strong> has assigned you a maintenance ticket:</p>
<p><span class="pill">{ticket_title}</span></p>
<p>Please log in to your vendor portal to view the details and update the ticket status.</p>
<a href="{portal_url}" class="btn">View Ticket →</a>"""
    return _base("New Ticket Assigned", body)


def signing_reminder_html(first_name: str, lease_ref: str, portal_url: str, reminder_number: int) -> str:
    urgency = ["gentle", "friendly", "final"][min(reminder_number - 1, 2)]
    body = f"""
<h2>A {urgency} reminder, {first_name}</h2>
<p>Your lease <span class="pill">{lease_ref}</span> is fully paid and waiting for your signature.</p>
<p>Your unit will only be activated once the lease is signed. It only takes a minute!</p>
<a href="{portal_url}" class="btn">Sign Your Lease →</a>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  If you've already signed, please ignore this message.
</p>"""
    return _base("Don't Forget to Sign Your Lease", body)


def shipment_driver_sign_html(
    driver_name: str, sign_url: str, reference_number: str, destination: str, org_name: str
) -> str:
    body = f"""
<h2>Action required, {driver_name}</h2>
<p><strong>{org_name}</strong> has prepared a shipment for you to sign before dispatch.</p>
<p>
  <strong>Reference:</strong> <span class="pill">{reference_number}</span><br>
  <strong>Destination:</strong> {destination}
</p>
<p>Please review the items listed and sign below to confirm you have received them for delivery.</p>
<a href="{sign_url}" class="btn">Sign as Driver →</a>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  This link is unique to you. Do not share it with others.
</p>"""
    return _base("Please Sign Your Waybill", body)


def ai_outreach_html(
    recipient_name: str,
    body_text: str,
    sender_org: str,
    sender_name: str,
) -> str:
    """
    Generic AI-composed outreach email rendered as professional HTML.
    `body_text` is plain text with newlines; we convert to paragraphs.
    """
    paragraphs = "".join(
        f"<p>{line}</p>" for line in body_text.split("\n") if line.strip()
    )
    body = f"""
<h2>Message from {sender_org}</h2>
<p>Dear {recipient_name},</p>
{paragraphs}
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  This message was sent on behalf of <strong>{sender_name}</strong> via the {sender_org} property management portal.
</p>"""
    return _base(f"Message from {sender_org}", body)


def signup_otp_html(first_name: str, otp: str, org_name: str) -> str:
    body = f"""
<h2>Welcome to PMS, {first_name}!</h2>
<p>Thank you for signing up for <strong>{org_name}</strong> on the PMS platform.</p>
<p>Use the verification code below to complete your registration:</p>
<div style="text-align:center;margin:32px 0;">
  <div style="display:inline-block;background:#dbeafe;border:2px solid #1d4ed8;border-radius:12px;
              padding:20px 40px;">
    <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1e40af;">{otp}</span>
  </div>
</div>
<p style="text-align:center;color:#6b7280;font-size:13px;">
  This code expires in <strong>10 minutes</strong>.
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  If you did not create an account on PMS, please ignore this email.
</p>"""
    return _base("Verify your PMS account", body)


def shipment_receiver_sign_html(
    receiver_name: str, sign_url: str, driver_name: str, reference_number: str, org_name: str
) -> str:
    body = f"""
<h2>Delivery incoming, {receiver_name}</h2>
<p><strong>{org_name}</strong> has dispatched a shipment to you (driven by <strong>{driver_name}</strong>).</p>
<p>
  <strong>Reference:</strong> <span class="pill">{reference_number}</span>
</p>
<p>Once you receive the items, please review them and sign to confirm delivery.</p>
<a href="{sign_url}" class="btn">Confirm Delivery →</a>
<p style="margin-top:20px;color:#6b7280;font-size:13px;">
  This link is unique to you. Do not share it with others.
</p>"""
    return _base("Confirm Your Delivery", body)


def framework_vendor_invite_html(
    contact_name: str,
    company_name: str,
    framework_name: str,
    client_name: str,
    org_name: str,
    portal_url: str = "",
    is_reinvite: bool = False,
) -> str:
    action = "re-invited" if is_reinvite else "invited"
    cta = f"""
<p style="text-align:center;margin:28px 0;">
  <a href="{portal_url}"
     style="display:inline-block;padding:14px 32px;background:#d97706;color:#fff;
            font-weight:700;font-size:15px;border-radius:8px;text-decoration:none;">
    {'Complete Your Profile →' if not is_reinvite else 'Set Up Your Portal →'}
  </a>
</p>
<p style="font-size:12px;color:#9ca3af;text-align:center;">
  Or copy this link: <span style="color:#d97706;">{portal_url}</span>
</p>""" if portal_url else ""

    body = f"""
<h2>{'Reminder: ' if is_reinvite else ''}You've been {action} as a Service Provider</h2>
<p>Dear <strong>{contact_name}</strong>,</p>
<p><strong>{org_name}</strong> has {action} <strong>{company_name}</strong> to provide
maintenance services under the following framework contract:</p>
<p style="margin:16px 0;padding:14px 18px;background:#f9fafb;border-left:3px solid #d97706;border-radius:6px;">
  <strong>Contract:</strong> {framework_name}<br>
  <strong>Client:</strong> {client_name}
</p>
<p>To get started, please complete your service provider profile — upload your ID, take a selfie,
and select the sites you'll be covering. You'll then receive your contractor badge.</p>
{cta}
<p style="margin-top:24px;color:#6b7280;font-size:13px;">
  If you believe you received this in error, please disregard this message.
</p>"""
    subject = f"{'Reminder: ' if is_reinvite else ''}Service Provider Invitation — {framework_name}"
    return _base(subject, body)


def framework_portal_otp_html(contact_name: str, otp_code: str) -> str:
    body = f"""
<h2>Your Sign-In Code</h2>
<p>Dear <strong>{contact_name}</strong>,</p>
<p>Use the code below to sign in to your Service Provider Portal. It expires in <strong>10 minutes</strong>.</p>
<p style="text-align:center;margin:32px 0;">
  <span style="display:inline-block;padding:18px 40px;background:#fef3c7;border:2px solid #d97706;
               border-radius:12px;font-size:36px;font-weight:800;letter-spacing:10px;color:#92400e;">
    {otp_code}
  </span>
</p>
<p style="font-size:13px;color:#6b7280;">
  If you didn't request this code, you can safely ignore this email.
</p>"""
    return _base("Service Provider Portal — Sign-In Code", body)
