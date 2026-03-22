"""
Docker-pool sandbox manager (TRAINER_SANDBOX=docker-pool).

Manages a pool of pre-warmed sandbox containers. Each container runs agent.py,
which is a long-lived process that polls Redis for jobs and forks runner.py
as a subprocess (with no secrets in its environment).

Public API:
    get_pool_manager() → PoolManager      singleton, initialised in lifespan()
    PoolManager.acquire(job_id, mode)     → container_id  (atomic, waits for idle)
    PoolManager.release(cid)              → None          (return container to idle SET)
    PoolManager.start()                   → start background loops
    PoolManager.stop()                    → graceful shutdown
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Optional

import structlog
import redis.asyncio as aioredis

from app.core.config import settings

logger = structlog.get_logger(__name__)

_ACQUIRE_SCRIPT = """
-- Atomic acquire: claim container only if its job_id field is empty.
-- KEYS[1] = ml:pool:container:{cid}
-- KEYS[2] = ml:pool:idle
-- ARGV[1] = job_id
-- Returns 1 on success, 0 if already taken.
local current = redis.call('HGET', KEYS[1], 'job_id')
if current == '' or current == false then
    redis.call('HMSET', KEYS[1], 'job_id', ARGV[1], 'state', 'busy')
    redis.call('SREM', KEYS[2], ARGV[2])
    return 1
