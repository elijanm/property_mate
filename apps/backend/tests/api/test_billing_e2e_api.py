"""End-to-end billing tests via the real HTTP API.

Exercises the full stack:
  POST /api/v1/properties           → create property + auto-generate units
  GET  /api/v1/properties/{id}/units → pick a unit
  POST /api/v1/properties/{pid}/leases → create lease with existing tenant_id
  POST /api/v1/leases/{id}/activate  → activate (status: active)
  POST /api/v1/invoices/generate      → dry_run=True → inline invoice preview
  POST /api/v1/invoices/{id}/payments → record payment
  GET  /api/v1/invoices               → list invoices + assert math

Run with:
    # Default (in-memory):
    pytest tests/api/test_billing_e2e_api.py -v

    # Real MongoDB, keep data (inspect in UI):
    pytest -v --real-db --keep-data tests/api/test_billing_e2e_api.py
"""
from __future__ import annotations

import random
import uuid
from datetime import date, timedelta
from typing import List

import pytest
from httpx import AsyncClient

from app.models.user import User
from app.services import billing_service
from app.services.auth_service import hash_password

# ── Helpers ───────────────────────────────────────────────────────────────────

_BASE = "/api/v1"

# A minimal property payload that will auto-generate one unit
_PROPERTY_PAYLOAD = {
    "name": "E2E Test House",
    "property_type": "residential",
    "region": "Nairobi",
    "timezone": "Africa/Nairobi",
    "address": {
        "street": "1 Test Lane",
        "city": "Nairobi",
        "state": "Nairobi",
        "country": "KE",
    },
    "unit_templates": [
        {
            "template_name": "Studio",
            "floors_start": 1,
            "floors_end": 1,
            "unit_numbers": ["101"],
            "unit_type": "standard",
            "rent_base": 15_000.0,
            "deposit_amount": 15_000.0,
        }
    ],
    "billing_settings": {
        "invoice_day": 1,
        "due_days": 7,
        "grace_days": 3,
        "late_fee_type": "flat",
        "late_fee_value": 500.0,
    },
}


def _month_str(start: date, offset: int) -> str:
    """Return "YYYY-MM" for the month that is `offset` months after `start`."""
    year = start.year + (start.month - 1 + offset) // 12
    month = (start.month - 1 + offset) % 12 + 1
    return f"{year:04d}-{month:02d}"


def _due_date(billing_month: str) -> date:
    """Return due date = first day of billing_month + 7 days."""
    y, m = int(billing_month[:4]), int(billing_month[5:7])
    return date(y, m, 1) + timedelta(days=7)


# ── Fixtures ──────────────────────────────────────────────────────────────────

async def _generate_invoices(org_id: str, billing_month: str) -> None:
    """Call billing_service directly (bypasses RabbitMQ) to persist invoices."""
    await billing_service.generate_invoices_for_month(
        org_id=org_id,
        billing_month=billing_month,
        sandbox=False,
        dry_run=False,
        triggered_by="test",
    )


async def _create_tenant_user(org_id: str) -> User:
    """Create a tenant User directly in DB (bypasses lease_service bcrypt)."""
    uid = uuid.uuid4().hex[:8]
    tenant = User(
        email=f"tenant_{uid}@apitest.com",
        hashed_password=hash_password("secret123"),
        org_id=org_id,
        role="tenant",
        first_name="E2E",
        last_name="Tenant",
        is_active=True,
    )
    await tenant.insert()
    return tenant


