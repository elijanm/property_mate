"""mldock_chat — multi-turn AI trainer design chat via MLDock's /ai-chat endpoint."""
import json
from typing import Optional
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_chat",
    description=(
        "Have a multi-turn AI conversation to design or refine a trainer. "
        "Pass the current code to get targeted improvements. "
        "Maintains conversation history via conversation_id. "
        "Requires the user to be logged in."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": "Your question or refinement request (e.g. 'Add cross-validation', 'Fix the evaluate method').",
            },
            "history": {
                "type": "array",
                "description": "Prior conversation messages as [{ role: 'user'|'assistant', content: '...' }]. Pass the full history for context.",
                "items": {
                    "type": "object",
                    "properties": {
                        "role": {"type": "string", "enum": ["user", "assistant"]},
                        "content": {"type": "string"},
                    },
                    "required": ["role", "content"],
                },
                "default": [],
            },
            "current_code": {
                "type": "string",
                "description": "Current trainer Python code to include as context for refinement. Optional.",
            },
            "framework": {
                "type": "string",
                "enum": ["sklearn", "pytorch", "tensorflow", "xgboost", "auto"],
                "default": "auto",
            },
            "data_source_type": {
                "type": "string",
                "enum": ["dataset", "upload", "s3", "url", "huggingface", "memory"],
                "default": "dataset",
            },
            "generate_now": {
                "type": "boolean",
                "description": "Set true to force immediate code generation regardless of conversation state.",
                "default": False,
            },
        },
        "required": ["message"],
    },
)


async def handle(args: dict) -> str:
    message = args["message"]
    history = args.get("history", [])
    current_code: Optional[str] = args.get("current_code")
    framework = args.get("framework", "auto")
    data_source_type = args.get("data_source_type", "dataset")
    generate_now = args.get("generate_now", False)

    # Build messages array: history + new user message
    messages = list(history)
    if current_code and not any(current_code in m.get("content", "") for m in messages):
        # Prepend code context to first user message if not already present
        messages = [{"role": "user", "content": f"Current trainer code:\n```python\n{current_code}\n```"}] + messages
    messages.append({"role": "user", "content": message})

    body = {
        "messages": messages,
        "framework": framework,
        "data_source_type": data_source_type,
        "generate_now": generate_now,
    }

    try:
        result = await mldock_request("POST", "/ml/ai-chat", json_body=body, timeout=120.0)
    except ApiError as e:
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    # Build updated history for the caller to pass back next turn
    updated_history = messages + [{"role": "assistant", "content": result.get("message", "")}]

    return json.dumps({
        "ok": True,
        "message": result.get("message", ""),
        "code": result.get("code"),
        "filename": result.get("filename"),
        "has_code": result.get("has_code", False),
        "suggestions": result.get("suggestions", []),
        "history": updated_history,  # pass this back as `history` in the next mldock_chat call
    })
