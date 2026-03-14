from fastapi import FastAPI
from prometheus_client import Counter, Histogram, make_asgi_app

REQUEST_COUNT = Counter(
    "pms_http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "pms_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

# ── Property & Unit metrics ───────────────────────────────────────────────────

PROPERTIES_CREATED = Counter(
    "pms_properties_created_total",
    "Total properties created",
    ["org_id"],
)

UNITS_GENERATED = Counter(
    "pms_units_generated_total",
    "Total units generated",
    ["org_id", "generation_mode"],  # generation_mode: sync | async
)

UNIT_BULK_UPDATES = Counter(
    "pms_unit_bulk_updates_total",
    "Total unit bulk-update operations",
    ["org_id"],
)

UNIT_RESERVATION_CONFLICTS = Counter(
    "pms_unit_reservation_conflicts_total",
    "Unit reservation lock conflicts (409s)",
    ["org_id"],
)

UNIT_ASSIGNMENTS = Counter(
    "pms_unit_assignments_total",
    "Total unit assignments (lease activations)",
    ["org_id"],
)

UNIT_CONFIGURATION_CHANGES = Counter(
    "pms_unit_configuration_changes_total",
    "Total unit configuration changes (PATCH)",
    ["org_id"],
)


def setup_metrics(app: FastAPI) -> None:
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)
