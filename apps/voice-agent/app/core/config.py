from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Service ─────────────────────────────────────────────────────────────
    APP_NAME: str = "PMS Voice Agent"
    HOST: str = "0.0.0.0"
    PORT: int = 8010
    PUBLIC_BASE_URL: str = "https://your-public-url.example.com"  # must be reachable by Telnyx
    LOG_LEVEL: str = "INFO"

    # ── MongoDB ──────────────────────────────────────────────────────────────
    MONGODB_URL: str = "mongodb://mongodb:27017"
    MONGODB_DATABASE: str = "pms"

    # ── Redis ────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://redis:6379"

    # ── Telnyx ───────────────────────────────────────────────────────────────
    TELNYX_API_KEY: str = ""
    TELNYX_WEBHOOK_SECRET: str = ""     # for signature verification
    TELNYX_PHONE_NUMBER: str = ""       # your Telnyx DID e.g. +12025551234
    TELNYX_CONNECTION_ID: str = ""      # call-control application id

    # ── STT — Deepgram ───────────────────────────────────────────────────────
    DEEPGRAM_API_KEY: str = ""
    DEEPGRAM_STT_MODEL: str = "nova-2-phonecall"
    DEEPGRAM_STT_LANGUAGE: str = "en"

    # ── LLM (configurable) ───────────────────────────────────────────────────
    LLM_PROVIDER: Literal["openai", "anthropic", "openai_compatible"] = "openai"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "gpt-4o"
    LLM_BASE_URL: str = ""      # only needed for openai_compatible (Ollama, Groq, etc.)
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 1024

    # ── TTS ───────────────────────────────────────────────────────────────────
    TTS_PROVIDER: Literal["openai", "elevenlabs", "deepgram"] = "openai"
    # OpenAI TTS
    OPENAI_TTS_VOICE: str = "alloy"
    OPENAI_TTS_MODEL: str = "tts-1"
    # ElevenLabs TTS
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"  # Rachel
    ELEVENLABS_MODEL: str = "eleven_turbo_v2_5"
    # Deepgram TTS
    DEEPGRAM_TTS_VOICE: str = "aura-asteria-en"

    # ── PMS Backend ──────────────────────────────────────────────────────────
    PMS_API_URL: str = "http://backend:8000/api/v1"
    PMS_SERVICE_TOKEN: str = ""     # superadmin JWT or service token

    # ── WuzAPI (WhatsApp gateway) ─────────────────────────────────────────────
    WUZAPI_URL: str = "http://wuzapi:8080"

    # ── S3 / MinIO (recordings) ──────────────────────────────────────────────
    S3_ENDPOINT_URL: str = "http://minio:9000"
    S3_PUBLIC_ENDPOINT_URL: str = ""   # public-facing URL for presigned links; defaults to S3_ENDPOINT_URL
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "pms-voice"
    S3_REGION: str = "us-east-1"

    # ── Agent behaviour ──────────────────────────────────────────────────────
    COMPANY_NAME: str = "Property Management"      # used in greeting
    AGENT_NAME: str = "Alex"                        # voice agent name
    DEFAULT_ORG_ID: str = ""                        # fallback org when caller not matched
    RECORDING_ENABLED: bool = True
    AUTO_MODE_DEFAULT: bool = False                 # True = AI answers; False = popup only


settings = Settings()
