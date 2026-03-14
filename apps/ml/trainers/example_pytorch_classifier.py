"""
Example PyTorch image classifier — classifies utility meter types.

Demonstrates:
  - GPU detection + auto device placement
  - Mixed precision (fp16) via get_amp_context()
  - torch.compile + DataParallel via optimize_model()
  - build_dataloader() with pin_memory + prefetch
  - auto_train_torch() full training loop
  - gradient clipping via config.gradient_clip
  - early stopping via config.early_stopping
  - LR scheduling (cosine by default)
  - normalize_output() for inference

Trigger training:
    POST /api/v1/training/start
    {
        "trainer_name": "meter_type_classifier",
        "training_config": {
            "extra": {
                "device": "cuda",
                "batch_size": 64,
                "max_epochs": 30,
                "mixed_precision": "fp16",
                "gradient_clip": 1.0,
                "learning_rate": 0.001,
                "lr_scheduler": "cosine",
                "test_split": 0.2,
                "val_split": 0.1
            }
        }
    }

Run inference:
    POST /api/v1/inference/meter_type_classifier
    { "inputs": { "image_b64": "<base64-jpg>" } }
"""
import io
from typing import Optional
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import InMemoryDataSource


_CLASSES = ["water_meter", "electricity_meter", "gas_meter", "heat_meter"]


