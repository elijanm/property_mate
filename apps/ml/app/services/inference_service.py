import collections
import threading
import time
from typing import Any, Optional

import structlog

# LRU cache for loaded models — keyed by (trainer_name, model_uri)
# Evicts the least-recently-used entry when more than _MODEL_CACHE_MAX are loaded.
_MODEL_CACHE_MAX = 8
_model_cache: collections.OrderedDict = collections.OrderedDict()
_model_cache_lock = threading.Lock()


def _cache_get(key: tuple):
    with _model_cache_lock:
        if key in _model_cache:
            _model_cache.move_to_end(key)
            return _model_cache[key]
    return None


def _cache_set(key: tuple, model) -> None:
    with _model_cache_lock:
        if key in _model_cache:
            _model_cache.move_to_end(key)
        else:
            _model_cache[key] = model
            while len(_model_cache) > _MODEL_CACHE_MAX:
                _model_cache.popitem(last=False)

from app.models.inference_log import InferenceLog
from app.models.model_deployment import ModelDeployment
from app.services.registry_service import get_trainer_class
from app.utils.datetime import utc_now
from app.api.v1.sse import publish_event

logger = structlog.get_logger(__name__)


def _prepare_inputs(inputs: Any, input_schema: Optional[dict] = None) -> Any:
    """
    Prepare inputs for MLflow model.predict().

    Converts dicts of scalar values to a named pandas DataFrame so MLflow's
    column-based signature matching works. Skips image/file fields (base64 blobs).
    All numeric values are cast to float64 to avoid "Cannot encode int" errors.

    Non-dict inputs (lists, arrays, DataFrames) are returned as-is.
    """
    if not isinstance(inputs, dict):
        return inputs

    # Skip image/file fields — identified by schema type or by large string values
    image_types = {"image", "file"}
    def _is_scalar(k: str, v: Any) -> bool:
        if input_schema and k in input_schema:
            if input_schema[k].get("type") in image_types:
                return False
        if isinstance(v, str) and len(v) > 512:   # likely base64
            return False
        return isinstance(v, (int, float, str, bool, type(None)))

    scalar_items = {k: v for k, v in inputs.items() if _is_scalar(k, v)}
    if not scalar_items:
        return inputs
    # If any keys were excluded (image/file blobs) pass the original dict.
    # PythonModel.predict() implementations receive and unpack raw dicts themselves.
    if len(scalar_items) < len(inputs):
        return inputs

    try:
        import pandas as pd
        row = {
            k: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
            for k, v in scalar_items.items()
        }
        return pd.DataFrame([row])
    except Exception:
        return inputs


def _trainer_has_predict(trainer) -> bool:
    """Return True when the trainer class overrides predict() (not just inherits the stub)."""
    import inspect
    from app.abstract.base_trainer import BaseTrainer
    return type(trainer).predict is not BaseTrainer.predict


def _validate_inputs_against_schema(inputs: Any, schema: Optional[dict]) -> Optional[str]:
    """
    Validate inputs dict against the deployment's input_schema.
    Returns an error message string if validation fails, None if valid.

    Schema format: { "field_name": { "type": "text|number|image|...", "required": true|false } }
    """
    if not schema or not isinstance(inputs, dict):
        return None
    errors = []
    for field_name, field_spec in schema.items():
        if not isinstance(field_spec, dict):
            continue
        required = field_spec.get("required", False)
        field_type = field_spec.get("type", "text")
        value = inputs.get(field_name)
        if required and (value is None or value == ""):
            errors.append(f"'{field_name}' is required")
            continue
        if value is None:
            continue
        if field_type == "number" and not isinstance(value, (int, float)):
            try:
                float(value)
            except (TypeError, ValueError):
                errors.append(f"'{field_name}' must be a number, got {type(value).__name__}")
    return "; ".join(errors) if errors else None


def _load_raw_model(model_uri: str, source_type: str):
    """
    Load the underlying model object, bypassing MLflow pyfunc schema enforcement.

    Tries framework-specific loaders in order: sklearn → pytorch → tensorflow →
    keras → onnx → pyfunc (last resort — schema enforcement may apply).
    Uses an in-process LRU cache (max 8 entries) to avoid reloading on every request.
    """
    cache_key = ("raw", model_uri)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    import mlflow

    model = None
    # sklearn / joblib
    try:
        model = mlflow.sklearn.load_model(model_uri)
    except Exception:
        pass

    # PyTorch
    if model is None:
        try:
            model = mlflow.pytorch.load_model(model_uri)
        except Exception:
            pass

    # TensorFlow SavedModel
    if model is None:
        try:
            model = mlflow.tensorflow.load_model(model_uri)
        except Exception:
            pass

    # Keras .h5 / .keras
    if model is None:
        try:
            import mlflow.keras
            model = mlflow.keras.load_model(model_uri)
        except Exception:
            pass

    # ONNX Runtime — wrap in a thin predictor so trainer.predict() gets a standard object
    if model is None:
        try:
            import mlflow.onnx
            onnx_model = mlflow.onnx.load_model(model_uri)
            model = _OnnxPredictor(onnx_model)
        except Exception:
            pass

    # Last resort — pyfunc (schema enforcement still applies)
    if model is None:
        model = mlflow.pyfunc.load_model(model_uri)

    _cache_set(cache_key, model)
    return model


