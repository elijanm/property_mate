"""mldock_list_trainers — list registered neurons in the current org."""
import json
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_list_trainers",
    description="List ML neurons registered in the current MLDock org. Requires login.",
    inputSchema={
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["active", "inactive", "all"],
                "default": "all",
                "description": "Filter by active status.",
            },
        },
        "required": [],
    },
)


async def handle(args: dict) -> str:
    params = ""
    status = args.get("status", "all")
    if status == "active":
        params = "?is_active=true"
    elif status == "inactive":
        params = "?is_active=false"

    try:
        result = await mldock_request("GET", f"/trainers{params}")
    except ApiError as e:
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    items = result if isinstance(result, list) else result.get("items", [])
    simplified = [
        {
            "name": t.get("name"),
            "version_full": t.get("version_full"),
            "framework": t.get("framework"),
            "is_active": t.get("is_active"),
            "approval_status": t.get("approval_status"),
            "description": t.get("description", "")[:80],
        }
        for t in items
    ]

    return json.dumps({"ok": True, "total": len(simplified), "neurons": simplified})
