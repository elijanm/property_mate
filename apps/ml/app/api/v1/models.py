"""Model deployment management."""
import asyncio
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
import mlflow
from mlflow.tracking import MlflowClient

from app.core.config import settings
from app.dependencies.auth import require_roles, get_current_user
from app.models.model_deployment import ModelDeployment
from app.services.zip_deploy_service import ZipManifestError, deploy_from_zip
from app.tasks.train_task import enqueue_pretrained_deploy
from app.utils.datetime import utc_now
from app.utils.serialization import doc_to_dict

router = APIRouter(prefix="/models", tags=["models"])

_any_role = Depends(require_roles("viewer", "engineer", "admin"))
_engineer = Depends(require_roles("engineer", "admin"))


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
    Upload a model file and deploy it — no training run required.

    **Standard formats** (auto-detected, no inference script needed):
    - `.pkl` / `.joblib` → scikit-learn
    - `.onnx` → ONNX Runtime
    - `.pt` / `.pth` → PyTorch
    - `.h5` / `.keras` → Keras

    **Custom formats**: upload an `inference_script` (.py) that defines a
    `mlflow.pyfunc.PythonModel` subclass. The model file is available at
    `context.artifacts["model_file"]` inside `load_context`.
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
    job_id = await enqueue_pretrained_deploy(
        deploy_kwargs,
        file_bytes=model_bytes,
        inference_script=script_bytes,
        owner_email=user.email,
        org_id=user.org_id,
    )
    return {"job_id": job_id, "status": "queued"}


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

    Returns immediately with a `job_id`. Poll `GET /training/jobs/{job_id}` for status.
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

    # Replace: archive all previous deployments for this model
    if peeked_name and action == "replace":
        prev = await ModelDeployment.find(
            ModelDeployment.trainer_name == peeked_name,
        ).to_list()
        for p in prev:
            await p.set({"status": "archived", "is_default": False, "updated_at": utc_now()})

    try:
        job_id, model_name = await deploy_from_zip(zip_bytes, owner_email=user.email, org_id=user.org_id)
    except ZipManifestError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"job_id": job_id, "model_name": model_name, "status": "queued"}


@router.get("")
async def list_deployments(
    trainer_name: Optional[str] = None,
    include_all: bool = False,
    user=Depends(get_current_user),
):
    # Scope to caller's org — also include legacy system records (org_id="")
    base_filters = [ModelDeployment.status == "active"]
    if trainer_name:
        base_filters.append(ModelDeployment.trainer_name == trainer_name)

    all_deps = await ModelDeployment.find(*base_filters).sort(-ModelDeployment.deployed_at).to_list()
    # Filter by org: own org's records only
    all_deps = [d for d in all_deps if not d.org_id or d.org_id == user.org_id]

    if user.role == "admin":
        deps = all_deps
    else:
        # Non-admins: public models (visibility="viewer") + own models
        deps = [
            d for d in all_deps
            if d.visibility == "viewer" or d.owner_email == user.email
        ]

    if not include_all and not trainer_name:
        # When listing all trainers without a filter, return only defaults (one per trainer)
        deps = [d for d in deps if d.is_default]

    return {"items": [doc_to_dict(d) for d in deps], "total": len(deps)}


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
                        url = (
                            f"{settings.MLFLOW_TRACKING_URI}/get-artifact"
                            f"?run_uuid={run_id}&path={entry.path}"
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
