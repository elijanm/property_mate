from typing import List, Optional

from beanie import PydanticObjectId

from app.models.lease_template import LeaseTemplate
from app.utils.datetime import utc_now


class LeaseTemplateRepository:
    async def create(self, t: LeaseTemplate) -> LeaseTemplate:
        await t.insert()
        return t

    async def get_by_id(self, template_id: str, org_id: str) -> Optional[LeaseTemplate]:
        try:
            oid = PydanticObjectId(template_id)
        except Exception:
            return None
        return await LeaseTemplate.find_one(
            LeaseTemplate.id == oid,
            LeaseTemplate.org_id == org_id,
            LeaseTemplate.deleted_at == None,  # noqa: E711
        )

    async def list_by_org(self, org_id: str) -> List[LeaseTemplate]:
        return await LeaseTemplate.find(
            LeaseTemplate.org_id == org_id,
            LeaseTemplate.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, t: LeaseTemplate) -> LeaseTemplate:
        t.updated_at = utc_now()
        await t.save()
        return t

    async def soft_delete(self, t: LeaseTemplate) -> None:
        t.deleted_at = utc_now()
        await t.save()


lease_template_repository = LeaseTemplateRepository()
