from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies.auth import require_roles
from app.services import feedback_service

router = APIRouter(prefix="/feedback", tags=["Feedback"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))


class FeedbackRequest(BaseModel):
    trainer_name: str
    deployment_id: Optional[str] = None
    run_id: Optional[str] = None
    inference_log_id: Optional[str] = None
    model_output: Any = None
    predicted_label: Optional[str] = None
    actual_label: Optional[str] = None
    is_correct: Optional[bool] = None
    confidence_reported: Optional[float] = None
    notes: Optional[str] = None
    session_id: Optional[str] = None


@router.post("", dependencies=[_any_role])
async def submit_feedback(body: FeedbackRequest):
    fb = await feedback_service.submit_feedback(**body.model_dump())
    return {"id": str(fb.id), "trainer_name": fb.trainer_name, "is_correct": fb.is_correct}


@router.get("/{trainer_name}", dependencies=[_any_role])
async def list_feedback(
    trainer_name: str,
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
):
    records = await feedback_service.get_feedback(trainer_name, limit=limit, skip=skip)
    return [
        {
            "id": str(r.id),
            "trainer_name": r.trainer_name,
            "predicted_label": r.predicted_label,
            "actual_label": r.actual_label,
            "is_correct": r.is_correct,
            "confidence_reported": r.confidence_reported,
            "notes": r.notes,
            "created_at": r.created_at.isoformat(),
        }
        for r in records
    ]


@router.get("/{trainer_name}/confusion-matrix", dependencies=[_any_role])
async def confusion_matrix(trainer_name: str):
    return await feedback_service.get_confusion_matrix(trainer_name)


@router.get("/{trainer_name}/accuracy-trend", dependencies=[_any_role])
async def accuracy_trend(
    trainer_name: str,
    bucket: str = Query("day", pattern="^(day|hour)$"),
):
    return await feedback_service.get_accuracy_trend(trainer_name, bucket=bucket)


@router.get("/{trainer_name}/summary", dependencies=[_any_role])
async def summary(trainer_name: str):
    return await feedback_service.get_summary(trainer_name)
