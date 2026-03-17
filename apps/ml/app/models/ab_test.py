"""A/B test traffic-splitting configuration."""
from typing import Optional, List
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
    # Both variants must be deployments of the same trainer.
    trainer_name: str = ""
    variant_a: str = ""            # deployment id — the baseline
    variant_b: str = ""            # deployment id — the challenger
    traffic_pct_b: int = 10        # % of traffic going to variant_b (0-100)
    # Which metric keys to display in the comparison table.
    # Built-ins: 'accuracy', 'error_rate', 'latency', 'requests'
    # Derived (trainer-declared): 'exact_match', 'digit_accuracy', 'edit_distance', 'numeric_delta', etc.
    metrics_to_use: List[str] = Field(default_factory=lambda: ["requests", "error_rate", "latency", "accuracy"])
    status: str = "active"         # active | paused | concluded
    winner: Optional[str] = None   # "a" | "b" | None
    metrics_a: VariantMetrics = Field(default_factory=VariantMetrics)
    metrics_b: VariantMetrics = Field(default_factory=VariantMetrics)
    created_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    concluded_at: Optional[datetime] = None

    class Settings:
        name = "ab_tests"
