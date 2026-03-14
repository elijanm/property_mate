from typing import Optional

from app.models.org import Org
from app.utils.datetime import utc_now


class OrgRepository:
    async def get_or_create(self, org_id: str) -> Org:
        """
        Return the Org doc for org_id, creating a default one if it doesn't exist.
        This is safe to call on every request — creation is idempotent.
        """
        existing = await Org.find_one({"org_id": org_id, "deleted_at": None})
        if existing:
            return existing
        org = Org(org_id=org_id)
        await org.insert()
        return org

    async def get_by_org_id(self, org_id: str) -> Optional[Org]:
        return await Org.find_one({"org_id": org_id, "deleted_at": None})

    async def update(self, org_id: str, updates: dict) -> Org:
        org = await self.get_or_create(org_id)
        updates["updated_at"] = utc_now()
        await org.update({"$set": updates})
        return await self.get_or_create(org_id)


org_repository = OrgRepository()
