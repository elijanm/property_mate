export interface OrgUserSummary {
  id: string
  email: string
  first_name: string
  last_name: string
  role: 'owner' | 'agent'
}

export interface BusinessDetails {
  name: string
  registration_number?: string
  kra_pin?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  logo_url?: string
}

export interface TaxConfig {
  vat_enabled: boolean
  vat_rate: number
  vat_number?: string
  vat_inclusive: boolean
  withholding_tax_enabled: boolean
  withholding_tax_rate: number
}

export type AccountType = 'income' | 'expense' | 'asset' | 'liability'

export interface AccountEntry {
  id: string
  code: string
  name: string
  account_type: AccountType
  role?: string        // system tag: rental_income | deposit | late_fee | tax_payable | expense | etc.
  description?: string
}

export interface LedgerSettings {
  currency: string
  currency_symbol: string
  fiscal_year_start_month: number
  invoice_prefix: string
  receipt_prefix: string
  credit_note_prefix: string
  payment_terms_days: number
  accounts: AccountEntry[]
}

export interface TicketCategoryConfig {
  key: string
  label: string
  enabled: boolean
  icon?: string
  default_priority: string
  sla_hours?: number
}

export interface SignatureConfig {
  signature_key?: string    // presigned S3 URL when loaded from API
  signatory_name?: string   // e.g. "Cecil Homes Management"
  signatory_title?: string  // e.g. "Managing Director"
}


export interface BillingConfig {
  auto_generation_enabled: boolean
  preparation_day: number
  preparation_hour: number
  preparation_minute: number
  timezone: string
  payment_grace_days: number
}

export interface InventoryConfig {
  serial_merge_mode: 'keep_target' | 'create_new'
  serial_split_remainder_pct: number
  show_weight_tracking: boolean
  decimal_places: number
}

export interface DepositInterestSetting {
  enabled: boolean
  annual_rate_pct: number
  compound: boolean
  apply_on_refund: boolean
}

export interface AIConfig {
  provider: 'openai' | 'custom'
  base_url?: string
  model?: string
  api_key_set: boolean   // true if a key is stored; the key itself is never returned
}

export interface AIConfigUpdateRequest {
  provider?: 'openai' | 'custom'
  api_key?: string
  base_url?: string
  model?: string
}

export interface OrgProfile {
  org_id: string
  business?: BusinessDetails
  tax_config: TaxConfig
  ledger_settings: LedgerSettings
  billing_config: BillingConfig
  signature_config: SignatureConfig
  ticket_categories: TicketCategoryConfig[]
  voice_api_audit_enabled: boolean
  deposit_interest?: DepositInterestSetting
  ai_config: AIConfig
  setup_complete: boolean
}

export interface OrgUpdateRequest {
  business?: BusinessDetails
  tax_config?: TaxConfig
  ledger_settings?: LedgerSettings
  ticket_categories?: TicketCategoryConfig[]
  setup_complete?: boolean
}

export interface BillingConfigUpdateRequest {
  auto_generation_enabled?: boolean
  preparation_day?: number
  preparation_hour?: number
  preparation_minute?: number
  timezone?: string
  payment_grace_days?: number
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  vat_enabled: false,
  vat_rate: 16,
  vat_inclusive: false,
  withholding_tax_enabled: false,
  withholding_tax_rate: 0,
}

