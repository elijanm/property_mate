#!/usr/bin/env python3
"""
Seed the dev database with one user per role.

Usage (from repo root):
    cd apps/backend && python ../../scripts/seed.py

Or with a custom .env:
    ENV_FILE=/path/to/.env python scripts/seed.py

Idempotent — skips users that already exist by email.
"""

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running from repo root or apps/backend/
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))
from bson import ObjectId as BsonObjectId
from passlib.context import CryptContext
from motor.motor_asyncio import AsyncIOMotorClient

# ── Config (mirrors app/core/config.py without importing it to avoid full app init) ──

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27018")
MONGO_DB = os.getenv("MONGO_DB", "pms")

_pwd = CryptContext(schemes=["argon2"], deprecated="auto")


def _hash(password: str) -> str:

    return _pwd.hash(password)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Seed data ────────────────────────────────────────────────────────────────

SEED_ORG_ID = "org_seed_001"

USERS = [
    {
        "email": "superadmin@pms.dev",
        "password": "superadmin123",
        "role": "superadmin",
        "org_id": None,
        "first_name": "Super",
        "last_name": "Admin",
    },
    {
        "email": "owner@pms.dev",
        "password": "owner123",
        "role": "owner",
        "org_id": SEED_ORG_ID,
        "first_name": "Alice",
        "last_name": "Owner",
    },
    {
        "email": "agent@pms.dev",
        "password": "agent123",
        "role": "agent",
        "org_id": SEED_ORG_ID,
        "first_name": "Bob",
        "last_name": "Agent",
    },
    {
        "email": "tenant@pms.dev",
        "password": "tenant123",
        "role": "tenant",
        "org_id": SEED_ORG_ID,
        "first_name": "Carol",
        "last_name": "Tenant",
    },
    {
        "email": "vendor@pms.dev",
        "password": "vendor123",
        "role": "service_provider",
        "org_id": SEED_ORG_ID,
        "first_name": "Dave",
        "last_name": "Vendor",
    },
]


# ── Main ─────────────────────────────────────────────────────────────────────

async def seed() -> None:
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    users_col = db["users"]

    # Ensure unique index exists
    await users_col.create_index("email", unique=True)

    created = 0
    skipped = 0

    for spec in USERS:
        existing = await users_col.find_one({"email": spec["email"]})
        if existing:
            await users_col.delete_one({"_id": existing["_id"]})
            skipped += 1
            continue

        now = _now()
        doc = {
            "_id": BsonObjectId(),
            "email": spec["email"],
            "hashed_password": _hash(spec["password"]),
            "role": spec["role"],
            "org_id": spec["org_id"],
            "first_name": spec["first_name"],
            "last_name": spec["last_name"],
            "is_active": True,
            "deleted_at": None,
            "created_at": now,
            "updated_at": now,
        }
        await users_col.insert_one(doc)
        created += 1

    client.close()

    print(f"\nSeeded {created} user(s), skipped {skipped} existing.\n")

    if created > 0 or skipped == 0:
        print("Dev credentials:")
        print(f"{'Role':<20} {'Email':<28} {'Password'}")
        print("-" * 65)
        for spec in USERS:
            print(f"{spec['role']:<20} {spec['email']:<28} {spec['password']}")
        print()
        print(f"org_id for owner/agent/tenant/vendor: {SEED_ORG_ID}")
        print()


if __name__ == "__main__":
    asyncio.run(seed())
