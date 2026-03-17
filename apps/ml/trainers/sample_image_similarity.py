"""
Sample: Image Similarity (CLIP + cosine similarity)
====================================================
Encodes images into embedding vectors using OpenAI CLIP, then:

  Mode A — Image-to-Image similarity
      Given a query image, rank a gallery of images by visual similarity.

  Mode B — Text-to-Image search (zero-shot)
      Given a text description (e.g. "red maize cob"), retrieve the most
      similar images from the gallery — no training required.

  Mode C — Custom fine-tuning via contrastive loss
      If you have (anchor, positive, negative) triplets from a dataset,
      fine-tunes CLIP's vision encoder with triplet margin loss so that
      visually similar pairs are pulled together in embedding space.

Which mode to use
-----------------
• Quick search with no training   → Mode B (text query) or Mode A on raw CLIP
• Domain-specific similarity       → Mode C (fine-tune on your own data)

Dataset for Mode C
------------------
Create a dataset with three image fields:
    • anchor   — the reference image
    • positive — a similar image (same class / same product)
    • negative — a dissimilar image (different class)

Quickstart
----------
1. Fill in the configuration block below.
2. Set MODE = "finetune" to use Mode C, or "pretrained" to use raw CLIP.
3. Click ▶ Run.

Inference input
---------------
    Mode A (image query):
        { "query_image_url": "https://...", "gallery_urls": ["https://...", ...] }
    Mode B (text query):
        { "query_text": "red maize cob", "gallery_urls": ["https://...", ...] }

Inference output
----------------
    {
      "results": [
          {"url": "https://...", "score": 0.93},
          {"url": "https://...", "score": 0.81},
          ...
      ]
    }
"""
# ── Configuration — edit these ─────────────────────────────────────────────────
DATASET_ID         = "PASTE_YOUR_DATASET_ID_HERE"
ANCHOR_FIELD_ID    = "PASTE_ANCHOR_IMAGE_FIELD_UUID"
POSITIVE_FIELD_ID  = "PASTE_POSITIVE_IMAGE_FIELD_UUID"
NEGATIVE_FIELD_ID  = "PASTE_NEGATIVE_IMAGE_FIELD_UUID"

MODE               = "pretrained"   # "pretrained" or "finetune"
CLIP_MODEL         = "openai/clip-vit-base-patch32"  # or clip-vit-large-patch14
EPOCHS             = 5
LR                 = 1e-5
MARGIN             = 0.3     # triplet margin loss margin
TOP_K              = 5       # how many gallery results to return
# ──────────────────────────────────────────────────────────────────────────────

import io
import requests
import numpy as np
from PIL import Image

import torch
import torch.nn.functional as F
from transformers import CLIPProcessor, CLIPModel

from app.abstract.base_trainer import BaseTrainer, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import DatasetDataSource, InMemoryDataSource


