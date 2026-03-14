"""
AI Chat API — REST + SSE streaming endpoints.

Routes:
  GET    /agents                              — available agents for current user
  POST   /conversations                       — create new conversation
  GET    /conversations                       — list user's conversations
  GET    /conversations/{id}                  — get conversation with messages
  DELETE /conversations/{id}                  — soft delete
  POST   /conversations/{id}/messages         — send message (SSE stream)
  GET    /usage                               — token usage stats (owner/superadmin)
"""
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.services.agents.registry import available_agents_for_role
from app.services.ai_service import ai_service

router = APIRouter(prefix="/ai", tags=["AI"])


# ── Request / response schemas ─────────────────────────────────────────────

class CreateConversationRequest(BaseModel):
    agent_type: Optional[str] = None   # defaults to role-based default
    context_id: Optional[str] = None   # e.g. property_id for property agent
    context: Optional[Dict[str, Any]] = None  # extra context hints


class SendMessageRequest(BaseModel):
    content: str
    context: Optional[Dict[str, Any]] = None  # forwarded to agent if provided


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/health")
async def ai_health(
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Diagnose the AI / LLM connection.
    Returns a structured report so you can see exactly what's failing.
    """
    from app.core.config import settings
    from openai import AsyncOpenAI

    report: Dict[str, Any] = {
        "openai_base_url": settings.openai_base_url,
        "openai_model": settings.openai_model,
        "api_key_set": bool(settings.openai_api_key),
        "llm_reachable": False,
        "llm_error": None,
        "test_response": None,
    }

    if not settings.openai_api_key:
        report["llm_error"] = "OPENAI_API_KEY is not set in .env"
        return report

    try:
        client = AsyncOpenAI(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            timeout=10.0,
        )
        resp = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": "Say: OK"}],
            max_tokens=10,
        )
        report["llm_reachable"] = True
        report["test_response"] = resp.choices[0].message.content
    except Exception as exc:
        report["llm_error"] = f"{type(exc).__name__}: {exc}"

    return report


@router.get("/agents")
async def list_agents(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return available agent types for the current user's role."""
    return {"agents": available_agents_for_role(current_user.role)}


@router.post("/conversations")
async def create_conversation(
    body: CreateConversationRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create a new AI conversation and return its ID."""
    try:
        conv = await ai_service.create_conversation(
            current_user=current_user,
            agent_type=body.agent_type,
            context_id=body.context_id,
            context=body.context,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    return {
        "id": str(conv.id),
        "agent_type": conv.agent_type,
        "context_id": conv.context_id,
        "model": conv.model,
        "created_at": conv.created_at.isoformat(),
    }


@router.get("/conversations")
async def list_conversations(
    agent_type: Optional[str] = Query(None),
    context_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    return await ai_service.list_conversations(
        current_user=current_user,
        agent_type=agent_type,
        context_id=context_id,
        page=page,
        page_size=page_size,
    )


@router.get("/conversations/{conv_id}")
async def get_conversation(
    conv_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    conv = await ai_service.get_conversation(conv_id, current_user)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return {
        "id": str(conv.id),
        "agent_type": conv.agent_type,
        "context_id": conv.context_id,
        "title": conv.title or "New conversation",
        "model": conv.model,
        "total_input_tokens": conv.total_input_tokens,
        "total_output_tokens": conv.total_output_tokens,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "token_usage": m.token_usage.model_dump() if m.token_usage else None,
                "created_at": m.created_at.isoformat(),
            }
            for m in conv.messages
            if m.role in ("user", "assistant")  # hide tool messages from client
        ],
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(
    conv_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    deleted = await ai_service.delete_conversation(conv_id, current_user)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: str,
    body: SendMessageRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Send a message to the AI and stream the response as SSE.

    Event format (newline-delimited JSON, each line: `data: {...}\\n\\n`):
      {"type": "token",      "content": "hello"}
      {"type": "tool_start", "name": "get_portfolio_summary", "display": "Get Portfolio Summary"}
      {"type": "tool_end",   "name": "get_portfolio_summary"}
      {"type": "done",       "content": "full text", "usage": {"prompt_tokens": N, ...}}
      {"type": "error",      "message": "..."}
    """
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty")

    # stream_message is an async generator — call without await
    generator = ai_service.stream_message(
        conv_id=conv_id,
        user_content=body.content.strip(),
        current_user=current_user,
        context=body.context,
    )

    async def event_stream():
        try:
            async for event in generator:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.get(
    "/usage",
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def get_usage_stats(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Aggregate token usage across all conversations for this org."""
    from app.models.ai_conversation import AIConversation

    pipeline = [
        {"$match": {"org_id": current_user.org_id, "deleted_at": None}},
        {
            "$group": {
                "_id": "$agent_type",
                "conversations": {"$sum": 1},
                "input_tokens": {"$sum": "$total_input_tokens"},
                "output_tokens": {"$sum": "$total_output_tokens"},
            }
        },
    ]
    results = await AIConversation.aggregate(pipeline).to_list()
    totals: Dict[str, Any] = {
        "by_agent": [],
        "total_conversations": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
    }
    for r in results:
        totals["by_agent"].append({
            "agent_type": r["_id"],
            "conversations": r["conversations"],
            "input_tokens": r["input_tokens"],
            "output_tokens": r["output_tokens"],
            "total_tokens": r["input_tokens"] + r["output_tokens"],
        })
        totals["total_conversations"] += r["conversations"]
        totals["total_input_tokens"] += r["input_tokens"]
        totals["total_output_tokens"] += r["output_tokens"]

    totals["total_tokens"] = (
        totals["total_input_tokens"] + totals["total_output_tokens"]
    )
    return totals
