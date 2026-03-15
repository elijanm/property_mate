"""Inference endpoints."""
import asyncio
import base64
import json
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
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")


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
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")


@router.get("/{trainer_name}/schema", dependencies=[_any_role])
async def get_schema(trainer_name: str):
    """Returns the input + output schema for the active deployment."""
    from app.models.model_deployment import ModelDeployment
    dep = await ModelDeployment.find_one(
        ModelDeployment.trainer_name == trainer_name,
        ModelDeployment.status == "active",
        ModelDeployment.is_default == True,  # noqa: E712
    )
    if not dep:
        raise HTTPException(status_code=404, detail=f"No active deployment for '{trainer_name}'")
    return {
        "trainer_name": trainer_name,
        "version": dep.version,
        "model_uri": dep.model_uri,
        "input_schema": dep.input_schema or {},
        "output_schema": dep.output_schema if hasattr(dep, "output_schema") else {},
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


@router.get("/logs/{trainer_name}")
async def get_inference_logs(
    trainer_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    from app.models.inference_log import InferenceLog
    skip = (page - 1) * page_size
    query = InferenceLog.find(
        InferenceLog.trainer_name == trainer_name,
        InferenceLog.org_id == user.org_id,
    ).sort(-InferenceLog.created_at)
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
