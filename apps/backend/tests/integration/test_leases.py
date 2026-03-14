"""Integration tests for lease creation, activation, and RBAC."""
import pytest
from httpx import AsyncClient
from datetime import date, timedelta

pytestmark = pytest.mark.asyncio

_PROPERTY_PAYLOAD = {
    "name": "Lease Test Property",
    "property_type": "residential",
    "region": "Nairobi",
    "timezone": "Africa/Nairobi",
    "address": {"street": "1 Lease St", "city": "Nairobi", "state": "Nairobi County"},
    "unit_templates": [
        {
            "template_name": "std",
            "floors_start": 1,
            "floors_end": 1,
            "units_per_floor": 2,
            "rent_base": 20000,
        }
    ],
    "billing_settings": {"invoice_day": 1, "due_days": 7, "grace_days": 3,
                         "late_fee_type": "flat", "late_fee_value": 500},
}


@pytest.fixture
async def setup(async_client: AsyncClient, owner_token: str):
    prop_resp = await async_client.post(
        "/api/v1/properties",
        json=_PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    prop = prop_resp.json()["property"]
    units_resp = await async_client.get(
        f"/api/v1/properties/{prop['id']}/units",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    units = units_resp.json()["items"]
    return prop, units


def _lease_payload(unit_id: str, start: str = "2026-04-01") -> dict:
    return {
        "unit_id": unit_id,
        "tenant_id": "tenant_test_001",
        "start_date": start,
        "end_date": "2027-03-31",
        "rent_amount": 20000,
        "deposit_amount": 20000,
    }


async def test_create_lease(async_client: AsyncClient, owner_token: str, setup):
    prop, units = setup
    unit_id = units[0]["id"]

    resp = await async_client.post(
        f"/api/v1/properties/{prop['id']}/leases",
        json=_lease_payload(unit_id),
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "draft"
    assert data["unit_id"] == unit_id


async def test_activate_lease(async_client: AsyncClient, owner_token: str, setup):
    prop, units = setup
    unit_id = units[0]["id"]

    # Reserve unit first
    await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_test_001"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    # Create lease
    create_resp = await async_client.post(
        f"/api/v1/properties/{prop['id']}/leases",
        json=_lease_payload(unit_id),
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    lease_id = create_resp.json()["id"]

    # Activate
    activate_resp = await async_client.post(
        f"/api/v1/leases/{lease_id}/activate",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert activate_resp.status_code == 200
    assert activate_resp.json()["status"] == "active"

    # Unit should now be occupied
    units_resp = await async_client.get(
        f"/api/v1/properties/{prop['id']}/units",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    occupied = [u for u in units_resp.json()["items"] if u["id"] == unit_id]
    assert occupied[0]["status"] == "occupied"


async def test_activate_already_active_lease_fails(
    async_client: AsyncClient, owner_token: str, setup
):
    prop, units = setup
    unit_id = units[1]["id"]

    # Reserve + create + activate
    await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_test_002"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    create_resp = await async_client.post(
        f"/api/v1/properties/{prop['id']}/leases",
        json=_lease_payload(unit_id),
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    lease_id = create_resp.json()["id"]
    await async_client.post(
        f"/api/v1/leases/{lease_id}/activate",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    # Try to activate again
    resp = await async_client.post(
        f"/api/v1/leases/{lease_id}/activate",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 400


async def test_tenant_cannot_create_lease(
    async_client: AsyncClient, tenant_token: str, setup
):
    prop, units = setup
    resp = await async_client.post(
        f"/api/v1/properties/{prop['id']}/leases",
        json=_lease_payload(units[0]["id"]),
        headers={"Authorization": f"Bearer {tenant_token}"},
    )
    assert resp.status_code == 403


async def test_list_leases_by_property(async_client: AsyncClient, owner_token: str, setup):
    prop, units = setup

    await async_client.post(
        f"/api/v1/properties/{prop['id']}/leases",
        json=_lease_payload(units[0]["id"]),
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    resp = await async_client.get(
        f"/api/v1/properties/{prop['id']}/leases",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1
