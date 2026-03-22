"""Celery task: install pip packages approved by an admin."""
import asyncio
import subprocess
import sys
from typing import List

import structlog

from app.core.celery_app import celery_app
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)


def _run_async(coro):
    return _loop.run_until_complete(coro)


@celery_app.task(name="install_packages", bind=True, max_retries=1)
def install_packages(self, ticket_id: str, packages: List[str], trainer_name: str = ""):
    """Install pip packages in the background and update the AdminTicket on completion."""
    logger.info("package_install_started", ticket_id=ticket_id, packages=packages)

    async def _update_ticket(status: str, result_msg: str):
        from app.models.admin_ticket import AdminTicket
        from bson import ObjectId
        try:
            ticket = await AdminTicket.get(ticket_id)
            if ticket:
                await ticket.set({
                    "status": status,
                    "metadata": {**ticket.metadata, "install_result": result_msg},
                    "updated_at": utc_now(),
                })
        except Exception as exc:
            logger.warning("package_install_ticket_update_failed", ticket_id=ticket_id, error=str(exc))

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *packages],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            logger.info("package_install_succeeded", packages=packages, trainer=trainer_name)
            _run_async(_update_ticket("resolved", f"Installed: {', '.join(packages)}"))
        else:
            err = result.stderr[-500:] if result.stderr else "unknown error"
            logger.error("package_install_failed", packages=packages, stderr=err)
            _run_async(_update_ticket("open", f"Install failed: {err}"))
    except subprocess.TimeoutExpired:
        logger.error("package_install_timeout", packages=packages)
        _run_async(_update_ticket("open", "Install timed out after 5 minutes"))
    except Exception as exc:
        logger.error("package_install_error", packages=packages, error=str(exc))
        _run_async(_update_ticket("open", f"Error: {exc}"))
