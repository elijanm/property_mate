from typing import Any, Dict, List, Optional
from datetime import datetime
from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel
from beanie import PydanticObjectId
from app.utils.datetime import utc_now


class TelemetryField(BaseModel):
    key: str
    label: str
    unit: Optional[str] = None
    data_type: str = "float"          # float | int | bool | string | json
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    description: Optional[str] = None


class RpcCommand(BaseModel):
    name: str
    label: str
    description: Optional[str] = None
    params_schema: Dict[str, Any] = {}  # JSON Schema for params


class DeviceType(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: Optional[str] = None        # None = platform-level type, available to all orgs

    name: str
    category: str                       # smart_lock|meter|sensor|camera|gateway|lora_node|modbus|custom
    protocol: str                       # mqtt|http|lorawan|modbus|custom

    # Schema
    telemetry_schema: List[TelemetryField] = []
    attribute_schema: List[TelemetryField] = []

    # Capabilities
    capabilities: List[str] = []       # telemetry|rpc|ota|ssh|attributes|streaming

    # RPC commands available for this type
    rpc_commands: List[RpcCommand] = []

    # OTA
    ota_supported: bool = False
    ota_firmware_s3_prefix: Optional[str] = None  # e.g. "{org_id}/ota/{device_type_id}/"

    # MQTT topic override (if non-standard device)
    topic_prefix_override: Optional[str] = None

    # ThingsBoard profile
    tb_device_profile_id: Optional[str] = None

    icon: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "iot_device_types"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("name", ASCENDING)]),
            IndexModel([("category", ASCENDING)]),
            IndexModel([("is_active", ASCENDING)]),
        ]
