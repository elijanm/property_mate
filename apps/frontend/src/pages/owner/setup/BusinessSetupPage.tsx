import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orgApi } from '@/api/org'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import { extractApiError } from '@/utils/apiError'
import { LogoUpload, AccountsEditor } from '@/components/OrgFormWidgets'
import type { AccountEntry, BusinessDetails, LedgerSettings, TaxConfig } from '@/types/org'
import { DEFAULT_LEDGER_SETTINGS, DEFAULT_TAX_CONFIG } from '@/types/org'

type Step = 'business' | 'ledger' | 'tax'
const STEPS: Step[] = ['business', 'ledger', 'tax']
const STEP_LABELS: Record<Step, string> = {
  business: 'Business Details',
  ledger: 'Ledger Settings',
  tax: 'Tax Configuration',
}

export default function BusinessSetupPage() {
  const navigate = useNavigate()
  const { orgProfile, refresh } = useOrgProfile()
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [business, setBusiness] = useState<BusinessDetails>({
    name: orgProfile?.business?.name ?? '',
    registration_number: orgProfile?.business?.registration_number ?? '',
    kra_pin: orgProfile?.business?.kra_pin ?? '',
    phone: orgProfile?.business?.phone ?? '',
    email: orgProfile?.business?.email ?? '',
    website: orgProfile?.business?.website ?? '',
    address: orgProfile?.business?.address ?? '',
    logo_url: orgProfile?.business?.logo_url,
  })
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null)

  const [ledger, setLedger] = useState<LedgerSettings>(
    orgProfile?.ledger_settings ?? DEFAULT_LEDGER_SETTINGS,
  )

  const [tax, setTax] = useState<TaxConfig>(
    orgProfile?.tax_config ?? DEFAULT_TAX_CONFIG,
  )

  const step = STEPS[stepIdx]

  function patchBusiness(field: keyof BusinessDetails, value: string) {
    setBusiness((b) => ({ ...b, [field]: value }))
  }

  function patchLedger(field: keyof Omit<LedgerSettings, 'accounts'>, value: string | number) {
    setLedger((l) => ({ ...l, [field]: value }))
  }

  function patchTax(field: keyof TaxConfig, value: boolean | number | string) {
    setTax((t) => ({ ...t, [field]: value }))
  }

  async function uploadLogoIfPending(): Promise<string | undefined> {
    if (!pendingLogoFile) return undefined
    setLogoUploading(true)
    try {
      const updated = await orgApi.uploadLogo(pendingLogoFile)
      return updated.business?.logo_url
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleFinish() {
    setSaving(true)
    setError(null)
    try {
      const logoUrl = await uploadLogoIfPending()
      await orgApi.updateProfile({
        business: { ...business, logo_url: logoUrl ?? business.logo_url },
        ledger_settings: ledger,
        tax_config: tax,
        setup_complete: true,
      })
      refresh()
      navigate('/portfolio/properties')
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleNext() {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx((i) => i + 1)
    } else {
      await handleFinish()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set up your business</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Configure your organization before managing properties.
          </p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div
                className={[
                  'h-1.5 rounded-full',
                  i <= stepIdx ? 'bg-blue-600' : 'bg-gray-200',
                ].join(' ')}
              />
              <p
                className={[
                  'text-xs mt-1.5 font-medium',
                  i === stepIdx ? 'text-blue-600' : 'text-gray-400',
                ].join(' ')}
              >
                {STEP_LABELS[s]}
              </p>
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {step === 'business' && (
            <BusinessStep
              business={business}
              onChange={patchBusiness}
              onFileSelected={(f) => setPendingLogoFile(f)}
              logoUploading={logoUploading}
            />
          )}
          {step === 'ledger' && (
            <LedgerStep
              ledger={ledger}
              onChange={patchLedger}
              onAccountsChange={(accounts) => setLedger((l) => ({ ...l, accounts }))}
            />
          )}
          {step === 'tax' && (
            <TaxStep tax={tax} onChange={patchTax} />
          )}

          {error && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={() => setStepIdx((i) => i - 1)}
              disabled={stepIdx === 0}
              className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={saving || logoUploading}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving || logoUploading
                ? 'Saving…'
                : stepIdx === STEPS.length - 1
                  ? 'Finish Setup'
                  : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Business Step ─────────────────────────────────────────────────────── */

function BusinessStep({
  business,
  onChange,
  onFileSelected,
  logoUploading,
}: {
  business: BusinessDetails
  onChange: (field: keyof BusinessDetails, value: string) => void
  onFileSelected: (file: File) => void
  logoUploading: boolean
}) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Business Details</h2>

      {/* Logo */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Business Logo</label>
        <LogoUpload
          currentUrl={business.logo_url}
          onFileSelected={onFileSelected}
          uploading={logoUploading}
        />
      </div>

      <Field label="Business Name *">
        <input
          className="input"
          value={business.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="Skyline Properties Ltd"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Registration Number">
          <input
            className="input"
            value={business.registration_number ?? ''}
            onChange={(e) => onChange('registration_number', e.target.value)}
            placeholder="PVT-12345"
          />
        </Field>
        <Field label="KRA PIN">
          <input
            className="input"
            value={business.kra_pin ?? ''}
            onChange={(e) => onChange('kra_pin', e.target.value)}
            placeholder="A000000000Z"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input
            className="input"
            value={business.phone ?? ''}
            onChange={(e) => onChange('phone', e.target.value)}
            placeholder="+254 700 000000"
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={business.email ?? ''}
            onChange={(e) => onChange('email', e.target.value)}
            placeholder="info@skyline.co.ke"
          />
        </Field>
      </div>
      <Field label="Website">
        <input
          className="input"
          value={business.website ?? ''}
          onChange={(e) => onChange('website', e.target.value)}
          placeholder="https://skyline.co.ke"
        />
      </Field>
      <Field label="Address">
        <textarea
          className="input resize-none"
          rows={2}
          value={business.address ?? ''}
          onChange={(e) => onChange('address', e.target.value)}
          placeholder="123 Westlands, Nairobi, Kenya"
        />
      </Field>
    </div>
  )
}

/* ─── Ledger Step ───────────────────────────────────────────────────────── */

function LedgerStep({
  ledger,
  onChange,
  onAccountsChange,
}: {
  ledger: LedgerSettings
  onChange: (field: keyof Omit<LedgerSettings, 'accounts'>, value: string | number) => void
  onAccountsChange: (accounts: AccountEntry[]) => void
}) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Ledger Settings</h2>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Currency Code">
          <input
            className="input"
            value={ledger.currency}
            onChange={(e) => onChange('currency', e.target.value)}
            placeholder="KES"
          />
        </Field>
        <Field label="Currency Symbol">
          <input
            className="input"
            value={ledger.currency_symbol}
            onChange={(e) => onChange('currency_symbol', e.target.value)}
            placeholder="KSh"
          />
        </Field>
        <Field label="Fiscal Year Start">
          <select
            className="input"
            value={ledger.fiscal_year_start_month}
            onChange={(e) => onChange('fiscal_year_start_month', Number(e.target.value))}
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Invoice Prefix">
          <input className="input" value={ledger.invoice_prefix} onChange={(e) => onChange('invoice_prefix', e.target.value)} />
        </Field>
        <Field label="Receipt Prefix">
          <input className="input" value={ledger.receipt_prefix} onChange={(e) => onChange('receipt_prefix', e.target.value)} />
        </Field>
        <Field label="Credit Note Prefix">
          <input className="input" value={ledger.credit_note_prefix} onChange={(e) => onChange('credit_note_prefix', e.target.value)} />
        </Field>
      </div>
      <Field label="Payment Terms (days)">
        <input
          className="input"
          type="number"
          min={0}
          value={ledger.payment_terms_days}
          onChange={(e) => onChange('payment_terms_days', Number(e.target.value))}
        />
      </Field>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Chart of Accounts
        </p>
        <AccountsEditor accounts={ledger.accounts} onChange={onAccountsChange} />
      </div>
    </div>
  )
}

/* ─── Tax Step ──────────────────────────────────────────────────────────── */

function TaxStep({
  tax,
  onChange,
}: {
  tax: TaxConfig
  onChange: (field: keyof TaxConfig, value: boolean | number | string) => void
}) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Tax Configuration</h2>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable VAT</p>
            <p className="text-xs text-gray-500">Add VAT to all invoices</p>
          </div>
          <Toggle value={tax.vat_enabled} onChange={(v) => onChange('vat_enabled', v)} />
        </div>
        {tax.vat_enabled && (
          <>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Field label="VAT Rate (%)">
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min={0}
                  value={tax.vat_rate}
                  onChange={(e) => onChange('vat_rate', Number(e.target.value))}
                />
              </Field>
              <Field label="VAT Registration Number">
                <input
                  className="input"
                  value={tax.vat_number ?? ''}
                  onChange={(e) => onChange('vat_number', e.target.value)}
                  placeholder="VAT/0000000"
                />
              </Field>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-sm font-medium text-gray-900">VAT Inclusive Pricing</p>
                <p className="text-xs text-gray-500">Prices shown include VAT</p>
              </div>
              <Toggle value={tax.vat_inclusive} onChange={(v) => onChange('vat_inclusive', v)} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable Withholding Tax</p>
            <p className="text-xs text-gray-500">Deduct withholding tax from payments</p>
          </div>
          <Toggle
            value={tax.withholding_tax_enabled}
            onChange={(v) => onChange('withholding_tax_enabled', v)}
          />
        </div>
        {tax.withholding_tax_enabled && (
          <Field label="Withholding Tax Rate (%)">
            <input
              className="input"
              type="number"
              step="0.1"
              min={0}
              value={tax.withholding_tax_rate}
              onChange={(e) => onChange('withholding_tax_rate', Number(e.target.value))}
            />
          </Field>
        )}
      </div>
    </div>
  )
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={[
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        value ? 'bg-blue-600' : 'bg-gray-200',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
    </button>
  )
}
