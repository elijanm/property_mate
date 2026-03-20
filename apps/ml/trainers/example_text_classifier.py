# @trainer
# Name: Ticket Classifier
# Version: 1.0.0
# Author: Mldock Team
# Author Email: hello@mldock.io
# Author URL: https://mldock.io
# Description: Classifies maintenance ticket text into property-management categories using DistilBERT
# Commercial: public
# Downloadable: true
# Protect Model: false
# License: MIT
# Tags: nlp, classification, pytorch, tickets

"""
Example text classifier — classifies maintenance ticket descriptions into categories.

Demonstrates:
  - HuggingFaceDataSource (swap InMemory for real training data)
  - Fine-tuning a DistilBERT model with auto_train_torch()
  - GPU + mixed-precision via TrainingConfig
  - AdamW + cosine LR scheduler with warmup
  - input_schema with text field type
  - output_schema with top-k labels

Trigger training:
    POST /api/v1/training/start
    { "trainer_name": "ticket_classifier" }

Run inference:
    POST /api/v1/inference/ticket_classifier
    { "inputs": { "text": "Water leaking from ceiling in bathroom" } }
"""
from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig, OutputFieldSpec
from app.abstract.data_source import InMemoryDataSource


_CATEGORIES = [
    "plumbing",
    "electrical",
    "structural",
    "hvac",
    "appliance",
    "pest_control",
    "cleaning",
    "other",
]

# Training samples per category (synthetic)
_SAMPLES = {
    "plumbing":      ["leaking pipe", "blocked drain", "water pressure low", "toilet overflowing", "shower dripping"],
    "electrical":    ["power outage", "socket not working", "circuit breaker tripped", "flickering lights", "no hot water heater"],
    "structural":    ["crack in wall", "ceiling falling", "floor warped", "door not closing", "window broken"],
    "hvac":          ["AC not cooling", "heater broken", "bad smell from vents", "noisy air conditioner", "thermostat fault"],
    "appliance":     ["fridge not cold", "washing machine broken", "dishwasher leaking", "oven not heating", "microwave sparking"],
    "pest_control":  ["cockroaches", "mice in unit", "bed bugs", "ants in kitchen", "termites in wood"],
    "cleaning":      ["mold on walls", "grease buildup", "carpet stained", "rubbish not collected", "pool dirty"],
    "other":         ["key lost", "letterbox broken", "parking issue", "noise complaint", "neighbour dispute"],
}


