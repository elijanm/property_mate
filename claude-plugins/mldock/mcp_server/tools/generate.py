"""mldock_generate_trainer — AI-generate a BaseTrainer subclass (neuron) via MLDock's /ai-generate endpoint."""
import json
import re
from mcp.types import Tool

from ..client import mldock_request, ApiError

TOOL_DEF = Tool(
    name="mldock_generate_trainer",
    description=(
        "Use MLDock's AI to generate a complete, runnable BaseTrainer subclass (neuron) from a description. "
        "Returns Python source code ready to write to disk with mldock_write_trainer_file. "
        "Requires the user to be logged in."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": (
                    "Natural language description of the neuron: what it predicts, "
                    "what the input data looks like, any specific model requirements."
                ),
            },
            "framework": {
                "type": "string",
                "enum": ["sklearn", "pytorch", "tensorflow", "xgboost", "auto"],
                "default": "auto",
                "description": "ML framework to use. 'auto' lets the AI decide.",
            },
            "trainer_name": {
                "type": "string",
                "description": (
                    "snake_case class name for the neuron, e.g. churn_predictor. "
                    "Optional — AI will infer from the description if omitted."
                ),
            },
            "data_source_type": {
                "type": "string",
                "enum": ["dataset", "upload", "s3", "url", "huggingface", "memory"],
                "default": "dataset",
                "description": "How training data is supplied.",
            },
        },
        "required": ["description"],
    },
)


def _suggest_filename(code: str, fallback: str = "generated_trainer.py") -> str:
    """Derive snake_case filename from the class name in the generated code."""
    m = re.search(r"class\s+(\w+)\s*\(BaseTrainer\)", code)
    if not m:
        m = re.search(r"class\s+(\w+)", code)
    if not m:
        return fallback
    name = m.group(1)
    # PascalCase → snake_case
    snake = re.sub(r"([A-Z][a-z]+)", r"_\1", name).strip("_").lower()
    snake = re.sub(r"_+", "_", snake)
    return snake + ".py"


async def handle(args: dict) -> str:
    description = args["description"]
    framework = args.get("framework", "auto")
    trainer_name = args.get("trainer_name", "")
    data_source_type = args.get("data_source_type", "dataset")

    body: dict = {
        "description": description,
        "framework": framework,
        "data_source_type": data_source_type,
    }
    if trainer_name:
        body["class_name"] = trainer_name

    try:
        result = await mldock_request("POST", "/ml/ai-generate", json_body=body)
    except ApiError as e:
        return json.dumps({"error": str(e.message), "status": e.status})

    if isinstance(result, dict) and result.get("auth_error"):
        return json.dumps(result)

    code: str = result.get("code", "")
    suggested_filename = _suggest_filename(code, fallback=f"{trainer_name or 'trainer'}.py")

    return json.dumps({
        "ok": True,
        "code": code,
        "suggested_filename": suggested_filename,
        "model": result.get("model"),
        "tokens": result.get("tokens"),
        "debug": result.get("debug", {}),
        "line_count": len(code.splitlines()),
    })
