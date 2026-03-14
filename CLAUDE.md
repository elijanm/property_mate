# CLAUDE.md — PMS (Massive Scale Multi-Tenant Property Management)

You are building **PMS** — a high-scale, multi-tenant property management platform where:
- Owners, agents/managers, tenants, and service providers operate within isolated orgs.
- The product’s key differentiator is a **portfolio dashboard** + **property workspace** with “breeze” configuration:
  - Rapid property creation (wings/floors/unit templates) → auto-generates units/prices/utilities.
- The system supports:
  - Tenant onboarding (ID upload → extraction → lease drafting → PDF contract generation → online signing)
  - Utilities (shared or metered), meter readings, monthly invoicing
  - Ledger-based accounting, commissions, settlements, payouts
  - Maintenance ticketing with vendor assignment
  - Embedded payments (e.g., Mpesa C2B/B2C, bank rails), reconciliation
  - Dashboards: Owner, Agent, Tenant, Service Provider, SuperAdmin
- Must scale horizontally and handle millions of requests.

This project MUST follow distributed-system best practices.

------------------------------------------------------------
TECH STACK (MANDATORY)
------------------------------------------------------------

Backend:
- FastAPI (async)
- MongoDB (replica set, sharding-ready) — ODM: motor (async) + beanie
- Redis Cluster (cache + locks + rate limit + idempotency) — client: redis[asyncio]
- RabbitMQ (background jobs & async processing) — client: aio-pika
- OpenSearch (search: units/tenants/properties, filtering) — client: opensearch-py[async]
- S3-compatible storage (documents/media: IDs, proofs, signed PDFs, ticket photos) — client: aioboto3
- Config: pydantic-settings (reads from environment variables)
- HTTP test client: httpx + pytest-asyncio

Observability:
- Prometheus
- Grafana
- Alertmanager
- OpenTelemetry (traces)
- Structured JSON logs

Deployment:
- Docker (local dev)
- Kubernetes-ready (stateless services)
- CDN for landing + media

------------------------------------------------------------
MONOREPO STRUCTURE (MANDATORY)
------------------------------------------------------------

Root layout:
- apps/backend      -> FastAPI API service (stateless)
- apps/worker       -> RabbitMQ worker service
- apps/frontend     -> React (Vite) UI — see FRONTEND CONVENTIONS section for mandatory src/ layout
- packages/shared   -> shared types/schemas between services
- infra/docker      -> docker-compose + local infra configs
- infra/k8s         -> Kubernetes manifests (maintained in sync with infra/docker; update when services, ports, env vars, or volumes change)
- scripts/          -> convenience scripts

apps/backend/app/ internal layout (MANDATORY):
  api/            -> FastAPI routers only — no business logic; versioned under api/v1/
  services/       -> business logic; receives CurrentUser, calls repositories
  repositories/   -> all DB access (MongoDB queries); ALWAYS filters by org_id
  models/         -> Beanie document models (MongoDB collections)
  schemas/        -> Pydantic request/response schemas (*Request, *Response, *Payload)
  dependencies/   -> FastAPI Depends() factories (auth, org_id injection, pagination)
  core/           -> app config (pydantic-settings), startup/shutdown lifespan, logging setup
  utils/          -> pure stateless helpers (formatters, validators, date utils)

apps/worker/app/ internal layout (MANDATORY):
  tasks/          -> RabbitMQ consumers/handlers; each must be idempotent
  services/       -> business logic shared with or mirrored from backend
  core/           -> worker config, RabbitMQ connection setup

packages/shared/ contains (MANDATORY):
  types/          -> Pydantic models used by BOTH backend and worker (event payloads, enums, DTOs)
                     Examples: LeaseCreatedPayload, BillingRunPayload, Role enum, JobStatus enum
  constants/      -> shared string constants (queue names, Redis key patterns, event types)
                     Examples: QUEUE_BILLING_RUNS = "billing.runs", KEY_UNIT = "{org_id}:unit:{id}"

