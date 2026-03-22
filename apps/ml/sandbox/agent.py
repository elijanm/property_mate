#!/usr/bin/env python3
"""
Sandbox pool agent — runs INSIDE a long-lived isolated Docker container.

Lifecycle:
  startup  → register in Redis as "warming"
  warmup   → import heavy ML libs to populate page cache
  idle     → BLPOP on per-container job queue, report heartbeat every 10s
  busy     → fork runner.py subprocess (no Redis/S3/secrets passed to it)
  idle     → release back to pool, publish done signal
  draining → finish current job, exit cleanly when pool manager sets state=draining

Environment variables injected by pool_manager.spawn():
  SANDBOX_CONTAINER_ID  — unique container ID assigned by pool manager
  SANDBOX_REDIS_URL     — Redis URL for pool coordination only
  SANDBOX_JOB_TIMEOUT   — seconds before job subprocess is killed (default 600)
  TRAINING_WORKERS      — passed through to runner.py subprocess
  TRAINING_BATCH_SIZE   — passed through to runner.py subprocess
  TRAINING_MAX_EPOCHS   — passed through to runner.py subprocess

This agent intentionally has NO access to:
  - MongoDB
  - S3 / MinIO
  - JWT secrets
  - PMS backend API
  - MLflow
"""
from __future__ import annotations

import asyncio
import os
import signal
import sys
import time
import traceback

import redis.asyncio as aioredis

CONTAINER_ID: str = os.environ["SANDBOX_CONTAINER_ID"]
REDIS_URL: str = os.environ["SANDBOX_REDIS_URL"]
JOB_TIMEOUT: int = int(os.environ.get("SANDBOX_JOB_TIMEOUT", "600"))

_KEY_CONTAINER = f"ml:pool:container:{CONTAINER_ID}"
_KEY_JOBQ      = f"ml:pool:container:{CONTAINER_ID}:jobq"
_KEY_HEARTBEAT = f"ml:pool:heartbeat:{CONTAINER_ID}"

_shutdown = False


# ── State helpers ──────────────────────────────────────────────────────────────

async def _set_state(redis: aioredis.Redis, state: str, job_id: str = "") -> None:
    mapping: dict = {"state": state, "last_heartbeat": time.time()}
    if state == "idle":
        mapping["job_id"] = ""
        mapping["job_mode"] = ""
        await redis.sadd("ml:pool:idle", CONTAINER_ID)
    elif state == "busy":
        await redis.srem("ml:pool:idle", CONTAINER_ID)
    elif state in ("draining", "dead"):
        await redis.srem("ml:pool:idle", CONTAINER_ID)
    if job_id:
        mapping["job_id"] = job_id
    await redis.hset(_KEY_CONTAINER, mapping=mapping)


async def _register(redis: aioredis.Redis) -> None:
    await redis.hset(_KEY_CONTAINER, mapping={
        "container_id": CONTAINER_ID,
        "state": "warming",
        "job_id": "",
        "job_mode": "",
        "cpu_pct": 0.0,
        "mem_pct": 0.0,
        "mem_mb": 0.0,
        "started_at": time.time(),
        "last_heartbeat": time.time(),
        "last_job_at": 0.0,
        "error_count": 0,
    })
    await redis.sadd("ml:pool:registry", CONTAINER_ID)
    print(f"[agent:{CONTAINER_ID}] registered in Redis", flush=True)


# ── Warmup ────────────────────────────────────────────────────────────────────

def _warmup() -> None:
    """Pre-import common ML libraries to populate page cache and reduce first-job latency."""
    print(f"[agent:{CONTAINER_ID}] warming up...", flush=True)
    try:
        import numpy  # noqa: F401
        import pandas  # noqa: F401
        import sklearn  # noqa: F401
    except ImportError:
        pass
    # torch import is intentionally skipped here — it's heavy and not always needed.
    # runner.py will import it when the trainer code requires it.
    print(f"[agent:{CONTAINER_ID}] warmup done", flush=True)


# ── Job execution ─────────────────────────────────────────────────────────────

