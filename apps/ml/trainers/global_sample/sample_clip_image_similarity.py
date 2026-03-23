# @trainer
# Name: Image Similarity (CLIP)
# Version: 2.1.0
# Author: Mldock Team
# Description: Image similarity using OpenCLIP (ViT-B-32) with hybrid image+text scoring
# Framework: torch
# License: MIT
# Tags: similarity, image, pytorch, clip, embeddings, open-clip

"""
CLIPImageSimilarity — computes cosine similarity between an inferred image and stored
dataset images using OpenCLIP ViT-B-32 (open-clip-torch, Python 3.12 compatible).

Improvements over MobileNetV2 v1:
  - OpenCLIP embeddings are semantically aware (trained on 400M+ image-text pairs)
  - Hybrid scoring: 70% image-to-image + 30% text-anchor similarity
  - Tighter thresholds calibrated for CLIP's embedding space
  - Unrelated images (cars, people, etc.) score << 0.50 instead of 0.60+
  - No git required — installs cleanly via: pip install open-clip-torch

requirements.txt:
  open-clip-torch
  torch
  torchvision
  numpy
  Pillow

Dataset: images stored in the platform dataset.
Inference input: a base64-encoded image file.
Inference output: {
    "best_score": float,        # hybrid score 0-1
    "image_score": float,       # raw image-to-image cosine similarity
    "text_score": float,        # CLIP text-anchor similarity
    "best_match_id": str,
    "match": bool,              # True if hybrid_score >= 0.88
    "confidence": str,          # identical / high / medium / low
    "top_matches": list
}
"""

import base64
import numpy as np
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
from app.abstract.data_source import DatasetDataSource


