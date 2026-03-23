"""Tracks the security scan state for a pretrained model upload."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document
from pydantic import Field

from app.utils.datetime import utc_now


class ModelScanJob(Document):
    class Settings:
        name = "model_scan_jobs"

    org_id: str
    owner_email: str
    filename: str
    file_size_bytes: int = 0
    upload_type: str = "zip"  # zip | file

    # scanning | passed | failed | deploying | deployed | error
    status: str = "scanning"

    # Scan results
    clamav_clean: Optional[bool] = None
    virus_name: Optional[str] = None
    threats: List[str] = []
    code_threats: List[str] = []
    python_files_scanned: int = 0
    llm_issues: List[Dict[str, Any]] = []

    # Set after scan passes and deploy is queued
    job_id: Optional[str] = None
    model_name: Optional[str] = None
    rejection_reason: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None
