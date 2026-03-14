"""Evaluation and confusion matrix endpoints."""
from typing import List, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
import base64

from app.dependencies.auth import require_roles
from app.services.evaluation_service import evaluate_deployment

router = APIRouter(prefix="/evaluation", tags=["evaluation"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    test_inputs: List[Any]
    test_labels: List[Any]
    model_version: Optional[str] = None


@router.post("/{trainer_name}", dependencies=[_any_role])
async def evaluate(trainer_name: str, body: EvaluateRequest):
    """Evaluate a deployed model. Returns metrics + base64 confusion matrix PNG."""
    try:
        return await evaluate_deployment(
            trainer_name=trainer_name,
            test_inputs=body.test_inputs,
            test_labels=body.test_labels,
            model_version=body.model_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{trainer_name}/confusion-matrix.png", dependencies=[_any_role])
async def confusion_matrix_image(trainer_name: str, body: EvaluateRequest):
    """Return the confusion matrix directly as a PNG image."""
    try:
        result = await evaluate_deployment(
            trainer_name=trainer_name,
            test_inputs=body.test_inputs,
            test_labels=body.test_labels,
            model_version=body.model_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    png_b64 = result.get("confusion_matrix_png")
    if not png_b64:
        raise HTTPException(status_code=422, detail="Confusion matrix not available (regression model?)")
    return Response(content=base64.b64decode(png_b64), media_type="image/png")
