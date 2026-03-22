"""
Pool sandbox orchestrator (TRAINER_SANDBOX=docker-pool).

Drop-in replacement for sandbox_runner.py with the same public function
signatures. Callers in training_service.py and inference_service.py use
`elif settings.TRAINER_SANDBOX == "docker-pool"` to select this module.

Flow:
  1. Write job inputs to shared volume (/sandbox_workspace/{job_id}/)
  2. Record request for the predictive scaler
  3. Acquire an idle pre-warmed container from the pool (atomic, waits for one)
  4. Push job_id:mode onto the container's Redis job queue (RPUSH)
  5. Subscribe to ml:pool:job:{job_id}:done pub/sub channel and wait
  6. Read result.json (JSON only — no pickle exec in trusted process)
  7. Return model_bytes (raw bytes) + metrics dict
  8. Release container back to pool, clean up workspace

Trust boundary:
  - This module never calls pickle.loads() on anything written by the sandbox.
  - model_bytes are returned as raw bytes to training_service.py which handles
    deserialization (same as the existing sandbox_runner.py behaviour).
  - Inference results come from result.json via _to_json_safe() in runner.py —
    already JSON primitives, no deserialization needed.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

import structlog
import redis.asyncio as aioredis

from app.core.config import settings
from app.services.pool_manager import get_pool_manager
from app.services.predictive_scaler import record_request

logger = structlog.get_logger(__name__)

_WORKSPACE_DIR = Path(os.environ.get("TRAINER_SANDBOX_WORKSPACE", "/sandbox_workspace"))

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
    Run trainer.preprocess() + train() + evaluate() inside a pre-warmed sandbox
    container. Returns {"model_bytes": bytes, "metrics": dict}.
    """
    job_id = job_id or uuid.uuid4().hex
    base = _WORKSPACE_DIR / job_id
    (base / "input").mkdir(parents=True, exist_ok=True)
    (base / "output").mkdir(parents=True, exist_ok=True)

    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
    try:
        # Write inputs to shared volume
        (base / "trainer.py").write_text(trainer_source, encoding="utf-8")
        with open(base / "input" / "data.pkl", "wb") as f:
            _pkl.dump(raw_data, f)
        with open(base / "input" / "config.json", "w") as f:
            json.dump(_config_to_dict(config), f)

        await record_request(job_id, redis)
        pool = get_pool_manager()
        cid = await pool.acquire(job_id, mode="train")

        try:
            await _dispatch_job(redis, cid, job_id, "train")
            await _wait_for_completion(redis, job_id)
        except Exception:
            await pool.release(cid)
            raise
        await pool.release(cid)

        # Read results — JSON only for metadata, raw bytes for model
        result_data = _read_result_json(base)
        if result_data.get("status") == "error":
            raise RuntimeError(
                f"Sandbox error: {result_data.get('error')}\n{result_data.get('traceback', '')}"
            )

        model_path = base / "output" / "model.pkl"
        if not model_path.exists():
            raise RuntimeError("Sandbox did not produce model.pkl")

        model_bytes = model_path.read_bytes()
        return {"model_bytes": model_bytes, "metrics": result_data.get("metrics", {})}

    finally:
        await redis.aclose()
        _cleanup(base)


async def run_predict_in_sandbox(
    *,
    trainer_source: str,
    model_bytes: bytes,
    inputs: Any,
    job_id: Optional[str] = None,
) -> Any:
    """
    Run trainer.predict() inside a pre-warmed sandbox container.
    Returns the JSON-safe prediction result.
    """
    job_id = job_id or uuid.uuid4().hex
    base = _WORKSPACE_DIR / job_id
    (base / "input").mkdir(parents=True, exist_ok=True)
    (base / "output").mkdir(parents=True, exist_ok=True)

    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
    try:
        (base / "trainer.py").write_text(trainer_source, encoding="utf-8")
        with open(base / "input" / "model.pkl", "wb") as f:
            f.write(model_bytes)
        with open(base / "input" / "inputs.json", "w") as f:
            json.dump(inputs, f)

        await record_request(job_id, redis)
        pool = get_pool_manager()
        cid = await pool.acquire(job_id, mode="predict")

        try:
            await _dispatch_job(redis, cid, job_id, "predict")
            await _wait_for_completion(redis, job_id)
        except Exception:
            await pool.release(cid)
            raise
        await pool.release(cid)

        result_data = _read_result_json(base)
        if result_data.get("status") == "error":
            raise RuntimeError(
                f"Sandbox error: {result_data.get('error')}\n{result_data.get('traceback', '')}"
            )
        return result_data.get("result")

    finally:
        await redis.aclose()
        _cleanup(base)


# ── Internal helpers ───────────────────────────────────────────────────────────

async def _dispatch_job(
    redis: aioredis.Redis, cid: str, job_id: str, mode: str
) -> None:
    """Push job onto the container's BLPOP queue. Payload format: 'job_id:mode'."""
    payload = f"{job_id}:{mode}"
    await redis.rpush(f"ml:pool:container:{cid}:jobq", payload)
    await redis.hset(f"ml:pool:job_meta:{job_id}", mapping={
        "mode": mode,
        "submitted_at": time.time(),
        "container_id": cid,
    })
    await redis.set(f"ml:pool:job:{job_id}:status", "running", ex=3600)
    logger.info("sandbox_job_dispatched", job_id=job_id, mode=mode, cid=cid)


async def _wait_for_completion(redis: aioredis.Redis, job_id: str) -> None:
    """
    Subscribe to ml:pool:job:{job_id}:done and block until the agent publishes
    a completion signal ("1" = success, "error" = failure).
    """
    channel = f"ml:pool:job:{job_id}:done"
    timeout = settings.TRAINER_SANDBOX_TIMEOUT
    deadline = time.monotonic() + timeout

    sub = redis.pubsub()
    await sub.subscribe(channel)
    try:
        async for message in sub.listen():
            if time.monotonic() > deadline:
                raise asyncio.TimeoutError(
                    f"Sandbox job timed out after {timeout}s (job_id={job_id})"
                )
            if message["type"] != "message":
                continue
            data = message["data"]
            if isinstance(data, bytes):
                data = data.decode()
            if data == "error":
                raise RuntimeError(f"Sandbox container reported error for job {job_id}")
            # data == "1" → success
            return
    finally:
        await sub.unsubscribe(channel)
        await sub.aclose()


def _read_result_json(base: Path) -> dict:
    result_path = base / "output" / "result.json"
    if not result_path.exists():
        raise RuntimeError("Sandbox did not produce result.json")
    return json.loads(result_path.read_text())


def _config_to_dict(config: Any) -> dict:
    if isinstance(config, dict):
        return config
    if isinstance(config, SimpleNamespace):
        return vars(config)
    if hasattr(config, "model_dump"):
        return config.model_dump()
    if hasattr(config, "dict"):
        return config.dict()
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
        logger.warning("sandbox_pool_cleanup_failed", path=str(base), error=str(exc))
