"""RunPod On-Demand Pod GPU provider.

Flow
----
1. Create an on-demand pod via RunPod GraphQL API.
2. Pod runs a self-contained bootstrap script (passed as env var):
   a. Installs runtime deps (boto3, scikit-learn …)
   b. Loads the trainer from an env-var–encoded source file.
   c. Runs training.
   d. Uploads model.pkl + metrics.json to S3/MinIO.
   e. Exits (container stops naturally).
3. Poll pod status via GraphQL until container exits.
4. Download results from S3.
5. Terminate (delete) the pod.

Config env vars
---------------
RUNPOD_API_KEY          RunPod API key
RUNPOD_GPU_TYPE         GPU type id, e.g. "NVIDIA GeForce RTX 3090"
RUNPOD_CONTAINER_DISK   Container disk in GB (default 20)
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

_GQL = "https://api.runpod.io/graphql"

# ─── Bootstrap script ──────────────────────────────────────────────────────
# Executed inside the pod container. Passed as BOOT_B64 env var and run with:
#   python3 -c "import os,base64; exec(base64.b64decode(os.environ['BOOT_B64']).decode())"
_BOOTSTRAP = r"""
import base64, importlib.util, json, os, pickle, subprocess, sys

# Install runtime dependencies
subprocess.check_call(
    [sys.executable, "-m", "pip", "install", "-q",
     "boto3", "scikit-learn", "numpy", "pandas"],
    stdout=subprocess.DEVNULL,
)
import boto3  # noqa: E402 — installed above

# ── decode & write trainer source ──────────────────────────────────────────
trainer_code = base64.b64decode(os.environ["TRAINER_CODE_B64"]).decode()
plugin_path  = "/tmp/_trainer_plugin.py"
with open(plugin_path, "w") as fh:
    fh.write(trainer_code)

spec = importlib.util.spec_from_file_location("_trainer_plugin", plugin_path)
mod  = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

trainer_cls = next(
    (getattr(mod, n) for n in dir(mod)
     if isinstance(getattr(mod, n), type) and hasattr(getattr(mod, n), "train")),
    None,
)
if trainer_cls is None:
    raise RuntimeError("No trainer class found in plugin")

# ── training data + config ──────────────────────────────────────────────────
raw_data = os.environ.get("TRAINING_DATA_B64", "")
injected = base64.b64decode(raw_data) if raw_data else None
config   = json.loads(os.environ.get("TRAINER_CONFIG", "{}"))

# ── train ───────────────────────────────────────────────────────────────────
trainer = trainer_cls(config=config)
model, metrics = trainer.train(data=injected)
model_bytes = pickle.dumps(model)
print(json.dumps({"metrics": metrics}), flush=True)