class TicketClassifier(BaseTrainer):
    name = "ticket_classifier"
    version = "1.0.0"
    description = "Classifies maintenance ticket text into property-management categories using DistilBERT fine-tuning"
    framework = "pytorch"
    schedule = None
    data_source = InMemoryDataSource()
    category = {"key": "nlp", "label": "NLP"}

    output_display = [
        OutputFieldSpec("category",   "label",      "Category",    primary=True,
                        hint="Enter the correct ticket category"),
        OutputFieldSpec("confidence", "confidence", "Confidence"),
        OutputFieldSpec("top3",       "ranked_list", "Top Predictions"),
    ]

    input_schema = {
        "text": {
            "type": "string",
            "label": "Ticket Description",
            "required": True,
            "description": "Free-text description of the maintenance issue.",
            "example": "Water leaking from the ceiling in the bathroom near the shower.",
        },
    }

    output_schema = {
        "category": {
            "type": "text",
            "label": "Category",
            "editable": True,
            "description": "Top predicted maintenance category.",
        },
        "confidence": {
            "type": "number",
            "label": "Confidence",
            "format": "percent",
            "description": "Model confidence for the top category.",
        },
        "top3": {
            "type": "json",
            "label": "Top 3 Predictions",
            "description": "Top 3 categories with probabilities.",
        },
    }

    # ── preprocessing ─────────────────────────────────────────────────────────

    def preprocess(self, raw_data):
        """
        Build a simple synthetic dataset.
        In production replace InMemoryDataSource with a MongoDBDataSource or
        HuggingFaceDataSource that pulls real ticket data.
        """
        texts, labels = [], []
        for label_idx, (cat, samples) in enumerate(_SAMPLES.items()):
            for text in samples * 20:          # repeat to get 100 samples/class
                texts.append(text)
                labels.append(label_idx)
        return texts, labels

    # ── training ──────────────────────────────────────────────────────────────

    def train(self, preprocessed, config: TrainingConfig):
        try:
            import torch
            from torch.utils.data import Dataset, random_split
            from transformers import DistilBertTokenizerFast, DistilBertForSequenceClassification
        except ImportError:
            raise ImportError(
                "transformers and torch are required for TicketClassifier. "
                "Install with: pip install transformers torch"
            )

        texts, labels = preprocessed
        config.task = "nlp_classification"
        config.optimizer = "adamw"
        config.warmup_ratio = 0.1

        tokenizer = DistilBertTokenizerFast.from_pretrained("distilbert-base-uncased")

        class _TextDataset(Dataset):
            def __init__(self, texts, labels):
                enc = tokenizer(texts, truncation=True, padding=True, max_length=128, return_tensors="pt")
                self.input_ids      = enc["input_ids"]
                self.attention_mask = enc["attention_mask"]
                self.labels         = torch.tensor(labels, dtype=torch.long)
            def __len__(self):
                return len(self.labels)
            def __getitem__(self, i):
                return {
                    "input_ids":      self.input_ids[i],
                    "attention_mask": self.attention_mask[i],
                    "labels":         self.labels[i],
                }

        dataset = _TextDataset(texts, labels)
        n = len(dataset)
        n_test  = max(1, int(n * config.test_split))
        n_val   = max(1, int(n * config.val_split)) if config.val_split > 0 else 0
        n_train = n - n_test - n_val
        splits  = [n_train, n_val, n_test] if n_val else [n_train, n_test]
        parts   = random_split(
            dataset, splits,
            generator=torch.Generator().manual_seed(config.random_seed),
        )
        train_ds, test_ds = parts[0], parts[-1]
        val_ds = parts[1] if n_val else None

        model = DistilBertForSequenceClassification.from_pretrained(
            "distilbert-base-uncased", num_labels=len(_CATEGORIES)
        )

        self.log_device_info(config)

        trained = self.auto_train_torch(
            model,
            self.build_dataloader(train_ds, config),
            config,
            val_loader=self.build_dataloader(val_ds, config, shuffle=False) if val_ds else None,
        )

        # Store tokenizer path on instance so predict() can reload it
        self._tokenizer = tokenizer
        return trained, (test_ds, labels)

    # ── evaluation ────────────────────────────────────────────────────────────

    def evaluate(self, model, test_data):
        import torch
        from sklearn.metrics import accuracy_score, f1_score

        test_ds, _ = test_data
        loader = self.build_dataloader(test_ds, TrainingConfig(), shuffle=False)
        model.eval()
        y_true, y_pred = [], []
        with torch.no_grad():
            for batch in loader:
                logits = model(**{k: v for k, v in batch.items() if k != "labels"}).logits
                preds  = logits.argmax(dim=1).tolist()
                y_pred.extend(preds)
                y_true.extend(batch["labels"].tolist())

        return EvaluationResult(
            accuracy=float(accuracy_score(y_true, y_pred)),
            f1=float(f1_score(y_true, y_pred, average="macro")),
            y_true=y_true,
            y_pred=y_pred,
        )

    # ── inference ─────────────────────────────────────────────────────────────

    def predict(self, model, inputs):
        import torch
        import torch.nn.functional as F
        from transformers import DistilBertTokenizerFast

        text = inputs.get("text", "") if isinstance(inputs, dict) else str(inputs)
        tokenizer = DistilBertTokenizerFast.from_pretrained("distilbert-base-uncased")

        enc = tokenizer(text, truncation=True, padding=True, max_length=128, return_tensors="pt")
        model.eval()
        with torch.no_grad():
            logits = model(**enc).logits
        probs  = F.softmax(logits, dim=-1).squeeze(0)
        top3_idx = probs.topk(3).indices.tolist()
        top3 = [{"category": _CATEGORIES[i], "confidence": round(float(probs[i]), 4)} for i in top3_idx]

        return {
            "category":   _CATEGORIES[top3_idx[0]],
            "confidence": top3[0]["confidence"],
            "top3":       top3,
        }

    def get_class_names(self):
        return _CATEGORIES
