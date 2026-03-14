"""Integration tests for unit operations — config, reservation, locking, RBAC."""
import asyncio
import pytest
from httpx import AsyncClient


pytestmark = pytest.mark.asyncio

_PROPERTY_PAYLOAD = {
    "name": "Test Property Units",
    "property_type": "residential",
    "region": "Nairobi",
    "timezone": "Africa/Nairobi",
    "address": {"street": "1 Test St", "city": "Nairobi", "state": "Nairobi County"},
    "unit_templates": [
        {
            "template_name": "standard",
            "floors_start": 1,
            "floors_end": 1,
            "units_per_floor": 3,
            "rent_base": 10000,
        }
    ],
    "billing_settings": {"invoice_day": 1, "due_days": 7, "grace_days": 3,
                         "late_fee_type": "flat", "late_fee_value": 200},
}


@pytest.fixture
async def property_and_units(async_client: AsyncClient, owner_token: str):
    resp = await async_client.post(
        "/api/v1/properties",
        json=_PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 201
    prop = resp.json()["property"]

    units_resp = await async_client.get(
        f"/api/v1/properties/{prop['id']}/units",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    return prop, units_resp.json()["items"]


async def test_list_units(async_client: AsyncClient, owner_token: str, property_and_units):
    prop, units = property_and_units
    assert len(units) == 3
    assert all(u["status"] == "vacant" for u in units)


async def test_update_unit_rent(async_client: AsyncClient, owner_token: str, property_and_units):
    prop, units = property_and_units
    unit_id = units[0]["id"]

    resp = await async_client.patch(
        f"/api/v1/units/{unit_id}",
        json={"rent_base": 12000},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["rent_base"] == 12000


async def test_update_unit_occupied_without_lease_fails(
    async_client: AsyncClient, owner_token: str, property_and_units
):
    prop, units = property_and_units
    unit_id = units[0]["id"]

    resp = await async_client.patch(
        f"/api/v1/units/{unit_id}",
        json={"status": "occupied"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 400
    assert "occupied" in resp.json()["error"]["message"].lower()


async def test_reserve_unit(async_client: AsyncClient, owner_token: str, property_and_units):
    prop, units = property_and_units
    unit_id = units[0]["id"]

    resp = await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_001"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "reserved"


async def test_reserve_already_reserved_unit_conflicts(
    async_client: AsyncClient, owner_token: str, property_and_units
):
    prop, units = property_and_units
    unit_id = units[1]["id"]

    # First reservation
    r1 = await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_001"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r1.status_code == 200

    # Second reservation must conflict
    r2 = await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_002"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r2.status_code == 409


async def test_tenant_cannot_reserve_unit(
    async_client: AsyncClient, tenant_token: str, property_and_units
):
    prop, units = property_and_units
    unit_id = units[2]["id"]

    resp = await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_003"},
        headers={"Authorization": f"Bearer {tenant_token}"},
    )
    assert resp.status_code == 403


async def test_release_reservation(async_client: AsyncClient, owner_token: str, property_and_units):
    prop, units = property_and_units
    unit_id = units[2]["id"]

    await async_client.post(
        f"/api/v1/units/{unit_id}/reserve",
        json={"tenant_id": "tenant_004"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    release_resp = await async_client.post(
        f"/api/v1/units/{unit_id}/release-reservation",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert release_resp.status_code == 200
    assert release_resp.json()["status"] == "vacant"


async def test_bulk_update_units(async_client: AsyncClient, owner_token: str, property_and_units):
    prop, units = property_and_units
    updates = [
        {"unit_id": units[0]["id"], "updates": {"rent_base": 11000}},
        {"unit_id": units[1]["id"], "updates": {"rent_base": 11000}},
    ]
    resp = await async_client.post(
        f"/api/v1/properties/{prop['id']}/units/bulk-update",
        json={"updates": updates},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 2
    assert resp.json()["failed"] == 0


async def test_list_units_filter_by_status(
    async_client: AsyncClient, owner_token: str, property_and_units
):
    prop, units = property_and_units
    # Reserve one unit
    await async_client.post(
        f"/api/v1/units/{units[0]['id']}/reserve",
        json={"tenant_id": "tenant_001"},
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    resp = await async_client.get(
        f"/api/v1/properties/{prop['id']}/units?status=reserved",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
