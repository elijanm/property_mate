"""mldock_check_login — poll for browser login authorization."""
import json

from mcp.types import Tool

from ..auth import save_session
from ..client import mldock_request, ApiError
from ..constants import DEFAULT_BASE_URL

TOOL_DEF = Tool(
    name="mldock_check_login",
    description=(
        "Check if the user has authorized the browser login started by mldock_login. "
        "Call this after showing the login_url to the user. "
        "Returns status: 'pending' (not yet authorized) or 'authorized' (session saved). "
        "Call every few seconds until authorized or expired."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "device_code": {
                "type": "string",
                "description": "The device_code returned by mldock_login.",
            },
        },
        "required": ["device_code"],
    },
)


async def handle(args: dict) -> str:
    device_code = args["device_code"]

    try:
        poll = await mldock_request(
            "GET",
            f"/auth/cli-session/poll/{device_code}",
            require_auth=False,
        )
    except ApiError as e:
        if e.status == 404:
            return json.dumps({"status": "expired", "error": "Device code expired. Run /mldock-login again."})
        return json.dumps({"status": "error", "error": str(e.message)})

    if poll.get("status") == "authorized":
        token = poll.get("token")
        user = poll.get("user", {})
        save_session(token, user, DEFAULT_BASE_URL)
        return json.dumps({
            "status": "authorized",
            "ok": True,
            "message": (
                f"Logged in as {user.get('email', '?')} "
                f"(role: {user.get('role', 'unknown')}, org: {user.get('org_id', 'unknown')})"
            ),
            "user": {
                "email": user.get("email"),
                "role": user.get("role"),
                "org_id": user.get("org_id"),
                "user_id": user.get("user_id"),
            },
        })

    return json.dumps({"status": "pending", "message": "Waiting for browser authorization…"})
