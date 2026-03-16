"""
IP Threat Detector — self-training model that learns malicious IP patterns.

Trains automatically every 30 minutes from the ip_records collection.
Uses a feature vector built from request-level behavioral signals:
  rate_1m, rate_10m, rate_1h, error_rate, susp_path_ratio,
  blocked_ratio, upload_attempts, unique_paths, total_requests

Trigger manually:
    POST /api/v1/training/start
    { "trainer_name": "ip_threat_detector" }

Schedule: every 30 minutes via cron "*/30 * * * *"

Run inference:
    POST /api/v1/inference/ip_threat_detector
    { "inputs": { "rate_1m": 5, "rate_10m": 12, ... } }
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import InMemoryDataSource


def _utc_now():
    return datetime.now(timezone.utc)


class IPThreatDetector(BaseTrainer):
    name = "ip_threat_detector"
    version = "1.0.0"
    description = (
        "Classifies IPs as malicious or benign using behavioral signals. "
        "Auto-trains every 30 minutes from live request logs."
    )
    framework = "sklearn"
    schedule = "*/30 * * * *"          # retrain every 30 minutes
    data_source = InMemoryDataSource()  # data loaded directly from MongoDB in preprocess()
    category = {"key": "security", "label": "Security"}

    input_schema = {
        "rate_1m":         {"type": "number", "label": "Requests / last min",    "required": True, "default": 0},
        "rate_10m":        {"type": "number", "label": "Requests / last 10 min", "required": True, "default": 0},
        "rate_1h":         {"type": "number", "label": "Requests / last hour",   "required": True, "default": 0},
        "error_rate":      {"type": "number", "label": "Error rate (0–1)",       "required": True, "default": 0},
        "susp_path_ratio": {"type": "number", "label": "Suspicious path ratio",  "required": True, "default": 0},
        "blocked_ratio":   {"type": "number", "label": "Blocked upload ratio",   "required": True, "default": 0},
        "upload_attempts": {"type": "number", "label": "Upload attempts",        "required": True, "default": 0},
        "unique_paths":    {"type": "number", "label": "Unique paths hit",       "required": True, "default": 0},
        "total_requests":  {"type": "number", "label": "Total requests",         "required": True, "default": 0},
    }

    output_schema = {
        "is_malicious":         {"type": "boolean", "label": "Malicious"},
        "threat_probability":   {"type": "number",  "label": "Threat Probability", "format": "percent"},
        "confidence":           {"type": "number",  "label": "Confidence",          "format": "percent"},
        "risk_level":           {"type": "text",    "label": "Risk Level"},
    }

    # ── preprocessing ─────────────────────────────────────────────────────────

    def preprocess(self, raw_data):
        """
        Load IPRecord documents directly from MongoDB.
        Labels are derived from:
          is_banned=True  → malicious (1)
          threat_score >= 0.85 → malicious (1)
          threat_score < 0.3  → benign (0)
          everything else → excluded (ambiguous)
        """
        import pandas as pd
        import numpy as np
        import motor.motor_asyncio
        import asyncio

        mongodb_url = os.environ.get("MONGODB_URL", "mongodb://mongodb:27017")
        db_name = os.environ.get("MONGODB_DATABASE", "pms_ml")

        async def _fetch():
            client = motor.motor_asyncio.AsyncIOMotorClient(mongodb_url)
            db = client[db_name]
            cursor = db.ip_records.find({}, {
                "ip": 1,
                "is_banned": 1,
                "threat_score": 1,
                "total_requests": 1,
                "upload_attempts": 1,
                "blocked_uploads": 1,
                "error_count": 1,
                "suspicious_path_hits": 1,
                "unique_paths": 1,
                "recent_requests": 1,
            })
            docs = await cursor.to_list(length=10000)
            client.close()
            return docs

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        if loop.is_running():
            # Already inside a running event loop (Celery worker with persistent loop).
            # Run in a new thread with its own event loop to avoid "loop already running".
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, _fetch())
                docs = future.result()
        else:
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            docs = loop.run_until_complete(_fetch())

        if len(docs) < 20:
            # Not enough real data yet — generate synthetic training set
            return self._synthetic_dataset()

        rows = []
        for doc in docs:
            score = doc.get("threat_score", 0.0)
            banned = doc.get("is_banned", False)

            if banned or score >= 0.85:
                label = 1
            elif score < 0.3:
                label = 0
            else:
                continue  # skip ambiguous

            total = max(doc.get("total_requests", 1), 1)
            uploads = doc.get("upload_attempts", 0)
            blocked = doc.get("blocked_uploads", 0)
            errors = doc.get("error_count", 0)
            susp = doc.get("suspicious_path_hits", 0)
            unique = len(doc.get("unique_paths", []))

            # Compute rates from recent_requests timestamps
            now = _utc_now()
            recent = doc.get("recent_requests", [])
            rate_1m = rate_10m = rate_1h = 0
            for r in recent:
                ts = r.get("timestamp")
                if ts is None:
                    continue
                if not ts.tzinfo:
                    ts = ts.replace(tzinfo=timezone.utc)
                diff = (now - ts).total_seconds()
                if diff <= 60:
                    rate_1m += 1
                if diff <= 600:
                    rate_10m += 1
                if diff <= 3600:
                    rate_1h += 1

            rows.append({
                "rate_1m":          float(rate_1m),
                "rate_10m":         float(rate_10m),
                "rate_1h":          float(rate_1h),
                "error_rate":       float(errors / total),
                "susp_path_ratio":  float(susp / max(unique, 1)),
                "blocked_ratio":    float(blocked / max(uploads, 1)),
                "upload_attempts":  float(uploads),
                "unique_paths":     float(unique),
                "total_requests":   float(total),
                "label":            label,
            })

        if len(rows) < 10:
            return self._synthetic_dataset()

        return pd.DataFrame(rows)

    def _synthetic_dataset(self):
        """Bootstrap training data when real data is insufficient."""
        import pandas as pd
        import numpy as np

        rng = np.random.default_rng(42)
        n_benign = 800
        n_malicious = 200

        benign = pd.DataFrame({
            "rate_1m":          rng.integers(0, 10, n_benign).astype(float),
            "rate_10m":         rng.integers(0, 50, n_benign).astype(float),
            "rate_1h":          rng.integers(0, 200, n_benign).astype(float),
            "error_rate":       rng.uniform(0, 0.2, n_benign),
            "susp_path_ratio":  rng.uniform(0, 0.05, n_benign),
            "blocked_ratio":    rng.uniform(0, 0.1, n_benign),
            "upload_attempts":  rng.integers(0, 5, n_benign).astype(float),
            "unique_paths":     rng.integers(1, 30, n_benign).astype(float),
            "total_requests":   rng.integers(1, 100, n_benign).astype(float),
            "label":            0,
        })

        malicious = pd.DataFrame({
            "rate_1m":          rng.integers(50, 500, n_malicious).astype(float),
            "rate_10m":         rng.integers(200, 2000, n_malicious).astype(float),
            "rate_1h":          rng.integers(500, 5000, n_malicious).astype(float),
            "error_rate":       rng.uniform(0.4, 1.0, n_malicious),
            "susp_path_ratio":  rng.uniform(0.3, 1.0, n_malicious),
            "blocked_ratio":    rng.uniform(0.5, 1.0, n_malicious),
            "upload_attempts":  rng.integers(5, 50, n_malicious).astype(float),
            "unique_paths":     rng.integers(5, 100, n_malicious).astype(float),
            "total_requests":   rng.integers(100, 5000, n_malicious).astype(float),
            "label":            1,
        })

        return pd.concat([benign, malicious], ignore_index=True)

    # ── training ──────────────────────────────────────────────────────────────

    def train(self, preprocessed, config: TrainingConfig):
        config.task = "classification"
        config.test_split = 0.2
        config.val_split = 0.0
        return self.auto_train_tabular(preprocessed, label_col="label", config=config)

    # ── evaluation ────────────────────────────────────────────────────────────

    def evaluate(self, model, test_data) -> EvaluationResult:
        import numpy as np
        from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

        X_test, y_test = test_data
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else y_pred

        return EvaluationResult(
            accuracy=float(accuracy_score(y_test, y_pred)),
            f1=float(f1_score(y_test, y_pred, average="binary", zero_division=0)),
            roc_auc=float(roc_auc_score(y_test, y_proba)),
            y_true=y_test.tolist() if hasattr(y_test, "tolist") else list(y_test),
            y_pred=y_pred.tolist() if hasattr(y_pred, "tolist") else list(y_pred),
        )

    # ── inference ─────────────────────────────────────────────────────────────

    def predict(self, model, inputs: dict) -> dict:
        import pandas as pd

        # Build a single-row DataFrame with named columns matching the training data.
        # This is required because the sklearn Pipeline's ColumnTransformer uses
        # integer positional selectors — a DataFrame ensures correct column order.
        feature_names = self.get_feature_names()
        row = {name: float(inputs.get(name, 0)) for name in feature_names}
        arr = pd.DataFrame([row], columns=feature_names)
        pred = int(model.predict(arr)[0])
        proba = float(model.predict_proba(arr)[0][1]) if hasattr(model, "predict_proba") else float(pred)

        if proba >= 0.85:
            risk = "critical"
        elif proba >= 0.60:
            risk = "high"
        elif proba >= 0.35:
            risk = "medium"
        else:
            risk = "low"

        return {
            "is_malicious":       bool(pred),
            "threat_probability": round(proba, 4),
            "confidence":         round(max(proba, 1 - proba), 4),
            "risk_level":         risk,
        }

    def get_feature_names(self):
        return [
            "rate_1m", "rate_10m", "rate_1h", "error_rate",
            "susp_path_ratio", "blocked_ratio", "upload_attempts",
            "unique_paths", "total_requests",
        ]
