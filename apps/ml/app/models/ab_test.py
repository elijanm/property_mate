"""A/B test traffic-splitting configuration."""
from typing import Optional, Dict, Any
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


class VariantMetrics(BaseModel):
    requests: int = 0
    errors: int = 0
    total_latency_ms: float = 0.0
    correct_predictions: int = 0     # if labels provided
    labeled_count: int = 0

    @property
    def error_rate(self) -> float:
        return round(self.errors / max(self.requests, 1), 4)

    @property
    def avg_latency_ms(self) -> float:
        return round(self.total_latency_ms / max(self.requests, 1), 1)

    @property
    def accuracy(self) -> Optional[float]:
        if self.labeled_count == 0:
            return None
        return round(self.correct_predictions / self.labeled_count, 4)


class ABTest(Document):
    org_id: str = ""
    name: str
    description: str = ""
    model_a: str                   # trainer_name (control)
    model_b: str                   # trainer_name (challenger)
    traffic_pct_b: int = 10        # % of traffic going to model_b (0-100)
    status: str = "active"         # active | paused | concluded
    winner: Optional[str] = None   # "a" | "b" | None
    metrics_a: VariantMetrics = Field(default_factory=VariantMetrics)
    metrics_b: VariantMetrics = Field(default_factory=VariantMetrics)
    created_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    concluded_at: Optional[datetime] = None

    class Settings:
        name = "ab_tests"
