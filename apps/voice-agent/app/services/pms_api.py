"""HTTP client for the PMS backend API.

Uses a service token (superadmin JWT) so it can query across orgs.
All methods return plain dicts — callers decide how to format for the LLM.
"""
import httpx
import structlog
from app.core.config import settings
from app.services import api_logger

logger = structlog.get_logger(__name__)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.PMS_API_URL,
            headers={"Authorization": f"Bearer {settings.PMS_SERVICE_TOKEN}"},
            timeout=10.0,
            event_hooks={
                "request": [api_logger.on_request],
                "response": [api_logger.on_response],
            },
        )
    return _client


async def close() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


# ── Tenant lookup ─────────────────────────────────────────────────────────────

async def find_tenant_by_phone(phone: str) -> dict | None:
    """Returns the first tenant matching the given phone number, or None."""
    try:
        client = _get_client()
        # Normalize: strip spaces, ensure +254 / 0 variants
        r = await client.get("/tenants", params={"phone": phone, "page_size": 1})
        r.raise_for_status()
        data = r.json()
        items = data.get("items") or data.get("tenants") or []
        return items[0] if items else None
    except Exception as exc:
        logger.warning("pms_api_error", action="find_tenant_by_phone", error=str(exc))
        return None


async def get_tenant(tenant_id: str) -> dict | None:
    try:
        r = await _get_client().get(f"/tenants/{tenant_id}")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="get_tenant", error=str(exc))
        return None


# ── Invoices ──────────────────────────────────────────────────────────────────

async def get_tenant_invoices(tenant_id: str, org_id: str = "", page_size: int = 5) -> list[dict]:
    try:
        params: dict = {"tenant_id": tenant_id, "page_size": page_size}
        if org_id:
            params["org_id"] = org_id
        r = await _get_client().get("/invoices", params=params)
        r.raise_for_status()
        data = r.json()
        return data.get("items", [])
    except Exception as exc:
        logger.warning("pms_api_error", action="get_tenant_invoices", error=str(exc))
        return []


async def get_invoice(invoice_id: str) -> dict | None:
    try:
        r = await _get_client().get(f"/invoices/{invoice_id}")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="get_invoice", error=str(exc))
        return None


# ── Tickets ───────────────────────────────────────────────────────────────────

async def get_tenant_tickets(
    tenant_id: str,
    org_id: str = "",
    status: str | None = None,
    page_size: int = 10,
) -> list[dict]:
    params: dict = {"tenant_id": tenant_id, "page_size": page_size}
    if org_id:
        params["org_id"] = org_id
    if status:
        params["status"] = status
    try:
        r = await _get_client().get("/tickets", params=params)
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as exc:
        logger.warning("pms_api_error", action="get_tenant_tickets", error=str(exc))
        return []


async def create_ticket(
    *,
    org_id: str,
    property_id: str,
    unit_id: str | None,
    tenant_id: str,
    category: str,
    title: str,
    description: str,
    priority: str = "normal",
) -> dict | None:
    payload: dict = {
        "org_id": org_id,
        "property_id": property_id,
        "tenant_id": tenant_id,
        "category": category,
        "title": title,
        "description": description,
        "priority": priority,
    }
    if unit_id:
        payload["unit_id"] = unit_id
    try:
        r = await _get_client().post("/tickets", json=payload)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="create_ticket", error=str(exc))
        return None


# ── Leases ────────────────────────────────────────────────────────────────────

async def get_tenant_lease(tenant_id: str, org_id: str = "") -> dict | None:
    try:
        params: dict = {"tenant_id": tenant_id, "status": "active", "page_size": 1}
        if org_id:
            params["org_id"] = org_id
        r = await _get_client().get("/leases", params=params)
        r.raise_for_status()
        items = r.json().get("items", [])
        return items[0] if items else None
    except Exception as exc:
        logger.warning("pms_api_error", action="get_tenant_lease", error=str(exc))
        return None


# ── Units ─────────────────────────────────────────────────────────────────────

async def get_unit(unit_id: str) -> dict | None:
    try:
        r = await _get_client().get(f"/units/{unit_id}")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="get_unit", error=str(exc))
        return None


async def get_property(property_id: str) -> dict | None:
    try:
        r = await _get_client().get(f"/properties/{property_id}")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="get_property", error=str(exc))
        return None


# ── Payment link ──────────────────────────────────────────────────────────────

async def send_payment_link(invoice_id: str, email: str) -> bool:
    """Triggers the 'send invoice' endpoint which emails the PDF + payment link."""
    try:
        r = await _get_client().post(f"/invoices/{invoice_id}/send")
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("pms_api_error", action="send_payment_link", error=str(exc))
        return False


async def get_utility_usage(tenant_id: str, org_id: str = "", months: int = 3) -> list[dict]:
    """Fetch recent invoices and extract metered utility line items with readings."""
    try:
        params: dict = {"tenant_id": tenant_id, "page_size": months}
        if org_id:
            params["org_id"] = org_id
        r = await _get_client().get("/invoices", params=params)
        r.raise_for_status()
        invoices = r.json().get("items", [])
        usage_records: list[dict] = []
        for inv in invoices:
            for item in inv.get("line_items", []):
                if item.get("type") == "metered_utility" and item.get("current_reading") is not None:
                    usage_records.append({
                        "billing_month": inv.get("billing_month"),
                        "utility_key": item.get("utility_key"),
                        "description": item.get("description"),
                        "previous_reading": item.get("previous_reading"),
                        "current_reading": item.get("current_reading"),
                        "consumption": (
                            round(item["current_reading"] - item["previous_reading"], 2)
                            if item.get("previous_reading") is not None else None
                        ),
                        "unit_price": item.get("unit_price"),
                        "amount": item.get("amount"),
                        "has_meter_image": bool(item.get("meter_image_url")),
                        # Tiered breakdown — list of {band, units, rate, subtotal} or None
                        "tier_breakdown": item.get("tier_breakdown"),
                    })
        return usage_records
    except Exception as exc:
        logger.warning("pms_api_error", action="get_utility_usage", error=str(exc))
        return []


