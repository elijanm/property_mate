"""API-level test fixtures.

These fixtures spin up the full FastAPI application (ASGI transport) against an
in-memory MongoDB (mongomock) or a real MongoDB (--real-db flag).  All external
services (Redis, RabbitMQ, OpenSearch, S3) are patched out so the tests remain
fully self-contained.

CLI flags (inherited from the root conftest):
  --keep-data   Skip post-test teardown — data persists for UI inspection.
  --real-db     Use real MongoDB (MONGODB_URL env var) instead of mongomock.

Run examples:
  # Default — in-memory, cleaned after each test
  pytest tests/api/ -v

  # Real MongoDB, keep data (inspect results in the UI)
  pytest -v --real-db --keep-data tests/api/test_billing_e2e_api.py
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest
import pytest_asyncio
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from app.dependencies.redis import get_redis_dep
from app.main import app
from app.models.audit_log import AuditLog
from app.models.invoice import BillingCycleRun, Invoice
from app.models.job_run import JobRun
from app.models.lease import Lease
from app.models.ledger_entry import LedgerEntry
from app.models.onboarding import Onboarding
from app.models.org import Org
from app.models.payment import Payment
from app.models.property import Property
from app.models.unit import Unit
from app.models.user import User
from app.services.auth_service import create_access_token, hash_password

_API_MODELS = [
    User, Property, Unit, Lease, Onboarding,
    AuditLog, JobRun,
    Org, Invoice, BillingCycleRun, Payment, LedgerEntry,
]

_PATCHES = [
    "app.core.database.init_db",
    "app.core.database.close_db",
    "app.core.redis.init_redis",
    "app.core.redis.close_redis",
    "app.core.rabbitmq.init_rabbitmq",
    "app.core.rabbitmq.close_rabbitmq",
    "app.core.opensearch.init_opensearch",
    "app.core.opensearch.close_opensearch",
    "app.services.property_service.publish",
    "app.services.unit_service.publish",
    "app.services.lease_service.publish",
    # Billing run publishes to RabbitMQ — patch so tests stay synchronous
    "app.core.rabbitmq.publish",
    # invoices.py imports publish directly; patch it at the usage site too
    "app.api.v1.invoices.publish",
    # billing_service uses Redis for distributed locking; skip in tests
    "app.services.billing_service._acquire_lock",
    "app.services.billing_service._release_lock",
]


def _keep_data(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--keep-data", default=False))


def _real_db(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--real-db", default=False))


# ── DB fixture ────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def api_db(request: pytest.FixtureRequest):
    """Isolated MongoDB for API tests.  Respects --real-db and --keep-data."""
    if _real_db(request):
        from motor.motor_asyncio import AsyncIOMotorClient
        mongodb_url = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
        client = AsyncIOMotorClient(mongodb_url)
        db = client["pms_api_test"]
        await init_beanie(database=db, document_models=_API_MODELS)
        yield db
        if not _keep_data(request):
            for name in await db.list_collection_names():
                await db.drop_collection(name)
        else:
            print(
                f"\n  ┌──────────────────────────────────────────────────────┐\n"
                f"  │  --keep-data active: data preserved in '{db.name}'  │\n"
                f"  │  MongoDB: {mongodb_url:<42}│\n"
                f"  └──────────────────────────────────────────────────────┘"
            )
        client.close()
    else:
        client = AsyncMongoMockClient()
        db = client["pms_api_test"]
        await init_beanie(database=db, document_models=_API_MODELS)
        yield db
        if not _keep_data(request):
            for name in await db.list_collection_names():
                await db.drop_collection(name)


# ── HTTP client fixture ───────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def api_client(api_db):
    """Full ASGI test client with all external services patched out."""
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    app.dependency_overrides[get_redis_dep] = lambda: redis

    active_patches = [patch(path, new_callable=AsyncMock) for path in _PATCHES]
    for p in active_patches:
        p.start()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client

    for p in active_patches:
        p.stop()
    app.dependency_overrides.clear()
    await redis.aclose()


# ── Org fixture ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def api_org(api_db) -> Org:
    """Org document used by all API tests in a session."""
    import uuid as _uuid
    org_id = f"org_api_{_uuid.uuid4().hex[:8]}"
    org = Org(org_id=org_id)
    await org.insert()
    return org


# ── User fixtures ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def api_owner(api_org: Org) -> User:
    user = User(
        email="owner@apitest.com",
        hashed_password=hash_password("secret123"),
        org_id=api_org.org_id,
        role="owner",
        first_name="Api",
        last_name="Owner",
        is_active=True,
    )
    await user.insert()
    return user


@pytest_asyncio.fixture
async def api_owner_token(api_owner: User) -> str:
    return create_access_token(str(api_owner.id), api_owner.org_id, api_owner.role)


@pytest_asyncio.fixture
def api_auth_headers(api_owner_token: str) -> dict:
    return {"Authorization": f"Bearer {api_owner_token}"}
