"""Inference endpoints."""
import asyncio
import base64
import json
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Query
from pydantic import BaseModel, ConfigDict

from pydantic import field_validator

from app.dependencies.auth import require_roles, get_current_user
from app.services.inference_service import predict
from app.utils.serialization import doc_to_dict
from app.utils.s3_url import refresh_output_urls

router = APIRouter(prefix="/inference", tags=["inference"])


async def _resolve_org_slug(org_slug: str) -> tuple[str, bool]:
    """Resolve an org slug (current or previous) to (org_id, is_deprecated).
    Raises 404 if not found.
    """
    from app.models.org_config import OrgConfig
    # Try current slug first
    cfg = await OrgConfig.find_one({"slug": org_slug})
    if cfg:
        return cfg.org_id, False
    # Fall back to previous_slugs for backward-compat aliases
    cfg = await OrgConfig.find_one({"previous_slugs": org_slug})
    if cfg:
        return cfg.org_id, True
    raise HTTPException(status_code=404, detail=f"Organisation '{org_slug}' not found")

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


class PredictRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    inputs: Any
    model_version: Optional[str] = None       # target by MLflow version string
    plugin_version: Optional[int] = None      # target by plugin generation (0, 1, 2 …)
    training_patch: Optional[int] = None      # target by retraining ordinal (0 = first run)
    best_metric: Optional[str] = None         # e.g. "accuracy", "f1", "loss" — picks best-scoring deployment
    best_metric_mode: str = "max"             # "max" (higher is better) or "min" (lower is better)
    org_id: Optional[str] = None
    session_id: Optional[str] = None

    @field_validator("best_metric_mode")
    @classmethod
    def _validate_metric_mode(cls, v: str) -> str:
        if v not in ("max", "min"):
            raise ValueError("best_metric_mode must be 'max' or 'min'")
        return v


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
    """Run inference with a JSON body (system trainer)."""
    try:
        result, log_id = await predict(
            trainer_name=trainer_name,
            inputs=body.inputs,
            model_version=body.model_version,
            caller_org_id=user.org_id,
            session_id=body.session_id,
            org_id=user.org_id,
            user_email=user.email,
            plugin_version=body.plugin_version,
            training_patch=body.training_patch,
            best_metric=body.best_metric,
            best_metric_mode=body.best_metric_mode,
        )
        return {"trainer_name": trainer_name, "prediction": result, "log_id": log_id}
    except HTTPException:
        raise
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
    plugin_version: Optional[int] = Form(None),
    training_patch: Optional[int] = Form(None),
    best_metric: Optional[str] = Form(None),
    best_metric_mode: str = Form("max"),
    user=Depends(get_current_user),
):
    """Run inference by uploading a file (system trainer)."""
    data = await file.read()
    filename = file.filename or "upload"
    mime = file.content_type or "application/octet-stream"

    b64_data = _file_to_b64(data)
    inputs: dict = {
        "file_b64": b64_data,
        "file_name": filename,
        "mime_type": mime,
    }
    if mime.startswith("image/"):
        inputs["image_b64"] = b64_data

    # Map uploaded file to schema-declared image/file fields so trainers that
    # read inputs["image"] (or any other declared name) receive the data correctly.
    from app.models.model_deployment import ModelDeployment as _Dep
    _dep = await _Dep.find_one(
        _Dep.trainer_name == trainer_name,
        _Dep.status == "active",
        _Dep.is_default == True,  # noqa: E712
    ) or await _Dep.find(
        _Dep.trainer_name == trainer_name,
        _Dep.status == "active",
    ).sort(-_Dep.deployed_at).first_or_none()
    if _dep and _dep.input_schema:
        for _field_name, _field_spec in _dep.input_schema.items():
            if isinstance(_field_spec, dict) and _field_spec.get("type") in ("image", "file"):
                inputs.setdefault(_field_name, b64_data)

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
            plugin_version=plugin_version,
            training_patch=training_patch,
            best_metric=best_metric or None,
            best_metric_mode=best_metric_mode or "max",
        )
        return {"trainer_name": trainer_name, "prediction": result, "log_id": log_id}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        trainer_frame = next(
            (f for f in reversed(tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            tb[-1] if tb else None,
        )
        location = (
            f"{Path(trainer_frame.filename).name}:{trainer_frame.lineno} in {trainer_frame.name}"
            if trainer_frame else "unknown location"
        )
        raise HTTPException(status_code=500, detail=f"Inference failed at {location}: {exc}")


# ── Sub-resource routes (MUST be before org-slug catch-all) ───────────────────
# Any POST /{trainer_name}/X route must be registered before
# POST /{org_slug}/{trainer_name}, otherwise FastAPI's first-match routing
# swallows "X" as the trainer_name parameter of the org route.

class CompareRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    inputs: Any
    deployment_ids: List[str]


async def _run_compare(trainer_name: str, body: CompareRequest) -> dict:
    """Shared implementation for both compare routes."""
    from app.services.inference_service import predict_by_deployment_id
    from app.models.model_deployment import ModelDeployment as Dep

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
                "latency_ms": None,
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


@router.post("/{trainer_name}/compare", dependencies=[_any_role])
async def compare_versions(trainer_name: str, body: CompareRequest):
    """Run the same inputs against multiple deployments and return side-by-side results."""
    return await _run_compare(trainer_name, body)


class AllVersionsRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    inputs: Any


async def _run_all_versions(trainer_name: str, inputs: Any, org_id: str) -> dict:
    """Discover all active deployments for a trainer (scoped to org_id) and run inference in parallel."""
    from app.services.inference_service import predict_by_deployment_id
    from app.models.model_deployment import ModelDeployment as Dep

    deps = await Dep.find(
        Dep.trainer_name == trainer_name,
        Dep.org_id == org_id,
        Dep.status == "active",
    ).sort(-Dep.plugin_version, -Dep.training_patch).to_list()

    async def run_one(dep):
        import time
        t0 = time.monotonic()
        try:
            result, log_id = await predict_by_deployment_id(str(dep.id), inputs)
            return {
                "deployment_id": str(dep.id),
                "version_full": getattr(dep, "version_full", None),
                "plugin_version": getattr(dep, "plugin_version", 0),
                "training_patch": getattr(dep, "training_patch", 0),
                "mlflow_model_version": dep.mlflow_model_version,
                "is_default": dep.is_default,
                "metrics": dep.metrics or {},
                "prediction": result,
                "log_id": log_id,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "error": None,
            }
        except Exception as exc:
            return {
                "deployment_id": str(dep.id),
                "version_full": getattr(dep, "version_full", None),
                "plugin_version": getattr(dep, "plugin_version", 0),
                "training_patch": getattr(dep, "training_patch", 0),
                "mlflow_model_version": dep.mlflow_model_version,
                "is_default": dep.is_default,
                "metrics": dep.metrics or {},
                "prediction": None,
                "log_id": None,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "error": str(exc),
            }

    results = await asyncio.gather(*[run_one(d) for d in deps])
    return {"trainer_name": trainer_name, "total": len(results), "results": list(results)}


@router.post("/{trainer_name}/all-versions", dependencies=[_any_role])
async def all_versions_inference(
    trainer_name: str,
    body: AllVersionsRequest,
    user=Depends(get_current_user),
):
    """Run inputs against ALL active deployments for this trainer and return a result per version."""
    return await _run_all_versions(trainer_name, body.inputs, user.org_id)


# ── Org-slug routes ───────────────────────────────────────────────────────────
# POST /inference/{org_slug}/{trainer_name}
# POST /inference/{org_slug}/{trainer_name}/upload
# POST /inference/{org_slug}/{trainer_name}/compare
# GET  /inference/{org_slug}/{trainer_name}/schema
# Registered AFTER all /{trainer_name}/SUFFIX routes above so FastAPI
# doesn't swallow known suffixes as trainer_name segments.

@router.post("/{org_slug}/{trainer_name}")
async def run_inference_org(
    org_slug: str,
    trainer_name: str,
    body: PredictRequest,
    user=Depends(get_current_user),
):
    """Run inference against an org-owned trainer via its slug-prefixed URL."""
    from fastapi.responses import JSONResponse
    namespace, is_deprecated = await _resolve_org_slug(org_slug)
    try:
        result, log_id = await predict(
            trainer_name=trainer_name,
            inputs=body.inputs,
            model_version=body.model_version,
            caller_org_id=user.org_id,
            session_id=body.session_id,
            org_id=user.org_id,
            user_email=user.email,
            namespace_constraint=namespace,
            plugin_version=body.plugin_version,
            training_patch=body.training_patch,
            best_metric=body.best_metric,
            best_metric_mode=body.best_metric_mode,
        )
        payload = {"trainer_name": f"{org_slug}/{trainer_name}", "prediction": result, "log_id": log_id}
        if is_deprecated:
            response = JSONResponse(content=payload)
            response.headers["X-Slug-Deprecated"] = "true"
            response.headers["X-Slug-Hint"] = "This org slug has changed. Update your integration URL."
            return response
        return payload
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        trainer_frame = next(
            (f for f in reversed(tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            tb[-1] if tb else None,
        )
        location = (
            f"{Path(trainer_frame.filename).name}:{trainer_frame.lineno} in {trainer_frame.name}"
            if trainer_frame else "unknown location"
        )
        raise HTTPException(status_code=500, detail=f"Inference failed at {location}: {exc}")


@router.post("/{org_slug}/{trainer_name}/upload")
async def run_inference_org_upload(
    org_slug: str,
    trainer_name: str,
    file: UploadFile = File(...),
    extra: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    plugin_version: Optional[int] = Form(None),
    training_patch: Optional[int] = Form(None),
    best_metric: Optional[str] = Form(None),
    best_metric_mode: str = Form("max"),
    user=Depends(get_current_user),
):
    """Run inference by uploading a file against an org-owned trainer."""
    from fastapi.responses import JSONResponse
    namespace, is_deprecated = await _resolve_org_slug(org_slug)
    data = await file.read()
    filename = file.filename or "upload"
    mime = file.content_type or "application/octet-stream"

    b64_data = _file_to_b64(data)
    inputs: dict = {
        "file_b64": b64_data,
        "file_name": filename,
        "mime_type": mime,
    }
    if mime.startswith("image/"):
        inputs["image_b64"] = b64_data

    from app.models.model_deployment import ModelDeployment as _Dep
    _dep = await _Dep.find_one(
        _Dep.trainer_name == trainer_name,
        _Dep.status == "active",
        _Dep.is_default == True,  # noqa: E712
    ) or await _Dep.find(
        _Dep.trainer_name == trainer_name,
        _Dep.status == "active",
    ).sort(-_Dep.deployed_at).first_or_none()
    if _dep and _dep.input_schema:
        for _field_name, _field_spec in _dep.input_schema.items():
            if isinstance(_field_spec, dict) and _field_spec.get("type") in ("image", "file"):
                inputs.setdefault(_field_name, b64_data)

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
            namespace_constraint=namespace,
            plugin_version=plugin_version,
            training_patch=training_patch,
            best_metric=best_metric or None,
            best_metric_mode=best_metric_mode or "max",
        )
        payload = {"trainer_name": f"{org_slug}/{trainer_name}", "prediction": result, "log_id": log_id}
        if is_deprecated:
            response = JSONResponse(content=payload)
            response.headers["X-Slug-Deprecated"] = "true"
            response.headers["X-Slug-Hint"] = "This org slug has changed. Update your integration URL."
            return response
        return payload
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        trainer_frame = next(
            (f for f in reversed(tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            tb[-1] if tb else None,
        )
        location = (
            f"{Path(trainer_frame.filename).name}:{trainer_frame.lineno} in {trainer_frame.name}"
            if trainer_frame else "unknown location"
        )
        raise HTTPException(status_code=500, detail=f"Inference failed at {location}: {exc}")


@router.get("/{org_slug}/{trainer_name}/schema", dependencies=[_any_role])
async def get_schema_org(org_slug: str, trainer_name: str):
    """Returns schema for an org-owned trainer via its slug-prefixed URL."""
    await _resolve_org_slug(org_slug)  # validates slug exists (ignore deprecated flag)
    return await get_schema(trainer_name)


@router.post("/{org_slug}/{trainer_name}/compare", dependencies=[_any_role])
async def compare_versions_org(org_slug: str, trainer_name: str, body: CompareRequest):
    """Compare versions of an org-owned trainer via its slug-prefixed URL."""
    await _resolve_org_slug(org_slug)  # validates slug exists
    return await _run_compare(trainer_name, body)


@router.post("/{org_slug}/{trainer_name}/all-versions", dependencies=[_any_role])
async def all_versions_inference_org(
    org_slug: str,
    trainer_name: str,
    body: AllVersionsRequest,
    user=Depends(get_current_user),
):
    """Run inputs against ALL active deployments for an org-owned trainer."""
    namespace, _ = await _resolve_org_slug(org_slug)
    return await _run_all_versions(trainer_name, body.inputs, namespace)


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
        # Fallback: use any active deployment for this trainer
        dep = await ModelDeployment.find(
            ModelDeployment.trainer_name == trainer_name,
            ModelDeployment.status == "active",
        ).sort(-ModelDeployment.deployed_at).first_or_none()
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
    if not dep and reg:
        # Fallback 2: no deployments for this plugin version — check same base_name family
        import re as _re
        _base = getattr(reg, "base_name", None) or _re.sub(r"_v\d+$", "", trainer_name)
        dep = await ModelDeployment.find(
            ModelDeployment.base_name == _base,
            ModelDeployment.status == "active",
        ).sort(-ModelDeployment.deployed_at).first_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail=f"No active deployment for '{trainer_name}'")

    # Use reg.org_id as the authoritative ownership source.
    # reg.namespace may have been incorrectly reset to "system" by past system-wide
    # scan_and_register_plugins() calls that ran without org context (app startup, train task).
    reg_org_id = (reg.org_id if reg else "") or ""
    if reg_org_id:
        namespace = reg_org_id
    else:
        namespace = (reg.namespace if reg and reg.namespace else None) or "system"

    full_name = reg.full_name if reg and reg.full_name else trainer_name

    # Compute / repair alias.
    # Force recompute when:
    #   - alias is empty, OR
    #   - trainer is org-owned but alias has no "/" prefix (was corrupted by a system scan)
    alias = (reg.alias or "") if reg else ""
    is_org_owned = namespace not in ("system", "")
    alias_needs_prefix = is_org_owned and "/" not in alias

    if not alias or alias_needs_prefix:
        if not is_org_owned:
            alias = trainer_name  # system trainer — no prefix
        else:
            from app.models.org_config import OrgConfig
            org_cfg = await OrgConfig.find_one(OrgConfig.org_id == namespace)
            if org_cfg and org_cfg.slug:
                alias = f"{org_cfg.slug}/{trainer_name}"
            elif reg and reg.owner_email:
                prefix = reg.owner_email.split("@")[0].lower().replace(".", "_")
                alias = f"{prefix}/{trainer_name}"
            else:
                alias = f"{namespace[:8]}/{trainer_name}"

        # Repair the stored record so future calls and inference routing are correct
        if reg:
            await reg.set({
                "alias": alias,
                "namespace": namespace,
                "full_name": f"{namespace}/{trainer_name}",
            })

    return {
        "trainer_name": trainer_name,
        "alias": alias,
        "namespace": namespace,
        "full_name": full_name,
        "version": dep.version,
        "model_uri": dep.model_uri,
        "input_schema": dep.input_schema or {},
        "output_schema": dep.output_schema if hasattr(dep, "output_schema") else {},
        "output_display": reg.output_display if reg else [],
    }


@router.get("/logs/debug")
async def debug_inference_logs(user=Depends(get_current_user)):
    """Debug: show org_id and log counts to help diagnose missing logs."""
    from app.models.inference_log import InferenceLog
    total_all = await InferenceLog.count()
    total_mine = await InferenceLog.find(InferenceLog.org_id == user.org_id).count()
    recent = await InferenceLog.find().sort(-InferenceLog.created_at).limit(5).to_list()
    return {
        "your_org_id": user.org_id,
        "total_logs_in_db": total_all,
        "total_logs_matching_your_org": total_mine,
        "last_5_logs": [
            {
                "id": str(l.id),
                "trainer_name": l.trainer_name,
                "org_id": l.org_id,
                "deployment_id": l.deployment_id,
                "error": l.error,
                "created_at": l.created_at.isoformat(),
            }
            for l in recent
        ],
    }


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
