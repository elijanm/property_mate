"""LLM tool definitions (OpenAI function-calling format) and their executors.

Each executor:
  - Calls the PMS API
  - Returns a JSON-serialisable dict that becomes the tool result in the LLM context
  - Has side effects (email, ticket creation) with structured error handling
"""
import json
import re
import structlog
from app.core.database import get_db
from app.models.conversation import CallSessionDocument
from app.services import pms_api
from app.services import whatsapp_client as wa
from app.services.notification import notify_call_action, notify_caller_identified

logger = structlog.get_logger(__name__)


def _normalize_phone(phone: str) -> str:
    """Return last 9 digits for comparison — strips country code, spaces, dashes."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    return digits[-9:] if len(digits) >= 9 else digits


# ── Tool schemas (OpenAI function-calling format) ─────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_tenant",
            "description": "Find a tenant by their phone number. Call this as soon as you have the caller's number to personalise the conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "phone_number": {
                        "type": "string",
                        "description": "The caller's phone number in E.164 format, e.g. +254722123456",
                    }
                },
                "required": ["phone_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_summary",
            "description": "Get a tenant's financial summary: recent invoices, outstanding balance, and last payment date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string", "description": "The tenant's ID from lookup_tenant."}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_open_tickets",
            "description": "Get the tenant's open maintenance and service tickets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lease_details",
            "description": "Get the tenant's active lease information including unit, property, rent amount, and dates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_payment_link",
            "description": "Send an invoice payment link to the tenant's email. Use when tenant asks about paying rent or an outstanding invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {
                        "type": "string",
                        "description": "The tenant's ID.",
                    },
                    "invoice_id": {
                        "type": "string",
                        "description": "Specific invoice ID to send. Leave empty to send the most recent overdue invoice.",
                    },
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_maintenance_ticket",
            "description": "Create a new maintenance or service request ticket on behalf of the tenant.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "title": {
                        "type": "string",
                        "description": "Short summary of the issue, e.g. 'Burst pipe in kitchen'",
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed description of the problem as reported by the tenant.",
                    },
                    "category": {
                        "type": "string",
                        "enum": ["maintenance", "request", "complaint", "other"],
                        "description": "Ticket category.",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "normal", "high", "urgent"],
                        "description": "Urgency. Use 'urgent' only for safety risks or no water/power.",
                    },
                },
                "required": ["tenant_id", "title", "description", "category", "priority"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "transfer_to_human",
            "description": "Transfer the call to a human agent when the issue cannot be resolved by the AI, or when the caller explicitly asks to speak to a person.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Brief reason for transfer.",
                    }
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_methods",
            "description": "Get the available payment methods for a tenant's property (Mpesa paybill/till, bank transfer details). Use when guiding the tenant through paying their invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_payment_status",
            "description": "Check whether a specific invoice has been paid or if the balance has reduced since last check. Use after the tenant says they have paid to confirm.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {
                        "type": "string",
                        "description": "The invoice ID to check.",
                    }
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_utility_subscriptions",
            "description": "Get the utilities the tenant is subscribed to on their active lease — e.g. water, electricity, internet — with amounts and billing type.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_utility_usage",
            "description": "Get the tenant's recent metered utility usage history including meter readings, consumption, amounts charged, and for tiered utilities (e.g. water) a full breakdown of how the charge was computed band-by-band. Use when the tenant asks why their bill is high, wants usage details, or wants to understand how their water or electricity bill was calculated.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "months": {
                        "type": "integer",
                        "description": "Number of recent months to fetch (1-6, default 3).",
                    },
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_account_statement",
            "description": "Email the tenant's latest invoice / account statement PDF to their email. Use when tenant requests a statement, proof of payment demand, or detailed bill breakdown.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "invoice_id": {
                        "type": "string",
                        "description": "Specific invoice to send. Leave empty to send the most recent invoice.",
                    },
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_otp",
            "description": "Send a one-time verification code (OTP) to the tenant's registered email. Use before sharing sensitive information like meter proof images, full account details, or to authorise sensitive actions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "reason": {
                        "type": "string",
                        "description": "Why OTP is required, e.g. 'to send meter proof image'.",
                    },
                },
                "required": ["tenant_id", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_otp",
            "description": "Verify the one-time code the tenant reads back to you. Call after request_otp and the tenant says their code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "code": {
                        "type": "string",
                        "description": "The 6-digit code the tenant provided.",
                    },
                },
                "required": ["tenant_id", "code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "initiate_stk_push",
            "description": "Push an Mpesa STK payment prompt directly to the tenant's phone. The tenant will receive a PIN prompt on their handset. Use when tenant says they want to pay now and you have an invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "amount": {
                        "type": "number",
                        "description": "Amount to charge in KSh.",
                    },
                    "invoice_id": {
                        "type": "string",
                        "description": "Invoice ID to pay. Leave empty to use outstanding balance.",
                    },
                },
                "required": ["tenant_id", "amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_stk_status",
            "description": "Check whether the Mpesa STK push payment has been confirmed. Call this after initiate_stk_push once the tenant says they have entered their PIN.",
            "parameters": {
                "type": "object",
                "properties": {
                    "checkout_request_id": {
                        "type": "string",
                        "description": "The checkout_request_id returned by initiate_stk_push.",
                    }
                },
                "required": ["checkout_request_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_history",
            "description": "Get the tenant's recent payment history — dates, amounts, methods, and receipts. Use when tenant asks about past payments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "dispute_charge",
            "description": "Log a billing dispute on behalf of the tenant as a high-priority complaint ticket. Use when tenant says a charge is wrong, they were double-billed, or they want to contest an invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "description": {
                        "type": "string",
                        "description": "The tenant's exact complaint about the charge.",
                    },
                    "invoice_id": {
                        "type": "string",
                        "description": "Invoice ID being disputed, if known.",
                    },
                },
                "required": ["tenant_id", "description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_lease_copy",
            "description": "Email the tenant a copy of their signed lease PDF. Requires OTP verification first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"}
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_lease_renewal",
            "description": "Log a lease renewal request on behalf of the tenant. Creates a ticket for management to follow up.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_id": {"type": "string"},
                    "notes": {
                        "type": "string",
                        "description": "Any notes the tenant mentioned about their renewal preferences.",
                    },
                },
                "required": ["tenant_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_available_units",
            "description": "List vacant/available units for a prospect who is enquiring about renting. Use when the caller is not an existing tenant. Fetches all vacant units across all properties — no parameters needed.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_lead",
            "description": "Capture contact details for a prospect who is interested in renting. Creates a ticket for the leasing team to follow up.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Prospect's name.",
                    },
                    "phone": {
                        "type": "string",
                        "description": "Prospect's phone number.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "What the prospect is looking for — unit type, budget, move-in date, etc.",
                    },
                },
                "required": ["name", "phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_viewing",
            "description": "Log a viewing request for a prospect who wants to see a unit or property.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Prospect's name.",
                    },
                    "phone": {
                        "type": "string",
                        "description": "Prospect's phone number.",
                    },
                    "preferred_date": {
                        "type": "string",
                        "description": "When they want to view, e.g. 'Monday morning' or '2026-03-10'.",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Any preferences for unit type, budget, or specific unit mentioned.",
                    },
                },
                "required": ["name", "phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_whatsapp_history",
            "description": (
                "Retrieve recent WhatsApp messages exchanged with the caller's number. "
                "Use this to understand the prior WhatsApp conversation context before "
                "sending a message or reacting. Only call this if WhatsApp is available "
                "for the caller."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Number of recent messages to fetch (default 10, max 20).",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_via_whatsapp",
            "description": (
                "Send a message to the caller via WhatsApp. "
                "Use after the caller has agreed to receive info on WhatsApp. "
                "The agent will automatically show a composing indicator before sending. "
                "For plain info or OTP codes use type=text. "
                "For PDFs or documents use type=document with document_url and filename."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message_type": {
                        "type": "string",
                        "enum": ["text", "document"],
                        "description": "text for plain messages; document for PDFs or files.",
                    },
                    "text": {
                        "type": "string",
                        "description": "The message body (required for type=text).",
                    },
                    "document_url": {
                        "type": "string",
                        "description": "Publicly accessible URL of the document (required for type=document).",
                    },
                    "filename": {
                        "type": "string",
                        "description": "File name shown in WhatsApp e.g. 'invoice.pdf' (required for type=document).",
                    },
                    "caption": {
                        "type": "string",
                        "description": "Optional caption shown below a document.",
                    },
                },
                "required": ["message_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "acknowledge_whatsapp_message",
            "description": (
                "React with a thumbs-up and mark as read a WhatsApp message the caller sent. "
                "Call this after reading an incoming WhatsApp message (from get_whatsapp_history) "
                "to acknowledge it and close the unread indicator."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {
                        "type": "string",
                        "description": "The message_id from get_whatsapp_history.",
                    },
                    "chat": {
                        "type": "string",
                        "description": "The chat JID from get_whatsapp_history (e.g. '254700000000@s.whatsapp.net').",
                    },
                },
                "required": ["message_id", "chat"],
            },
        },
    },
]


# ── Executors ─────────────────────────────────────────────────────────────────

class ToolExecutor:
    """Stateful executor that keeps call context (org_id, call_control_id) across tool calls."""

    def __init__(
        self,
        call_control_id: str,
        org_id: str | None,
        caller_number: str,
        actions_taken: list[str],
    ) -> None:
        self.call_control_id = call_control_id
        self.org_id = org_id or ""
        self.caller_number = caller_number
        self.actions_taken = actions_taken   # shared reference — mutations tracked externally
        self._tenant_cache: dict | None = None
        # OTP gate: set when caller gives a different phone that belongs to a known tenant
        self._pending_lookup_tenant: dict | None = None
        self._pending_lookup_phone: str | None = None
        # WhatsApp enrichment — populated by check_whatsapp_availability()
        self._wa_available: bool = False   # True = caller's number is on WA
        self._wa_opted_in: bool = False    # True = caller agreed to receive via WA
        self._wa_instance_id: str | None = None  # connected WA instance for this org
        self._wa_token: str = ""           # wuzapi_token for this instance (direct calls)

    async def execute(self, function_name: str, arguments: dict) -> str:
        """Dispatch to the appropriate handler and return a JSON string result."""
        try:
            handler = getattr(self, f"_tool_{function_name}", None)
            if handler is None:
                return json.dumps({"error": f"Unknown tool: {function_name}"})
            result = await handler(**arguments)
            return json.dumps(result)
        except Exception as exc:
            logger.error("tool_execution_error", tool=function_name, error=str(exc), status="error")
            return json.dumps({"error": str(exc)})

    # ── Individual tool handlers ──────────────────────────────────────────────

    async def _tool_lookup_tenant(self, phone_number: str) -> dict:
        tenant = await pms_api.find_tenant_by_phone(phone_number)
        if not tenant:
            return {"found": False, "message": "No tenant record found for this phone number."}

        # Security gate: if the caller provides a phone that differs from their Caller ID
        # and that phone belongs to a registered tenant, require OTP before revealing data.
        normalized_queried = _normalize_phone(phone_number)
        normalized_caller = _normalize_phone(self.caller_number)
        is_browser_sandbox = self.caller_number in ("browser-sandbox", "")
        is_different_number = (
            not is_browser_sandbox
            and normalized_queried
            and normalized_caller
            and normalized_queried != normalized_caller
        )

        if is_different_number:
            tenant_id = tenant.get("id") or tenant.get("_id")
            # Store pending state so verify_otp can complete the lookup
            self._pending_lookup_phone = phone_number
            self._pending_lookup_tenant = tenant
            # Send OTP immediately to reduce friction
            otp_result = await pms_api.request_otp(tenant_id)
            masked_email = otp_result.get("masked_email", "") if otp_result.get("sent") else ""
            otp_note = (
                f"A 6-digit verification code has been sent to {masked_email}. "
                if masked_email else ""
            )
            return {
                "otp_required": True,
                "pending_tenant_id": tenant_id,
                "otp_sent": otp_result.get("sent", False),
                "masked_email": masked_email,
                "message": (
                    "An account was found for that number, but since it differs from your "
                    "Caller ID I need to verify your identity first. "
                    + otp_note
                    + "Please check your email and read me the 6-digit code."
                ),
            }

        return await self._complete_tenant_lookup(tenant)

    async def _complete_tenant_lookup(self, tenant: dict) -> dict:
        """Finalise a tenant lookup — update session, notify dashboard, return account summary."""
        self._tenant_cache = tenant
        tenant_org_id = tenant.get("org_id")
        if tenant_org_id:
            self.org_id = tenant_org_id

        tenant_id = tenant.get("id") or tenant.get("_id")
        tenant_name = tenant.get("name") or f"{tenant.get('first_name','')} {tenant.get('last_name','')}".strip()

        # Update the call session so the dashboard shows the identified caller in real time
        try:
            db = get_db()
            await db[CallSessionDocument.COLLECTION].update_one(
                {"call_control_id": self.call_control_id},
                {"$set": {"tenant_id": tenant_id, "tenant_name": tenant_name, "org_id": self.org_id}},
            )
            if self.org_id:
                await notify_caller_identified(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    caller_number=self.caller_number,
                    tenant_id=tenant_id,
                    tenant_name=tenant_name,
                    tenant_email=tenant.get("email"),
                )
        except Exception:
            pass  # non-critical — tool result still returned to LLM

        return {
            "found": True,
            "tenant_id": tenant_id,
            "name": tenant_name,
            "email": tenant.get("email"),
            "phone": tenant.get("phone"),
            "org_id": tenant_org_id,
        }

    async def _tool_get_account_summary(self, tenant_id: str) -> dict:
        invoices = await pms_api.get_tenant_invoices(tenant_id, org_id=self.org_id, page_size=5)
        if not invoices:
            return {"message": "No invoices found for this tenant."}

        overdue = [i for i in invoices if i.get("status") == "overdue"]
        unpaid = [i for i in invoices if i.get("balance_due", 0) > 0]
        total_balance = sum(i.get("balance_due", 0) for i in unpaid)
        latest = invoices[0]

        return {
            "total_outstanding": total_balance,
            "overdue_count": len(overdue),
            "latest_invoice": {
                "id": latest.get("id"),
                "reference_no": latest.get("reference_no"),
                "billing_month": latest.get("billing_month"),
                "total_amount": latest.get("total_amount"),
                "balance_due": latest.get("balance_due"),
                "status": latest.get("status"),
                "due_date": latest.get("due_date"),
            },
        }

    async def _tool_get_open_tickets(self, tenant_id: str) -> dict:
        tickets = await pms_api.get_tenant_tickets(tenant_id, org_id=self.org_id, page_size=10)
        open_tickets = [
            t for t in tickets
            if t.get("status") not in ("resolved", "closed", "cancelled")
        ]
        return {
            "count": len(open_tickets),
            "tickets": [
                {
                    "id": t.get("id"),
                    "reference": t.get("reference_number") or t.get("id", "")[:8],
                    "title": t.get("title"),
                    "category": t.get("category"),
                    "priority": t.get("priority"),
                    "status": t.get("status"),
                    "created_at": t.get("created_at"),
                }
                for t in open_tickets[:5]
            ],
        }

    async def _tool_get_lease_details(self, tenant_id: str) -> dict:
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        if not lease:
            return {"message": "No active lease found for this tenant."}
        return {
            "lease_id": lease.get("id"),
            "unit_label": lease.get("unit_label"),
            "property_name": lease.get("property_name"),
            "rent_amount": lease.get("rent_amount"),
            "start_date": lease.get("start_date"),
            "end_date": lease.get("end_date"),
            "status": lease.get("status"),
        }

    async def _tool_send_payment_link(self, tenant_id: str, invoice_id: str = "") -> dict:
        # Find the invoice to send
        if invoice_id:
            invoice = await pms_api.get_invoice(invoice_id)
        else:
            # Find most recent overdue or pending invoice
            invoices = await pms_api.get_tenant_invoices(tenant_id, org_id=self.org_id, page_size=5)
            payable = [i for i in invoices if i.get("balance_due", 0) > 0]
            invoice = payable[0] if payable else None

        if not invoice:
            return {"sent": False, "message": "No outstanding invoice found to send."}

        inv_id = invoice.get("id") or invoice_id
        email = invoice.get("tenant_email") or ""

        success = await pms_api.send_payment_link(inv_id, email)
        if success:
            ref = invoice.get("reference_no", inv_id)
            amount = invoice.get("balance_due") or invoice.get("total_amount")
            msg = f"Payment link for {ref} (KSh {amount:,.2f}) sent to {email or 'tenant email'}."
            self.actions_taken.append(f"Sent payment link for invoice {ref}")
            if self.org_id:
                await notify_call_action(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    action="payment_link_sent",
                    detail=msg,
                )
            return {"sent": True, "message": msg, "invoice_id": inv_id}
        return {"sent": False, "message": "Failed to send payment link. Please try again later."}

    async def _tool_create_maintenance_ticket(
        self,
        tenant_id: str,
        title: str,
        description: str,
        category: str,
        priority: str,
    ) -> dict:
        # We need property_id and unit_id from the tenant's lease
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        property_id = (lease or {}).get("property_id", "")
        unit_id = (lease or {}).get("unit_id")
        org_id_to_use = (lease or {}).get("org_id") or self.org_id

        # Prepend a system note so support staff know this was raised via the voice agent.
        # The tenant is the owner/requester; the system created it on their behalf during the call.
        system_note = (
            "📞 This ticket was created automatically by the Customer Voice Agent "
            "on behalf of the tenant during a phone call. "
            "The tenant is the owner and requester of this issue.\n\n"
        )
        full_description = system_note + description

        ticket = await pms_api.create_ticket(
            org_id=org_id_to_use,
            property_id=property_id,
            unit_id=unit_id,
            tenant_id=tenant_id,
            category=category,
            title=title,
            description=full_description,
            priority=priority,
        )
        if ticket:
            ref = ticket.get("reference_number") or ticket.get("id", "")[:8]
            msg = f"Ticket '{title}' created (ref: {ref})."
            self.actions_taken.append(f"Created {priority} ticket: {title} ({ref})")
            if self.org_id:
                await notify_call_action(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    action="ticket_created",
                    detail=msg,
                )
            return {
                "created": True,
                "ticket_id": ticket.get("id"),
                "reference_number": ref,
                "message": msg,
            }
        return {"created": False, "message": "Failed to create ticket. Our team will follow up manually."}

    async def _tool_transfer_to_human(self, reason: str) -> dict:
        self.actions_taken.append(f"Transferred to human: {reason}")
        if self.org_id:
            await notify_call_action(
                org_id=self.org_id,
                call_control_id=self.call_control_id,
                action="transfer_to_human",
                detail=f"Caller requested human agent. Reason: {reason}",
            )
        return {
            "transferred": True,
            "message": "Transferring you to a human agent now. Please hold.",
            "reason": reason,
        }

    async def _tool_get_payment_methods(self, tenant_id: str) -> dict:
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        if not lease:
            return {"message": "No active lease — cannot retrieve payment methods."}

        property_id = lease.get("property_id", "")
        prop = await pms_api.get_property(property_id) if property_id else None
        payment_config = (prop or {}).get("payment_config") or {}

        methods: list[dict] = []
        if payment_config.get("paybill_number"):
            account_ref = (
                lease.get("unit_label") or lease.get("unit_id", "")
                if payment_config.get("account_reference_type") == "unit_code"
                else payment_config.get("custom_account_reference") or tenant_id
            )
            methods.append({
                "type": "mpesa_paybill",
                "paybill": payment_config["paybill_number"],
                "account_reference": account_ref,
                "instructions": f"Go to M-Pesa → Lipa na M-Pesa → Paybill → Business No: {payment_config['paybill_number']}, Account No: {account_ref}",
            })
        if payment_config.get("till_number"):
            methods.append({
                "type": "mpesa_till",
                "till": payment_config["till_number"],
                "instructions": f"Go to M-Pesa → Lipa na M-Pesa → Buy Goods → Till No: {payment_config['till_number']}",
            })
        if payment_config.get("bank_account"):
            methods.append({
                "type": "bank_transfer",
                "bank_name": payment_config.get("bank_name"),
                "account_number": payment_config["bank_account"],
                "branch": payment_config.get("bank_branch"),
            })
        if payment_config.get("online_payment_enabled"):
            methods.append({
                "type": "online",
                "instructions": "A payment link can be sent to your email — ask the agent to send one.",
            })

        if not methods:
            return {"message": "No payment method configured for this property. Please contact management."}

        return {
            "property_name": lease.get("property_name"),
            "unit_label": lease.get("unit_label"),
            "payment_methods": methods,
        }

    async def _tool_check_payment_status(self, invoice_id: str) -> dict:
        invoice = await pms_api.get_invoice(invoice_id)
        if not invoice:
            return {"message": "Invoice not found."}
        status = invoice.get("status")
        balance = invoice.get("balance_due", 0)
        paid = invoice.get("amount_paid", 0)
        ref = invoice.get("reference_no", invoice_id[:8])
        if status == "paid" or balance <= 0:
            return {
                "paid": True,
                "status": status,
                "message": f"Invoice {ref} is fully paid. Thank you!",
                "amount_paid": paid,
                "balance_due": 0,
            }
        return {
            "paid": False,
            "status": status,
            "balance_due": balance,
            "amount_paid": paid,
            "message": f"Invoice {ref} still has KSh {balance:,.2f} outstanding (paid so far: KSh {paid:,.2f}).",
        }

    async def _tool_get_utility_subscriptions(self, tenant_id: str) -> dict:
        # Get lease for unit_id, then fetch the unit's utility config
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        if not lease:
            return {"message": "No active lease found — cannot retrieve utility subscriptions."}

        unit_id = lease.get("unit_id")
        unit = await pms_api.get_unit(unit_id) if unit_id else None

        # Also look at the latest invoice to get what was actually billed
        invoices = await pms_api.get_tenant_invoices(tenant_id, org_id=self.org_id, page_size=1)
        billed_utilities: list[dict] = []
        if invoices:
            for item in invoices[0].get("line_items", []):
                if item.get("type") in ("subscription_utility", "metered_utility"):
                    billed_utilities.append({
                        "utility": item.get("utility_key") or item.get("description"),
                        "type": "metered" if item.get("type") == "metered_utility" else "fixed",
                        "amount": item.get("amount"),
                        "unit_price": item.get("unit_price"),
                        "status": item.get("status"),
                    })

        return {
            "unit_label": lease.get("unit_label"),
            "property_name": lease.get("property_name"),
            "utilities": billed_utilities if billed_utilities else (
                [{"note": "No utility charges found on latest invoice."}]
            ),
        }

    async def _tool_get_utility_usage(self, tenant_id: str, months: int = 3) -> dict:
        months = max(1, min(months, 6))
        records = await pms_api.get_utility_usage(tenant_id, org_id=self.org_id, months=months)
        if not records:
            return {"message": "No metered utility usage data found for recent months."}

        # Group by utility_key for easy verbal summary
        by_utility: dict = {}
        for r in records:
            key = r.get("utility_key") or r.get("description") or "unknown"
            by_utility.setdefault(key, []).append(r)

        summary: dict = {}
        for key, readings in by_utility.items():
            consumptions = [r["consumption"] for r in readings if r.get("consumption") is not None]
            amounts = [r["amount"] for r in readings if r.get("amount") is not None]
            latest = readings[0]
            tier_breakdown = latest.get("tier_breakdown")

            # Build a verbal computation note so the AI can explain the bill clearly.
            computation_note: str | None = None
            if tier_breakdown:
                parts = []
                for band in tier_breakdown:
                    parts.append(
                        f"{band['units']:g} units × KSh {band['rate']:g} = KSh {band['subtotal']:g}"
                        f" ({band['band']})"
                    )
                total = latest.get("amount") or 0
                computation_note = "Tiered: " + " + ".join(parts) + f" = KSh {total:g} total"
            elif latest.get("unit_price") and latest.get("consumption") is not None:
                computation_note = (
                    f"Flat rate: {latest['consumption']:g} units × KSh {latest['unit_price']:g}"
                    f" = KSh {latest.get('amount', 0):g}"
                )

            summary[key] = {
                "months_available": len(readings),
                "latest_consumption": latest.get("consumption"),
                "avg_consumption": round(sum(consumptions) / len(consumptions), 2) if consumptions else None,
                "latest_amount": latest.get("amount"),
                "avg_amount": round(sum(amounts) / len(amounts), 2) if amounts else None,
                "latest_readings": {
                    "billing_month": latest.get("billing_month"),
                    "previous_reading": latest.get("previous_reading"),
                    "current_reading": latest.get("current_reading"),
                },
                "is_tiered": bool(tier_breakdown),
                "tier_breakdown": tier_breakdown,   # full band-by-band detail
                "computation_note": computation_note,
                "has_meter_proof": latest.get("has_meter_image", False),
                "history": [
                    {
                        "billing_month": r.get("billing_month"),
                        "consumption": r.get("consumption"),
                        "amount": r.get("amount"),
                    }
                    for r in readings[:3]
                ],
            }

        return {"utility_usage": summary}

    async def _tool_send_account_statement(self, tenant_id: str, invoice_id: str = "") -> dict:
        if invoice_id:
            invoice = await pms_api.get_invoice(invoice_id)
        else:
            invoices = await pms_api.get_tenant_invoices(tenant_id, org_id=self.org_id, page_size=1)
            invoice = invoices[0] if invoices else None

        if not invoice:
            return {"sent": False, "message": "No invoice found to send."}

        inv_id = invoice.get("id") or invoice_id
        email = invoice.get("tenant_email") or ""
        ref = invoice.get("reference_no", inv_id[:8] if inv_id else "")

        # Get real S3-backed presigned URL for the PDF
        pdf_url = await pms_api.get_invoice_pdf_url(inv_id)

        # Email send
        success = await pms_api.send_payment_link(inv_id, email)
        channels = []
        if success:
            channels.append("email")

        # WhatsApp delivery if instance is connected
        if pdf_url and self._wa_instance_id:
            wa_ok = await wa.send_document(
                self._wa_instance_id,
                self.caller_number,
                pdf_url,
                f"statement_{ref}.pdf",
                caption=f"Your account statement — {ref}.",
                wuzapi_token=self._wa_token,
            )
            if wa_ok:
                channels.append("WhatsApp")

        if channels:
            via = " and ".join(channels)
            msg = f"Account statement for {ref} sent via {via}."
            self.actions_taken.append(f"Sent account statement {ref} via {via}")
            if self.org_id:
                await notify_call_action(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    action="account_statement_sent",
                    detail=msg,
                )
            return {
                "sent": True,
                "message": msg,
                "invoice_id": inv_id,
                "pdf_url": pdf_url,
                "channels": channels,
            }
        return {"sent": False, "message": "Failed to send statement. Please try again later."}

    async def _tool_request_otp(self, tenant_id: str, reason: str) -> dict:
        result = await pms_api.request_otp(tenant_id)
        if result.get("sent"):
            masked = result.get("masked_email", "registered email")
            return {
                "otp_sent": True,
                "message": f"A 6-digit verification code has been sent to {masked}. Please ask the caller to check their email and read you the code.",
                "channel": result.get("channel", "email"),
                "masked_email": masked,
            }
        return {"otp_sent": False, "message": "Could not send verification code. " + result.get("message", "")}

    async def _tool_verify_otp(self, tenant_id: str, code: str) -> dict:
        valid = await pms_api.verify_otp(tenant_id, code.strip())
        if valid:
            self.actions_taken.append("Identity verified via OTP")
            # If we were waiting on a cross-number lookup, complete it now
            pending = self._pending_lookup_tenant
            if pending and (pending.get("id") == tenant_id or pending.get("_id") == tenant_id):
                self._pending_lookup_phone = None
                self._pending_lookup_tenant = None
                result = await self._complete_tenant_lookup(pending)
                result["verified"] = True
                result["message"] = "Identity verified. Here is your account information."
                return result
            return {"verified": True, "message": "Identity verified successfully. You may proceed."}
        return {"verified": False, "message": "The code is incorrect or has expired. Please try again or request a new code."}

    async def _tool_initiate_stk_push(
        self, tenant_id: str, amount: float, invoice_id: str = ""
    ) -> dict:
        result = await pms_api.trigger_stk_push(tenant_id, amount, invoice_id)
        if not result.get("initiated"):
            return {
                "initiated": False,
                "message": result.get("message", "Could not initiate STK push. Please try manual Mpesa payment."),
            }
        self._stk_checkout_id = result.get("checkout_request_id", "")
        self.actions_taken.append(f"Initiated Mpesa STK push for KSh {amount:,.0f}")
        if self.org_id:
            await notify_call_action(
                org_id=self.org_id,
                call_control_id=self.call_control_id,
                action="stk_push_initiated",
                detail=f"STK push sent for KSh {amount:,.0f}",
            )
        return {
            "initiated": True,
            "checkout_request_id": self._stk_checkout_id,
            "message": result.get(
                "customer_message",
                "M-Pesa prompt sent. Please check your phone and enter your PIN.",
            ),
        }

    async def _tool_check_stk_status(self, checkout_request_id: str) -> dict:
        import asyncio
        # Poll up to 5 times with 6-second intervals (30 seconds total)
        for attempt in range(5):
            result = await pms_api.check_stk_status(checkout_request_id)
            if result.get("paid"):
                self.actions_taken.append(
                    f"Mpesa payment confirmed — KSh {result.get('amount', '')} receipt {result.get('receipt', '')}"
                )
                if self.org_id:
                    await notify_call_action(
                        org_id=self.org_id,
                        call_control_id=self.call_control_id,
                        action="stk_payment_confirmed",
                        detail=result.get("message", "Payment confirmed"),
                    )
                return result
            if result.get("status") in ("failed", "cancelled"):
                return result
            if attempt < 4:
                await asyncio.sleep(6)
        return {
            "paid": False,
            "status": "pending",
            "message": "Payment not confirmed yet. If you entered your PIN, it may take a moment to process. Try again shortly.",
        }

    async def _tool_get_payment_history(self, tenant_id: str) -> dict:
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        if not lease:
            return {"message": "No active lease found."}

        lease_id = lease.get("id") or lease.get("lease_id", "")
        payments = await pms_api.get_lease_payments(lease_id, org_id=self.org_id)
        if not payments:
            return {"message": "No payment records found for this lease."}

        recent = payments[:6]
        return {
            "total_payments": len(payments),
            "recent_payments": [
                {
                    "date": p.get("payment_date") or p.get("created_at", "")[:10],
                    "amount": p.get("amount"),
                    "method": p.get("method"),
                    "status": p.get("status"),
                    "receipt": p.get("mpesa_receipt_no") or p.get("reference"),
                }
                for p in recent
            ],
        }

    async def _tool_dispute_charge(
        self, tenant_id: str, description: str, invoice_id: str = ""
    ) -> dict:
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        property_id = (lease or {}).get("property_id", "")
        unit_id = (lease or {}).get("unit_id")
        org_id_to_use = (lease or {}).get("org_id") or self.org_id

        inv_ref = f" (Invoice: {invoice_id})" if invoice_id else ""
        system_note = (
            "📞 BILLING DISPUTE raised via voice agent during a phone call.\n"
            "Tenant is contesting a charge — please review urgently.\n\n"
        )
        ticket = await pms_api.create_ticket(
            org_id=org_id_to_use,
            property_id=property_id,
            unit_id=unit_id,
            tenant_id=tenant_id,
            category="complaint",
            title=f"Billing dispute{inv_ref}",
            description=system_note + description,
            priority="high",
        )
        if ticket:
            msg = f"Dispute logged (ref: {ticket.get('id', '')[:8]}). Our billing team will review and respond within 48 hours."
            self.actions_taken.append(f"Logged billing dispute: {description[:50]}")
            if self.org_id:
                await notify_call_action(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    action="dispute_logged",
                    detail=msg,
                )
            return {"created": True, "ticket_id": ticket.get("id"), "message": msg}
        return {"created": False, "message": "Could not log dispute. Please escalate to a human agent."}

    async def _tool_request_lease_copy(self, tenant_id: str) -> dict:
        onboarding = await pms_api.get_tenant_onboarding(tenant_id, org_id=self.org_id)
        if not onboarding:
            return {"sent": False, "message": "No signed lease found for your account. Please contact management."}

        onboarding_id = onboarding.get("id") or onboarding.get("_id")
        if not onboarding_id:
            return {"sent": False, "message": "Lease record incomplete — please contact management."}

        pdf_url = await pms_api.get_lease_pdf_url(onboarding_id)
        if not pdf_url:
            return {"sent": False, "message": "Lease PDF not available. Please contact management for a copy."}

        channels = ["email"]  # backend endpoint already triggers email on lease-pdf fetch

        # WhatsApp delivery if instance is connected
        if self._wa_instance_id:
            wa_ok = await wa.send_document(
                self._wa_instance_id,
                self.caller_number,
                pdf_url,
                "signed_lease.pdf",
                caption="Here is your signed lease agreement.",
                wuzapi_token=self._wa_token,
            )
            if wa_ok:
                channels.append("WhatsApp")

        via = " and ".join(channels)
        msg = f"Your signed lease has been sent via {via}."
        self.actions_taken.append("Sent signed lease copy")
        if self.org_id:
            await notify_call_action(
                org_id=self.org_id,
                call_control_id=self.call_control_id,
                action="lease_copy_sent",
                detail=msg,
            )
        return {"sent": True, "message": msg, "channels": channels}

    async def _tool_request_lease_renewal(self, tenant_id: str, notes: str = "") -> dict:
        lease = await pms_api.get_tenant_lease(tenant_id, org_id=self.org_id)
        property_id = (lease or {}).get("property_id", "")
        unit_id = (lease or {}).get("unit_id")
        org_id_to_use = (lease or {}).get("org_id") or self.org_id
        end_date = (lease or {}).get("end_date", "")

        full_notes = f"End date: {end_date}\n" + (notes or "Tenant called to request lease renewal.")

        ticket = await pms_api.create_ticket(
            org_id=org_id_to_use,
            property_id=property_id,
            unit_id=unit_id,
            tenant_id=tenant_id,
            category="request",
            title="Lease renewal request",
            description=f"📞 Lease renewal request via voice agent.\n\n{full_notes}",
            priority="normal",
        )
        if ticket:
            msg = "Lease renewal request logged. Our team will contact you before your lease expires."
            self.actions_taken.append("Logged lease renewal request")
            return {"created": True, "ticket_id": ticket.get("id"), "message": msg}
        return {"created": False, "message": "Could not log renewal request. Please call back during business hours."}

    async def _tool_list_available_units(self, **_kwargs) -> dict:
        units = await pms_api.get_vacant_units(org_id=self.org_id)
        if not units:
            return {"message": "No vacant units currently available. Please call back to check availability."}

        unit_list = [
            {
                "property": u.get("property_name") or u.get("property_id", ""),
                "unit": u.get("label") or u.get("unit_code", ""),
                "type": u.get("unit_type") or u.get("type", ""),
                "rent": u.get("rent_amount"),
                "bedrooms": u.get("bedrooms"),
            }
            for u in units[:8]
        ]
        return {
            "available_count": len(units),
            "units": unit_list,
            "note": f"{len(units)} unit(s) available. I can arrange a viewing for any that interest you.",
        }

    async def _tool_capture_lead(
        self, name: str, phone: str, notes: str = ""
    ) -> dict:
        ticket = await pms_api.create_ticket(
            org_id=self.org_id or "",
            property_id="",
            unit_id=None,
            tenant_id="",
            category="other",
            title=f"New prospect enquiry — {name}",
            description=(
                f"📞 Prospect captured via voice agent.\n\n"
                f"Name: {name}\nPhone: {phone}\nCaller number: {self.caller_number}\n\n"
                + (notes or "No additional notes.")
            ),
            priority="normal",
        )
        if ticket:
            msg = f"Thank you, {name.split()[0]}. I've passed your details to our leasing team — they'll be in touch soon."
            self.actions_taken.append(f"Captured lead: {name}")
            return {"captured": True, "ticket_id": ticket.get("id"), "message": msg}
        return {"captured": False, "message": "Thank you for your interest. Please call back and ask to speak with the leasing team."}

    async def _tool_schedule_viewing(
        self, name: str, phone: str, preferred_date: str = "", notes: str = ""
    ) -> dict:
        ticket = await pms_api.create_ticket(
            org_id=self.org_id or "",
            property_id="",
            unit_id=None,
            tenant_id="",
            category="request",
            title=f"Viewing request — {name}",
            description=(
                f"📞 Viewing request via voice agent.\n\n"
                f"Name: {name}\nPhone: {phone}\nCaller number: {self.caller_number}\n"
                f"Preferred date/time: {preferred_date or 'Not specified'}\n\n"
                + (notes or "No specific preferences mentioned.")
            ),
            priority="normal",
        )
        if ticket:
            msg = (
                f"Viewing request logged for {name}. "
                f"Our team will call {phone} to confirm a time"
                + (f" around {preferred_date}" if preferred_date else "")
                + "."
            )
            self.actions_taken.append(f"Scheduled viewing for {name}")
            return {"created": True, "ticket_id": ticket.get("id"), "message": msg}
        return {"created": False, "message": "Could not log viewing request. Please call back to arrange."}

    # ── WhatsApp enrichment ───────────────────────────────────────────────────

    async def check_whatsapp_availability(self) -> None:
        """Background task: find a connected WA instance and check if the caller is on WA.

        Must be fire-and-forget (asyncio.create_task) at call start so it does not
        block the pipeline. Results are stored in _wa_available / _wa_instance_id.
        The prompt is refreshed with `whatsapp_available` AFTER this resolves.
        """
        if not self.org_id or not self.caller_number:
            return
        try:
            instance = await wa.find_connected_instance(self.org_id)
            if not instance:
                return
            self._wa_instance_id = instance["id"]
            self._wa_token = instance.get("wuzapi_token", "")
            self._wa_available = await wa.check_number_on_whatsapp(
                self._wa_instance_id, self.caller_number,
                wuzapi_token=self._wa_token,
            )
            logger.info(
                "wa_availability_checked",
                caller=self.caller_number,
                available=self._wa_available,
                instance_id=self._wa_instance_id,
            )
        except Exception as exc:
            logger.warning("wa_availability_check_failed", error=str(exc))

    async def _tool_get_whatsapp_history(self, limit: int = 10) -> dict:
        if not self._wa_instance_id:
            await self.check_whatsapp_availability()
        if not self._wa_instance_id:
            return {"available": False, "message": "WhatsApp not available for this caller."}
        limit = max(1, min(limit, 20))
        history = await wa.get_chat_history(
            self.org_id, self._wa_instance_id, self.caller_number, limit
        )
        if not history:
            return {"available": True, "messages": [], "message": "No prior WhatsApp messages found."}
        # Mark all unread incoming messages as read + react to the latest one
        incoming = [m for m in history if not m.get("from_me") and m.get("message_id")]
        if incoming:
            latest = incoming[0]
            await wa.acknowledge_incoming(
                self._wa_instance_id,
                latest["chat"],
                latest["message_id"],
                wuzapi_token=self._wa_token,
            )
        return {
            "available": True,
            "message_count": len(history),
            "messages": history,
        }

    async def _tool_send_via_whatsapp(
        self,
        message_type: str,
        text: str = "",
        document_url: str = "",
        filename: str = "",
        caption: str = "",
        **_kwargs,  # absorb any extra args the LLM may hallucinate (e.g. chat_id)
    ) -> dict:
        # If the background availability check hasn't finished yet, await it now.
        if not self._wa_instance_id:
            await self.check_whatsapp_availability()
        if not self._wa_instance_id:
            return {"sent": False, "message": "WhatsApp not connected for this property."}

        # Mark consent the first time agent sends via WA
        self._wa_opted_in = True

        if message_type == "document":
            if not document_url or not filename:
                return {"sent": False, "message": "document_url and filename are required for document messages."}
            success = await wa.send_document(
                self._wa_instance_id, self.caller_number, document_url, filename, caption,
                wuzapi_token=self._wa_token,
            )
        else:
            if not text:
                return {"sent": False, "message": "text is required for text messages."}
            success = await wa.send_text(
                self._wa_instance_id, self.caller_number, text,
                wuzapi_token=self._wa_token,
            )

        if success:
            desc = f"Sent WhatsApp {message_type} to {self.caller_number}"
            self.actions_taken.append(desc)
            if self.org_id:
                await notify_call_action(
                    org_id=self.org_id,
                    call_control_id=self.call_control_id,
                    action="whatsapp_message_sent",
                    detail=desc,
                )
            return {"sent": True, "message": f"Message sent via WhatsApp successfully."}
        return {"sent": False, "message": "Failed to send WhatsApp message — will fall back to email."}

    async def _tool_acknowledge_whatsapp_message(
        self, message_id: str, chat: str
    ) -> dict:
        if not self._wa_instance_id:
            return {"acknowledged": False}
        await wa.acknowledge_incoming(
            self._wa_instance_id, chat, message_id,
            wuzapi_token=self._wa_token,
        )
        return {"acknowledged": True}

    # ── Private state ─────────────────────────────────────────────────────────

    _stk_checkout_id: str = ""
