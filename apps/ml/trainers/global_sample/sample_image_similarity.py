# @trainer
# Name: Image Similarity
# Version: 1.0.0
# Author: Mldock Team
# Author Email: hello@mldock.io
# Author URL: https://mldock.io
# Description: Image similarity and visual search using CLIP embeddings with optional fine-tuning
# Commercial: public
# Downloadable: true
# Protect Model: false
# Icon: dataset:image-similarity-data
# License: MIT
# Tags: similarity, image, pytorch, clip, embeddings

# ⚠ AI-GENERATED TRAINER
# Review by a qualified data scientist or ML engineer before production use.
# Validate output quality on your specific dataset. For complex tasks
# (image segmentation, object detection, NLP at scale), expert review is essential.

"""
ImageCosineSimilarity — computes cosine similarity between an inferred image and stored dataset images.
Dataset: images stored in the platform dataset.
Inference input: an image file.
Inference output: {"best_score": float, "best_match_id": str, "top_matches": list}
"""
import base64
import io
import os
import re
import shutil
import zipfile
from pathlib import Path
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
from app.abstract.data_source import DatasetDataSource


class ImageCosineSimilarity(BaseTrainer):
    name        = "image_cosine_similarity"
    version     = "1.0.0"
    description = "Computes cosine similarity between an inferred image and stored dataset images."
    framework   = "torch"
    category    = {"key": "image-similarity", "label": "Image Similarity"}
    schedule    = None

    data_source = DatasetDataSource(
        slug="image-cosine-similarity-data",
        auto_create_spec={
            "name": "Image Cosine Similarity Dataset",
            "description": "Upload images to compare against.",
            "fields": [
                {"label": "Image", "type": "image", "required": True},
            ],
        },
    )

    # input_schema  = {"image": {"type": "file", "label": "Input Image"}}
    input_schema = {
        "image": {
            "type":        "image",
            "label":       "Image (base64)",
            "description": "imae to compare",
            "required":    True,
        }
    }
    output_schema = {
        "best_score":    {"type": "float",  "label": "Best Match Score (0–1)"},
        "best_match_id": {"type": "str",    "label": "Best Match ID"},
        "match":         {"type": "bool",   "label": "Match (score ≥ 0.50)"},
        "confidence":    {"type": "str",    "label": "Confidence (identical/high/medium/low)"},
        "top_matches":   {"type": "list",   "label": "Top 5 Matches"},
    }

    def preprocess(self, raw):
        items = []
        for entry in raw:
            field_type = entry.get('field_type', '')
            if field_type not in ('image', 'file'):
                continue
            content = self._fetch_bytes(entry.get('file_key'), entry.get('file_url'))
            if not content:
                continue
            label = entry.get('text_value') or entry.get('field_label') or 'reference'
            items.append({'id': entry.get('id', str(len(items))), 'label': label, 'content': content})
        return items

    def train(self, preprocessed, config: TrainingConfig):
        import torch
        import torchvision.transforms as transforms
        import torchvision.models as models
        import numpy as np
        from PIL import Image
        from io import BytesIO

        if not preprocessed:
            raise ValueError(
                "No training images found. Please upload at least one image to the "
                "'Image Cosine Similarity Dataset' before training."
            )

        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        backbone = models.mobilenet_v2(pretrained=True).features.to(device).eval()

        transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        def encode_image(content):
            image = Image.open(BytesIO(content)).convert('RGB')
            tensor = transform(image).unsqueeze(0).to(device)
            with torch.no_grad():
                feat = backbone(tensor)                    # (1, 1280, 7, 7)
                emb = feat.mean(dim=[-2, -1]).squeeze(0)   # (1280,) — global avg pool
                emb = emb.cpu().numpy().astype(np.float32)
            norm = np.linalg.norm(emb)
            return emb / max(norm, 1e-8)                   # L2-normalised

        embeddings = np.stack([encode_image(item['content']) for item in preprocessed])

        bundle = TrainerBundle(
            model=backbone,
            extra={
                "embeddings": embeddings,   # already L2-normalised, shape (N, 1280)
                "labels":     [i['label'] for i in preprocessed],
                "ids":        [i['id']    for i in preprocessed],
            },
        )
        return bundle, preprocessed

    def predict(self, model: TrainerBundle, inputs: dict) -> dict:
        import torch
        import torch.nn as nn
        import numpy as np
        from PIL import Image
        from io import BytesIO
        import torchvision.transforms as transforms

        raw_input = inputs.get('image')
        query_content = base64.b64decode(raw_input)

        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        backbone = model.model.to(device).eval()

        transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        def encode_image(content):
            image = Image.open(BytesIO(content)).convert('RGB')
            tensor = transform(image).unsqueeze(0).to(device)
            with torch.no_grad():
                feat = backbone(tensor)                    # (1, 1280, 7, 7)
                emb = feat.mean(dim=[-2, -1]).squeeze(0)   # (1280,)
                emb = emb.cpu().numpy().astype(np.float32)
            norm = np.linalg.norm(emb)
            return emb / max(norm, 1e-8)

        q_emb = encode_image(query_content)   # (1280,) L2-normalised

        # Flatten stored embeddings to (N, D) to handle both old (N,1280,7,7) and new (N,1280) bundles
        ref_raw = model.extra['embeddings'].astype(np.float32)
        ref = ref_raw.reshape(ref_raw.shape[0], -1)          # (N, D)

        # Re-normalise ref rows (handles old un-normalised bundles gracefully)
        ref_norms = np.linalg.norm(ref, axis=1, keepdims=True)
        ref = ref / np.maximum(ref_norms, 1e-8)

        # q_emb may need to match D if old bundle has larger D
        if ref.shape[1] != q_emb.shape[0]:
            # Old bundle stored (1280,7,7) → D=62720; re-encode without pooling to match
            with torch.no_grad():
                feat = backbone(transform(Image.open(io.BytesIO(query_content)).convert('RGB')).unsqueeze(0).to(device))
                q_emb = feat.squeeze(0).cpu().numpy().astype(np.float32).reshape(-1)
            q_norm = np.linalg.norm(q_emb)
            q_emb = q_emb / max(q_norm, 1e-8)

        scores = np.dot(ref, q_emb).astype(np.float32)

        hits = [
            {
                'id': model.extra['ids'][i],
                'score': round(float(scores[i]), 4),
                'label': model.extra['labels'][i]
            }
            for i in range(len(scores))
        ]

        hits.sort(key=lambda x: x['score'], reverse=True)
        top = hits[:5]
        best = top[0] if top else {}

        best_score = float(best.get('score', 0.0))
        # Score interpretation for L2-normalised MobileNetV2 embeddings:
        #   >= 0.90  identical / near-identical
        #   >= 0.70  same object, different angle or lighting
        #   >= 0.50  same category
        #   <  0.50  unrelated
        MATCH_THRESHOLD = 0.50
        if best_score >= 0.90:
            confidence = 'identical'
        elif best_score >= 0.70:
            confidence = 'high'
        elif best_score >= 0.50:
            confidence = 'medium'
        else:
            confidence = 'low'

        return {
            'best_score':    best_score,
            'best_match_id': best.get('id', ''),
            'match':         best_score >= MATCH_THRESHOLD,
            'confidence':    confidence,
            'top_matches':   top,
        }

    def evaluate(self, model: TrainerBundle, test_data) -> EvaluationResult:
        return EvaluationResult(
            extra_metrics={"reference_count": len(model.extra["embeddings"])}
        )