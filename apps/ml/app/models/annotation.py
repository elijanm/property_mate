"""Annotation project models — projects, images, annotations, model versions."""
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from app.utils.datetime import utc_now


class AnnotationShape(BaseModel):
    """A single annotation on an image."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str = "box"                       # box | polygon | line
    label: str                              # class label e.g. "license_plate"
    # Box: [x, y, w, h] normalised 0-1; Polygon: [[x,y],...]; Line: [[x,y],[x,y]]
    coords: List[Any] = []
    confidence: Optional[float] = None     # None = manual; float = model prediction
    approved: bool = False                  # user approved a model prediction
    source: str = "manual"                  # manual | model
    created_at: datetime = Field(default_factory=utc_now)


class AnnotationImage(BaseModel):
    """An image within an annotation project."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    s3_key: str                             # {org_id}/annotate/{project_id}/{id}/{filename}
    width: Optional[int] = None
    height: Optional[int] = None
    status: str = "unannotated"             # unannotated | annotating | annotated | predicted | approved
    annotations: List[AnnotationShape] = []
    # Frame info for video-extracted frames
    source_video_key: Optional[str] = None
    frame_index: Optional[int] = None
    added_at: datetime = Field(default_factory=utc_now)


class ModelVersion(BaseModel):
    """A trained model checkpoint within the annotation project."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    version: int
    status: str = "training"               # queued | training | predicting | ready | failed
    trained_on: int = 0                    # number of annotated images used
    map50: Optional[float] = None          # mAP@0.5 on val set
    map50_95: Optional[float] = None       # mAP@0.5:0.95
    weights_key: Optional[str] = None      # S3 key for .pt weights file
    epochs: int = 20
    celery_task_id: Optional[str] = None   # Celery task ID for status polling
    predict_task_id: Optional[str] = None  # Celery task ID for prediction job
    created_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class AnnotationProject(Document):
    org_id: str = ""
    name: str
    description: str = ""
    classes: List[str] = []                # e.g. ["license_plate", "car"]
    annotation_type: str = "box"           # box | polygon | line
    images: List[AnnotationImage] = []
    model_versions: List[ModelVersion] = []
    # Active learning state
    status: str = "collecting"             # collecting | training | predicting | done
    active_model_version_id: Optional[str] = None  # latest ready model
    min_annotations_to_train: int = 5
    # Export
    last_export_key: Optional[str] = None  # S3 key for last exported dataset ZIP
    created_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    deleted_at: Optional[datetime] = None

    class Settings:
        name = "annotation_projects"
