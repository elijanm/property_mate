# @trainer
# Name: NSFW Detector
# Version: 1.0.0
# Author: Mldock Team
# Description: NSFW image detection using OpenCLIP zero-shot classification
# Framework: torch
# License: MIT
# Tags: nsfw, safety, image, pytorch, clip, classification

"""
NSFWDetector — classifies images as NSFW or SFW using OpenCLIP zero-shot classification.

No training data required — uses CLIP's semantic understanding to classify images.
Optionally fine-tune thresholds by uploading labelled examples.

How it works:
  - Encodes the image using OpenCLIP ViT-B-32-quickgelu
  - Computes similarity against a bank of NSFW and SFW text prompts
  - Aggregates scores into a single NSFW probability
  - Returns classification + confidence score

requirements.txt:
  open-clip-torch
  torch
  torchvision
  numpy
  Pillow

Dataset: optional — upload labelled images to fine-tune the threshold.
Inference input: a base64-encoded image file.
Inference output: {
    "nsfw_score": float,       # 0.0 (safe) to 1.0 (explicit)
    "is_nsfw": bool,           # True if nsfw_score >= threshold
    "label": str,              # "nsfw" or "sfw"
    "confidence": str,         # explicit / likely / uncertain / safe
    "categories": dict,        # per-category scores
}
"""

import base64
import numpy as np
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
from app.abstract.data_source import DatasetDataSource


