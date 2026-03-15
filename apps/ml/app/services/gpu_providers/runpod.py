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
import base64, importlib.util, json, os, pickle, subprocess, sys, time

_t0 = time.time()

def _ensure(*pkgs):
    missing = []
    for p in pkgs:
        import_name = p.split("==")[0].replace("-", "_")
        try:
            __import__(import_name)
        except ImportError:
            missing.append(p)
    if missing:
        print(f"[bootstrap] installing {missing}", flush=True)
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", "--no-cache-dir"] + missing,
        )
        print(f"[bootstrap] install done ({time.time()-_t0:.1f}s)", flush=True)
    else:
        print(f"[bootstrap] all deps present, skipping install", flush=True)

_ensure("boto3", "scikit-learn", "numpy", "pandas")
import boto3  # noqa: E402 — installed above

# ── reconstruct app.abstract package so trainer imports resolve ─────────────
_pkg_root = "/tmp/_pms_pkg"
for _d in [
    _pkg_root,
    f"{_pkg_root}/app",
    f"{_pkg_root}/app/abstract",
]:
    os.makedirs(_d, exist_ok=True)
    _init = f"{_d}/__init__.py"
    if not os.path.exists(_init):
        open(_init, "w").close()

import zlib as _zlib
for _env_key, _rel_path in [
    ("DATA_SOURCE_CB64",  "app/abstract/data_source.py"),
    ("BASE_TRAINER_CB64", "app/abstract/base_trainer.py"),
]:
    _raw = os.environ.get(_env_key, "")
    if _raw:
        _code = _zlib.decompress(base64.b64decode(_raw)).decode()
        with open(f"{_pkg_root}/{_rel_path}", "w") as _fh:
            _fh.write(_code)

if _pkg_root not in sys.path:
    sys.path.insert(0, _pkg_root)

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
     if isinstance(getattr(mod, n), type) and hasattr(getattr(mod, n), "train")
     and getattr(mod, n).__name__ != "BaseTrainer"),
    None,
)
if trainer_cls is None:
    raise RuntimeError("No trainer class found in plugin")

# ── training data + config ──────────────────────────────────────────────────
raw_data = os.environ.get("TRAINING_DATA_B64", "")
if raw_data:
    _raw_bytes = base64.b64decode(raw_data)
    # Try pickle deserialization first (used when data was pre-fetched from a
    # DataSource on the server).  Fall back to raw bytes for plain file uploads.
    try:
        injected = pickle.loads(_raw_bytes)
        print(f"[bootstrap] data deserialized via pickle (type={type(injected).__name__})", flush=True)
    except Exception:
        injected = _raw_bytes
        print(f"[bootstrap] data loaded as raw bytes ({len(injected)} bytes)", flush=True)
else:
    injected = None
config   = json.loads(os.environ.get("TRAINER_CONFIG", "{}"))

# ── build TrainingConfig from config dict ───────────────────────────────────
try:
    from app.abstract.base_trainer import TrainingConfig as _TC
    import dataclasses as _dc
    _known = {f.name for f in _dc.fields(_TC)}
    _tc_kwargs = {k: v for k, v in config.items() if k in _known}
    _extra = config.get("extra", {k: v for k, v in config.items() if k not in _known})
    cfg_obj = _TC(**_tc_kwargs)
    cfg_obj.extra = _extra
except Exception as _e:
    print(f"[bootstrap] TrainingConfig build failed ({_e}), using defaults", flush=True)
    try:
        from app.abstract.base_trainer import TrainingConfig as _TC
        cfg_obj = _TC()
        cfg_obj.extra = config
    except Exception:
        cfg_obj = None

# ── preprocess ──────────────────────────────────────────────────────────────
print(f"[bootstrap] starting training ({time.time()-_t0:.1f}s)", flush=True)
trainer = trainer_cls()
preprocessed = trainer.preprocess(injected)

# ── train ───────────────────────────────────────────────────────────────────
result = trainer.train(preprocessed, cfg_obj)

# Handle (model, test_data) tuple or bare model
if isinstance(result, tuple) and len(result) == 2:
    model, test_data = result
    try:
        eval_result = trainer.evaluate(model, test_data)
        metrics = {}
        for _f in ["accuracy", "precision", "recall", "f1", "roc_auc", "mse", "mae", "r2"]:
            _v = getattr(eval_result, _f, None)
            if _v is not None:
                metrics[_f] = round(float(_v), 6)
        metrics.update(eval_result.extra_metrics or {})
    except NotImplementedError:
        metrics = {}