end
return 0
"""


# ── Singleton ──────────────────────────────────────────────────────────────────

_pool_manager: Optional["PoolManager"] = None


def get_pool_manager() -> "PoolManager":
    global _pool_manager
    if _pool_manager is None:
        _pool_manager = PoolManager()
    return _pool_manager


# ── Pool Manager ───────────────────────────────────────────────────────────────

class PoolManager:
    def __init__(self) -> None:
        self._redis: Optional[aioredis.Redis] = None
        self._acquire_sha: Optional[str] = None
        self._tasks: list[asyncio.Task] = []
        self._running = False

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
        # Load Lua acquire script
        self._acquire_sha = await self._redis.script_load(_ACQUIRE_SCRIPT)
        self._running = True
        # Spawn minimum pool on startup
        await self._ensure_min_pool()
        # Start background loops
        self._tasks = [
            asyncio.create_task(self._health_loop(), name="pool_health"),
            asyncio.create_task(self._replenishment_loop(), name="pool_replenish"),
            asyncio.create_task(self._scaler_loop(), name="pool_scaler"),
            asyncio.create_task(self._metrics_loop(), name="pool_metrics"),
        ]
        logger.info("sandbox_pool_started", min=settings.SANDBOX_POOL_MIN_SIZE, max=settings.SANDBOX_POOL_MAX_SIZE)

    async def stop(self) -> None:
        self._running = False
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self._redis:
            await self._redis.aclose()
        logger.info("sandbox_pool_stopped")

    # ── Public API ─────────────────────────────────────────────────────────────

    async def acquire(self, job_id: str, mode: str, timeout: float | None = None) -> str:
        """
        Atomically acquire an idle container. Returns container_id.
        Waits up to `timeout` seconds for one to become available.
        Raises asyncio.TimeoutError if none becomes available in time.
        """
        timeout = timeout if timeout is not None else settings.SANDBOX_POOL_ACQUIRE_TIMEOUT
        deadline = time.monotonic() + timeout
        redis = self._redis
        assert redis is not None

        # Track queue depth for scaler
        await redis.hincrby("ml:pool:metrics", "queue_depth", 1)

        try:
            while time.monotonic() < deadline:
                cid = await self._try_acquire_one(redis, job_id)
                if cid:
                    logger.info("sandbox_pool_acquired", cid=cid, job_id=job_id, mode=mode)
                    return cid

                # No idle container — wait for a release signal (up to 2s, then retry)
                remaining = deadline - time.monotonic()
                wait_time = min(2.0, remaining)
                if wait_time <= 0:
                    break
                try:
                    sub = redis.pubsub()
                    await sub.subscribe("ml:pool:idle_available")
                    try:
                        await asyncio.wait_for(
                            self._wait_for_message(sub),
                            timeout=wait_time,
                        )
                    except asyncio.TimeoutError:
                        pass
                    finally:
                        await sub.unsubscribe("ml:pool:idle_available")
                        await sub.aclose()
                except Exception:
                    await asyncio.sleep(0.5)

            raise asyncio.TimeoutError(
                f"No idle sandbox container available after {timeout:.0f}s (job_id={job_id})"
            )
        finally:
            await redis.hincrby("ml:pool:metrics", "queue_depth", -1)

    async def release(self, cid: str) -> None:
        """Return a container to idle state and notify waiters."""
        redis = self._redis
        if not redis:
            return
        await redis.hmset(f"ml:pool:container:{cid}", {  # type: ignore[attr-defined]
            "state": "idle",
            "job_id": "",
            "job_mode": "",
        })
        await redis.sadd("ml:pool:idle", cid)
        # Notify any acquire() waiters
        await redis.publish("ml:pool:idle_available", cid)
        logger.debug("sandbox_pool_released", cid=cid)

    async def spawn(self, slot: int = 0) -> str:
        """Spawn a new sandbox container and register it as warming."""
        cid = uuid.uuid4().hex[:12]
        name = f"pms_sandbox_{cid}"

        cmd = [
            "docker", "run",
            "--detach",
            "--name", name,
            f"--network={settings.SANDBOX_POOL_NETWORK}",
            "--read-only",
            "--cap-drop=ALL",
            "--no-new-privileges",
            f"--user={settings.TRAINER_SANDBOX_USER}",
            f"--memory={settings.TRAINER_SANDBOX_MEMORY}",
            f"--cpus={settings.TRAINER_SANDBOX_CPUS}",
            f"--pids-limit={settings.TRAINER_SANDBOX_PIDS}",
            "--tmpfs=/tmp:rw,noexec,nosuid,size=256m",
            f"--volume={settings.TRAINER_SANDBOX_VOLUME}:/sandbox_workspace",
            f"--env=SANDBOX_CONTAINER_ID={cid}",
            f"--env=SANDBOX_REDIS_URL={settings.SANDBOX_POOL_AGENT_REDIS_URL}",
            f"--env=SANDBOX_JOB_TIMEOUT={settings.TRAINER_SANDBOX_TIMEOUT}",
            f"--env=TRAINING_WORKERS={settings.TRAINING_WORKERS}",
            f"--env=TRAINING_BATCH_SIZE={settings.TRAINING_BATCH_SIZE}",
            f"--env=TRAINING_MAX_EPOCHS={settings.TRAINING_MAX_EPOCHS}",
            "--entrypoint", "python",
            settings.TRAINER_SANDBOX_IMAGE,
            "/runner/agent.py",
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"docker run --detach timed out for container {name}")

        if proc.returncode != 0:
            raise RuntimeError(
                f"docker run failed (rc={proc.returncode}): "
                f"{stderr.decode(errors='replace')[:500]}"
            )

        redis = self._redis
        assert redis is not None
        await redis.hset(f"ml:pool:container:{cid}", mapping={
            "container_id": cid,
            "container_name": name,
            "state": "warming",
            "job_id": "",
            "job_mode": "",
            "cpu_pct": 0.0,
            "mem_pct": 0.0,
            "mem_mb": 0.0,
            "started_at": time.time(),
            "last_heartbeat": 0.0,
            "last_job_at": 0.0,
            "error_count": 0,
            "pool_slot": slot,
        })
        await redis.sadd("ml:pool:registry", cid)
        logger.info("sandbox_pool_spawned", cid=cid, name=name)
        return cid

    async def teardown(self, cid: str, force: bool = False) -> None:
        """Gracefully drain and stop a container."""
        redis = self._redis
        if not redis:
            return
        # Signal agent to exit after current job
        await redis.hset(f"ml:pool:container:{cid}", "state", "draining")
        await redis.srem("ml:pool:idle", cid)

        if not force:
            # Wait up to 30s for agent to finish current job and exit
            for _ in range(15):
                await asyncio.sleep(2)
                job_id = await redis.hget(f"ml:pool:container:{cid}", "job_id")
                if not job_id or not job_id.decode():
                    break

        # Kill the Docker container
        name = await redis.hget(f"ml:pool:container:{cid}", "container_name")
        if name:
            kill_proc = await asyncio.create_subprocess_exec(
                "docker", "rm", "-f", name.decode(),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(kill_proc.wait(), timeout=15)

        await redis.hset(f"ml:pool:container:{cid}", "state", "dead")
        await redis.srem("ml:pool:registry", cid)
        await redis.srem("ml:pool:idle", cid)
        await redis.delete(f"ml:pool:container:{cid}", f"ml:pool:container:{cid}:jobq")
        logger.info("sandbox_pool_torn_down", cid=cid, force=force)

    # ── Background Loops ───────────────────────────────────────────────────────

    async def _health_loop(self) -> None:
        """Promote warming→idle, declare dead containers, replace them."""
        while self._running:
            try:
                await asyncio.sleep(settings.SANDBOX_POOL_HEALTH_INTERVAL)
                await self._run_health_check()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("sandbox_pool_health_error", error=str(exc))

    async def _replenishment_loop(self) -> None:
        """Ensure minimum pool size is always maintained."""
        while self._running:
            try:
                await asyncio.sleep(settings.SANDBOX_POOL_REPLENISH_INTERVAL)
                await self._ensure_min_pool()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("sandbox_pool_replenish_error", error=str(exc))

    async def _scaler_loop(self) -> None:
        """Predictive scale-up/down based on request rate and queue depth."""
        # Import here to avoid circular imports
        from app.services.predictive_scaler import compute_scaling_decision
        while self._running:
            try:
                await asyncio.sleep(20)
                await compute_scaling_decision(self)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("sandbox_pool_scaler_error", error=str(exc))

    async def _metrics_loop(self) -> None:
        """Update ml:pool:metrics HASH for Prometheus scrape."""
        while self._running:
            try:
                await asyncio.sleep(10)
                await self._publish_metrics()
            except asyncio.CancelledError:
                break
            except Exception:
                pass

    # ── Internal helpers ───────────────────────────────────────────────────────

    async def _try_acquire_one(self, redis: aioredis.Redis, job_id: str) -> Optional[str]:
        """Try each idle container atomically. Returns cid on success, None if all taken."""
        idle_cids = await redis.smembers("ml:pool:idle")
        for cid_bytes in idle_cids:
            cid = cid_bytes.decode()
            result = await redis.evalsha(
                self._acquire_sha,
                2,
                f"ml:pool:container:{cid}",
                "ml:pool:idle",
                job_id,
                cid,
            )
            if result == 1:
                return cid
        return None

    async def _run_health_check(self) -> None:
        redis = self._redis
        assert redis is not None
        now = time.time()
        all_cids = await redis.smembers("ml:pool:registry")

        for cid_bytes in all_cids:
            cid = cid_bytes.decode()
            meta_raw = await redis.hgetall(f"ml:pool:container:{cid}")
            meta = {k.decode(): v.decode() for k, v in meta_raw.items()}
            state = meta.get("state", "dead")
            last_hb = float(meta.get("last_heartbeat", 0))

            # Promote warming → idle once agent sends first heartbeat
            if state == "warming" and (now - last_hb) < settings.SANDBOX_POOL_HEARTBEAT_TIMEOUT:
                await redis.hset(f"ml:pool:container:{cid}", "state", "idle")
                await redis.sadd("ml:pool:idle", cid)
                await redis.publish("ml:pool:idle_available", cid)
                logger.info("sandbox_pool_container_ready", cid=cid)

            # Declare dead if heartbeat absent too long
            elif state in ("warming", "idle", "busy"):
                if last_hb > 0 and (now - last_hb) > settings.SANDBOX_POOL_HEARTBEAT_TIMEOUT:
                    logger.warning("sandbox_pool_container_dead", cid=cid, last_hb_ago=now - last_hb)
                    await redis.hset(f"ml:pool:container:{cid}", "state", "dead")
                    await redis.srem("ml:pool:idle", cid)
                    # If it had a job, mark it errored
                    job_id = meta.get("job_id", "")
                    if job_id:
                        await redis.set(f"ml:pool:job:{job_id}:status", "error", ex=3600)
                        await redis.publish(f"ml:pool:job:{job_id}:done", "error")
                    # Remove from registry so replenishment replaces it
                    await redis.srem("ml:pool:registry", cid)

    async def _ensure_min_pool(self) -> None:
        redis = self._redis
        if not redis:
            return
        total = await redis.scard("ml:pool:registry")
        if total < settings.SANDBOX_POOL_MIN_SIZE:
            deficit = settings.SANDBOX_POOL_MIN_SIZE - total
            for i in range(deficit):
                try:
                    await self.spawn(slot=i)
                except Exception as exc:
                    logger.error("sandbox_pool_spawn_failed", error=str(exc))

    async def _publish_metrics(self) -> None:
        redis = self._redis
        if not redis:
            return
        total = await redis.scard("ml:pool:registry")
        idle = await redis.scard("ml:pool:idle")
        # Estimate warming/busy counts
        all_cids = await redis.smembers("ml:pool:registry")
        warming = busy = 0
        for cid_bytes in all_cids:
            state_raw = await redis.hget(f"ml:pool:container:{cid_bytes.decode()}", "state")
            if state_raw:
                s = state_raw.decode()
                if s == "warming":
                    warming += 1
                elif s == "busy":
                    busy += 1
        await redis.hset("ml:pool:metrics", mapping={
            "pool_size": total,
            "idle_count": idle,
            "busy_count": busy,
            "warming_count": warming,
            "last_updated": time.time(),
        })

    @staticmethod
    async def _wait_for_message(pubsub) -> None:
        async for _ in pubsub.listen():
            break
