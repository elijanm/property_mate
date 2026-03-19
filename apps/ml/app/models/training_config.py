from datetime import datetime, timezone
from typing import ClassVar, Any, Dict, Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class TrainingConfig(Document):
    """Global training configuration stored in DB (overrides env defaults)."""
    COLLECTION: ClassVar[str] = "training_config"

    class Settings:
        name = "training_config"

    key: str = "global"                  # singleton document

    # ── Hardware ─────────────────────────────────────────────────────────────
    cuda_device: str = "auto"
    workers: int = 4
    batch_size: int = 32
    fp16: bool = False
    mixed_precision: str = "auto"        # auto | no | fp16 | bf16
    dataloader_pin_memory: bool = True
    prefetch_factor: int = 2

    # ── Training loop ─────────────────────────────────────────────────────────
    max_epochs: int = 100
    early_stopping: bool = True
    early_stopping_patience: int = 5

    # ── Data splitting ────────────────────────────────────────────────────────
    test_split: float = 0.2
    val_split: float = 0.0
    random_seed: int = 42

    # ── Optimisation ──────────────────────────────────────────────────────────
    optimizer: str = "adam"
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    gradient_clip: float = 0.0
    lr_scheduler: str = "cosine"
    warmup_ratio: float = 0.0

    # ── Task ──────────────────────────────────────────────────────────────────
    task: str = "classification"
    num_classes: Optional[int] = None

    # ── Freeform overrides ────────────────────────────────────────────────────
    extra: Dict[str, Any] = {}

    # ── UI preferences ────────────────────────────────────────────────────────────
    nav_layout: int = 3   # 1 = grouped flat, 2 = collapsible groups, 3 = icon rail + flyout

    # ── Debug / cost visibility ────────────────────────────────────────────────
    show_cost_debug: bool = False   # show token count + cost in AI chat + run output

    # ── Discovery / public marketplace ─────────────────────────────────────────
    discovery_enabled: bool = True  # show Discover menu on landing page
    demo_mode: bool = True          # expose all engineers/models/datasets publicly (no per-item publish)

    updated_at: datetime = Field(default_factory=utc_now)