else:
    model   = result
    metrics = {}

model_bytes = pickle.dumps(model)
print(json.dumps({"metrics": metrics}), flush=True)
print(f"[bootstrap] training done ({time.time()-_t0:.1f}s), metrics={list(metrics.keys())}", flush=True)

# ── inline model fallback: emit compressed model as base64 in stdout ─────────
# This lets the server recover the model even when S3 is unreachable (e.g. local
# MinIO behind NAT).  Only emitted when model is ≤ 4 MB compressed; larger models
# must be retrieved via S3.
import zlib as _zlib_out
_model_gz = _zlib_out.compress(model_bytes, 6)
_MODEL_INLINE_LIMIT = 4 * 1024 * 1024  # 4 MB
if len(_model_gz) <= _MODEL_INLINE_LIMIT:
    _model_b64 = base64.b64encode(_model_gz).decode()
    print(json.dumps({"model_gz_b64": _model_b64, "model_size_bytes": len(model_bytes)}), flush=True)
    print(f"[bootstrap] model emitted inline ({len(_model_gz)} bytes compressed)", flush=True)
else:
    print(f"[bootstrap] model too large for inline ({len(_model_gz)} bytes) — S3 only", flush=True)

# ── upload results to S3 ────────────────────────────────────────────────────
s3_ok = False
try:
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET"],
        region_name="us-east-1",
    )
    bucket = os.environ["S3_BUCKET"]
    prefix = os.environ["RESULT_PREFIX"]
    print(f"[bootstrap] uploading to s3://{bucket}/{prefix}/", flush=True)
    s3.put_object(Bucket=bucket, Key=f"{prefix}/model.pkl",    Body=model_bytes)
    s3.put_object(Bucket=bucket, Key=f"{prefix}/metrics.json", Body=json.dumps(metrics).encode())
    print(f"[bootstrap] upload_done ({time.time()-_t0:.1f}s)", flush=True)
    s3_ok = True
except Exception as _s3_err:
    print(f"[bootstrap] S3 upload failed: {_s3_err}", flush=True)
    if len(_model_gz) > _MODEL_INLINE_LIMIT:
        print("[bootstrap] ERROR: model too large for inline fallback and S3 unavailable", flush=True)
        raise
    print("[bootstrap] model will be recovered from inline stdout", flush=True)