class _OnnxPredictor:
    """Thin wrapper around an ONNX model that exposes a .predict() compatible interface."""

    def __init__(self, onnx_model):
        try:
            import onnxruntime as ort
            import io as _io
            buf = _io.BytesIO()
            import onnx as onnx_lib
            onnx_lib.save(onnx_model, buf)
            buf.seek(0)
            self._session = ort.InferenceSession(buf.read())
        except Exception as e:
            raise RuntimeError(f"Failed to create ONNX runtime session: {e}") from e

    @property
    def input_names(self):
        return [i.name for i in self._session.get_inputs()]

    def predict(self, inputs):
        """Run ONNX inference. inputs: dict, list, or numpy array."""
        import numpy as np
        if isinstance(inputs, dict):
            feeds = {name: np.array([inputs[name]], dtype=np.float32) for name in self.input_names if name in inputs}
        elif isinstance(inputs, (list, np.ndarray)):
            arr = np.array(inputs, dtype=np.float32)
            if arr.ndim == 1:
                arr = arr[np.newaxis, :]
            feeds = {name: arr for name in self.input_names}
        else:
            feeds = {name: inputs for name in self.input_names}
        outputs = self._session.run(None, feeds)
        return outputs[0].tolist() if len(outputs) == 1 else [o.tolist() for o in outputs]


async def predict(
    trainer_name: str,
    inputs: Any,
    model_version: Optional[str] = None,
    caller_org_id: Optional[str] = None,
    session_id: Optional[str] = None,
    org_id: str = "",
    user_email: Optional[str] = None,
) -> tuple:
    """Load the active deployment and run prediction. Returns (result, log_id)."""
    import mlflow
    from app.models.trainer_registration import TrainerRegistration

    # Resolve alias → real trainer_name (e.g. "john/iris_classifier" → "iris_classifier")
    if "/" in trainer_name or not await ModelDeployment.find_one(
        ModelDeployment.trainer_name == trainer_name,
        ModelDeployment.status == "active",
    ):
        reg_by_alias = await TrainerRegistration.find_one({"alias": trainer_name})
        if reg_by_alias:
            trainer_name = reg_by_alias.name

    # Find deployment
    filters = [
        ModelDeployment.trainer_name == trainer_name,
        ModelDeployment.status == "active",
    ]
    if model_version:
        filters.append(ModelDeployment.mlflow_model_version == model_version)
    else:
        filters.append(ModelDeployment.is_default == True)  # noqa: E712

    dep = await ModelDeployment.find_one(*filters)
    if not dep and not model_version:
        # Fallback: no is_default=True found — use the most recently deployed version
        dep = await ModelDeployment.find(
            ModelDeployment.trainer_name == trainer_name,
            ModelDeployment.status == "active",
        ).sort(-ModelDeployment.deployed_at).first_or_none()
    if not dep:
        raise ValueError(f"No active deployment for trainer '{trainer_name}'")

    # A/B traffic routing — check if this trainer has an active test
    ab_test = None
    ab_variant = None
    if not model_version:  # don't override explicit version requests
        from app.services.ab_test_service import get_active_test_for_deployment, route_request
        ab_test = await get_active_test_for_deployment(str(dep.id))
        if ab_test is None:
            # also check if the OTHER deployment in any test points to this trainer
            from app.models.ab_test import ABTest
            ab_test = await ABTest.find_one({
                "trainer_name": trainer_name,
                "status": "active",
            })
        if ab_test:
            ab_variant = route_request(ab_test)
            target_dep_id = ab_test.variant_a if ab_variant == "a" else ab_test.variant_b
            if target_dep_id:
                routed_dep = await ModelDeployment.get(target_dep_id)
                if routed_dep and routed_dep.status == "active":
                    dep = routed_dep

    # Trainer class is optional — ZIP/pyfunc models handle everything inside predict()
    trainer_cls = get_trainer_class(trainer_name)
    trainer = trainer_cls() if trainer_cls else None

    # Validate inputs against schema if defined
    if dep.input_schema:
        validation_error = _validate_inputs_against_schema(inputs, dep.input_schema)
        if validation_error:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail={"error": {"code": "INVALID_INPUTS", "message": validation_error}},
            )

    t0 = time.monotonic()
    error_msg = None
    result = None
    log: InferenceLog | None = None

    try:
        import sys
        from app.core.config import settings
        mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
        for _key in list(sys.modules.keys()):
            if "_user_inference" in _key:
                del sys.modules[_key]

        if trainer and _trainer_has_predict(trainer):
            # Trainer defines its own predict(model, inputs) — load the raw model
            # and call it directly, bypassing MLflow schema enforcement entirely.
            raw_model = _load_raw_model(dep.model_uri, dep.source_type)
            result = trainer.predict(raw_model, inputs)
        else:
            # No trainer predict — use pyfunc with prepared inputs
            model = mlflow.pyfunc.load_model(dep.model_uri)
            raw = model.predict(_prepare_inputs(inputs, dep.input_schema))
            result = trainer.postprocess(raw) if trainer else raw
        # Publish SSE event for real-time UI
        try:
            import asyncio
            asyncio.ensure_future(publish_event("inference", {
                "trainer_name": trainer_name,
                "model_version": dep.mlflow_model_version,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "has_error": False,
            }))
        except Exception:
            pass
    except Exception as exc:
        import traceback
        from pathlib import Path as _Path
        _tb = traceback.extract_tb(exc.__traceback__)
        _trainer_frame = next(
            (f for f in reversed(_tb) if "ml_plugin_" in (f.filename or "") or "trainers/" in (f.filename or "")),
            _tb[-1] if _tb else None,
        )
        _location = (
            f"{_Path(_trainer_frame.filename).name}:{_trainer_frame.lineno} in {_trainer_frame.name}"
            if _trainer_frame else "unknown location"
        )
        error_msg = f"{_location}: {exc}"
        logger.error("inference_failed", trainer=trainer_name, error=error_msg,
                     traceback="".join(traceback.format_tb(exc.__traceback__)))
        try:
            import asyncio
            asyncio.ensure_future(publish_event("inference", {
                "trainer_name": trainer_name,
                "model_version": dep.mlflow_model_version,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "has_error": True,
                "error": str(exc),
            }))
        except Exception:
            pass
        raise

    finally:
        latency = (time.monotonic() - t0) * 1000

        # Extract S3 image keys from result (fields ending in _key)
        # so presigned URLs can be refreshed later without expiring.
        image_keys: dict = {}
        clean_result = result
        if isinstance(result, dict):
            clean_result = {}
            for k, v in result.items():
                if k.endswith("_key") and isinstance(v, str):
                    image_keys[k] = v
                else:
                    clean_result[k] = v

        # Inference billing — deduct from wallet if applicable
        cost_usd = 0.0
        if error_msg is None and user_email:
            try:
                from app.services.ml_billing_service import charge_inference
                cost_usd = await charge_inference(user_email, org_id, trainer_name)
            except ValueError as billing_exc:
                # Re-raise as the prediction itself succeeded — but billing failed
                raise RuntimeError(str(billing_exc)) from billing_exc
            except Exception:
                pass  # billing errors never block inference results

        log = InferenceLog(
            trainer_name=trainer_name,
            deployment_id=str(dep.id),
            ab_test_id=str(ab_test.id) if ab_test else None,
            ab_test_variant=ab_variant,
            model_version=dep.mlflow_model_version,
            run_id=dep.run_id,
            inputs=inputs,
            outputs=clean_result,
            image_keys=image_keys,
            latency_ms=latency,
            error=error_msg,
            caller_org_id=caller_org_id,
            session_id=session_id,
            org_id=org_id,
            cost_usd=cost_usd,
        )
        await log.insert()

        # Record A/B metrics asynchronously (don't block the response)
        if ab_test and ab_variant:
            try:
                from app.services.ab_test_service import record_request
                await record_request(ab_test, ab_variant, latency, error=error_msg is not None)
            except Exception:
                pass  # never block inference for metrics

    return clean_result, str(log.id)


