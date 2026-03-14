from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.ai_conversation import AIConversation, AIMessage
from app.utils.datetime import utc_now


class AIConversationRepository:
    async def create(self, conv: AIConversation) -> AIConversation:
        await conv.insert()
        return conv

    async def get_by_id(self, conv_id: str, org_id: str) -> Optional[AIConversation]:
        return await AIConversation.find_one(
            AIConversation.id == PydanticObjectId(conv_id),
            AIConversation.org_id == org_id,
            AIConversation.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        user_id: str,
        agent_type: Optional[str] = None,
        context_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 30,
    ) -> Tuple[List[AIConversation], int]:
        filters = [
            AIConversation.org_id == org_id,
            AIConversation.user_id == user_id,
            AIConversation.deleted_at == None,  # noqa: E711
        ]
        if agent_type:
            filters.append(AIConversation.agent_type == agent_type)
        if context_id:
            filters.append(AIConversation.context_id == context_id)

        query = AIConversation.find(*filters).sort("-created_at")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def append_message(self, conv_id: str, org_id: str, msg: AIMessage) -> None:
        conv = await self.get_by_id(conv_id, org_id)
        if conv:
            conv.messages.append(msg)
            conv.updated_at = utc_now()
            await conv.save()

    async def update_usage_and_title(
        self,
        conv_id: str,
        org_id: str,
        input_tokens: int,
        output_tokens: int,
        title: Optional[str] = None,
    ) -> None:
        conv = await self.get_by_id(conv_id, org_id)
        if not conv:
            return
        conv.total_input_tokens += input_tokens
        conv.total_output_tokens += output_tokens
        if title and not conv.title:
            conv.title = title
        conv.updated_at = utc_now()
        await conv.save()

    async def soft_delete(self, conv_id: str, org_id: str) -> bool:
        conv = await self.get_by_id(conv_id, org_id)
        if not conv:
            return False
        conv.deleted_at = utc_now()
        conv.updated_at = utc_now()
        await conv.save()
        return True


ai_conversation_repository = AIConversationRepository()
