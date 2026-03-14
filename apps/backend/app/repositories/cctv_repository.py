from typing import List, Optional

from beanie import PydanticObjectId

from app.models.cctv import CCTVCamera, CCTVEvent
from app.utils.datetime import utc_now


class CCTVCameraRepository:
    async def list_by_property(
        self,
        property_id: str,
        org_id: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> List[CCTVCamera]:
        if entity_type and entity_id:
            q = {"entity_type": entity_type, "entity_id": entity_id, "org_id": org_id, "deleted_at": None}
        else:
            q = {"property_id": property_id, "org_id": org_id, "deleted_at": None}
        return await CCTVCamera.find(q).sort("name").to_list()

    async def get_by_id(self, camera_id: str, org_id: str) -> Optional[CCTVCamera]:
        try:
            oid = PydanticObjectId(camera_id)
        except Exception:
            return None
        return await CCTVCamera.find_one({"_id": oid, "org_id": org_id, "deleted_at": None})

    async def create(self, camera: CCTVCamera) -> CCTVCamera:
        await camera.insert()
        return camera

    async def update(self, camera: CCTVCamera, updates: dict) -> CCTVCamera:
        updates["updated_at"] = utc_now()
        await camera.set(updates)
        return camera

    async def delete(self, camera: CCTVCamera) -> None:
        await camera.set({"deleted_at": utc_now(), "updated_at": utc_now()})


class CCTVEventRepository:
    async def list_by_property(
        self,
        property_id: str,
        org_id: str,
        camera_id: Optional[str] = None,
        is_suspicious: Optional[bool] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[List[CCTVEvent], int]:
        if entity_type and entity_id:
            q: dict = {"entity_type": entity_type, "entity_id": entity_id, "org_id": org_id, "deleted_at": None}
        else:
            q: dict = {"property_id": property_id, "org_id": org_id, "deleted_at": None}
        if camera_id:
            q["camera_id"] = camera_id
        if is_suspicious is not None:
            q["is_suspicious"] = is_suspicious
        total = await CCTVEvent.find(q).count()
        items = (
            await CCTVEvent.find(q)
            .sort("-occurred_at")
            .skip((page - 1) * page_size)
            .limit(page_size)
            .to_list()
        )
        return items, total

    async def get_by_id(self, event_id: str, org_id: str) -> Optional[CCTVEvent]:
        try:
            oid = PydanticObjectId(event_id)
        except Exception:
            return None
        return await CCTVEvent.find_one({"_id": oid, "org_id": org_id, "deleted_at": None})

    async def create(self, event: CCTVEvent) -> CCTVEvent:
        await event.insert()
        return event

    async def mark_reviewed(self, event: CCTVEvent, user_id: str, notes: Optional[str]) -> CCTVEvent:
        await event.set({
            "is_reviewed": True,
            "reviewed_by": user_id,
            "reviewed_at": utc_now(),
            "review_notes": notes,
        })
        return event


cctv_camera_repository = CCTVCameraRepository()
cctv_event_repository = CCTVEventRepository()
