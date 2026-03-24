"""mldock_login — browser-based device flow: request link and return immediately."""
import json

from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_login",
    description=(
        "Start browser-based login to MLDock. "
        "Returns a login_url for the user to open in their browser and a device_code. "
        "After showing the URL to the user, call mldock_check_login(device_code) to check "
        "if they have authorized. No password is ever required."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "base_url": {
                "type": "string",
                "description": (
                    "MLDock API base URL, e.g. https://www.mldock.io. "
                    "Defaults to the MLDOCK_BASE_URL environment variable."
                ),
            },
        },
        "required": [],
    },
)


async def handle(args: dict) -> str:
    base_url = args.get("base_url", "").rstrip("/") or None

    if base_url:
        from .. import constants
        constants.DEFAULT_BASE_URL = base_url

    try:
        result = await mldock_request(
            "POST",
            "/auth/cli-session/request",
            require_auth=False,
        )
    except ApiError as e:
        return json.dumps({"ok": False, "error": f"Cannot reach MLDock server: {e.message}"})

    device_code = result.get("device_code")
    login_url = result.get("login_url")
    expires_in = result.get("expires_in", 300)

    if not device_code or not login_url:
        return json.dumps({"ok": False, "error": "Server did not return a login URL."})

    # Open browser automatically
    try:
        import webbrowser
        webbrowser.open(login_url)
    except Exception:
        pass  # Non-fatal — user can open manually

    return json.dumps({
        "ok": True,
        "login_url": login_url,
        "device_code": device_code,
        "expires_in": expires_in,
        "next_step": (
            f"Show the user this link: {login_url} — "
            f"then call mldock_check_login with device_code={device_code!r} to confirm."
        ),
    })
