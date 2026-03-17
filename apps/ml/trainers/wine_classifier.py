"""
Wine variety classifier — identifies wine cultivar (3 classes) from chemical analysis.

Uses sklearn's built-in Wine dataset: 178 samples, 13 numeric features,
3 target classes representing three cultivars grown in the same Italian region.

Train:
    POST /api/v1/training/start
    { "trainer_name": "wine_classifier" }

Inference:
    POST /api/v1/inference/wine_classifier
    {
        "inputs": {
            "alcohol": 13.2,
            "malic_acid": 1.78,
            "ash": 2.14,
            "alcalinity_of_ash": 11.2,
            "magnesium": 100.0,
            "total_phenols": 2.65,
            "flavanoids": 2.76,
            "nonflavanoid_phenols": 0.26,
            "proanthocyanins": 1.28,
            "color_intensity": 4.38,
            "hue": 1.05,
            "od280_od315_of_diluted_wines": 3.40,
            "proline": 1050.0
        }
    }
"""
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import InMemoryDataSource

_CLASS_NAMES = ["Cultivar A", "Cultivar B", "Cultivar C"]

_FEATURE_ORDER = [
    "alcohol", "malic_acid", "ash", "alcalinity_of_ash", "magnesium",
    "total_phenols", "flavanoids", "nonflavanoid_phenols", "proanthocyanins",
    "color_intensity", "hue", "od280_od315_of_diluted_wines", "proline",
]

_FEATURE_META = {
    "alcohol":                      ("Alcohol",                       "%",    11.0, 15.0, 0.1,  13.0),
    "malic_acid":                   ("Malic Acid",                    "g/L",  0.7,  6.0,  0.1,  2.3),
    "ash":                          ("Ash",                           "g/L",  1.3,  3.2,  0.1,  2.4),
    "alcalinity_of_ash":            ("Alcalinity of Ash",             "meq/L",10.0, 30.0, 0.5,  19.5),
    "magnesium":                    ("Magnesium",                     "mg/L", 70.0, 162.0,1.0,  100.0),
    "total_phenols":                ("Total Phenols",                 "mg/L", 0.9,  4.0,  0.1,  2.3),
    "flavanoids":                   ("Flavanoids",                    "mg/L", 0.3,  5.1,  0.1,  2.0),
    "nonflavanoid_phenols":         ("Non-Flavanoid Phenols",         "mg/L", 0.1,  0.7,  0.01, 0.36),
    "proanthocyanins":              ("Proanthocyanins",               "mg/L", 0.4,  3.6,  0.1,  1.6),
    "color_intensity":              ("Color Intensity",               "",     1.3,  13.0, 0.1,  5.1),
    "hue":                          ("Hue",                           "",     0.5,  1.7,  0.01, 0.96),
    "od280_od315_of_diluted_wines": ("OD280/OD315 Diluted Wines",    "",     1.3,  4.0,  0.1,  2.6),
    "proline":                      ("Proline",                       "mg/L", 278.0,1680.0,10.0, 746.0),
}


def _field_schema(key: str) -> dict:
    label, unit, mn, mx, step, default = _FEATURE_META[key]
    unit_str = f" ({unit})" if unit else ""
    return {
        "type": "number",
        "label": label,
        "unit": unit,
        "description": f"{label}{unit_str} measured from the wine sample.",
        "required": True,
        "min": mn, "max": mx, "step": step,
        "default": default,
        "example": f"{default} — typical value",
    }


class WineClassifier(BaseTrainer):
    name = "wine_classifier"
    version = "1.0.0"
    description = "Classifies wine cultivar (A/B/C) from 13 chemical properties using sklearn's Wine dataset"
    framework = "sklearn"
    schedule = None
    data_source = InMemoryDataSource()
    category = {"key": "classification", "label": "Classification"}

    output_display = [
        OutputFieldSpec("predicted_cultivar", "label",      "Predicted Cultivar", primary=True,
                        hint="Enter the correct cultivar name (A, B, or C)"),
        OutputFieldSpec("confidence",         "confidence", "Confidence"),
        OutputFieldSpec("probabilities",      "json",       "Class Probabilities"),
    ]

    input_schema = {key: _field_schema(key) for key in _FEATURE_ORDER}

    output_schema = {
        "predicted_cultivar": {
            "type": "text",
            "label": "Predicted Cultivar",
            "description": "One of: Cultivar A · Cultivar B · Cultivar C",
            "editable": True,
            "example": "Cultivar A",
        },
        "confidence": {
            "type": "number",
            "label": "Confidence",
            "format": "percent",
            "description": "Probability assigned to the top prediction (0–100%).",
            "example": 0.96,
        },
        "probabilities": {
            "type": "json",
            "label": "Class Probabilities",
            "description": "Probability breakdown across all three cultivars (sums to 1.0).",
            "example": {"Cultivar A": 0.96, "Cultivar B": 0.03, "Cultivar C": 0.01},
        },
    }

    def preprocess(self, raw_data):
        from sklearn.datasets import load_wine
        import pandas as pd
        wine = load_wine()
        df = pd.DataFrame(wine.data, columns=_FEATURE_ORDER)
        df["cultivar"] = wine.target
        return df

    def train(self, preprocessed, config: TrainingConfig):
        return self.auto_train_tabular(preprocessed, label_col="cultivar", config=config)

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
            "predicted_cultivar": _CLASS_NAMES[pred_idx] if pred_idx < len(_CLASS_NAMES) else str(pred_idx),
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
        from sklearn.datasets import load_wine
        wine = load_wine()
        return pd.DataFrame([wine.data[0]], columns=_FEATURE_ORDER)
