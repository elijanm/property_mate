from datetime import datetime, timezone
from typing import ClassVar, Any, Dict, Optional
from beanie import Document
from pydantic import ConfigDict, Field


def utc_now():
    return datetime.now(timezone.utc)


class InferenceLog(Document):
    model_config = ConfigDict(protected_namespaces=())

    class Settings:
        name = "inference_logs"
        indexes = ["trainer_name", "created_at"]

    org_id: str = ""
    trainer_name: str
    deployment_id: Optional[str] = None   # which deployment served this request
    ab_test_id: Optional[str] = None      # A/B test id if traffic was routed
    ab_test_variant: Optional[str] = None # "a" or "b"
    model_version: Optional[str] = None
    run_id: Optional[str] = None
    inputs: Any = None
    outputs: Any = None
    image_keys: Dict[str, str] = {}        # S3 object keys for image fields (never expire)
    latency_ms: Optional[float] = None
    error: Optional[str] = None
    caller_org_id: Optional[str] = None
    corrected_output: Any = None
    session_id: Optional[str] = None
    cost_usd: float = 0.0              # amount charged to wallet for this call
    created_at: datetime = Field(default_factory=utc_now)
