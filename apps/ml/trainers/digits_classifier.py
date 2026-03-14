"""
Digits classifier — recognises handwritten digits 0–9 using sklearn's built-in dataset.

Each sample is an 8×8 grayscale image (64 pixel values, 0–16 intensity).
Demonstrates image-like tabular input with many features.

Train:
    POST /api/v1/training/start
    { "trainer_name": "digits_classifier" }

Inference:
    POST /api/v1/inference/digits_classifier
    { "inputs": { "pixel_0_0": 0, "pixel_0_1": 5, ... "pixel_7_7": 0 } }

Or pass a flat list of 64 values:
    { "inputs": [[0, 5, 13, 9, 1, 0, 0, 0, ...]] }
"""
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import InMemoryDataSource

_CLASS_NAMES = [str(i) for i in range(10)]   # "0" … "9"

# 8×8 grid → 64 pixel feature names
_FEATURE_ORDER = [f"pixel_{r}_{c}" for r in range(8) for c in range(8)]


def _pixel_schema(name: str, row: int, col: int) -> dict:
    return {
        "type": "number",
        "label": f"Pixel ({row},{col})",
        "description": f"Grayscale intensity of pixel at row {row}, column {col}.",
        "required": True,
        "min": 0, "max": 16, "step": 1,
        "default": 0,
        "example": f"0–16 intensity value",
    }


class DigitsClassifier(BaseTrainer):
    name = "digits_classifier"
    version = "1.0.0"
    description = "Recognises handwritten digits (0–9) trained on sklearn's 8×8 pixel Digits dataset"
    framework = "sklearn"
    schedule = None
    data_source = InMemoryDataSource()
    category = {"key": "classification", "label": "Classification"}

    input_schema = {
        name: _pixel_schema(name, r, c)
        for name, (r, c) in zip(
            _FEATURE_ORDER,
            [(r, c) for r in range(8) for c in range(8)],
        )
    }

    output_schema = {
        "predicted_digit": {
            "type": "text",
            "label": "Predicted Digit",
            "description": "The digit the model thinks was written (0–9).",
            "editable": True,
            "example": "7",
        },
        "confidence": {
            "type": "number",
            "label": "Confidence",
            "format": "percent",
            "description": "Probability assigned to the top prediction (0–100%).",
            "example": 0.98,
        },
        "probabilities": {
            "type": "json",
            "label": "Class Probabilities",
            "description": "Probability for each digit class (sums to 1.0).",
            "example": {"0": 0.01, "1": 0.0, "2": 0.0, "7": 0.98, "9": 0.01},
        },
    }

    def preprocess(self, raw_data):
        from sklearn.datasets import load_digits
        import pandas as pd
        digits = load_digits()
        df = pd.DataFrame(digits.data, columns=_FEATURE_ORDER)
        df["digit"] = digits.target
        return df

    def train(self, preprocessed, config: TrainingConfig):
        return self.auto_train_tabular(preprocessed, label_col="digit", config=config)

    def predict(self, model, inputs):
        import numpy as np
        if isinstance(inputs, dict):
            row = [float(inputs.get(f, 0.0)) for f in _FEATURE_ORDER]
            arr = np.array([row])
        else:
            arr = np.array(inputs)

        pred_idx = int(model.predict(arr)[0])
        proba = model.predict_proba(arr)[0].tolist()
        return {
            "predicted_digit": _CLASS_NAMES[pred_idx] if pred_idx < len(_CLASS_NAMES) else str(pred_idx),
            "confidence": round(proba[pred_idx], 4),
            "probabilities": {name: round(p, 4) for name, p in zip(_CLASS_NAMES, proba)},
        }

    def evaluate(self, model, test_data):
        from sklearn.metrics import accuracy_score, f1_score
        X_te, y_te = test_data
        y_pred = model.predict(X_te)
        y_true = y_te.tolist() if hasattr(y_te, "tolist") else list(y_te)
        y_pred = y_pred.tolist() if hasattr(y_pred, "tolist") else list(y_pred)
        return EvaluationResult(
            accuracy=accuracy_score(y_true, y_pred),
            f1=f1_score(y_true, y_pred, average="macro"),
            y_true=y_true,
            y_pred=y_pred,
        )

    def get_class_names(self):
        return _CLASS_NAMES

    def get_feature_names(self):
        return _FEATURE_ORDER

    def get_input_example(self):
        import pandas as pd
        from sklearn.datasets import load_digits
        digits = load_digits()
        # Use the first sample as the input example
        return pd.DataFrame([digits.data[0]], columns=_FEATURE_ORDER)
