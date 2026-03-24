"""mldock_trigger_training — start a training job for a registered neuron."""
import json
from typing import Optional
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_trigger_training",
    description=(
        "Start a training job for a registered, approved neuron. "
        "Returns a job_id to track progress with mldock_job_status. "
        "Requires engineer or admin role."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "trainer_name": {
                "type": "string",
                "description": "Name of the registered neuron (must be approved).",
            },
            "compute_type": {
                "type": "string",
                "enum": ["local", "cloud_gpu"],
                "default": "local",
                "description": "local uses the server's CPU/GPU. cloud_gpu spins up a cloud instance (requires wallet balance).",
            },
            "gpu_type_id": {
                "type": "string",
                "description": "Cloud GPU type ID (only for compute_type=cloud_gpu). Leave empty for local.",
            },
            "dataset_slug_override": {
                "type": "string",
                "description": "Override the neuron's default dataset slug to train on a different dataset.",
            },
            "config_overrides": {
                "type": "object",
                "description": "Training config overrides: { max_epochs, learning_rate, batch_size, ... }",
            },
        },
        "required": ["trainer_name"],
    },
)


async def handle(args: dict) -> str:
    body: dict = {
        "trainer_name": args["trainer_name"],
        "compute_type": args.get("compute_type", "local"),
    }
    if args.get("gpu_type_id"):
        body["gpu_type_id"] = args["gpu_type_id"]
    if args.get("dataset_slug_override"):
        body["dataset_slug_override"] = args["dataset_slug_override"]
    if args.get("config_overrides"):
        body["config_overrides"] = args["config_overrides"]

    try:
        result = await mldock_request("POST", "/training/start", json_body=body, timeout=30.0)
    except ApiError as e:
        if e.status == 402:
            return json.dumps({
                "ok": False,
                "error": "Insufficient wallet balance for cloud GPU training. Top up your MLDock wallet.",
            })
        if e.status == 404:
            return json.dumps({
                "ok": False,
                "error": f"Neuron '{args['trainer_name']}' not found or not approved.",
                "hint": "Use mldock_list_trainers to check the neuron's approval_status.",
            })
        return json.dumps({"ok": False, "error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    job_id = result.get("job_id") or result.get("id")
    return json.dumps({
        "ok": True,
        "job_id": job_id,
        "status": result.get("status", "queued"),
        "trainer_name": args["trainer_name"],
        "message": f"Neuron training job queued (id: {job_id}). Call mldock_job_status to track progress.",
    })
