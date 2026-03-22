from datetime import datetime, timezone
from typing import ClassVar, Any, Dict, List, Optional
from beanie import Document, PydanticObjectId
from pydantic import ConfigDict, Field


def utc_now():
    return datetime.now(timezone.utc)


class TrainingJob(Document):
    model_config = ConfigDict(protected_namespaces=())
    COLLECTION: ClassVar[str] = "training_jobs"

    class Settings:
        name = "training_jobs"

    org_id: str = ""                      # tenant workspace
    trainer_name: str
    trainer_version: str = "1.0.0"
    run_id: Optional[str] = None          # MLflow run ID
    experiment_id: Optional[str] = None   # MLflow experiment ID
    status: str = "queued"                # queued | running | completed | failed | cancelled
    trigger: str = "manual"               # manual | scheduled | api
    celery_task_id: Optional[str] = None
    owner_email: Optional[str] = None
    compute_type: str = "local"           # local | cloud_gpu
    gpu_provider: Optional[str] = None    # underlying provider: runpod | lambda_labs | modal
    gpu_type_id: Optional[str] = None     # e.g. "NVIDIA GeForce RTX 3090"
    remote_job_id: Optional[str] = None   # ID assigned by the cloud provider

    # Dataset override (slug to use instead of trainer's default data_source.slug)
    dataset_slug_override: Optional[str] = None

    # Config snapshot
    training_config: Dict[str, Any] = {}

    # Results
    metrics: Dict[str, float] = {}
    model_uri: Optional[str] = None       # mlflow://models/...
    artifact_path: Optional[str] = None

    # Logs
    log_lines: List[str] = []
    error: Optional[str] = None

    # Wallet billing (USD)
    wallet_reserved: float = 0.0        # USD reserved in wallet before job starts
    wallet_charged: float = 0.0         # USD actually charged after completion
    gpu_price_per_hour: Optional[float] = None  # marked-up price used for billing

    # Pod runtime telemetry (populated during polling)
    pod_metrics: Dict[str, Any] = {}    # GPU util %, memory %, CPU %, uptime, etc.
    cost_log: List[Dict[str, Any]] = [] # [{ts, elapsed_s, accrued_usd}, …] snapshots

    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
