# apps/frontend — Frontend Conventions

This file covers frontend-specific conventions. For the full platform architecture,
multi-tenancy rules, auth contracts, and RabbitMQ queues, see the root CLAUDE.md.

For the reporting module spec (report categories, API contracts, Redis keys for reports),
see docs/reporting-spec.md.

------------------------------------------------------------
src/ DIRECTORY LAYOUT (MANDATORY)
------------------------------------------------------------

api/            -> Axios client + per-resource API functions
                   api/client.ts — base instance; do NOT create a second axios instance
                   api/<resource>.ts — e.g., api/leases.ts, api/units.ts

components/     -> Shared, reusable UI components (no page-level business logic)

constants/      -> App-wide constants (never inline these as literals)
                   constants/storage.ts — TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY

context/        -> React context providers only

hooks/          -> Custom React hooks (useAuth.ts, useJobStatus.ts, etc.)

layouts/        -> Page shell components (DashboardLayout, AuthLayout)

pages/          -> Route-level components grouped by role:
                   pages/auth/
                   pages/owner/
                   pages/agent/
                   pages/tenant/
                   pages/service_provider/
                   pages/superadmin/
                   pages/errors/          — NotFound.tsx, Forbidden.tsx

types/          -> TypeScript interfaces and enums ONLY (no logic)
                   types/auth.ts          — AuthUser, Role
                   types/api.ts           — ApiError, ApiErrorResponse, PaginatedResponse<T>
                   types/navigation.ts    — NavItem
                   types/<resource>.ts    — per-feature types

utils/          -> Pure stateless helpers (no React, no side effects)
                   utils/apiError.ts      — extractApiError(error): ApiError
                   utils/formatDate.ts
                   utils/formatCurrency.ts

test/           -> Test infrastructure
                   test/setup.ts          — vitest + @testing-library/jest-dom setup
                   test/mocks/server.ts   — MSW server with shared handlers

__tests__/      -> Test files (or co-located *.test.tsx alongside components)

------------------------------------------------------------
RULES
------------------------------------------------------------

- Never define TypeScript interfaces inside component files — use src/types/
- Never hardcode 'pms_token' / 'pms_user' strings — import from constants/storage.ts
- Never write API calls directly in components — use src/api/<resource>.ts
- Never use relative imports deeper than one level — use the @/ alias
- Never show hardcoded error strings from catch blocks — use extractApiError()
- Never redirect to /login on wrong role — redirect to /forbidden instead

------------------------------------------------------------
TESTING (MANDATORY)
------------------------------------------------------------

Runner:    vitest (npm run test)
Rendering: @testing-library/react
Network:   msw (Mock Service Worker)

Required tests per feature:
- Every new page: at least one smoke test (renders without crashing)
- Every ProtectedRoute usage: unauthenticated → /login, wrong role → /forbidden
- Every API function in src/api/*.ts: tested with msw handlers, not real network
