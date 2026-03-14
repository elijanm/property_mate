"""
MQTT topic structure:
  Device publishes:
    pms/{org_id}/{property_id}/{device_uid}/telemetry
    pms/{org_id}/{property_id}/{device_uid}/attributes
    pms/{org_id}/{property_id}/{device_uid}/status
    pms/{org_id}/{property_id}/{device_uid}/rpc/response
    pms/{org_id}/{property_id}/{device_uid}/ota/progress

  Platform publishes (to device):
    pms/{org_id}/{property_id}/{device_uid}/rpc/request
    pms/{org_id}/{property_id}/{device_uid}/ota/command

  Gateway:
    gw/{org_id}/{property_id}/{gateway_uid}/status
    gw/{org_id}/{property_id}/{gateway_uid}/{device_uid}/telemetry
"""
import re
from typing import Optional
from dataclasses import dataclass


# ── Topic patterns ─────────────────────────────────────────────────────────

_DEVICE_PATTERN = re.compile(
    r"^pms/(?P<org_id>[^/]+)/(?P<property_id>[^/]+)/(?P<device_uid>[^/]+)/(?P<suffix>.+)$"
)

_GATEWAY_PATTERN = re.compile(
    r"^gw/(?P<org_id>[^/]+)/(?P<property_id>[^/]+)/(?P<gateway_uid>[^/]+)(/(?P<rest>.*))?$"
)

DEVICE_SUFFIX_TELEMETRY  = "telemetry"
DEVICE_SUFFIX_ATTRIBUTES = "attributes"
DEVICE_SUFFIX_STATUS     = "status"
DEVICE_SUFFIX_RPC_RESP   = "rpc/response"
DEVICE_SUFFIX_RPC_REQ    = "rpc/request"
DEVICE_SUFFIX_OTA_PROG   = "ota/progress"
DEVICE_SUFFIX_OTA_CMD    = "ota/command"


@dataclass
class DeviceTopic:
    org_id: str
    property_id: str
    device_uid: str
    suffix: str

    @property
    def is_telemetry(self): return self.suffix == DEVICE_SUFFIX_TELEMETRY
    @property
    def is_attributes(self): return self.suffix == DEVICE_SUFFIX_ATTRIBUTES
    @property
    def is_status(self): return self.suffix == DEVICE_SUFFIX_STATUS
    @property
    def is_rpc_response(self): return self.suffix == DEVICE_SUFFIX_RPC_RESP
    @property
    def is_ota_progress(self): return self.suffix == DEVICE_SUFFIX_OTA_PROG


@dataclass
class GatewayTopic:
    org_id: str
    property_id: str
    gateway_uid: str
    rest: Optional[str]

    @property
    def is_status(self): return self.rest is None or self.rest == "status"


def parse_device_topic(topic: str) -> Optional[DeviceTopic]:
    m = _DEVICE_PATTERN.match(topic)
    if not m:
        return None
    return DeviceTopic(
        org_id=m.group("org_id"),
        property_id=m.group("property_id"),
        device_uid=m.group("device_uid"),
        suffix=m.group("suffix"),
    )


def parse_gateway_topic(topic: str) -> Optional[GatewayTopic]:
    m = _GATEWAY_PATTERN.match(topic)
    if not m:
        return None
    return GatewayTopic(
        org_id=m.group("org_id"),
        property_id=m.group("property_id"),
        gateway_uid=m.group("gateway_uid"),
        rest=m.group("rest"),
    )


def device_topic(org_id: str, property_id: str, device_uid: str, suffix: str) -> str:
    return f"pms/{org_id}/{property_id}/{device_uid}/{suffix}"


def gateway_topic(org_id: str, property_id: str, gateway_uid: str, suffix: str = "status") -> str:
    return f"gw/{org_id}/{property_id}/{gateway_uid}/{suffix}"


def acl_allowed_publish_topics(org_id: str, property_id: str, device_uid: str) -> list[str]:
    """Topics the device is allowed to publish to."""
    base = f"pms/{org_id}/{property_id}/{device_uid}"
    return [
        f"{base}/telemetry",
        f"{base}/attributes",
        f"{base}/status",
        f"{base}/rpc/response",
        f"{base}/ota/progress",
    ]


def acl_allowed_subscribe_topics(org_id: str, property_id: str, device_uid: str) -> list[str]:
    """Topics the device is allowed to subscribe to."""
    base = f"pms/{org_id}/{property_id}/{device_uid}"
    return [
        f"{base}/rpc/request",
        f"{base}/ota/command",
    ]
