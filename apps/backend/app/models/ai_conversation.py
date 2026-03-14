import uuid
from datetime import datetime
from typing import Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.utils.datetime import utc_now


class AITokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class AIToolCall(BaseModel):
    id: str
    name: str
    arguments: str  # raw JSON string


class AIMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # user | assistant | tool
    content: Optional[str] = None
    tool_calls: Optional[List[AIToolCall]] = None
    tool_call_id: Optional[str] = None  # role=tool only
    tool_name: Optional[str] = None     # role=tool only
    token_usage: Optional[AITokenUsage] = None
    created_at: datetime = Field(default_factory=utc_now)


class AIConversation(Document):
    org_id: str
    user_id: str
    # owner | property | tenant | agent | service_provider | superadmin
    agent_type: str
    # extra context: property_id for property agent, tenant_id for tenant agent, etc.
    context_id: Optional[str] = None
    title: Optional[str] = None  # auto-set from first user message
    messages: List[AIMessage] = []

    # Accumulated token usage across the full conversation
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    model: str = ""

    status: str = "active"  # active | archived
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ai_conversations"
        indexes = [
            IndexModel(
                [("org_id", ASCENDING), ("user_id", ASCENDING), ("created_at", DESCENDING)]
            ),
            IndexModel(
                [("org_id", ASCENDING), ("agent_type", ASCENDING), ("context_id", ASCENDING)]
            ),
            IndexModel([("deleted_at", ASCENDING)]),
        ]
