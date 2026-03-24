"""mldock_get_trainer — get full details for a specific neuron."""
import json
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_get_trainer",
    description="Get full details for a specific neuron by name. Requires login.",
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Neuron name (snake_case slug, e.g. churn_predictor).",
            },
        },
        "required": ["name"],
    },
)


async def handle(args: dict) -> str:
    name = args["name"]
    try:
        result = await mldock_request("GET", f"/trainers/{name}")
    except ApiError as e:
        if e.status == 404:
            return json.dumps({"ok": False, "error": f"Neuron '{name}' not found. Use mldock_list_trainers to see available neurons."})
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    return json.dumps({"ok": True, "neuron": result})
