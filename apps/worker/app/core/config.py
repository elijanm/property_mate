from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # RabbitMQ
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    rabbitmq_prefetch_count: int = 10

    # MongoDB
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "pms"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # OpenSearch
    opensearch_host: str = "localhost"
    opensearch_port: int = 9200
    opensearch_user: str = "admin"
    opensearch_password: str = "admin"
    opensearch_use_ssl: bool = False
    opensearch_verify_certs: bool = False

    # Email (Resend)
    resend_api_key: str = ""
    email_from: str = "PMS <noreply@example.com>"
    app_base_url: str = "http://localhost:5173"

    # Logging
    log_level: str = "INFO"

    # Observability
    otel_service_name: str = "pms-worker"


settings = WorkerSettings()