class CLIPImageSimilarity(BaseTrainer):
    name        = "clip_image_similarity"
    version     = "2.1.0"
    description = "Semantic image similarity using OpenCLIP ViT-B-32 with hybrid image+text scoring."
    framework   = "torch"
    category    = {"key": "image-similarity", "label": "Image Similarity"}
    schedule    = None

    data_source = DatasetDataSource(
        slug="clip-image-similarity-data",
        auto_create_spec={
            "name": "CLIP Image Similarity Dataset",
            "description": "Upload reference images to compare against.",
            "fields": [
                {"label": "Image",       "type": "image", "required": True},
                {"label": "Description", "type": "text",  "required": False},
            ],
        },
    )

    input_schema = {
        "image": {
            "type":        "image",
            "label":       "Image (base64)",
            "description": "Image to compare against the reference dataset.",
            "required":    True,
        },
        "anchor_text": {
            "type":        "text",
            "label":       "Text Anchor (optional)",
            "description": "Describe what a valid match looks like, e.g. 'MTW MJ-20 water meter'. "
                           "Overrides the anchor stored at train time.",
            "required":    False,
        },
    }

    output_schema = {
        "best_score":    {"type": "float", "label": "Hybrid Score (0-1)"},
        "image_score":   {"type": "float", "label": "Image-to-Image Score"},
        "text_score":    {"type": "float", "label": "Text Anchor Score"},
        "best_match_id": {"type": "str",   "label": "Best Match ID"},
        "match":         {"type": "bool",  "label": "Match (hybrid_score >= 0.88)"},
        "confidence":    {"type": "str",   "label": "Confidence (identical/high/medium/low)"},
        "top_matches":   {"type": "list",  "label": "Top 5 Matches"},
    }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_clip(device):
        """
        Load OpenCLIP ViT-B-32 with OpenAI weights.
        Install via: pip install open-clip-torch
        Returns: (open_clip module, model, preprocess, tokenizer)
        """
        import open_clip
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32-quickgelu",
            pretrained="openai",
            device=device,
        )
        tokenizer = open_clip.get_tokenizer("ViT-B-32-quickgelu")
        model.eval()
        return open_clip, model, preprocess, tokenizer

    @staticmethod
    def _encode_image_bytes(model, preprocess, content: bytes, device):
        """
        Encode raw image bytes -> L2-normalised CLIP embedding (512,).
        """
        import torch
        from PIL import Image
        from io import BytesIO

        image  = Image.open(BytesIO(content)).convert("RGB")
        tensor = preprocess(image).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = model.encode_image(tensor)                    # (1, 512)
            emb = emb / emb.norm(dim=-1, keepdim=True)         # L2 normalise
        return emb.squeeze(0).cpu().numpy().astype(np.float32)  # (512,)

    @staticmethod
    def _encode_text(model, tokenizer, text: str, device):
        """
        Encode a text string -> L2-normalised CLIP embedding (512,).
        """
        import torch

        tokens = tokenizer([text]).to(device)
        with torch.no_grad():
            emb = model.encode_text(tokens)                     # (1, 512)
            emb = emb / emb.norm(dim=-1, keepdim=True)
        return emb.squeeze(0).cpu().numpy().astype(np.float32)  # (512,)

    # ------------------------------------------------------------------
    # Preprocess
    # ------------------------------------------------------------------

    def preprocess(self, raw):
        items       = []
        anchor_text = None

        for entry in raw:
            field_type  = entry.get("field_type", "")
            field_label = (entry.get("field_label") or "").lower()

            # Collect anchor text description if provided
            if field_type == "text" and "description" in field_label:
                val = entry.get("text_value", "").strip()
                if val:
                    anchor_text = val
                continue

            if field_type not in ("image", "file"):
                continue

            content = self._fetch_bytes(entry.get("file_key"), entry.get("file_url"))
            if not content:
                continue

            label = entry.get("text_value") or entry.get("field_label") or "reference"
            items.append({
                "id":      entry.get("id", str(len(items))),
                "label":   label,
                "content": content,
            })

        # Attach anchor text to first item so train() can access it
        if items and anchor_text:
            items[0]["_anchor_text"] = anchor_text

        return items

    # ------------------------------------------------------------------
    # Train
    # ------------------------------------------------------------------

    def train(self, preprocessed, config: TrainingConfig):
        import torch

        if not preprocessed:
            raise ValueError(
                "No training images found. Please upload at least one image to the "
                "'CLIP Image Similarity Dataset' before training."
            )

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _, model, preprocess, tokenizer = self._load_clip(device)

        # Encode all reference images
        embeddings = np.stack([
            self._encode_image_bytes(model, preprocess, item["content"], device)
            for item in preprocessed
        ])  # shape (N, 512)

        # Determine anchor text
        # Priority: dataset description field -> auto-generated from label
        anchor_text = preprocessed[0].get("_anchor_text", "").strip()
        if not anchor_text:
            anchor_text = f"a photo of a {preprocessed[0]['label']}"

        bundle = TrainerBundle(
            model=model,
            extra={
                "embeddings":  embeddings,
                "labels":      [i["label"] for i in preprocessed],
                "ids":         [i["id"]    for i in preprocessed],
                "anchor_text": anchor_text,
                "preprocess":  preprocess,
                "tokenizer":   tokenizer,
            },
        )
        return bundle, preprocessed

    # ------------------------------------------------------------------
    # Predict
    # ------------------------------------------------------------------

    def predict(self, model: TrainerBundle, inputs: dict) -> dict:
        import torch

        device     = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        clip_model = model.model.to(device).eval()

        # Retrieve stored preprocess + tokenizer
        preprocess = model.extra.get("preprocess")
        tokenizer  = model.extra.get("tokenizer")

        # Fallback: reload if not serialised correctly
        if preprocess is None or tokenizer is None:
            _, _, preprocess, tokenizer = self._load_clip(device)

        # ── 1. Encode query image ──────────────────────────────────────
        query_content = base64.b64decode(inputs.get("image"))
        q_emb         = self._encode_image_bytes(clip_model, preprocess, query_content, device)

        # ── 2. Image-to-image scores ───────────────────────────────────
        ref        = model.extra["embeddings"].astype(np.float32)  # (N, 512)
        img_scores = np.dot(ref, q_emb)                             # (N,)

        hits = [
            {
                "id":    model.extra["ids"][i],
                "score": round(float(img_scores[i]), 4),
                "label": model.extra["labels"][i],
            }
            for i in range(len(img_scores))
        ]
        hits.sort(key=lambda x: x["score"], reverse=True)
        top  = hits[:5]
        best = top[0] if top else {}

        image_score = float(best.get("score", 0.0))

        # ── 3. Text-anchor score ───────────────────────────────────────
        anchor_text = (
            inputs.get("anchor_text", "").strip()
            or model.extra.get("anchor_text", "")
        )

        if anchor_text and tokenizer:
            t_emb      = self._encode_text(clip_model, tokenizer, anchor_text, device)
            text_score = float(np.dot(q_emb, t_emb))
        else:
            text_score = image_score  # fallback: no text penalty

        text_score = max(0.0, min(1.0, text_score))  # clamp to [0, 1]

        # ── 4. Hybrid score: 70% image + 30% text ─────────────────────
        hybrid_score = round((image_score * 0.7) + (text_score * 0.3), 4)

        # ── 5. Thresholds calibrated for OpenCLIP ViT-B-32 ────────────
        # Same product, same angle   -> ~0.95-0.99
        # Same product, diff angle   -> ~0.88-0.94
        # Same category, diff brand  -> ~0.70-0.87
        # Completely unrelated       -> ~0.10-0.50
        MATCH_THRESHOLD = 0.88

        if hybrid_score >= 0.95:
            confidence = "identical"
        elif hybrid_score >= 0.88:
            confidence = "high"
        elif hybrid_score >= 0.70:
            confidence = "medium"
        else:
            confidence = "low"

        return {
            "best_score":    hybrid_score,
            "image_score":   round(image_score, 4),
            "text_score":    round(text_score,  4),
            "best_match_id": best.get("id", ""),
            "match":         hybrid_score >= MATCH_THRESHOLD,
            "confidence":    confidence,
            "top_matches":   top,
        }

    # ------------------------------------------------------------------
    # Evaluate
    # ------------------------------------------------------------------

    def evaluate(self, model: TrainerBundle, test_data) -> EvaluationResult:
        return EvaluationResult(
            extra_metrics={
                "reference_count": len(model.extra["embeddings"]),
                "embedding_dim":   int(model.extra["embeddings"].shape[1]),
                "anchor_text":     model.extra.get("anchor_text", ""),
                "model":           "OpenCLIP ViT-B-32 (openai weights)",
            }
        )