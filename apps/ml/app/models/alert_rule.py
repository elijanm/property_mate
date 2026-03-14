"""Alert rules and fire records."""
from typing import Optional, List, Dict, Any
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


class NotificationChannel(BaseModel):
    type: str           # webhook | log
    url: Optional[str] = None


class AlertRule(Document):
    org_id: str = ""
    name: str
    metric: str                  # error_rate | latency_p99 | drift_score | request_volume
    trainer_name: Optional[str] = None   # None = applies to all
    operator: str = "gt"         # gt | lt | gte | lte
    threshold: float
    window_minutes: int = 15
    cooldown_minutes: int = 60
    channels: List[NotificationChannel] = []
    enabled: bool = True
    created_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ml_alert_rules"


class AlertFire(Document):
    rule_id: str
    rule_name: str
    trainer_name: str
    metric: str
    value: float
    threshold: float
    message: str
    notified: bool = False
    fired_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "ml_alert_fires"
