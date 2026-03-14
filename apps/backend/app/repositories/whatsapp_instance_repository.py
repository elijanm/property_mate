from typing import List, Optional

from beanie import PydanticObjectId

from app.models.whatsapp_instance import WhatsAppInstance
from app.utils.datetime import utc_now


class WhatsAppInstanceRepository:

    async def get_by_id(self, instance_id: str, org_id: Optional[str]) -> Optional[WhatsAppInstance]:
        oid = _safe_oid(instance_id)
        if not oid:
            return None
        filters = [WhatsAppInstance.id == oid, WhatsAppInstance.deleted_at == None]
        if org_id:
            filters.append(WhatsAppInstance.org_id == org_id)
        return await WhatsAppInstance.find_one(*filters)

    async def get_by_webhook_token(self, webhook_token: str) -> Optional[WhatsAppInstance]:
        return await WhatsAppInstance.find_one(
            WhatsAppInstance.webhook_token == webhook_token,
            WhatsAppInstance.deleted_at == None,
        )

    async def get_by_wuzapi_token(self, wuzapi_token: str) -> Optional[WhatsAppInstance]:
        return await WhatsAppInstance.find_one(
            WhatsAppInstance.wuzapi_token == wuzapi_token,
            WhatsAppInstance.deleted_at == None,
        )

    async def list_by_property(
        self,
        property_id: str,
        org_id: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> List[WhatsAppInstance]:
        if entity_type and entity_id:
            filters = [
                WhatsAppInstance.entity_type == entity_type,
                WhatsAppInstance.entity_id == entity_id,
                WhatsAppInstance.deleted_at == None,  # noqa: E711
            ]
        else:
            filters = [
                WhatsAppInstance.property_id == property_id,
                WhatsAppInstance.deleted_at == None,  # noqa: E711
            ]
        if org_id:
            filters.append(WhatsAppInstance.org_id == org_id)
        return await WhatsAppInstance.find(*filters).sort(+WhatsAppInstance.created_at).to_list()

    async def create(self, instance: WhatsAppInstance) -> WhatsAppInstance:
        await instance.insert()
        return instance

    async def update(self, instance: WhatsAppInstance, updates: dict) -> WhatsAppInstance:
        updates["updated_at"] = utc_now()
        await instance.set(updates)
        return instance

    async def soft_delete(self, instance: WhatsAppInstance) -> None:
        await instance.set({"deleted_at": utc_now(), "updated_at": utc_now()})


def _safe_oid(s: str) -> Optional[PydanticObjectId]:
    try:
        return PydanticObjectId(s)
    except Exception:
        return None


whatsapp_instance_repository = WhatsAppInstanceRepository()
