from datetime import datetime
from typing import Any, Dict, Optional
from beanie import Document, PydanticObjectId
from pydantic import ConfigDict, Field

from app.utils.datetime import utc_now


class InferenceFeedback(Document):
    model_config = ConfigDict(protected_namespaces=())
    """User-reported feedback on a model prediction — powers confusion matrix + accuracy tracking."""

    trainer_name: str
    deployment_id: Optional[str] = None   # str(ModelDeployment.id)
    run_id: Optional[str] = None
    inference_log_id: Optional[str] = None

    # What the model produced
    model_output: Any = None              # raw prediction (any type)
    predicted_label: Optional[str] = None # extracted string label for confusion matrix

    # What the user reports
    actual_label: Optional[str] = None   # correct label per the user
    is_correct: Optional[bool] = None    # quick thumbs up/down
    confidence_reported: Optional[float] = None  # user-perceived confidence 0-1

    # Extra
    notes: Optional[str] = None
    session_id: Optional[str] = None     # browser session id for grouping
    created_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "inference_feedback"
        indexes = ["trainer_name", "created_at", "is_correct", "actual_label", "predicted_label"]
