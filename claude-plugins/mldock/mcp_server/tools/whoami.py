"""mldock_whoami — show current session without a network call."""
import json
from mcp.types import Tool

from ..auth import load_session

TOOL_DEF = Tool(
    name="mldock_whoami",
    description=(
        "Show the current MLDock session (user, role, org, base URL). "
        "No network call — reads the saved session file. "
        "Call this before any auth-required tool to verify the user is logged in."
    ),
    inputSchema={"type": "object", "properties": {}, "required": []},
)


async def handle(args: dict) -> str:
    session = load_session()
    if not session:
        return json.dumps({
            "authenticated": False,
            "message": "Not logged in. Call mldock_login or run /mldock-login.",
        })

    user = session.get("user", {})
    return json.dumps({
        "authenticated": True,
        "email": user.get("email"),
        "role": user.get("role"),
        "org_id": user.get("org_id"),
        "base_url": session.get("base_url"),
        "saved_at": session.get("saved_at"),
    })
