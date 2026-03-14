"""Integration tests for property CRUD and Breeze configuration."""
import pytest
from httpx import AsyncClient


pytestmark = pytest.mark.asyncio


PROPERTY_PAYLOAD = {
    "name": "Sunrise Apartments",
    "property_type": "residential",
    "region": "Nairobi",
    "timezone": "Africa/Nairobi",
    "address": {
        "street": "123 Main St",
        "city": "Nairobi",
        "state": "Nairobi County",
        "country": "Kenya",
    },
    "wings": [
        {"name": "A", "floors_start": 1, "floors_end": 2},
    ],
    "unit_templates": [
        {
            "template_name": "standard",
            "floors_start": 1,
            "floors_end": 2,
            "units_per_floor": 4,
            "unit_type": "studio",
            "rent_base": 15000,
            "deposit_amount": 15000,
        }
    ],
    "billing_settings": {
        "invoice_day": 1,
        "due_days": 7,
        "grace_days": 3,
        "late_fee_type": "flat",
        "late_fee_value": 500,
    },
}


async def test_create_property_owner(async_client: AsyncClient, owner_token: str):
    resp = await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["property"]["name"] == "Sunrise Apartments"
    assert data["units_generated"] == 8  # 1 wing × 2 floors × 4 units
    assert data["job_id"] is None  # sync generation


async def test_create_property_tenant_forbidden(async_client: AsyncClient, tenant_token: str):
    resp = await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {tenant_token}"},
    )
    assert resp.status_code == 403


async def test_create_property_agent_forbidden(async_client: AsyncClient, agent_token: str):
    resp = await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {agent_token}"},
    )
    assert resp.status_code == 403


async def test_list_properties(async_client: AsyncClient, owner_token: str):
    # Create one first
    await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    resp = await async_client.get(
        "/api/v1/properties",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert "items" in data


async def test_get_property(async_client: AsyncClient, owner_token: str):
    create_resp = await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    property_id = create_resp.json()["property"]["id"]

    resp = await async_client.get(
        f"/api/v1/properties/{property_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == property_id


async def test_get_property_not_found(async_client: AsyncClient, owner_token: str):
    resp = await async_client.get(
        "/api/v1/properties/nonexistent-id",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert resp.status_code == 404


async def test_create_property_generates_correct_unit_codes(
    async_client: AsyncClient, owner_token: str
):
    resp = await async_client.post(
        "/api/v1/properties",
        json=PROPERTY_PAYLOAD,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    property_id = resp.json()["property"]["id"]

    units_resp = await async_client.get(
        f"/api/v1/properties/{property_id}/units",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert units_resp.status_code == 200
    codes = [u["unit_code"] for u in units_resp.json()["items"]]
    assert "A-0101" in codes
    assert "A-0204" in codes


async def test_create_property_idempotent_units(async_client: AsyncClient, owner_token: str):
    """Creating property twice should not create duplicate units (different property names)."""
    payload1 = {**PROPERTY_PAYLOAD, "name": "Property Alpha"}
    payload2 = {**PROPERTY_PAYLOAD, "name": "Property Beta"}

    r1 = await async_client.post(
        "/api/v1/properties",
        json=payload1,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    r2 = await async_client.post(
        "/api/v1/properties",
        json=payload2,
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert r1.json()["property"]["id"] != r2.json()["property"]["id"]
    assert r1.json()["units_generated"] == r2.json()["units_generated"] == 8
