"""mldock_job_status — poll a training job's status."""
import json
from mcp.types import Tool

from ..client import mldock_request, ApiError

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}

TOOL_DEF = Tool(
    name="mldock_job_status",
    description=(
        "Check the status of a training job. "
        "Returns is_terminal=true when the job has finished (completed, failed, or cancelled). "
        "Poll until is_terminal=true — but stop after 20 polls to avoid infinite loops."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "job_id": {
                "type": "string",
                "description": "Job ID returned by mldock_trigger_training.",
            },
        },
        "required": ["job_id"],
    },
)


async def handle(args: dict) -> str:
    job_id = args["job_id"]
    try:
        result = await mldock_request("GET", f"/training/jobs/{job_id}")
    except ApiError as e:
        if e.status == 404:
            return json.dumps({"ok": False, "error": f"Job '{job_id}' not found."})
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    status = result.get("status", "unknown")
    is_terminal = status in TERMINAL_STATUSES
    metrics = result.get("metrics", {})
    error = result.get("error")

    response: dict = {
        "ok": True,
        "job_id": job_id,
        "status": status,
        "is_terminal": is_terminal,
        "trainer_name": result.get("trainer_name"),
        "compute_type": result.get("compute_type"),
        "created_at": result.get("created_at"),
        "started_at": result.get("started_at"),
        "finished_at": result.get("finished_at"),
    }

    if metrics:
        response["metrics"] = metrics

    if error:
        response["error"] = error
        response["hint"] = "Check the trainer code for bugs or data issues, then re-upload and re-trigger."

    if status == "completed" and metrics:
        response["message"] = f"Training complete. Metrics: {', '.join(f'{k}={v:.4f}' if isinstance(v, float) else f'{k}={v}' for k, v in metrics.items())}"
    elif status == "running":
        response["message"] = "Job is running. Call mldock_job_status again to check for updates."
    elif status == "queued":
        response["message"] = "Job is queued. Call mldock_job_status again in a few seconds."

    return json.dumps(response)
