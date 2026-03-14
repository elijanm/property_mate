------------------------------------------------------------
REPORTING SPECIFICATION (CLAUDE CODE SPEC)
------------------------------------------------------------

Scope rule:
- Reports are **property-scoped** and live inside the Property Workspace:
  /app/properties/{propertyId}/reports
- The global portfolio dashboard can show **aggregated KPIs** but must NOT be the primary reporting module.
- All reports must be derived from Mongo truth with **ledger as the financial source of truth**.

Core principles:
1) Reports must be reproducible and auditable (same inputs → same results).
2) Financial reports must be ledger-derived (not from invoices/payments tables directly).
3) Reports must support time ranges:
   - Month-to-date (MTD), Quarter-to-date (QTD), Year-to-date (YTD)
   - Custom date ranges
   - Period comparison (MoM, YoY)
4) Export formats:
   - CSV (required for all tabular reports)
   - PDF (required for statement-style reports)
5) Performance:
   - Server-side pagination for large tables
   - Use pre-aggregated snapshots for heavy time-series charts (optional but recommended)
6) Access control:
   - Owner sees full property reports
   - Agent sees only assigned properties
   - Tenant sees tenant-only statements (not full property)
   - Service provider sees vendor-only views
   - SuperAdmin sees platform usage analytics, not property financial details unless explicitly authorized

------------------------------------------------------------
REPORT CATEGORIES (REQUIRED)
------------------------------------------------------------

A) Occupancy & Leasing
B) Rent & Collections (AR)
C) Ledger & Financial Statements
D) Utilities (Shared + Metered)
E) Maintenance & Vendor Performance
F) Forecasting & Risk (Optional but recommended)
G) Audit & Compliance

------------------------------------------------------------
A) OCCUPANCY & LEASING REPORTS
------------------------------------------------------------

A1) Occupancy Rate Trend
- Purpose: Track occupied vs vacant units over time.
- Metrics:
  - occupancy_rate = occupied_units / active_units
  - vacant_units, reserved_units, inactive_units
- Views:
  - monthly trend chart
  - breakdown by wing/floor/unit_type
- Data sources: units + leases (active lease determines occupancy)
- Export: CSV

A2) Vacancy & Turnover Report
- Purpose: Identify vacancy patterns and turnover frequency.
- Metrics:
  - vacancy_days per unit
  - turnover_count per period
  - avg_days_to_lease (time from vacant -> occupied)
- Filters: wing, floor, unit_type
- Export: CSV/PDF

A3) Lease Expiry & Renewals (30/60/90)
- Purpose: Prevent unexpected vacancies.
- Output:
  - list of leases expiring in N days
  - renewal status (renewed/pending/not renewing)
- Export: CSV/PDF

A4) Leasing Pipeline (Onboarding Funnel)
- Purpose: Measure onboarding efficiency.
- Stages:
  - onboarding_started
  - identity_confirmed
  - contract_ready
  - signed
  - activated
- Metrics:
  - conversion rate per stage
  - time-in-stage distribution
- Export: CSV

------------------------------------------------------------
B) RENT & COLLECTIONS (AR) REPORTS
------------------------------------------------------------

B1) Rent Roll (Snapshot)
- Purpose: Standard property rent roll for a period.
- Rows:
  - unit_code, tenant, lease_start/end, rent_amount
  - current balance, last payment date, status
- MUST be ledger-backed for balances.
- Export: CSV/PDF

B2) Accounts Receivable Aging
- Purpose: Identify defaulters and overdue risk.
- Buckets:
  - Current
  - 1–30
  - 31–60
  - 61–90
  - 90+
- Rows:
  - tenant, unit, amount per bucket, total AR
- Export: CSV/PDF

B3) Collections Efficiency
- Purpose: Measure billed vs collected.
- Metrics:
  - billed_total (issued invoices)
  - collected_total (confirmed payments allocated)
  - collection_rate = collected / billed
- Views:
  - MoM trend
  - unit_type/wing breakdown
- Export: CSV

B4) Late Payments & Defaulters
- Purpose: Operational list for follow-ups.
- Output:
  - tenants with late_count, avg_days_late, outstanding_balance
  - last reminder sent (if notifications tracked)
- Export: CSV

B5) Deposit Ledger & Refund Status
- Purpose: Track deposits as liabilities.
- Metrics:
  - deposits_collected, deposits_held, deposits_refunded
- Rows:
  - tenant, unit, deposit_amount, status, refund_reference
- Export: CSV/PDF

------------------------------------------------------------
C) LEDGER & FINANCIAL STATEMENTS (FINTECH-GRADE)
------------------------------------------------------------

C1) General Ledger (GL) Export
- Purpose: Full ledger entries for a period.
- Rows:
  - entry_id, occurred_at, debit_account, credit_account, amount, currency
  - reference links: invoice_id, payment_id, settlement_id
- Export: CSV (required)

C2) Trial Balance
- Purpose: Validate books balance.
- Rows:
  - account, debit_total, credit_total, net
- Must always balance (within rounding rules).
- Export: CSV/PDF

C3) Profit & Loss (P&L)
- Purpose: Income vs expenses over time.
- Includes:
  - RentIncome, UtilityIncome, LateFeeIncome
  - MaintenanceExpense, AgentCommissionExpense, other expenses
- Views:
  - period total + trend
  - category breakdown
