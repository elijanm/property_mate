"""
Backfill reference_no on existing Lease documents that have none.

Usage (from apps/backend/):
    python -m scripts.seed_lease_reference_no
"""
import asyncio
import random
import string
from datetime import datetime

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.models.lease import Lease


def _generate_ref(created_at: datetime) -> str:
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"LSE-{created_at.strftime('%Y%m')}-{suffix}"


async def main() -> None:
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.mongo_db]
    await init_beanie(database=db, document_models=[Lease])

    col = Lease.get_pymongo_collection()

    # Find all leases missing reference_no (or where it's null)
    cursor = col.find(
        {"$or": [{"reference_no": {"$exists": False}}, {"reference_no": None}]},
        {"_id": 1, "created_at": 1},
    )

    updated = 0
    async for doc in cursor:
        created_at = doc.get("created_at") or datetime.utcnow()
        ref = _generate_ref(created_at)
        await col.update_one({"_id": doc["_id"]}, {"$set": {"reference_no": ref}})
        print(f"  {doc['_id']}  →  {ref}")
        updated += 1

    client.close()
    print(f"\nDone. {updated} lease(s) updated.")


if __name__ == "__main__":
    asyncio.run(main())
