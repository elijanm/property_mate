from typing import List, Optional

from app.models.ledger_entry import LedgerEntry
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId


class LedgerRepository:
    async def create(self, entry: LedgerEntry) -> LedgerEntry:
        await entry.insert()
        return entry

    async def get_by_id(self, entry_id: str, org_id: str) -> Optional[LedgerEntry]:
        return await LedgerEntry.find_one(
            LedgerEntry.id == PydanticObjectId(entry_id),
            LedgerEntry.org_id == org_id,
        )

    async def list_by_lease(self, lease_id: str, org_id: str) -> List[LedgerEntry]:
        return await LedgerEntry.find(
            LedgerEntry.org_id == org_id,
            LedgerEntry.lease_id == lease_id,
        ).sort("created_at").to_list()

    async def last_balance(self, lease_id: str, org_id: str) -> float:
        """Return the most recent running_balance for this lease, or 0.0."""
        entry = await LedgerEntry.find(
            LedgerEntry.org_id == org_id,
            LedgerEntry.lease_id == lease_id,
        ).sort("-created_at").first_or_none()
        return entry.running_balance if entry else 0.0


ledger_repository = LedgerRepository()
