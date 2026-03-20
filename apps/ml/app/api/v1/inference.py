"""Inference endpoints."""
import asyncio
import base64
import json
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from pydantic import BaseModel, ConfigDict

from app.dependencies.auth import require_roles, get_current_user
from app.services.inference_service import predict
from app.utils.serialization import doc_to_dict
from app.utils.s3_url import refresh_output_urls

router = APIRouter(prefix="/inference", tags=["inference"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class PredictRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    inputs: Any
    model_version: Optional[str] = None
    org_id: Optional[str] = None
    session_id: Optional[str] = None


class CorrectionRequest(BaseModel):
    corrected_output: Any


def _file_to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _serialize_log(log) -> dict:
    """Serialize an InferenceLog to dict with refreshed image URLs."""
    d = doc_to_dict(log)
    if log.image_keys and isinstance(d.get("outputs"), dict):
        d["outputs"] = refresh_output_urls(d["outputs"], log.image_keys)
    if log.corrected_output and isinstance(d.get("corrected_output"), dict):
        d["corrected_output"] = refresh_output_urls(d["corrected_output"], log.image_keys)
    return d


def _extract_predicted_label_hint(outputs: Any, display_spec: list) -> Optional[str]:
    """
    Extract the single most-meaningful predicted value from outputs.

    Priority:
    1. First spec with primary=True that exists in outputs
    2. Heuristic key-name scan (reading > label > class > prediction > ...)
    3. top[0].label pattern
    4. First short scalar value
    """
    if not outputs:
        return None
    if not isinstance(outputs, dict):
        v = str(outputs)
        return v[:100] if v else None

    # 1. Trainer-declared primary field
    for spec in display_spec:
        if spec.get("primary") and spec.get("key") in outputs:
            val = outputs[spec["key"]]
            if val is not None:
                return str(val)

    # 2. Priority key scan
    for key in ("reading", "label", "class", "prediction", "predicted_class",
                "text", "number", "value", "result", "ocr_text", "detected_text"):
        if key in outputs and outputs[key] is not None:
            return str(outputs[key])

    # 3. top[0].label pattern
    top = outputs.get("top")
    if isinstance(top, list) and top:
        first = top[0]
        if isinstance(first, dict):
            lbl = first.get("label") or first.get("class")
            if lbl:
                return str(lbl)

    # 4. First short scalar
    for val in outputs.values():
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str) and len(val) <= 80:
            return val

    return None


@router.post("/{trainer_name}")
async def run_inference(trainer_name: str, body: PredictRequest, user=Depends(get_current_user)):
    """Run inference with a JSON body."""
    try:
        result, log_id = await predict(
            trainer_name=trainer_name,
            inputs=body.inputs,
            model_version=body.model_version,
            caller_org_id=user.org_id,
            session_id=body.session_id,
            org_id=user.org_id,
            user_email=user.email,
        )
        return {"trainer_name": trainer_name, "prediction": result, "log_id": log_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        # find the innermost frame inside user trainer code (skip framework frames)
        trainer_frame = next(
            (f for f in reversed(tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            tb[-1] if tb else None,
        )
        location = (
            f"{Path(trainer_frame.filename).name}:{trainer_frame.lineno} in {trainer_frame.name}"
            if trainer_frame else "unknown location"
        )
        raise HTTPException(status_code=500, detail=f"Inference failed at {location}: {exc}")


@router.post("/{trainer_name}/upload")
async def run_inference_upload(
    trainer_name: str,
    file: UploadFile = File(...),
    extra: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    user=Depends(get_current_user),
):
    """Run inference by uploading a file."""
    data = await file.read()
    filename = file.filename or "upload"
    mime = file.content_type or "application/octet-stream"

    inputs: dict = {
        "file_b64": _file_to_b64(data),
        "file_name": filename,
        "mime_type": mime,
    }
    if mime.startswith("image/"):
        inputs["image_b64"] = inputs["file_b64"]
    if extra:
        try:
            inputs.update(json.loads(extra))
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="`extra` must be a valid JSON string")

    try:
        result, log_id = await predict(
            trainer_name=trainer_name,
            inputs=inputs,
            model_version=version or None,
            caller_org_id=user.org_id,
            session_id=session_id,
            org_id=user.org_id,
            user_email=user.email,
        )
        return {"trainer_name": trainer_name, "prediction": result, "log_id": log_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        # find the innermost frame inside user trainer code (skip framework frames)
        trainer_frame = next(
            (f for f in reversed(tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            tb[-1] if tb else None,
        )
        location = (
            f"{Path(trainer_frame.filename).name}:{trainer_frame.lineno} in {trainer_frame.name}"
            if trainer_frame else "unknown location"
        )
        raise HTTPException(status_code=500, detail=f"Inference failed at {location}: {exc}")


@router.get("/{trainer_name}/schema", dependencies=[_any_role])
async def get_schema(trainer_name: str):
    """Returns the input + output schema for the active deployment, including output_display spec."""
    from app.models.model_deployment import ModelDeployment
    from app.models.trainer_registration import TrainerRegistration
    dep = await ModelDeployment.find_one(
        ModelDeployment.trainer_name == trainer_name,
        ModelDeployment.status == "active",
        ModelDeployment.is_default == True,  # noqa: E712
    )
    if not dep:
        raise HTTPException(status_code=404, detail=f"No active deployment for '{trainer_name}'")
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
    return {
        "trainer_name": trainer_name,
        "version": dep.version,
        "model_uri": dep.model_uri,
        "input_schema": dep.input_schema or {},
        "output_schema": dep.output_schema if hasattr(dep, "output_schema") else {},
        "output_display": reg.output_display if reg else [],
    }


class CompareRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    inputs: Any
    deployment_ids: List[str]


@router.post("/{trainer_name}/compare", dependencies=[_any_role])
async def compare_versions(trainer_name: str, body: CompareRequest):
    """
    Run the same inputs against multiple deployments in parallel and return
    side-by-side results for version comparison.
    """
    from app.services.inference_service import predict_by_deployment_id
    from app.models.model_deployment import ModelDeployment as Dep

    # Validate deployment IDs belong to this trainer
    deployments = {str(d.id): d for d in await Dep.find(
        Dep.trainer_name == trainer_name
    ).to_list()}

    async def run_one(dep_id: str):
        dep = deployments.get(dep_id)
        if not dep:
            return {
                "deployment_id": dep_id,
                "version": "unknown",
                "model_name": trainer_name,
                "error": "Deployment not found",
                "result": None,
                "latency_ms": None,
            }
        try:
            result, log_id = await predict_by_deployment_id(dep_id, body.inputs)
            return {
                "deployment_id": dep_id,
                "version": dep.mlflow_model_version,
                "model_name": dep.mlflow_model_name,
                "is_default": dep.is_default,
                "result": result,
                "log_id": log_id,
                "error": None,
                "latency_ms": None,  # latency is inside predict_by_deployment_id already
            }
        except Exception as exc:
            return {
                "deployment_id": dep_id,
                "version": dep.mlflow_model_version if dep else "?",
                "model_name": dep.mlflow_model_name if dep else trainer_name,
                "is_default": dep.is_default if dep else False,
                "result": None,
                "log_id": None,
                "error": str(exc),
                "latency_ms": None,
            }

    comparisons = await asyncio.gather(*[run_one(dep_id) for dep_id in body.deployment_ids])
    return {"trainer_name": trainer_name, "comparisons": list(comparisons)}


@router.get("/logs/all")
async def get_all_inference_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    trainer_name: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """All inference logs across all trainers (paginated)."""
    from app.models.inference_log import InferenceLog
    skip = (page - 1) * page_size
    filters = [InferenceLog.org_id == user.org_id]
    if trainer_name:
        filters.append(InferenceLog.trainer_name == trainer_name)
    query = InferenceLog.find(*filters).sort(-InferenceLog.created_at)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).to_list()
    return {"items": [_serialize_log(i) for i in items], "total": total, "page": page, "page_size": page_size}


@router.get("/logs/{trainer_name}/recent", dependencies=[_any_role])
async def get_recent_inference_logs(
    trainer_name: str,
    limit: int = Query(20, ge=1, le=50),
    deployment_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """
    Last N successful inference logs with predicted_label_hint extracted — used by the
    feedback panel dropdown so users can pick an inference and report on it.
    Optionally filter to a specific deployment_id.
    """
    from app.models.inference_log import InferenceLog
    from app.models.trainer_registration import TrainerRegistration

    reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
    display_spec: list = reg.output_display if reg else []

    filters = [
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.org_id == user.org_id,
        InferenceLog.error == None,  # noqa: E711
    ]
    if deployment_id:
        filters.append(InferenceLog.deployment_id == deployment_id)

    items = await InferenceLog.find(*filters).sort(-InferenceLog.created_at).limit(limit).to_list()

    result = []
    for log in items:
        d = _serialize_log(log)
        d["predicted_label_hint"] = _extract_predicted_label_hint(d.get("outputs"), display_spec)
        result.append(d)
    return result


@router.get("/logs/{trainer_name}")
async def get_inference_logs(
    trainer_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    deployment_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    from app.models.inference_log import InferenceLog
    skip = (page - 1) * page_size
    filters = [
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.org_id == user.org_id,
    ]
    if deployment_id:
        filters.append(InferenceLog.deployment_id == deployment_id)
    query = InferenceLog.find(*filters).sort(-InferenceLog.created_at)
    total = await query.count()
    items = await query.skip(skip).limit(page_size).to_list()
    return {"items": [_serialize_log(i) for i in items], "total": total}


@router.patch("/logs/correct/{log_id}", dependencies=[_engineer])
async def correct_inference_log(log_id: str, body: CorrectionRequest):
    """Save a user correction to an inference result (editable output fields)."""
    from app.models.inference_log import InferenceLog
    from app.utils.datetime import utc_now
    try:
        log = await InferenceLog.get(log_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inference log not found")
    if not log:
        raise HTTPException(status_code=404, detail="Inference log not found")
    log.corrected_output = body.corrected_output
    await log.save()
    return _serialize_log(log)


@router.delete("/logs/delete/{log_id}", dependencies=[_engineer])
async def delete_inference_log(log_id: str):
    """Delete a single inference log record."""
    from app.models.inference_log import InferenceLog
    try:
        log = await InferenceLog.get(log_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inference log not found")
    if not log:
        raise HTTPException(status_code=404, detail="Inference log not found")
    await log.delete()
    return {"deleted": True}
