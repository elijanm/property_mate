"""Async batch inference job processing."""
import asyncio
import json
import io
import structlog
from typing import List, Any
import aioboto3

from app.models.batch_job import BatchJob
from app.core.config import settings
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def create_job(trainer_name: str, rows: List[dict], submitted_by: str = "", org_id: str = "") -> BatchJob:
    job = BatchJob(trainer_name=trainer_name, total_rows=len(rows), submitted_by=submitted_by, org_id=org_id)
    await job.insert()

    # Store input in S3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        key = f"batch/{job.id}/input.jsonl"
        body = "\n".join(json.dumps(r) for r in rows)
        await s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=body.encode())
        job.input_s3_key = key
    await job.save()

    asyncio.create_task(_run_batch(str(job.id), rows))
    return job


async def _run_batch(job_id: str, rows: List[dict]) -> None:
    from app.services.inference_service import run_inference
    job = await BatchJob.get(job_id)
    if not job:
        return
    job.status = "running"
    job.started_at = utc_now()
    await job.save()

    results = []
    for row in rows:
        try:
            result = await run_inference(job.trainer_name, row, log_result=False)
            results.append({"input": row, "output": result, "error": None})
            job.processed_rows += 1
        except Exception as e:
            results.append({"input": row, "output": None, "error": str(e)})
            job.failed_rows += 1
        job.processed_rows = len([r for r in results if r["error"] is None])
        await job.save()

    # Write results to S3
    try:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        ) as s3:
            key = f"batch/{job_id}/output.jsonl"
            body = "\n".join(json.dumps(r) for r in results)
            await s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=body.encode())
            job.output_s3_key = key
    except Exception as e:
        logger.error("batch_s3_write_failed", job_id=job_id, error=str(e))

    job.status = "completed"
    job.completed_at = utc_now()
    await job.save()
    logger.info("batch_job_completed", job_id=job_id, total=job.total_rows, failed=job.failed_rows)


async def get_job(job_id: str) -> BatchJob:
    from fastapi import HTTPException
    job = await BatchJob.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return job


async def list_jobs(trainer_name: str | None = None, limit: int = 50, org_id: str = "") -> list[BatchJob]:
    q: dict = {"org_id": org_id}
    if trainer_name:
        q["trainer_name"] = trainer_name
    return await BatchJob.find(q).sort("-created_at").limit(limit).to_list()


async def get_results(job: BatchJob) -> list[dict]:
    if not job.output_s3_key:
        return []
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        obj = await s3.get_object(Bucket=settings.S3_BUCKET, Key=job.output_s3_key)
        body = await obj["Body"].read()
    return [json.loads(line) for line in body.decode().splitlines() if line.strip()]
