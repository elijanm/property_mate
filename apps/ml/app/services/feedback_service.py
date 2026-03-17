"""
Feedback storage + confusion matrix computation + MLflow metric logging.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional

# OCR mode kicks in when unique label count exceeds this threshold.
# Water meters / free-form OCR produce millions of unique values — a
# per-value confusion matrix is meaningless above this size.
_OCR_LABEL_THRESHOLD = 20


def _levenshtein(s1: str, s2: str) -> int:
    """Compute edit distance (insertions, deletions, substitutions)."""
    if not s1:
        return len(s2)
    if not s2:
        return len(s1)
    m, n = len(s1), len(s2)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            dp[j] = prev if s1[i - 1] == s2[j - 1] else 1 + min(prev, dp[j], dp[j - 1])
            prev = temp
    return dp[n]

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


async def get_confusion_matrix(trainer_name: str, deployment_id: Optional[str] = None) -> Dict:
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
    # Load all records that have a human judgment (is_correct) OR explicit actual/predicted labels.
    # Human approvals from dataset review set is_correct=True and actual_label=predicted_label,
    # so they are fully usable for both the classifier matrix and OCR metrics.
    base_filters = [
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.predicted_label != None,  # noqa: E711
        InferenceFeedback.is_correct != None,  # noqa: E711
    ]
    if deployment_id:
        base_filters.append(InferenceFeedback.deployment_id == deployment_id)
    records = await InferenceFeedback.find(*base_filters).to_list()

    if not records:
        return {"mode": "classifier", "labels": [], "matrix": [], "accuracy": 0.0, "total": 0, "correct": 0, "per_label": {}}

    # For classifier matrix we need both actual + predicted.
    # Use actual_label when present; fall back to predicted_label when is_correct=True
    # (approval confirms the prediction was correct → actual == predicted).
    labeled: List = []
    for r in records:
        actual = r.actual_label
        if actual is None and r.is_correct is True:
            actual = r.predicted_label      # approved → confirmed correct reading
        if actual is not None and r.predicted_label is not None:
            labeled.append((r.predicted_label, actual, r))

    if not labeled:
        return {"mode": "classifier", "labels": [], "matrix": [], "accuracy": 0.0, "total": 0, "correct": 0, "per_label": {}}

    labels_set: set = set()
    for predicted, actual, _ in labeled:
        labels_set.add(actual)
        labels_set.add(predicted)
    labels = sorted(labels_set)

    # Auto-switch to OCR mode for high-cardinality label spaces
    if len(labels) > _OCR_LABEL_THRESHOLD:
        ocr = await get_ocr_metrics(trainer_name, records=records)
        return {"mode": "ocr", **ocr}
    idx = {l: i for i, l in enumerate(labels)}
    n = len(labels)

    matrix = [[0] * n for _ in range(n)]
    correct = 0
    for predicted, actual, _ in labeled:
        matrix[idx[actual]][idx[predicted]] += 1
        if actual == predicted:
            correct += 1

    total = len(labeled)
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
        "mode": "classifier",
        "labels": labels,
        "matrix": matrix,
        "accuracy": accuracy,
        "total": total,
        "correct": correct,
        "per_label": per_label,
    }


async def get_ocr_metrics(
    trainer_name: str,
    records: Optional[List] = None,
    deployment_id: Optional[str] = None,
) -> Dict:
    """
    OCR / regression evaluation metrics for high-cardinality label spaces
    (e.g. water meter readings, document OCR).

    Returned structure:
    {
      "total": 1000,
      "exact_match": 870,
      "exact_match_rate": 0.87,
      "char_error_rate": 0.032,      # avg Levenshtein / actual_length
      "digit_accuracy": 0.96,        # % of digit positions correct (zero-padded to same length)
      "off_by": {                    # numeric difference buckets (for numeric readings)
        "exact": 870, "1": 40, "2_to_10": 30, "11_to_100": 20, "over_100": 40
      },
      "common_errors": [             # top 20 misread patterns
        {"actual": "00092", "predicted": "00062", "count": 12}, ...
      ]
    }
    """
    if records is None:
        ocr_filters = [
            InferenceFeedback.trainer_name == trainer_name,
            InferenceFeedback.predicted_label != None,  # noqa: E711
            InferenceFeedback.is_correct != None,  # noqa: E711
        ]
        if deployment_id:
            ocr_filters.append(InferenceFeedback.deployment_id == deployment_id)
        records = await InferenceFeedback.find(*ocr_filters).to_list()

    if not records:
        return {
            "total": 0, "exact_match": 0, "exact_match_rate": 0.0,
            "char_error_rate": 0.0, "digit_accuracy": 0.0,
            "off_by": {"exact": 0, "1": 0, "2_to_10": 0, "11_to_100": 0, "over_100": 0},
            "common_errors": [],
        }

    total = len(records)
    # Primary accuracy: driven by human approval (is_correct), not string comparison.
    # When is_correct=True the human confirmed the prediction — no need for actual_label.
    exact_match = sum(1 for r in records if r.is_correct is True)

    # Detailed string metrics only available when the reviewer noted the correct value
    # (actual_label present and different from predicted when rejected).
    total_edit = 0
    total_chars = 0
    digit_correct = 0
    digit_total = 0
    off_by: Dict[str, int] = {"exact": 0, "1": 0, "2_to_10": 0, "11_to_100": 0, "over_100": 0}
    error_counter: Dict[tuple, int] = defaultdict(int)

    for r in records:
        p: str = (r.predicted_label or "").strip()
        # actual: reviewer-noted correct value; for approved records it equals predicted
        if r.is_correct is True:
            a = p
        elif r.actual_label:
            a = r.actual_label.strip()
        else:
            # Rejected but no correction noted — can't compute string metrics
            continue

        # Character Error Rate
        edit = _levenshtein(a, p)
        total_edit += edit
        total_chars += max(len(a), 1)

        # Digit-position accuracy (pad both to the same length with leading zeros)
        max_len = max(len(a), len(p), 1)
        a_pad = a.zfill(max_len)
        p_pad = p.zfill(max_len)
        for ac, pc in zip(a_pad, p_pad):
            digit_total += 1
            if ac == pc:
                digit_correct += 1

        # Numeric off-by
        a_digits = "".join(c for c in a if c.isdigit())
        p_digits = "".join(c for c in p if c.isdigit())
        if a_digits and p_digits:
            try:
                diff = abs(int(a_digits) - int(p_digits))
                if diff == 0:
                    off_by["exact"] += 1
                elif diff == 1:
                    off_by["1"] += 1
                elif diff <= 10:
                    off_by["2_to_10"] += 1
                elif diff <= 100:
                    off_by["11_to_100"] += 1
                else:
                    off_by["over_100"] += 1
            except ValueError:
                pass

        # Track misread pairs (only meaningful when we know both sides)
        if a != p:
            error_counter[(a, p)] += 1

    common_errors = [
        {"actual": a, "predicted": p, "count": c}
        for (a, p), c in sorted(error_counter.items(), key=lambda x: x[1], reverse=True)[:20]
    ]

    # off_by "exact" from string analysis may under-count (missing rejected-no-note records);
    # override with the is_correct count which is always complete.
    off_by["exact"] = exact_match

    return {
        "total": total,
        "exact_match": exact_match,
        "exact_match_rate": round(exact_match / total, 4),
        "char_error_rate": round(total_edit / max(total_chars, 1), 4),
        "digit_accuracy": round(digit_correct / max(digit_total, 1), 4),
        "off_by": off_by,
        "common_errors": common_errors,
    }


async def compute_derived_metrics(
    trainer_name: str,
    deployment_ids: List[str],
) -> Dict:
    """
    Compute trainer-declared derived metrics per deployment from InferenceFeedback records.

    Returns:
    {
      "specs": [{"key": "exact_match", "label": "Exact Match Rate", "unit": "%", ...}],
      "per_deployment": {
        "<dep_id>": {
          "exact_match":    0.87,
          "digit_accuracy": 0.96,
          "edit_distance":  0.18,
          "numeric_delta":  12.4
        }, ...
      }
    }
    """
    from app.models.trainer_registration import TrainerRegistration

    reg = await TrainerRegistration.find_one(TrainerRegistration.name == trainer_name)
    specs: List[Dict] = reg.derived_metrics if reg and reg.derived_metrics else []

    if not specs:
        return {"specs": [], "per_deployment": {}}

    metric_keys = {s["key"] for s in specs}
    per_deployment: Dict[str, Dict[str, Optional[float]]] = {}

    for dep_id in deployment_ids:
        records = await InferenceFeedback.find(
            InferenceFeedback.trainer_name == trainer_name,
            InferenceFeedback.deployment_id == dep_id,
            InferenceFeedback.predicted_label != None,  # noqa: E711
            InferenceFeedback.is_correct != None,  # noqa: E711
        ).to_list()

        if not records:
            per_deployment[dep_id] = {k: None for k in metric_keys}
            continue

        total = len(records)
        result: Dict[str, Optional[float]] = {}

        if "exact_match" in metric_keys:
            correct = sum(1 for r in records if r.is_correct is True)
            result["exact_match"] = round(correct / total, 4) if total else None

        # String-level metrics need actual labels
        labeled = []
        for r in records:
            p = (r.predicted_label or "").strip()
            if r.is_correct is True:
                a = p
            elif r.actual_label:
                a = r.actual_label.strip()
            else:
                continue
            labeled.append((p, a))

        if labeled:
            if "digit_accuracy" in metric_keys:
                dc, dt = 0, 0
                for p, a in labeled:
                    ml = max(len(a), len(p), 1)
                    for ac, pc in zip(a.zfill(ml), p.zfill(ml)):
                        dt += 1
                        if ac == pc:
                            dc += 1
                result["digit_accuracy"] = round(dc / dt, 4) if dt else None

            if "edit_distance" in metric_keys:
                total_edit = sum(_levenshtein(a, p) for p, a in labeled)
                result["edit_distance"] = round(total_edit / len(labeled), 4)

            if "numeric_delta" in metric_keys:
                deltas = []
                for p, a in labeled:
                    a_d = "".join(c for c in a if c.isdigit())
                    p_d = "".join(c for c in p if c.isdigit())
                    if a_d and p_d:
                        try:
                            deltas.append(abs(int(a_d) - int(p_d)))
                        except ValueError:
                            pass
                result["numeric_delta"] = round(sum(deltas) / len(deltas), 4) if deltas else None
        else:
            for k in ("digit_accuracy", "edit_distance", "numeric_delta"):
                if k in metric_keys:
                    result[k] = None

        per_deployment[dep_id] = result

    return {"specs": specs, "per_deployment": per_deployment}


async def get_accuracy_trend(trainer_name: str, bucket: str = "day", deployment_id: Optional[str] = None) -> List[Dict]:
    """Daily/hourly accuracy bucketed time series."""
    trend_filters = [
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct != None,  # noqa: E711
    ]
    if deployment_id:
        trend_filters.append(InferenceFeedback.deployment_id == deployment_id)
    records = await InferenceFeedback.find(*trend_filters).sort(InferenceFeedback.created_at).to_list()

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


async def get_summary(trainer_name: str, deployment_id: Optional[str] = None) -> Dict:
    dep_filter = [InferenceFeedback.deployment_id == deployment_id] if deployment_id else []
    total = await InferenceFeedback.find(InferenceFeedback.trainer_name == trainer_name, *dep_filter).count()
    correct = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct == True,  # noqa: E712
        *dep_filter,
    ).count()
    incorrect = await InferenceFeedback.find(
        InferenceFeedback.trainer_name == trainer_name,
        InferenceFeedback.is_correct == False,  # noqa: E712
        *dep_filter,
    ).count()
    return {
        "total_feedback": total,
        "correct": correct,
        "incorrect": incorrect,
        "accuracy": round(correct / total, 4) if total else None,
    }
