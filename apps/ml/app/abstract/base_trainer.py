"""
BaseTrainer — the core abstraction for pluggable ML models.

How to use
----------
1. Create a Python file (e.g. my_classifier.py) in the TRAINER_PLUGIN_DIR.
2. Define a class inheriting from BaseTrainer.
3. Set class-level attributes: name, version, data_source, schedule (optional).
4. Implement train() and predict(). Optionally override evaluate(), preprocess(),
   postprocess(), get_class_names(), get_feature_names().
5. The ML service discovers and registers it automatically on startup.

Utility methods (no need to override — call from train()/predict())
---------------------------------------------------------------------
  self.split_data(X, y, config)           → (X_tr, X_val, X_te, y_tr, y_val, y_te)
  self.split_dataframe(df, label, config) → (df_train, df_val, df_test)
  self.build_optimizer(params, config)    → torch optimizer
  self.build_scheduler(opt, config, n)    → torch LR scheduler
  self.get_amp_context(config)            → torch.autocast or nullcontext
  self.move_to_device(obj, config)        → tensor/model → correct device
  self.build_dataloader(ds, config, ...)  → GPU-optimized DataLoader
  self.normalize_output(raw)              → JSON-serializable types
  self.auto_train_tabular(df, label, cfg) → sklearn best-model auto-selection (returns Pipeline)
  self.auto_train_torch(model, tr, vl, c) → full GPU training loop
  self.log_device_info(config)            → logs GPU name, VRAM, CUDA version
  self._fetch_bytes(file_key, file_url)   → bytes from S3 key (preferred) or URL fallback

Artifact persistence rules
--------------------------
  NEVER store fitted transformers (scalers, encoders, etc.) on `self` in
  preprocess() or train() and then access them in predict().  predict() runs
  on a fresh instance — self.scaler / self.encoder etc. are GONE.

  Two correct patterns:
    A) Return a sklearn Pipeline from train() — scaler is a Pipeline step,
       saved and loaded automatically.  auto_train_tabular() already does this.
    B) Return a TrainerBundle from train() — bundles model + scaler + encoder
       + feature_names + label_map + threshold into one joblib artifact.
       predict(self, model, inputs) receives the loaded TrainerBundle as `model`.

Example
-------
    from app.abstract.base_trainer import BaseTrainer
    from app.abstract.data_source import S3DataSource
    from sklearn.ensemble import RandomForestClassifier
    import pandas as pd, numpy as np

    class ChurnPredictor(BaseTrainer):
        name = "churn_predictor"
        version = "1.0.0"
        description = "Predicts tenant churn from payment history"
        data_source = S3DataSource(bucket="pms-ml", key="data/churn_training.csv")
        schedule = "0 3 * * 0"   # weekly Sunday 3am

        def preprocess(self, raw: bytes):
            df = pd.read_csv(io.BytesIO(raw))
            return df

        def train(self, preprocessed, config):
            # one-liner for tabular auto-training:
            return self.auto_train_tabular(preprocessed, label_col="churn", config=config)

        def predict(self, model, inputs):
            import numpy as np
            arr = np.array([[inputs[f] for f in self.get_feature_names()]])
            pred = int(model.predict(arr)[0])
            proba = model.predict_proba(arr)[0].tolist()
            return {"prediction": pred, "confidence": round(max(proba), 4)}

        def get_class_names(self):
            return ["retained", "churned"]
"""
from __future__ import annotations

import contextlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from app.abstract.data_source import DataSource


# ── Configuration ─────────────────────────────────────────────────────────────

@dataclass
class TrainingConfig:
    """Hardware + hyper-parameter configuration injected into every train() call."""
    # ── Hardware ───────────────────────────────────────────────────────────────
    device: str = "cpu"               # cpu | cuda | cuda:0 | mps
    workers: int = 4                  # dataloader / sklearn n_jobs
    batch_size: int = 32
    fp16: bool = False                # legacy alias — prefer mixed_precision
    mixed_precision: str = "auto"     # auto | no | fp16 | bf16
    dataloader_pin_memory: bool = True
    prefetch_factor: int = 2

    # ── Training loop ─────────────────────────────────────────────────────────
    max_epochs: int = 100
    early_stopping: bool = True
    early_stopping_patience: int = 5

    # ── Data splitting ────────────────────────────────────────────────────────
    test_split: float = 0.2           # fraction held out for test
    val_split: float = 0.0            # fraction of *remaining* held out for val (0 = no val set)
    random_seed: int = 42             # global reproducibility seed

    # ── Optimisation ──────────────────────────────────────────────────────────
    optimizer: str = "adam"           # adam | adamw | sgd | rmsprop | adagrad
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4        # L2 regularisation (AdamW / SGD)
    gradient_clip: float = 0.0        # max gradient norm (0 = disabled)
    lr_scheduler: str = "cosine"      # cosine | linear | step | plateau | none
    warmup_ratio: float = 0.0         # warmup fraction of total training steps

    # ── Task ──────────────────────────────────────────────────────────────────
    task: str = "classification"      # classification | regression | detection |
                                      # segmentation | nlp_classification |
                                      # generation | embedding | custom
    num_classes: Optional[int] = None # inferred from data if None

    # ── Trainer-specific overrides (freeform) ─────────────────────────────────
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OutputFieldSpec:
    """
    Declares how one field in predict() output should be displayed and used for feedback.

    Example (water meter OCR)::

        output_display = [
            OutputFieldSpec("original_image", "image",      "Original Photo",   span=2),
            OutputFieldSpec("masked_image",   "image",      "Detected Region",  span=2),
            OutputFieldSpec("reading",        "reading",    "Meter Reading",
                            primary=True, hint="Enter the correct meter reading"),
            OutputFieldSpec("confidence",     "confidence", "Confidence"),
        ]

    Types
    -----
    image       base64 data-URI or URL — rendered as <img>
    reading     numeric / short string result — large mono badge (use primary=True)
    label       classification label — colour chip
    confidence  float 0-1 — progress bar + percentage
    ranked_list list of {label, confidence} dicts — compact ranked table
    bbox_list   list of {label, bbox, confidence} dicts — detection cards
    table_list  list of arbitrary dicts — scrollable HTML table (use for segmentation groups, bulk results)
    text        multi-word string — plain paragraph
    json        plain dict / nested object — collapsible <pre> (use for summary stats)
    """
    key: str                # matches key returned by predict()
    type: str               # image | reading | label | confidence | ranked_list | bbox_list | table_list | text | json
    label: str              # display name shown in the UI
    primary: bool = False   # True → this value is used as predicted_label_hint + feedback label
    hint: str = ""          # placeholder in the feedback "Actual value" input
    span: int = 1           # grid columns: 1 = half-width, 2 = full-width

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key, "type": self.type, "label": self.label,
            "primary": self.primary, "hint": self.hint, "span": self.span,
        }


