"""Drift detection alert — raised when a feature distribution diverges from its baseline."""
from datetime import datetime
from typing import Any, Dict, Optional
from beanie import Document
from pydantic import Field

from app.utils.datetime import utc_now


class DriftAlert(Document):
    """
    One document per (trainer_name, feature_name, detection run).

    status lifecycle:  open → acknowledged → resolved
    """

    org_id: str = ""
    trainer_name: str
    feature_name: str                    # which input feature drifted
    drift_method: str                    # ks_test | psi | z_score
    drift_score: float                   # method-specific score (higher = more drift)
    threshold: float                     # configured threshold that was exceeded
    sample_count: int = 0                # size of the current window tested
    baseline_count: int = 0              # size of the baseline sample
    status: str = "open"                 # open | acknowledged | resolved
    details: Dict[str, Any] = {}         # method-specific extras (statistic, p_value, …)
    detected_at: datetime = Field(default_factory=utc_now)
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    notes: str = ""

    class Settings:
        name = "drift_alerts"
        indexes = [
            "trainer_name",
            "status",
            "detected_at",
            [("trainer_name", 1), ("detected_at", -1)],
        ]