print(json.dumps({"upload_ok": s3_ok}), flush=True)
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
    lastStatusChange
    runtime {
      uptimeInSeconds
      gpus {
        id
        gpuUtilPercent
        memoryUtilPercent
      }
      container {
        cpuPercent
        memoryPercent
      }
    }
  }
}
"""

_TERMINATE_POD = """
mutation($input: PodTerminateInput!) {
  podTerminate(input: $input)
}
"""

_POD_LOGS = """
query($podId: String!) {
  podLogs(podId: $podId)
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
            if not resp.is_success:
                # Read body before raising so we log the actual RunPod error message
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = resp.text
                logger.error(
                    "runpod_gql_http_error",
                    status=resp.status_code,
                    body=err_body,
                    query=query[:120],
                    variables={k: ("..." if k in ("BOOT_B64", "TRAINER_CODE_B64", "TRAINING_DATA_B64", "DATA_SOURCE_CB64", "BASE_TRAINER_CB64") else v)
                               for k, v in (variables.get("input", {}).get("env") and
                                            {e["key"]: e["value"] for e in variables["input"]["env"]}
                                            or variables).items()
                               } if "input" in variables else variables,
                )
                raise RuntimeError(
                    f"RunPod API {resp.status_code}: {err_body}"
                )
            body = resp.json()
        if "errors" in body:
            logger.error("runpod_gql_errors", errors=body["errors"])
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
        from pathlib import Path as _Path
        from app.core.config import settings

        import zlib as _zlib

        def _cb64(src: str) -> str:
            """zlib-compress then base64-encode — keeps env var size small."""
            return base64.b64encode(_zlib.compress(src.encode(), 9)).decode()

        # Minimal data_source stub — load() is never called in the pod because
        # all network data sources are pre-fetched server-side before dispatch.
        _data_source_stub = """\
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

class DataSource(ABC):
    @abstractmethod
    async def load(self, **kwargs) -> Any: ...
    @property
    @abstractmethod
    def source_type(self) -> str: ...
    def describe(self) -> Dict: return {"type": self.source_type}

@dataclass
class InMemoryDataSource(DataSource):
    data: Any = None
    @property
    def source_type(self): return "memory"
    async def load(self, **kwargs): return self.data
    def describe(self): return {"type": "memory"}

@dataclass
class UploadedFileDataSource(DataSource):
    _data: Any = field(default=None, repr=False)
    @property
    def source_type(self): return "file"
    def inject(self, data): self._data = data
    async def load(self, **kwargs):
        data = kwargs.get("injected_data") or self._data
        if data is None:
            raise ValueError("No file data injected")
        return data
    def describe(self): return {"type": "file"}

def _stub(name, stype):
    @dataclass
    class _S(DataSource):
        @property
        def source_type(self): return stype
        async def load(self, **kwargs):
            raise RuntimeError(f"{name} is not available in a cloud pod — data must be pre-fetched server-side")
    _S.__name__ = _S.__qualname__ = name
    return _S

for _n, _t in [
    ("S3DataSource","s3"), ("URLDataSource","url"), ("LocalFileDataSource","local_file"),
    ("MongoDBDataSource","mongodb"), ("PostgreSQLDataSource","postgresql"),
    ("SQLDataSource","sql"), ("HuggingFaceDataSource","huggingface"),
    ("KafkaDataSource","kafka"), ("GCSDataSource","gcs"),
    ("AzureBlobDataSource","azure_blob"), ("FTPDataSource","ftp"),
    ("PaginatedAPIDataSource","paginated_api"), ("RedisDataSource","redis"),
    ("DatasetDataSource","dataset"),
]:
    globals()[_n] = _stub(_n, _t)
"""

        # Full base_trainer.py — needed because trainers call self.auto_train_tabular(),
        # self.split_data(), etc. at runtime inside the pod.
        _abstract_dir = _Path(__file__).parent.parent.parent / "abstract"
        try:
            _base_trainer_src = (_abstract_dir / "base_trainer.py").read_text()
        except Exception:
            _base_trainer_src = ""

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
            {"key": "BOOT_B64",          "value": _b64(_BOOTSTRAP)},
            {"key": "TRAINER_CODE_B64",  "value": base64.b64encode(trainer_code.encode()).decode()},
            {"key": "DATA_SOURCE_CB64",  "value": _cb64(_data_source_stub)},
            {"key": "BASE_TRAINER_CB64", "value": _cb64(_base_trainer_src)},
            {"key": "TRAINER_CONFIG",    "value": json.dumps(config)},
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

        from app.services.gpu_providers.gpu_catalog import _STATIC
        resolved_gpu = gpu_type_id or _STATIC[0]["id"]

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

    async def fetch_logs(self, handle: RemoteJobHandle) -> tuple[list[str], dict, bytes | None]:
        """
        Fetch pod stdout/stderr from RunPod API.

        Returns (log_lines, training_metrics, model_bytes_or_None) where:
        - training_metrics  parsed from {"metrics": {...}} stdout line
        - model_bytes       recovered from {"model_gz_b64": "..."} inline fallback line,
                            or None if model was uploaded to S3 instead
        """
        import zlib as _zlib_inner
        try:
            data = await self._gql(_POD_LOGS, {"podId": handle.remote_id})
            raw  = data.get("podLogs") or ""
        except Exception as exc:
            logger.debug("runpod_log_fetch_failed", pod_id=handle.remote_id, error=str(exc))
            return [], {}, None

        lines = [line for line in raw.splitlines() if line.strip()]
        training_metrics: dict = {}
        inline_model_bytes: bytes | None = None

        for line in lines:
            stripped = line.strip()
            if not stripped.startswith("{"):
                continue
            try:
                parsed = json.loads(stripped)
            except Exception:
                continue

            # {"metrics": {...}}
            if isinstance(parsed.get("metrics"), dict):
                training_metrics = parsed["metrics"]

            # {"model_gz_b64": "..."} — inline compressed model fallback
            if isinstance(parsed.get("model_gz_b64"), str) and inline_model_bytes is None:
                try:
                    gz_bytes = base64.b64decode(parsed["model_gz_b64"])
                    inline_model_bytes = _zlib_inner.decompress(gz_bytes)
                    logger.info(
                        "runpod_inline_model_recovered",
                        pod_id=handle.remote_id,
                        size_bytes=len(inline_model_bytes),
                    )
                except Exception as exc:
                    logger.warning("runpod_inline_model_decode_failed", pod_id=handle.remote_id, error=str(exc))

        return lines, training_metrics, inline_model_bytes

    async def get_status(self, handle: RemoteJobHandle) -> RemoteJobStatus:
        data = await self._gql(_POD_STATUS, {"input": {"podId": handle.remote_id}})
        pod  = data.get("pod") or {}

        desired = (pod.get("desiredStatus") or "").upper()
        runtime = pod.get("runtime") or {}

        # Extract pod-level telemetry from the runtime block
        pod_metrics: dict = {}
        uptime = runtime.get("uptimeInSeconds")
        if uptime is not None:
            pod_metrics["uptime_seconds"] = uptime

        gpus = runtime.get("gpus") or []
        if gpus:
            pod_metrics["gpu_util_pct"]    = gpus[0].get("gpuUtilPercent")
            pod_metrics["gpu_mem_util_pct"] = gpus[0].get("memoryUtilPercent")

        container = runtime.get("container") or {}
        if container:
            pod_metrics["cpu_pct"]    = container.get("cpuPercent")
            pod_metrics["memory_pct"] = container.get("memoryPercent")

        # Remove None values
        pod_metrics = {k: v for k, v in pod_metrics.items() if v is not None}

        logger.debug(
            "runpod_pod_status",
            pod_id=handle.remote_id,
            desired=desired,
            pod_metrics=pod_metrics,
        )

        # Terminal failure states
        if desired in ("FAILED", "DEAD"):
            return RemoteJobStatus(state="failed", error=f"Pod entered state: {desired}", pod_metrics=pod_metrics)

        # Pod has exited — training finished
        if desired in ("EXITED", "TERMINATED"):
            return RemoteJobStatus(state="completed", pod_metrics=pod_metrics)

        # Pod was deleted externally or never properly started
        if pod == {} or (not runtime and desired == ""):
            return RemoteJobStatus(state="completed", pod_metrics=pod_metrics)

        # Still running
        return RemoteJobStatus(state="running", pod_metrics=pod_metrics)

    async def get_result(self, handle: RemoteJobHandle) -> RemoteTrainingResult:
        """
        Download model + metrics from S3, then delete the pod.
        Falls back to inline model bytes (captured from pod stdout) when S3 is
        unreachable — e.g. when MinIO is only accessible on localhost.
        """
        from app.core.config import settings
        import aioboto3

        result_prefix = handle.extra.get("result_prefix", f"cloud_training/{handle.remote_id}")
        s3_endpoint   = settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL

        model_bytes:  bytes | None = None
        metrics:      dict         = {}
        inline_bytes: bytes | None = getattr(handle, "_inline_model_bytes", None)

        session = aioboto3.Session()
        try:
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
                    logger.info("runpod_model_downloaded", prefix=result_prefix, bytes=len(model_bytes))
                except Exception as exc:
                    logger.warning("runpod_model_download_failed", prefix=result_prefix, error=str(exc))

                try:
                    obj     = await s3.get_object(Bucket=settings.S3_BUCKET, Key=f"{result_prefix}/metrics.json")
                    raw     = await obj["Body"].read()
                    metrics = json.loads(raw)
                    logger.info("runpod_metrics_downloaded", prefix=result_prefix, keys=list(metrics.keys()))
                except Exception as exc:
                    logger.warning("runpod_metrics_download_failed", prefix=result_prefix, error=str(exc))
        except Exception as exc:
            logger.warning("runpod_s3_client_error", prefix=result_prefix, error=str(exc))

        # If S3 model download failed, use inline bytes emitted in pod stdout
        if model_bytes is None and inline_bytes:
            model_bytes = inline_bytes
            logger.info("runpod_using_inline_model", size_bytes=len(model_bytes))

        # Always delete the pod after fetching results
        await self.cancel(handle)

        return RemoteTrainingResult(
            metrics=metrics,
            model_bytes=model_bytes,
            model_s3_key=f"{result_prefix}/model.pkl" if model_bytes and not inline_bytes else None,
            log_lines=[],
        )

    async def cancel(self, handle: RemoteJobHandle) -> None:
        """Terminate and delete the pod."""
        try:
            await self._gql(_TERMINATE_POD, {"input": {"podId": handle.remote_id}})
            logger.info("runpod_pod_terminated", pod_id=handle.remote_id)
        except Exception as exc:
            logger.warning("runpod_pod_terminate_failed", pod_id=handle.remote_id, error=str(exc))