export const DEFAULT_ACCOUNTS: AccountEntry[] = [
  // Assets (1xxx)
  { id: 'a1100', code: '1100', name: 'Rent Receivable',           account_type: 'asset',     role: 'rent_receivable',       description: 'Outstanding rent invoices owed by tenants' },
  { id: 'a1200', code: '1200', name: 'Utility Deposit Held',      account_type: 'asset',     role: 'utility_deposit_asset', description: 'Utility deposits collected from tenants (asset side)' },
  { id: 'a1300', code: '1300', name: 'Prepaid Expenses',          account_type: 'asset',     role: 'prepaid',               description: 'Insurance, maintenance or other costs paid in advance' },
  { id: 'a1400', code: '1400', name: 'Inventory Asset',           account_type: 'asset',     role: 'inventory',             description: 'Stock and supplies held on-site' },
  // Liabilities (2xxx)
  { id: 'l2000', code: '2000', name: 'Security Deposits',         account_type: 'liability', role: 'deposit',               description: 'Refundable security deposits held on behalf of tenants' },
  { id: 'l2100', code: '2100', name: 'Tax Payable',               account_type: 'liability', role: 'tax_payable',           description: 'VAT / GST collected and owed to revenue authority' },
  { id: 'l2200', code: '2200', name: 'Advance Rent',              account_type: 'liability', role: 'advance_rent',          description: 'Rent received ahead of the billing period (deferred revenue)' },
  { id: 'l2300', code: '2300', name: 'Accounts Payable',          account_type: 'liability', role: 'accounts_payable',      description: 'Unpaid vendor and contractor invoices' },
  { id: 'l2400', code: '2400', name: 'Withholding Tax Payable',   account_type: 'liability', role: 'withholding_tax',       description: 'WHT on management fees and agent commissions' },
  { id: 'l2500', code: '2500', name: 'Agent Payable',             account_type: 'liability', role: 'agent_receivable',      description: 'Commissions owed to agents pending settlement' },
  { id: 'l2600', code: '2600', name: 'Utility Deposit Liability', account_type: 'liability', role: 'utility_deposit',       description: 'Utility deposits held — refundable to tenants on exit' },
  // Income (4xxx)
  { id: 'i4000', code: '4000', name: 'Rental Income',             account_type: 'income',    role: 'rental_income',         description: 'Base rent charged to tenants' },
  { id: 'i4100', code: '4100', name: 'Late Fees',                 account_type: 'income',    role: 'late_fee',              description: 'Penalties applied for overdue rent payments' },
  { id: 'i4200', code: '4200', name: 'Utility Income',            account_type: 'income',    role: 'utility_income',        description: 'Water, electricity and other utilities billed to tenants' },
  { id: 'i4300', code: '4300', name: 'Service Charge',            account_type: 'income',    role: 'service_charge',        description: 'Common-area maintenance and amenity levies' },
  { id: 'i4400', code: '4400', name: 'Move-in / Admin Fee',       account_type: 'income',    role: 'admin_fee',             description: 'One-off fees collected at lease signing' },
  { id: 'i4500', code: '4500', name: 'Parking & Other Fees',      account_type: 'income',    role: 'other_income',          description: 'Parking bays, storage, laundry and miscellaneous income' },
  { id: 'i4600', code: '4600', name: 'Commission Income',         account_type: 'income',    role: 'commission_income',     description: 'Agent commission charged to landlord on new leases' },
  { id: 'i4700', code: '4700', name: 'Forfeited Deposit',         account_type: 'income',    role: 'forfeited_deposit',     description: 'Portion of security deposit applied to damages — income to owner' },
  // Expenses (6xxx)
  { id: 'e6000', code: '6000', name: 'Operating Expenses',        account_type: 'expense',   role: 'expense',               description: 'General day-to-day operating costs' },
  { id: 'e6100', code: '6100', name: 'Maintenance & Repairs',     account_type: 'expense',   role: 'maintenance',           description: 'Vendor costs for maintenance tickets and property repairs' },
  { id: 'e6200', code: '6200', name: 'Common Utility Expense',    account_type: 'expense',   role: 'utility_expense',       description: 'Landlord-paid utilities for common areas' },
  { id: 'e6300', code: '6300', name: 'Management Fees',           account_type: 'expense',   role: 'management_fee',        description: 'Fees paid to the property management company' },
  { id: 'e6400', code: '6400', name: 'Agent Commission',          account_type: 'expense',   role: 'agent_commission',      description: 'Commission paid out to agents on leases' },
  { id: 'e6500', code: '6500', name: 'Insurance',                 account_type: 'expense',   role: 'insurance',             description: 'Property and liability insurance premiums' },
  { id: 'e6600', code: '6600', name: 'Legal & Professional',      account_type: 'expense',   role: 'legal',                 description: 'Legal fees for evictions, contracts and compliance' },
  { id: 'e6700', code: '6700', name: 'Bad Debt Expense',          account_type: 'expense',   role: 'bad_debt',              description: 'Rent receivables written off as uncollectable' },
  { id: 'e6800', code: '6800', name: 'Bank Charges',              account_type: 'expense',   role: 'bank_charges',          description: 'Mpesa transaction fees, bank transfer fees and related charges' },
]

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = {
  currency: 'KES',
  currency_symbol: 'KSh',
  fiscal_year_start_month: 1,
  invoice_prefix: 'INV',
  receipt_prefix: 'RCT',
  credit_note_prefix: 'CN',
  payment_terms_days: 30,
  accounts: DEFAULT_ACCOUNTS,
}
