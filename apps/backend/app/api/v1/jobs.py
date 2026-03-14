"""Jobs API — poll async background job status."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Any, Dict, Optional
from datetime import datetime

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.repositories.job_run_repository import job_run_repository

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobRunResponse(BaseModel):
    id: str
    job_type: str
    status: str
    org_id: Optional[str] = None
    payload: Dict[str, Any] = {}
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    attempts: int = 0
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


@router.get(
    "/{job_id}",
    response_model=JobRunResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_job(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> JobRunResponse:
    """Poll a background job's status."""
    job = await job_run_repository.get_by_id(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "JOB_NOT_FOUND", "message": "Job not found"}},
        )
    # Org-scoped check: allow if org matches, or if org_id is None (platform job) and superadmin
    if job.org_id and job.org_id != current_user.org_id and current_user.role != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "FORBIDDEN", "message": "Access denied"}},
        )
    return JobRunResponse(
        id=str(job.id),
        job_type=job.job_type,
        status=job.status,
        org_id=job.org_id,
        payload=job.payload or {},
        result=job.result,
        error=job.error,
        attempts=job.attempts,
        created_at=job.created_at,
        updated_at=job.updated_at,
        completed_at=job.completed_at,
    )
