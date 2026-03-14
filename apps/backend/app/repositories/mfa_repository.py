from typing import Optional

from app.models.user_mfa import UserMfa
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class MfaRepository:
    async def get_by_user_id(self, user_id: str) -> Optional[UserMfa]:
        return await UserMfa.find_one({"user_id": user_id})

    async def upsert(self, user_id: str, org_id: Optional[str], **fields) -> UserMfa:
        existing = await self.get_by_user_id(user_id)
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            existing.updated_at = utc_now()
            await existing.save()
            return existing
        record = UserMfa(user_id=user_id, org_id=org_id, **fields)
        await record.insert()
        return record

    async def list_by_org(self, org_id: str) -> list[UserMfa]:
        return await UserMfa.find({"org_id": org_id}).to_list()

    async def delete_by_user_id(self, user_id: str) -> None:
        record = await self.get_by_user_id(user_id)
        if record:
            await record.delete()


mfa_repository = MfaRepository()
