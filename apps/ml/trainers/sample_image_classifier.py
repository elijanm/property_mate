"""
Sample: Image Classifier (ResNet-18 transfer learning)
======================================================
Trains a custom image classifier by fine-tuning a pretrained ResNet-18
on your own classes.

Quickstart
----------
1. Create a dataset in ML Studio with two fields:
      • image   — the photo (type: image)
      • label   — the class name, e.g. "cat", "dog" (type: text)
2. Collect at least 10 images per class (the more the better).
3. Set DATASET_ID, IMAGE_FIELD_ID, and LABEL_FIELD_ID below.
4. Click ▶ Run.

After training the model is registered in MLflow and available for
inference at  POST /api/v1/inference/image_classifier

Inference input
---------------
    { "image_url": "https://..." }

Inference output
----------------
    {
      "label":       "cat",
      "confidence":  0.97,
      "top3": [
          {"label": "cat",  "score": 0.97},
          {"label": "dog",  "score": 0.02},
          {"label": "bird", "score": 0.01}
      ]
    }
"""
# ── Configuration — edit these ─────────────────────────────────────────────────
DATASET_ID      = "PASTE_YOUR_DATASET_ID_HERE"
IMAGE_FIELD_ID  = "PASTE_IMAGE_FIELD_UUID_HERE"
LABEL_FIELD_ID  = "PASTE_LABEL_FIELD_UUID_HERE"

IMG_SIZE        = (224, 224)     # ResNet-18 expects 224×224
EPOCHS          = 10             # increase for better accuracy (try 20–30)
BATCH_SIZE      = 16
LR              = 1e-4           # learning rate for fine-tuning
FREEZE_BACKBONE = True           # True = only train the final layer (faster)
                                 # False = fine-tune all layers (slower, more accurate)
# ──────────────────────────────────────────────────────────────────────────────

import io
import os
import requests
import numpy as np
from PIL import Image

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
import torchvision.models as models
import torchvision.transforms as T

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.abstract.data_source import DatasetDataSource, InMemoryDataSource


# ── Transforms ────────────────────────────────────────────────────────────────
_TRAIN_TRANSFORM = T.Compose([
    T.RandomResizedCrop(IMG_SIZE),
    T.RandomHorizontalFlip(),
    T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])
