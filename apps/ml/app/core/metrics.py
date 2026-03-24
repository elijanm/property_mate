"""ML service Prometheus metrics."""
from prometheus_client import Counter, Gauge, Histogram, make_asgi_app
from fastapi import FastAPI

TRAINING_JOBS_TOTAL = Counter(
    'ml_training_jobs_total',
    'Total training jobs by status and compute type',
    ['status', 'compute_type', 'trainer_name'],
)
TRAINING_DURATION_SECONDS = Histogram(
    'ml_training_duration_seconds',
    'Training job wall-clock duration in seconds',
    ['trainer_name', 'compute_type'],
    buckets=[30, 60, 300, 600, 1800, 3600, 7200, 14400, 28800],
)
ACTIVE_TRAINING_JOBS = Gauge(
    'ml_active_training_jobs',
    'Number of currently running training jobs',
)
INFERENCE_REQUESTS_TOTAL = Counter(
    'ml_inference_requests_total',
    'Total inference requests',
    ['trainer_name', 'status'],
)
INFERENCE_LATENCY_SECONDS = Histogram(
    'ml_inference_latency_seconds',
    'Inference request latency in seconds',
    ['trainer_name'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)
SANDBOX_QUEUE_DEPTH = Gauge(
    'ml_sandbox_queue_depth',
    'Number of jobs waiting in sandbox queue',
    ['tier'],
)
MODEL_DEPLOYMENTS_ACTIVE = Gauge(
    'ml_model_deployments_active',
    'Number of active model deployments',
    ['trainer_name'],
)
TRAINER_SUBMISSIONS_TOTAL = Counter(
    'ml_trainer_submissions_total',
    'Trainer file submissions by outcome',
    ['outcome'],  # approved | flagged | rejected | fast_path
)
WALLET_CHARGES_TOTAL = Counter(
    'ml_wallet_charges_usd_total',
    'Total USD charged to wallets by compute type',
    ['compute_type'],
)
SCAN_DURATION_SECONDS = Histogram(
    'ml_security_scan_duration_seconds',
    'Security scan duration in seconds',
    ['scan_type'],  # ast | llm | clamav
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 15.0, 30.0],
)
HTTP_REQUESTS_TOTAL = Counter(
    'ml_http_requests_total',
    'Total HTTP requests to the ML service',
    ['method', 'endpoint', 'status_code'],
)
HTTP_REQUEST_DURATION_SECONDS = Histogram(
    'ml_http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)


def setup_metrics(app: FastAPI) -> None:
    """Mount the /metrics endpoint on the FastAPI app."""
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)
