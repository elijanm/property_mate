"""Batch inference endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import get_current_user, require_roles
from app.services import batch_service

router = APIRouter(prefix="/batch", tags=["batch"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class BatchRequest(BaseModel):
    trainer_name: str
    rows: List[dict]


@router.post("", dependencies=[_engineer])
async def submit_batch(
    body: BatchRequest,
    user=Depends(get_current_user),
):
    if not body.rows:
        raise HTTPException(status_code=400, detail="rows must not be empty")
    if len(body.rows) > 10_000:
        raise HTTPException(status_code=400, detail="Maximum 10,000 rows per batch job")
    job = await batch_service.create_job(body.trainer_name, body.rows, user.email, user.org_id)
    return _fmt(job)


@router.get("")
async def list_jobs(
    trainer_name: Optional[str] = Query(None),
    limit: int = Query(50),
    user=Depends(get_current_user),
):
    jobs = await batch_service.list_jobs(trainer_name, limit, user.org_id)
    return [_fmt(j) for j in jobs]


@router.get("/{job_id}")
async def get_job(job_id: str, user=Depends(get_current_user)):
    job = await batch_service.get_job(job_id)
    if job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return _fmt(job)


@router.get("/{job_id}/results")
async def get_results(job_id: str, user=Depends(get_current_user)):
    job = await batch_service.get_job(job_id)
    if job.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "completed":
        raise HTTPException(status_code=400, detail=f"Job not completed (status: {job.status})")
    results = await batch_service.get_results(job)
    return {"job_id": job_id, "total": len(results), "results": results}


def _fmt(j):
    return {"id": str(j.id), "trainer_name": j.trainer_name, "status": j.status, "total_rows": j.total_rows, "processed_rows": j.processed_rows, "failed_rows": j.failed_rows, "progress_pct": j.progress_pct, "submitted_by": j.submitted_by, "created_at": j.created_at, "started_at": j.started_at, "completed_at": j.completed_at, "error": j.error}