- Export: PDF/CSV

C4) Balance Sheet
- Purpose: Assets, liabilities, equity snapshot.
- Includes:
  - Bank balances (tracked)
  - Accounts receivable
  - Deposits payable
  - Owner payable / agent payable
- Export: PDF/CSV

C5) Cash Flow Statement (optional but recommended)
- Purpose: Operating cash movements.
- Derived from cash/bank ledger accounts.
- Export: PDF/CSV

C6) Settlement Statement (Owner/Agent)
- Purpose: Monthly settlement summary based on configured collection strategy.
- Output:
  - collected_total
  - commission_accrued
  - commission_paid
  - owner_net_due
  - owner_paid
  - exceptions (unmatched payments, reversals)
- Export: PDF/CSV

------------------------------------------------------------
D) UTILITIES REPORTS (SHARED + METERED)
------------------------------------------------------------

D1) Utility Usage Summary (Metered)
- Purpose: Monthly consumption per unit/meter.
- Rows:
  - unit, meter_id, start_reading, end_reading, usage_delta
  - anomalies flag (spike/negative/rollover)
- Export: CSV

D2) Utility Billing Breakdown
- Purpose: Explain utility charges billed.
- Shared utilities:
  - allocation method + allocation basis
- Metered utilities:
  - usage x rate + fixed charges
- Rows:
  - tenant/unit, utility_type, billed_amount, method, supporting numbers
- Export: CSV/PDF

D3) Utility Variance & Anomaly Report
- Purpose: Detect leaks / abnormal usage.
- Metrics:
  - usage variance vs prior month average
  - top N spikes
  - missing readings list
- Export: CSV

D4) Meter Readings Audit Log
- Purpose: Validate reading integrity.
- Output:
  - reading source (manual/ml/iot)
  - who submitted/approved
  - timestamps
- Export: CSV

------------------------------------------------------------
E) MAINTENANCE & VENDOR PERFORMANCE REPORTS
------------------------------------------------------------

E1) Ticket Volume & Resolution Time
- Metrics:
  - tickets_created, tickets_resolved
  - avg_time_to_assign, avg_time_to_resolve
  - SLA breach count
- Breakdown: category, unit_type, vendor
- Export: CSV/PDF

E2) Maintenance Cost Report
- Purpose: Track cost trends.
- Inputs:
  - vendor invoices (if used)
  - maintenance expense ledger entries
- Breakdown:
  - per unit / per category / per vendor
- Export: CSV/PDF

E3) Vendor Performance Scorecard
- Metrics:
  - acceptance rate
  - completion time
  - SLA compliance
  - re-open rate
  - average cost per job
- Export: PDF/CSV

------------------------------------------------------------
F) FORECASTING & RISK REPORTS (OPTIONAL BUT HIGH VALUE)
------------------------------------------------------------

F1) Cash Collection Forecast
- Purpose: Estimate expected collections next month.
- Inputs:
  - historical payment patterns
  - current AR aging
- Output:
  - expected_collections (range)
  - high-risk tenants list
- Export: CSV/PDF

F2) Vacancy Forecast
- Purpose: Identify upcoming vacancy risk.
- Inputs:
  - lease expiry dates
  - renewal likelihood signals (optional)
- Output:
  - projected vacancy counts by month
- Export: CSV

------------------------------------------------------------
G) AUDIT & COMPLIANCE REPORTS
------------------------------------------------------------

G1) Audit Log Export (Sensitive Actions)
- Includes:
  - payment confirmations
  - invoice issue/void
  - contract signing events
  - role/permission changes
  - settlement approvals/executions
- Export: CSV

G2) Data Integrity Checks (Operational)
- Examples:
  - units marked occupied without active lease (should be zero)
  - active lease without occupied unit
  - invoice issued without ledger posting (should be zero)
  - payment confirmed without allocation (exceptions list)
- Export: CSV

------------------------------------------------------------
REPORTS UI REQUIREMENTS (PROPERTY WORKSPACE)
------------------------------------------------------------

Route:
- /app/properties/{propertyId}/reports

Navigation groups:
- Occupancy & Leasing
- Rent & Collections
- Ledger & Financial
- Utilities
- Maintenance
- Audit & Compliance
- Forecasting (if enabled)

UI components:
- Report selector (list)
- Filters:
  - period (YYYY-MM)
  - date range
  - unit_type, wing, floor
  - status (paid/overdue)
- Export buttons:
  - CSV (required)
  - PDF (where applicable)
- Large reports:
  - paginated tables
  - background export job for huge datasets (RabbitMQ)

------------------------------------------------------------
BACKEND REQUIREMENTS FOR REPORTING
------------------------------------------------------------

API:
- GET /properties/{propertyId}/reports/{reportKey}
  - supports query params: start_date, end_date, period, filters
- POST /properties/{propertyId}/reports/{reportKey}/export
  - enqueues export job (RabbitMQ) for large datasets

Worker:
- reports.export queue (optional)
  - generates CSV/PDF and stores in S3: org/{org_id}/reports/{propertyId}/...

Redis:
- cache:org:{org_id}:reports:{propertyId}:{reportKey}:{filter_hash}:v{version}
  - short TTL for frequently accessed summaries (1–5 min)

Ledger rule:
- All financial totals in reports MUST be computed from ledger_entries (not invoices/payments tables directly).