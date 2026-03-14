"""Shared pytest fixtures for all test suites.

CLI flags (registered here, honoured by every fixture):
  --keep-data   Skip post-test teardown — data persists in DB for inspection.
  --real-db     Use the real MongoDB (MONGODB_URL env var) instead of mongomock.
                Requires the backend stack to be running (docker-compose up).

Examples
--------
  # Default — in-memory, cleaned after each test
  pytest -v

  # Keep data in-memory (only useful for debugging a single test)
  pytest -v --keep-data -k test_billing_seed_12_months

  # Real MongoDB, keep data (ideal for inspecting results in the UI)
  pytest -v --real-db --keep-data tests/api/test_billing_e2e_api.py
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

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

# Full model list used by both unit tests and seed/API tests
_ALL_MODELS = [
    User, Property, Unit, Lease, Onboarding,
    AuditLog, JobRun,
    Org, Invoice, BillingCycleRun, Payment, LedgerEntry,
]


# ── CLI option registration ───────────────────────────────────────────────────

def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--keep-data",
        action="store_true",
        default=False,
        help="Skip post-test DB teardown so created data persists for inspection.",
    )
    parser.addoption(
        "--real-db",
        action="store_true",
        default=False,
        help="Connect to real MongoDB (MONGODB_URL env var) instead of mongomock.",
    )


# ── Shared helpers ────────────────────────────────────────────────────────────

def _keep_data(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--keep-data", default=False))


def _real_db(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--real-db", default=False))


# ── Billing service infrastructure mocks (BUG 17 & 18) ───────────────────────
# Patch Redis lock and RabbitMQ publish used by billing_service so tests that
# call generate_invoices_for_month(dry_run=False) don't need a real Redis/MQ.
# Skipped for tests/api/ which supply their own patches via api_client fixture.

@pytest_asyncio.fixture(autouse=True)
async def mock_billing_lock(request: pytest.FixtureRequest):
    """Prevent billing_service._acquire_lock from hitting Redis in unit/integration tests."""
    if "api" in str(request.fspath):
        yield
        return
    with patch(
        "app.services.billing_service._acquire_lock",
        new_callable=AsyncMock,
        return_value=True,
    ) as _lock_mock, patch(
        "app.services.billing_service._release_lock",
        new_callable=AsyncMock,
    ) as _release_mock:
        yield


@pytest_asyncio.fixture(autouse=True)
async def mock_rabbitmq_publish(request: pytest.FixtureRequest):
    """Prevent any direct RabbitMQ publish calls in billing/service layer from failing."""
    if "api" in str(request.fspath):
        yield
        return
    with patch("app.core.rabbitmq.publish", new_callable=AsyncMock):
        yield


# ── Infrastructure fixtures ───────────────────────────────────────────────────

@pytest_asyncio.fixture
async def mock_redis():
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


@pytest_asyncio.fixture(autouse=True)
async def setup_db(request: pytest.FixtureRequest):
    """DB fixture used by the existing unit/integration tests (mongomock only).

    Skipped automatically for tests inside tests/api/ which manage their own DB.
    """
    # tests/api/ has its own db fixture — don't double-init
    if "api" in str(request.fspath):
        yield
        return

    if _real_db(request):
        # Real MongoDB — import motor here to avoid import errors when not installed
        from motor.motor_asyncio import AsyncIOMotorClient
        mongodb_url = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
        client = AsyncIOMotorClient(mongodb_url)
        db = client["pms_test"]
        await init_beanie(database=db, document_models=_ALL_MODELS)
        yield
        if not _keep_data(request):
            for name in await db.list_collection_names():
                await db.drop_collection(name)
        else:
            _print_keep_data_banner(db.name, mongodb_url)
        client.close()
    else:
        client = AsyncMongoMockClient()
        db = client["test_pms"]
        await init_beanie(database=db, document_models=_ALL_MODELS)
        yield
        if not _keep_data(request):
            for name in await db.list_collection_names():
                await db.drop_collection(name)


def _print_keep_data_banner(db_name: str, url: str) -> None:  # pragma: no cover
    print(
        f"\n  ┌─────────────────────────────────────────────────────┐\n"
        f"  │  --keep-data active: data preserved in '{db_name}'  │\n"
        f"  │  MongoDB: {url:<41} │\n"
        f"  └─────────────────────────────────────────────────────┘"
    )


# ── HTTP client fixture ───────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def async_client(mock_redis):
    """Async HTTP client with Redis overridden and Docker services patched out."""
    app.dependency_overrides[get_redis_dep] = lambda: mock_redis

    patches = [
        patch("app.core.database.init_db", new_callable=AsyncMock),
        patch("app.core.database.close_db", new_callable=AsyncMock),
        patch("app.core.redis.init_redis", new_callable=AsyncMock),
        patch("app.core.redis.close_redis", new_callable=AsyncMock),
        patch("app.core.rabbitmq.init_rabbitmq", new_callable=AsyncMock),
        patch("app.core.rabbitmq.close_rabbitmq", new_callable=AsyncMock),
        patch("app.core.opensearch.init_opensearch", new_callable=AsyncMock),
        patch("app.core.opensearch.close_opensearch", new_callable=AsyncMock),
        patch("app.services.property_service.publish", new_callable=AsyncMock),
        patch("app.services.unit_service.publish", new_callable=AsyncMock),
        patch("app.services.lease_service.publish", new_callable=AsyncMock),
    ]
    for p in patches:
        p.start()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    for p in patches:
        p.stop()
    app.dependency_overrides.clear()


# ── User fixtures ─────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def owner_user() -> User:
    user = User(
        email="owner@example.com",
        hashed_password=hash_password("secret123"),
        org_id="org_test",
        role="owner",
        first_name="Alice",
        last_name="Owner",
        is_active=True,
    )
    await user.insert()
    return user


@pytest_asyncio.fixture
async def agent_user() -> User:
    user = User(
        email="agent@example.com",
        hashed_password=hash_password("secret123"),
        org_id="org_test",
        role="agent",
        first_name="Bob",
        last_name="Agent",
        is_active=True,
    )
    await user.insert()
    return user


@pytest_asyncio.fixture
async def tenant_user() -> User:
    user = User(
        email="tenant@example.com",
        hashed_password=hash_password("secret123"),
        org_id="org_test",
        role="tenant",
        first_name="Carol",
        last_name="Tenant",
        is_active=True,
    )
    await user.insert()
    return user


@pytest_asyncio.fixture
async def inactive_user() -> User:
    user = User(
        email="suspended@example.com",
        hashed_password=hash_password("secret123"),
        org_id="org_test",
        role="tenant",
        is_active=False,
    )
    await user.insert()
    return user


# ── Token fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
def owner_token(owner_user: User) -> str:
    return create_access_token(str(owner_user.id), owner_user.org_id, owner_user.role)


@pytest.fixture
def agent_token(agent_user: User) -> str:
    return create_access_token(str(agent_user.id), agent_user.org_id, agent_user.role)


@pytest.fixture
def tenant_token(tenant_user: User) -> str:
    return create_access_token(str(tenant_user.id), tenant_user.org_id, tenant_user.role)
