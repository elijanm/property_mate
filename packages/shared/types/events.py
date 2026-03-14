from typing import Any, Dict, Optional
from datetime import datetime
from pydantic import BaseModel, Field
import uuid


class BaseEventPayload(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    user_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    correlation_id: Optional[str] = None


class BillingRunPayload(BaseEventPayload):
    billing_month: str   # e.g. "2026-03" (YYYY-MM)
    sandbox: bool = False
    dry_run: bool = False
    job_id: Optional[str] = None
    property_ids: Optional[list] = None  # None = all properties in org


class LeaseCreatedPayload(BaseEventPayload):
    lease_id: str
    tenant_id: str
    unit_id: str
    property_id: str


class DocumentGeneratePayload(BaseEventPayload):
    document_type: str  # e.g. "lease_contract", "invoice"
    document_id: str
    template_id: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)


class SettlementPayoutPayload(BaseEventPayload):
    settlement_id: str
    amount: float
    currency: str = "KES"
    recipient_account: str


class MediaProcessingPayload(BaseEventPayload):
    media_id: str
    s3_key: str
    media_type: str  # e.g. "id_document", "property_photo"


class SearchIndexPayload(BaseEventPayload):
    index_name: str
    document_id: str
    action: str  # "upsert" | "delete"
    document: Optional[Dict[str, Any]] = None


class CacheInvalidatePayload(BaseEventPayload):
    keys: list[str]


class NotificationEmailPayload(BaseEventPayload):
    recipient_email: str
    subject: str
    template: str
    context: Dict[str, Any] = Field(default_factory=dict)


class PaymentWebhookPayload(BaseModel):
    provider: str  # e.g. "mpesa"
    raw_payload: Dict[str, Any]
    received_at: datetime = Field(default_factory=datetime.utcnow)


class UnitGenerationPayload(BaseEventPayload):
    job_id: str
    property_id: str
    wings: list  # List[WingConfig] serialised as dicts
    unit_templates: list  # List[UnitTemplate] serialised as dicts


class UnitEventPayload(BaseEventPayload):
    """Emitted on unit status changes (reserved, released, occupied)."""
    unit_id: str
    property_id: str
    action: str  # "reserved" | "released" | "occupied" | "vacated"
    unit_code: str
    tenant_id: Optional[str] = None


class LeaseActivatedPayload(BaseEventPayload):
    lease_id: str
    unit_id: str
    property_id: str
    tenant_id: str


class PropertyCreatedPayload(BaseEventPayload):
    property_id: str
    property_name: str
    unit_count: int
    async_generation: bool = False
    job_id: Optional[str] = None


# ── IoT Event Payloads ──────────────────────────────────────────────────────

class IoTBaseEventPayload(BaseModel):
    """IoT events do not carry a user_id (device-originated)."""
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str
    device_uid: str
    device_id: str          # MongoDB ObjectId string
    property_id: Optional[str] = None
    unit_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    correlation_id: Optional[str] = None


class IoTMeterReadingPayload(IoTBaseEventPayload):
    """Published to iot.meter_reading — PMS worker applies to billing."""
    utility_key: str        # e.g. "water", "electricity"
    meter_number: Optional[str] = None
    reading_value: float
    reading_unit: str = "m3"    # m3 | kWh | litres
    reading_at: datetime = Field(default_factory=datetime.utcnow)
    raw_telemetry: Dict[str, Any] = Field(default_factory=dict)


class IoTLockEventPayload(IoTBaseEventPayload):
    """Published to iot.lock_event — PMS worker writes to access log."""
    event_type: str         # "unlocked" | "locked" | "tamper" | "battery_low"
    triggered_by: Optional[str] = None  # user_id or "auto"
    access_method: Optional[str] = None # "pin" | "card" | "remote" | "physical"
    raw_telemetry: Dict[str, Any] = Field(default_factory=dict)


class IoTAlertPayload(IoTBaseEventPayload):
    """Published to iot.alert — PMS worker creates a maintenance ticket."""
    alert_type: str         # "smoke" | "water_leak" | "tamper" | "offline" | "custom"
    severity: str = "medium"  # low | medium | high | critical
    message: str
    raw_telemetry: Dict[str, Any] = Field(default_factory=dict)


class IoTDeviceStatusPayload(IoTBaseEventPayload):
    """Published to iot.device_status — for real-time dashboards."""
    status: str             # "online" | "offline"
    previous_status: Optional[str] = None
    ip_address: Optional[str] = None
    firmware_version: Optional[str] = None
