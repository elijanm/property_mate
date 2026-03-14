from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Application
    app_env: str = "development"
    app_version: str = "0.1.0"
    secret_key: str = "change-me"
    log_level: str = "INFO"

    # JWT — must match PMS backend secret to validate the same tokens
    jwt_secret: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"

    # MongoDB
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "pms_iot"
    mongo_max_pool_size: int = 30

    # Redis (DB 2 — separate from backend DB 0 and worker DB 1)
    redis_url: str = "redis://localhost:6379/2"

    # RabbitMQ (shared with PMS backend)
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"

    # S3
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = ""
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket_name: str = "pms-iot"
    s3_region: str = "us-east-1"

    # EMQX Management API
    emqx_api_url: str = "http://localhost:18083"
    emqx_api_key: str = ""
    emqx_api_secret: str = ""
    # Shared secret sent by EMQX in X-Internal-Secret header on auth hook calls
    iot_internal_secret: str = "change-me-internal-secret"

    # MQTT (IoT service's own subscriber account)
    mqtt_broker_host: str = "localhost"
    mqtt_broker_port: int = 1883
    mqtt_username: str = "iot-service"
    mqtt_password: str = "change-me-mqtt-password"
    mqtt_client_id: str = "iot-service-subscriber"
    mqtt_use_tls: bool = False
    mqtt_keepalive: int = 60
    mqtt_clean_start: bool = False  # Keep session so EMQX buffers QoS1+ during downtime

    # ThingsBoard
    thingsboard_url: str = "http://localhost:9090"
    thingsboard_sysadmin_email: str = "sysadmin@thingsboard.org"
    thingsboard_sysadmin_password: str = "sysadmin"

    # Headscale
    headscale_url: str = "http://localhost:8085"
    headscale_api_key: str = ""
    headscale_acl_lock_ttl_s: int = 10  # Redis lock TTL for ACL updates
    # Public Headscale login-server URL reachable by devices (may differ from headscale_url)
    headscale_public_url: str = "http://localhost:8085"
    # Default Headscale namespace/user that devices join
    headscale_namespace: str = "pms-devices"

    # PMS backend
    pms_backend_url: str = "http://localhost:8000/api/v1"

    # SSH access defaults
    ssh_default_duration_m: int = 60
    ssh_max_duration_m: int = 480  # 8 hours max

    # Email (Resend) — same API key as PMS backend
    resend_api_key: str = ""
    email_from: str = "PMS IoT <noreply@example.com>"

    # Public-facing IoT service URL (used to build approve/deny email links)
    iot_service_public_url: str = "http://localhost:8020"

    # Internal CA — used by ca_service to issue per-device mTLS client certificates.
    # Store as single-line with literal \n, e.g.:
    #   IOT_CA_CERT_PEM=-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----
    # Generate with: bash scripts/gen-certs.sh
    iot_ca_cert_pem: Optional[str] = None
    iot_ca_key_pem: Optional[str] = None
    iot_ca_key_passphrase: Optional[str] = None
    iot_cert_validity_days: int = 365

    # SSH Console (WebSocket SSH proxy for browser-based terminal)
    # Path to the private key the IoT service uses to SSH into devices.
    # The matching public key must be in authorized_keys on the device.
    # Key pair is auto-generated at startup if the file does not exist.
    ssh_console_key_path: str = "/etc/iot/ssh/id_ed25519"
    ssh_console_username: str = "root"           # default login user on devices

    # CORS
    cors_origins: List[str] = Field(
        default=["http://localhost:5173", "http://localhost:3000"]
    )


settings = Settings()
