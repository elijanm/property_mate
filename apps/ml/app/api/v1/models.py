"""Model deployment management."""
import asyncio
from typing import AsyncIterator, Dict, List, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
import mlflow
from mlflow.tracking import MlflowClient
from sse_starlette.sse import EventSourceResponse

from app.core.config import settings
from app.dependencies.auth import require_roles, get_current_user
from app.models.model_deployment import ModelDeployment
from app.models.model_scan_job import ModelScanJob
from app.services.zip_deploy_service import ZipManifestError, deploy_from_zip
from app.tasks.train_task import enqueue_pretrained_deploy
from app.utils.datetime import utc_now
from app.utils.serialization import doc_to_dict

router = APIRouter(prefix="/models", tags=["models"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))

# Keep strong references to background scan tasks so they aren't garbage-collected
# before they complete (asyncio.create_task() alone doesn't prevent GC).
_running_scan_tasks: set = set()


def _fire_scan(coro) -> None:
    task = asyncio.create_task(coro)
    _running_scan_tasks.add(task)
    task.add_done_callback(_running_scan_tasks.discard)


class DeployPretrainedRequest(BaseModel):
    """Body for deploying a pre-trained model from a URI (no file upload)."""
    name: str
    version: str = "1.0.0"
    description: str = ""
    tags: Dict[str, str] = {}
    set_as_default: bool = True
    # exactly one source:
    huggingface_model_id: Optional[str] = None
    huggingface_task: Optional[str] = None    # e.g. "text-classification"
    s3_key: Optional[str] = None
    url: Optional[str] = None
    mlflow_uri: Optional[str] = None


