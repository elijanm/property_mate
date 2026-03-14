import { useEffect, useState } from 'react'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import { UtilityConfigCard, CustomUtilityCard } from '@/components/UtilityConfigSection'
import { AccountsEditor } from '@/components/OrgFormWidgets'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import type { CustomUtilityDetail, LeaseDefaults, Property, PropertyUpdateRequest, UnitPolicyDefaults, UtilityDetail } from '@/types/property'
import type { AccountEntry, LedgerSettings, TaxConfig } from '@/types/org'
import { DEFAULT_LEDGER_SETTINGS, DEFAULT_TAX_CONFIG } from '@/types/org'

type Tab = 'info' | 'billing' | 'utilities' | 'deposit' | 'lease' | 'policies' | 'tax' | 'ledger'

interface Props {
  propertyId: string
  onClose: () => void
  onSaved: (p: Property) => void
}

const AMENITY_OPTIONS = [
  { id: 'pool', label: 'Pool' },
  { id: 'gym', label: 'Gym' },
  { id: 'elevator', label: 'Elevator' },
  { id: 'security', label: '24hr Security' },
  { id: 'backup_power', label: 'Backup Power' },
  { id: 'borehole', label: 'Borehole / Water Tank' },
  { id: 'laundry', label: 'Laundry Room' },
  { id: 'cctv', label: 'CCTV' },
  { id: 'rooftop', label: 'Rooftop Terrace' },
  { id: 'playground', label: "Children's Playground" },
]

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
      ].join(' ')}
    >
      {children}
    </button>
  )
}


