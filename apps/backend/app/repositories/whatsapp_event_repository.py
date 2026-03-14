from typing import List

from app.models.whatsapp_event import WhatsAppEvent


class WhatsAppEventRepository:

    async def create(self, event: WhatsAppEvent) -> WhatsAppEvent:
        await event.insert()
        return event

    async def list_by_instance(
        self,
        instance_id: str,
        org_id: str,
        limit: int = 100,
        skip: int = 0,
    ) -> List[WhatsAppEvent]:
        return (
            await WhatsAppEvent.find(
                WhatsAppEvent.org_id == org_id,
                WhatsAppEvent.instance_id == instance_id,
            )
            .sort(-WhatsAppEvent.received_at)
            .skip(skip)
            .limit(limit)
            .to_list()
        )


whatsapp_event_repository = WhatsAppEventRepository()
