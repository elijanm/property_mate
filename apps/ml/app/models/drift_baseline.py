"""Stored reference distribution for data drift detection."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from beanie import Document
from pydantic import BaseModel, Field

from app.utils.datetime import utc_now


class NumericStats(BaseModel):
    count: int = 0
    mean: float = 0.0
    std: float = 0.0
    min: float = 0.0
    max: float = 0.0
    # 20-bucket histogram: [(bucket_edge, count), ...]
    histogram: List[List[float]] = []    # [[edge, count], ...]


class CategoricalStats(BaseModel):
    count: int = 0
    # value → frequency (proportion)
    value_freqs: Dict[str, float] = {}


class FeatureBaseline(BaseModel):
    feature_type: str                    # numeric | categorical | text | unknown
    numeric: Optional[NumericStats] = None
    categorical: Optional[CategoricalStats] = None


class DriftBaseline(Document):
    """
    Reference feature distribution computed from a sample of recent inference inputs.
    One document per trainer_name — overwritten when baseline is refreshed.
    """

    org_id: str = ""
    trainer_name: str
    sample_count: int = 0                # number of InferenceLogs used
    feature_baselines: Dict[str, FeatureBaseline] = {}  # feature_name → stats
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "drift_baselines"
        indexes = ["trainer_name"]
