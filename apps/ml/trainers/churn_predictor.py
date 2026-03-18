"""
Customer Churn Predictor — predicts the probability a customer will churn.

Data source: MLDock Dataset with slug "churn-training-data".
The dataset must contain a single file field (CSV or Excel) with the required columns.

Required raw columns (upload via dataset):
    customer_id          — unique identifier (string)
    churn                — target: 1=churned, 0=retained
    signup_date          — ISO date string (YYYY-MM-DD)
    renewal_date         — ISO date string (YYYY-MM-DD), next renewal
    plan_type            — free | starter | professional | enterprise
    contract_length      — monthly | annual | biennial
    payment_method       — credit_card | bank_transfer | paypal | mpesa
    payment_failures     — integer, count of failed payments
    monthly_charge       — float, KES or USD
    total_charges        — float, cumulative charges
    discount_pct         — float 0–100, discount applied
    login_count_30d      — integer, logins in last 30 days
    feature_usage_score  — float 0–100, breadth of feature adoption
    api_calls_30d        — integer
    dau_wau_ratio        — float 0–1, daily vs weekly active ratio
    session_duration_avg — float, average session minutes
    emails_opened_30d    — integer
    emails_sent_30d      — integer (denominator for open rate)
    campaigns_clicked    — integer
    nps_score            — integer -100..100 (or NaN if not collected)
    support_tickets_open — integer
    support_tickets_total— integer
    avg_resolution_hours — float (or NaN)
    refund_count         — integer
    complaint_count      — integer
    upsell_attempts      — integer
    upsell_conversions   — integer

Download a filled-in template:
    GET /api/v1/trainers/churn_predictor/sample-csv

Train:
    POST /api/v1/training/start
    { "trainer_name": "churn_predictor" }

Inference:
    POST /api/v1/inference/churn_predictor
    { "inputs": { "plan_type": "starter", "login_count_30d": 3, ... } }
"""
from __future__ import annotations

import io
import os
from typing import Any, Dict, List, Optional

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig, OutputFieldSpec,TrainerBundle
from app.abstract.data_source import DatasetDataSource

# ── Dataset slug ──────────────────────────────────────────────────────────────

_DATASET_SLUG = "churn-training-data"

# ── Required raw columns ──────────────────────────────────────────────────────

_RAW_COLUMNS = [
    "customer_id",
    "churn",
    "signup_date",
    "renewal_date",
    "plan_type",
    "contract_length",
    "payment_method",
    "payment_failures",
    "monthly_charge",
    "total_charges",
    "discount_pct",
    "login_count_30d",
    "feature_usage_score",
    "api_calls_30d",
    "dau_wau_ratio",
    "session_duration_avg",
    "emails_opened_30d",
    "emails_sent_30d",
    "campaigns_clicked",
    "nps_score",
    "support_tickets_open",
    "support_tickets_total",
    "avg_resolution_hours",
    "refund_count",
    "complaint_count",
    "upsell_attempts",
    "upsell_conversions",
]

# Columns that must exist with no missing values (others can be NaN)
_REQUIRED_COLUMNS = [
    "churn",
    "plan_type",
    "contract_length",
    "payment_method",
    "payment_failures",
    "monthly_charge",
    "total_charges",
    "login_count_30d",
    "feature_usage_score",
]

# ── Derived (engineered) feature names ───────────────────────────────────────

_FEATURE_ORDER = [
    # Account
    "account_age_days",
    "days_until_renewal",
    "is_annual_contract",
    "is_free_plan",
    "plan_tier",            # 0=free,1=starter,2=professional,3=enterprise
    "monthly_charge",
    "total_charges",
    "discount_pct",
    # Engagement
    "login_count_30d",
    "feature_usage_score",
    "api_calls_30d",
    "dau_wau_ratio",
    "session_duration_avg",
    "engagement_score",     # composite
    # Marketing
    "email_open_rate",
    "campaign_click_rate",
    # Revenue
    "payment_failures",
    "arpu",                 # monthly_charge / max(account_age_days/30, 1)
    "ltv_to_charge_ratio",  # total_charges / (monthly_charge * 12 + 1)
    # Support
    "support_tickets_open",
    "support_tickets_total",
    "avg_resolution_hours",
    "refund_count",
    "complaint_count",
    "support_burden_score", # composite
    # Behavioural trends
    "upsell_conversion_rate",
    # Sentiment
    "nps_score",
    # Risk flags (binary)
    "flag_high_payment_failures",
    "flag_low_engagement",
    "flag_high_support_burden",
    "flag_negative_nps",
    "flag_no_upsell_conversion",
    # Composite risk score
    "churn_risk_score",
]


