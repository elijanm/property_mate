"""mldock_write_trainer_file — syntax-check and write a trainer .py file to the workspace."""
import json
import os
from pathlib import Path
from mcp.types import Tool

TOOL_DEF = Tool(
    name="mldock_write_trainer_file",
    description=(
        "Write a trainer Python file to the local workspace. "
        "Runs a syntax check before writing — will not write a file that fails to compile. "
        "Always use this instead of the built-in Write tool for trainer files."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Filename to write, e.g. churn_predictor.py. Must end in .py.",
            },
            "code": {
                "type": "string",
                "description": "Full Python source code of the trainer.",
            },
            "directory": {
                "type": "string",
                "description": "Directory to write the file into. Defaults to current working directory.",
                "default": ".",
            },
            "overwrite": {
                "type": "boolean",
                "description": "Whether to overwrite an existing file. Defaults to false.",
                "default": False,
            },
        },
        "required": ["filename", "code"],
    },
)


async def handle(args: dict) -> str:
    filename: str = args["filename"]
    code: str = args["code"]
    directory: str = args.get("directory", ".") or "."
    overwrite: bool = args.get("overwrite", False)

    if not filename.endswith(".py"):
        return json.dumps({"ok": False, "error": f"Filename must end in .py, got: {filename}"})

    # Resolve absolute path
    base_dir = Path(directory).expanduser().resolve()
    dest = base_dir / filename

    if dest.exists() and not overwrite:
        return json.dumps({
            "ok": False,
            "error": f"{dest} already exists. Set overwrite: true to replace it.",
        })

    # Syntax check before touching disk
    try:
        compile(code, filename, "exec")
    except SyntaxError as e:
        return json.dumps({
            "ok": False,
            "error": f"SyntaxError on line {e.lineno}: {e.msg}",
            "line": e.lineno,
            "hint": "Use mldock_chat to fix the syntax error before writing.",
        })

    # Write
    base_dir.mkdir(parents=True, exist_ok=True)
    dest.write_text(code, encoding="utf-8")
    lines = len(code.splitlines())

    return json.dumps({
        "ok": True,
        "path": str(dest),
        "filename": filename,
        "lines": lines,
        "message": f"Written to {dest} ({lines} lines).",
    })
