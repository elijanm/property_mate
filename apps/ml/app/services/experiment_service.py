"""MLflow experiment comparison and data quality."""
from typing import List, Dict, Any, Optional
import structlog
import mlflow
from app.core.config import settings

logger = structlog.get_logger(__name__)


def _mlflow_client():
    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    return mlflow.tracking.MlflowClient()


async def compare_runs(run_ids: List[str]) -> Dict[str, Any]:
    client = _mlflow_client()
    results = []
    for run_id in run_ids:
        try:
            run = client.get_run(run_id)
            results.append({
                "run_id": run_id,
                "name": run.data.tags.get("mlflow.runName", run_id[:8]),
                "status": run.info.status,
                "start_time": run.info.start_time,
                "end_time": run.info.end_time,
                "metrics": dict(run.data.metrics),
                "params": dict(run.data.params),
                "tags": {k: v for k, v in run.data.tags.items() if not k.startswith("mlflow.")},
            })
        except Exception as e:
            results.append({"run_id": run_id, "error": str(e)})

    # Build comparison matrix
    all_metrics = set()
    all_params = set()
    for r in results:
        all_metrics.update(r.get("metrics", {}).keys())
        all_params.update(r.get("params", {}).keys())

    return {
        "runs": results,
        "metric_keys": sorted(all_metrics),
        "param_keys": sorted(all_params),
    }


async def list_experiments() -> List[Dict[str, Any]]:
    client = _mlflow_client()
    exps = client.search_experiments()
    return [
        {"id": e.experiment_id, "name": e.name, "artifact_location": e.artifact_location, "lifecycle_stage": e.lifecycle_stage}
        for e in exps
    ]


async def list_runs(experiment_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    client = _mlflow_client()
    runs = client.search_runs(experiment_ids=[experiment_id], max_results=limit)
    return [
        {
            "run_id": r.info.run_id,
            "name": r.data.tags.get("mlflow.runName", r.info.run_id[:8]),
            "status": r.info.status,
            "start_time": r.info.start_time,
            "metrics": dict(r.data.metrics),
            "params": dict(r.data.params),
        }
        for r in runs
    ]


async def check_data_quality(inputs: Dict[str, Any], trainer_name: str) -> Dict[str, Any]:
    """Run basic data quality checks on inference inputs."""
    issues = []
    warnings = []

    # Check for nulls/missing
    null_fields = [k for k, v in inputs.items() if v is None]
    if null_fields:
        issues.append({"type": "null_fields", "fields": null_fields})

    # Check numeric ranges (flag extreme values)
    from app.models.inference_log import InferenceLog
    recent = await InferenceLog.find(
        {"trainer_name": trainer_name}
    ).sort("-created_at").limit(1000).to_list()

    if recent:
        for field, value in inputs.items():
            if not isinstance(value, (int, float)):
                continue
            vals = [l.inputs.get(field) for l in recent if l.inputs and isinstance(l.inputs.get(field), (int, float))]
            if len(vals) < 10:
                continue
            mean = sum(vals) / len(vals)
            variance = sum((x - mean) ** 2 for x in vals) / len(vals)
            std = variance ** 0.5
            if std > 0:
                z = abs(value - mean) / std
                if z > 4:
                    warnings.append({"type": "outlier", "field": field, "value": value, "z_score": round(z, 2), "mean": round(mean, 4), "std": round(std, 4)})

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "checked_fields": len(inputs),
    }