async def _run_job(redis: aioredis.Redis, job_id: str, mode: str) -> None:
    """Fork runner.py as a subprocess with minimal env — no secrets passed."""
    await _set_state(redis, "busy", job_id=job_id)
    await redis.hset(_KEY_CONTAINER, "job_mode", mode)

    # Only safe, non-secret training env vars are forwarded
    safe_env = {
        "SANDBOX_JOB_ID": job_id,
        "SANDBOX_MODE": mode,
        "HOME": "/tmp",
        "TMPDIR": "/tmp",
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "TRAINING_WORKERS": os.environ.get("TRAINING_WORKERS", "4"),
        "TRAINING_BATCH_SIZE": os.environ.get("TRAINING_BATCH_SIZE", "32"),
        "TRAINING_MAX_EPOCHS": os.environ.get("TRAINING_MAX_EPOCHS", "100"),
    }

    proc = await asyncio.create_subprocess_exec(
        sys.executable, "/runner/runner.py",
        env=safe_env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    t0 = time.monotonic()
    timed_out = False
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=JOB_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        timed_out = True
        stdout, stderr = b"", b""

    elapsed = time.monotonic() - t0

    if timed_out:
        signal_val = "error"
        print(f"[agent:{CONTAINER_ID}] job {job_id} timed out after {JOB_TIMEOUT}s", flush=True)
        # Write error result to volume so orchestrator can read it
        _write_timeout_result(job_id)
    elif proc.returncode != 0:
        signal_val = "error"
        print(
            f"[agent:{CONTAINER_ID}] job {job_id} failed (rc={proc.returncode}) "
            f"stderr={stderr.decode(errors='replace')[-500:]}",
            flush=True,
        )
    else:
        signal_val = "1"
        print(f"[agent:{CONTAINER_ID}] job {job_id} done in {elapsed:.1f}s", flush=True)

    # Signal orchestrator that job is complete
    await redis.publish(f"ml:pool:job:{job_id}:done", signal_val)
    await redis.set(
        f"ml:pool:job:{job_id}:status",
        "done" if signal_val == "1" else "error",
        ex=3600,
    )

    # Return to idle
    await redis.hset(_KEY_CONTAINER, "last_job_at", time.time())
    await _set_state(redis, "idle")


def _write_timeout_result(job_id: str) -> None:
    import json
    from pathlib import Path
    out = Path("/sandbox_workspace") / job_id / "output"
    try:
        out.mkdir(parents=True, exist_ok=True)
        with open(out / "result.json", "w") as f:
            json.dump({
                "status": "error",
                "error": f"Job timed out after {JOB_TIMEOUT}s",
                "traceback": "",
            }, f)
    except Exception:
        pass


# ── Loops ─────────────────────────────────────────────────────────────────────

async def _poll_loop(redis: aioredis.Redis) -> None:
    """Main job poll loop — blocks on BLPOP, no CPU spin."""
    print(f"[agent:{CONTAINER_ID}] poll loop started", flush=True)
    while not _shutdown:
        try:
            # BLPOP blocks up to 5s — short enough to notice shutdown/drain quickly
            item = await redis.blpop(_KEY_JOBQ, timeout=5)
            if item is None:
                continue
            _, payload = item
            # Payload format: "job_id:mode" e.g. "abc123:train"
            decoded = payload.decode()
            if ":" in decoded:
                job_id, mode = decoded.split(":", 1)
            else:
                job_id, mode = decoded, "train"
            await _run_job(redis, job_id, mode)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[agent:{CONTAINER_ID}] poll error: {exc}", flush=True)
            # Increment error_count but stay alive
            await redis.hincrby(_KEY_CONTAINER, "error_count", 1)
            await asyncio.sleep(1)


async def _heartbeat_loop(redis: aioredis.Redis) -> None:
    """Renew heartbeat key every 10s — TTL=30s so 3 missed beats = declared dead."""
    while not _shutdown:
        try:
            now = time.time()
            await redis.setex(_KEY_HEARTBEAT, 30, str(now))
            await redis.hset(_KEY_CONTAINER, "last_heartbeat", now)
        except Exception as exc:
            print(f"[agent:{CONTAINER_ID}] heartbeat error: {exc}", flush=True)
        await asyncio.sleep(10)


async def _metrics_loop(redis: aioredis.Redis) -> None:
    """Report CPU and memory utilization every 15s."""
    while not _shutdown:
        try:
            cpu_pct, mem_mb, mem_pct = _read_resource_usage()
            await redis.hset(_KEY_CONTAINER, mapping={
                "cpu_pct": round(cpu_pct, 1),
                "mem_mb": round(mem_mb, 1),
                "mem_pct": round(mem_pct, 1),
            })
        except Exception as exc:
            print(f"[agent:{CONTAINER_ID}] metrics error: {exc}", flush=True)
        await asyncio.sleep(15)


async def _drain_watch_loop(redis: aioredis.Redis) -> None:
    """Watch for draining signal — exit cleanly when pool manager sets state=draining."""
    global _shutdown
    while not _shutdown:
        try:
            state = await redis.hget(_KEY_CONTAINER, "state")
            if state and state.decode() == "draining":
                # Wait until not busy
                job_id = await redis.hget(_KEY_CONTAINER, "job_id")
                if not job_id or not job_id.decode():
                    print(f"[agent:{CONTAINER_ID}] draining — exiting cleanly", flush=True)
                    _shutdown = True
                    break
        except Exception:
            pass
        await asyncio.sleep(2)


def _read_resource_usage() -> tuple[float, float, float]:
    """Return (cpu_pct, mem_mb, mem_pct) using psutil if available, cgroup fallback."""
    try:
        import psutil
        proc = psutil.Process()
        cpu_pct = proc.cpu_percent(interval=0.1)
        mem_info = proc.memory_info()
        mem_mb = mem_info.rss / (1024 * 1024)
        # Total memory from cgroup memory.limit or system
        try:
            with open("/sys/fs/cgroup/memory/memory.limit_in_bytes") as f:
                limit_bytes = int(f.read().strip())
            mem_pct = (mem_info.rss / limit_bytes) * 100.0
        except Exception:
            mem_pct = psutil.virtual_memory().percent
        return cpu_pct, mem_mb, mem_pct
    except ImportError:
        pass
    # Minimal fallback via /proc/self/status
    try:
        mem_kb = 0
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    mem_kb = int(line.split()[1])
                    break
        return 0.0, mem_kb / 1024, 0.0
    except Exception:
        return 0.0, 0.0, 0.0


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    global _shutdown

    redis = aioredis.from_url(REDIS_URL, decode_responses=False)

    # Graceful shutdown on SIGTERM
    loop = asyncio.get_running_loop()
    def _handle_sigterm(*_):
        global _shutdown
        _shutdown = True
        print(f"[agent:{CONTAINER_ID}] SIGTERM received", flush=True)
    loop.add_signal_handler(signal.SIGTERM, _handle_sigterm)

    try:
        await _register(redis)
        _warmup()
        await _set_state(redis, "idle")
        print(f"[agent:{CONTAINER_ID}] ready — waiting for jobs", flush=True)

        await asyncio.gather(
            _poll_loop(redis),
            _heartbeat_loop(redis),
            _metrics_loop(redis),
            _drain_watch_loop(redis),
            return_exceptions=True,
        )
    except Exception as exc:
        print(f"[agent:{CONTAINER_ID}] fatal: {exc}\n{traceback.format_exc()}", flush=True)
        await redis.hset(_KEY_CONTAINER, mapping={"state": "dead", "error_count": 99})
        sys.exit(1)
    finally:
        await redis.hset(_KEY_CONTAINER, mapping={"state": "dead"})
        await redis.srem("ml:pool:registry", CONTAINER_ID)
        await redis.srem("ml:pool:idle", CONTAINER_ID)
        await redis.aclose()
        print(f"[agent:{CONTAINER_ID}] shutdown complete", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
