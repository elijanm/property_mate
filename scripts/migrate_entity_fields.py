#!/usr/bin/env python3
"""Phase 2D — Backfill entity_type / entity_id on existing documents.

For every org-scoped collection that gained entity_type + entity_id fields,
this script sets:
    entity_type = "property"   (only supported entity type today)
    entity_id   = property_id  (mirrors the existing field)

Only updates documents where entity_id is null/missing (safe to re-run).

Usage:
    MONGO_URL=mongodb://localhost:27017 python scripts/migrate_entity_fields.py
    MONGO_URL=mongodb://localhost:27017 python scripts/migrate_entity_fields.py --dry-run

Collections migrated:
    tickets
    store_locations
    cctv_cameras
    cctv_events
    whatsapp_instances
    assets
    inventory_items
"""
import asyncio
import os
import sys

import motor.motor_asyncio

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("MONGO_DB", "pms")

# (collection_name, property_id_field)
COLLECTIONS = [
    ("tickets",            "property_id"),
    ("store_locations",    "property_id"),
    ("cctv_cameras",       "property_id"),
    ("cctv_events",        "property_id"),
    ("whatsapp_instances", "property_id"),
    ("assets",             "property_id"),
    ("inventory_items",    "property_id"),
]


async def migrate(dry_run: bool = False) -> None:
    client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"{'[DRY RUN] ' if dry_run else ''}Connecting to {MONGO_URL}/{DB_NAME}\n")

    total_updated = 0

    for collection_name, pid_field in COLLECTIONS:
        col = db[collection_name]

        # Count documents that need backfilling
        need_update = await col.count_documents(
            {pid_field: {"$exists": True, "$ne": None}, "entity_id": None}
        )

        if need_update == 0:
            print(f"  {collection_name}: already up-to-date (0 documents to migrate)")
            continue

        print(f"  {collection_name}: {need_update} documents to migrate...", end="", flush=True)

        if not dry_run:
            # Use aggregation pipeline update to set entity_id = property_id value
            result = await col.update_many(
                {pid_field: {"$exists": True, "$ne": None}, "entity_id": None},
                [
                    {"$set": {
                        "entity_type": "property",
                        "entity_id": f"${pid_field}",
                    }}
                ],
            )
            updated = result.modified_count
            total_updated += updated
            print(f" done ({updated} updated)")
        else:
            print(f" would update {need_update}")
            total_updated += need_update

    print(f"\n{'[DRY RUN] Would update' if dry_run else 'Total updated'}: {total_updated} documents across {len(COLLECTIONS)} collections")
    client.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(migrate(dry_run=dry_run))
