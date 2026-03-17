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
