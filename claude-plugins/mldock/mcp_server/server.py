"""MLDock MCP server — stdio transport.

Exposes 12 tools for generating, writing, uploading, and managing ML neurons
on the MLDock platform directly from Claude Code.

Start via:
    python -m mcp_server.server
or via the `mldock-mcp` console script installed by pyproject.toml.
"""
import asyncio
import json
import logging
import sys

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
from mcp.types import TextContent

from .tools import ALL_TOOLS

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)

app = Server("mldock")

# Build lookup from tool name → handler
_HANDLERS: dict = {tool_def.name: handler for tool_def, handler in ALL_TOOLS}
_TOOL_DEFS: list = [tool_def for tool_def, _ in ALL_TOOLS]


@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return _TOOL_DEFS


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    handler = _HANDLERS.get(name)
    if not handler:
        raise ValueError(f"Unknown tool: {name}")

    try:
        result_str = await handler(arguments or {})
    except Exception as exc:
        result_str = json.dumps({"error": str(exc)})

    return [TextContent(type="text", text=result_str)]


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options(),
        )


def main_sync() -> None:
    """Entry point for the mldock-mcp console script."""
    asyncio.run(main())


if __name__ == "__main__":
    main_sync()