@router.post("/deploy-pretrained", status_code=202)
async def deploy_pretrained_from_uri(
    body: DeployPretrainedRequest,
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Deploy a pre-trained model from HuggingFace Hub, S3, URL, or an existing
    MLflow URI — no training run required.

    Returns immediately with a job_id. Poll GET /training/jobs/{job_id} for status.
    HuggingFace downloads and MLflow logging run in the background worker.
    """
    sources = [body.huggingface_model_id, body.s3_key, body.url, body.mlflow_uri]
    if sum(s is not None for s in sources) != 1:
        raise HTTPException(status_code=400, detail="Provide exactly one of: huggingface_model_id, s3_key, url, mlflow_uri")

    deploy_kwargs = {
        "name": body.name,
        "version": body.version,
        "description": body.description,
        "tags": body.tags,
        "huggingface_model_id": body.huggingface_model_id,
        "huggingface_task": body.huggingface_task,
        "s3_key": body.s3_key,
        "url": body.url,
        "mlflow_uri": body.mlflow_uri,
        "set_as_default": body.set_as_default,
    }
    job_id = await enqueue_pretrained_deploy(deploy_kwargs, owner_email=user.email, org_id=user.org_id)
    return {"job_id": job_id, "status": "queued"}


@router.post("/deploy-pretrained/upload", status_code=202)
async def deploy_pretrained_from_file(
    file: UploadFile = File(..., description="Model file (.pkl, .joblib, .onnx, .pt, .h5, etc.)"),
    name: str = Form(...),
    version: str = Form("1.0.0"),
    description: str = Form(""),
    set_as_default: bool = Form(True),
    inference_script: Optional[UploadFile] = File(
        default=None,
        description=(
            "Optional Python file defining a mlflow.pyfunc.PythonModel subclass. "
            "Required for custom preprocessing / non-standard formats. "
            "If omitted, the format is auto-detected from the model file extension. "
            "The class must implement load_context(self, context) and "
            "predict(self, context, model_input). "
            "Access the uploaded model via context.artifacts['model_file']."
        ),
    ),
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Upload a model file, run a security scan, then deploy.

    Returns immediately with a ``scan_id``. Connect to
    ``GET /models/scan/{scan_id}/stream`` (SSE) to watch the scan console.
    On scan pass the deploy job is queued automatically.
    """
    model_bytes = await file.read()
    script_bytes: Optional[bytes] = None
    if inference_script is not None:
        if not (inference_script.filename or "").endswith(".py"):
            raise HTTPException(status_code=400, detail="inference_script must be a .py file")
        script_bytes = await inference_script.read()

    deploy_kwargs = {
        "name": name,
        "version": version,
        "description": description,
        "file_name": file.filename or "model.pkl",
        "set_as_default": set_as_default,
    }

    scan_job = ModelScanJob(
        org_id=user.org_id or "",
        owner_email=user.email,
        filename=file.filename or "model.pkl",
        file_size_bytes=len(model_bytes),
        upload_type="file",
    )
    await scan_job.insert()

    from app.services.model_scan_service import run_model_scan_background
    _fire_scan(run_model_scan_background(
        scan_id=str(scan_job.id),
        zip_bytes=None,
        file_bytes=model_bytes,
        script_bytes=script_bytes,
        filename=file.filename or "model.pkl",
        deploy_kwargs=deploy_kwargs,
        owner_email=user.email,
        org_id=user.org_id or "",
    ))

    return {"scan_id": str(scan_job.id), "status": "scanning"}


@router.post("/deploy-pretrained/zip")
async def deploy_pretrained_from_zip(
    file: UploadFile = File(..., description="Model ZIP archive (see structure below)"),
    action: Optional[str] = Form(default=None, description="Conflict resolution: 'upgrade' (new version) or 'replace' (archive old)"),
    user=Depends(require_roles("engineer", "admin")),
):
    """
    Deploy a model from a structured ZIP archive — the recommended upload method.

    If a deployment with the same name already exists and **action** is omitted,
    returns ``{"conflict": true, ...}`` (HTTP 200) so the client can prompt the user.
    Pass ``action=upgrade`` to add a new version, or ``action=replace`` to archive
    all previous deployments and redeploy.

    Returns immediately with a ``scan_id``. Connect to
    ``GET /models/scan/{scan_id}/stream`` (SSE) to watch the scan console.
    """
    import io as _io
    import json as _json
    import zipfile as _zf

    if not (file.filename or "").endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    zip_bytes = await file.read()

    # Peek manifest to detect model name for conflict check
    peeked_name: Optional[str] = None
    peeked_version: Optional[str] = None
    try:
        with _zf.ZipFile(_io.BytesIO(zip_bytes)) as zf:
            candidates = [n for n in zf.namelist() if n.endswith("manifest.json")]
            if candidates:
                with zf.open(candidates[0]) as mf:
                    preview = _json.load(mf)
                peeked_name = preview.get("name")
                peeked_version = preview.get("version", "1.0.0")
    except Exception:
        pass

    # Conflict detection — only when action is not already specified
    if peeked_name and action is None:
        existing = await ModelDeployment.find(
            ModelDeployment.trainer_name == peeked_name,
            ModelDeployment.status == "active",
        ).first_or_none()
        if existing:
            return {
                "conflict": True,
                "model_name": peeked_name,
                "new_version": peeked_version,
                "existing_version": existing.version,
                "existing_mlflow_version": existing.mlflow_model_version,
            }

    # Replace: archive all previous deployments for this model (synchronous — must happen
    # before the background task runs to avoid race conditions)
    if peeked_name and action == "replace":
        prev = await ModelDeployment.find(
            ModelDeployment.trainer_name == peeked_name,
        ).to_list()
        for p in prev:
            await p.set({"status": "archived", "is_default": False, "updated_at": utc_now()})

    scan_job = ModelScanJob(
        org_id=user.org_id or "",
        owner_email=user.email,
        filename=file.filename or "model.zip",
        file_size_bytes=len(zip_bytes),
        upload_type="zip",
    )
    await scan_job.insert()

    from app.services.model_scan_service import run_model_scan_background
    _fire_scan(run_model_scan_background(
        scan_id=str(scan_job.id),
        zip_bytes=zip_bytes,
        file_bytes=None,
        script_bytes=None,
        filename=file.filename or "model.zip",
        deploy_kwargs={"name": peeked_name or "", "version": peeked_version or "1.0.0"},
        owner_email=user.email,
        org_id=user.org_id or "",
        zip_action=action,
    ))

    return {
        "scan_id": str(scan_job.id),
        "status": "scanning",
        "model_name": peeked_name,
    }


@router.get("/scan/{scan_id}/stream")
async def stream_model_scan(
    scan_id: str,
    user=Depends(get_current_user),
):
    """SSE stream for a model upload's scan/deploy progress.

    Connect with EventSource at:
      /api/v1/models/scan/{scan_id}/stream?token=<jwt>

    Events:
      log    — { type: "log", level: "info|success|warn|error", msg: string }
      status — { type: "status", status: string }
      done   — terminal event; close the EventSource
      ping   — heartbeat, ignore
      error  — access error
    """
    from app.services.model_scan_service import model_scan_sse_generator
    return EventSourceResponse(model_scan_sse_generator(scan_id, user.org_id or ""))


@router.get("")
async def list_deployments(
    trainer_name: Optional[str] = None,
    base_name: Optional[str] = None,
    include_all: bool = False,
    user=Depends(get_current_user),
):
    # Scope to caller's org — also include legacy system records (org_id="")
    base_filters = [ModelDeployment.status == "active"]
    if trainer_name:
        base_filters.append(ModelDeployment.trainer_name == trainer_name)
    if base_name:
        base_filters.append(ModelDeployment.base_name == base_name)

    all_deps = await ModelDeployment.find(*base_filters).sort(-ModelDeployment.deployed_at).to_list()

    if user.role == "admin":
        # Admins see their own org + system records
        deps = [d for d in all_deps if not d.org_id or d.org_id == user.org_id]
    else:
        # Non-admins see:
        # 1. Models in their own org that they own or are marked viewer-visible
        # 2. Platform-wide models (no org_id) with visibility="viewer" — regardless of who deployed them
        deps = [
            d for d in all_deps
            if (d.org_id == user.org_id and (d.visibility == "viewer" or d.owner_email == user.email))
            or (not d.org_id and d.visibility == "viewer")
        ]

    if not include_all and not trainer_name and not base_name:
        # When listing all trainers without a filter, return only defaults (one per trainer)
        deps = [d for d in deps if d.is_default]

    return {"items": [doc_to_dict(d) for d in deps], "total": len(deps)}


@router.get("/with-versions")
async def list_deployments_with_versions(
    trainer_name: Optional[str] = None,
    base_name: Optional[str] = None,
    user=Depends(get_current_user),
):
    """
    Returns all trainer families with ALL their deployed versions and metrics,
    grouped by base_name across plugin versions.

    Each entry contains:
      - top-level fields from the best (highest plugin_version + training_patch) deployment
      - `versions`: all deployments sorted by (plugin_version desc, training_patch desc)
      - `version_full`: "v{plugin_version}.0.0.{training_patch}" per version
    """
    import re as _re
    from collections import defaultdict
    base_filters = [ModelDeployment.status == "active"]
    if trainer_name:
        base_filters.append(ModelDeployment.trainer_name == trainer_name)
    if base_name:
        base_filters.append(ModelDeployment.base_name == base_name)

    all_deps = await ModelDeployment.find(*base_filters).sort(-ModelDeployment.deployed_at).to_list()

    if user.role == "admin":
        deps = [d for d in all_deps if not d.org_id or d.org_id == user.org_id]
    else:
        deps = [
            d for d in all_deps
            if (d.org_id == user.org_id and (d.visibility == "viewer" or d.owner_email == user.email))
            or (not d.org_id and d.visibility == "viewer")
        ]

    # Group by base_name (falls back to stripping _vN suffix for legacy records without base_name)
    grouped: dict = defaultdict(list)
    for d in deps:
        key = d.base_name or _re.sub(r"_v\d+$", "", d.trainer_name)
        grouped[key].append(d)

    def _version_sort_key(d: ModelDeployment):
        return (d.plugin_version or 0, d.training_patch or 0)

    result = []
    for bname, versions in grouped.items():
        versions_sorted = sorted(versions, key=_version_sort_key, reverse=True)
        # Best deployment: prefer is_default=True within highest plugin_version; else just highest
        best = next(
            (d for d in versions_sorted if d.is_default and d.plugin_version == versions_sorted[0].plugin_version),
            versions_sorted[0],
        )
        def _vfull(d: ModelDeployment) -> str:
            # Use stored field; fall back to computing it for legacy records without it
            if d.version_full:
                return d.version_full
            _pv = d.plugin_version or 0
            _tp = d.training_patch or 0
            return f"v{_pv}.{_tp // 10}.{_tp % 10}"

        result.append({
            **doc_to_dict(best),
            "base_name": bname,
            "version_full": _vfull(best),
            "versions": [
                {
                    **doc_to_dict(d),
                    "metrics": d.metrics or {},
                    "is_current_default": d.is_default,
                    "version_full": _vfull(d),
                }
                for d in versions_sorted
            ],
        })

    return {"items": result, "total": len(result)}


@router.patch("/{deployment_id}/visibility")
async def set_visibility(
    deployment_id: str,
    body: dict,
    user=Depends(get_current_user),
):
    """Admin or deployment owner: toggle a deployment's visibility between 'viewer' and 'engineer'."""
    visibility = body.get("visibility")
    if visibility not in ("viewer", "engineer"):
        raise HTTPException(status_code=400, detail="visibility must be 'viewer' or 'engineer'")
    dep = await ModelDeployment.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if user.role != "admin" and dep.owner_email != user.email:
        raise HTTPException(status_code=403, detail="You do not have permission to change the visibility of this deployment")
    await dep.set({"visibility": visibility, "updated_at": utc_now()})
    return {"visibility": visibility}


@router.post("/{deployment_id}/set-default", dependencies=[_engineer])
async def set_default(deployment_id: str):
    dep = await ModelDeployment.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    await ModelDeployment.find(ModelDeployment.trainer_name == dep.trainer_name).update(
        {"$set": {"is_default": False}}
    )
    await dep.set({"is_default": True, "updated_at": utc_now()})
    return {"default_set": True}


def _artifact_label(path: str) -> str:
    """Derive a human-readable label from an artifact filename."""
    name = path.lower().split("/")[-1]
    # strip extension
    stem = name.rsplit(".", 1)[0] if "." in name else name
    if "train_confusion_matrix" in stem:
        return "Confusion Matrix (Train)"
    if "confusion_matrix_normalized" in stem:
        return "Confusion Matrix Normalized (Val)"
    if "confusion_matrix" in stem:
        return "Confusion Matrix (Val)"
    if "loss" in stem:
        return "Loss Curve"
    if "precision" in stem:
        return "Precision Curve"
    if "recall" in stem:
        return "Recall Curve"
    if "f1" in stem:
        return "F1 Curve"
    if "pr_curve" in stem or "pr-curve" in stem:
        return "PR Curve"
    if "roc" in stem:
        return "ROC Curve"
    if "results" in stem:
        return "Results"
    # fallback: title-case the stem with spaces
    return stem.replace("_", " ").replace("-", " ").title()


@router.get("/{deployment_id}/metric-history", dependencies=[_any_role])
async def get_metric_history(deployment_id: str):
    """Return per-epoch MLflow metric history for all metrics of a deployment run."""
    dep = await ModelDeployment.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")

    run_id: Optional[str] = getattr(dep, "run_id", None)
    if not run_id:
        return {"metrics": {}}

    def _fetch_history() -> Dict[str, List[dict]]:
        client = MlflowClient(tracking_uri=settings.MLFLOW_TRACKING_URI)
        try:
            run = client.get_run(run_id)
            metric_keys = list(run.data.metrics.keys())
        except Exception:
            return {}

        result: Dict[str, List[dict]] = {}
        for key in metric_keys:
            try:
                history = client.get_metric_history(run_id, key)
                result[key] = [
                    {"step": m.step, "value": m.value, "timestamp": m.timestamp}
                    for m in history
                ]
            except Exception:
                result[key] = []
        return result

    loop = asyncio.get_event_loop()
    try:
        metrics = await loop.run_in_executor(None, _fetch_history)
    except Exception:
        metrics = {}

    return {"metrics": metrics}


@router.get("/{deployment_id}/training-artifacts", dependencies=[_any_role])
async def get_training_artifacts(deployment_id: str):
    """Return artifact file listing with URLs for confusion matrices, training plots."""
    dep = await ModelDeployment.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")

    run_id: Optional[str] = getattr(dep, "run_id", None)
    if not run_id:
        return {"artifacts": []}

    IMAGE_EXTS = {".png", ".jpg", ".jpeg"}

    def _fetch_artifacts() -> List[dict]:
        client = MlflowClient(tracking_uri=settings.MLFLOW_TRACKING_URI)
        collected: List[dict] = []

        def _scan(path: Optional[str] = None) -> None:
            try:
                entries = client.list_artifacts(run_id, path)
            except Exception:
                return
            for entry in entries:
                if entry.is_dir:
                    _scan(entry.path)
                else:
                    ext = "." + entry.path.rsplit(".", 1)[-1].lower() if "." in entry.path else ""
                    if ext in IMAGE_EXTS:
                        # Route through our proxy so the browser can load it
                        # (http://mlflow:5000 is only reachable inside Docker)
                        from urllib.parse import urlencode
                        url = (
                            f"/api/v1/mlflow/artifact?"
                            + urlencode({"run_uuid": run_id, "path": entry.path})
                        )
                        collected.append({
                            "path": entry.path,
                            "url": url,
                            "label": _artifact_label(entry.path),
                        })

        _scan(None)
        # also explicitly probe common subdirs in case listing is shallow
        for subdir in ("plots", "images"):
            _scan(subdir)

        # deduplicate by path
        seen = set()
        unique: List[dict] = []
        for item in collected:
            if item["path"] not in seen:
                seen.add(item["path"])
                unique.append(item)
        return unique

    loop = asyncio.get_event_loop()
    try:
        artifacts = await loop.run_in_executor(None, _fetch_artifacts)
    except Exception:
        artifacts = []

    return {"artifacts": artifacts}


@router.delete("/{deployment_id}", dependencies=[_engineer])
async def delete_deployment(deployment_id: str):
    try:
        dep = await ModelDeployment.get(deployment_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    await dep.delete()
    return {"deleted": True}


@router.delete("", dependencies=[_engineer])
async def delete_all_deployments(trainer_name: Optional[str] = None):
    """Delete all deployment records (optionally filtered by trainer_name)."""
    filters = []
    if trainer_name:
        filters.append(ModelDeployment.trainer_name == trainer_name)
    result = await ModelDeployment.find(*filters).delete()
    return {"deleted": result.deleted_count if result else 0}