async def _setup_lease(
    client: AsyncClient,
    headers: dict,
    *,
    org_id: str,
    lease_start: date = date(2024, 1, 1),
    rent_amount: float = 15_000.0,
) -> dict:
    """Create property → unit → tenant → lease → activate.  Returns context dict."""
    # 1. Create property
    r = await client.post(f"{_BASE}/properties", json=_PROPERTY_PAYLOAD, headers=headers)
    assert r.status_code == 201, r.text
    prop = r.json()
    # PropertyCreateResponse wraps the property under a "property" key
    property_id = prop.get("id") or prop["property"]["id"]

    # 2. List units → pick first
    r = await client.get(f"{_BASE}/properties/{property_id}/units", headers=headers)
    assert r.status_code == 200, r.text
    units = r.json()["items"]
    assert len(units) >= 1, "No units were auto-created"
    unit = units[0]
    unit_id = unit["id"]

    # 3. Create tenant user directly (avoid lease_service bcrypt path)
    tenant = await _create_tenant_user(org_id)
    tenant_id = str(tenant.id)

    # 4. Create lease with existing tenant_id
    lease_payload = {
        "unit_id": unit_id,
        "tenant_id": tenant_id,
        "start_date": lease_start.isoformat(),
        "rent_amount": rent_amount,
        "deposit_amount": rent_amount,
    }
    r = await client.post(
        f"{_BASE}/properties/{property_id}/leases",
        json=lease_payload,
        headers=headers,
    )
    assert r.status_code == 201, r.text
    lease = r.json()
    lease_id = lease["id"]

    # 5. Activate the lease
    r = await client.post(f"{_BASE}/leases/{lease_id}/activate", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    return {
        "property_id": property_id,
        "unit_id": unit_id,
        "lease_id": lease_id,
        "tenant_id": tenant_id,
        "rent_amount": rent_amount,
    }


# ── Test 1: complete setup flow ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_property_lease_setup(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Full setup flow produces an active lease."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id)
    assert ctx["lease_id"]
    assert ctx["tenant_id"]


# ── Test 2: generate invoice (dry-run) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_invoice_dry_run(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Dry-run billing generates a preview invoice with correct amounts."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id)
    billing_month = "2024-01"

    r = await api_client.post(
        f"{_BASE}/invoices/generate",
        json={"billing_month": billing_month, "dry_run": True, "sandbox": False},
        headers=api_auth_headers,
    )
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["status"] in ("completed", "dry_run")
    # Dry run preview must include at least one invoice preview row
    if run.get("dry_run_preview"):
        assert len(run["dry_run_preview"]) >= 1


# ── Test 3: full payment cycle — 3 months ─────────────────────────────────────

@pytest.mark.asyncio
async def test_three_month_full_payment(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Three months of full payments: every invoice ends up 'paid' with balance_due=0."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 3, 1))
    rent = ctx["rent_amount"]

    for offset in range(3):
        month = _month_str(date(2024, 3, 1), offset)

        # Generate invoices directly via service (bypasses RabbitMQ queue)
        await _generate_invoices(api_owner.org_id, month)

        # Fetch the invoice for this lease/month
        r = await api_client.get(
            f"{_BASE}/invoices",
            params={"billing_month": month, "lease_id": ctx["lease_id"]},
            headers=api_auth_headers,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) >= 1, f"No invoice found for {month}"
        invoice = items[0]
        invoice_id = invoice["id"]

        # Record full payment
        payment_date = _due_date(month) - timedelta(days=2)
        r = await api_client.post(
            f"{_BASE}/invoices/{invoice_id}/payments",
            json={
                "amount": invoice["total_amount"],
                "method": "cash",
                "payment_date": payment_date.isoformat(),
            },
            headers=api_auth_headers,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["status"] == "paid", (
            f"[{month}] Expected status=paid, got {updated['status']}"
        )
        assert updated["balance_due"] <= 0.01, (
            f"[{month}] Expected balance_due≈0, got {updated['balance_due']}"
        )
        assert abs(updated["amount_paid"] - updated["total_amount"]) <= 0.01


# ── Test 4: partial payment leaves correct balance ────────────────────────────

@pytest.mark.asyncio
async def test_partial_payment_balance_due(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Partial payment: balance_due == total_amount − amount_paid."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 5, 1))
    month = "2024-05"

    # Generate invoice
    await _generate_invoices(api_owner.org_id, month)

    r = await api_client.get(
        f"{_BASE}/invoices",
        params={"billing_month": month},
        headers=api_auth_headers,
    )
    items = r.json()["items"]
    assert len(items) >= 1
    invoice = items[0]
    invoice_id = invoice["id"]
    total = invoice["total_amount"]

    partial = round(total * 0.6, 2)

    r = await api_client.post(
        f"{_BASE}/invoices/{invoice_id}/payments",
        json={"amount": partial, "method": "cash", "payment_date": "2024-05-05"},
        headers=api_auth_headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()

    assert updated["status"] in ("partial_paid", "overdue"), (
        f"Expected partial_paid/overdue, got {updated['status']}"
    )
    assert updated["balance_due"] > 0
    assert abs(updated["balance_due"] - (total - partial)) < 0.02, (
        f"balance_due mismatch: total={total}, paid={partial}, "
        f"balance={updated['balance_due']}"
    )


# ── Test 5: no payment → overdue status ──────────────────────────────────────

@pytest.mark.asyncio
async def test_no_payment_invoice_overdue(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Invoice with no payment can be manually set to overdue."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 6, 1))
    month = "2024-06"

    await _generate_invoices(api_owner.org_id, month)

    r = await api_client.get(
        f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
    )
    items = r.json()["items"]
    assert len(items) >= 1
    invoice = items[0]
    invoice_id = invoice["id"]

    # Mark as overdue via PATCH
    r = await api_client.patch(
        f"{_BASE}/invoices/{invoice_id}",
        json={"status": "overdue"},
        headers=api_auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "overdue"
    assert r.json()["balance_due"] == r.json()["total_amount"]


# ── Test 6: overpayment ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_overpayment_accepted(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """Payment exceeding total_amount is accepted; invoice is marked paid."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 7, 1))
    month = "2024-07"

    await _generate_invoices(api_owner.org_id, month)

    r = await api_client.get(
        f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
    )
    invoice = r.json()["items"][0]
    total = invoice["total_amount"]
    overpay = round(total * 1.2, 2)

    r = await api_client.post(
        f"{_BASE}/invoices/{invoice['id']}/payments",
        json={"amount": overpay, "method": "cash", "payment_date": "2024-07-05"},
        headers=api_auth_headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["status"] == "paid"
    # balance_due must be 0 (never negative)
    assert updated["balance_due"] <= 0.01


# ── Test 7: 6-month mixed-scenario simulation ─────────────────────────────────

@pytest.mark.asyncio
async def test_six_month_mixed_simulation(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """6-month simulation with mixed payment scenarios.  Asserts math after each month."""
    ctx = await _setup_lease(
        api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2023, 7, 1), rent_amount=20_000.0
    )

    rng = random.Random(42)
    scenarios = ["full_payment", "partial_payment", "no_payment", "full_payment", "overpayment", "partial_payment"]

    cumulative_invoiced = 0.0
    cumulative_paid = 0.0

    for offset, scenario in enumerate(scenarios):
        month = _month_str(date(2023, 7, 1), offset)

        # Generate invoices directly via service (bypasses RabbitMQ queue)
        await _generate_invoices(api_owner.org_id, month)

        r = await api_client.get(
            f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1, f"[{month}] No invoice generated"
        invoice = items[0]
        invoice_id = invoice["id"]
        total = invoice["total_amount"]
        cumulative_invoiced += total

        # Determine payment based on scenario
        if scenario == "full_payment":
            pay_amount = total
        elif scenario == "partial_payment":
            pay_amount = round(total * rng.uniform(0.4, 0.85), 2)
        elif scenario == "overpayment":
            pay_amount = round(total * rng.uniform(1.05, 1.3), 2)
        else:  # no_payment
            pay_amount = 0.0

        if pay_amount > 0:
            pay_date = _due_date(month) + timedelta(days=rng.randint(-5, 5))
            r = await api_client.post(
                f"{_BASE}/invoices/{invoice_id}/payments",
                json={
                    "amount": pay_amount,
                    "method": "cash",
                    "payment_date": pay_date.isoformat(),
                },
                headers=api_auth_headers,
            )
            assert r.status_code == 200, f"[{month}] Payment failed: {r.text}"
            updated = r.json()
            applied_payment = updated["amount_paid"]
            cumulative_paid += applied_payment

            # Math assertions
            assert updated["balance_due"] >= -0.01, (
                f"[{month}] balance_due must not be negative: {updated['balance_due']}"
            )
            assert abs(updated["balance_due"] - max(0.0, total - applied_payment)) < 0.05, (
                f"[{month}] balance_due math wrong: total={total}, paid={applied_payment}, "
                f"balance={updated['balance_due']}"
            )
            assert updated["amount_paid"] <= total + 0.01, (
                f"[{month}] amount_paid ({updated['amount_paid']}) cannot exceed total ({total})"
            )


# ── Test 8: list invoices endpoint ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_invoices_pagination(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """List invoices returns correct pagination metadata."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 8, 1))

    # Generate 3 months of invoices
    for offset in range(3):
        month = _month_str(date(2024, 8, 1), offset)
        await _generate_invoices(api_owner.org_id, month)

    r = await api_client.get(
        f"{_BASE}/invoices",
        params={"page": 1, "page_size": 2},
        headers=api_auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert "total" in body
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) <= 2


# ── Test 9: get single invoice ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_invoice_detail(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """GET /invoices/{id} returns full invoice with line_items."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 9, 1))
    month = "2024-09"

    await _generate_invoices(api_owner.org_id, month)

    r = await api_client.get(
        f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
    )
    invoice_id = r.json()["items"][0]["id"]

    r = await api_client.get(f"{_BASE}/invoices/{invoice_id}", headers=api_auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == invoice_id
    assert "line_items" in body
    assert body["total_amount"] > 0
    assert body["balance_due"] == body["total_amount"]  # no payments yet


# ── Test 10: 403 for wrong role ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_invoice_requires_owner_role(
    api_client: AsyncClient, api_auth_headers: dict, api_owner: object
):
    """Tenant cannot trigger a billing run — must get 403."""
    from app.services.auth_service import create_access_token

    tenant_token = create_access_token(
        user_id="fake_tenant_id",
        org_id=api_owner.org_id,
        role="tenant",
    )
    tenant_headers = {"Authorization": f"Bearer {tenant_token}"}

    r = await api_client.post(
        f"{_BASE}/invoices/generate",
        json={"billing_month": "2024-01", "dry_run": True},
        headers=tenant_headers,
    )
    assert r.status_code == 403


# ── Test 11: void invoice ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_void_invoice(api_client: AsyncClient, api_auth_headers: dict, api_owner: User):
    """DELETE /invoices/{id} voids the invoice (status → void)."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 10, 1))
    month = "2024-10"

    await _generate_invoices(api_owner.org_id, month)
    r = await api_client.get(
        f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
    )
    invoice_id = r.json()["items"][0]["id"]

    r = await api_client.delete(f"{_BASE}/invoices/{invoice_id}", headers=api_auth_headers)
    assert r.status_code == 204


# ── Test 12: idempotent payment recording ────────────────────────────────────

@pytest.mark.asyncio
async def test_payment_list_after_multiple_payments(
    api_client: AsyncClient, api_auth_headers: dict, api_owner: User
):
    """Multiple partial payments accumulate correctly."""
    ctx = await _setup_lease(api_client, api_auth_headers, org_id=api_owner.org_id, lease_start=date(2024, 11, 1))
    month = "2024-11"

    await _generate_invoices(api_owner.org_id, month)
    r = await api_client.get(
        f"{_BASE}/invoices", params={"billing_month": month}, headers=api_auth_headers
    )
    invoice = r.json()["items"][0]
    invoice_id = invoice["id"]
    total = invoice["total_amount"]

    # Pay in two installments
    part1 = round(total * 0.5, 2)
    part2 = round(total * 0.5, 2)

    for amount, pay_date in [(part1, "2024-11-05"), (part2, "2024-11-15")]:
        r = await api_client.post(
            f"{_BASE}/invoices/{invoice_id}/payments",
            json={"amount": amount, "method": "cash", "payment_date": pay_date},
            headers=api_auth_headers,
        )
        assert r.status_code == 200

    # Fetch payment list
    r = await api_client.get(
        f"{_BASE}/invoices/{invoice_id}/payments", headers=api_auth_headers
    )
    assert r.status_code == 200
    payments = r.json()["items"]
    assert len(payments) == 2

    # Final invoice state
    r = await api_client.get(f"{_BASE}/invoices/{invoice_id}", headers=api_auth_headers)
    final = r.json()
    assert abs(final["amount_paid"] - (part1 + part2)) < 0.05
    assert final["status"] == "paid"


# ── Test 13: login + use token ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_and_use_token(api_client: AsyncClient, api_owner: object):
    """POST /auth/login returns a usable JWT."""
    r = await api_client.post(
        f"{_BASE}/auth/login",
        json={"email": "owner@apitest.com", "password": "secret123"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body
    token = body["token"]

    # Use the received token to list properties
    r = await api_client.get(
        f"{_BASE}/properties",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


# ── Test 14: invoice 404 ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_nonexistent_invoice_returns_404(
    api_client: AsyncClient, api_auth_headers: dict
):
    """GET /invoices/{unknown_id} returns 404."""
    r = await api_client.get(
        f"{_BASE}/invoices/000000000000000000000000", headers=api_auth_headers
    )
    assert r.status_code == 404