class MeterTypeClassifier(BaseTrainer):
    name = "meter_type_classifier"
    version = "1.0.0"
    description = "Classifies utility meter images into water / electricity / gas / heat using a ResNet18 backbone"
    framework = "pytorch"
    schedule = None
    data_source = InMemoryDataSource()
    category = {"key": "classification", "label": "Classification"}

    input_schema = {
        "image_b64": {
            "type": "image",
            "label": "Meter Image",
            "required": True,
            "description": "JPEG or PNG photo of the utility meter. The model will classify the meter type.",
        },
    }

    output_schema = {
        "label": {
            "type": "text",
            "label": "Meter Type",
            "description": "Predicted meter category.",
            "editable": True,
        },
        "confidence": {
            "type": "number",
            "label": "Confidence",
            "format": "percent",
            "description": "Model confidence for the top prediction.",
        },
        "probabilities": {
            "type": "json",
            "label": "Class Probabilities",
            "description": "Softmax probability for each meter type.",
        },
    }

    # ── preprocessing ─────────────────────────────────────────────────────────

    def preprocess(self, raw_data):
        """
        Expects raw_data to be a list of (image_bytes, label_index) tuples, or a
        path to a folder tree  class_name/image.jpg  (standard torchvision layout).

        For this demo the InMemoryDataSource returns None, so we build a tiny
        synthetic dataset of random tensors. Replace with your own data loading.
        """
        try:
            import torch
            from torch.utils.data import TensorDataset

            # Synthetic 224×224 RGB images (N=400, 100 per class)
            n_per_class = 100
            n = n_per_class * len(_CLASSES)
            images = torch.randn(n, 3, 224, 224)
            labels = torch.tensor(
                [i for i in range(len(_CLASSES)) for _ in range(n_per_class)],
                dtype=torch.long,
            )
            return TensorDataset(images, labels)
        except ImportError:
            raise ImportError("PyTorch is required for MeterTypeClassifier")

    # ── training ──────────────────────────────────────────────────────────────

    def train(self, preprocessed, config: TrainingConfig):
        import torch
        import torch.nn as nn
        from torch.utils.data import random_split

        dataset = preprocessed
        n = len(dataset)
        n_test  = max(1, int(n * config.test_split))
        n_val   = max(1, int(n * config.val_split)) if config.val_split > 0 else 0
        n_train = n - n_test - n_val

        splits = [n_train, n_val, n_test] if n_val else [n_train, n_test]
        parts = random_split(
            dataset, splits,
            generator=torch.Generator().manual_seed(config.random_seed),
        )
        train_ds, test_ds = (parts[0], parts[-1])
        val_ds  = parts[1] if n_val else None

        train_loader = self.build_dataloader(train_ds, config, shuffle=True)
        val_loader   = self.build_dataloader(val_ds, config, shuffle=False) if val_ds else None
        test_loader  = self.build_dataloader(test_ds, config, shuffle=False)

        # Build a lightweight ResNet18 — swap last FC layer for our num_classes
        try:
            from torchvision.models import resnet18, ResNet18_Weights
            model = resnet18(weights=None)
        except ImportError:
            # Fallback: tiny CNN if torchvision is unavailable
            model = _TinyCNN(num_classes=len(_CLASSES))
        else:
            model.fc = nn.Linear(model.fc.in_features, len(_CLASSES))

        # Log which device we're actually using
        self.log_device_info(config)

        # Full GPU training loop — AMP, gradient clipping, early stopping built in
        model = self.auto_train_torch(
            model,
            train_loader,
            config,
            val_loader=val_loader,
        )

        return model, test_loader

    # ── evaluation ────────────────────────────────────────────────────────────

    def evaluate(self, model, test_data):
        import torch
        import torch.nn.functional as F
        from sklearn.metrics import accuracy_score, f1_score

        test_loader = test_data
        device = self._resolve_device(TrainingConfig())   # CPU for eval

        model.eval()
        y_true, y_pred = [], []
        with torch.no_grad():
            for images, labels in test_loader:
                logits = model(images.to(device))
                preds  = logits.argmax(dim=1).cpu().tolist()
                y_pred.extend(preds)
                y_true.extend(labels.tolist())

        return EvaluationResult(
            accuracy=float(accuracy_score(y_true, y_pred)),
            f1=float(f1_score(y_true, y_pred, average="macro")),
            y_true=y_true,
            y_pred=y_pred,
        )

    # ── inference ─────────────────────────────────────────────────────────────

    def predict(self, model, inputs):
        import base64
        import torch
        import torch.nn.functional as F
        from PIL import Image

        # Accept base64 string or raw bytes
        if isinstance(inputs, dict):
            raw = inputs.get("image_b64", "")
            if isinstance(raw, str):
                img_bytes = base64.b64decode(raw + "==")
            else:
                img_bytes = raw
        else:
            img_bytes = inputs

        # Preprocess: resize + normalise
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((224, 224))
        import numpy as np
        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406])
        std  = np.array([0.229, 0.224, 0.225])
        arr  = (arr - mean) / std
        tensor = torch.tensor(arr).permute(2, 0, 1).unsqueeze(0)  # (1,3,224,224)

        model.eval()
        with torch.no_grad():
            logits = model(tensor)
            probs  = F.softmax(logits, dim=1).squeeze(0)

        pred_idx   = int(probs.argmax())
        confidence = float(probs[pred_idx])
        probabilities = {cls: round(float(p), 4) for cls, p in zip(_CLASSES, probs)}

        return {
            "label":         _CLASSES[pred_idx],
            "confidence":    round(confidence, 4),
            "probabilities": probabilities,
        }

    def get_class_names(self):
        return _CLASSES

    def get_input_example(self):
        try:
            import torch
            return torch.randn(1, 3, 224, 224)
        except ImportError:
            return None


# ── Fallback tiny CNN (when torchvision is unavailable) ───────────────────────

class _TinyCNN:
    """Minimal 3-layer CNN used when torchvision is not installed."""
    def __init__(self, num_classes=4):
        try:
            import torch.nn as nn
            super().__init__()  # type: ignore
            self.net = nn.Sequential(
                nn.Conv2d(3, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                nn.Flatten(),
                nn.Linear(32 * 56 * 56, 128), nn.ReLU(),
                nn.Linear(128, num_classes),
            )
        except ImportError:
            pass

    def __call__(self, x):
        return self.net(x)

    def parameters(self):
        return self.net.parameters()

    def eval(self):
        self.net.eval()
        return self

    def train(self, mode=True):
        self.net.train(mode)
        return self

    def to(self, device):
        self.net.to(device)
        return self

    def cpu(self):
        self.net.cpu()
        return self

    def state_dict(self):
        return self.net.state_dict()

    def load_state_dict(self, d):
        self.net.load_state_dict(d)
