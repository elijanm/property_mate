"""
Split sandbox service.

Routes jobs to the correct tier queue and streams results back.
Used only when SANDBOX_SPLIT_MODE=true.

Tier queues:
  sandbox:test:jobs       — editor test runs (fixture data, 60s timeout, free)
  sandbox:prod:cpu:jobs   — production CPU training (real data, full resources)
  sandbox:prod:gpu:jobs   — production GPU training (real data, GPU resources, charged)

Each tier has dedicated containers running sandbox/tier_runner.py that pop from
their own queue — test and production jobs never share the same container.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Result TTL in Redis — test results are ephemeral (1 hr), prod results kept longer
_TEST_RESULT_TTL = 3600       # 1 hour
_PROD_RESULT_TTL = 86400      # 24 hours


# ── Redis helper ──────────────────────────────────────────────────────────────

_redis = None


async def _get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


# ── Job push ─────────────────────────────────────────────────────────────────

async def push_test_job(
    *,
    job_id: str,
    org_id: str,
    trainer_source: str,
    config_overrides: Optional[dict] = None,
) -> None:
    """Push an editor test run to the test sandbox queue."""
    r = await _get_redis()
    payload = json.dumps({
        "job_id": job_id,
        "org_id": org_id,
        "mode": "train",
        "tier": "test",
        "trainer_source": trainer_source,
        "config_overrides": config_overrides or {},
    })
    await r.rpush(settings.SANDBOX_TEST_QUEUE, payload)
    logger.info("split_sandbox_push", tier="test", job_id=job_id, org_id=org_id)


async def push_prod_job(
    *,
    job_id: str,
    org_id: str,
    trainer_source: str,
    compute_type: str = "cpu",   # "cpu" | "gpu"
    config_overrides: Optional[dict] = None,
) -> None:
    """Push a production training job to the cpu or gpu prod queue."""
    r = await _get_redis()
    queue = (
        settings.SANDBOX_PROD_GPU_QUEUE
        if compute_type == "gpu"
        else settings.SANDBOX_PROD_CPU_QUEUE
    )
    payload = json.dumps({
        "job_id": job_id,
        "org_id": org_id,
        "mode": "train",
        "tier": f"prod_{compute_type}",
        "trainer_source": trainer_source,
        "config_overrides": config_overrides or {},
    })
    await r.rpush(queue, payload)
    logger.info("split_sandbox_push", tier=f"prod_{compute_type}", job_id=job_id, org_id=org_id)


# ── Log streaming ─────────────────────────────────────────────────────────────

async def stream_job_logs(
    job_id: str,
    timeout: float = 120.0,
) -> AsyncIterator[dict]:
    """
    Subscribe to Redis pub/sub for a job and yield log/metric/done events.
    Stops on a "done" or "error" event or when timeout is reached.
    """
    import redis.asyncio as aioredis
    # Use a dedicated connection for pub/sub (cannot share with regular commands)
    r = await aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )
    pubsub = r.pubsub()
    channel = f"sandbox:logs:{job_id}"
    await pubsub.subscribe(channel)

    deadline = asyncio.get_event_loop().time() + timeout
    try:
        while asyncio.get_event_loop().time() < deadline:
            remaining = deadline - asyncio.get_event_loop().time()
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                    timeout=min(remaining, 2.0),
                )
            except asyncio.TimeoutError:
                continue

            if message is None:
                await asyncio.sleep(0.05)
                continue

            try:
                data = json.loads(message["data"])
            except (json.JSONDecodeError, TypeError):
                continue

            yield data

            if data.get("event") in ("done", "error"):
                break
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        await r.aclose()


async def get_job_result(job_id: str, timeout: float = 120.0) -> Optional[dict]:
    """Poll Redis for the job result. Returns None if timed out."""
    r = await _get_redis()
    result_key = f"sandbox:result:{job_id}"
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        raw = await r.get(result_key)
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return None
        await asyncio.sleep(0.3)
    return None
