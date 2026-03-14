"""
Example trainer — drop this file to show how to write a plugin.
This will be auto-discovered on service startup.

Run training via:
    POST /api/v1/training/start
    { "trainer_name": "iris_classifier" }

Then test inference via:
    POST /api/v1/inference/iris_classifier
    { "inputs": [[5.1, 3.5, 1.4, 0.2]] }
"""
import io
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import InMemoryDataSource


_FEATURE_ORDER = ["sepal_length", "sepal_width", "petal_length", "petal_width"]
_CLASS_NAMES   = ["setosa", "versicolor", "virginica"]


class IrisClassifier(BaseTrainer):
    name = "iris_classifier"
    version = "1.0.0"
    description = "Example sklearn classifier trained on the Iris dataset"
    framework = "sklearn"
    schedule = None   # manual only — set to e.g. "0 4 * * *" to run daily at 4am
    data_source = InMemoryDataSource()  # loads built-in dataset in preprocess()
    category = {"key": "classification", "label": "Classification"}

    # ── UI rendering schemas ───────────────────────────────────────────────────
    # input_schema drives the inference form in ML Studio.
    # Each field: type, label, description, unit, min/max/step, default, example.
    input_schema = {
        "sepal_length": {
            "type": "number",
            "label": "Sepal Length",
            "unit": "cm",
            "description": "The length of the outer leaf-like parts (sepals) that protect the flower bud.",
            "required": True,
            "min": 4.0, "max": 8.0, "step": 0.1,
            "default": 5.1,
            "example": "5.1 cm — typical for Iris setosa",
        },
        "sepal_width": {
            "type": "number",
            "label": "Sepal Width",
            "unit": "cm",
            "description": "The width of the sepal, measured at the widest point.",
            "required": True,
            "min": 2.0, "max": 4.5, "step": 0.1,
            "default": 3.5,
            "example": "3.5 cm — typical for Iris setosa",
        },
        "petal_length": {
            "type": "number",
            "label": "Petal Length",
            "unit": "cm",
            "description": "The length of the inner coloured petals. Key discriminating feature between species.",
            "required": True,
            "min": 1.0, "max": 7.0, "step": 0.1,
            "default": 1.4,
            "example": "1.4 cm (setosa) · 4.7 cm (versicolor) · 6.0 cm (virginica)",
        },
        "petal_width": {
            "type": "number",
            "label": "Petal Width",
            "unit": "cm",
            "description": "The width of the petal at its widest point. Strong predictor of species.",
            "required": True,
            "min": 0.1, "max": 2.5, "step": 0.1,
            "default": 0.2,
            "example": "0.2 cm (setosa) · 1.4 cm (versicolor) · 2.1 cm (virginica)",
        },
    }

    # output_schema describes what the model returns so the UI can render it correctly.
    output_schema = {
        "predicted_class": {
            "type": "text",
            "label": "Predicted Species",
            "description": "One of: setosa · versicolor · virginica",
            "editable": True,
            "example": "setosa",
        },
        "confidence": {
            "type": "number",
            "label": "Confidence",
            "format": "percent",
            "description": "Probability the model assigns to its top prediction (0–100%).",
            "example": 0.97,
        },
        "probabilities": {
            "type": "json",
            "label": "Class Probabilities",
            "description": "Probability breakdown across all three species (sums to 1.0).",
            "example": {"setosa": 0.97, "versicolor": 0.02, "virginica": 0.01},
        },
    }

    def preprocess(self, raw_data):
        from sklearn.datasets import load_iris
        import pandas as pd
        iris = load_iris()
        df = pd.DataFrame(iris.data, columns=_FEATURE_ORDER)
        df["species"] = iris.target
        return df

    def train(self, preprocessed, config: TrainingConfig):
        # auto_train_tabular handles split, encoding, multi-model selection,
        # cross-validation, and returns (best_model, (X_test, y_test))
        return self.auto_train_tabular(preprocessed, label_col="species", config=config)

    def predict(self, model, inputs):
        import numpy as np
        # Accept dict from UI schema form OR raw list/array
        if isinstance(inputs, dict):
            row = [float(inputs.get(f, 0.0)) for f in _FEATURE_ORDER]
            arr = np.array([row])
        else:
            arr = np.array(inputs)

        pred_idx = int(model.predict(arr)[0])
        proba = model.predict_proba(arr)[0].tolist()
        return {
            "predicted_class": _CLASS_NAMES[pred_idx] if pred_idx < len(_CLASS_NAMES) else str(pred_idx),
            "confidence": round(proba[pred_idx], 4),
            "probabilities": {name: round(p, 4) for name, p in zip(_CLASS_NAMES, proba)},
        }

    def evaluate(self, model, test_data):
        import numpy as np
        from sklearn.metrics import accuracy_score, f1_score
        X_te, y_te = test_data
        y_pred = model.predict(X_te)
        y_true_list = y_te.tolist() if hasattr(y_te, "tolist") else list(y_te)
        y_pred_list = y_pred.tolist() if hasattr(y_pred, "tolist") else list(y_pred)
        return EvaluationResult(
            accuracy=accuracy_score(y_true_list, y_pred_list),
            f1=f1_score(y_true_list, y_pred_list, average="macro"),
            y_true=y_true_list,
            y_pred=y_pred_list,
        )

    def get_class_names(self):
        return _CLASS_NAMES

    def get_feature_names(self):
        return _FEATURE_ORDER

    def get_input_example(self):
        # Named DataFrame → MLflow saves a column-based signature so inference
        # can accept named dicts/DataFrames without tensor encoding errors.
        import pandas as pd
        return pd.DataFrame([[5.1, 3.5, 1.4, 0.2]], columns=_FEATURE_ORDER)
