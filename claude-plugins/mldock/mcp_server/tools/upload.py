"""mldock_upload_trainer — upload a .py neuron file to MLDock via multipart POST."""
import json
from pathlib import Path
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_upload_trainer",
    description=(
        "Upload a local .py neuron file to the MLDock platform to register it. "
        "Requires engineer or admin role. "
        "Returns the neuron name and approval status."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute or relative path to the .py neuron file.",
            },
        },
        "required": ["file_path"],
    },
)


async def handle(args: dict) -> str:
    file_path = Path(args["file_path"]).expanduser().resolve()

    if not file_path.exists():
        return json.dumps({"ok": False, "error": f"File not found: {file_path}"})

    if file_path.suffix != ".py":
        return json.dumps({"ok": False, "error": "Only .py files can be uploaded."})

    code = file_path.read_text(encoding="utf-8")

    # Client-side syntax check before spending a round-trip
    try:
        compile(code, file_path.name, "exec")
    except SyntaxError as e:
        return json.dumps({
            "ok": False,
            "error": f"SyntaxError on line {e.lineno}: {e.msg}",
            "hint": "Fix the syntax error before uploading.",
        })

    files = {
        "file": (file_path.name, code.encode("utf-8"), "text/x-python"),
    }

    try:
        result = await mldock_request("POST", "/trainers/upload", files=files, timeout=60.0)
    except ApiError as e:
        if e.status == 400:
            # Could be a security violation — surface clearly
            return json.dumps({
                "ok": False,
                "error": str(e.message),
                "hint": (
                    "Security violations detected. Neuron code must not use: "
                    "subprocess, socket, os.system, eval/exec with dynamic strings, "
                    "__import__, ctypes, or pickle.loads. "
                    "Use mldock_chat to fix these issues."
                ),
            })
        return json.dumps({"ok": False, "error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    trainer = result.get("trainer") or {}
    approval = trainer.get("approval_status", "unknown")

    msg = f"Uploaded {file_path.name}. Neuron '{trainer.get('name', file_path.stem)}' registered."
    if approval == "pending_review":
        msg += " Approval status: pending_review — an admin must approve before training."
    elif approval == "approved":
        msg += " Status: approved — ready to train."

    return json.dumps({
        "ok": True,
        "message": msg,
        "neuron": {
            "name": trainer.get("name"),
            "version_full": trainer.get("version_full"),
            "framework": trainer.get("framework"),
            "approval_status": approval,
            "is_active": trainer.get("is_active"),
        },
        "neurons_registered": result.get("trainers_registered", 1),
    })
