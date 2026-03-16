from datetime import datetime, timezone
from typing import ClassVar, Any, Dict, Optional
from beanie import Document
from pydantic import ConfigDict, Field


def utc_now():
    return datetime.now(timezone.utc)


class ModelDeployment(Document):
    model_config = ConfigDict(protected_namespaces=())
    COLLECTION: ClassVar[str] = "model_deployments"

    class Settings:
        name = "model_deployments"

    org_id: str = ""              # tenant workspace
    trainer_name: str
    version: str
    mlflow_model_name: str
    mlflow_model_version: Optional[str] = None
    run_id: Optional[str] = None         # None for pre-trained imports
    model_uri: str
    source_type: str = "trained"         # trained | pretrained_file | pretrained_hf | pretrained_uri | pretrained_s3 | pretrained_url
    status: str = "active"               # active | inactive | archived
    is_default: bool = False             # True = used for inference by default
    metrics: Dict[str, float] = {}
    tags: Dict[str, str] = {}
    # Describes the inputs this model expects — populated from manifest.json `input_schema`
    input_schema: Dict[str, Any] = {}
    output_schema: Dict[str, Any] = {}     # Describes what the model returns — used to render output UI
    category: Dict[str, str] = {}          # {key: "ocr", label: "OCR & Vision"} for grid filtering
    # "viewer"   = visible to all roles (sample/demo models)
    # "engineer" = visible only to engineer and admin (production models, default)
    visibility: str = "engineer"
    model_size_bytes: Optional[int] = None       # artifact size in bytes (set when artifact is saved)
    owner_email: Optional[str] = None
    deployed_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