@dataclass
class DerivedMetricSpec:
    """
    Declares an optional derived metric computed from InferenceFeedback records.

    Built-in metric keys
    --------------------
    exact_match     % of predictions fully correct (EMR) — higher is better
    digit_accuracy  per-character digit accuracy — higher is better
    edit_distance   mean Levenshtein distance — lower is better
    numeric_delta   mean abs(int(predicted) − int(actual)) — lower is better (billing impact)

    Example (water meter OCR)::

        derived_metrics = [
            DerivedMetricSpec("exact_match",   "Exact Match Rate",  unit="%",   higher_is_better=True,  category="accuracy"),
            DerivedMetricSpec("digit_accuracy","Digit Accuracy",     unit="%",   higher_is_better=True,  category="accuracy"),
            DerivedMetricSpec("edit_distance", "Edit Distance",      unit="chars",higher_is_better=False, category="error"),
            DerivedMetricSpec("numeric_delta", "Billing Impact",     unit="units",higher_is_better=False, category="financial"),
        ]
    """
    key: str                    # exact_match | digit_accuracy | edit_distance | numeric_delta
    label: str                  # display name in the UI
    description: str = ""       # tooltip / explanation
    unit: str = ""              # "%", "chars", "KES", ""
    higher_is_better: bool = True
    category: str = "accuracy"  # accuracy | error | financial

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "unit": self.unit,
            "higher_is_better": self.higher_is_better,
            "category": self.category,
        }


@dataclass
class EvaluationResult:
    """Standard evaluation output. Trainers can populate whichever fields apply."""
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1: Optional[float] = None
    roc_auc: Optional[float] = None
    mse: Optional[float] = None
    mae: Optional[float] = None
    r2: Optional[float] = None
    # For classification: raw arrays for confusion matrix
    y_true: Optional[List] = None
    y_pred: Optional[List] = None
    extra_metrics: Dict[str, float] = field(default_factory=dict)


# ── TrainerBundle ──────────────────────────────────────────────────────────────

