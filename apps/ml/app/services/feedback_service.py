"""
Feedback storage + confusion matrix computation + MLflow metric logging.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional

import mlflow
import structlog

from app.core.config import settings
from app.models.inference_feedback import InferenceFeedback
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def submit_feedback(
    *,
    trainer_name: str,
    deployment_id: Optional[str] = None,
    run_id: Optional[str] = None,
    inference_log_id: Optional[str] = None,
    model_output: Any = None,
    predicted_label: Optional[str] = None,
    actual_label: Optional[str] = None,
    is_correct: Optional[bool] = None,
    confidence_reported: Optional[float] = None,
    notes: Optional[str] = None,
    session_id: Optional[str] = None,
) -> InferenceFeedback:
    fb = InferenceFeedback(
        trainer_name=trainer_name,
        deployment_id=deployment_id,
        run_id=run_id,
        inference_log_id=inference_log_id,
        model_output=model_output,
        predicted_label=predicted_label,
        actual_label=actual_label,
        is_correct=is_correct,
        confidence_reported=confidence_reported,
        notes=notes,
        session_id=session_id,
    )
    await fb.insert()

    # Log to MLflow if we have a run_id
    if run_id:
        try:
            mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
            client = mlflow.tracking.MlflowClient()
            total = await InferenceFeedback.find(
                InferenceFeedback.trainer_name == trainer_name,
                InferenceFeedback.is_correct != None,  # noqa: E711
            ).count()
            correct = await InferenceFeedback.find(
                InferenceFeedback.trainer_name == trainer_name,
                InferenceFeedback.is_correct == True,  # noqa: E712
            ).count()
            if total > 0:
                client.log_metric(run_id, "user_accuracy", correct / total)
                client.log_metric(run_id, "user_feedback_count", total)
        except Exception as exc:
            logger.warning("mlflow_feedback_log_failed", error=str(exc))

    logger.info("feedback_submitted", trainer=trainer_name, is_correct=is_correct)
    return fb


async def get_feedback(
    trainer_name: str,
    limit: int = 100,
    skip: int = 0,
) -> List[InferenceFeedback]:
    return (
        await InferenceFeedback.find(InferenceFeedback.trainer_name == trainer_name)
        .sort(-InferenceFeedback.created_at)
        .skip(skip)
        .limit(limit)
        .to_list()
    )


async def get_confusion_matrix(trainer_name: str) -> Dict:
    """
    Returns:
    {
      "labels": ["0","1","2"],
      "matrix": [[tp, fp, ...], ...],   // rows=actual, cols=predicted
      "accuracy": 0.87,
      "total": 142,
      "correct": 124,
      "per_label": {"0": {"precision": 0.9, "recall": 0.85, "f1": 0.87, "support": 50}}
    }
    """
    records = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.actual_label != None,  # noqa: E711
        InferenceFeedback.predicted_label != None,  # noqa: E711
    ).to_list()

    if not records:
        return {"labels": [], "matrix": [], "accuracy": 0.0, "total": 0, "correct": 0, "per_label": {}}

    labels_set: set = set()
    for r in records:
        labels_set.add(r.actual_label)
        labels_set.add(r.predicted_label)
    labels = sorted(labels_set)
    idx = {l: i for i, l in enumerate(labels)}
    n = len(labels)

    matrix = [[0] * n for _ in range(n)]
    correct = 0
    for r in records:
        a, p = r.actual_label, r.predicted_label
        matrix[idx[a]][idx[p]] += 1
        if a == p:
            correct += 1

    total = len(records)
    accuracy = round(correct / total, 4) if total else 0.0

    # Per-label precision / recall / f1
    per_label: Dict[str, Dict] = {}
    for label in labels:
        i = idx[label]
        tp = matrix[i][i]
        fp = sum(matrix[r][i] for r in range(n) if r != i)
        fn = sum(matrix[i][c] for c in range(n) if c != i)
        support = sum(matrix[i])
        precision = round(tp / (tp + fp), 4) if (tp + fp) else 0.0
        recall = round(tp / (tp + fn), 4) if (tp + fn) else 0.0
        f1 = round(2 * precision * recall / (precision + recall), 4) if (precision + recall) else 0.0
        per_label[label] = {"precision": precision, "recall": recall, "f1": f1, "support": support}

    return {
        "labels": labels,
        "matrix": matrix,
        "accuracy": accuracy,
        "total": total,
        "correct": correct,
        "per_label": per_label,
    }


async def get_accuracy_trend(trainer_name: str, bucket: str = "day") -> List[Dict]:
    """Daily/hourly accuracy bucketed time series."""
    records = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct != None,  # noqa: E711
    ).sort(InferenceFeedback.created_at).to_list()

    if not records:
        return []

    buckets: Dict[str, Dict] = defaultdict(lambda: {"total": 0, "correct": 0})
    for r in records:
        if bucket == "hour":
            key = r.created_at.strftime("%Y-%m-%dT%H:00")
        else:
            key = r.created_at.strftime("%Y-%m-%d")
        buckets[key]["total"] += 1
        if r.is_correct:
            buckets[key]["correct"] += 1

    result = []
    for ts in sorted(buckets):
        b = buckets[ts]
        result.append({
            "timestamp": ts,
            "total": b["total"],
            "correct": b["correct"],
            "accuracy": round(b["correct"] / b["total"], 4) if b["total"] else 0.0,
        })
    return result


async def get_summary(trainer_name: str) -> Dict:
    total = await InferenceFeedback.find(InferenceFeedback.trainer_name == trainer_name).count()
    correct = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct == True,  # noqa: E712
    ).count()
    incorrect = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct == False,  # noqa: E712
    ).count()
    return {
        "total_feedback": total,
        "correct": correct,
        "incorrect": incorrect,
        "accuracy": round(correct / total, 4) if total else None,
    }
