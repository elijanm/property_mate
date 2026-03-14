"""Store / warehouse location models."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class StoreConfig(BaseModel):
    """Property-level store management configuration."""
    allow_segmentation: bool = True       # enable zone/aisle/rack/bay/level/bin hierarchy
    allow_labelling: bool = True          # custom labels/codes per zone
    allow_owner_assignment: bool = True   # assign officer per store/zone
    default_capacity_unit: str = "units"  # units | kg | pallets | boxes | litres


class StoreLocation(Document):
    """
    A storage location within a property.
    Hierarchy: store → zone → aisle → rack → bay → level → bin   (depth 0–6)
    Multiple stores are allowed per property.
    """
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str
    property_id: str
    entity_type: str = "property"        # "property" | "farm" | "site" — entity abstraction
    entity_id: Optional[str] = None     # mirrors property_id; backfilled by migration script

    # ── Identity ─────────────────────────────────────────────────────────────
    name: str
    code: str                               # e.g. "WH-A", "A3", "B2", "F1"
    label: Optional[str] = None            # custom display label / planogram label
    description: Optional[str] = None

    # ── Hierarchy ─────────────────────────────────────────────────────────────
    # location_type: store | zone | aisle | rack | bay | level | bin
    location_type: str = "store"
    parent_id: Optional[str] = None        # parent StoreLocation id (str of ObjectId)
    store_id: Optional[str] = None         # root store id (None when type==store)
    path: str = ""                          # breadcrumb: "WH-A / Zone A / Aisle 3 / Rack B"
    depth: int = 0                          # 0=store, 1=zone, 2=aisle, 3=rack, 4=bay, 5=level, 6=bin
    sort_order: int = 0

    # ── Capacity ──────────────────────────────────────────────────────────────
    capacity_value: Optional[float] = None
    # units | kg | pallets | boxes | litres | sqm
    capacity_unit: str = "units"
    current_occupancy: float = 0.0         # updated on stock movement
    occupancy_pct: float = 0.0             # current_occupancy / capacity_value * 100

    # ── Assignment ────────────────────────────────────────────────────────────
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None

    # ── Physical / planogram attributes ──────────────────────────────────────
    # e.g. {"width": "2m", "height": "3m", "temperature": "cold", "rack_type": "pallet"}
    attributes: Dict[str, Any] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    # active | inactive | maintenance
    status: str = "active"
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        collection = "store_locations"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("property_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("store_id", ASCENDING), ("deleted_at", ASCENDING)]),
            IndexModel([("org_id", ASCENDING), ("parent_id", ASCENDING)]),
        ]
