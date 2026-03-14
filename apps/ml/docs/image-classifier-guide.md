# Building an Image Classifier with ML Studio

**Prerequisite:** Read the [Code Editor Guide](./code-editor-guide.md) first.

---

## Table of Contents

1. [What You Need](#1-what-you-need)
2. [Step 1 — Create a Dataset with an Image Field](#2-step-1--create-a-dataset-with-an-image-field)
3. [Step 2 — Collect Labeled Images](#3-step-2--collect-labeled-images)
4. [Step 3 — Autofill the Trainer](#4-step-3--autofill-the-trainer)
5. [Step 4 — Implement the Image Training Logic](#5-step-4--implement-the-image-training-logic)
6. [Step 5 — Run & Verify](#6-step-5--run--verify)
7. [Full Example: Maize Disease Classifier](#7-full-example-maize-disease-classifier)
8. [Available Image Backends](#8-available-image-backends)
9. [Tips & Common Errors](#9-tips--common-errors)

---

## 1. What You Need

| Requirement | Why |
|---|---|
| A dataset with at least **two fields**: one image field + one label (text) field | The image field holds the photo; the label field is what you're predicting |
| At least **2 labeled samples** | Minimum to run a train/test split |
| Python packages: `Pillow`, `requests`, `numpy` | Pre-installed in `ml-service` image |
| Optional: `scikit-learn` or `torch` | For the classifier head |

> **Why two fields?**
> `DatasetDataSource` returns one entry per field per collector.
> `preprocess()` pivots by `collector_id` so one row = one collector's full submission.
> Without a separate label field there is nothing to predict.

---

## 2. Step 1 — Create a Dataset with an Image Field

In the main PMS app:

1. Navigate to **Datasets** → **New Dataset**
2. Add an **image** field: e.g. "Photo" — collectors will upload the image here
3. Add a **text** field: e.g. "Label" — collectors type the class name (e.g. `healthy`, `diseased`)
4. Save and note the **Dataset ID** from the URL or the dataset detail page

Example schema:

| Field ID (UUID) | Label | Type |
|---|---|---|
| `1033b639-...` | Photo | image |
| `a8135100-...` | Label | text |

---

## 3. Step 2 — Collect Labeled Images

Use the collector app to submit entries:
- Each collector uploads a photo **and** types the corresponding label
- Both submissions share the same `collector_id` → `preprocess()` joins them into one row

Collect at least 10–20 samples per class for meaningful results. For testing, 2+ samples total is enough to confirm the pipeline works.

---

## 4. Step 3 — Autofill the Trainer

In the Code Editor:

1. Click **Dataset ▾** in the toolbar
2. Select your dataset
3. A new tab opens with generated code — read the docstring at the top, which lists all field IDs with their labels:

```python
# Fields (id → label):
#   [1033b639-92ed-45cb-aae1-0f39bb3b8d99]  Photo (image)
#   [a8135100-7ad9-4ca5-975c-c41800720e8d]  Label (text)
```

The generated `label_col` will be set to the last field's ID. Confirm it points to your **text label** field, not the image field.

---

## 5. Step 4 — Implement the Image Training Logic

The autofill template uses `auto_train_tabular` which cannot handle image URLs. Replace the `train()` method with image-specific logic.

### Minimal example (sklearn + flattened pixels)

```python
import requests
import numpy as np
from PIL import Image
from io import BytesIO
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

IMAGE_FIELD = "1033b639-92ed-45cb-aae1-0f39bb3b8d99"   # ← your image field ID
LABEL_FIELD = "a8135100-7ad9-4ca5-975c-c41800720e8d"   # ← your label field ID
IMG_SIZE    = (64, 64)

def _load_image(url: str) -> np.ndarray:
    """Download image from S3 presigned URL, resize, flatten."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img = Image.open(BytesIO(resp.content)).convert("RGB").resize(IMG_SIZE)
    return np.array(img).flatten().astype(np.float32) / 255.0


def preprocess(self, raw):
    rows = {}
    for entry in raw:
        key = entry.get("collector_id") or entry.get("entry_id", "unknown")
        rows.setdefault(key, {})
        field_id = entry["field_id"]
        rows[key][field_id] = (
            entry.get("text_value") or entry.get("file_url")
        )

    import pandas as pd
    df = pd.DataFrame(list(rows.values()))
    print(f"[preprocess] {len(df)} rows. Columns: {list(df.columns)}")
    return df


def train(self, df, config):
    df = df.dropna(subset=[IMAGE_FIELD, LABEL_FIELD])
    if len(df) < 2:
        raise ValueError(
            f"Need at least 2 rows with both image and label. Got {len(df)}."
        )

    print(f"[train] Loading {len(df)} images...")
    X, y = [], []
    for _, row in df.iterrows():
        try:
            vec = _load_image(row[IMAGE_FIELD])
            X.append(vec)
            y.append(str(row[LABEL_FIELD]).strip().lower())
        except Exception as e:
            print(f"[train] Skipping image: {e}")

    X = np.array(X)
    y = np.array(y)
    print(f"[train] Classes: {sorted(set(y))}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y if len(set(y)) > 1 else None
    )
    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    print(classification_report(y_test, y_pred))
    return clf
```

---

## 6. Step 5 — Run & Verify

1. Click **Save** (or Ctrl+S)
2. Click **▶ Run**
3. Watch the Output panel — you should see:

```
● Validating file…
✓ Trainer detected: maizecollectiontrainer
▶ Starting run: maizecollectiontrainer
✓ Job queued: <job-id>
[editor] Executing maizecollectiontrainer.py directly (no queue)...
[editor] Scanning plugins...
[editor] trainer_class_registered ... name=maizecollectiontrainer
[editor] Loading data from DatasetDataSource...
[preprocess] 12 rows. Columns: ['1033b639-...', 'a8135100-...']
[train] Loading 12 images...
[train] Classes: ['diseased', 'healthy']
              precision    recall  f1-score ...
[editor] ✓ Run complete
```

---

## 7. Full Example: Maize Disease Classifier

Below is a complete, runnable trainer for a two-class maize disease dataset:

```python
"""
MaizeCollectionTrainer — classifies maize images as healthy or diseased.

Dataset fields:
  [1033b639-92ed-45cb-aae1-0f39bb3b8d99]  Photo  (image)
  [a8135100-7ad9-4ca5-975c-c41800720e8d]  Condition (text: healthy | diseased)
"""
from app.abstract.base_trainer import BaseTrainer, TrainingConfig
from app.abstract.data_source import DatasetDataSource

import numpy as np
import requests
from io import BytesIO
from PIL import Image
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import pandas as pd


IMAGE_FIELD = "1033b639-92ed-45cb-aae1-0f39bb3b8d99"
LABEL_FIELD = "a8135100-7ad9-4ca5-975c-c41800720e8d"
IMG_SIZE    = (64, 64)


def _load_image(url: str) -> np.ndarray:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img = Image.open(BytesIO(resp.content)).convert("RGB").resize(IMG_SIZE)
    return np.array(img).flatten().astype(np.float32) / 255.0


class MaizeCollectionTrainer(BaseTrainer):
    name = "maizecollectiontrainer"
    version = "1.0.0"
    description = "Classifies maize images: healthy vs diseased"
    framework = "sklearn"

    data_source = DatasetDataSource(dataset_id="69b552006a240538069fbab8")

    input_schema  = {IMAGE_FIELD: {"type": "image",  "label": "Photo"}}
    output_schema = {
        "label":      {"type": "text",   "label": "Condition"},
        "confidence": {"type": "number", "label": "Confidence", "format": "percent"},
    }

    def preprocess(self, raw):
        if not raw:
            raise ValueError("Dataset empty — collect some images first.")
        rows = {}
        for entry in raw:
            key = entry.get("collector_id") or entry.get("entry_id", "?")
            rows.setdefault(key, {})
            rows[key][entry["field_id"]] = (
                entry.get("text_value") or entry.get("file_url")
            )
        df = pd.DataFrame(list(rows.values()))
        print(f"[preprocess] {len(df)} rows, columns: {list(df.columns)}")
        return df

    def train(self, df: pd.DataFrame, config: TrainingConfig):
        df = df.dropna(subset=[IMAGE_FIELD, LABEL_FIELD])
        if len(df) < 2:
            raise ValueError(f"Need ≥2 labeled rows, got {len(df)}.")

        print(f"[train] Downloading {len(df)} images...")
        X, y = [], []
        for _, row in df.iterrows():
            try:
                X.append(_load_image(row[IMAGE_FIELD]))
                y.append(str(row[LABEL_FIELD]).strip().lower())
            except Exception as e:
                print(f"[train] Skipping: {e}")

        X, y = np.array(X), np.array(y)
        print(f"[train] Classes: {sorted(set(y))}")

        stratify = y if len(set(y)) > 1 else None
        X_tr, X_te, y_tr, y_te = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=stratify
        )
        clf = RandomForestClassifier(n_estimators=100, random_state=42)
        clf.fit(X_tr, y_tr)
        print(classification_report(y_te, clf.predict(X_te)))
        return clf

    def predict(self, model, inputs: dict):
        url = inputs.get(IMAGE_FIELD)
        if not url:
            raise ValueError("No image URL provided in inputs.")
        vec = _load_image(url).reshape(1, -1)
        label = model.predict(vec)[0]
        proba = model.predict_proba(vec)[0].max()
        return {"label": label, "confidence": round(float(proba), 4)}
```

---

## 8. Available Image Backends

### scikit-learn (default, no GPU)

```python
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
```

Best for: small datasets (< 1 000 images), quick prototyping.
Feature extraction: flatten + normalize pixels, or use a pre-trained CNN as feature extractor (see below).

### CNN feature extractor + sklearn head (recommended for larger datasets)

```python
import torch
import torchvision.models as models
import torchvision.transforms as T

extractor = models.resnet18(pretrained=True)
extractor.fc = torch.nn.Identity()  # remove classification head
extractor.eval()

transform = T.Compose([T.Resize((224, 224)), T.ToTensor(),
                        T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

def _embed(url: str) -> np.ndarray:
    img = Image.open(BytesIO(requests.get(url).content)).convert("RGB")
    t = transform(img).unsqueeze(0)
    with torch.no_grad():
        return extractor(t).squeeze().numpy()
```

Then pass embeddings to `RandomForestClassifier` or `LogisticRegression`.

### PyTorch end-to-end

Set `framework = "pytorch"` and implement a full training loop in `train()`. Return the model with `torch.save` path or the model object itself (serialization is handled by `auto_save_model()`).

---

## 9. Tips & Common Errors

| Error | Cause | Fix |
|---|---|---|
| `Label column 'uuid' not found` | label field UUID has no entries | Change `LABEL_FIELD` to a UUID that appears in `df.columns` (printed by `preprocess`) |
| `Only 1 row remains` | Only 1 collector submitted both image + label | Collect more data; minimum is 2 |
| `ConnectionError` downloading image | S3/MinIO unreachable from container | Check `S3_ENDPOINT_URL` env var points to `http://minio:9000` inside Docker |
| `PIL: cannot identify image file` | Corrupt upload or non-image MIME | Validate uploads in the collector app |
| `ImportError: No module named 'torch'` | PyTorch not in base image | Add `torch` to `requirements.txt` and rebuild `ml-service` |
| `Restricted import: 'socket'` | Tried to make a raw socket connection | Use `requests` for HTTP instead |
| `open('model.pkl', 'w')` blocked | Writes outside `/tmp` are blocked by security scanner | Write to `/tmp/model.pkl` or let the framework handle serialization |
