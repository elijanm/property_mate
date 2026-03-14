"""Evaluate a deployed model and generate confusion matrix / metrics charts."""
import base64
import io
from typing import Any, Dict, List, Optional

import structlog

from app.abstract.base_trainer import EvaluationResult
from app.models.model_deployment import ModelDeployment
from app.services.registry_service import get_trainer_class

logger = structlog.get_logger(__name__)


async def evaluate_deployment(
    trainer_name: str,
    test_inputs: List[Any],
    test_labels: List[Any],
    model_version: Optional[str] = None,
) -> Dict:
    """Run evaluation on provided test set. Returns metrics + confusion matrix PNG (base64)."""
    import mlflow
    import numpy as np
    from sklearn.metrics import (
        accuracy_score,
        classification_report,
        confusion_matrix,
        f1_score,
        precision_score,
        recall_score,
    )

    from app.core.config import settings

    filters = [
        ModelDeployment.trainer_name == trainer_name,
        ModelDeployment.status == "active",
    ]
    if model_version:
        filters.append(ModelDeployment.mlflow_model_version == model_version)
    else:
        filters.append(ModelDeployment.is_default == True)  # noqa: E712

    dep = await ModelDeployment.find_one(*filters)
    if not dep:
        raise ValueError(f"No active deployment for '{trainer_name}'")

    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    model = mlflow.pyfunc.load_model(dep.model_uri)

    trainer_cls = get_trainer_class(trainer_name)
    trainer = trainer_cls() if trainer_cls else None
    class_names = trainer.get_class_names() if trainer else []

    y_pred = model.predict(test_inputs)
    y_true = test_labels

    metrics: Dict = {}
    confusion_png_b64: Optional[str] = None
    report: Optional[Dict] = None

    try:
        # Try classification metrics
        arr_true = np.array(y_true)
        arr_pred = np.array(y_pred)
        metrics["accuracy"] = float(accuracy_score(arr_true, arr_pred))
        metrics["f1_macro"] = float(f1_score(arr_true, arr_pred, average="macro", zero_division=0))
        metrics["precision_macro"] = float(precision_score(arr_true, arr_pred, average="macro", zero_division=0))
        metrics["recall_macro"] = float(recall_score(arr_true, arr_pred, average="macro", zero_division=0))

        # Classification report
        report = classification_report(arr_true, arr_pred, target_names=class_names or None, output_dict=True)

        # Confusion matrix
        cm = confusion_matrix(arr_true, arr_pred)
        confusion_png_b64 = _render_confusion_matrix(cm, class_names)

    except Exception:
        # Regression fallback
        try:
            from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
            arr_true = np.array(y_true, dtype=float)
            arr_pred = np.array(y_pred, dtype=float)
            metrics["mse"] = float(mean_squared_error(arr_true, arr_pred))
            metrics["mae"] = float(mean_absolute_error(arr_true, arr_pred))
            metrics["r2"] = float(r2_score(arr_true, arr_pred))
        except Exception as exc:
            logger.warning("evaluation_metrics_failed", error=str(exc))

    return {
        "trainer_name": trainer_name,
        "model_version": dep.mlflow_model_version,
        "run_id": dep.run_id,
        "metrics": metrics,
        "classification_report": report,
        "confusion_matrix_png": confusion_png_b64,
        "n_samples": len(y_true),
    }


def _render_confusion_matrix(cm, class_names: List[str]) -> str:
    """Render confusion matrix as base64-encoded PNG."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns

    fig, ax = plt.subplots(figsize=(max(6, len(cm)), max(5, len(cm))))
    labels = class_names if class_names and len(class_names) == len(cm) else None
    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=labels,
        yticklabels=labels,
        ax=ax,
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("Confusion Matrix")
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")
