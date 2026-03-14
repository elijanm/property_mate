from prometheus_client import Counter, Gauge, make_asgi_app
from fastapi import FastAPI

IOT_MQTT_MESSAGES = Counter("iot_mqtt_messages_total", "MQTT messages received", ["topic_type"])
IOT_DEVICES_ONLINE = Gauge("iot_devices_online_total", "Devices currently online", ["org_id"])
IOT_COMMANDS_SENT = Counter("iot_commands_sent_total", "RPC commands sent", ["org_id", "status"])
IOT_EMQX_AUTH = Counter("iot_emqx_auth_decisions_total", "EMQX auth decisions", ["result"])
IOT_SSH_GRANTS = Gauge("iot_ssh_grants_active_total", "Active SSH grants", ["org_id"])
IOT_TB_SYNC_ERRORS = Counter("iot_thingsboard_sync_errors_total", "ThingsBoard sync errors", ["operation"])
IOT_HEADSCALE_CALLS = Counter("iot_headscale_api_calls_total", "Headscale API calls", ["operation", "status"])


def setup_metrics(app: FastAPI) -> None:
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)