class TrainerBundle:
    """
    Standard container for returning multiple fitted artifacts from train().

    Use TrainerBundle when you need to persist a scaler, encoder, vectorizer,
    feature-name list, label map, or decision threshold alongside the model —
    and wrapping everything in a sklearn Pipeline is not suitable (e.g. KMeans,
    custom PyTorch wrappers, multi-output models, anomaly detectors).

    MLflow saves the entire bundle as one joblib artifact (mlflow.sklearn flavor).
    At inference time ``predict(self, model, inputs)`` receives the loaded
    TrainerBundle as the ``model`` argument — access bundle.model, bundle.scaler,
    etc. directly.

    Attributes
    ----------
    model         — the trained estimator / neural net (required)
    scaler        — fitted scaler (StandardScaler, MinMaxScaler, RobustScaler, …)
    encoder       — fitted encoder (LabelEncoder, OrdinalEncoder, …)
    vectorizer    — fitted text vectorizer (TfidfVectorizer, CountVectorizer, …)
    feature_names — ordered list of column names used during training
    label_map     — dict mapping raw output (int cluster/class) → human label
    threshold     — fitted decision threshold (e.g. anomaly percentile)
    extra         — arbitrary dict for anything else

    Example — clustering (KMeans + StandardScaler)
    ----------------------------------------------
        def train(self, preprocessed: pd.DataFrame, config: TrainingConfig):
            from sklearn.preprocessing import StandardScaler
            from sklearn.cluster import KMeans

            feature_cols = [c for c in preprocessed.columns if c != 'customer_id']
            X = preprocessed[feature_cols].values

            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            kmeans = KMeans(n_clusters=4, random_state=config.random_seed)
            kmeans.fit(X_scaled)

            label_map = {0: "Low Value", 1: "Mid Value", 2: "High Value", 3: "VIP"}
            return TrainerBundle(
                model=kmeans,
                scaler=scaler,
                feature_names=feature_cols,
                label_map=label_map,
            )

        def predict(self, model: "TrainerBundle", inputs: dict) -> dict:
            import pandas as pd
            row = pd.DataFrame([[inputs[f] for f in model.feature_names]],
                               columns=model.feature_names)
            X_scaled = model.scaler.transform(row)
            cluster   = int(model.model.predict(X_scaled)[0])
            label     = model.label_map.get(cluster, str(cluster))
            return {"segment": cluster, "segment_label": label}

    Example — anomaly detection (IsolationForest + threshold)
    ----------------------------------------------------------
        def train(self, preprocessed, config):
            from sklearn.ensemble import IsolationForest
            from sklearn.preprocessing import StandardScaler
            import numpy as np

            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(preprocessed)

            iso = IsolationForest(contamination=0.05, random_state=config.random_seed)
            iso.fit(X_scaled)
            scores = iso.decision_function(X_scaled)
            threshold = float(np.percentile(scores, 5))

            return TrainerBundle(model=iso, scaler=scaler, threshold=threshold)

        def predict(self, model: "TrainerBundle", inputs: dict) -> dict:
            import numpy as np
            row = np.array([[inputs[f] for f in model.feature_names]])
            X_scaled = model.scaler.transform(row)
            score = float(model.model.decision_function(X_scaled)[0])
            is_anomaly = score < (model.threshold or 0.0)
            return {"is_anomaly": is_anomaly, "anomaly_score": round(score, 4)}
    """

    def __init__(
        self,
        model: Any,
        scaler: Any = None,
        encoder: Any = None,
        vectorizer: Any = None,
        feature_names: Optional[List[str]] = None,
        label_map: Optional[Dict[str, Any]] = None,
        threshold: Optional[float] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.model = model
        self.scaler = scaler
        self.encoder = encoder
        self.vectorizer = vectorizer
        self.feature_names: List[str] = feature_names or []
        self.label_map: Dict[str, Any] = label_map or {}
        self.threshold = threshold
        self.extra: Dict[str, Any] = extra or {}

    # ── sklearn-compatible interface (required for mlflow.sklearn.log_model) ──

    def predict(self, X: Any) -> Any:
        """
        Delegate to self.model.predict(), applying self.scaler when set.
        This method makes TrainerBundle serialisable as a sklearn estimator by
        MLflow.  Trainer.predict(model, inputs) should access model.model /
        model.scaler directly — do NOT call model.predict() from trainer code.
        """
        X_in = X
        if self.scaler is not None:
            try:
                X_in = self.scaler.transform(X_in)
            except Exception:
                pass
        return self.model.predict(X_in)

    def predict_proba(self, X: Any) -> Any:
        """Delegate predict_proba to the wrapped model (classifiers only)."""
        X_in = X
        if self.scaler is not None:
            try:
                X_in = self.scaler.transform(X_in)
            except Exception:
                pass
        if hasattr(self.model, "predict_proba"):
            return self.model.predict_proba(X_in)
        raise AttributeError(
            f"{type(self.model).__name__} does not support predict_proba"
        )

    def __repr__(self) -> str:
        parts = [f"model={type(self.model).__name__}"]
        if self.scaler:
            parts.append(f"scaler={type(self.scaler).__name__}")
        if self.encoder:
            parts.append(f"encoder={type(self.encoder).__name__}")
        if self.vectorizer:
            parts.append(f"vectorizer={type(self.vectorizer).__name__}")
        if self.feature_names:
            parts.append(f"features={len(self.feature_names)}")
        if self.label_map:
            parts.append(f"labels={len(self.label_map)}")
        return f"TrainerBundle({', '.join(parts)})"


# ── BaseTrainer ────────────────────────────────────────────────────────────────

class BaseTrainer(ABC):
    """
    Abstract base class for pluggable ML trainers.

    Class attributes (set at class definition level):
        name        : str  — unique identifier for this trainer (required)
        version     : str  — semantic version string (default "1.0.0")
        description : str  — human-readable description
        data_source : DataSource — where to load training data from
        schedule    : Optional[str] — cron expression or None for manual-only
        framework   : str  — informational: "sklearn" | "pytorch" | "tensorflow" | "custom"
        tags        : Dict — arbitrary MLflow tags
    """

    # ── Must override ─────────────────────────────────────────────────────────
    name: str
    data_source: DataSource

    # ── Optional overrides ────────────────────────────────────────────────────
    version: str = "1.0.0"
    description: str = ""
    schedule: Optional[str] = None      # cron expression, e.g. "0 2 * * *"
    framework: str = "custom"           # sklearn | pytorch | tensorflow | custom
    tags: Dict[str, str] = {}
    requirements: List[str] = []       # pip packages needed; registry warns if any are missing
    # UI rendering schemas — see UI docs for field type options
    input_schema: Dict[str, Any] = {}   # describes inputs: {field: {type, label, ...}}
    output_schema: Dict[str, Any] = {}  # describes outputs: {field: {type, label, editable, ...}}
    category: Dict[str, str] = {}       # e.g. {"key": "ocr", "label": "OCR & Vision"}
    # Declare how predict() outputs are displayed + used for model feedback.
    # Leave empty to use the generic heuristic renderer (key-name + value-shape detection).
    output_display: List["OutputFieldSpec"] = []
    # Optional derived metrics computed from InferenceFeedback records for A/B comparison.
    derived_metrics: List["DerivedMetricSpec"] = []

    @classmethod
    def get_output_display(cls) -> List["OutputFieldSpec"]:
        return cls.output_display

    # ── Abstract methods ──────────────────────────────────────────────────────

    @abstractmethod
    def train(self, preprocessed_data: Any, config: TrainingConfig) -> Any:
        """
        Train on preprocessed_data (output of preprocess()).

        Must return either:
          - the trained model object (artifact), OR
          - a tuple (model, test_data) where test_data is passed to evaluate()

        The service will automatically log the model to MLflow.
        """
        ...

    @abstractmethod
    def predict(self, model: Any, inputs: Any) -> Any:
        """
        Run inference with the loaded model.

        inputs: whatever shape the caller sends (dict, list, numpy array).
        Returns any JSON-serialisable value.
        """
        ...

    # ── Optional overrides ────────────────────────────────────────────────────

    def preprocess(self, raw_data: Any) -> Any:
        """Transform raw data from the data source before train() is called."""
        return raw_data

    def postprocess(self, predictions: Any) -> Any:
        """Transform raw predictions before returning from the inference endpoint."""
        return self.normalize_output(predictions)

    def evaluate(self, model: Any, test_data: Any) -> EvaluationResult:
        """
        Evaluate model on test_data. Called automatically if train() returns (model, test_data).
        Override to provide custom metrics.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not implement evaluate(). "
            "Return (model, test_data) from train() and override evaluate(), "
            "or the service will skip evaluation."
        )

    def get_class_names(self) -> List[str]:
        """Return class label names for confusion matrix display."""
        return []

    def get_feature_names(self) -> List[str]:
        """Return input feature names for logging and display."""
        return []

    def get_input_example(self) -> Optional[Any]:
        """Return a sample input for MLflow model signature inference."""
        return None

    # ── Data split helpers ────────────────────────────────────────────────────

    def split_data(
        self,
        X: Any,
        y: Any,
        config: TrainingConfig,
    ) -> Tuple[Any, Any, Any, Any, Any, Any]:
        """
        Three-way split: (X_train, X_val, X_test, y_train, y_val, y_test).

        If config.val_split == 0, X_val / y_val will be empty arrays.
        Works with numpy arrays, pandas DataFrames, and lists.
        """
        from sklearn.model_selection import train_test_split

        X_tmp, X_test, y_tmp, y_test = train_test_split(
            X, y,
            test_size=config.test_split,
            random_state=config.random_seed,
        )

        if config.val_split > 0:
            val_ratio = config.val_split / (1.0 - config.test_split)
            X_train, X_val, y_train, y_val = train_test_split(
                X_tmp, y_tmp,
                test_size=val_ratio,
                random_state=config.random_seed,
            )
        else:
            X_train, X_val, y_train, y_val = X_tmp, [], y_tmp, []

        return X_train, X_val, X_test, y_train, y_val, y_test

    def split_dataframe(
        self,
        df: Any,
        label_col: str,
        config: TrainingConfig,
    ) -> Tuple[Any, Any, Any]:
        """
        Split a DataFrame into (df_train, df_val, df_test).
        df_val is empty if config.val_split == 0.
        """
        from sklearn.model_selection import train_test_split

        df_tmp, df_test = train_test_split(
            df,
            test_size=config.test_split,
            random_state=config.random_seed,
        )

        if config.val_split > 0:
            val_ratio = config.val_split / (1.0 - config.test_split)
            df_train, df_val = train_test_split(
                df_tmp,
                test_size=val_ratio,
                random_state=config.random_seed,
            )
        else:
            df_train = df_tmp
            df_val = df_tmp.iloc[:0]  # empty, same schema

        return df_train, df_val, df_test

    # ── Dataset file helper ───────────────────────────────────────────────────

    @staticmethod
    def _fetch_bytes(file_key: Optional[str], file_url: Optional[str]) -> Optional[bytes]:
        """Download file bytes from S3 key (preferred) or presigned/public URL (fallback).

        Use this in preprocess() when loading files from a DatasetDataSource:

            def preprocess(self, raw):
                entry = next((e for e in raw if e.get('field_label') == 'Original Upload'
                              and (e.get('file_key') or e.get('file_url'))), None)
                if entry is None:
                    raise ValueError("No file in dataset")
                content = self._fetch_bytes(entry.get('file_key'), entry.get('file_url'))
                df = pd.read_csv(io.BytesIO(content))
                return df
        """
        if file_key:
            try:
                import asyncio
                import aioboto3
                from app.core.config import settings as _s

                async def _get() -> bytes:
                    session = aioboto3.Session()
                    async with session.client(
                        "s3",
                        endpoint_url=_s.S3_ENDPOINT_URL,
                        aws_access_key_id=_s.S3_ACCESS_KEY,
                        aws_secret_access_key=_s.S3_SECRET_KEY,
                    ) as s3:
                        resp = await s3.get_object(Bucket=_s.S3_BUCKET, Key=file_key)
                        return await resp["Body"].read()

                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                            return ex.submit(asyncio.run, _get()).result()
                    return loop.run_until_complete(_get())
                except RuntimeError:
                    return asyncio.run(_get())
            except Exception as exc:
                import structlog
                structlog.get_logger(__name__).warning(
                    "fetch_bytes_s3_failed", file_key=file_key, error=str(exc)
                )

        if file_url:
            try:
                from app.core.safe_http import SafeHttpClient
                safe_client = SafeHttpClient(connect_timeout=10.0, read_timeout=120.0)
                resp = safe_client.get(file_url)
                resp.raise_for_status()
                return resp.content
            except Exception as exc:
                import structlog
                structlog.get_logger(__name__).warning(
                    "fetch_bytes_url_failed", file_url=file_url, error=str(exc)
                )

        return None

    # ── GPU / device helpers ──────────────────────────────────────────────────

    @staticmethod
    def _resolve_device(config: TrainingConfig) -> str:
        """Resolve 'auto' / 'mps' to an actual device string."""
        device = config.device
        if device == "auto":
            try:
                import torch
                if torch.cuda.is_available():
                    return "cuda"
                if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    return "mps"
            except ImportError:
                pass
            return "cpu"
        return device

    def log_device_info(self, config: TrainingConfig) -> None:
        """Log GPU name, VRAM, CUDA version (no-op if CUDA unavailable)."""
        import structlog
        _log = structlog.get_logger(self.__class__.__name__)
        try:
            import torch
            if torch.cuda.is_available():
                idx = 0
                props = torch.cuda.get_device_properties(idx)
                _log.info(
                    "gpu_info",
                    device=config.device,
                    gpu_name=props.name,
                    total_vram_gb=round(props.total_memory / 1e9, 2),
                    cuda_version=torch.version.cuda,
                    cudnn_version=torch.backends.cudnn.version(),
                )
            else:
                _log.info("device_info", device="cpu", note="CUDA not available")
        except Exception:
            pass

    def move_to_device(self, obj: Any, config: TrainingConfig) -> Any:
        """Move a torch tensor or nn.Module to config.device. No-op for other types."""
        try:
            import torch
            device = self._resolve_device(config)
            if isinstance(obj, (torch.Tensor, torch.nn.Module)):
                return obj.to(device)
        except ImportError:
            pass
        return obj

    def optimize_model(self, model: Any, config: TrainingConfig) -> Any:
        """
        Apply device placement + optional torch.compile + DataParallel for multi-GPU.

        Returns the optimised model (or original if not a torch Module).
        """
        try:
            import torch
            device = self._resolve_device(config)
            if not isinstance(model, torch.nn.Module):
                return model
            model = model.to(device)
            # Multi-GPU via DataParallel
            if device.startswith("cuda") and torch.cuda.device_count() > 1:
                model = torch.nn.DataParallel(model)
            # torch.compile (PyTorch 2.0+) — skip on MPS / non-CUDA to avoid issues
            if device.startswith("cuda") and hasattr(torch, "compile"):
                try:
                    model = torch.compile(model)
                except Exception:
                    pass
        except ImportError:
            pass
        return model

    def get_amp_context(self, config: TrainingConfig):
        """
        Return a torch.autocast context manager when mixed precision is enabled,
        otherwise a no-op nullcontext.

        Usage:
            with self.get_amp_context(config):
                outputs = model(inputs)
        """
        device = self._resolve_device(config)
        mp = config.mixed_precision
        if mp == "auto":
            mp = "fp16" if (config.fp16 or device.startswith("cuda")) else "no"

        try:
            import torch
            if mp in ("fp16", "bf16") and device.startswith("cuda"):
                dtype = torch.float16 if mp == "fp16" else torch.bfloat16
                return torch.autocast(device_type="cuda", dtype=dtype)
        except ImportError:
            pass
        return contextlib.nullcontext()

    def get_grad_scaler(self, config: TrainingConfig):
        """
        Return a torch.cuda.amp.GradScaler for fp16 training, or a no-op scaler.

        The no-op scaler has the same interface (scaler.scale, scaler.step,
        scaler.update) so training loops don't need branches.
        """
        device = self._resolve_device(config)
        mp = config.mixed_precision
        if mp == "auto":
            mp = "fp16" if (config.fp16 or device.startswith("cuda")) else "no"
        try:
            import torch
            if mp == "fp16" and device.startswith("cuda"):
                return torch.cuda.amp.GradScaler()
        except ImportError:
            pass
        return _NullGradScaler()

    # ── Optimiser / scheduler factories ──────────────────────────────────────

    def build_optimizer(self, params, config: TrainingConfig):
        """
        Build a PyTorch optimizer from config.optimizer.

        Supported: adam, adamw, sgd, rmsprop, adagrad
        """
        try:
            import torch.optim as optim
            lr = config.learning_rate
            wd = config.weight_decay
            name = config.optimizer.lower()
            if name == "adam":
                return optim.Adam(params, lr=lr, weight_decay=wd)
            if name == "adamw":
                return optim.AdamW(params, lr=lr, weight_decay=wd)
            if name == "sgd":
                return optim.SGD(params, lr=lr, weight_decay=wd, momentum=0.9)
            if name == "rmsprop":
                return optim.RMSprop(params, lr=lr, weight_decay=wd)
            if name == "adagrad":
                return optim.Adagrad(params, lr=lr, weight_decay=wd)
            raise ValueError(f"Unknown optimizer '{name}'. Choose: adam, adamw, sgd, rmsprop, adagrad")
        except ImportError as e:
            raise ImportError("PyTorch is required for build_optimizer") from e

    def build_scheduler(self, optimizer, config: TrainingConfig, num_steps: int):
        """
        Build a PyTorch LR scheduler from config.lr_scheduler.

        Supported: cosine, linear, step, plateau, none
        num_steps: total number of optimiser steps (epochs × batches_per_epoch).
        """
        try:
            import torch.optim.lr_scheduler as lr_sched
            from torch.optim.lr_scheduler import LinearLR, CosineAnnealingLR, ReduceLROnPlateau
            name = config.lr_scheduler.lower()
            warmup = max(1, int(num_steps * config.warmup_ratio))

            if name == "none":
                return lr_sched.LambdaLR(optimizer, lambda _: 1.0)
            if name == "cosine":
                return CosineAnnealingLR(optimizer, T_max=max(1, num_steps - warmup))
            if name == "linear":
                return LinearLR(optimizer, start_factor=1.0, end_factor=0.0, total_iters=num_steps)
            if name == "step":
                return lr_sched.StepLR(optimizer, step_size=max(1, num_steps // 3))
            if name == "plateau":
                return ReduceLROnPlateau(optimizer, patience=config.early_stopping_patience)
            raise ValueError(f"Unknown lr_scheduler '{name}'. Choose: cosine, linear, step, plateau, none")
        except ImportError as e:
            raise ImportError("PyTorch is required for build_scheduler") from e

    # ── DataLoader builder ────────────────────────────────────────────────────

    def build_dataloader(
        self,
        dataset: Any,
        config: TrainingConfig,
        shuffle: bool = True,
        drop_last: bool = False,
    ):
        """
        Build a GPU-optimized torch DataLoader with pin_memory and prefetch.

        Pin memory is only applied when device is CUDA (silently ignored on CPU/MPS).
        """
        try:
            import multiprocessing
            from torch.utils.data import DataLoader
            device = self._resolve_device(config)
            pin = config.dataloader_pin_memory and device.startswith("cuda")
            # Celery workers are daemonic processes — daemonic processes cannot
            # spawn children, so num_workers must be 0 inside a worker process.
            current = multiprocessing.current_process()
            effective_workers = 0 if getattr(current, "daemon", False) else config.workers
            return DataLoader(
                dataset,
                batch_size=config.batch_size,
                shuffle=shuffle,
                num_workers=effective_workers,
                pin_memory=pin,
                prefetch_factor=config.prefetch_factor if effective_workers > 0 else None,
                drop_last=drop_last,
                persistent_workers=effective_workers > 0,
            )
        except ImportError as e:
            raise ImportError("PyTorch is required for build_dataloader") from e

    # ── Auto-training helpers ─────────────────────────────────────────────────

    def auto_train_tabular(
        self,
        df: Any,
        label_col: str,
        config: TrainingConfig,
        feature_cols: Optional[List[str]] = None,
        estimators: Optional[List[Any]] = None,
    ) -> Tuple[Any, Tuple]:
        """
        Automatic tabular training pipeline.

        Given a DataFrame + label column, this method:
          1. Splits data (train/test using config.test_split, seeded with config.random_seed)
          2. Auto-encodes categoricals (LabelEncoder / OrdinalEncoder)
          3. Tries a configurable set of estimators (defaults: RF + GBM + LR)
          4. Picks the best by cross-validation score on train split
          5. Returns (best_model, (X_test, y_test)) for auto-evaluation

        Usage in train():
            def train(self, preprocessed, config):
                return self.auto_train_tabular(preprocessed, "churn", config)
        """
        import numpy as np
        try:
            import pandas as pd
            from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingClassifier, GradientBoostingRegressor
            from sklearn.linear_model import LogisticRegression, Ridge
            from sklearn.preprocessing import OrdinalEncoder, StandardScaler
            from sklearn.pipeline import Pipeline
            from sklearn.compose import ColumnTransformer
            from sklearn.model_selection import cross_val_score
        except ImportError as e:
            raise ImportError("scikit-learn and pandas are required for auto_train_tabular") from e

        if feature_cols:
            cols = feature_cols
        else:
            cols = [c for c in df.columns if c != label_col]

        X = df[cols]
        y = df[label_col]

        # Detect task if not set
        task = config.task
        n_unique = y.nunique() if hasattr(y, "nunique") else len(set(y))
        if task == "classification" and n_unique <= 1:
            raise ValueError("Label column has only 1 unique value — check your data.")
        is_classification = task in ("classification", "nlp_classification") or (
            task == "custom" and n_unique <= 20
        )

        # Identify categorical vs numeric columns
        cat_cols = X.select_dtypes(include=["object", "category"]).columns.tolist()
        num_cols = [c for c in X.columns if c not in cat_cols]

        # Use INTEGER column positions (not string names) so the fitted Pipeline
        # also accepts plain numpy arrays at predict() time.  String selectors in
        # ColumnTransformer only work when the input is a DataFrame, which causes
        # "Specifying the columns using strings is only supported for dataframes"
        # whenever predict() receives a numpy array.
        num_idx = [cols.index(c) for c in num_cols if c in cols]
        cat_idx = [cols.index(c) for c in cat_cols if c in cols]

        transformers = []
        if num_idx:
            transformers.append(("num", StandardScaler(), num_idx))
        if cat_idx:
            transformers.append(("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), cat_idx))
        preprocessor = ColumnTransformer(transformers, remainder="passthrough")

        if estimators is None:
            import multiprocessing as _mp
            _daemon = getattr(_mp.current_process(), "daemon", False)
            # Daemonic Celery workers cannot spawn child processes — force n_jobs=1
            _n_jobs = 1 if _daemon else config.workers
            if is_classification:
                estimators = [
                    RandomForestClassifier(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed),
                    GradientBoostingClassifier(n_estimators=200, random_state=config.random_seed),
                    LogisticRegression(max_iter=500, random_state=config.random_seed),
                ]
                # Try XGBoost / LightGBM if available
                try:
                    from xgboost import XGBClassifier
                    estimators.append(XGBClassifier(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed, verbosity=0, use_label_encoder=False, eval_metric="logloss"))
                except ImportError:
                    pass
                try:
                    from lightgbm import LGBMClassifier
                    estimators.append(LGBMClassifier(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed, verbose=-1))
                except ImportError:
                    pass
            else:
                estimators = [
                    RandomForestRegressor(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed),
                    GradientBoostingRegressor(n_estimators=200, random_state=config.random_seed),
                    Ridge(alpha=1.0),
                ]
                try:
                    from xgboost import XGBRegressor
                    estimators.append(XGBRegressor(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed, verbosity=0))
                except ImportError:
                    pass
                try:
                    from lightgbm import LGBMRegressor
                    estimators.append(LGBMRegressor(n_estimators=200, n_jobs=_n_jobs, random_state=config.random_seed, verbose=-1))
                except ImportError:
                    pass

        df_train, _, df_test = self.split_dataframe(df, label_col, config)
        X_train = df_train[cols]
        y_train = df_train[label_col]
        X_test  = df_test[cols]
        y_test  = df_test[label_col]

        scoring = "f1_weighted" if is_classification else "r2"
        best_score = -float("inf")
        best_pipeline = None

        for est in estimators:
            pipe = Pipeline([("prep", preprocessor), ("model", est)])
            try:
                scores = cross_val_score(pipe, X_train, y_train, cv=3, scoring=scoring, n_jobs=1)
                mean_score = float(np.mean(scores))
                if mean_score > best_score:
                    best_score = mean_score
                    best_pipeline = pipe
            except Exception:
                continue

        if best_pipeline is None:
            # Fallback — fit first estimator without CV
            best_pipeline = Pipeline([("prep", preprocessor), ("model", estimators[0])])

        best_pipeline.fit(X_train, y_train)
        return best_pipeline, (X_test, y_test)

    def auto_train_torch(
        self,
        model: Any,
        train_loader: Any,
        config: TrainingConfig,
        val_loader: Optional[Any] = None,
        loss_fn: Optional[Any] = None,
    ) -> Any:
        """
        Full PyTorch training loop with:
          - GPU placement + optional DataParallel + torch.compile
          - Mixed precision (fp16/bf16) via torch.autocast
          - GradScaler for fp16
          - Gradient clipping
          - LR scheduling (cosine / linear / step / plateau)
          - Early stopping on val loss
          - Progress logging every 10% of steps

        Returns the trained model (moved back to CPU for serialisation).

        Usage in train():
            def train(self, preprocessed, config):
                train_ds, val_ds = ...
                model = MyNet(...)
                return self.auto_train_torch(model,
                    self.build_dataloader(train_ds, config),
                    config,
                    val_loader=self.build_dataloader(val_ds, config, shuffle=False))
        """
        import torch
        import torch.nn as nn
        import structlog

        _log = structlog.get_logger(self.__class__.__name__)
        device = self._resolve_device(config)
        self.log_device_info(config)

        model = self.optimize_model(model, config)
        optimizer = self.build_optimizer(model.parameters(), config)
        total_steps = config.max_epochs * len(train_loader)
        scheduler = self.build_scheduler(optimizer, config, total_steps)
        scaler = self.get_grad_scaler(config)
        amp_ctx = self.get_amp_context(config)

        if loss_fn is None:
            if config.task in ("classification", "nlp_classification"):
                loss_fn = nn.CrossEntropyLoss()
            elif config.task == "regression":
                loss_fn = nn.MSELoss()
            else:
                loss_fn = nn.CrossEntropyLoss()
        loss_fn = loss_fn.to(device) if hasattr(loss_fn, "to") else loss_fn

        best_val_loss = float("inf")
        patience_ctr = 0
        best_state = None
        log_every = max(1, total_steps // 10)
        step = 0

        for epoch in range(1, config.max_epochs + 1):
            model.train()
            epoch_loss = 0.0

            for batch in train_loader:
                optimizer.zero_grad()
                # Support (X, y) tuples or dict batches
                if isinstance(batch, (list, tuple)) and len(batch) == 2:
                    inputs, targets = batch
                    inputs = self.move_to_device(inputs, config)
                    targets = self.move_to_device(targets, config)
                    with amp_ctx:
                        outputs = model(inputs)
                        loss = loss_fn(outputs, targets)
                elif isinstance(batch, dict):
                    batch = {k: self.move_to_device(v, config) for k, v in batch.items()}
                    with amp_ctx:
                        outputs = model(**batch)
                        loss = outputs.loss if hasattr(outputs, "loss") else outputs[0]
                else:
                    raise ValueError(f"Unsupported batch type: {type(batch)}")

                _do_backward_step(loss, optimizer, scaler, config)
                step += 1
                epoch_loss += loss.item()

                if step % log_every == 0:
                    _log.info("training_step", epoch=epoch, step=step, loss=round(loss.item(), 5))

            # Validation
            val_loss = None
            if val_loader is not None:
                model.eval()
                total_val = 0.0
                with torch.no_grad():
                    for batch in val_loader:
                        if isinstance(batch, (list, tuple)) and len(batch) == 2:
                            inputs, targets = batch
                            inputs = self.move_to_device(inputs, config)
                            targets = self.move_to_device(targets, config)
                            with amp_ctx:
                                outputs = model(inputs)
                                total_val += loss_fn(outputs, targets).item()
                        elif isinstance(batch, dict):
                            batch = {k: self.move_to_device(v, config) for k, v in batch.items()}
                            with amp_ctx:
                                outputs = model(**batch)
                                total_val += (outputs.loss if hasattr(outputs, "loss") else outputs[0]).item()
                val_loss = total_val / max(1, len(val_loader))

                if config.lr_scheduler == "plateau":
                    scheduler.step(val_loss)
                else:
                    scheduler.step()

                _log.info("epoch_end", epoch=epoch, train_loss=round(epoch_loss / len(train_loader), 5), val_loss=round(val_loss, 5))

                if config.early_stopping:
                    if val_loss < best_val_loss:
                        best_val_loss = val_loss
                        patience_ctr = 0
                        best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
                    else:
                        patience_ctr += 1
                        if patience_ctr >= config.early_stopping_patience:
                            _log.info("early_stopping", epoch=epoch, best_val_loss=round(best_val_loss, 5))
                            break
            else:
                if config.lr_scheduler != "plateau":
                    scheduler.step()

        if best_state is not None:
            model.load_state_dict(best_state)

        # Return model on CPU so it can be serialised without GPU
        return model.cpu() if hasattr(model, "cpu") else model

    # ── Output normalisation ──────────────────────────────────────────────────

    def normalize_output(self, raw: Any) -> Any:
        """
        Convert numpy arrays, torch tensors, and similar types to JSON-serialisable
        Python primitives. Dicts and lists are processed recursively.
        """
        try:
            import numpy as np
            if isinstance(raw, np.ndarray):
                return raw.tolist()
            if isinstance(raw, np.integer):
                return int(raw)
            if isinstance(raw, np.floating):
                return float(raw)
        except ImportError:
            pass
        try:
            import torch
            if isinstance(raw, torch.Tensor):
                return raw.detach().cpu().numpy().tolist()
        except ImportError:
            pass
        if isinstance(raw, dict):
            return {k: self.normalize_output(v) for k, v in raw.items()}
        if isinstance(raw, (list, tuple)):
            return [self.normalize_output(v) for v in raw]
        return raw

    # ── Internal helpers (do not override) ───────────────────────────────────

    @classmethod
    def trainer_name(cls) -> str:
        return getattr(cls, "name", cls.__name__.lower())

    @classmethod
    def to_dict(cls) -> Dict:
        return {
            "name": cls.trainer_name(),
            "version": getattr(cls, "version", "1.0.0"),
            "description": getattr(cls, "description", ""),
            "framework": getattr(cls, "framework", "custom"),
            "schedule": getattr(cls, "schedule", None),
            "data_source": getattr(cls, "data_source", None) and
                           cls.data_source.describe() if hasattr(cls, "data_source") else {},
            "tags": getattr(cls, "tags", {}),
            "input_schema": getattr(cls, "input_schema", {}),
            "output_schema": getattr(cls, "output_schema", {}),
            "output_display": [s.to_dict() for s in getattr(cls, "output_display", [])],
            "derived_metrics": [m.to_dict() for m in getattr(cls, "derived_metrics", [])],
        }


# ── Null GradScaler (no-op for CPU / non-fp16 training) ───────────────────────

class _NullGradScaler:
    """Drop-in GradScaler that does nothing — lets training loops stay branch-free."""

    def scale(self, loss):
        return loss

    def step(self, optimizer):
        optimizer.step()

    def update(self):
        pass

    def unscale_(self, optimizer):
        pass


# ── Backward pass helper ───────────────────────────────────────────────────────

def _do_backward_step(loss, optimizer, scaler, config: "TrainingConfig") -> None:
    """Perform loss.backward() + optional gradient clip + optimizer.step()."""
    try:
        import torch
        scaler.scale(loss).backward()
        if config.gradient_clip > 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(
                [p for group in optimizer.param_groups for p in group["params"]],
                config.gradient_clip,
            )
        scaler.step(optimizer)
        scaler.update()
    except Exception:
        # Fallback for non-torch losses (e.g. numpy-based)
        try:
            loss.backward()
        except AttributeError:
            pass
        optimizer.step()
