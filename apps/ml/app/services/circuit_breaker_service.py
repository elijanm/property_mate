"""Redis-backed per-model circuit breaker."""
import json
import structlog
import redis.asyncio as aioredis
from typing import Optional
from app.core.config import settings
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

# States: closed (healthy) | open (failing) | half-open (testing recovery)
_FAILURE_THRESHOLD = 5        # consecutive failures → open
_RECOVERY_TIMEOUT_SEC = 120   # seconds in open state before half-open
_HALF_OPEN_MAX = 3            # successes needed to close


def _key(trainer: str) -> str:
    return f"ml:cb:{trainer}"


async def _redis() -> aioredis.Redis:
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def get_state(trainer_name: str) -> dict:
    r = await _redis()
    raw = await r.get(_key(trainer_name))
    await r.aclose()
    if not raw:
        return {"state": "closed", "failures": 0, "successes": 0}
    return json.loads(raw)


async def _save(trainer_name: str, state: dict) -> None:
    r = await _redis()
    await r.set(_key(trainer_name), json.dumps(state), ex=3600)
    await r.aclose()


async def record_success(trainer_name: str) -> None:
    state = await get_state(trainer_name)
    if state["state"] == "half-open":
        state["successes"] = state.get("successes", 0) + 1
        if state["successes"] >= _HALF_OPEN_MAX:
            state = {"state": "closed", "failures": 0, "successes": 0}
            logger.info("circuit_breaker_closed", trainer=trainer_name)
    elif state["state"] == "closed":
        state["failures"] = 0
    await _save(trainer_name, state)


async def record_failure(trainer_name: str) -> None:
    state = await get_state(trainer_name)
    if state["state"] == "open":
        now = utc_now().timestamp()
        opened_at = state.get("opened_at", now)
        if now - opened_at >= _RECOVERY_TIMEOUT_SEC:
            state["state"] = "half-open"
            state["successes"] = 0
            logger.info("circuit_breaker_half_open", trainer=trainer_name)
        await _save(trainer_name, state)
        return

    state["failures"] = state.get("failures", 0) + 1
    if state["failures"] >= _FAILURE_THRESHOLD:
        state["state"] = "open"
        state["opened_at"] = utc_now().timestamp()
        logger.warning("circuit_breaker_opened", trainer=trainer_name, failures=state["failures"])
    await _save(trainer_name, state)


async def is_open(trainer_name: str) -> bool:
    state = await get_state(trainer_name)
    if state["state"] != "open":
        return False
    # Check if recovery timeout has elapsed → transition to half-open
    now = utc_now().timestamp()
    opened_at = state.get("opened_at", now)
    if now - opened_at >= _RECOVERY_TIMEOUT_SEC:
        state["state"] = "half-open"
        state["successes"] = 0
        await _save(trainer_name, state)
        return False
    return True


async def reset(trainer_name: str) -> None:
    r = await _redis()
    await r.delete(_key(trainer_name))
    await r.aclose()


async def get_all_states() -> dict:
    r = await _redis()
    keys = await r.keys("ml:cb:*")
    result = {}
    for k in keys:
        trainer = k.replace("ml:cb:", "")
        raw = await r.get(k)
        if raw:
            result[trainer] = json.loads(raw)
    await r.aclose()
    return result