async def predict_by_deployment_id(deployment_id: str, inputs: Any) -> tuple:
    """Run inference against a specific deployment by its ID. Returns (result, log_id)."""
    import mlflow
    from app.core.config import settings

    dep = await ModelDeployment.get(deployment_id)
    if not dep:
        raise ValueError(f"Deployment '{deployment_id}' not found")

    trainer_cls = get_trainer_class(dep.trainer_name)
    trainer = trainer_cls() if trainer_cls else None

    import time
    t0 = time.monotonic()
    error_msg = None
    result = None
    log = None

    try:
        import sys
        mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
        for _key in list(sys.modules.keys()):
            if "_user_inference" in _key:
                del sys.modules[_key]
        if trainer and _trainer_has_predict(trainer):
            raw_model = _load_raw_model(dep.model_uri, dep.source_type)
            result = trainer.predict(raw_model, inputs)
        else:
            model = mlflow.pyfunc.load_model(dep.model_uri)
            raw = model.predict(_prepare_inputs(inputs, dep.input_schema))
            result = trainer.postprocess(raw) if trainer else raw
    except Exception as exc:
        error_msg = str(exc)
        raise
    finally:
        latency = (time.monotonic() - t0) * 1000
        image_keys: dict = {}
        clean_result = result
        if isinstance(result, dict):
            clean_result = {}
            for k, v in result.items():
                if k.endswith("_key") and isinstance(v, str):
                    image_keys[k] = v
                else:
                    clean_result[k] = v

        log = InferenceLog(
            trainer_name=dep.trainer_name,
            model_version=dep.mlflow_model_version,
            run_id=dep.run_id,
            inputs=inputs,
            outputs=clean_result,
            image_keys=image_keys,
            latency_ms=latency,
            error=error_msg,
        )
        await log.insert()

    return clean_result, str(log.id)
