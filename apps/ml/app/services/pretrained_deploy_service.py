"""
Deploy a pre-trained model without a training run.

Supported sources
-----------------
  file        — uploaded bytes (pickle / joblib / ONNX / pt / h5 / safetensors)
  huggingface — Hugging Face Hub model ID  (e.g. "distilbert-base-uncased")
  s3          — S3 / MinIO object key      (e.g. "models/my_model.pkl")
  url         — HTTP/HTTPS download URL
  mlflow_uri  — existing MLflow model URI  (e.g. "models:/MyModel/1")

For file / s3 / url sources the function auto-detects the flavour:
  .pkl / .pickle / .joblib → mlflow.sklearn  (falls back to pyfunc)
  .onnx                    → mlflow.onnx
  .pt / .pth               → mlflow.pytorch  (falls back to pyfunc)
  .h5 / .keras             → mlflow.keras    (falls back to pyfunc)
  anything else            → mlflow.pyfunc (cloudpickle)

For huggingface the model is logged via mlflow.transformers.

All sources result in a registered MLflow model and a ModelDeployment document.
"""
from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import mlflow
import structlog

from app.core.config import settings
from app.models.model_deployment import ModelDeployment
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

_PRETRAINED_EXPERIMENT = "pretrained-imports"


# ── helpers ────────────────────────────────────────────────────────────────────

def _detect_flavour(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".pkl": "sklearn",
        ".pickle": "sklearn",
        ".joblib": "sklearn",
        ".onnx": "onnx",
        ".pt": "pytorch",
        ".pth": "pytorch",
        ".h5": "keras",
        ".keras": "keras",
    }.get(ext, "pyfunc")


def _log_bytes(
    data: bytes,
    filename: str,
    run: "mlflow.ActiveRun",
    inference_script: Optional[bytes] = None,
    extra_artifacts: Optional[Dict[str, str]] = None,
    zip_root: Optional[str] = None,
) -> tuple[str, Any]:
    """
    Log model bytes to MLflow. Returns (artifact_uri, pyfunc_cls_or_None).

    If ``inference_script`` is provided (a .py file implementing
    mlflow.pyfunc.PythonModel), it is always used as the pyfunc wrapper
    regardless of the file extension — giving full control over load/predict.
    """
    with tempfile.TemporaryDirectory() as tmp:
        local_path = os.path.join(tmp, filename)
        with open(local_path, "wb") as f:
            f.write(data)

        # ── custom inference script takes priority ─────────────────────────
        if inference_script:
            return _log_with_inference_script(
                model_path=local_path,
                inference_script=inference_script,
                run=run,
                tmp=tmp,
                extra_artifacts=extra_artifacts,
                zip_root=zip_root,
            )

        # ── auto-detect flavour ────────────────────────────────────────────
        flavour = _detect_flavour(filename)

        if flavour == "sklearn":
            import joblib
            try:
                model_obj = joblib.load(local_path)
                mlflow.sklearn.log_model(model_obj, artifact_path="model")
                return f"runs:/{run.info.run_id}/model", None
            except Exception:
                pass  # fall through to pyfunc

        if flavour == "onnx":
            try:
                import onnx as onnx_lib
                model_obj = onnx_lib.load(local_path)
                mlflow.onnx.log_model(model_obj, artifact_path="model")
                return f"runs:/{run.info.run_id}/model", None
            except Exception:
                pass

        if flavour == "pytorch":
            try:
                import torch
                model_obj = torch.load(local_path, map_location="cpu", weights_only=False)
                mlflow.pytorch.log_model(model_obj, artifact_path="model")
                return f"runs:/{run.info.run_id}/model", None
            except Exception:
                pass

        if flavour == "keras":
            try:
                import keras
                model_obj = keras.models.load_model(local_path)
                mlflow.keras.log_model(model_obj, artifact_path="model")
                return f"runs:/{run.info.run_id}/model", None
            except Exception:
                pass

        # Generic pyfunc fallback — store the raw file as an artifact
        mlflow.log_artifact(local_path, artifact_path="model_file")
        return f"runs:/{run.info.run_id}/model_file", None


