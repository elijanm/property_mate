"""
Docker sandbox orchestrator.

When TRAINER_SANDBOX=docker, training and inference run inside an isolated
Docker container that has:
  - No network access (--network=none)
  - No app source code or infra credentials
  - Read-only filesystem (except /sandbox_workspace and /tmp via tmpfs)
  - Hard resource caps (memory, CPUs, PIDs)

Data exchange via a named Docker volume shared between the ml-worker container
and spawned sandbox containers:
  /sandbox_workspace/{job_id}/input/   — written by this orchestrator
  /sandbox_workspace/{job_id}/output/  — written by runner.py inside the container

Usage::
    result = await run_in_sandbox(mode="train", job_id=job_id, ...)
    result = await run_in_sandbox(mode="predict", job_id=job_id, ...)
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Where the shared named volume is mounted inside the ml-worker container.
# The same path must be used as the volume target in docker-compose.yml.
_WORKSPACE_DIR = Path(os.environ.get("TRAINER_SANDBOX_WORKSPACE", "/sandbox_workspace"))


# ── Serialization ──────────────────────────────────────────────────────────────

try:
    import cloudpickle as _pkl
except ImportError:
    import pickle as _pkl  # type: ignore[no-redef]


# ── Public API ─────────────────────────────────────────────────────────────────

async def run_train_in_sandbox(
    *,
    trainer_source: str,
    raw_data: Any,
    config: Any,
    job_id: Optional[str] = None,
) -> dict:
    """
    Run trainer.preprocess() + trainer.train() + trainer.evaluate() inside an
    isolated Docker container.

    Returns the model bytes (cloudpickle) and the metrics dict from result.json.
    Raises RuntimeError on container error.
    """
    job_id = job_id or str(uuid.uuid4())
    base = _WORKSPACE_DIR / job_id
    (base / "input").mkdir(parents=True, exist_ok=True)
    (base / "output").mkdir(parents=True, exist_ok=True)

    try:
        # Write inputs
        (base / "trainer.py").write_text(trainer_source, encoding="utf-8")

        with open(base / "input" / "data.pkl", "wb") as f:
            _pkl.dump(raw_data, f)

        config_dict = _config_to_dict(config)
        with open(base / "input" / "config.json", "w") as f:
            json.dump(config_dict, f)

        # Run container
        await _run_container(job_id=job_id, mode="train")

        # Read results
        result_path = base / "output" / "result.json"
        if not result_path.exists():
            raise RuntimeError("Sandbox did not produce result.json")

        result = json.loads(result_path.read_text())
        if result.get("status") == "error":
            raise RuntimeError(f"Sandbox error: {result.get('error')}\n{result.get('traceback', '')}")

        model_path = base / "output" / "model.pkl"
        if not model_path.exists():
            raise RuntimeError("Sandbox did not produce model.pkl")

        model_bytes = model_path.read_bytes()
        metrics = result.get("metrics", {})
        return {"model_bytes": model_bytes, "metrics": metrics}

    finally:
        _cleanup(base)


async def run_predict_in_sandbox(
    *,
    trainer_source: str,
    model_bytes: bytes,
    inputs: Any,
    job_id: Optional[str] = None,
) -> Any:
    """
    Run trainer.predict() inside an isolated Docker container.

    Returns the raw prediction result (already JSON-safe).
    Raises RuntimeError on container error.
    """
    job_id = job_id or str(uuid.uuid4())
    base = _WORKSPACE_DIR / job_id
    (base / "input").mkdir(parents=True, exist_ok=True)
    (base / "output").mkdir(parents=True, exist_ok=True)

    try:
        (base / "trainer.py").write_text(trainer_source, encoding="utf-8")

        with open(base / "input" / "model.pkl", "wb") as f:
            f.write(model_bytes)

        with open(base / "input" / "inputs.json", "w") as f:
            json.dump(inputs, f)

        await _run_container(job_id=job_id, mode="predict")

        result_path = base / "output" / "result.json"
        if not result_path.exists():
            raise RuntimeError("Sandbox did not produce result.json")

        result = json.loads(result_path.read_text())
        if result.get("status") == "error":
            raise RuntimeError(f"Sandbox error: {result.get('error')}\n{result.get('traceback', '')}")

        return result.get("result")

    finally:
        _cleanup(base)


# ── Docker execution ───────────────────────────────────────────────────────────

async def _run_container(*, job_id: str, mode: str) -> None:
    image = settings.TRAINER_SANDBOX_IMAGE
    memory = settings.TRAINER_SANDBOX_MEMORY
    cpus = settings.TRAINER_SANDBOX_CPUS
    timeout = settings.TRAINER_SANDBOX_TIMEOUT
    volume = settings.TRAINER_SANDBOX_VOLUME

    cmd = [
        "docker", "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--no-new-privileges",
        f"--user={settings.TRAINER_SANDBOX_USER}",
        f"--memory={memory}",
        f"--cpus={cpus}",
        f"--pids-limit={settings.TRAINER_SANDBOX_PIDS}",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=256m",
        # Mount the named volume — the container sees the same path as the worker
        f"--volume={volume}:/sandbox_workspace",
        # Environment — only non-secret training vars
        f"--env=SANDBOX_JOB_ID={job_id}",
        f"--env=SANDBOX_MODE={mode}",
        # Resource-related TRAINING_* vars are safe to pass through
        f"--env=TRAINING_WORKERS={settings.TRAINING_WORKERS}",
        f"--env=TRAINING_BATCH_SIZE={settings.TRAINING_BATCH_SIZE}",
        f"--env=TRAINING_MAX_EPOCHS={settings.TRAINING_MAX_EPOCHS}",
        image,
    ]

    logger.info(
        "sandbox_container_start",
        job_id=job_id,
        mode=mode,
        image=image,
        memory=memory,
        cpus=cpus,
        timeout=timeout,
    )

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(
            f"Sandbox container timed out after {timeout}s "
            f"(job_id={job_id}, mode={mode})"
        )

    if proc.returncode != 0:
        stderr_text = stderr.decode(errors="replace")[-4000:]
        stdout_text = stdout.decode(errors="replace")[-2000:]
        logger.error(
            "sandbox_container_failed",
            job_id=job_id,
            mode=mode,
            returncode=proc.returncode,
            stderr_tail=stderr_text[-500:],
        )
        raise RuntimeError(
            f"Sandbox exited with code {proc.returncode}.\n"
            f"stderr: {stderr_text}\n"
            f"stdout: {stdout_text}"
        )

    logger.info("sandbox_container_done", job_id=job_id, mode=mode, returncode=0)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _config_to_dict(config: Any) -> dict:
    """Convert TrainingConfig / SimpleNamespace / dict to a plain JSON-safe dict."""
    if isinstance(config, dict):
        return config
    if isinstance(config, SimpleNamespace):
        return vars(config)
    # Pydantic v1 / v2 model
    if hasattr(config, "model_dump"):
        return config.model_dump()
    if hasattr(config, "dict"):
        return config.dict()
    # dataclass / attrs / custom
    if hasattr(config, "__dict__"):
        return {
            k: v for k, v in vars(config).items()
            if isinstance(v, (str, int, float, bool, type(None)))
        }
    return {}


def _cleanup(base: Path) -> None:
    try:
        shutil.rmtree(base, ignore_errors=True)
    except Exception as exc:
        logger.warning("sandbox_cleanup_failed", path=str(base), error=str(exc))
