from typing import List, Optional
from beanie import PydanticObjectId
from app.models.move_out import MoveOutInspection
from app.utils.datetime import utc_now


class MoveOutRepository:
    async def create(self, m: MoveOutInspection) -> MoveOutInspection:
        await m.insert()
        return m

    async def get_by_id(self, inspection_id: str, org_id: str) -> Optional[MoveOutInspection]:
        return await MoveOutInspection.find_one(
            MoveOutInspection.id == PydanticObjectId(inspection_id),
            MoveOutInspection.org_id == org_id,
            MoveOutInspection.deleted_at == None,  # noqa: E711
        )

    async def get_by_lease(self, lease_id: str, org_id: str) -> Optional[MoveOutInspection]:
        return await MoveOutInspection.find_one(
            MoveOutInspection.lease_id == lease_id,
            MoveOutInspection.org_id == org_id,
            MoveOutInspection.deleted_at == None,  # noqa: E711
        )

    async def list_by_property(self, property_id: str, org_id: str) -> List[MoveOutInspection]:
        return await MoveOutInspection.find(
            MoveOutInspection.property_id == property_id,
            MoveOutInspection.org_id == org_id,
            MoveOutInspection.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, m: MoveOutInspection) -> MoveOutInspection:
        m.updated_at = utc_now()
        await m.save()
        return m


move_out_repository = MoveOutRepository()