# ── Helper: derive all engineered features ────────────────────────────────────

def _engineer_features(df):
    import numpy as np
    import pandas as pd
    from datetime import date

    today = pd.Timestamp(date.today())

    # ── Account age & renewal horizon ──────────────────────────────────────────
    for col in ("signup_date", "renewal_date"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    if "signup_date" in df.columns:
        df["account_age_days"] = (today - df["signup_date"]).dt.days.clip(lower=0)
    else:
        df["account_age_days"] = 0.0

    if "renewal_date" in df.columns:
        df["days_until_renewal"] = (df["renewal_date"] - today).dt.days
        df["days_until_renewal"] = df["days_until_renewal"].fillna(365).clip(lower=-365)
    else:
        df["days_until_renewal"] = 365.0

    # ── Contract / plan ────────────────────────────────────────────────────────
    if "contract_length" in df.columns:
        df["is_annual_contract"] = df["contract_length"].isin(["annual", "biennial"]).astype(float)
    else:
        df["is_annual_contract"] = 0.0

    _plan_map = {"free": 0, "starter": 1, "professional": 2, "enterprise": 3}
    if "plan_type" in df.columns:
        df["plan_tier"] = df["plan_type"].str.lower().map(_plan_map).fillna(1).astype(float)
        df["is_free_plan"] = (df["plan_tier"] == 0).astype(float)
    else:
        df["plan_tier"] = 1.0
        df["is_free_plan"] = 0.0

    # ── Revenue ────────────────────────────────────────────────────────────────
    df["monthly_charge"] = pd.to_numeric(df.get("monthly_charge", 0), errors="coerce").fillna(0)
    df["total_charges"] = pd.to_numeric(df.get("total_charges", 0), errors="coerce").fillna(0)
    df["discount_pct"] = pd.to_numeric(df.get("discount_pct", 0), errors="coerce").fillna(0)
    df["payment_failures"] = pd.to_numeric(df.get("payment_failures", 0), errors="coerce").fillna(0)

    months_active = (df["account_age_days"] / 30).clip(lower=1)
    df["arpu"] = df["monthly_charge"] / months_active
    annual_expected = df["monthly_charge"] * 12 + 1
    df["ltv_to_charge_ratio"] = df["total_charges"] / annual_expected

    # ── Engagement ─────────────────────────────────────────────────────────────
    df["login_count_30d"] = pd.to_numeric(df.get("login_count_30d", 0), errors="coerce").fillna(0)
    df["feature_usage_score"] = pd.to_numeric(df.get("feature_usage_score", 0), errors="coerce").fillna(0)
    df["api_calls_30d"] = pd.to_numeric(df.get("api_calls_30d", 0), errors="coerce").fillna(0)
    df["dau_wau_ratio"] = pd.to_numeric(df.get("dau_wau_ratio", 0), errors="coerce").fillna(0).clip(0, 1)
    df["session_duration_avg"] = pd.to_numeric(df.get("session_duration_avg", 0), errors="coerce").fillna(0)

    # Composite: normalise each sub-signal to 0-100, average with weights
    login_norm = (df["login_count_30d"] / 30).clip(0, 1) * 100
    feature_norm = df["feature_usage_score"].clip(0, 100)
    api_norm = (np.log1p(df["api_calls_30d"]) / np.log1p(1000)).clip(0, 1) * 100
    dau_norm = df["dau_wau_ratio"] * 100
    session_norm = (df["session_duration_avg"] / 60).clip(0, 1) * 100
    df["engagement_score"] = (
        0.30 * login_norm
        + 0.25 * feature_norm
        + 0.20 * api_norm
        + 0.15 * dau_norm
        + 0.10 * session_norm
    )

    # ── Marketing ──────────────────────────────────────────────────────────────
    emails_sent = pd.to_numeric(df.get("emails_sent_30d", 1), errors="coerce").fillna(1).clip(lower=1)
    emails_opened = pd.to_numeric(df.get("emails_opened_30d", 0), errors="coerce").fillna(0)
    campaigns_clicked = pd.to_numeric(df.get("campaigns_clicked", 0), errors="coerce").fillna(0)
    df["email_open_rate"] = (emails_opened / emails_sent).clip(0, 1)
    df["campaign_click_rate"] = (campaigns_clicked / emails_sent).clip(0, 1)

    # ── Support ────────────────────────────────────────────────────────────────
    df["support_tickets_open"] = pd.to_numeric(df.get("support_tickets_open", 0), errors="coerce").fillna(0)
    df["support_tickets_total"] = pd.to_numeric(df.get("support_tickets_total", 0), errors="coerce").fillna(0)
    df["avg_resolution_hours"] = pd.to_numeric(df.get("avg_resolution_hours", np.nan), errors="coerce").fillna(24)
    df["refund_count"] = pd.to_numeric(df.get("refund_count", 0), errors="coerce").fillna(0)
    df["complaint_count"] = pd.to_numeric(df.get("complaint_count", 0), errors="coerce").fillna(0)

    ticket_norm = (df["support_tickets_total"] / 10).clip(0, 1) * 100
    resolution_norm = (df["avg_resolution_hours"] / 72).clip(0, 1) * 100
    refund_norm = (df["refund_count"] / 5).clip(0, 1) * 100
    df["support_burden_score"] = (
        0.40 * ticket_norm
        + 0.35 * resolution_norm
        + 0.25 * refund_norm
    )

    # ── Upsell ─────────────────────────────────────────────────────────────────
    upsell_attempts = pd.to_numeric(df.get("upsell_attempts", 0), errors="coerce").fillna(0).clip(lower=0)
    upsell_conversions = pd.to_numeric(df.get("upsell_conversions", 0), errors="coerce").fillna(0)
    df["upsell_conversion_rate"] = (upsell_conversions / upsell_attempts.clip(lower=1)).clip(0, 1)

    # ── Sentiment ──────────────────────────────────────────────────────────────
    df["nps_score"] = pd.to_numeric(df.get("nps_score", 0), errors="coerce").fillna(0).clip(-100, 100)

    # ── Risk flags ─────────────────────────────────────────────────────────────
    df["flag_high_payment_failures"] = (df["payment_failures"] >= 2).astype(float)
    df["flag_low_engagement"] = (df["engagement_score"] < 20).astype(float)
    df["flag_high_support_burden"] = (df["support_burden_score"] > 60).astype(float)
    df["flag_negative_nps"] = (df["nps_score"] < 0).astype(float)
    df["flag_no_upsell_conversion"] = ((upsell_attempts > 0) & (upsell_conversions == 0)).astype(float)

    # ── Composite churn risk score (0–100) ────────────────────────────────────
    risk_raw = (
        0.25 * (100 - df["engagement_score"].clip(0, 100))
        + 0.20 * df["support_burden_score"].clip(0, 100)
        + 0.15 * (df["payment_failures"] / 5).clip(0, 1) * 100
        + 0.15 * df["flag_negative_nps"] * 50
        + 0.10 * df["flag_high_payment_failures"] * 100
        + 0.10 * df["flag_low_engagement"] * 100
        + 0.05 * (df["days_until_renewal"].clip(-30, 365) < 30).astype(float) * 100
    )
    df["churn_risk_score"] = risk_raw.clip(0, 100)

    return df


def _load_dataframe_from_entries(entries: List[Dict]) -> "pd.DataFrame":
    """
    Convert DatasetDataSource entries into a DataFrame.

    The dataset is expected to have a single file field (CSV or Excel).
    The most recent file entry is used.  Reads directly from S3 via
    BaseTrainer._fetch_bytes (preferred over presigned URL which embeds
    the internal minio hostname).
    """
    import pandas as pd
    from app.abstract.base_trainer import BaseTrainer as _BT

    file_entries = [
        e for e in entries
        if e.get("field_type") in ("file", "image")
        and (e.get("file_key") or e.get("file_url"))
    ]
    if not file_entries:
        raise ValueError(
            "Dataset 'churn-training-data' has no file entries. "
            "Upload a CSV or Excel file via the Datasets page."
        )

    entry = file_entries[-1]
    content = _BT._fetch_bytes(entry.get("file_key"), entry.get("file_url"))
    if content is None:
        raise ValueError(
            "Could not download the training file from storage. "
            "Ensure the file is uploaded and accessible."
        )

    fname = (entry.get("file_key") or entry.get("file_url") or "").split("?")[0].split("/")[-1].lower()
    if fname.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content), on_bad_lines="skip", engine="python")

    return df


