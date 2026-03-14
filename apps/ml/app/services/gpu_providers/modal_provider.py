"""Modal GPU provider via REST API.

Uses Modal's /api/apps endpoint to create and run a function remotely.
Requires: MODAL_TOKEN_ID, MODAL_TOKEN_SECRET, MODAL_APP_ID (pre-created Modal app with GPU runner)
"""
import base64
from typing import Optional
import httpx
import structlog
from app.services.gpu_providers.base import (
    BaseGpuProvider,
    RemoteJobHandle,
    RemoteJobStatus,
    RemoteTrainingResult,
)

logger = structlog.get_logger(__name__)


class ModalProvider(BaseGpuProvider):
    name = "modal"

    def __init__(self, token_id: str, token_secret: str, app_id: str):
        self.token_id = token_id
        self.token_secret = token_secret
        self.app_id = app_id

    def _headers(self) -> dict:
        creds = base64.b64encode(f"{self.token_id}:{self.token_secret}".encode()).decode()
        return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

    async def dispatch(
        self,
        trainer_name: str,
        trainer_code: str,
        config: dict,
        injected_data: Optional[bytes],
        org_id: str,
        job_id: str,
    ) -> RemoteJobHandle:
        payload = {
            "function_name": "train",
            "args": [],
            "kwargs": {
                "trainer_name": trainer_name,
                "trainer_code": base64.b64encode(trainer_code.encode()).decode(),
                "config": config,
                "job_id": job_id,
                "data_b64": base64.b64encode(injected_data).decode() if injected_data else None,
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.modal.com/v1/apps/{self.app_id}/functions/train/map",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        call_id = data.get("function_call_id", "")
        logger.info("modal_job_dispatched", call_id=call_id, trainer=trainer_name)
        return RemoteJobHandle(provider="modal", remote_id=call_id)

    async def get_status(self, handle: RemoteJobHandle) -> RemoteJobStatus:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.modal.com/v1/function-calls/{handle.remote_id}",
                headers=self._headers(),
            )
            if resp.status_code == 404:
                return RemoteJobStatus(state="running")
            data = resp.json()
        state_map = {
            "pending": "queued",
            "running": "running",
            "success": "completed",
            "failure": "failed",
        }
        return RemoteJobStatus(state=state_map.get(data.get("status", "running"), "running"))

    async def get_result(self, handle: RemoteJobHandle) -> RemoteTrainingResult:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"https://api.modal.com/v1/function-calls/{handle.remote_id}/results",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        output = data.get("result", {}) or {}
        metrics = output.get("metrics", {})
        model_b64 = output.get("model_b64")
        model_bytes = base64.b64decode(model_b64) if model_b64 else None
        return RemoteTrainingResult(
            metrics=metrics,
            model_bytes=model_bytes,
            model_s3_key=None,
            log_lines=[],
        )

    async def cancel(self, handle: RemoteJobHandle) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.modal.com/v1/function-calls/{handle.remote_id}/cancel",
                headers=self._headers(),
            )
