"""Hourly/daily aggregated performance metrics per model deployment."""
from datetime import datetime
from typing import List, Optional
from beanie import Document
from pydantic import Field

from app.utils.datetime import utc_now


class LatencyPercentiles(object):
    """Stored inline as a plain dict in the document."""
    pass


class PerformanceSnapshot(Document):
    """
    Pre-computed performance window for a single trainer.

    Written by the scheduler every hour (window_type='hourly') and every day
    (window_type='daily'). The API reads these directly — no on-the-fly aggregation.
    """

    org_id: str = ""
    trainer_name: str
    window_type: str = "hourly"          # hourly | daily
    window_start: datetime
    window_end: datetime

    # Volumes
    total_requests: int = 0
    error_count: int = 0
    error_rate: float = 0.0              # error_count / total_requests

    # Latency (ms)
    latency_avg: float = 0.0
    latency_p50: float = 0.0
    latency_p95: float = 0.0
    latency_p99: float = 0.0
    latency_max: float = 0.0

    # Error breakdown — top error messages and their counts
    top_errors: List[dict] = []          # [{"msg": str, "count": int}, ...]

    # Unique callers
    unique_orgs: int = 0
    unique_sessions: int = 0

    computed_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "performance_snapshots"
        indexes = [
            "trainer_name",
            "window_start",
            "window_type",
            [("trainer_name", 1), ("window_start", -1)],
        ]
