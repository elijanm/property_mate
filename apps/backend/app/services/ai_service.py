"""
AIService — manages conversations and routes messages to the correct agent.
"""
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from app.core.config import settings
from app.dependencies.auth import CurrentUser
from app.models.ai_conversation import AIConversation, AIMessage, AITokenUsage
from app.repositories.ai_conversation_repository import ai_conversation_repository
from app.services.agents.registry import build_agent, can_use_agent, resolve_agent_type
from app.utils.datetime import utc_now


class AIService:
    async def list_conversations(
        self,
        current_user: CurrentUser,
        agent_type: Optional[str] = None,
        context_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 30,
    ) -> Dict:
        skip = (page - 1) * page_size
        items, total = await ai_conversation_repository.list(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            agent_type=agent_type,
            context_id=context_id,
            skip=skip,
            limit=page_size,
        )
        return {
            "items": [self._conv_summary(c) for c in items],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_conversation(
        self, conv_id: str, current_user: CurrentUser
    ) -> Optional[AIConversation]:
        return await ai_conversation_repository.get_by_id(
            conv_id, current_user.org_id
        )

    async def create_conversation(
        self,
        current_user: CurrentUser,
        agent_type: Optional[str],
        context_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> AIConversation:
        resolved_type = agent_type or resolve_agent_type(current_user.role)

        if not can_use_agent(current_user.role, resolved_type):
            raise PermissionError(
                f"Role '{current_user.role}' cannot use agent '{resolved_type}'"
            )

        conv = AIConversation(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            agent_type=resolved_type,
            context_id=context_id,
            model=settings.openai_model,
        )
        return await ai_conversation_repository.create(conv)

    async def delete_conversation(
        self, conv_id: str, current_user: CurrentUser
    ) -> bool:
        return await ai_conversation_repository.soft_delete(
            conv_id, current_user.org_id
        )

    async def stream_message(
        self,
        conv_id: str,
        user_content: str,
        current_user: CurrentUser,
        context: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict, None]:
        """
        Async generator — yields SSE-ready dicts:
          {"type": "token",      "content": "..."}
          {"type": "tool_start", "name": "...", "display": "..."}
          {"type": "tool_end",   "name": "..."}
          {"type": "done",       "content": "...", "usage": {...}}
          {"type": "error",      "message": "..."}
        """
        conv = await ai_conversation_repository.get_by_id(
            conv_id, current_user.org_id
        )
        if not conv:
            yield {"type": "error", "message": "Conversation not found"}
            return

        # Save user message immediately so history is accurate
        user_msg = AIMessage(role="user", content=user_content)
        await ai_conversation_repository.append_message(
            str(conv.id), current_user.org_id, user_msg
        )

        # Build LLM message history (system prompt is added by base_agent)
        history = self._build_history(conv.messages + [user_msg])

        # Resolve agent context
        agent_context: Dict[str, Any] = dict(context or {})
        if conv.context_id:
            agent_context.setdefault("property_id", conv.context_id)
            if conv.agent_type == "property" and "property_name" not in agent_context:
                try:
                    from app.repositories.property_repository import property_repository
                    prop = await property_repository.get_by_id(
                        conv.context_id, current_user.org_id
                    )
                    if prop:
                        agent_context["property_name"] = prop.name
                except Exception:
                    pass

        # Load org AI config so agents use the org-configured LLM provider
        from app.repositories.org_repository import org_repository as _org_repo
        _org = await _org_repo.get_or_create(current_user.org_id)
        _ai_cfg = _org.ai_config.model_dump() if getattr(_org, "ai_config", None) else None

        agent = build_agent(conv.agent_type, current_user, agent_context, ai_config=_ai_cfg)
        assistant_msg_id = str(uuid.uuid4())

        full_content_parts: List[str] = []
        final_usage: Dict = {}

        async for event in agent.stream(history):
            yield event
            if event["type"] == "token":
                full_content_parts.append(event["content"])
            elif event["type"] == "done":
                final_usage = event.get("usage", {})

        # Persist assistant message
        usage_obj = AITokenUsage(
            prompt_tokens=final_usage.get("prompt_tokens", 0),
            completion_tokens=final_usage.get("completion_tokens", 0),
            total_tokens=final_usage.get("total_tokens", 0),
        )
        assistant_msg = AIMessage(
            id=assistant_msg_id,
            role="assistant",
            content="".join(full_content_parts),
            token_usage=usage_obj,
        )
        await ai_conversation_repository.append_message(
            str(conv.id), current_user.org_id, assistant_msg
        )

        # Auto-title from first user message
        title: Optional[str] = None
        if not conv.title:
            title = user_content[:60] + ("…" if len(user_content) > 60 else "")

        await ai_conversation_repository.update_usage_and_title(
            str(conv.id),
            current_user.org_id,
            input_tokens=final_usage.get("prompt_tokens", 0),
            output_tokens=final_usage.get("completion_tokens", 0),
            title=title,
        )

    def _build_history(self, messages: List[AIMessage]) -> List[Dict]:
        """Convert stored AIMessage list to OpenAI message dicts."""
        result = []
        for m in messages:
            if m.role == "user":
                result.append({"role": "user", "content": m.content or ""})
            elif m.role == "assistant":
                entry: Dict = {"role": "assistant", "content": m.content}
                if m.tool_calls:
                    entry["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": tc.arguments},
                        }
                        for tc in m.tool_calls
                    ]
                result.append(entry)
            elif m.role == "tool":
                result.append({
                    "role": "tool",
                    "tool_call_id": m.tool_call_id or "",
                    "content": m.content or "",
                })
        return result

    def _conv_summary(self, conv: AIConversation) -> Dict:
        last_msg = conv.messages[-1] if conv.messages else None
        return {
            "id": str(conv.id),
            "agent_type": conv.agent_type,
            "context_id": conv.context_id,
            "title": conv.title or "New conversation",
            "last_message": (last_msg.content or "")[:100] if last_msg else "",
            "last_role": last_msg.role if last_msg else None,
            "message_count": len(conv.messages),
            "total_tokens": conv.total_input_tokens + conv.total_output_tokens,
            "created_at": conv.created_at.isoformat(),
            "updated_at": conv.updated_at.isoformat(),
        }


ai_service = AIService()
