from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    app_env: str = "development"
    app_version: str = "0.1.0"
    secret_key: str = "change-me"

    # JWT
    jwt_secret: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # MongoDB
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "pms"
    mongo_max_pool_size: int = 50

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    redis_max_connections: int = 20

    # RabbitMQ
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    rabbitmq_prefetch_count: int = 10

    # OpenSearch
    opensearch_host: str = "localhost"
    opensearch_port: int = 9200
    opensearch_user: str = "admin"
    opensearch_password: str = "admin"
    opensearch_use_ssl: bool = False
    opensearch_verify_certs: bool = False

    # S3
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = ""  # public URL for presigned links; defaults to s3_endpoint_url
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket_name: str = "pms-media"
    s3_region: str = "us-east-1"
    s3_presigned_url_expires: int = 86400  # seconds; default 24 h

    # Email (Resend)
    resend_api_key: str = ""
    email_from: str = "PMS <noreply@example.com>"
    app_base_url: str = "http://localhost:5173"

    # CORS
    cors_origins: List[str] = Field(
        default=["http://localhost:5173", "http://localhost:3000"]
    )

    # Mpesa Daraja
    mpesa_env: str = "sandbox"  # sandbox | production
    mpesa_consumer_key: str = ""
    mpesa_consumer_secret: str = ""
    mpesa_shortcode: str = ""
    mpesa_passkey: str = ""
    mpesa_stk_callback_url: str = ""
    mpesa_b2c_initiator_name: str = ""
    mpesa_b2c_security_credential: str = ""
    mpesa_b2c_queue_timeout_url: str = ""
    mpesa_b2c_result_url: str = ""

    # OpenAI-compatible Vision API (for meter reading AI)
    openai_base_url: str = "http://host.docker.internal:8090/v1" #"https://ollama.fileq.io/v1"
    openai_api_key: str = "test"
    openai_model: str = "llama3.1:8b"

    # MFA / TOTP
    mfa_encryption_key: str = "change-me-mfa-key-32-bytes-long!!"  # must be >= 32 chars
    mfa_session_ttl_seconds: int = 300   # 5 minutes
    mfa_issuer_name: str = "PMS"

    # Disposable email detection (ML inference)
    disposable_email_check_url: str = ""   # e.g. http://ml:5200/api/v1/inference/<org>/throwaway_email_detector
    disposable_email_api_key: str = ""

    # Voice Agent service (internal)
    voice_agent_url: str = "http://voice-agent:8010"

    # WuzAPI (WhatsApp gateway)
    wuzapi_url: str = "http://wuzapi:8080"
    wuzapi_admin_token: str = "changeme-wuzapi-admin"
    # Public-facing backend URL used to build per-instance webhook URLs sent to WuzAPI
    wuzapi_backend_webhook_base: str = "http://backend:8000"

    # Logging
    log_level: str = "INFO"

    # Observability
    otel_service_name: str = "pms-backend"
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"


settings = Settings()