def _load_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def _embed_images(model, processor, urls: list, device: str) -> torch.Tensor:
    """Encode a list of image URLs into L2-normalised CLIP embeddings."""
    images = [_load_image(u) for u in urls]
    inputs = processor(images=images, return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        feats = model.get_image_features(**inputs)
    return F.normalize(feats, dim=-1)


def _embed_text(model, processor, texts: list, device: str) -> torch.Tensor:
    """Encode a list of text strings into L2-normalised CLIP embeddings."""
    inputs = processor(text=texts, return_tensors="pt", padding=True, truncation=True).to(device)
    with torch.no_grad():
        feats = model.get_text_features(**inputs)
    return F.normalize(feats, dim=-1)


class SampleImageSimilarity(BaseTrainer):
    name    = "image_similarity"
    version = "1.0.0"
    description = "Image similarity / search — CLIP embeddings with optional fine-tuning"
    framework   = "pytorch"
    category    = {"key": "similarity", "label": "Image Similarity"}

    output_display = [
        OutputFieldSpec("results", "ranked_list", "Similar Images", primary=True,
                        hint=""),
    ]

    # Replace InMemoryDataSource with DatasetDataSource for Mode C fine-tuning:
    #   data_source = DatasetDataSource(dataset_id=DATASET_ID)
    data_source = InMemoryDataSource()

    input_schema = {
        "query_image_url": {
            "type":        "image_url",
            "label":       "Query Image URL",
            "description": "Image to find similar matches for (Mode A)",
            "required":    False,
        },
        "query_text": {
            "type":        "text",
            "label":       "Text Query",
            "description": "Natural language description to search with (Mode B)",
            "required":    False,
        },
        "gallery_urls": {
            "type":        "json",
            "label":       "Gallery URLs",
            "description": "List of image URLs to rank by similarity",
            "required":    True,
            "example":     ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
        },
    }
    output_schema = {
        "results": {
            "type":  "json",
            "label": "Ranked Results",
            "description": "Gallery images sorted by similarity score (1.0 = identical)",
        }
    }

    # ── Preprocess ─────────────────────────────────────────────────────────────
    def preprocess(self, raw: list) -> dict:
        """
        For MODE = "pretrained": raw data is not used — returns empty triplet list.
        For MODE = "finetune":   builds (anchor_url, positive_url, negative_url) triplets.
        """
        if MODE == "pretrained" or not raw:
            print("[preprocess] Mode=pretrained — no training data needed.")
            return {"triplets": []}

        collector_rows: dict = {}
        for entry in raw:
            key = entry.get("collector_id") or entry.get("entry_id", "?")
            collector_rows.setdefault(key, {})
            fid = entry["field_id"]
            collector_rows[key][fid] = entry.get("file_url") or entry.get("text_value")

        triplets = []
        for data in collector_rows.values():
            anchor   = data.get(ANCHOR_FIELD_ID)
            positive = data.get(POSITIVE_FIELD_ID)
            negative = data.get(NEGATIVE_FIELD_ID)
            if anchor and positive and negative:
                triplets.append((anchor, positive, negative))

        if not triplets:
            raise ValueError(
                "No (anchor, positive, negative) triplets found. "
                "Ensure ANCHOR_FIELD_ID, POSITIVE_FIELD_ID, NEGATIVE_FIELD_ID are correct."
            )

        print(f"[preprocess] {len(triplets)} triplets ready for fine-tuning")
        return {"triplets": triplets}

    # ── Train ──────────────────────────────────────────────────────────────────
    def train(self, preprocessed: dict, config: TrainingConfig):
        device   = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[train] Loading CLIP: {CLIP_MODEL}  device={device}")

        model     = CLIPModel.from_pretrained(CLIP_MODEL).to(device)
        processor = CLIPProcessor.from_pretrained(CLIP_MODEL)

        triplets = preprocessed.get("triplets", [])

        if MODE == "pretrained" or not triplets:
            print("[train] Using pre-trained CLIP weights (no fine-tuning).")
            model.eval()
            return {"model": model, "processor": processor, "device": device}

        # ── Mode C: fine-tune vision encoder with triplet margin loss ──────────
        print(f"[train] Fine-tuning CLIP vision encoder for {EPOCHS} epochs…")
        optimizer = torch.optim.AdamW(model.vision_model.parameters(), lr=LR)
        triplet_loss = torch.nn.TripletMarginLoss(margin=MARGIN, p=2)

        for epoch in range(1, EPOCHS + 1):
            model.train()
            total_loss = 0.0

            for anchor_url, pos_url, neg_url in triplets:
                optimizer.zero_grad()

                # Embed anchor, positive, negative
                emb_a = _embed_images(model, processor, [anchor_url],  device)
                emb_p = _embed_images(model, processor, [pos_url],     device)
                emb_n = _embed_images(model, processor, [neg_url],     device)

                loss = triplet_loss(emb_a, emb_p, emb_n)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()

            avg_loss = total_loss / len(triplets)
            print(f"[train] Epoch {epoch}/{EPOCHS}  avg_triplet_loss={avg_loss:.4f}")

        model.eval()
        print("[train] ✓ Fine-tuning complete")
        return {"model": model, "processor": processor, "device": device}

    # ── Predict ────────────────────────────────────────────────────────────────
    def predict(self, bundle: dict, inputs: dict) -> dict:
        """
        Accepts:
          • query_image_url + gallery_urls  → Image-to-Image similarity (Mode A)
          • query_text      + gallery_urls  → Text-to-Image search     (Mode B)
        """
        model       = bundle["model"]
        processor   = bundle["processor"]
        device      = bundle.get("device", "cpu")

        gallery_urls = inputs.get("gallery_urls", [])
        if not gallery_urls:
            raise ValueError("Provide 'gallery_urls' — the list of images to rank.")

        # Encode gallery
        gallery_embs = _embed_images(model, processor, gallery_urls, device)  # (N, D)

        # Encode query
        query_image_url = inputs.get("query_image_url")
        query_text      = inputs.get("query_text")

        if query_image_url:
            query_emb = _embed_images(model, processor, [query_image_url], device)  # (1, D)
        elif query_text:
            query_emb = _embed_text(model, processor, [query_text], device)         # (1, D)
        else:
            raise ValueError("Provide either 'query_image_url' or 'query_text'.")

        # Cosine similarity (already L2-normalised, so dot product = cosine sim)
        scores = (query_emb @ gallery_embs.T).squeeze(0).tolist()   # (N,)
        if isinstance(scores, float):
            scores = [scores]

        # Rank and return top-K
        ranked = sorted(
            [{"url": url, "score": round(s, 4)} for url, s in zip(gallery_urls, scores)],
            key=lambda x: x["score"], reverse=True
        )
        return {"results": ranked[:TOP_K]}

    def get_feature_names(self):
        return ["query_image_url", "query_text", "gallery_urls"]