class NSFWDetector(BaseTrainer):
    name        = "nsfw_detector"
    version     = "1.0.0"
    description = "NSFW image detection using OpenCLIP zero-shot classification."
    framework   = "torch"
    category    = {"key": "image-classification", "label": "Image Classification"}
    schedule    = None

    # Optional dataset — upload labelled images to calibrate threshold
    data_source = DatasetDataSource(
        slug="nsfw-detector-data",
        allow_empty=True,
        auto_create_spec={
            "name": "NSFW Detector Dataset (optional)",
            "description": "Optionally upload labelled images to calibrate the NSFW threshold.",
            "fields": [
                {"label": "Image", "type": "image",  "required": True},
                {"label": "Label", "type": "select", "required": True,
                 "options": ["nsfw", "sfw"]},
            ],
        },
    )

    input_schema = {
        "image": {
            "type":        "image",
            "label":       "Image (base64)",
            "description": "Image to classify as NSFW or SFW.",
            "required":    True,
        },
    }

    output_schema = {
        "nsfw_score":  {"type": "float", "label": "NSFW Score (0-1)"},
        "is_nsfw":     {"type": "bool",  "label": "Is NSFW"},
        "label":       {"type": "str",   "label": "Label (nsfw/sfw)"},
        "confidence":  {"type": "str",   "label": "Confidence (explicit/likely/uncertain/safe)"},
        "categories":  {"type": "dict",  "label": "Per-Category Scores"},
    }

    # ------------------------------------------------------------------
    # NSFW / SFW prompt banks
    # Broader prompt banks = more robust zero-shot classification
    # ------------------------------------------------------------------

    NSFW_PROMPTS = [
        "explicit sexual content",
        "nudity",
        "pornographic image",
        "explicit adult content",
        "sexually explicit material",
        "graphic sexual imagery",
        "adult only content",
        "explicit nudity",
    ]

    SFW_PROMPTS = [
        "a safe for work image",
        "a family friendly photo",
        "a normal everyday photo",
        "a professional photograph",
        "a landscape photo",
        "a portrait photo",
        "clothed people in a normal setting",
        "a safe and appropriate image",
    ]

    # Category-level prompts for granular scoring
    CATEGORY_PROMPTS = {
        "explicit":    "explicit sexual content or pornography",
        "nudity":      "nudity or exposed body parts",
        "suggestive":  "suggestive or sexually provocative content",
        "violence":    "graphic violence or gore",
        "safe":        "safe, normal, family-friendly content",
    }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_clip(device):
        """
        Load OpenCLIP ViT-B-32-quickgelu with OpenAI weights.
        Install via: pip install open-clip-torch
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
        """Encode raw image bytes -> L2-normalised CLIP embedding (512,)."""
        import torch
        from PIL import Image
        from io import BytesIO

        image  = Image.open(BytesIO(content)).convert("RGB")
        tensor = preprocess(image).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = model.encode_image(tensor)
            emb = emb / emb.norm(dim=-1, keepdim=True)
        return emb.squeeze(0).cpu().numpy().astype(np.float32)

    @staticmethod
    def _encode_texts(model, tokenizer, texts: list, device):
        """Encode a list of text prompts -> L2-normalised embeddings (N, 512)."""
        import torch

        tokens = tokenizer(texts).to(device)
        with torch.no_grad():
            emb = model.encode_text(tokens)
            emb = emb / emb.norm(dim=-1, keepdim=True)
        return emb.cpu().numpy().astype(np.float32)

    def _compute_nsfw_score(self, clip_model, tokenizer, q_emb, device):
        """
        Compute NSFW score using prompt bank aggregation.
        Returns: (nsfw_score, category_scores dict)
        """
        # ── Prompt bank scores ─────────────────────────────────────────
        nsfw_embs = self._encode_texts(clip_model, tokenizer, self.NSFW_PROMPTS, device)
        sfw_embs  = self._encode_texts(clip_model, tokenizer, self.SFW_PROMPTS,  device)

        nsfw_sims = np.dot(nsfw_embs, q_emb)   # (N_nsfw,)
        sfw_sims  = np.dot(sfw_embs,  q_emb)   # (N_sfw,)

        # Use mean of top-3 matches per bank for robustness
        nsfw_score_raw = float(np.sort(nsfw_sims)[::-1][:3].mean())
        sfw_score_raw  = float(np.sort(sfw_sims )[::-1][:3].mean())

        # Softmax-style normalisation to get probability
        exp_nsfw = np.exp(nsfw_score_raw * 10)
        exp_sfw  = np.exp(sfw_score_raw  * 10)
        nsfw_prob = float(exp_nsfw / (exp_nsfw + exp_sfw))

        # ── Per-category scores ────────────────────────────────────────
        cat_texts = list(self.CATEGORY_PROMPTS.values())
        cat_keys  = list(self.CATEGORY_PROMPTS.keys())
        cat_embs  = self._encode_texts(clip_model, tokenizer, cat_texts, device)
        cat_sims  = np.dot(cat_embs, q_emb)

        # Softmax over categories
        cat_exp   = np.exp(cat_sims * 10)
        cat_probs = cat_exp / cat_exp.sum()
        category_scores = {
            k: round(float(v), 4)
            for k, v in zip(cat_keys, cat_probs)
        }

        return round(nsfw_prob, 4), category_scores

    # ------------------------------------------------------------------
    # Preprocess
    # ------------------------------------------------------------------

    def preprocess(self, raw):
        items = []
        for entry in raw:
            field_type = entry.get("field_type", "")
            if field_type not in ("image", "file"):
                continue
            content = self._fetch_bytes(entry.get("file_key"), entry.get("file_url"))
            if not content:
                continue
            # Get label from select field
            label = "sfw"
            for e in raw:
                if e.get("id") == entry.get("id") and e.get("field_type") == "select":
                    label = e.get("text_value", "sfw").lower()
                    break
            items.append({
                "id":      entry.get("id", str(len(items))),
                "label":   label,
                "content": content,
            })
        return items

    # ------------------------------------------------------------------
    # Train
    # ------------------------------------------------------------------

    def train(self, preprocessed, config: TrainingConfig):
        """
        Training is optional — used only to calibrate the NSFW threshold.
        If no data provided, uses default threshold of 0.50.
        """
        import torch

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _, model, preprocess, tokenizer = self._load_clip(device)

        threshold = 0.50  # default

        if preprocessed:
            # Calibrate threshold from labelled examples
            scores = []
            labels = []

            for item in preprocessed:
                q_emb = self._encode_image_bytes(model, preprocess, item["content"], device)
                nsfw_score, _ = self._compute_nsfw_score(model, tokenizer, q_emb, device)
                scores.append(nsfw_score)
                labels.append(1 if item["label"] == "nsfw" else 0)

            scores = np.array(scores)
            labels = np.array(labels)

            # Find threshold that maximises accuracy
            best_acc       = 0.0
            best_threshold = 0.50

            for t in np.arange(0.30, 0.80, 0.01):
                preds   = (scores >= t).astype(int)
                acc     = (preds == labels).mean()
                if acc > best_acc:
                    best_acc       = acc
                    best_threshold = float(t)

            threshold = round(best_threshold, 2)

        bundle = TrainerBundle(
            model=model,
            extra={
                "threshold":  threshold,
                "preprocess": preprocess,
                "tokenizer":  tokenizer,
                "calibrated": len(preprocessed) > 0,
                "n_samples":  len(preprocessed),
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

        preprocess = model.extra.get("preprocess")
        tokenizer  = model.extra.get("tokenizer")
        threshold  = model.extra.get("threshold", 0.50)

        # Fallback reload
        if preprocess is None or tokenizer is None:
            _, _, preprocess, tokenizer = self._load_clip(device)

        # ── Encode query image ─────────────────────────────────────────
        query_content = base64.b64decode(inputs.get("image"))
        q_emb         = self._encode_image_bytes(clip_model, preprocess, query_content, device)

        # ── Compute NSFW score ─────────────────────────────────────────
        nsfw_score, category_scores = self._compute_nsfw_score(
            clip_model, tokenizer, q_emb, device
        )

        # ── Classify ───────────────────────────────────────────────────
        is_nsfw = nsfw_score >= threshold
        label   = "nsfw" if is_nsfw else "sfw"

        if nsfw_score >= 0.85:
            confidence = "explicit"
        elif nsfw_score >= 0.70:
            confidence = "likely"
        elif nsfw_score >= 0.45:
            confidence = "uncertain"
        else:
            confidence = "safe"

        return {
            "nsfw_score":  nsfw_score,
            "is_nsfw":     is_nsfw,
            "label":       label,
            "confidence":  confidence,
            "categories":  category_scores,
        }

    # ------------------------------------------------------------------
    # Evaluate
    # ------------------------------------------------------------------

    def evaluate(self, model: TrainerBundle, test_data) -> EvaluationResult:
        import torch

        if not test_data:
            return EvaluationResult(
                extra_metrics={
                    "threshold":  model.extra.get("threshold", 0.50),
                    "calibrated": model.extra.get("calibrated", False),
                    "model":      "OpenCLIP ViT-B-32-quickgelu (openai weights)",
                }
            )

        device     = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        clip_model = model.model.to(device).eval()
        preprocess = model.extra.get("preprocess")
        tokenizer  = model.extra.get("tokenizer")
        threshold  = model.extra.get("threshold", 0.50)

        if preprocess is None or tokenizer is None:
            _, _, preprocess, tokenizer = self._load_clip(device)

        y_true, y_pred, scores = [], [], []

        for item in test_data:
            q_emb      = self._encode_image_bytes(clip_model, preprocess, item["content"], device)
            nsfw_score, _ = self._compute_nsfw_score(clip_model, tokenizer, q_emb, device)
            pred       = int(nsfw_score >= threshold)
            true       = 1 if item["label"] == "nsfw" else 0
            y_true.append(true)
            y_pred.append(pred)
            scores.append(nsfw_score)

        y_true = np.array(y_true)
        y_pred = np.array(y_pred)

        tp = int(((y_pred == 1) & (y_true == 1)).sum())
        tn = int(((y_pred == 0) & (y_true == 0)).sum())
        fp = int(((y_pred == 1) & (y_true == 0)).sum())
        fn = int(((y_pred == 0) & (y_true == 1)).sum())

        accuracy  = round((tp + tn) / max(len(y_true), 1), 4)
        precision = round(tp / max(tp + fp, 1), 4)
        recall    = round(tp / max(tp + fn, 1), 4)
        f1        = round(2 * precision * recall / max(precision + recall, 1e-8), 4)

        return EvaluationResult(
            extra_metrics={
                "accuracy":   accuracy,
                "precision":  precision,
                "recall":     recall,
                "f1_score":   f1,
                "tp": tp, "tn": tn, "fp": fp, "fn": fn,
                "threshold":  threshold,
                "model":      "OpenCLIP ViT-B-32-quickgelu (openai weights)",
            }
        )