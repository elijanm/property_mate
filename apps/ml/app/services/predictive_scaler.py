"""
Predictive scaler for the docker-pool sandbox (TRAINER_SANDBOX=docker-pool).

Called by PoolManager._scaler_loop() every 20 seconds.

Algorithm:
  1. Compute req_rate_1m from a Redis sorted-set sliding window.
  2. Project how many containers will be needed when the next batch of requests
     arrives (lead_time_secs away).
  3. If projected_need > (idle + warming), spawn the difference — up to MAX_SIZE.
  4. If queue_depth == 0 and rate is very low, drain excess idle containers
     beyond MIN_IDLE — respecting a scale-down cooldown.
"""
from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING

import redis.asyncio as aioredis
import structlog

from app.core.config import settings

if TYPE_CHECKING:
    from app.services.pool_manager import PoolManager

logger = structlog.get_logger(__name__)


async def record_request(job_id: str, redis: aioredis.Redis) -> None:
    """
    Record a new job submission for rate calculation.
    Call this from pool_sandbox_runner before acquiring a container.
    """
    now = time.time()
    key = "ml:pool:req_timestamps"
    await redis.zadd(key, {job_id: now})
    # Trim entries older than 5 minutes to keep the set bounded
    await redis.zremrangebyscore(key, 0, now - 300)

    # Update rate metrics immediately so scaler has fresh data
    count_1m = await redis.zcount(key, now - 60, "+inf")
    count_5m = await redis.zcount(key, now - 300, "+inf")
    await redis.hset("ml:pool:metrics", mapping={
        "req_rate_1m": round(count_1m / 60.0, 4),
        "req_rate_5m": round(count_5m / 300.0, 4),
    })


async def compute_scaling_decision(pool: "PoolManager") -> None:
    """Main scaler entry point — called every 20s by PoolManager._scaler_loop()."""
    redis = pool._redis
    if not redis:
        return

    now = time.time()

    # ── Read current state ─────────────────────────────────────────────────────
    metrics_raw = await redis.hgetall("ml:pool:metrics")
    metrics = {k.decode(): v.decode() for k, v in metrics_raw.items()}

    pool_size = int(metrics.get("pool_size", 0))
    idle_count = int(metrics.get("idle_count", 0))
    warming_count = int(metrics.get("warming_count", 0))
    queue_depth = int(metrics.get("queue_depth", 0))
    req_rate_1m = float(metrics.get("req_rate_1m", 0.0))

    effective_idle = idle_count + warming_count  # warming ≈ available soon

    # ── Scale-up decision ──────────────────────────────────────────────────────
    predicted_demand = req_rate_1m * settings.SANDBOX_POOL_SPAWN_LEAD_TIME_SECS
    desired_idle = math.ceil(predicted_demand * settings.SANDBOX_POOL_IDLE_HEADROOM_FACTOR)
    desired_idle = max(desired_idle, settings.SANDBOX_POOL_MIN_IDLE)

    # Always spawn if queue depth is non-zero and we're below max
    if queue_depth > 0:
        desired_idle = max(desired_idle, queue_depth)

    gap = desired_idle - effective_idle
    if gap > 0 and pool_size < settings.SANDBOX_POOL_MAX_SIZE:
        # Respect cooldown
        last_spawn_raw = await redis.get("ml:pool:scale:last_spawn")
        last_spawn = float(last_spawn_raw) if last_spawn_raw else 0.0
        if (now - last_spawn) >= settings.SANDBOX_POOL_SCALE_UP_COOLDOWN:
            spawn_count = min(gap, settings.SANDBOX_POOL_MAX_SIZE - pool_size)
            logger.info(
                "sandbox_pool_scale_up",
                spawn_count=spawn_count,
                req_rate_1m=round(req_rate_1m, 3),
                queue_depth=queue_depth,
                effective_idle=effective_idle,
                desired_idle=desired_idle,
            )
            for _ in range(spawn_count):
                try:
                    await pool.spawn()
                except Exception as exc:
                    logger.error("sandbox_pool_scale_up_spawn_failed", error=str(exc))
                    break
            await redis.set("ml:pool:scale:last_spawn", now)
        return  # don't evaluate scale-down in same cycle as scale-up

    # ── Scale-down decision ────────────────────────────────────────────────────
    if (
        queue_depth == 0
        and req_rate_1m < settings.SANDBOX_POOL_SCALE_DOWN_THRESHOLD
        and idle_count > settings.SANDBOX_POOL_MIN_IDLE
    ):
        last_drain_raw = await redis.get("ml:pool:scale:last_drain")
        last_drain = float(last_drain_raw) if last_drain_raw else 0.0
        if (now - last_drain) >= settings.SANDBOX_POOL_SCALE_DOWN_COOLDOWN:
            excess = idle_count - settings.SANDBOX_POOL_MIN_IDLE
            drain_count = min(excess, settings.SANDBOX_POOL_SCALE_DOWN_BATCH)

            # Pick oldest idle containers (lowest last_job_at)
            victims = await _pick_drain_victims(redis, drain_count)
            if victims:
                logger.info(
                    "sandbox_pool_scale_down",
                    drain_count=len(victims),
                    req_rate_1m=round(req_rate_1m, 3),
                    idle_count=idle_count,
                )
                for cid in victims:
                    try:
                        await pool.teardown(cid)
                    except Exception as exc:
                        logger.error("sandbox_pool_scale_down_teardown_failed", cid=cid, error=str(exc))
                await redis.set("ml:pool:scale:last_drain", now)


async def _pick_drain_victims(redis: aioredis.Redis, count: int) -> list[str]:
    """Return the `count` idle containers that have been idle longest."""
    idle_cids_raw = await redis.smembers("ml:pool:idle")
    candidates: list[tuple[float, str]] = []
    for cid_bytes in idle_cids_raw:
        cid = cid_bytes.decode()
        last_job_raw = await redis.hget(f"ml:pool:container:{cid}", "last_job_at")
        last_job = float(last_job_raw) if last_job_raw else 0.0
        candidates.append((last_job, cid))
    # Sort ascending by last_job_at (oldest idle first)
    candidates.sort(key=lambda x: x[0])
    return [cid for _, cid in candidates[:count]]
