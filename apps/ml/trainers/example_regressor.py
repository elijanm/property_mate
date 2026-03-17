"""
Example regression trainer — predicts monthly rent based on property attributes.

Demonstrates:
  - auto_train_tabular() one-liner for regression
  - Per-field input_schema with ranges and units
  - output_schema with formatted numeric outputs
  - Custom evaluate() using MSE / MAE / R²

Trigger training:
    POST /api/v1/training/start
    { "trainer_name": "rent_predictor" }

Run inference:
    POST /api/v1/inference/rent_predictor
    {
        "inputs": {
            "bedrooms": 2,
            "bathrooms": 1,
            "floor_area_sqm": 75,
            "floor_number": 3,
            "has_parking": 1,
            "has_balcony": 0,
            "distance_to_cbd_km": 5.2
        }
    }
"""
import io
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import InMemoryDataSource


class RentPredictor(BaseTrainer):
    name = "rent_predictor"
    version = "1.0.0"
    description = "Predicts monthly rent (KES) from unit attributes using gradient boosting + RandomForest auto-selection"
    framework = "sklearn"
    schedule = None
    data_source = InMemoryDataSource()
    category = {"key": "regression", "label": "Regression"}

    output_display = [
        OutputFieldSpec("predicted_rent_kes", "reading", "Predicted Rent (KES)", primary=True,
                        hint="Enter the actual monthly rent in KES"),
        OutputFieldSpec("rent_range_low",     "reading", "Range Low (KES)"),
        OutputFieldSpec("rent_range_high",    "reading", "Range High (KES)"),
    ]

    input_schema = {
        "bedrooms": {
            "type": "number",
            "label": "Bedrooms",
            "description": "Number of bedrooms in the unit.",
            "required": True,
            "min": 0, "max": 10, "step": 1,
            "default": 2,
        },
        "bathrooms": {
            "type": "number",
            "label": "Bathrooms",
            "description": "Number of bathrooms.",
            "required": True,
            "min": 0, "max": 6, "step": 1,
            "default": 1,
        },
        "floor_area_sqm": {
            "type": "number",
            "label": "Floor Area",
            "unit": "m²",
            "description": "Total floor area in square metres.",
            "required": True,
            "min": 10, "max": 500, "step": 1,
            "default": 75,
        },
        "floor_number": {
            "type": "number",
            "label": "Floor Number",
            "description": "Floor the unit is on (0 = ground).",
            "required": False,
            "min": 0, "max": 50, "step": 1,
            "default": 2,
        },
        "has_parking": {
            "type": "number",
            "label": "Has Parking",
            "description": "1 if unit includes a parking bay, 0 otherwise.",
            "required": False,
            "min": 0, "max": 1, "step": 1,
            "default": 0,
        },
        "has_balcony": {
            "type": "number",
            "label": "Has Balcony",
            "description": "1 if unit has a balcony, 0 otherwise.",
            "required": False,
            "min": 0, "max": 1, "step": 1,
            "default": 0,
        },
        "distance_to_cbd_km": {
            "type": "number",
            "label": "Distance to CBD",
            "unit": "km",
            "description": "Road distance to the central business district.",
            "required": False,
            "min": 0.1, "max": 100, "step": 0.1,
            "default": 5.0,
        },
    }

    output_schema = {
        "predicted_rent_kes": {
            "type": "number",
            "label": "Predicted Rent (KES/mo)",
            "description": "Estimated monthly rent in Kenyan Shillings.",
            "editable": True,
            "format": "integer",
        },
        "rent_range_low": {
            "type": "number",
            "label": "Range Low",
            "description": "Lower bound of estimated rent (±10%).",
            "format": "integer",
        },
        "rent_range_high": {
            "type": "number",
            "label": "Range High",
            "description": "Upper bound of estimated rent (±10%).",
            "format": "integer",
        },
    }

    _FEATURE_ORDER = [
        "bedrooms", "bathrooms", "floor_area_sqm", "floor_number",
        "has_parking", "has_balcony", "distance_to_cbd_km",
    ]

    def preprocess(self, raw_data):
        """Build a synthetic rent dataset for demonstration."""
        import numpy as np
        import pandas as pd

        rng = np.random.RandomState(42)
        n = 2000

        bedrooms        = rng.randint(0, 6, n)
        bathrooms       = np.clip(bedrooms + rng.randint(-1, 2, n), 0, 5)
        floor_area      = 20 + bedrooms * 18 + rng.normal(0, 10, n)
        floor_number    = rng.randint(0, 20, n)
        has_parking     = (rng.random(n) > 0.5).astype(int)
        has_balcony     = (rng.random(n) > 0.6).astype(int)
        dist_cbd        = rng.exponential(8, n).clip(0.5, 60)

        # Synthetic rent formula (KES)
        rent = (
            8000
            + bedrooms * 5000
            + bathrooms * 2000
            + floor_area * 120
            + floor_number * 200
            + has_parking * 3500
            + has_balcony * 1500
            - dist_cbd * 400
            + rng.normal(0, 3000, n)
        ).clip(5000, 200000)

        df = pd.DataFrame({
            "bedrooms":          bedrooms,
            "bathrooms":         bathrooms,
            "floor_area_sqm":    floor_area.round(1),
            "floor_number":      floor_number,
            "has_parking":       has_parking,
            "has_balcony":       has_balcony,
            "distance_to_cbd_km": dist_cbd.round(2),
            "monthly_rent_kes":  rent.round(-2),   # round to nearest 100
        })
        return df

    def train(self, preprocessed, config: TrainingConfig):
        config.task = "regression"
        return self.auto_train_tabular(
            preprocessed,
            label_col="monthly_rent_kes",
            config=config,
            feature_cols=self._FEATURE_ORDER,
        )

    def predict(self, model, inputs):
        import numpy as np

        if isinstance(inputs, dict):
            row = {f: float(inputs.get(f, 0)) for f in self._FEATURE_ORDER}
        else:
            row = {f: float(v) for f, v in zip(self._FEATURE_ORDER, inputs)}

        import pandas as pd
        df_in = pd.DataFrame([row])
        pred = float(model.predict(df_in)[0])
        pred_rounded = round(pred / 100) * 100

        return {
            "predicted_rent_kes": int(pred_rounded),
            "rent_range_low":     int(pred_rounded * 0.90),
            "rent_range_high":    int(pred_rounded * 1.10),
        }

    def evaluate(self, model, test_data):
        from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
        import numpy as np

        X_test, y_test = test_data
        y_pred = model.predict(X_test)

        return EvaluationResult(
            mse=float(mean_squared_error(y_test, y_pred)),
            mae=float(mean_absolute_error(y_test, y_pred)),
            r2=float(r2_score(y_test, y_pred)),
        )

    def get_feature_names(self):
        return self._FEATURE_ORDER
