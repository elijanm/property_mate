"""In-process registry of active Pipecat pipeline tasks.

Allows any endpoint to hang up a running call (browser or Telnyx) by
queuing an EndFrame into the active PipelineTask — no Telnyx API needed
for browser-based calls.
"""
from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)

# call_control_id -> PipelineTask
_active: dict = {}


def register(call_control_id: str, task) -> None:
    _active[call_control_id] = task


def unregister(call_control_id: str) -> None:
    _active.pop(call_control_id, None)


async def hangup(call_control_id: str) -> bool:
    """Queue an EndFrame into the task. Returns True if task was found."""
    task = _active.get(call_control_id)
    if not task:
        return False
    try:
        from pipecat.frames.frames import EndFrame
        await task.queue_frame(EndFrame())
        logger.info("active_call_hangup", call_control_id=call_control_id, status="success")
        return True
    except Exception as exc:
        logger.warning("active_call_hangup_failed", call_control_id=call_control_id, error=str(exc))
        return False
