"""mldock_list_deployments — list deployed models in the current org."""
import json
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_list_deployments",
    description="List deployed ML models (trained model versions) in the current MLDock org. Requires login.",
    inputSchema={
        "type": "object",
        "properties": {
            "trainer_name": {
                "type": "string",
                "description": "Filter deployments by trainer name. Optional.",
            },
        },
        "required": [],
    },
)


async def handle(args: dict) -> str:
    params = ""
    if args.get("trainer_name"):
        from urllib.parse import quote
        params = f"?trainer_name={quote(args['trainer_name'])}"

    try:
        result = await mldock_request("GET", f"/models{params}")
    except ApiError as e:
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    items = result if isinstance(result, list) else result.get("items", [])
    simplified = [
        {
            "id": d.get("id"),
            "trainer_name": d.get("trainer_name"),
            "version_full": d.get("version_full"),
            "status": d.get("status"),
            "is_default": d.get("is_default"),
            "deployed_at": d.get("deployed_at") or d.get("created_at"),
            "metrics": d.get("metrics", {}),
        }
        for d in items
    ]

    return json.dumps({"ok": True, "total": len(simplified), "deployments": simplified})
