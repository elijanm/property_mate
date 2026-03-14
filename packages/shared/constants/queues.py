# RabbitMQ queue names
QUEUE_EVENTS = "pms.events"
QUEUE_PAYMENTS_WEBHOOKS = "payments.webhooks"
QUEUE_BILLING_RUNS = "billing.runs"
QUEUE_SETTLEMENT_PAYOUTS = "settlement.payouts"
QUEUE_MEDIA_PROCESSING = "media.processing"
QUEUE_DOCUMENTS_GENERATE = "documents.generate"
QUEUE_NOTIFICATIONS_EMAIL = "notifications.email"
QUEUE_SEARCH_INDEX = "search.index"
QUEUE_CACHE_INVALIDATE = "cache.invalidate"
QUEUE_UNIT_GENERATION = "property.units.generate"

# Retry queue names (suffix .retry)
QUEUE_BILLING_RUNS_RETRY = "billing.runs.retry"
QUEUE_SETTLEMENT_PAYOUTS_RETRY = "settlement.payouts.retry"
QUEUE_DOCUMENTS_GENERATE_RETRY = "documents.generate.retry"
QUEUE_NOTIFICATIONS_EMAIL_RETRY = "notifications.email.retry"
QUEUE_SEARCH_INDEX_RETRY = "search.index.retry"
QUEUE_PAYMENTS_WEBHOOKS_RETRY = "payments.webhooks.retry"
QUEUE_MEDIA_PROCESSING_RETRY = "media.processing.retry"
QUEUE_CACHE_INVALIDATE_RETRY = "cache.invalidate.retry"

# Dead-letter queue names (suffix .dlq)
QUEUE_BILLING_RUNS_DLQ = "billing.runs.dlq"
QUEUE_SETTLEMENT_PAYOUTS_DLQ = "settlement.payouts.dlq"
QUEUE_DOCUMENTS_GENERATE_DLQ = "documents.generate.dlq"
QUEUE_NOTIFICATIONS_EMAIL_DLQ = "notifications.email.dlq"
QUEUE_SEARCH_INDEX_DLQ = "search.index.dlq"
QUEUE_PAYMENTS_WEBHOOKS_DLQ = "payments.webhooks.dlq"
QUEUE_MEDIA_PROCESSING_DLQ = "media.processing.dlq"
QUEUE_CACHE_INVALIDATE_DLQ = "cache.invalidate.dlq"

# IoT queue names
QUEUE_IOT_METER_READING = "iot.meter_reading"
QUEUE_IOT_LOCK_EVENT = "iot.lock_event"
QUEUE_IOT_ALERT = "iot.alert"
QUEUE_IOT_DEVICE_STATUS = "iot.device_status"

# IoT retry queues
QUEUE_IOT_METER_READING_RETRY = "iot.meter_reading.retry"
QUEUE_IOT_LOCK_EVENT_RETRY = "iot.lock_event.retry"
QUEUE_IOT_ALERT_RETRY = "iot.alert.retry"
QUEUE_IOT_DEVICE_STATUS_RETRY = "iot.device_status.retry"

# IoT dead-letter queues
QUEUE_IOT_METER_READING_DLQ = "iot.meter_reading.dlq"
QUEUE_IOT_LOCK_EVENT_DLQ = "iot.lock_event.dlq"
QUEUE_IOT_ALERT_DLQ = "iot.alert.dlq"
QUEUE_IOT_DEVICE_STATUS_DLQ = "iot.device_status.dlq"

QUEUE_IOT_DEVICE_LIFECYCLE = "iot.device_lifecycle"
QUEUE_IOT_DEVICE_LIFECYCLE_RETRY = "iot.device_lifecycle.retry"
QUEUE_IOT_DEVICE_LIFECYCLE_DLQ = "iot.device_lifecycle.dlq"

# Retry TTL in milliseconds (30 seconds)
RETRY_TTL_MS = 30_000