export default function PropertyEditSlideOver({ propertyId, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('info')
  const [property, setProperty] = useState<Property | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Info fields
  const [name, setName] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [region, setRegion] = useState('')
  const [timezone, setTimezone] = useState('')

  // Billing fields
  const [invoiceDay, setInvoiceDay] = useState(1)
  const [dueDays, setDueDays] = useState(7)
  const [graceDays, setGraceDays] = useState(3)
  const [lateFeeType, setLateFeeType] = useState('flat')
  const [lateFeeValue, setLateFeeValue] = useState(500)

  // Utility fields
  const [electricity, setElectricity] = useState<UtilityDetail | undefined>(undefined)
  const [water, setWater] = useState<UtilityDetail | undefined>(undefined)
  const [gas, setGas] = useState<UtilityDetail | undefined>(undefined)
  const [internet, setInternet] = useState<UtilityDetail | undefined>(undefined)
  const [garbage, setGarbage] = useState<UtilityDetail | undefined>(undefined)
  const [security, setSecurity] = useState<UtilityDetail | undefined>(undefined)
  const [customUtilities, setCustomUtilities] = useState<CustomUtilityDetail[]>([])

  // Deposit fields
  const [depositRule, setDepositRule] = useState('1x_rent')
  const [depositAmount, setDepositAmount] = useState<number | undefined>(undefined)
  const [depositRefundable, setDepositRefundable] = useState(true)
  const [depositRefundPolicy, setDepositRefundPolicy] = useState('wear_and_tear')
  const [depositRefundDays, setDepositRefundDays] = useState(30)
  const [utilityDeposit, setUtilityDeposit] = useState<number | undefined>(undefined)
  const [utilityDepositIncomeAccount, setUtilityDepositIncomeAccount] = useState<string | undefined>(undefined)

  // Lease fields
  const [lease, setLease] = useState<LeaseDefaults>({
    min_duration_months: 1,
    default_duration_months: 12,
    notice_days: 30,
    termination_fee_type: 'none',
    auto_renewal: true,
    rent_escalation_pct: 0,
    escalation_review_months: 12,
  })

  // Policy fields
  const [policies, setPolicies] = useState<UnitPolicyDefaults>({
    pet_policy: 'not_allowed',
    smoking_allowed: false,
    parking_available: false,
    amenities: [],
  })

  // Tax / Ledger override fields
  const { orgProfile } = useOrgProfile()
  const [taxOverride, setTaxOverride] = useState(false)
  const [taxConfig, setTaxConfig] = useState<TaxConfig>(DEFAULT_TAX_CONFIG)
  const [ledgerOverride, setLedgerOverride] = useState(false)
  const [ledgerSettings, setLedgerSettings] = useState<LedgerSettings>(DEFAULT_LEDGER_SETTINGS)
  const effectiveAccounts: AccountEntry[] =
    (ledgerOverride ? ledgerSettings.accounts : orgProfile?.ledger_settings?.accounts) ?? []

  useEffect(() => {
    propertiesApi.get(propertyId).then((p) => {
      setProperty(p)
      setName(p.name)
      setPropertyType(p.property_type)
      setRegion(p.region)
      setTimezone(p.timezone)
      setInvoiceDay(p.billing_settings.invoice_day)
      setDueDays(p.billing_settings.due_days)
      setGraceDays(p.billing_settings.grace_days)
      setLateFeeType(p.billing_settings.late_fee_type)
      setLateFeeValue(p.billing_settings.late_fee_value)
      setElectricity(p.utility_defaults.electricity)
      setWater(p.utility_defaults.water)
      setGas(p.utility_defaults.gas)
      setInternet(p.utility_defaults.internet)
      setGarbage(p.utility_defaults.garbage)
      setSecurity(p.utility_defaults.security)
      setCustomUtilities(p.utility_defaults.custom ?? [])
      setDepositRule(p.pricing_defaults.deposit_rule)
      setDepositAmount(p.pricing_defaults.deposit_amount)
      setDepositRefundable(p.pricing_defaults.deposit_refundable)
      setDepositRefundPolicy(p.pricing_defaults.deposit_refund_policy)
      setDepositRefundDays(p.pricing_defaults.deposit_refund_days)
      setUtilityDeposit(p.pricing_defaults.utility_deposit)
      setUtilityDepositIncomeAccount(p.pricing_defaults.utility_deposit_income_account)
      setLease(p.lease_defaults ?? {
        min_duration_months: 1,
        default_duration_months: 12,
        notice_days: 30,
        termination_fee_type: 'none',
        auto_renewal: true,
        rent_escalation_pct: 0,
        escalation_review_months: 12,
      })
      setPolicies(p.unit_policies ?? {
        pet_policy: 'not_allowed',
        smoking_allowed: false,
        parking_available: false,
        amenities: [],
      })
      if (p.tax_config) {
        setTaxOverride(true)
        setTaxConfig(p.tax_config)
      }
      if (p.ledger_settings) {
        setLedgerOverride(true)
        setLedgerSettings(p.ledger_settings)
      }
    })
  }, [propertyId])

  function toggleAmenity(id: string) {
    setPolicies((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter((a) => a !== id)
        : [...prev.amenities, id],
    }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload: PropertyUpdateRequest = {
        name,
        property_type: propertyType,
        region,
        timezone,
        billing_settings: {
          invoice_day: invoiceDay,
          due_days: dueDays,
          grace_days: graceDays,
          late_fee_type: lateFeeType as 'flat' | 'percentage',
          late_fee_value: lateFeeValue,
        },
        utility_defaults: { electricity, water, gas, internet, garbage, security, custom: customUtilities },
        pricing_defaults: {
          deposit_rule: depositRule as '1x_rent' | '2x_rent' | '3x_rent' | 'custom',
          deposit_amount: depositRule === 'custom' ? depositAmount : undefined,
          deposit_refundable: depositRefundable,
          deposit_refund_policy: depositRefundPolicy as 'none' | 'wear_and_tear' | 'full_inspection',
          deposit_refund_days: depositRefundDays,
          utility_deposit: utilityDeposit,
          utility_deposit_income_account: utilityDepositIncomeAccount,
        },
        lease_defaults: lease,
        unit_policies: policies,
        tax_config: taxOverride ? taxConfig : undefined,
        ledger_settings: ledgerOverride ? ledgerSettings : undefined,
      }
      const updated = await propertiesApi.update(propertyId, payload)
      onSaved(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[580px] bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Property{property ? ` — ${property.name}` : ''}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-2 overflow-x-auto">
          <TabBtn active={tab === 'info'} onClick={() => setTab('info')}>Info</TabBtn>
          <TabBtn active={tab === 'billing'} onClick={() => setTab('billing')}>Billing</TabBtn>
          <TabBtn active={tab === 'utilities'} onClick={() => setTab('utilities')}>Utilities</TabBtn>
          <TabBtn active={tab === 'deposit'} onClick={() => setTab('deposit')}>Deposit</TabBtn>
          <TabBtn active={tab === 'lease'} onClick={() => setTab('lease')}>Lease</TabBtn>
          <TabBtn active={tab === 'policies'} onClick={() => setTab('policies')}>Policies</TabBtn>
          <TabBtn active={tab === 'tax'} onClick={() => setTab('tax')}>Tax</TabBtn>
          <TabBtn active={tab === 'ledger'} onClick={() => setTab('ledger')}>Ledger</TabBtn>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!property ? (
            <div className="text-center text-gray-400 py-16">Loading…</div>
          ) : (
            <>
              {tab === 'info' && (
                <div className="space-y-4">
                  <div>
                    <label className="label">Property Name *</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Type</label>
                      <select className="input" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                        <option value="residential">Residential</option>
                        <option value="commercial">Commercial</option>
                        <option value="mixed">Mixed Use</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Region</label>
                      <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Timezone</label>
                    <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                  </div>
                </div>
              )}

              {tab === 'billing' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="label">Invoice Day</label>
                      <input className="input" type="number" min={1} max={28} value={invoiceDay} onChange={(e) => setInvoiceDay(+e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Due Days</label>
                      <input className="input" type="number" min={0} value={dueDays} onChange={(e) => setDueDays(+e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Grace Days</label>
                      <input className="input" type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(+e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Late Fee Type</label>
                      <select className="input" value={lateFeeType} onChange={(e) => setLateFeeType(e.target.value)}>
                        <option value="flat">Flat Amount (KES)</option>
                        <option value="percentage">Percentage (%)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Late Fee Value</label>
                      <input className="input" type="number" min={0} value={lateFeeValue} onChange={(e) => setLateFeeValue(+e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {tab === 'utilities' && (
                <div>
                  <UtilityConfigCard label="Electricity" utilityKey="electricity" value={electricity} onChange={setElectricity} accounts={effectiveAccounts} propertyId={propertyId} />
                  <UtilityConfigCard label="Water" utilityKey="water" value={water} onChange={setWater} accounts={effectiveAccounts} propertyId={propertyId} />
                  <UtilityConfigCard label="Gas" utilityKey="gas" value={gas} onChange={setGas} accounts={effectiveAccounts} propertyId={propertyId} />
                  <UtilityConfigCard label="Internet" utilityKey="internet" value={internet} onChange={setInternet} accounts={effectiveAccounts} propertyId={propertyId} />
                  <UtilityConfigCard label="Garbage Collection" utilityKey="garbage" value={garbage} onChange={setGarbage} accounts={effectiveAccounts} propertyId={propertyId} />
                  <UtilityConfigCard label="Security Fee" utilityKey="security" value={security} onChange={setSecurity} accounts={effectiveAccounts} propertyId={propertyId} />

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Custom Utilities</p>
                    {customUtilities.map((cu, i) => (
                      <CustomUtilityCard
                        key={i}
                        value={cu}
                        onChange={(v) => setCustomUtilities((prev) => prev.map((x, idx) => idx === i ? v : x))}
                        onRemove={() => setCustomUtilities((prev) => prev.filter((_, idx) => idx !== i))}
                        accounts={effectiveAccounts}
                        propertyId={propertyId}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setCustomUtilities((prev) => [
                          ...prev,
                          { key: `custom_${prev.length + 1}`, type: 'subscription', label: '' },
                        ])
                      }
                      className="text-blue-600 text-sm font-medium hover:underline"
                    >
                      + Add Custom Utility
                    </button>
                  </div>
                </div>
              )}

              {tab === 'deposit' && (
                <div className="space-y-4">
                  <div>
                    <label className="label">Deposit Rule</label>
                    <select className="input" value={depositRule} onChange={(e) => setDepositRule(e.target.value)}>
                      <option value="1x_rent">1× Rent</option>
                      <option value="2x_rent">2× Rent</option>
                      <option value="3x_rent">3× Rent</option>
                      <option value="custom">Custom Amount</option>
                    </select>
                  </div>
                  {depositRule === 'custom' && (
                    <div>
                      <label className="label">Deposit Amount (KES)</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={depositAmount ?? ''}
                        onChange={(e) => setDepositAmount(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={depositRefundable}
                      onChange={(e) => setDepositRefundable(e.target.checked)}
                    />
                    <span className="text-sm">Deposit is refundable</span>
                  </label>
                  {depositRefundable && (
                    <>
                      <div>
                        <label className="label">Refund Policy</label>
                        <select className="input" value={depositRefundPolicy} onChange={(e) => setDepositRefundPolicy(e.target.value)}>
                          <option value="none">No deductions</option>
                          <option value="wear_and_tear">Allow wear and tear deductions</option>
                          <option value="full_inspection">Full inspection deductions</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Refund Timeline (days)</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={depositRefundDays}
                          onChange={(e) => setDepositRefundDays(+e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {/* Utility deposit */}
                  <div className="pt-4 border-t border-gray-100 space-y-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Utility Deposit</p>
                    <div>
                      <label className="label">Utility Deposit Amount (KES)</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        placeholder="Optional — one-time refundable deposit"
                        value={utilityDeposit ?? ''}
                        onChange={(e) => setUtilityDeposit(e.target.value ? parseFloat(e.target.value) : undefined)}
                      />
                      <p className="text-xs text-gray-400 mt-1">Collected on move-in, refundable on termination.</p>
                    </div>
                    {effectiveAccounts.length > 0 && (
                      <div>
                        <label className="label">Utility Deposit Income Account</label>
                        <select
                          className="input"
                          value={utilityDepositIncomeAccount ?? ''}
                          onChange={(e) => setUtilityDepositIncomeAccount(e.target.value || undefined)}
                        >
                          <option value="">— Use org default —</option>
                          {effectiveAccounts.map((a) => (
                            <option key={a.id} value={a.code}>
                              {a.code} · {a.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">
                          Ledger account where utility deposit receipts are posted.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'lease' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Default Duration (months)</label>
                      <input
                        type="number" className="input" min={1}
                        value={lease.default_duration_months}
                        onChange={(e) => setLease({ ...lease, default_duration_months: +e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Minimum Duration (months)</label>
                      <input
                        type="number" className="input" min={1}
                        value={lease.min_duration_months}
                        onChange={(e) => setLease({ ...lease, min_duration_months: +e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Notice Period (days)</label>
                      <input
                        type="number" className="input" min={0}
                        value={lease.notice_days}
                        onChange={(e) => setLease({ ...lease, notice_days: +e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Termination Fee Type</label>
                      <select
                        className="input"
                        value={lease.termination_fee_type}
                        onChange={(e) => setLease({ ...lease, termination_fee_type: e.target.value as LeaseDefaults['termination_fee_type'] })}
                      >
                        <option value="none">None</option>
                        <option value="flat">Flat Amount (KES)</option>
                        <option value="months_rent">Months of Rent</option>
                      </select>
                    </div>
                    {lease.termination_fee_type !== 'none' && (
                      <div>
                        <label className="label">
                          {lease.termination_fee_type === 'flat' ? 'Fee Amount (KES)' : 'Number of Months'}
                        </label>
                        <input
                          type="number" className="input" min={0}
                          value={lease.termination_fee_value ?? ''}
                          onChange={(e) => setLease({ ...lease, termination_fee_value: e.target.value ? +e.target.value : undefined })}
                        />
                      </div>
                    )}
                    <div>
                      <label className="label">Annual Rent Escalation (%)</label>
                      <input
                        type="number" className="input" min={0} step={0.1}
                        value={lease.rent_escalation_pct}
                        onChange={(e) => setLease({ ...lease, rent_escalation_pct: +e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Escalation Review (months)</label>
                      <input
                        type="number" className="input" min={1}
                        value={lease.escalation_review_months}
                        onChange={(e) => setLease({ ...lease, escalation_review_months: +e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lease.auto_renewal}
                      onChange={(e) => setLease({ ...lease, auto_renewal: e.target.checked })}
                    />
                    <span className="text-sm">Auto-renew lease on expiry</span>
                  </label>
                </div>
              )}

              {tab === 'tax' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Override org tax settings</p>
                      <p className="text-xs text-gray-500">
                        {taxOverride ? 'Using property-specific settings' : 'Inheriting from organization defaults'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !taxOverride
                        setTaxOverride(next)
                        if (next) setTaxConfig(orgProfile?.tax_config ?? DEFAULT_TAX_CONFIG)
                      }}
                      className={[
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        taxOverride ? 'bg-blue-600' : 'bg-gray-200',
                      ].join(' ')}
                    >
                      <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', taxOverride ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                    </button>
                  </div>
                  {!taxOverride && orgProfile?.tax_config && (
                    <div className="space-y-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                      <p><span className="font-medium">VAT:</span> {orgProfile.tax_config.vat_enabled ? `${orgProfile.tax_config.vat_rate}%` : 'Disabled'}</p>
                      <p><span className="font-medium">WHT:</span> {orgProfile.tax_config.withholding_tax_enabled ? `${orgProfile.tax_config.withholding_tax_rate}%` : 'Disabled'}</p>
                    </div>
                  )}
                  {taxOverride && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-gray-200 p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-900">Enable VAT</p>
                          <button
                            type="button"
                            onClick={() => setTaxConfig((t) => ({ ...t, vat_enabled: !t.vat_enabled }))}
                            className={['relative inline-flex h-6 w-11 items-center rounded-full transition-colors', taxConfig.vat_enabled ? 'bg-blue-600' : 'bg-gray-200'].join(' ')}
                          >
                            <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', taxConfig.vat_enabled ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                          </button>
                        </div>
                        {taxConfig.vat_enabled && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="label">VAT Rate (%)</label>
                              <input className="input" type="number" step="0.1" min={0} value={taxConfig.vat_rate} onChange={(e) => setTaxConfig((t) => ({ ...t, vat_rate: +e.target.value }))} />
                            </div>
                            <div>
                              <label className="label">VAT Number</label>
                              <input className="input" value={taxConfig.vat_number ?? ''} onChange={(e) => setTaxConfig((t) => ({ ...t, vat_number: e.target.value }))} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-900">Enable Withholding Tax</p>
                          <button
                            type="button"
                            onClick={() => setTaxConfig((t) => ({ ...t, withholding_tax_enabled: !t.withholding_tax_enabled }))}
                            className={['relative inline-flex h-6 w-11 items-center rounded-full transition-colors', taxConfig.withholding_tax_enabled ? 'bg-blue-600' : 'bg-gray-200'].join(' ')}
                          >
                            <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', taxConfig.withholding_tax_enabled ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                          </button>
                        </div>
                        {taxConfig.withholding_tax_enabled && (
                          <div>
                            <label className="label">WHT Rate (%)</label>
                            <input className="input" type="number" step="0.1" min={0} value={taxConfig.withholding_tax_rate} onChange={(e) => setTaxConfig((t) => ({ ...t, withholding_tax_rate: +e.target.value }))} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'ledger' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Override org ledger settings</p>
                      <p className="text-xs text-gray-500">
                        {ledgerOverride ? 'Using property-specific settings' : 'Inheriting from organization defaults'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !ledgerOverride
                        setLedgerOverride(next)
                        if (next) setLedgerSettings(orgProfile?.ledger_settings ?? DEFAULT_LEDGER_SETTINGS)
                      }}
                      className={[
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        ledgerOverride ? 'bg-blue-600' : 'bg-gray-200',
                      ].join(' ')}
                    >
                      <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', ledgerOverride ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
                    </button>
                  </div>
                  {!ledgerOverride && orgProfile?.ledger_settings && (
                    <div className="space-y-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
                      <p><span className="font-medium">Currency:</span> {orgProfile.ledger_settings.currency_symbol} ({orgProfile.ledger_settings.currency})</p>
                      <p><span className="font-medium">Invoice prefix:</span> {orgProfile.ledger_settings.invoice_prefix}</p>
                      <p><span className="font-medium">Payment terms:</span> {orgProfile.ledger_settings.payment_terms_days} days</p>
                    </div>
                  )}
                  {ledgerOverride && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="label">Currency</label>
                          <input className="input" value={ledgerSettings.currency} onChange={(e) => setLedgerSettings((l) => ({ ...l, currency: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Symbol</label>
                          <input className="input" value={ledgerSettings.currency_symbol} onChange={(e) => setLedgerSettings((l) => ({ ...l, currency_symbol: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Payment Terms (days)</label>
                          <input className="input" type="number" min={0} value={ledgerSettings.payment_terms_days} onChange={(e) => setLedgerSettings((l) => ({ ...l, payment_terms_days: +e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="label">Invoice Prefix</label>
                          <input className="input" value={ledgerSettings.invoice_prefix} onChange={(e) => setLedgerSettings((l) => ({ ...l, invoice_prefix: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Receipt Prefix</label>
                          <input className="input" value={ledgerSettings.receipt_prefix} onChange={(e) => setLedgerSettings((l) => ({ ...l, receipt_prefix: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Credit Note Prefix</label>
                          <input className="input" value={ledgerSettings.credit_note_prefix} onChange={(e) => setLedgerSettings((l) => ({ ...l, credit_note_prefix: e.target.value }))} />
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                          Chart of Accounts
                        </p>
                        <AccountsEditor
                          accounts={ledgerSettings.accounts}
                          onChange={(accounts: AccountEntry[]) =>
                            setLedgerSettings((l) => ({ ...l, accounts }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'policies' && (
                <div className="space-y-5">
                  <div>
                    <label className="label">Pet Policy</label>
                    <select
                      className="input"
                      value={policies.pet_policy}
                      onChange={(e) => setPolicies({ ...policies, pet_policy: e.target.value as UnitPolicyDefaults['pet_policy'] })}
                    >
                      <option value="not_allowed">Not Allowed</option>
                      <option value="allowed">Allowed</option>
                      <option value="allowed_with_deposit">Allowed with Deposit</option>
                    </select>
                  </div>
                  {policies.pet_policy === 'allowed_with_deposit' && (
                    <div>
                      <label className="label">Pet Deposit (KES)</label>
                      <input
                        type="number" className="input" min={0}
                        value={policies.pet_deposit ?? ''}
                        onChange={(e) => setPolicies({ ...policies, pet_deposit: e.target.value ? +e.target.value : undefined })}
                      />
                    </div>
                  )}
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={policies.smoking_allowed}
                        onChange={(e) => setPolicies({ ...policies, smoking_allowed: e.target.checked })}
                      />
                      Smoking Allowed
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={policies.parking_available}
                        onChange={(e) => setPolicies({ ...policies, parking_available: e.target.checked })}
                      />
                      Parking Available
                    </label>
                  </div>
                  {policies.parking_available && (
                    <div>
                      <label className="label">Parking Fee (KES/month)</label>
                      <input
                        type="number" className="input" min={0}
                        value={policies.parking_fee ?? ''}
                        onChange={(e) => setPolicies({ ...policies, parking_fee: e.target.value ? +e.target.value : undefined })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="label">Amenities</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {AMENITY_OPTIONS.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={policies.amenities.includes(a.id)}
                            onChange={() => toggleAmenity(a.id)}
                          />
                          {a.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Guest Policy (optional)</label>
                    <textarea
                      className="input min-h-[80px]"
                      placeholder="e.g. Guests allowed up to 7 days per month."
                      value={policies.guest_policy ?? ''}
                      onChange={(e) => setPolicies({ ...policies, guest_policy: e.target.value || undefined })}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 ml-auto">
            <button onClick={onClose} className="btn-outline">Cancel</button>
            <button onClick={handleSave} disabled={saving || !property} className="btn-primary">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