When implementing features:
- API endpoints go to apps/backend/app/api/v1/
- Business logic goes to apps/backend/app/services/
- DB queries go to apps/backend/app/repositories/ (never inline in routes or services)
- Shared logic between backend and worker MUST go to packages/shared/ (not "if applicable" — if both need it, it goes there)
- Worker consumers/handlers go to apps/worker/app/tasks/
- Any infra changes go to infra/docker/* or infra/k8s/*

Do NOT:
- put docker-compose.yml at the root
- mix worker logic into backend
- create random folders outside apps/, packages/, infra/
- write MongoDB queries inline in routes or service files — always use a repository

------------------------------------------------------------
ARCHITECTURE PRINCIPLES
------------------------------------------------------------

1) API MUST be stateless.
2) MongoDB is source of truth.
3) Redis is for speed + coordination.
4) RabbitMQ handles async workloads.
5) OpenSearch handles discovery and complex filters.
6) Payments, onboarding, billing runs, settlements MUST be idempotent.
7) Multi-tenancy is FIRST-CLASS: every record is scoped to org_id and all queries enforce it.

No in-memory caches that break horizontal scaling.
No singleton assumptions.
Every side-effect must be idempotent.

------------------------------------------------------------
MULTI-TENANCY RULES (CRITICAL)
------------------------------------------------------------

Tenant boundary = org/portfolio.

- Every collection document MUST include org_id (except platform-level collections: orgs, plans, system_config, users, and job_runs for platform-initiated jobs — see job_runs note below).
- Every query MUST filter by org_id (enforced by repository/service layer).
- OpenSearch documents MUST include org_id and every search must filter by it.
- Redis keys MUST be prefixed with org_id.
- S3 paths MUST include org_id.

Never leak cross-org data in logs, traces, or errors.

Auth/org_id injection chain (MANDATORY):
1. JWT is validated in apps/backend/app/dependencies/auth.py
2. The dependency extracts and returns CurrentUser(org_id, user_id, role)
3. All router handlers receive CurrentUser via Depends(get_current_user)
4. CurrentUser is passed explicitly into every service method call
5. Services pass org_id explicitly into every repository method call
6. Repositories ALWAYS append {org_id: current_user.org_id} to every MongoDB filter

Soft-delete convention (ALL collections, MANDATORY):
- Every document includes: deleted_at: Optional[datetime] = None
- Hard deletes are FORBIDDEN on any org-scoped collection
- Every repository query MUST append filter: {"deleted_at": None}
- Deletion = set deleted_at to current UTC datetime

------------------------------------------------------------
NAMING CONVENTIONS (MANDATORY)
------------------------------------------------------------

Backend (Python):
  Files:          snake_case (e.g., lease_service.py, unit_repository.py)
  Classes:        PascalCase (e.g., LeaseService, UnitRepository)
  Functions:      snake_case (e.g., get_unit_by_id, create_lease)
  Variables:      snake_case
  Constants:      UPPER_SNAKE_CASE
  Router prefix:  /api/v1/<resource> (e.g., /api/v1/units, /api/v1/leases)
  Request schema: <Resource>CreateRequest, <Resource>UpdateRequest
  Response schema:<Resource>Response, <Resource>ListResponse
  Event payload:  <Resource><Action>Payload (e.g., LeaseCreatedPayload)
  Beanie model:   <Resource> (e.g., Unit, Lease, Tenant) — stored in models/

Frontend (TypeScript/React):
  Component files:  PascalCase.tsx (e.g., OwnerDashboard.tsx, ProtectedRoute.tsx)
  Page files:       PascalCase.tsx, grouped by role in pages/<role>/
  Hook files:       camelCase.ts, prefixed with "use" (e.g., useAuth.ts, useJobStatus.ts)
  Utility files:    camelCase.ts (e.g., apiError.ts, formatDate.ts)
  API client files: camelCase.ts (e.g., client.ts)
  Context files:    PascalCase + "Context" suffix (e.g., AuthContext.tsx)
  Type files:       camelCase.ts (e.g., auth.ts, lease.ts) in src/types/
  Import alias:     Use @/ for all src-relative imports (configured in tsconfig.json)

Shared (cross-layer):
  Redis key (entity):     {org_id}:{resource}:{id} (e.g., org_123:unit:unit_456)
  Redis key (collection): {org_id}:{resource}:list:{filter_hash}
  Redis key (report):     {org_id}:reports:{propertyId}:{reportKey}:{filter_hash}:v{n}
  S3 path:                {org_id}/{resource_type}/{id}/{filename}

------------------------------------------------------------
ERROR HANDLING (MANDATORY)
------------------------------------------------------------

All API errors MUST return this envelope:
{
  "error": {
    "code": "SNAKE_CASE_ERROR_CODE",
    "message": "Human-readable description",
    "details": {}   // optional, omit if empty
  }
}

HTTP status codes:
- 400: validation errors, business rule violations
- 401: unauthenticated
- 403: insufficient role/permission
- 404: resource not found (within org — never reveal cross-org existence)
- 409: conflict (duplicate, already exists)
- 422: unprocessable entity (Pydantic validation — FastAPI default)
- 500: unexpected server error (never leak internals)

Raise HTTPException from routes only. Services raise domain exceptions
(e.g., ResourceNotFoundError, ConflictError) defined in core/exceptions.py.
A global exception handler in core/ maps domain exceptions to HTTPException.

------------------------------------------------------------
RBAC — ROLES & PERMISSIONS (MANDATORY)
------------------------------------------------------------

Five platform roles (stored in JWT claim "role"):

  superadmin      — platform-level; bypasses org_id scoping; can access all orgs
  owner           — full access within their org (properties, financials, reports)
  agent           — manages properties/tenants assigned to them; no financial settings
  tenant          — read-only access to own lease, invoices, tickets, utilities
  service_provider— read/write on assigned maintenance tickets only

FastAPI enforcement:
- Dependency: get_current_user (dependencies/auth.py) — validates JWT, returns CurrentUser
- Dependency: require_roles(*roles) (dependencies/auth.py) — raises 403 if role not in allowed list
- Every router handler MUST declare both dependencies via Depends()
- SuperAdmin cross-org access: superadmin role bypasses org_id filter in repositories;
  all other roles ALWAYS have org_id filter applied.
- Platform-initiated background jobs (billing sweeps, system maintenance) run with NO acting
  user — org_id and user_id are absent from their log lines and job_runs records. They do NOT
  go through the user auth chain. Do not apply user auth middleware to system job triggers.

Example usage in a router:
  @router.get("/units", dependencies=[Depends(require_roles("owner", "agent"))])

Role hierarchy is flat — no role inherits from another. Permissions are explicit per endpoint.

------------------------------------------------------------
RABBITMQ QUEUES (DURABLE + RETRY + DLQ)
------------------------------------------------------------

pms.events
payments.webhooks
billing.runs
settlement.payouts
media.processing
documents.generate
notifications.email
search.index
cache.invalidate
reports.export

Rules:
- durable queues
- retry queues with exponential backoff (TTL 30s, reroutes to main exchange)
- dead-letter queues required (suffix .dlq)
- retry queue suffix: .retry — e.g., billing.runs.retry → billing.runs.dlq
- workers must be idempotent

------------------------------------------------------------
STRUCTURED LOGGING (MANDATORY)
------------------------------------------------------------

Use structlog with JSON output. Every log line MUST include these fields:

  org_id        — always present for org-scoped operations (omit for platform-level only)
  user_id       — authenticated user performing the action
  request_id    — UUID injected by middleware per request (propagated to workers via message headers)
  action        — what is happening (e.g., "create_lease", "process_payment")
  resource_type — the entity being acted on (e.g., "lease", "unit", "invoice")
  resource_id   — the entity's ID (if known)
  duration_ms   — for completed operations
  status        — "success" | "error" | "started"
  error_code    — present only on error (matches API error envelope code)

Never log: passwords, tokens, raw ID document contents, full card numbers, secrets.
Log level: DEBUG in dev, INFO in prod, ERROR on exceptions.

------------------------------------------------------------
TEST STRATEGY (MANDATORY)
------------------------------------------------------------

Test location:
  apps/backend/tests/
    unit/         -> test services and repositories in isolation (mock external deps)
    integration/  -> test full request→service→DB flow against real test MongoDB
  apps/worker/tests/
    unit/         -> test task handlers in isolation

Tooling:
  pytest + pytest-asyncio           -> async test support
  httpx AsyncClient                 -> API integration tests (via FastAPI test client)
  mongomock or real MongoDB         -> prefer real MongoDB in Docker for integration tests
  pytest-mock / unittest.mock       -> mocking Redis, RabbitMQ, S3, OpenSearch in unit tests
  factory_boy or plain fixtures     -> test data factories per model

Rules:
- Every new API endpoint MUST have at least one integration test covering happy path + 403 + 404
- Every service method with branching logic MUST have unit tests covering each branch
- Tests MUST NOT share state — each test gets a clean DB state (use autouse fixture for teardown)
- Tests run with: pytest apps/backend/tests/ -v --asyncio-mode=auto
- A feature is NOT done until tests pass

------------------------------------------------------------
JOB STATUS TRACKING (MANDATORY)
------------------------------------------------------------

All async background jobs (billing runs, document generation, settlements, media processing)
MUST write status to the job_runs MongoDB collection.

job_runs collection schema:
  id            — UUID, idempotency key (also used as RabbitMQ message correlation_id)
  org_id        — Optional[str]: present for org-triggered jobs; absent for platform-initiated jobs
  job_type      — e.g., "billing_run", "document_generate", "settlement_payout"
  status        — "queued" | "in_progress" | "completed" | "failed" | "retrying"
  payload       — snapshot of input params at enqueue time
  result        — output summary on completion (nullable)
  error         — error details on failure (nullable)
  attempts      — retry count
  created_at    — UTC datetime
  updated_at    — UTC datetime
  completed_at  — UTC datetime (nullable)

Worker tasks MUST update job_runs status at every state transition.
API callers poll GET /api/v1/jobs/{job_id} for status — no websockets needed for basic polling.
Frontend may use SSE (/api/v1/jobs/{job_id}/stream) if real-time updates are required.

Frontend job polling convention:
- Default: poll every 3 seconds via setInterval; clear interval on terminal state (completed/failed)
- Use a reusable hook: src/hooks/useJobStatus.ts — accepts jobId, returns { status, result, error }
- Map status values directly from job_runs: queued → "Queued", in_progress → "In progress", etc.
- On "failed" status, surface the error.message to the user (never raw stack traces)

------------------------------------------------------------
DELIVERABLE STANDARD (FOR ANY FEATURE)
------------------------------------------------------------

When implementing features:
1) Mongo schema + indexes
2) Redis strategy (cache, locks, idempotency)
3) RabbitMQ events/queues used
4) API endpoints (stateless)
4b) Frontend pages/components for the feature (per FRONTEND CONVENTIONS section)
5) Worker tasks (idempotent)
6) OpenSearch updates (if searchable)
7) Backend tests (unit + integration — happy path + 403 + 404 per endpoint)
7b) Frontend component tests (per FRONTEND TEST STRATEGY section)
8) Prometheus metrics instrumentation

------------------------------------------------------------
AUTH ENDPOINTS (CONTRACT)
------------------------------------------------------------

These endpoints MUST be implemented in apps/backend/app/api/v1/auth.py.
The frontend depends on this exact shape — do not deviate without updating both sides.

POST /api/v1/auth/login
  Request:  { "email": string, "password": string }
  Response: { "token": string, "user": { "user_id": string, "org_id": string, "role": string, "email": string } }
  Errors:   401 INVALID_CREDENTIALS, 403 ACCOUNT_SUSPENDED

POST /api/v1/auth/refresh
  Request:  { "refresh_token": string }
  Response: { "token": string }
  Errors:   401 INVALID_REFRESH_TOKEN, 401 REFRESH_TOKEN_EXPIRED

POST /api/v1/auth/logout
  Request:  (Bearer token in Authorization header)
  Response: { "ok": true }
  Action:   Revokes refresh token from Redis; invalidates session key

------------------------------------------------------------
FRONTEND CONVENTIONS (MANDATORY)
------------------------------------------------------------

Stack: React 18 + Vite 5 + TypeScript 5 + Tailwind CSS 3 + React Router 6 + Axios

apps/frontend/src/ directory layout (MANDATORY):
  api/            -> Axios client + per-resource API functions
                     api/client.ts — base Axios instance with auth header + error interceptors
                     api/<resource>.ts — e.g., api/leases.ts, api/units.ts
  components/     -> Reusable UI components (no page-level logic)
  context/        -> React context providers (AuthContext.tsx, etc.)
  hooks/          -> Custom React hooks (useAuth.ts, useJobStatus.ts, etc.)
  layouts/        -> Page shell components (DashboardLayout.tsx, AuthLayout.tsx)
  pages/          -> Route-level page components grouped by role:
                     pages/auth/       — login, register
                     pages/owner/      — owner-scoped pages
                     pages/agent/      — agent-scoped pages
                     pages/tenant/     — tenant-scoped pages
                     pages/service_provider/
                     pages/superadmin/
                     pages/errors/     — NotFound.tsx, Forbidden.tsx
  types/          -> TypeScript interfaces and enums mirroring backend schemas
                     types/auth.ts     — AuthUser, Role enum
                     types/api.ts      — ApiError, PaginatedResponse<T>
                     types/navigation.ts — NavItem
                     types/<resource>.ts — per-feature types (lease.ts, unit.ts, etc.)
  utils/          -> Pure stateless helpers (no React, no side effects)
                     utils/apiError.ts  — extractApiError(axiosError): ApiError
                     utils/formatDate.ts, utils/formatCurrency.ts, etc.
  constants/      -> App-wide constants
                     constants/storage.ts — TOKEN_KEY, USER_KEY (single source of truth)

Do NOT:
- Define TypeScript interfaces inline inside component or page files — put them in src/types/
- Duplicate storage key strings — always import from constants/storage.ts
- Use relative imports deeper than one level — use the @/ alias instead
- Write API calls directly in components — always go through src/api/<resource>.ts functions

URL / Route conventions (MANDATORY):
  /login                                    — unauthenticated entry point
  /forbidden                                — authenticated but wrong role
  /{role}                                   — role home (e.g., /owner, /agent, /tenant)
  /{role}/properties                        — portfolio list for owner/agent
  /app/properties/:propertyId/*             — property workspace (shared layout)
  /app/properties/:propertyId/reports/:key  — report viewer
  /tenant/lease                             — tenant's active lease
  /tenant/invoices                          — tenant's invoice list
  /tenant/tickets                           — tenant's maintenance tickets
  /superadmin/*                             — platform admin area

RBAC in the frontend:
  - Unauthenticated users → redirect to /login
  - Authenticated users accessing a disallowed role route → redirect to /forbidden (NOT /login)
  - Use ProtectedRoute component wrapping role-specific route groups
  - DashboardLayout accepts navItems: NavItem[] prop — each role's page defines its own nav tree

Environment variables (MANDATORY):
  VITE_API_BASE_URL — base URL for the API (e.g., http://localhost:8000)
                      used in api/client.ts as: baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
  apps/frontend/.env.example MUST exist alongside infra/docker/.env.example
  The production Nginx config MUST reverse-proxy /api/* to the backend service

API error handling (MANDATORY):
  All API errors follow this envelope from the backend:
    { "error": { "code": "SNAKE_CASE", "message": "...", "details": {} } }
  - NEVER show hardcoded error strings — always surface error.response.data.error.message
  - Use utils/apiError.ts → extractApiError(axiosError): { code: string; message: string }
  - The Axios interceptor in api/client.ts handles 401 (triggers token refresh, then logout if refresh fails)
  - Do NOT hard-redirect to /login on every 401 — attempt one token refresh first

Token management:
  - JWT stored in localStorage under TOKEN_KEY (imported from constants/storage.ts)
  - On 401 response: call POST /api/v1/auth/refresh; if refresh succeeds, retry original request
  - Only redirect to /login if refresh itself returns 401
  - On logout: clear TOKEN_KEY + USER_KEY from localStorage and call POST /api/v1/auth/logout

------------------------------------------------------------
FRONTEND TEST STRATEGY (MANDATORY)
------------------------------------------------------------

Tooling:
  Vitest                          -> test runner (vite-native, no separate config needed)
  @testing-library/react          -> component rendering
  @testing-library/user-event     -> simulated user interactions
  msw (Mock Service Worker)       -> mock API calls at the network layer

Test location:
  apps/frontend/src/__tests__/    -> unit and integration tests
  Co-located *.test.tsx files are also acceptable for component-level tests

Run command: npm run test (in apps/frontend/)

Rules:
- ProtectedRoute MUST have tests: unauthenticated redirect, wrong-role redirect, correct-role render
- AuthContext MUST have tests: login stores token + user, logout clears storage, initial state from storage
- api/client.ts interceptors MUST have tests: 401 triggers refresh, failed refresh triggers logout
- Every new page component MUST have at least one smoke test (renders without crashing)
- API functions in src/api/*.ts MUST be tested against msw mocks (not real network)
- A feature is NOT done until frontend tests pass alongside backend tests

------------------------------------------------------------
LLM CONFIGURATION (CLAUDE CODE)
------------------------------------------------------------

Model: kimi-k2.5:cloud
Base URL: https://ollama.fileq.io/v1

Environment variables required:
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL

All Claude Code generation must use this model.
