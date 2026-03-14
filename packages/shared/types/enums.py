from enum import StrEnum


class Role(StrEnum):
    SUPERADMIN = "superadmin"
    OWNER = "owner"
    AGENT = "agent"
    TENANT = "tenant"
    SERVICE_PROVIDER = "service_provider"


class JobStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


class JobType(StrEnum):
    BILLING_RUN = "billing_run"
    DOCUMENT_GENERATE = "document_generate"
    SETTLEMENT_PAYOUT = "settlement_payout"
    MEDIA_PROCESSING = "media_processing"
    SEARCH_INDEX = "search_index"
    CACHE_INVALIDATE = "cache_invalidate"
    NOTIFICATION_EMAIL = "notification_email"
    PAYMENT_WEBHOOK = "payment_webhook"
    UNIT_GENERATION = "unit_generation"


class PropertyType(StrEnum):
    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    MIXED = "mixed"


class PropertyStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class UnitStatus(StrEnum):
    VACANT = "vacant"
    RESERVED = "reserved"
    OCCUPIED = "occupied"
    INACTIVE = "inactive"


class LeaseStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    EXPIRED = "expired"
    TERMINATED = "terminated"


class OnboardingStatus(StrEnum):
    INITIATED = "initiated"
    UNIT_RESERVED = "unit_reserved"
    CONTRACT_DRAFTED = "contract_drafted"
    SIGNED = "signed"
    ACTIVATED = "activated"
    CANCELLED = "cancelled"


class UtilityType(StrEnum):
    SHARED = "shared"
    METERED = "metered"


class DepositRule(StrEnum):
    ONE_X_RENT = "1x_rent"
    TWO_X_RENT = "2x_rent"
    THREE_X_RENT = "3x_rent"
    CUSTOM = "custom"


class LateFeeType(StrEnum):
    FLAT = "flat"
    PERCENTAGE = "percentage"
