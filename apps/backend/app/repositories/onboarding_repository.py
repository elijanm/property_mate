from typing import List, Optional, Tuple

from app.models.onboarding import Onboarding
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class OnboardingRepository:
    async def create(self, ob: Onboarding) -> Onboarding:
        await ob.insert()
        return ob

    async def get_by_id(self, onboarding_id: str, org_id: str) -> Optional[Onboarding]:
        return await Onboarding.find_one(
            Onboarding.id == PydanticObjectId(onboarding_id),
            Onboarding.org_id == org_id,
            Onboarding.deleted_at == None,  # noqa: E711
        )

    async def get_by_lease_id(self, lease_id: str, org_id: str) -> Optional[Onboarding]:
        return await Onboarding.find_one(
            Onboarding.lease_id == lease_id,
            Onboarding.org_id == org_id,
            Onboarding.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        lease_id: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> Tuple[List[Onboarding], int]:
        filters = [Onboarding.org_id == org_id, Onboarding.deleted_at == None]  # noqa: E711
        if property_id:
            filters.append(Onboarding.property_id == property_id)
        if tenant_id:
            filters.append(Onboarding.tenant_id == tenant_id)
        if lease_id:
            filters.append(Onboarding.lease_id == lease_id)
        if status:
            filters.append(Onboarding.status == status)

        query = Onboarding.find(*filters).sort("-created_at")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def get_by_id_public(self, onboarding_id: str) -> Optional[Onboarding]:
        """Fetch by ID without org_id filter — for public verification endpoints only."""
        try:
            return await Onboarding.find_one(
                Onboarding.id == PydanticObjectId(onboarding_id),
                Onboarding.deleted_at == None,  # noqa: E711
            )
        except Exception:
            return None

    async def get_by_token(self, token: str) -> Optional[Onboarding]:
        return await Onboarding.find_one(
            Onboarding.invite_token == token,
            Onboarding.deleted_at == None,  # noqa: E711
        )

    async def save(self, ob: Onboarding) -> Onboarding:
        ob.updated_at = utc_now()
        await ob.save()
        return ob


onboarding_repository = OnboardingRepository()
