"""Async batch inference jobs."""
from typing import Optional, List, Any
from datetime import datetime
from beanie import Document
from pydantic import Field
from app.utils.datetime import utc_now


class BatchJob(Document):
    org_id: str = ""
    trainer_name: str
    status: str = "queued"         # queued | running | completed | failed
    total_rows: int = 0
    processed_rows: int = 0
    failed_rows: int = 0
    input_s3_key: Optional[str] = None
    output_s3_key: Optional[str] = None
    error: Optional[str] = None
    submitted_by: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    @property
    def progress_pct(self) -> float:
        if self.total_rows == 0:
            return 0.0
        return round(self.processed_rows / self.total_rows * 100, 1)

    class Settings:
        name = "ml_batch_jobs"
