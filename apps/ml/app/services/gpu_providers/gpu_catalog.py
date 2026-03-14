"""GPU catalog — live prices from RunPod GraphQL + 40% markup + Redis cache.

Falls back to a static list when RunPod API is unavailable or not configured.
Cache TTL: 5 minutes (prices change infrequently).
"""
import json
import math
from typing import Optional, TypedDict

import httpx
import structlog

logger = structlog.get_logger(__name__)

PRICE_MARKUP = 1.40      # 40% margin on top of provider cost
CACHE_TTL    = 300       # seconds (5 min)
CACHE_KEY    = "ml:gpu_catalog:live"


def _kes_rate() -> float:
    """Return the configured USD→KES exchange rate."""
    from app.core.config import settings
    return settings.USD_TO_KES_RATE

_GQL = "https://api.runpod.io/graphql"

_FETCH_QUERY = """
query {
  gpuTypes {
    id
    displayName
    memoryInGb
    secureCloud
    communityCloud
    lowestPrice(input: { gpuCount: 1 }) {
      minimumBidPrice
      uninterruptablePrice
    }
  }
}
"""


class GpuOption(TypedDict):
    id: str                  # RunPod gpuTypeId
    name: str                # display name, e.g. "RTX 3090"
    vram_gb: int
    price_per_hour: float    # marked-up price in USD
    price_usd: float         # same as price_per_hour (kept for compatibility)
    base_price_usd: float    # raw provider price in USD (before markup)
    currency: str            # always "USD"
    tier: str                # budget | standard | performance | enterprise
    recommended: bool
    available: bool          # currently available on RunPod


def _markup_kes(base_usd: float) -> float:
    """Apply markup and convert USD → KES."""
    return round(base_usd * PRICE_MARKUP * _kes_rate(), 2)


def _markup_usd(base_usd: float) -> float:
    return round(base_usd * PRICE_MARKUP, 4)


def _tier(vram_gb: int, price: float) -> str:
    if price < 0.70:
        return "budget"
    if price < 1.20:
        return "standard"
    if price < 2.50:
        return "performance"
    return "enterprise"


def _static_entry(id: str, name: str, vram_gb: int, base_usd: float, tier: str, recommended: bool) -> "GpuOption":
    marked = _markup_usd(base_usd)
    return {
        "id": id, "name": name, "vram_gb": vram_gb,
        "price_per_hour": marked,
        "price_usd": marked,
        "base_price_usd": base_usd,
        "currency": "USD",
        "tier": tier, "recommended": recommended, "available": True,
    }


# ── Static fallback (used when RunPod API is unavailable) ─────────────────────
_STATIC: list[GpuOption] = [
    _static_entry("NVIDIA GeForce RTX 3080",  "RTX 3080",   10, 0.20, "budget",      False),
    _static_entry("NVIDIA GeForce RTX 3090",  "RTX 3090",   24, 0.34, "budget",      True),
    _static_entry("NVIDIA A4000",             "A4000",       16, 0.44, "standard",    False),
    _static_entry("NVIDIA GeForce RTX 4090",  "RTX 4090",   24, 0.74, "standard",    False),
    _static_entry("NVIDIA A40",               "A40",         48, 0.79, "performance", False),
    _static_entry("NVIDIA A100 80GB PCIe",    "A100 80GB",  80, 1.99, "enterprise",  False),
]

_STATIC_BY_ID: dict[str, GpuOption] = {g["id"]: g for g in _STATIC}


# ── Live fetch ────────────────────────────────────────────────────────────────

async def fetch_live_options(api_key: str) -> list[GpuOption]:
    """Fetch current GPU types + on-demand prices from RunPod GraphQL."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_GQL}?api_key={api_key}",
            headers={"Content-Type": "application/json"},
            json={"query": _FETCH_QUERY},
        )
        resp.raise_for_status()
        body = resp.json()

    gpu_types = (body.get("data") or {}).get("gpuTypes") or []
    options: list[GpuOption] = []

    for g in gpu_types:
        low   = g.get("lowestPrice") or {}
        base  = low.get("uninterruptablePrice")   # on-demand guaranteed price
        if base is None:
            base = low.get("minimumBidPrice")     # fallback to spot
        if not base:
            continue   # not available

        vram  = g.get("memoryInGb") or 0
        name  = g.get("displayName") or g["id"]

        marked = _markup_usd(base)
        options.append({
            "id":             g["id"],
            "name":           name,
            "vram_gb":        int(vram),
            "price_per_hour": marked,
            "price_usd":      marked,
            "base_price_usd": round(base, 4),
            "currency":       "USD",
            "tier":           _tier(int(vram), base),
            "recommended":    g["id"] == "NVIDIA GeForce RTX 3090",
            "available":      bool(g.get("secureCloud") or g.get("communityCloud")),
        })

    # Sort by price ascending
    options.sort(key=lambda x: x["price_per_hour"])
    return options


async def get_gpu_options(api_key: Optional[str] = None) -> list[GpuOption]:
    """
    Return GPU options. Tries:
      1. Redis cache (5 min TTL)
      2. Live RunPod API (if api_key provided)
      3. Static fallback
    """
    # Try Redis cache first
    try:
        import redis.asyncio as aioredis
        from app.core.config import settings as _s
        _r = aioredis.from_url(_s.REDIS_URL, decode_responses=True)
        cached = await _r.get(CACHE_KEY)
        await _r.aclose()
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    # Try live fetch
    if api_key:
        try:
            options = await fetch_live_options(api_key)
            if options:
                # Store in Redis cache
                try:
                    import redis.asyncio as aioredis
                    from app.core.config import settings as _s
                    _r = aioredis.from_url(_s.REDIS_URL, decode_responses=True)
                    await _r.setex(CACHE_KEY, CACHE_TTL, json.dumps(options))
                    await _r.aclose()
                except Exception:
                    pass
                logger.info("gpu_catalog_live_fetched", count=len(options))
                return options
        except Exception as exc:
            logger.warning("gpu_catalog_live_fetch_failed", error=str(exc))

    # Static fallback
    return _STATIC


def get_gpu_option(gpu_type_id: str) -> Optional[GpuOption]:
    """Lookup by id — checks static map (live options update the static map on fetch)."""
    return _STATIC_BY_ID.get(gpu_type_id)


async def get_gpu_option_live(gpu_type_id: str, api_key: Optional[str] = None) -> Optional[GpuOption]:
    """Lookup with live data."""
    options = await get_gpu_options(api_key)
    return next((o for o in options if o["id"] == gpu_type_id), _STATIC_BY_ID.get(gpu_type_id))
