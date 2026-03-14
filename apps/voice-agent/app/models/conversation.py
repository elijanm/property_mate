"""MongoDB models for call sessions and conversation history."""
from datetime import datetime, timezone
from typing import Any, Optional
import uuid


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


# ── Embedded sub-documents ────────────────────────────────────────────────────

def make_transcript_turn(role: str, content: str) -> dict:
    """role: 'user' | 'assistant' | 'tool'"""
    return {
        "id": _new_id(),
        "role": role,
        "content": content,
        "timestamp": _utcnow().isoformat(),
    }


def make_tool_call_record(
    name: str,
    arguments: dict,
    result: Any,
    *,
    error: str | None = None,
) -> dict:
    return {
        "id": _new_id(),
        "name": name,
        "arguments": arguments,
        "result": result,
        "error": error,
        "timestamp": _utcnow().isoformat(),
    }


# ── Call Session document ─────────────────────────────────────────────────────

class CallSessionDocument:
    """Factory for call_sessions MongoDB documents."""

    COLLECTION = "call_sessions"

    @staticmethod
    def new(
        *,
        call_control_id: str,
        caller_number: str,
        called_number: str,
        org_id: str | None = None,
        tenant_id: str | None = None,
        tenant_name: str | None = None,
        auto_mode: bool = False,
    ) -> dict:
        now = _utcnow()
        return {
            "_id": _new_id(),
            "call_control_id": call_control_id,
            "caller_number": caller_number,
            "called_number": called_number,
            "org_id": org_id,
            "tenant_id": tenant_id,
            "tenant_name": tenant_name,
            "status": "active",          # active | completed | failed | transferred | abandoned
            "auto_mode": auto_mode,
            "recording_enabled": False,  # updated once recording starts
            "recording_key": None,       # S3 key
            "transcript": [],            # list of transcript turns
            "tool_calls": [],            # list of tool call records
            "api_calls": [],             # list of API call audit records
            "summary": None,             # LLM-generated summary at call end
            "sentiment": None,           # positive | neutral | negative
            "actions_taken": [],         # human-readable list of actions performed
            "quality_score": None,       # 0–100 computed at call end
            "keyword_alerts": [],        # list of {keyword, context, timestamp}
            "metrics": None,             # token/cost breakdown dict
            "started_at": now,
            "ended_at": None,
            "duration_seconds": None,
            "created_at": now,
            "updated_at": now,
        }

    @staticmethod
    def end_update(
        *,
        status: str = "completed",
        duration_seconds: int | None = None,
        summary: str | None = None,
        sentiment: str | None = None,
        actions_taken: list[str] | None = None,
        recording_key: str | None = None,
        quality_score: int | None = None,
    ) -> dict:
        now = _utcnow()
        update: dict = {
            "$set": {
                "status": status,
                "ended_at": now,
                "updated_at": now,
            }
        }
        if duration_seconds is not None:
            update["$set"]["duration_seconds"] = duration_seconds
        if summary is not None:
            update["$set"]["summary"] = summary
        if sentiment is not None:
            update["$set"]["sentiment"] = sentiment
        if actions_taken is not None:
            update["$set"]["actions_taken"] = actions_taken
        if recording_key is not None:
            update["$set"]["recording_key"] = recording_key
        if quality_score is not None:
            update["$set"]["quality_score"] = quality_score
        return update