def _log_with_inference_script(
    model_path: str,
    inference_script: bytes,
    run: "mlflow.ActiveRun",
    tmp: str,
    extra_artifacts: Optional[Dict[str, str]] = None,
    zip_root: Optional[str] = None,
) -> str:
    """
    Load the user-supplied inference script, find the PythonModel subclass,
    and log it via mlflow.pyfunc.

    Artifacts available in load_context():
      context.artifacts["model_file"]        → primary model path
      context.artifacts["<key>"]             → each entry in extra_artifacts
    """
    import importlib.util
    import inspect
    import sys

    # Use a run-scoped module name so multiple deployed models don't collide in
    # sys.modules. The name must match the filename written to code_paths so that
    # MLflow's pickle resolver can find the class on load.
    run_id_short = run.info.run_id[:12]
    module_name = f"_user_inference_{run_id_short}"
    script_path = os.path.join(tmp, f"{module_name}.py")
    with open(script_path, "wb") as f:
        f.write(inference_script)

    # Add the script's directory AND the model's directory to sys.path so the
    # entry point can import any sibling .py files (utils, helpers, pre/post-processing).
    # For ZIP-based deploys these are the same directory (the persistent extraction root).
    script_dir = os.path.dirname(script_path)
    model_dir  = os.path.dirname(model_path)
    for d in (script_dir, model_dir):
        if d and d not in sys.path:
            sys.path.insert(0, d)

    spec = importlib.util.spec_from_file_location(module_name, script_path)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[module_name] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    python_model_cls = None
    for _, obj in inspect.getmembers(module, inspect.isclass):
        if issubclass(obj, mlflow.pyfunc.PythonModel) and obj is not mlflow.pyfunc.PythonModel:
            python_model_cls = obj
            break

    if python_model_cls is None:
        raise ValueError(
            "entry_point must define a class that inherits from "
            "mlflow.pyfunc.PythonModel with load_context() and predict() methods."
        )

    artifacts = {"model_file": model_path, **(extra_artifacts or {})}

    # Bundle all .py files from the script/model directory AND the original ZIP
    # extraction root (zip_root) so that imports of sibling modules work at serve time.
    seen: set = set()
    code_paths = []
    search_dirs = [d for d in {script_dir, model_dir, zip_root} if d]
    for search_dir in search_dirs:
        for p in sorted(Path(search_dir).glob("*.py")):
            if str(p) not in seen:
                seen.add(str(p))
                code_paths.append(str(p))
    if script_path not in seen:
        code_paths.insert(0, script_path)

    mlflow.pyfunc.log_model(
        artifact_path="model",
        python_model=python_model_cls(),
        artifacts=artifacts,
        code_paths=code_paths,
    )
    return f"runs:/{run.info.run_id}/model", python_model_cls


async def _fetch_s3(key: str) -> tuple[bytes, str]:
    import aioboto3
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
    ) as s3:
        resp = await s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
        data = await resp["Body"].read()
    return data, Path(key).name


async def _fetch_url(url: str) -> tuple[bytes, str]:
    import httpx
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    filename = url.split("?")[0].rstrip("/").split("/")[-1] or "model.pkl"
    return resp.content, filename


# ── public API ─────────────────────────────────────────────────────────────────

