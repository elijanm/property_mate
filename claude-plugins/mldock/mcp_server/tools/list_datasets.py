"""mldock_list_datasets — list available datasets in the current org."""
import json
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_list_datasets",
    description="List datasets available in the current MLDock org. Requires login.",
    inputSchema={"type": "object", "properties": {}, "required": []},
)


async def handle(args: dict) -> str:
    try:
        result = await mldock_request("GET", "/datasets")
    except ApiError as e:
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    items = result if isinstance(result, list) else result.get("items", [])
    simplified = [
        {
            "id": d.get("id"),
            "slug": d.get("slug"),
            "name": d.get("name"),
            "description": (d.get("description") or "")[:80],
            "category": d.get("category"),
            "entry_count": d.get("entry_count", 0),
        }
        for d in items
    ]

    return json.dumps({"ok": True, "total": len(simplified), "datasets": simplified})
