from typing import Literal, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "PMS ML Service"
    HOST: str = "0.0.0.0"
    PORT: int = 8030
    LOG_LEVEL: str = "INFO"

    # MongoDB
    MONGODB_URL: str = "mongodb://mongodb:27017"
    MONGODB_DATABASE: str = "pms_ml"

    # Redis
    REDIS_URL: str = "redis://redis:6379"

    # MLflow
    MLFLOW_TRACKING_URI: str = "http://mlflow:5000"
    MLFLOW_DEFAULT_EXPERIMENT: str = "pms-models"

    # S3
    S3_ENDPOINT_URL: str = "http://minio:9000"           # internal Docker endpoint
    S3_PUBLIC_ENDPOINT_URL: str = ""                     # public MinIO URL — used for presigned GET + upload part URLs
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "pms-ml"
    S3_REGION: str = "us-east-1"
    # When set, public object URLs are constructed as MEDIA_BASE_URL/BUCKET/key
    # (no presigning). Use for production CDN/public MinIO, e.g. http://media.mldock.io
    MEDIA_BASE_URL: str = ""

    # PMS Backend
    PMS_API_URL: str = "http://backend:8000/api/v1"
    PMS_SERVICE_TOKEN: str = ""

    # Training hardware config
    CUDA_DEVICE: str = "auto"           # auto | cpu | cuda | cuda:0 | cuda:1
    TRAINING_WORKERS: int = 4
    TRAINING_BATCH_SIZE: int = 32
    TRAINING_FP16: bool = False
    TRAINING_MIXED_PRECISION: str = "auto"  # auto | no | fp16 | bf16
    TRAINING_MAX_EPOCHS: int = 100
    TRAINING_EARLY_STOPPING: bool = True
    TRAINING_EARLY_STOPPING_PATIENCE: int = 5

    # Data splitting
    TRAINING_TEST_SPLIT: float = 0.2
    TRAINING_VAL_SPLIT: float = 0.0
    TRAINING_RANDOM_SEED: int = 42

    # Optimisation
    TRAINING_OPTIMIZER: str = "adam"
    TRAINING_LEARNING_RATE: float = 1e-3
    TRAINING_WEIGHT_DECAY: float = 1e-4
    TRAINING_GRADIENT_CLIP: float = 0.0
    TRAINING_LR_SCHEDULER: str = "cosine"
    TRAINING_WARMUP_RATIO: float = 0.0

    # Task
    TRAINING_TASK: str = "classification"

    # Plugin directory
    TRAINER_PLUGIN_DIR: str = "/app/trainers"

    # Preprocess timeout (seconds) — applied to trainer.preprocess() in training runs
    TRAINER_PREPROCESS_TIMEOUT: int = 300

    # ── Trainer sandbox (Docker isolation) ────────────────────────────────────
    # TRAINER_SANDBOX=none        → run trainer in-process (default, existing behaviour)
    # TRAINER_SANDBOX=docker      → cold docker run per job (isolated, higher latency)
    # TRAINER_SANDBOX=docker-pool → pre-warmed container pool (low latency, auto-scaling)
    TRAINER_SANDBOX: str = "none"
    TRAINER_SANDBOX_IMAGE: str = "pms-ml-sandbox:latest"
    # Named Docker volume shared between ml-worker and spawned sandbox containers.
    # Must match the volume name in docker-compose.yml.
    TRAINER_SANDBOX_VOLUME: str = "ml_sandbox_workspace"
    # Path where the named volume is mounted inside the ml-worker container.
    TRAINER_SANDBOX_WORKSPACE: str = "/sandbox_workspace"
    TRAINER_SANDBOX_MEMORY: str = "2g"
    TRAINER_SANDBOX_CPUS: str = "2"
    TRAINER_SANDBOX_PIDS: int = 128
    TRAINER_SANDBOX_TIMEOUT: int = 600   # seconds before container is killed
    TRAINER_SANDBOX_USER: str = "65534"  # nobody

    # ── docker-pool mode settings ──────────────────────────────────────────────
    # Redis URL visible inside sandbox containers (Docker network alias for Redis)
    SANDBOX_POOL_AGENT_REDIS_URL: str = "redis://redis:6379"
    # Docker bridge network that sandbox containers join for Redis-only access
    # Must be an internal network (no internet egress)
    SANDBOX_POOL_NETWORK: str = "pms_sandbox_net"
    # Pool sizing
    SANDBOX_POOL_MIN_SIZE: int = 2          # minimum containers always running
    SANDBOX_POOL_MAX_SIZE: int = 10         # hard cap on pool size
    SANDBOX_POOL_MIN_IDLE: int = 1          # minimum idle containers before scale-up
    # Timing
    SANDBOX_POOL_HEALTH_INTERVAL: int = 15      # seconds between health-check sweeps
    SANDBOX_POOL_REPLENISH_INTERVAL: int = 10   # seconds between replenishment checks
    SANDBOX_POOL_HEARTBEAT_TIMEOUT: int = 30    # seconds without heartbeat → dead
    SANDBOX_POOL_ACQUIRE_TIMEOUT: float = 30.0  # seconds to wait for an idle container
    SANDBOX_POOL_SCALE_UP_COOLDOWN: int = 30    # seconds between scale-up events
    SANDBOX_POOL_SCALE_DOWN_COOLDOWN: int = 120 # seconds between scale-down events
    SANDBOX_POOL_SCALE_DOWN_THRESHOLD: float = 0.1  # req/s below which scale-down is allowed
    SANDBOX_POOL_SCALE_DOWN_BATCH: int = 2          # max containers drained per scale-down
    SANDBOX_POOL_IDLE_HEADROOM_FACTOR: float = 1.5  # multiply predicted demand for idle target
    SANDBOX_POOL_SPAWN_LEAD_TIME_SECS: float = 8.0  # estimated container boot + warm time

    # Admin password — required for destructive security operations (ban/unban/delete)
    ADMIN_PASSWORD: str = "changeme"

    # JWT authentication
    JWT_SECRET: str = "change-this-jwt-secret-in-production"
    JWT_ACCESS_HOURS: int = 8
    JWT_REFRESH_DAYS: int = 30

    # Default admin created on first startup
    DEFAULT_ADMIN_EMAIL: str = "admin@pms-ml.local"
    DEFAULT_ADMIN_PASSWORD: str = "Admin@123456"

    # Cloud GPU providers
    RUNPOD_API_KEY: str = ""
    RUNPOD_CONTAINER_DISK_GB: int = 20   # container disk size in GB for on-demand pods

    LAMBDA_LABS_API_KEY: str = ""
    LAMBDA_LABS_SSH_KEY_NAME: str = ""
    LAMBDA_LABS_INSTANCE_TYPE: str = "gpu_1x_a10"

    MODAL_TOKEN_ID: str = ""
    MODAL_TOKEN_SECRET: str = ""
    MODAL_APP_ID: str = ""          # pre-created Modal app containing a "train" function

    # Email (Resend)
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "MLDock.io <noreply@mldock.io>"
    APP_BASE_URL: str = "http://localhost:8030"   # backend public base URL (API callbacks, webhooks)
    FRONTEND_BASE_URL: str = "http://localhost:5200"  # ML UI public URL (email links: collect, activate)

    # Paystack (wallet top-up)
    PAYSTACK_SECRET_KEY: str = ""
    PAYSTACK_PUBLIC_KEY: str = ""

    # Currency
    USD_TO_KES_RATE: float = 130.0   # update as needed; used for GPU price display + billing

    # Africa's Talking (airtime redemption for annotators)
    AT_API_KEY: str = ""
    AT_USERNAME: str = "sandbox"
    AT_SHORTCODE: str = ""                      # Sender ID for airtime

    # Annotator rewards config
    POINTS_TO_KES_RATE: float = 0.1            # 1 point = KES 0.10 → 100 pts = KES 10
    MIN_REDEMPTION_POINTS: int = 100

    # Disposable email detection (shared ML inference service)
    disposable_email_check_url: str = ""
    disposable_email_api_key: str = ""

    def get_device(self) -> str:
        if self.CUDA_DEVICE == "auto":
            try:
                import torch
                return "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                return "cpu"
        return self.CUDA_DEVICE


settings = Settings()