async def deploy_pretrained(
    *,
    name: str,                        # logical model name (used for MLflow registry)
    version: str = "1.0.0",
    description: str = "",
    tags: Dict[str, str] | None = None,
    input_schema: Optional[Dict[str, Any]] = None,   # from manifest.json input_schema
    output_schema: Optional[Dict[str, Any]] = None,  # from manifest.json output_schema
    category: Optional[Dict[str, str]] = None,       # from manifest.json category
    # exactly one source must be provided:
    file_bytes: Optional[bytes] = None,
    file_name: str = "model.pkl",     # original filename (for flavour detection)
    inference_script: Optional[bytes] = None,  # optional .py PythonModel wrapper
    extra_artifacts: Optional[Dict[str, str]] = None,  # {key: local_abs_path}
    zip_root: Optional[str] = None,   # persistent extraction root for ZIP-based deploys
    huggingface_model_id: Optional[str] = None,
    huggingface_task: Optional[str] = None,   # e.g. "text-classification"
    s3_key: Optional[str] = None,
    url: Optional[str] = None,
    mlflow_uri: Optional[str] = None,         # existing MLflow URI → skip logging
    set_as_default: bool = True,
    owner_email: Optional[str] = None,
    org_id: str = "",
) -> ModelDeployment:
    """
    Register a pre-trained model in MLflow and create a ModelDeployment record.
    Returns the new ModelDeployment document.
    """
    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    mlflow.set_experiment(_PRETRAINED_EXPERIMENT)

    _tags = {"source": "pretrained", **(tags or {})}
    source_type = "pretrained_file"
    model_uri: str
    _pyfunc_cls = None  # set when an inference_script is loaded

    # ── mlflow_uri shortcut ────────────────────────────────────────────────────
    if mlflow_uri:
        source_type = "pretrained_uri"
        model_uri = mlflow_uri
        # Register the URI under the logical name if not already a registry URI
        if not mlflow_uri.startswith("models:/"):
            client = mlflow.tracking.MlflowClient()
            try:
                client.create_registered_model(name)
            except Exception:
                pass
            mv = client.create_model_version(name=name, source=mlflow_uri, run_id=None)
            model_uri = f"models:/{name}/{mv.version}"
        run_id = None
        mlflow_version = model_uri.split("/")[-1]

    # ── HuggingFace ────────────────────────────────────────────────────────────
    elif huggingface_model_id:
        source_type = "pretrained_hf"
        with mlflow.start_run(run_name=f"import-hf-{name}-{version}", tags=_tags) as run:
            from transformers import pipeline as hf_pipeline
            if huggingface_task:
                task_pipeline = hf_pipeline(huggingface_task, model=huggingface_model_id)
                mlflow.transformers.log_model(
                    transformers_model=task_pipeline,
                    artifact_path="model",
                )
            else:
                # No task — store the Hub model ID as a param + loader file
                mlflow.log_param("huggingface_model_id", huggingface_model_id)
                mlflow.log_artifact(
                    _write_hf_loader(huggingface_model_id, tmp_dir=tempfile.mkdtemp()),
                    artifact_path="model",
                )
            run_id = run.info.run_id
        model_uri = _register(name, f"runs:/{run_id}/model")
        mlflow_version = model_uri.split("/")[-1]

    # ── file / s3 / url ────────────────────────────────────────────────────────
    else:
        if s3_key:
            source_type = "pretrained_s3"
            file_bytes, file_name = await _fetch_s3(s3_key)
        elif url:
            source_type = "pretrained_url"
            file_bytes, file_name = await _fetch_url(url)
        elif file_bytes is None:
            raise ValueError("Provide one of: file_bytes, huggingface_model_id, s3_key, url, mlflow_uri")

        with mlflow.start_run(run_name=f"import-{name}-{version}", tags=_tags) as run:
            mlflow.log_param("source_type", source_type)
            mlflow.log_param("original_filename", file_name)
            mlflow.log_param("version", version)
            if description:
                mlflow.log_param("description", description)
            artifact_uri, _pyfunc_cls = _log_bytes(file_bytes, file_name, run, inference_script=inference_script, extra_artifacts=extra_artifacts, zip_root=zip_root)
            run_id = run.info.run_id

        model_uri = _register(name, artifact_uri)
        mlflow_version = model_uri.split("/")[-1]

    # ── create ModelDeployment ─────────────────────────────────────────────────
    if set_as_default:
        await ModelDeployment.find(
            ModelDeployment.trainer_name == name,
            ModelDeployment.status == "active",
        ).update({"$set": {"is_default": False, "updated_at": utc_now()}})

    _size_bytes = len(file_bytes) if file_bytes else _mlflow_artifact_size(run_id)

    dep = ModelDeployment(
        org_id=org_id,
        trainer_name=name,
        version=version,
        mlflow_model_name=name,
        mlflow_model_version=str(mlflow_version),
        run_id=run_id,
        model_uri=model_uri,
        source_type=source_type,
        is_default=set_as_default,
        tags=tags or {},
        input_schema=input_schema or {},
        output_schema=output_schema or {},
        category=category or {},
        owner_email=owner_email,
        model_size_bytes=_size_bytes or None,
    )
    await dep.insert()

    # ── upsert TrainerRegistration so output_display + derived_metrics are available
    _output_display: list = []
    _derived_metrics: list = []
    if _pyfunc_cls is not None:
        raw_od = getattr(_pyfunc_cls, "output_display", [])
        _output_display = [(s.to_dict() if hasattr(s, "to_dict") else s) for s in raw_od]
        raw_dm = getattr(_pyfunc_cls, "derived_metrics", [])
        _derived_metrics = [(s.to_dict() if hasattr(s, "to_dict") else s) for s in raw_dm]
    if _output_display or _derived_metrics or input_schema or output_schema:
        from app.models.trainer_registration import TrainerRegistration
        existing = await TrainerRegistration.find_one(TrainerRegistration.name == name)
        if existing:
            existing.output_display = _output_display or existing.output_display
            existing.derived_metrics = _derived_metrics or existing.derived_metrics
            if input_schema:
                existing.input_schema = input_schema
            if output_schema:
                existing.output_schema = output_schema
            await existing.save()
        else:
            reg = TrainerRegistration(
                name=name,
                version=version,
                description=description,
                framework="pyfunc",
                source_type=source_type,
                input_schema=input_schema or {},
                output_schema=output_schema or {},
                output_display=_output_display,
                derived_metrics=_derived_metrics,
                category=category or {},
            )
            await reg.insert()

    logger.info(
        "pretrained_model_deployed",
        name=name,
        version=version,
        source_type=source_type,
        model_uri=model_uri,
    )
    return dep


def _mlflow_artifact_size(run_id: Optional[str]) -> int:
    """Sum the file sizes of all artifacts for a given MLflow run_id. Returns 0 on any error."""
    if not run_id:
        return 0
    try:
        client = mlflow.tracking.MlflowClient()

        def _scan(path: Optional[str] = None) -> int:
            total = 0
            try:
                for entry in client.list_artifacts(run_id, path):
                    if entry.is_dir:
                        total += _scan(entry.path)
                    else:
                        total += entry.file_size or 0
            except Exception:
                pass
            return total

        return _scan()
    except Exception:
        return 0


def _register(model_name: str, artifact_uri: str) -> str:
    """Register artifact_uri in the MLflow model registry. Returns models:/<name>/<version>."""
    client = mlflow.tracking.MlflowClient()
    try:
        client.create_registered_model(model_name)
    except Exception:
        pass  # already exists
    mv = client.create_model_version(name=model_name, source=artifact_uri, run_id=None)
    return f"models:/{model_name}/{mv.version}"


def _write_hf_loader(model_id: str, tmp_dir: str) -> str:
    """Write a tiny MLmodel loader file for a HF Hub model id."""
    path = os.path.join(tmp_dir, "hf_model_id.txt")
    with open(path, "w") as f:
        f.write(model_id)
    return path
