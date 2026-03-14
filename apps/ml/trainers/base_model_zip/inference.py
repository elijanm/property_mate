"""
inference.py — ZIP-deploy entry point template.

Copy this file into your model ZIP alongside manifest.json and your model artifact.
Rename the class (e.g. MyClassifier) and implement load_context() + predict().

────────────────────────────────────────────────────────────────────
Artifacts available in load_context()
────────────────────────────────────────────────────────────────────
    context.artifacts["model_file"]          ← primary model (manifest "model_file")
    context.artifacts["scaler"]              ← artifacts/scaler.pkl
    context.artifacts["label_map"]           ← artifacts/label_map.json
    context.artifacts["vocab/tokens"]        ← artifacts/vocab/tokens.json

────────────────────────────────────────────────────────────────────
Inference API
────────────────────────────────────────────────────────────────────
    POST /api/v1/inference/<model-name>
    { "inputs": { "field": value, ... } }

model_input arrives as a plain dict (the service normalises it before calling predict).

────────────────────────────────────────────────────────────────────
Returning results
────────────────────────────────────────────────────────────────────
Return any JSON-serialisable value: dict, list, str, number.
Use keys that match your manifest.json output_schema fields so the UI
renders them correctly.

For image outputs: upload to S3 and return a presigned URL under a key
that ends in _url (e.g. "annotated_url"). Keys ending in _key are stripped
from the inference log to avoid storing large paths.

────────────────────────────────────────────────────────────────────
Environment variables available at runtime
────────────────────────────────────────────────────────────────────
    S3_BUCKET, S3_ENDPOINT_URL, S3_PUBLIC_ENDPOINT_URL
    S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION
    MLFLOW_TRACKING_URI
"""
import mlflow.pyfunc


class MyModel(mlflow.pyfunc.PythonModel):

    # ─── startup ─────────────────────────────────────────────────────────────

    def load_context(self, context):
        """
        Called once when the model is loaded. Load weights + any side-car
        artifacts here. context.artifacts maps artifact keys to local paths.

        Examples
        --------
        Scikit-learn / joblib:
            import joblib
            self.model  = joblib.load(context.artifacts["model_file"])
            self.scaler = joblib.load(context.artifacts["scaler"])

        PyTorch:
            import torch
            self.model = torch.load(context.artifacts["model_file"], map_location="cpu", weights_only=False)
            self.model.eval()

        ONNX Runtime:
            import onnxruntime as ort
            self.session = ort.InferenceSession(context.artifacts["model_file"])

        HuggingFace Transformers:
            from transformers import pipeline
            self.pipe = pipeline("text-classification", model=context.artifacts["model_file"])

        YOLO (Ultralytics):
            from ultralytics import YOLO
            self.model = YOLO(context.artifacts["model_file"])

        Keras / TensorFlow:
            import keras
            self.model = keras.models.load_model(context.artifacts["model_file"])

        Label map (JSON):
            import json
            with open(context.artifacts["label_map"]) as f:
                self.labels = json.load(f)
        """
        raise NotImplementedError("Implement load_context() — see docstring for examples")

    # ─── inference ───────────────────────────────────────────────────────────

    def predict(self, context, model_input):
        """
        Run inference. model_input is a plain dict from the caller.

        Parameters
        ----------
        context     : mlflow.pyfunc.PythonModelContext
        model_input : dict  (already normalised by the service)

        Returns
        -------
        dict — keys should match your manifest.json output_schema fields.

        Examples
        --------
        Tabular / sklearn:
            import numpy as np
            features = [model_input["sepal_length"], model_input["sepal_width"],
                        model_input["petal_length"], model_input["petal_width"]]
            pred  = int(self.model.predict([features])[0])
            proba = self.model.predict_proba([features])[0].tolist()
            return {"label": self.labels[pred], "confidence": round(max(proba), 4)}

        Image / base64:
            import base64, io
            import numpy as np
            raw    = base64.b64decode(model_input["image_b64"] + "==")
            # ... decode with PIL / cv2, run model, return result dict

        Text:
            result = self.pipe(model_input["text"])[0]
            return {"label": result["label"], "confidence": round(result["score"], 4)}

        ONNX:
            import numpy as np
            inp = np.array([[model_input["x1"], model_input["x2"]]], dtype=np.float32)
            out = self.session.run(None, {self.session.get_inputs()[0].name: inp})
            return {"prediction": float(out[0][0])}
        """
        raise NotImplementedError("Implement predict() — see docstring for examples")