_EVAL_TRANSFORM = T.Compose([
    T.Resize(256),
    T.CenterCrop(IMG_SIZE),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── Dataset helper ────────────────────────────────────────────────────────────
class _ImageLabelDataset(Dataset):
    def __init__(self, rows: list, class_to_idx: dict, transform):
        # rows: list of (image_url, label_str)
        self.rows = rows
        self.class_to_idx = class_to_idx
        self.transform = transform

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        url, label = self.rows[idx]
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        return self.transform(img), self.class_to_idx[label]


def _download_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


# ── Trainer ───────────────────────────────────────────────────────────────────
class SampleImageClassifier(BaseTrainer):
    name    = "image_classifier"
    version = "1.0.0"
    description = "Custom image classifier — ResNet-18 fine-tuned on your dataset"
    framework   = "pytorch"
    category    = {"key": "classification", "label": "Classification"}

    # Replace InMemoryDataSource with DatasetDataSource once you have a dataset:
    #   data_source = DatasetDataSource(dataset_id=DATASET_ID)
    data_source = InMemoryDataSource()

    input_schema = {
        "image_url": {
            "type":        "image_url",
            "label":       "Image URL",
            "description": "Publicly accessible URL of the image to classify",
            "required":    True,
            "example":     "https://upload.wikimedia.org/wikipedia/commons/4/4d/Cat_November_2010-1a.jpg",
        }
    }
    output_schema = {
        "label":      {"type": "text",   "label": "Predicted Class"},
        "confidence": {"type": "number", "label": "Confidence", "format": "percent"},
        "top3":       {"type": "json",   "label": "Top-3 Predictions"},
    }

    # ── Preprocess ─────────────────────────────────────────────────────────────
    def preprocess(self, raw: list) -> dict:
        """
        raw — list of entry dicts from DatasetDataSource.

        Returns:
            {
              "rows":         [(url, label), ...],
              "class_names":  ["cat", "dog", ...],
              "class_to_idx": {"cat": 0, "dog": 1, ...},
            }
        """
        if not raw:
            # ── Demo mode: build a tiny synthetic dataset ───────────────────
            # Replace this block with real DatasetDataSource data.
            print("[preprocess] No real data found — using synthetic demo data.")
            print("[preprocess] Set DATASET_ID and run with a real dataset for useful results.")
            return {"rows": [], "class_names": [], "class_to_idx": {}}

        # Pivot: one row per collector_id
        collector_rows: dict = {}
        for entry in raw:
            key = entry.get("collector_id") or entry.get("entry_id", "?")
            collector_rows.setdefault(key, {})
            fid = entry["field_id"]
            collector_rows[key][fid] = entry.get("text_value") or entry.get("file_url")

        rows = []
        for data in collector_rows.values():
            url   = data.get(IMAGE_FIELD_ID)
            label = str(data.get(LABEL_FIELD_ID, "")).strip().lower()
            if url and label:
                rows.append((url, label))

        if len(rows) < 2:
            raise ValueError(
                f"Only {len(rows)} labeled image(s) found. "
                "Collect at least 2 images with labels to train."
            )

        class_names  = sorted(set(r[1] for r in rows))
        class_to_idx = {c: i for i, c in enumerate(class_names)}
        print(f"[preprocess] {len(rows)} images · {len(class_names)} classes: {class_names}")
        return {"rows": rows, "class_names": class_names, "class_to_idx": class_to_idx}

    # ── Train ──────────────────────────────────────────────────────────────────
    def train(self, preprocessed: dict, config: TrainingConfig):
        rows         = preprocessed["rows"]
        class_names  = preprocessed["class_names"]
        class_to_idx = preprocessed["class_to_idx"]
        num_classes  = len(class_names)

        if not rows:
            raise ValueError("No training data — see preprocess() output above.")

        # Train / validation split (80/20)
        split = max(1, int(len(rows) * 0.8))
        train_rows, val_rows = rows[:split], rows[split:]
        print(f"[train] {len(train_rows)} train / {len(val_rows)} val images")

        train_ds = _ImageLabelDataset(train_rows, class_to_idx, _TRAIN_TRANSFORM)
        val_ds   = _ImageLabelDataset(val_rows,   class_to_idx, _EVAL_TRANSFORM)
        train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,  num_workers=0)
        val_dl   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

        # Build model
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[train] Using device: {device}")

        model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
        if FREEZE_BACKBONE:
            for p in model.parameters():
                p.requires_grad = False             # freeze everything
        model.fc = nn.Linear(model.fc.in_features, num_classes)  # replace head
        model = model.to(device)

        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(
            filter(lambda p: p.requires_grad, model.parameters()), lr=LR
        )
        scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.5)

        best_val_acc, best_state = 0.0, None
        for epoch in range(1, EPOCHS + 1):
            # ── training pass
            model.train()
            train_loss, correct, total = 0.0, 0, 0
            for imgs, labels in train_dl:
                imgs, labels = imgs.to(device), labels.to(device)
                optimizer.zero_grad()
                out  = model(imgs)
                loss = criterion(out, labels)
                loss.backward()
                optimizer.step()
                train_loss += loss.item() * imgs.size(0)
                correct    += (out.argmax(1) == labels).sum().item()
                total      += imgs.size(0)
            scheduler.step()

            # ── validation pass
            model.eval()
            val_correct, val_total = 0, 0
            with torch.no_grad():
                for imgs, labels in val_dl:
                    imgs, labels = imgs.to(device), labels.to(device)
                    out = model(imgs)
                    val_correct += (out.argmax(1) == labels).sum().item()
                    val_total   += imgs.size(0)

            train_acc = correct / total if total else 0
            val_acc   = val_correct / val_total if val_total else 0
            print(
                f"[train] Epoch {epoch:2d}/{EPOCHS}  "
                f"loss={train_loss/total:.4f}  "
                f"train_acc={train_acc:.3f}  val_acc={val_acc:.3f}"
            )
            if val_acc >= best_val_acc:
                best_val_acc = val_acc
                best_state   = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        print(f"[train] ✓ Best val_acc={best_val_acc:.3f}")

        # Return a bundle the predict() method can use
        model.load_state_dict(best_state)
        model.eval().cpu()
        return {"model": model, "class_names": class_names, "class_to_idx": class_to_idx}

    # ── Predict ────────────────────────────────────────────────────────────────
    def predict(self, bundle: dict, inputs: dict) -> dict:
        model       = bundle["model"]
        class_names = bundle["class_names"]

        url = inputs.get("image_url")
        if not url:
            raise ValueError("Provide 'image_url' in inputs.")

        img    = _download_image(url)
        tensor = _EVAL_TRANSFORM(img).unsqueeze(0)

        model.eval()
        with torch.no_grad():
            logits = model(tensor)
            proba  = torch.softmax(logits, dim=1).squeeze().tolist()

        if isinstance(proba, float):
            proba = [proba]

        top3 = sorted(
            [{"label": c, "score": round(p, 4)} for c, p in zip(class_names, proba)],
            key=lambda x: x["score"], reverse=True
        )[:3]

        return {
            "label":      top3[0]["label"],
            "confidence": top3[0]["score"],
            "top3":       top3,
        }

    def get_class_names(self):
        return []   # filled at inference time from the saved bundle

    def get_feature_names(self):
        return ["image_url"]