# ── upload results to S3 ────────────────────────────────────────────────────
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    aws_access_key_id=os.environ["S3_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET"],
    region_name="us-east-1",
)
bucket = os.environ["S3_BUCKET"]
prefix = os.environ["RESULT_PREFIX"]
s3.put_object(Bucket=bucket, Key=f"{prefix}/model.pkl",    Body=model_bytes)
s3.put_object(Bucket=bucket, Key=f"{prefix}/metrics.json", Body=json.dumps(metrics).encode())
print("upload_done", flush=True)
"""


def _b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


# ─── GraphQL fragments ─────────────────────────────────────────────────────

_CREATE_POD = """
mutation($input: PodFindAndDeployOnDemandInput!) {
  podFindAndDeployOnDemand(input: $input) {
    id
    desiredStatus
    imageName
  }
}
"""

_POD_STATUS = """
query($input: PodFilter!) {
  pod(input: $input) {
    id
    desiredStatus
    runtime {
      container { status }
    }
  }
}
"""

_TERMINATE_POD = """
mutation($input: PodTerminateInput!) {
  podTerminate(input: $input)
}
"""


class RunPodProvider(BaseGpuProvider):
    name = "runpod"

    def __init__(self, api_key: str, container_disk_gb: int = 20):
        self.api_key = api_key
        self.container_disk_gb = container_disk_gb

    # ── helpers ──────────────────────────────────────────────────────────────

    async def _gql(self, query: str, variables: dict) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_GQL}?api_key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json={"query": query, "variables": variables},
            )
            resp.raise_for_status()
            body = resp.json()
        if "errors" in body:
            raise RuntimeError(f"RunPod GraphQL error: {body['errors']}")
        return body["data"]

    # ── BaseGpuProvider interface ─────────────────────────────────────────────

    async def dispatch(
        self,
        trainer_name: str,
        trainer_code: str,
        config: dict,
        injected_data: Optional[bytes],
        org_id: str,
        job_id: str,
        gpu_type_id: Optional[str] = None,
    ) -> RemoteJobHandle:
        from app.core.config import settings

        result_prefix = (
            f"{org_id}/cloud_training/{job_id}" if org_id else f"cloud_training/{job_id}"
        )

        # Pod startup command — executes BOOT_B64 inline via exec()
        docker_cmd = (
            "bash -c 'python3 -c "
            '"import os,base64; exec(base64.b64decode(os.environ[\\"BOOT_B64\\"]).decode())"'
            "'"
        )

        env = [
            {"key": "BOOT_B64",         "value": _b64(_BOOTSTRAP)},
            {"key": "TRAINER_CODE_B64", "value": base64.b64encode(trainer_code.encode()).decode()},
            {"key": "TRAINER_CONFIG",   "value": json.dumps(config)},
            {"key": "JOB_ID",           "value": job_id},
            {"key": "ORG_ID",           "value": org_id},
            {"key": "S3_ENDPOINT",      "value": settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL},
            {"key": "S3_BUCKET",        "value": settings.S3_BUCKET},
            {"key": "S3_KEY_ID",        "value": settings.S3_ACCESS_KEY},
            {"key": "S3_SECRET",        "value": settings.S3_SECRET_KEY},
            {"key": "RESULT_PREFIX",    "value": result_prefix},
        ]
        if injected_data:
            env.append({
                "key": "TRAINING_DATA_B64",
                "value": base64.b64encode(injected_data).decode(),
            })

        from app.services.gpu_providers.gpu_catalog import GPU_OPTIONS
        resolved_gpu = gpu_type_id or GPU_OPTIONS[0]["id"]

        variables = {
            "input": {
                "gpuTypeId":         resolved_gpu,
                "name":              f"pms-train-{job_id[:8]}",
                "imageName":         "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04",
                "gpuCount":          1,
                "volumeInGb":        0,
                "containerDiskInGb": self.container_disk_gb,
                "dockerArgs":        docker_cmd,
                "env":               env,
                "startSsh":          False,
                "supportPublicIp":   False,
            }
        }

        data   = await self._gql(_CREATE_POD, variables)
        pod_id = data["podFindAndDeployOnDemand"]["id"]
        logger.info("runpod_pod_created", pod_id=pod_id, trainer=trainer_name, gpu=resolved_gpu)
        return RemoteJobHandle(
            provider="runpod",
            remote_id=pod_id,
            extra={"result_prefix": result_prefix},
        )

    async def get_status(self, handle: RemoteJobHandle) -> RemoteJobStatus:
        data = await self._gql(_POD_STATUS, {"input": {"podId": handle.remote_id}})
        pod  = data.get("pod") or {}

        desired   = pod.get("desiredStatus", "")
        runtime   = pod.get("runtime")
        container = ((runtime or {}).get("container") or {})
        c_status  = container.get("status", "")

        # Container exited — training finished
        if c_status == "EXITED":
            return RemoteJobStatus(state="completed")

        # Pod has no runtime and desired state says it's done
        if runtime is None and desired in ("EXITED", "TERMINATED", ""):
            return RemoteJobStatus(state="completed")

        if desired in ("FAILED", "DEAD"):
            return RemoteJobStatus(state="failed", error="Pod entered failed/dead state")

        return RemoteJobStatus(state="running")

    async def get_result(self, handle: RemoteJobHandle) -> RemoteTrainingResult:
        """Download model + metrics from S3, then delete the pod."""
        from app.core.config import settings
        import aioboto3

        result_prefix = handle.extra.get("result_prefix", f"cloud_training/{handle.remote_id}")
        s3_endpoint   = settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL

        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=s3_endpoint,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        ) as s3:
            try:
                obj         = await s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{result_prefix}/model.pkl")
                model_bytes = await obj["Body"].read()
            except Exception:
                model_bytes = None

            try:
                obj     = await s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{result_prefix}/metrics.json")
                raw     = await obj["Body"].read()
                metrics = json.loads(raw)
            except Exception:
                metrics = {}

        # Always delete the pod after fetching results
        await self.cancel(handle)

        return RemoteTrainingResult(
            metrics=metrics,
            model_bytes=model_bytes,
            model_s3_key=f"{result_prefix}/model.pkl" if model_bytes else None,
            log_lines=[],
        )

    async def cancel(self, handle: RemoteJobHandle) -> None:
        """Terminate and delete the pod."""
        try:
            await self._gql(_TERMINATE_POD, {"input": {"podId": handle.remote_id}})
            logger.info("runpod_pod_terminated", pod_id=handle.remote_id)
        except Exception as exc:
            logger.warning("runpod_pod_terminate_failed", pod_id=handle.remote_id, error=str(exc))
