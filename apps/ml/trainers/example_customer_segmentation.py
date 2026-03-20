# @trainer
# Name: Customer Segmentation
# Version: 1.0.0
# Author: Mldock Team
# Author Email: hello@mldock.io
# Author URL: https://mldock.io
# Description: Segments customers based on transaction history and profile data using KMeans clustering
# Commercial: public
# Downloadable: true
# Protect Model: false
# License: MIT
# Tags: clustering, segmentation, sklearn, tabular

# ⚠ AI-GENERATED TRAINER
# Review by a qualified data scientist or ML engineer before production use.
# Validate output quality on your specific dataset. For complex tasks
# (image segmentation, object detection, NLP at scale), expert review is essential.

from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle, OutputFieldSpec
from app.abstract.data_source import DatasetDataSource
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans


class CustomerSegmentationTrainer(BaseTrainer):
    name = "customer_segmentation_trainer"
    version = "1.0.0"
    description = "A trainer for segmenting customers based on transaction history and profile data."
    framework = "sklearn"
    category = {"key": "clustering", "label": "Clustering"}
    schedule = None

    data_source = DatasetDataSource(
        slug="ws-0cce652e-7bf8-49da-99d5-e6a53687f435",
        auto_create_spec={
            "name": "Customer Segmentation Data",
            "description": "Dataset containing transaction history and customer profiles.",
            "fields": [
                {"label": "Original Upload", "type": "file", "required": True},
                {"label": "Clean Copy", "type": "file", "required": False},
                {"label": "Cleaning Code", "type": "file", "required": False},
            ],
        },
    )

    input_schema = {
        "transaction_data": {"type": "file", "label": "Transaction Data CSV", "required": True,"description":"csv with column x,y"},
    }

    # output_schema: "groups" is a list of per-customer dicts; "summary" is an aggregate dict.
    # Use type "list" for arrays of objects and "json" for plain dicts.
    output_schema = {
        "groups": {
            "type": "list",
            "label": "Customer Segments",
            "description": "One row per customer with their assigned segment and confidence score.",
        },
        "summary": {
            "type": "json",
            "label": "Summary Statistics",
            "description": "Aggregate stats across all customers.",
        },
    }

    # output_display: controls how the UI renders each key.
    # "table_list" renders a list of dicts as a scrollable HTML table.
    # "json" renders a plain dict as a collapsible <pre>.
    output_display = [
        OutputFieldSpec("groups",  "table_list", "Customer Segments",  span=2),
        OutputFieldSpec("summary", "json",        "Summary Statistics", span=2),
    ]

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _aggregate(df: pd.DataFrame) -> pd.DataFrame:
        """Shared feature-engineering: raw transaction rows → per-customer RFM aggregate."""
        # Parse date — supports both Excel serial (origin 1899-12-30) and ISO strings
        try:
            df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], origin="1899-12-30", unit="D")
        except Exception:
            df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], errors="coerce")

        df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").fillna(0)
        df["UnitPrice"] = pd.to_numeric(df["UnitPrice"], errors="coerce").fillna(0)
        df = df[df["Quantity"] > 0].copy()
        df["TotalValue"] = df["Quantity"] * df["UnitPrice"]

        reference_date = df["InvoiceDate"].max()

        df_agg = df.groupby("CustomerID").agg(
            TotalSpend=("TotalValue", "sum"),
            PurchaseFrequency=("InvoiceNo", "count"),
            Recency=("InvoiceDate", lambda x: (reference_date - x.max()).days),
        )
        df_agg["Recency"] = pd.to_numeric(df_agg["Recency"], errors="coerce")
        df_agg["Recency"] = df_agg["Recency"].fillna(df_agg["Recency"].max())
        return df_agg

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def preprocess(self, raw):
        import io

        orig = [e for e in raw if e.get("field_label") == "Original Upload" and (e.get("file_key") or e.get("file_url"))]
        if not orig:
            raise ValueError("No transaction data in dataset — upload a CSV via the Datasets page.")
        e = orig[-1]
        content = self._fetch_bytes(e.get("file_key"), e.get("file_url"))
        if content is None:
            raise ValueError("Could not fetch file from storage.")

        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception:
            df = pd.read_csv(io.BytesIO(content), on_bad_lines="skip", engine="python")

        return self._aggregate(df)

    def train(self, preprocessed: pd.DataFrame, config: TrainingConfig) -> TrainerBundle:
        feature_cols = list(preprocessed.columns)  # TotalSpend, PurchaseFrequency, Recency

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(preprocessed[feature_cols])

        kmeans = KMeans(n_clusters=4, random_state=config.random_seed)
        kmeans.fit(X_scaled)

        label_map = {0: "High Value", 1: "At Risk", 2: "New Customer", 3: "Dormant"}

        return TrainerBundle(
            model=kmeans,
            scaler=scaler,
            feature_names=feature_cols,
            label_map=label_map,
        )

    def predict(self, model: TrainerBundle, inputs: dict) -> dict:
        """
        inputs["transaction_data"] — base64-encoded raw transaction CSV (same format as training).

        Returns:
            {
                "groups": [
                    {"CustomerID": ..., "segment_label": ..., "confidence_score": ...,
                     "avg_transaction_value": ..., "purchase_frequency": ...},
                    ...
                ],
                "summary": {
                    "total_customers": ...,
                    "avg_transaction_value": ...,
                    "avg_purchase_frequency": ...,
                    "segment_counts": {"High Value": N, "At Risk": N, ...}
                }
            }
        """
        import base64, io

        csv_bytes = base64.b64decode(inputs["transaction_data"])

        try:
            df_raw = pd.read_csv(io.BytesIO(csv_bytes))
        except Exception:
            df_raw = pd.read_csv(io.BytesIO(csv_bytes), on_bad_lines="skip", engine="python")

        # Re-run the same feature engineering used at training time
        df_agg = self._aggregate(df_raw)

        # Scale using the fitted scaler stored in the bundle
        features = df_agg[model.feature_names]
        X_scaled = model.scaler.transform(features)

        # Assign clusters and compute per-customer confidence (distance-based)
        distances = model.model.transform(X_scaled)   # shape: (n_customers, n_clusters)
        min_dist = distances.min(axis=1)
        rng = min_dist.max() - min_dist.min()
        if rng > 0:
            confidence_scores = (1 - (min_dist - min_dist.min()) / rng) * 100
        else:
            confidence_scores = np.full(len(min_dist), 100.0)

        clusters = model.model.predict(X_scaled)

        df_agg = df_agg.reset_index()  # CustomerID back as column
        df_agg["segment_label"] = [model.label_map.get(int(c), str(c)) for c in clusters]
        df_agg["confidence_score"] = np.round(confidence_scores, 2)
        df_agg["avg_transaction_value"] = np.round(
            df_agg["TotalSpend"] / df_agg["PurchaseFrequency"].replace(0, np.nan), 2
        )
        df_agg["purchase_frequency"] = df_agg["PurchaseFrequency"]

        groups = df_agg[[
            "CustomerID",
            "segment_label",
            "confidence_score",
            "avg_transaction_value",
            "purchase_frequency",
        ]].to_dict(orient="records")

        summary = {
            "total_customers": int(len(df_agg)),
            "avg_transaction_value": float(round(df_agg["avg_transaction_value"].mean(), 2)),
            "avg_purchase_frequency": float(round(df_agg["purchase_frequency"].mean(), 2)),
            "segment_counts": df_agg["segment_label"].value_counts().to_dict(),
        }

        return {"groups": groups, "summary": summary}
