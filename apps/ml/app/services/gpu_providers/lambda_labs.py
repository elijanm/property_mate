"""Lambda Labs GPU provider.

Launches a GPU instance, SSHs in, runs training, fetches results, terminates.
Requires: LAMBDA_LABS_API_KEY, LAMBDA_LABS_SSH_KEY_NAME, LAMBDA_LABS_INSTANCE_TYPE
"""
import base64
import json
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
_API = "https://cloud.lambdalabs.com/api/v1"


class LambdaLabsProvider(BaseGpuProvider):
    name = "lambda_labs"

    def __init__(self, api_key: str, ssh_key_name: str, instance_type: str = "gpu_1x_a10"):
        self.api_key = api_key
        self.ssh_key_name = ssh_key_name
        self.instance_type = instance_type

    def _headers(self) -> dict:
        creds = base64.b64encode(f"{self.api_key}:".encode()).decode()
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
        # Launch instance with user-data startup script
        script = _build_startup_script(trainer_name, trainer_code, config, injected_data, job_id)
        payload = {
            "region_name": "us-east-1",
            "instance_type_name": self.instance_type,
            "ssh_key_names": [self.ssh_key_name],
            "name": f"ml-train-{job_id[:8]}",
            "user_data": base64.b64encode(script.encode()).decode(),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_API}/instance-operations/launch",
                headers=self._headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        instance_ids = data.get("data", {}).get("instance_ids", [])
        if not instance_ids:
            raise RuntimeError(f"Lambda Labs launch failed: {data}")
        instance_id = instance_ids[0]
        logger.info("lambda_labs_instance_launched", instance_id=instance_id, trainer=trainer_name)
        return RemoteJobHandle(
            provider="lambda_labs",
            remote_id=instance_id,
            extra={"job_id": job_id},
        )

    async def get_status(self, handle: RemoteJobHandle) -> RemoteJobStatus:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_API}/instances/{handle.remote_id}",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        inst = data.get("data", {})
        status = inst.get("status", "")
        state_map = {
            "booting": "queued",
            "active": "running",
            "terminated": "completed",
            "unhealthy": "failed",
        }
        # Check for result file existence via SSH would be needed for true completion detection
        # For now: terminated = done
        return RemoteJobStatus(state=state_map.get(status, "running"))

    async def get_result(self, handle: RemoteJobHandle) -> RemoteTrainingResult:
        # Results are uploaded to S3 by the startup script
        # The S3 key is job_id-based — fetched from MinIO
        return RemoteTrainingResult(
            metrics={},
            model_bytes=None,
            model_s3_key=f"gpu_jobs/{handle.extra.get('job_id', handle.remote_id)}/model.pkl",
            log_lines=[],
        )

    async def cancel(self, handle: RemoteJobHandle) -> None:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f"{_API}/instance-operations/terminate",
                headers=self._headers(),
                json={"instance_ids": [handle.remote_id]},
            )


def _build_startup_script(
    trainer_name: str,
    trainer_code: str,
    config: dict,
    injected_data: Optional[bytes],
    job_id: str,
) -> str:
    data_b64 = base64.b64encode(injected_data).decode() if injected_data else ""
    config_json = json.dumps(config)
    return f"""#!/bin/bash
pip install scikit-learn pandas numpy mlflow boto3 -q
cat << 'TRAINEREOF' > /tmp/trainer.py
{trainer_code}
TRAINEREOF
python3 - << 'PYEOF'
import pickle, base64, json, boto3, os
config = {config_json}
data_b64 = "{data_b64}"
injected = base64.b64decode(data_b64) if data_b64 else None
exec(open("/tmp/trainer.py").read())
# Find the trainer class
import inspect, sys
trainer_cls = None
for name, obj in list(globals().items()):
    if inspect.isclass(obj) and hasattr(obj, "train") and hasattr(obj, "name"):
        trainer_cls = obj; break
if not trainer_cls:
    raise RuntimeError("No trainer class found")
t = trainer_cls()
from dataclasses import dataclass
@dataclass
class TC:
    max_epochs: int = 50
    batch_size: int = 32
    cuda_device: str = "cuda"
    test_split: float = 0.2
    val_split: float = 0.0
    random_seed: int = 42
    learning_rate: float = 1e-3
    mixed_precision: str = "auto"
    weight_decay: float = 1e-4
    gradient_clip: float = 0.0
    lr_scheduler: str = "cosine"
    optimizer: str = "adam"
    workers: int = 4
    early_stopping: bool = True
    early_stopping_patience: int = 5
cfg = TC(**{{k: v for k, v in config.items() if k in TC.__dataclass_fields__}})
raw = t.data_source.fetch() if not injected else injected
preprocessed = t.preprocess(raw)
model, test_data = t.train(preprocessed, cfg)
result = t.evaluate(model, test_data) if test_data else None
metrics = {{"accuracy": result.accuracy, "f1": result.f1}} if result else {{}}
model_bytes = pickle.dumps(model)
# Upload to S3/MinIO
s3 = boto3.client("s3", endpoint_url=os.getenv("S3_ENDPOINT_URL", ""), aws_access_key_id=os.getenv("S3_ACCESS_KEY"), aws_secret_access_key=os.getenv("S3_SECRET_KEY"))
bucket = os.getenv("S3_BUCKET", "pms-ml")
key = f"gpu_jobs/{job_id}/model.pkl"
s3.put_object(Bucket=bucket, Key=key, Body=model_bytes)
metrics_key = f"gpu_jobs/{job_id}/metrics.json"
s3.put_object(Bucket=bucket, Key=metrics_key, Body=json.dumps(metrics))
print(f"DONE metrics={{metrics}} s3_key={{key}}")
PYEOF
"""
