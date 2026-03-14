# Redis key patterns — use .format(org_id=..., id=...) or f-strings

# Entity keys
KEY_UNIT = "{org_id}:unit:{id}"
KEY_PROPERTY = "{org_id}:property:{id}"
KEY_LEASE = "{org_id}:lease:{id}"
KEY_TENANT = "{org_id}:tenant:{id}"
KEY_INVOICE = "{org_id}:invoice:{id}"
KEY_TICKET = "{org_id}:ticket:{id}"

# List / collection keys
KEY_PROPERTY_UNITS = "{org_id}:property:{property_id}:units"
KEY_TENANT_LEASES = "{org_id}:tenant:{tenant_id}:leases"

# Lock keys
KEY_LOCK_BILLING_RUN = "{org_id}:lock:billing_run:{period}"
KEY_LOCK_SETTLEMENT = "{org_id}:lock:settlement:{settlement_id}"
KEY_LOCK_UNIT_ASSIGN = "lock:{org_id}:unit_assign:{unit_id}"

# Unit generation idempotency
KEY_UNIT_GEN_LOCK = "{org_id}:unit_gen:{property_id}"

# Idempotency keys
KEY_IDEMPOTENCY = "{org_id}:idempotency:{key}"

# Session / auth
KEY_SESSION = "{org_id}:session:{user_id}"
KEY_REFRESH_TOKEN = "{org_id}:refresh:{token_id}"

# Rate limiting
KEY_RATE_LIMIT = "{org_id}:rate_limit:{user_id}:{endpoint}"

# Job tracking
KEY_JOB = "job:{job_id}"

# WebSocket notification channels (Redis pub/sub)
KEY_WS_NOTIFICATIONS = "ws:notifications:{org_id}"
