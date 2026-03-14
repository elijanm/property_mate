"""SHAP feature importance for individual predictions."""
import structlog
from typing import Any, Dict, Optional
from app.models.inference_log import InferenceLog

logger = structlog.get_logger(__name__)


async def explain_prediction(log_id: str) -> Dict[str, Any]:
    from fastapi import HTTPException
    log = await InferenceLog.get(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Inference log not found")

    inputs = log.inputs or {}
    if not inputs:
        return {"method": "none", "values": {}, "note": "No inputs stored for this prediction"}

    # Try SHAP if sklearn model available
    try:
        return await _shap_explain(log)
    except Exception as e:
        logger.debug("shap_explain_failed", error=str(e))

    # Fallback: permutation importance approximation
    return _permutation_explain(inputs, log.output)


async def _shap_explain(log: InferenceLog) -> Dict[str, Any]:
    import shap
    import numpy as np
    import mlflow
    from app.core.config import settings

    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    model = mlflow.pyfunc.load_model(f"models:/{log.trainer_name}/latest")

    inputs = {k: v for k, v in (log.inputs or {}).items() if isinstance(v, (int, float))}
    if not inputs:
        raise ValueError("No numeric inputs for SHAP")

    X = np.array([[inputs[k] for k in sorted(inputs)]])
    feature_names = sorted(inputs.keys())

    explainer = shap.Explainer(lambda x: model.predict(
        [{feature_names[i]: row[i] for i in range(len(feature_names))} for row in x]
    ), X)
    shap_values = explainer(X)
    vals = {feature_names[i]: float(shap_values.values[0][i]) for i in range(len(feature_names))}
    return {"method": "shap", "values": vals, "base_value": float(shap_values.base_values[0])}


def _permutation_explain(inputs: dict, output: Any) -> Dict[str, Any]:
    """Rough importance proxy: flag numeric inputs, rank by magnitude."""
    numeric = {k: v for k, v in inputs.items() if isinstance(v, (int, float))}
    if not numeric:
        return {"method": "none", "values": {}, "note": "No numeric features to explain"}

    total = sum(abs(v) for v in numeric.values()) or 1
    importance = {k: round(abs(v) / total, 4) for k, v in numeric.items()}
    return {"method": "magnitude_proxy", "values": importance, "note": "Approximate — SHAP unavailable"}