# ── Sample CSV generator ───────────────────────────────────────────────────────

def generate_sample_csv() -> bytes:
    """Return a 10-row sample CSV demonstrating the expected column format."""
    import pandas as pd
    import random
    from datetime import date, timedelta

    random.seed(42)
    today = date.today()
    rows = []

    plan_types = ["free", "starter", "professional", "enterprise"]
    contract_lengths = ["monthly", "annual", "biennial"]
    payment_methods = ["credit_card", "bank_transfer", "paypal", "mpesa"]

    for i in range(1, 11):
        signup_offset = random.randint(30, 730)
        renewal_offset = random.randint(-30, 180)
        plan = random.choice(plan_types)
        charge = {"free": 0, "starter": 999, "professional": 4999, "enterprise": 14999}[plan]
        logins = random.randint(0, 40)
        tickets = random.randint(0, 8)
        upsell_att = random.randint(0, 5)
        rows.append({
            "customer_id": f"CUST-{i:04d}",
            "churn": random.choice([0, 0, 0, 1]),
            "signup_date": (today - timedelta(days=signup_offset)).isoformat(),
            "renewal_date": (today + timedelta(days=renewal_offset)).isoformat(),
            "plan_type": plan,
            "contract_length": random.choice(contract_lengths),
            "payment_method": random.choice(payment_methods),
            "payment_failures": random.randint(0, 4),
            "monthly_charge": charge,
            "total_charges": charge * signup_offset / 30,
            "discount_pct": random.choice([0, 10, 20, 0, 0]),
            "login_count_30d": logins,
            "feature_usage_score": round(random.uniform(5, 95), 1),
            "api_calls_30d": random.randint(0, 500),
            "dau_wau_ratio": round(random.uniform(0, 1), 2),
            "session_duration_avg": round(random.uniform(1, 60), 1),
            "emails_opened_30d": random.randint(0, 10),
            "emails_sent_30d": random.randint(5, 20),
            "campaigns_clicked": random.randint(0, 5),
            "nps_score": random.randint(-50, 80),
            "support_tickets_open": random.randint(0, 3),
            "support_tickets_total": tickets,
            "avg_resolution_hours": round(random.uniform(1, 72), 1) if tickets else "",
            "refund_count": random.randint(0, 2),
            "complaint_count": random.randint(0, 3),
            "upsell_attempts": upsell_att,
            "upsell_conversions": random.randint(0, upsell_att),
        })

    df = pd.DataFrame(rows, columns=_RAW_COLUMNS)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