# ── OTP ───────────────────────────────────────────────────────────────────────

async def request_otp(tenant_id: str) -> dict:
    """Ask PMS backend to generate and email a 6-digit OTP to the tenant."""
    try:
        r = await _get_client().post(f"/tenants/{tenant_id}/otp")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="request_otp", error=str(exc))
        return {"sent": False, "message": str(exc)}


async def verify_otp(tenant_id: str, code: str) -> bool:
    """Verify the OTP code with PMS backend. Returns True on valid code."""
    try:
        r = await _get_client().post(
            f"/tenants/{tenant_id}/otp/verify",
            json={"code": code},
        )
        r.raise_for_status()
        return r.json().get("valid", False)
    except Exception as exc:
        logger.warning("pms_api_error", action="verify_otp", error=str(exc))
        return False


# ── Mpesa STK Push ────────────────────────────────────────────────────────────

async def trigger_stk_push(
    tenant_id: str,
    amount: float,
    invoice_id: str = "",
) -> dict:
    """Trigger an Mpesa STK push to the tenant's phone via the PMS backend."""
    try:
        payload: dict = {"tenant_id": tenant_id, "amount": amount}
        if invoice_id:
            payload["invoice_id"] = invoice_id
        r = await _get_client().post("/payments/mpesa/voice-stk", json=payload)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="trigger_stk_push", error=str(exc))
        return {"initiated": False, "message": str(exc)}


async def check_stk_status(checkout_request_id: str) -> dict:
    """Poll the status of a pending STK push transaction."""
    try:
        r = await _get_client().get(f"/payments/mpesa/stk/{checkout_request_id}")
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("pms_api_error", action="check_stk_status", error=str(exc))
        return {"status": "unknown", "paid": False, "message": str(exc)}


# ── Payment history ───────────────────────────────────────────────────────────

async def get_lease_payments(lease_id: str, org_id: str = "") -> list[dict]:
    """Fetch recent payments for a lease."""
    try:
        r = await _get_client().get(f"/leases/{lease_id}/payments")
        r.raise_for_status()
        data = r.json()
        # list_payments returns PaymentSummary with .payments list
        return data.get("payments", data.get("items", []))
    except Exception as exc:
        logger.warning("pms_api_error", action="get_lease_payments", error=str(exc))
        return []


# ── Vacant units ─────────────────────────────────────────────────────────────

async def _list_org_properties(org_id: str) -> list[dict]:
    """Return all properties for an org (up to 50)."""
    try:
        params: dict = {"page_size": 50}
        if org_id:
            params["org_id"] = org_id
        r = await _get_client().get("/properties", params=params)
        r.raise_for_status()
        return r.json().get("items", [])
    except Exception as exc:
        logger.warning("pms_api_error", action="list_org_properties", error=str(exc))
        return []


async def get_vacant_units(org_id: str, property_id: str | None = None) -> list[dict]:
    """Fetch vacant units for an org via /properties/{id}/units?status=vacant."""
    try:
        # Determine which property IDs to query
        if property_id:
            prop_ids = [property_id]
        else:
            props = await _list_org_properties(org_id)
            prop_ids = [p["id"] for p in props if p.get("id")]

        all_units: list[dict] = []
        for pid in prop_ids:
            try:
                r = await _get_client().get(
                    f"/properties/{pid}/units",
                    params={"status": "vacant", "page_size": 20},
                )
                r.raise_for_status()
                items = r.json().get("items", [])
                # Attach property name/id for display
                prop_name = next(
                    (p.get("name", pid) for p in ([] if property_id else props) if p.get("id") == pid),
                    pid,
                )
                for u in items:
                    u.setdefault("property_name", prop_name)
                all_units.extend(items)
            except Exception:
                pass  # skip individual property failures

        return all_units
    except Exception as exc:
        logger.warning("pms_api_error", action="get_vacant_units", error=str(exc))
        return []


# ── Onboarding / Lease copy ───────────────────────────────────────────────────

async def get_tenant_onboarding(tenant_id: str, org_id: str = "") -> dict | None:
    """Fetch the latest onboarding record for a tenant."""
    try:
        params: dict = {"tenant_id": tenant_id, "page_size": 1}
        if org_id:
            params["org_id"] = org_id
        r = await _get_client().get("/onboardings", params=params)
        r.raise_for_status()
        items = r.json().get("items", [])
        return items[0] if items else None
    except Exception as exc:
        logger.warning("pms_api_error", action="get_tenant_onboarding", error=str(exc))
        return None


async def get_lease_pdf_url(onboarding_id: str) -> str | None:
    """Return a presigned S3 URL for the signed lease PDF."""
    try:
        r = await _get_client().get(f"/onboardings/{onboarding_id}/lease-pdf")
        r.raise_for_status()
        return r.json().get("url")
    except Exception as exc:
        logger.warning("pms_api_error", action="get_lease_pdf_url", error=str(exc))
        return None


async def get_invoice_pdf_url(invoice_id: str) -> str | None:
    """Return a presigned S3 URL for the invoice PDF (generates + caches on first call)."""
    try:
        r = await _get_client().get(f"/invoices/{invoice_id}/pdf-url")
        r.raise_for_status()
        return r.json().get("url")
    except Exception as exc:
        logger.warning("pms_api_error", action="get_invoice_pdf_url", error=str(exc))
        return None
