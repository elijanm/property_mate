"""Background export job for annotation datasets."""
from typing import Optional, Dict
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class AnnotationExportJob(Document):
    org_id: str = ""
    project_id: str = ""
    project_name: str = ""
    format: str = "yolo-detect"          # yolo-detect | yolo-obb | yolo-seg
    status: str = "queued"               # queued | running | completed | failed
    total_images: int = 0
    processed_images: int = 0
    splits: Dict[str, int] = {}          # {"train": 80, "val": 20, "test": 0}
    download_url: Optional[str] = None   # presigned URL — set on completion
    s3_key: Optional[str] = None
    error: Optional[str] = None
    requested_by_email: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    @property
    def progress_pct(self) -> float:
        if self.total_images == 0:
            return 0.0
        return round(self.processed_images / self.total_images * 100, 1)

    class Settings:
        name = "annotation_export_jobs"