# ── Trainer ────────────────────────────────────────────────────────────────────

class ChurnPredictor(BaseTrainer):
    name = "churn_predictor"
    version = "1.0.0"
    description = (
        "Predicts customer churn probability from account, engagement, marketing, "
        "revenue, support, and sentiment signals. Upload a CSV or Excel file to the "
        "'churn-training-data' dataset to train."
    )
    framework = "sklearn"
    schedule = None
    category = {"key": "classification", "label": "Classification"}

    output_display = [
        OutputFieldSpec("risk_level",        "label",      "Churn Risk Level",       primary=True,
                        hint="low / medium / high / critical"),
        OutputFieldSpec("churn_probability", "confidence", "Churn Probability"),
        OutputFieldSpec("churn_risk_score",  "reading",    "Risk Score"),
        OutputFieldSpec("engagement_score",  "reading",    "Engagement Score"),
        OutputFieldSpec("top_risk_factors",  "json",       "Top Risk Factors"),
        OutputFieldSpec("recommendation",    "text",       "Recommendation"),
    ]

    # Data source: MLDock Dataset identified by slug.
    # auto_create_spec ensures the dataset is created automatically the first
    # time this trainer runs for a new org — no manual setup needed.
    data_source = DatasetDataSource(
        slug=_DATASET_SLUG,
        sample_csv_endpoint="/api/v1/trainers/churn_predictor/sample-csv",
        auto_create_spec={
            "name": "Churn Training Data",
            "description": (
                "Customer records used to train the churn prediction model. "
                "Upload a CSV or Excel file with one row per customer. "
                "Download the sample template from the Trainers page for the full column list."
            ),
            "category": "training",
            "fields": [
                {
                    "label": "Customer Data (CSV / Excel)",
                    "instruction": (
                        "Upload a CSV or Excel file. Required columns: churn, plan_type, "
                        "monthly_charge, login_count_30d, feature_usage_score, "
                        "payment_failures, total_charges. "
                        "Download the sample template for all columns."
                    ),
                    "type": "file",
                    "capture_mode": "upload_only",
                    "required": True,
                    "repeatable": False,
                },
            ],
        },
    )

    # ── Input schema (inference) ───────────────────────────────────────────────

    input_schema = {
        "plan_type":            {"type": "select", "label": "Plan Type",
                                 "options": ["free", "starter", "professional", "enterprise"],
                                 "required": True, "default": "starter"},
        "contract_length":      {"type": "select", "label": "Contract Length",
                                 "options": ["monthly", "annual", "biennial"],
                                 "required": True, "default": "monthly"},
        "payment_method":       {"type": "select", "label": "Payment Method",
                                 "options": ["credit_card", "bank_transfer", "paypal", "mpesa"],
                                 "required": False, "default": "credit_card"},
        "account_age_days":     {"type": "number", "label": "Account Age (days)",
                                 "required": False, "default": 90, "min": 0},
        "days_until_renewal":   {"type": "number", "label": "Days Until Renewal",
                                 "required": False, "default": 30},
        "monthly_charge":       {"type": "number", "label": "Monthly Charge (KES)",
                                 "required": True, "default": 999, "min": 0},
        "total_charges":        {"type": "number", "label": "Total Charges to Date (KES)",
                                 "required": False, "default": 2997, "min": 0},
        "discount_pct":         {"type": "number", "label": "Discount %",
                                 "required": False, "default": 0, "min": 0, "max": 100},
        "payment_failures":     {"type": "number", "label": "Payment Failures",
                                 "required": True, "default": 0, "min": 0},
        "login_count_30d":      {"type": "number", "label": "Logins (last 30 days)",
                                 "required": True, "default": 5, "min": 0},
        "feature_usage_score":  {"type": "number", "label": "Feature Usage Score (0–100)",
                                 "required": True, "default": 40, "min": 0, "max": 100},
        "api_calls_30d":        {"type": "number", "label": "API Calls (last 30 days)",
                                 "required": False, "default": 50, "min": 0},
        "dau_wau_ratio":        {"type": "number", "label": "DAU/WAU Ratio (0–1)",
                                 "required": False, "default": 0.3, "min": 0, "max": 1, "step": 0.01},
        "session_duration_avg": {"type": "number", "label": "Avg Session Duration (min)",
                                 "required": False, "default": 10, "min": 0},
        "emails_opened_30d":    {"type": "number", "label": "Emails Opened (30 days)",
                                 "required": False, "default": 2, "min": 0},
        "emails_sent_30d":      {"type": "number", "label": "Emails Sent (30 days)",
                                 "required": False, "default": 8, "min": 1},
        "campaigns_clicked":    {"type": "number", "label": "Campaign Clicks (30 days)",
                                 "required": False, "default": 1, "min": 0},
        "nps_score":            {"type": "number", "label": "NPS Score (-100 to 100)",
                                 "required": False, "default": 10, "min": -100, "max": 100},
        "support_tickets_open": {"type": "number", "label": "Open Support Tickets",
                                 "required": False, "default": 0, "min": 0},
        "support_tickets_total":{"type": "number", "label": "Total Support Tickets",
                                 "required": False, "default": 1, "min": 0},
        "avg_resolution_hours": {"type": "number", "label": "Avg Resolution Time (hours)",
                                 "required": False, "default": 24, "min": 0},
        "refund_count":         {"type": "number", "label": "Refund Count",
                                 "required": False, "default": 0, "min": 0},
        "complaint_count":      {"type": "number", "label": "Complaint Count",
                                 "required": False, "default": 0, "min": 0},
        "upsell_attempts":      {"type": "number", "label": "Upsell Attempts",
                                 "required": False, "default": 0, "min": 0},
        "upsell_conversions":   {"type": "number", "label": "Upsell Conversions",
                                 "required": False, "default": 0, "min": 0},
    }

    output_schema = {
        "churn_probability":  {"type": "number",  "label": "Churn Probability", "format": "percent"},
        "risk_level":         {"type": "text",    "label": "Risk Level"},
        "churn_risk_score":   {"type": "number",  "label": "Risk Score (0–100)"},
        "engagement_score":   {"type": "number",  "label": "Engagement Score (0–100)"},
        "top_risk_factors":   {"type": "json",    "label": "Top Risk Factors"},
        "recommendation":     {"type": "text",    "label": "Recommended Action"},
    }

    # ── Preprocessing ──────────────────────────────────────────────────────────

    def preprocess(self, raw_data):
        """
        raw_data is the list of dicts from DatasetDataSource.
        Each dict has field_type, text_value, file_url etc.
        We download the first file entry as CSV/Excel and build the training DataFrame.
        """
        import pandas as pd

        if not raw_data:
            raise ValueError(
                "Dataset 'churn-training-data' is empty. "
                "Upload a CSV/Excel file via the Datasets page first."
            )

        df = _load_dataframe_from_entries(raw_data)

        # Validate required columns
        missing = [c for c in _REQUIRED_COLUMNS if c not in df.columns]
        if missing:
            raise ValueError(
                f"Missing required columns in uploaded file: {missing}. "
                f"Download the sample CSV template for the expected format."
            )

        # Engineer features
        df = _engineer_features(df)

        # Drop non-feature columns, keep label
        keep = _FEATURE_ORDER + ["churn"]
        available = [c for c in keep if c in df.columns]
        df = df[available].copy()

        # Drop rows with missing churn label
        df = df.dropna(subset=["churn"])
        df["churn"] = df["churn"].astype(int)

        # Fill remaining NaNs with column medians
        for col in _FEATURE_ORDER:
            if col in df.columns:
                median_val = df[col].median()
                df[col] = df[col].fillna(median_val if not pd.isna(median_val) else 0)

        if len(df) < 20:
            raise ValueError(
                f"Not enough training samples after cleaning ({len(df)} rows). "
                "Upload a file with at least 20 valid rows."
            )

        return df

    # ── Training ───────────────────────────────────────────────────────────────

    def train(self, preprocessed, config: TrainingConfig):
        config.task = "classification"
        config.test_split = 0.2
        config.val_split = 0.0
        return self.auto_train_tabular(preprocessed, label_col="churn", config=config)

    # ── Evaluation ─────────────────────────────────────────────────────────────

    def evaluate(self, model, test_data) -> EvaluationResult:
        from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

        X_test, y_test = test_data
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else y_pred.astype(float)

        return EvaluationResult(
            accuracy=float(accuracy_score(y_test, y_pred)),
            f1=float(f1_score(y_test, y_pred, average="binary", zero_division=0)),
            roc_auc=float(roc_auc_score(y_test, y_proba)),
            y_true=y_test.tolist() if hasattr(y_test, "tolist") else list(y_test),
            y_pred=y_pred.tolist() if hasattr(y_pred, "tolist") else list(y_pred),
        )

    # ── Inference ──────────────────────────────────────────────────────────────

    def predict(self, model, inputs: dict) -> dict:
        import pandas as pd
        import numpy as np

        # Build a single-row raw dict and run feature engineering
        raw = {col: inputs.get(col, None) for col in _RAW_COLUMNS if col not in ("customer_id", "churn")}

        # For date columns, fill with sensible defaults if not provided
        from datetime import date, timedelta
        today = date.today()
        if "signup_date" not in inputs:
            account_age = float(inputs.get("account_age_days", 90))
            raw["signup_date"] = (today - timedelta(days=int(account_age))).isoformat()
        else:
            raw["signup_date"] = inputs["signup_date"]

        if "renewal_date" not in inputs:
            dtr = float(inputs.get("days_until_renewal", 30))
            raw["renewal_date"] = (today + timedelta(days=int(dtr))).isoformat()
        else:
            raw["renewal_date"] = inputs["renewal_date"]

        df_single = pd.DataFrame([raw])
        df_single = _engineer_features(df_single)

        # Fill missing engineered features
        for col in _FEATURE_ORDER:
            if col not in df_single.columns:
                df_single[col] = 0.0

        row = df_single[_FEATURE_ORDER].iloc[[0]]

        proba = float(model.predict_proba(row)[0][1]) if hasattr(model, "predict_proba") else float(model.predict(row)[0])

        # Risk level
        if proba >= 0.75:
            risk_level = "critical"
        elif proba >= 0.50:
            risk_level = "high"
        elif proba >= 0.25:
            risk_level = "medium"
        else:
            risk_level = "low"

        # Top risk factors from feature importances
        top_factors = self._top_risk_factors(model, row, proba)

        # Recommendation
        recommendation = self._recommend(proba, row.iloc[0])

        return {
            "churn_probability": round(proba, 4),
            "risk_level": risk_level,
            "churn_risk_score": round(float(row["churn_risk_score"].iloc[0]), 1),
            "engagement_score": round(float(row["engagement_score"].iloc[0]), 1),
            "top_risk_factors": top_factors,
            "recommendation": recommendation,
        }

    def _top_risk_factors(self, model, row, proba: float, n: int = 5) -> List[Dict]:
        """Return the top N feature importances for this prediction."""
        try:
            if hasattr(model, "named_steps"):
                # Pipeline — get the final estimator
                estimator = model.named_steps.get("clf") or list(model.named_steps.values())[-1]
            else:
                estimator = model

            if not hasattr(estimator, "feature_importances_"):
                return []

            importances = estimator.feature_importances_
            feature_names = _FEATURE_ORDER[:len(importances)]
            pairs = sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)
            factors = []
            for fname, imp in pairs[:n]:
                val = float(row[fname].iloc[0]) if fname in row.columns else 0.0
                factors.append({"feature": fname, "importance": round(imp, 4), "value": round(val, 3)})
            return factors
        except Exception:
            return []

    def _recommend(self, proba: float, row) -> str:
        if proba < 0.25:
            return "Customer is healthy. Continue nurturing with regular check-ins."
        if proba < 0.50:
            flags = []
            if float(row.get("flag_low_engagement", 0)) > 0.5:
                flags.append("boost engagement with onboarding tips")
            if float(row.get("flag_high_payment_failures", 0)) > 0.5:
                flags.append("resolve payment issues proactively")
            if flags:
                return "At risk — " + "; ".join(flags) + "."
            return "Monitor closely; consider a proactive outreach campaign."
        if proba < 0.75:
            return (
                "High churn risk — trigger win-back campaign: offer discount, "
                "assign a CSM, schedule a health check call."
            )
        return (
            "Critical churn risk — immediate intervention required: "
            "escalate to account management, offer contract renewal incentive, "
            "address any open support tickets within 24 hours."
        )

    def get_feature_names(self):
        return _FEATURE_ORDER

    def get_class_names(self):
        return ["retained", "churned"]
