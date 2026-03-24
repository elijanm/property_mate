from datetime import datetime, timezone
from typing import ClassVar, Any, Dict, List, Optional
from beanie import Document
from pydantic import Field


def utc_now():
    return datetime.now(timezone.utc)


class TrainerRegistration(Document):
    COLLECTION: ClassVar[str] = "trainer_registrations"

    class Settings:
        name = "trainer_registrations"

    org_id: str = ""              # tenant workspace; "" = system-wide (visible to all)
    name: str
    version: str = "1.0.0"
    description: str = ""
    framework: str = "custom"
    schedule: Optional[str] = None
    data_source_info: Dict[str, Any] = {}
    class_path: str = ""                  # module.ClassName for dynamic loading
    plugin_file: Optional[str] = None     # path to .py file
    tags: Dict[str, str] = {}
    category: str = ""              # e.g. "detection", "classification", "segmentation"

    # Namespace/identity
    namespace: str = "system"           # "system" for built-ins, org_id for user uploads
    full_name: str = ""                 # "{namespace}/{name}" computed key
    alias: str = ""                     # short human-readable inference URL slug

    # Marketplace metadata (parsed from header comments)
    author: str = ""
    author_email: str = ""
    author_url: str = ""
    git_url: str = ""
    commercial: str = "public"          # "public" | "private" | "commercial"
    activation_cost_usd: float = 0.0    # wallet deduction required to clone/activate (0 = free)
    downloadable: bool = False
    protect_model: bool = False
    # Fine-grained visibility / downloadability controls (replaces downloadable + protect_model)
    trainer_visible: bool = True          # show trainer card in marketplace/listings
    trainer_source_downloadable: bool = False  # allow .py source code download
    trainer_model_visible: bool = True    # show deployed model in inference catalog
    trainer_model_downloadable: bool = False   # allow model artifact (.pkl) download
    icon_url: str = ""
    license: str = ""

    # Version lineage
    base_name: str = ""            # base name without _vN suffix (same as name for v0)
    version_num: int = 1           # legacy field; use plugin_version instead
    # Plugin version: 0 = base file (no _vN suffix), 1 = _v1, 2 = _v2, …
    # Corresponds to the .py filename variant.  Combined with latest_training_patch
    # it forms the full version string: v{plugin_version}.0.0.{latest_training_patch}
    plugin_version: int = 0
    # Incremented each time a training job completes successfully for this plugin file.
    # Denormalised from the latest ModelDeployment for fast display.
    latest_training_patch: int = 0
    cloned_from_org_id: str = ""   # source org_id when cloned across orgs

    # Clone hierarchy
    parent_trainer_id: Optional[str] = None
    clone_depth: int = 0

    # Submission & approval
    submission_id: Optional[str] = None
    submission_hash: str = ""           # sha256(org_id + ":" + file_bytes)
    approved_content_hash: str = ""     # hash of the exact file content that was approved
    approval_status: str = "approved"   # "approved" | "pending_review" | "flagged" | "rejected"
    rejection_reason: str = ""          # reason shown to user on rejection

    # "public"  = system/global_sample trainers — visible to all orgs, clone-only
    # "private" = org-owned trainers — only visible to that org, fully runnable
    visibility: str = "public"       # default "public" for system; set to "private" on insert for org trainers

    is_active: bool = True
    is_sample: bool = False          # iris/wine/digits — visible to all roles
    owner_email: Optional[str] = None
    last_trained_at: Optional[datetime] = None

    # Resource overrun tracking
    estimated_duration_minutes: int = 60   # trainer-declared expected runtime
    resource_intensive: bool = False       # blocked from local execution if True
    overrun_count: int = 0                 # how many times actual > 3x estimate

    # How to display predict() outputs in the UI (list of OutputFieldSpec dicts).
    # Empty = use the generic heuristic renderer.
    output_display: List[Dict[str, Any]] = []
    # Optional derived metrics computed from InferenceFeedback (list of DerivedMetricSpec dicts).
    derived_metrics: List[Dict[str, Any]] = []

    registered_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
