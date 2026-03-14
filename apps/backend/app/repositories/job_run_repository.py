from typing import Any, Dict, Optional

from app.models.job_run import JobRun
from app.utils.datetime import utc_now
from app.utils.objectid import safe_oid
from beanie import Document, PydanticObjectId

class JobRunRepository:
    async def create(
        self,
        job_type: str,
        payload: Dict[str, Any],
        org_id: Optional[str] = None,
    ) -> JobRun:
        job = JobRun(
            job_type=job_type,
            payload=payload,
            org_id=org_id,
            status="queued",
        )
        await job.insert()
        return job

    async def get_by_id(self, job_id: str) -> Optional[JobRun]:
        oid = safe_oid(job_id)
        if not oid:
            return None
        return await JobRun.find_one({"_id": oid, "deleted_at": None})

    async def update_status(
        self,
        job_id: str,
        status: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        increment_attempts: bool = False,
    ) -> Optional[JobRun]:
        job = await self.get_by_id(job_id)
        if not job:
            return None
        job.status = status
        job.updated_at = utc_now()
        if result is not None:
            job.result = result
        if error is not None:
            job.error = error
        if increment_attempts:
            job.attempts += 1
        if status in ("completed", "failed"):
            job.completed_at = utc_now()
        await job.save()
        return job


job_run_repository = JobRunRepository()
