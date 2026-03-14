import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import DashboardLayout from '@/layouts/DashboardLayout'
import { UtilityConfigCard, CustomUtilityCard } from '@/components/UtilityConfigSection'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import type {
  BillingSettings,
  CustomUtilityDetail,
  LeaseDefaults,
  PricingDefaults,
  PropertyCreateRequest,
  UnitPolicyDefaults,
  UnitTemplateRequest,
  UtilityDefaults,
  UtilityDetail,
  WingConfig,
} from '@/types/property'

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ['Basics', 'Structure', 'Units', 'Utilities', 'Deposit', 'Lease', 'Policies', 'Billing', 'Review'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

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

const DEFAULT_BILLING: BillingSettings = {
  invoice_day: 1,
  due_days: 7,
  grace_days: 3,
  late_fee_type: 'flat',
  late_fee_value: 500,
  show_tiered_breakdown: false,
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NewPropertyPage() {
  const navigate = useNavigate()
  const { orgProfile } = useOrgProfile()
  const orgAccounts = orgProfile?.ledger_settings?.accounts ?? []
  const [step, setStep] = useState<Step>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  // Step 0: Basics
  const [basics, setBasics] = useState({
    name: '',
    property_type: 'residential' as 'residential' | 'commercial' | 'mixed',
    region: '',
    timezone: 'Africa/Nairobi',
    address: { street: '', city: '', state: '', country: 'Kenya' },
  })

  // Step 1: Structure
  const [wings, setWings] = useState<WingConfig[]>([])
  const [hasWings, setHasWings] = useState(false)

  // Step 2: Units
  const [templates, setTemplates] = useState<UnitTemplateRequest[]>([
    {
      template_name: 'Standard',
      floors_start: 1,
      floors_end: 1,
      units_per_floor: 10,
      unit_type: 'standard',
      furnished: false,
      is_premium: false,
    },
  ])

  // Step 3: Utilities
  type NamedUtilities = { [K in Exclude<keyof UtilityDefaults, 'custom'>]?: UtilityDetail }
  const [utilities, setUtilities] = useState<NamedUtilities>({})
  const [customUtilities, setCustomUtilities] = useState<CustomUtilityDetail[]>([])

  // Step 4: Deposit
  const [pricing, setPricing] = useState<PricingDefaults>({
    deposit_rule: '1x_rent',
    deposit_refundable: true,
    deposit_refund_policy: 'wear_and_tear',
    deposit_refund_days: 30,
  })

  // Step 5: Lease
  const [leaseDefaults, setLeaseDefaults] = useState<LeaseDefaults>({
    min_duration_months: 1,
    default_duration_months: 12,
    notice_days: 30,
    termination_fee_type: 'none',
    auto_renewal: true,
    rent_escalation_pct: 0,
    escalation_review_months: 12,
  })

  // Step 6: Policies
  const [unitPolicies, setUnitPolicies] = useState<UnitPolicyDefaults>({
    pet_policy: 'not_allowed',
    smoking_allowed: false,
    parking_available: false,
    amenities: [],
  })

  // Step 7: Billing
  const [billing, setBilling] = useState<BillingSettings>(DEFAULT_BILLING)

  const totalUnits = templates.reduce((sum, t) => {
    const floors = t.floors_end - t.floors_start + 1
    const unitsPerFloor = t.unit_numbers?.length ?? t.units_per_floor ?? 0
    const targetWings = t.wings?.length ?? (hasWings ? wings.length : 1)
    return sum + floors * unitsPerFloor * targetWings
  }, 0)

  function addWing() {
    setWings((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), floors_start: 1, floors_end: 5 }])
  }

  function updateWing(i: number, field: keyof WingConfig, value: string | number) {
    setWings((prev) => prev.map((w, idx) => (idx === i ? { ...w, [field]: value } : w)))
  }

  function addTemplate() {
    setTemplates((prev) => [
      ...prev,
      {
        template_name: `Template ${prev.length + 1}`,
        floors_start: 1,
        floors_end: 1,
        units_per_floor: 5,
        unit_type: 'standard',
        furnished: false,
        is_premium: false,
      },
    ])
  }

  function updateTemplate(i: number, updates: Partial<UnitTemplateRequest>) {
    setTemplates((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...updates } : t)))
  }

  function setUtility(key: Exclude<keyof UtilityDefaults, 'custom'>, value: UtilityDetail | undefined) {
    setUtilities((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAmenity(id: string) {
    setUnitPolicies((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter((a) => a !== id)
        : [...prev.amenities, id],
    }))
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const payload: PropertyCreateRequest = {
        name: basics.name,
        property_type: basics.property_type,
        region: basics.region,
        timezone: basics.timezone,
        address: basics.address,
        wings: hasWings ? wings : undefined,
        unit_templates: templates,
        utility_defaults: { ...utilities, custom: customUtilities },
        pricing_defaults: pricing,
        billing_settings: billing,
        lease_defaults: leaseDefaults,
        unit_policies: unitPolicies,
      }
      const result = await propertiesApi.create(payload)
      if (result.job_id) {
        setJobId(result.job_id)
      } else {
        navigate(`/portfolio/properties/${result.property.id}/units`)
      }
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  if (jobId) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto mt-24 text-center px-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <span className="text-3xl">⚙️</span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Generating {totalUnits} units…</h2>
          <p className="text-gray-500 text-sm mb-2">
            Job ID: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{jobId}</code>
          </p>
          <p className="text-sm text-gray-400 mb-8">
            Large properties are generated in the background. Units will appear once the job completes.
          </p>
          <button
            onClick={() => navigate('/portfolio/properties')}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Back to Properties
          </button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto py-8 px-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link to="/portfolio" className="hover:text-blue-600 transition-colors">Portfolio</Link>
          <span>›</span>
          <Link to="/portfolio/properties" className="hover:text-blue-600 transition-colors">Real Estate</Link>
          <span>›</span>
          <span className="text-gray-900 font-medium">New Property</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-shrink-0">
              <button
                onClick={() => i < step && setStep(i as Step)}
                className={`w-7 h-7 rounded-full text-xs font-medium flex items-center justify-center
                  ${i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-green-500 text-white cursor-pointer' : 'bg-gray-200 text-gray-500'}`}
              >
                {i < step ? '✓' : i + 1}
              </button>
              <span className={`ml-1 text-xs hidden md:block ${i === step ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{label}</span>
              {i < STEPS.length - 1 && <div className="w-5 h-px bg-gray-300 mx-1" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}

        {/* ── Step 0: Basics ── */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Property Basics</h2>
            <div>
              <label className="label">Property Name *</label>
              <input className="input" value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={basics.property_type} onChange={(e) => setBasics({ ...basics, property_type: e.target.value as typeof basics.property_type })}>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="mixed">Mixed Use</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Region *</label>
                <input className="input" value={basics.region} onChange={(e) => setBasics({ ...basics, region: e.target.value })} />
              </div>
              <div>
                <label className="label">Timezone</label>
                <input className="input" value={basics.timezone} onChange={(e) => setBasics({ ...basics, timezone: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Street Address *</label>
              <input className="input" value={basics.address.street} onChange={(e) => setBasics({ ...basics, address: { ...basics.address, street: e.target.value } })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">City *</label>
                <input className="input" value={basics.address.city} onChange={(e) => setBasics({ ...basics, address: { ...basics.address, city: e.target.value } })} />
              </div>
              <div>
                <label className="label">State / County *</label>
                <input className="input" value={basics.address.state} onChange={(e) => setBasics({ ...basics, address: { ...basics.address, state: e.target.value } })} />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Structure ── */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Building Structure</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasWings}
                onChange={(e) => { setHasWings(e.target.checked); if (e.target.checked && wings.length === 0) addWing() }}
              />
              <span>This property has multiple wings / blocks</span>
            </label>
            {hasWings && (
              <div className="space-y-3">
                {wings.map((w, i) => (
                  <div key={i} className="p-3 border rounded grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Wing Name</label>
                      <input className="input" value={w.name} onChange={(e) => updateWing(i, 'name', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">From Floor</label>
                      <input type="number" className="input" value={w.floors_start} onChange={(e) => updateWing(i, 'floors_start', +e.target.value)} />
                    </div>
                    <div>
                      <label className="label">To Floor</label>
                      <input type="number" className="input" value={w.floors_end} onChange={(e) => updateWing(i, 'floors_end', +e.target.value)} />
                    </div>
                  </div>
                ))}
                <button onClick={addWing} className="text-blue-600 text-sm font-medium">+ Add Wing</button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Unit Templates ── */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Unit Templates</h2>
            <p className="text-sm text-gray-500">Define how units are generated. Each template produces a batch of units.</p>
            {templates.map((t, i) => (
              <div key={i} className="p-4 border rounded space-y-3">
                <div className="flex justify-between">
                  <input
                    className="input font-medium w-48"
                    value={t.template_name}
                    onChange={(e) => updateTemplate(i, { template_name: e.target.value })}
                    placeholder="Template name"
                  />
                  {templates.length > 1 && (
                    <button onClick={() => setTemplates((prev) => prev.filter((_, idx) => idx !== i))} className="text-red-500 text-sm">Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">From Floor</label>
                    <input type="number" className="input" value={t.floors_start} min={0} onChange={(e) => updateTemplate(i, { floors_start: +e.target.value })} />
                  </div>
                  <div>
                    <label className="label">To Floor</label>
                    <input type="number" className="input" value={t.floors_end} min={0} onChange={(e) => updateTemplate(i, { floors_end: +e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Units / Floor</label>
                    <input type="number" className="input" value={t.units_per_floor ?? ''} min={1} onChange={(e) => updateTemplate(i, { units_per_floor: +e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Unit Type</label>
                    <select className="input" value={t.unit_type} onChange={(e) => updateTemplate(i, { unit_type: e.target.value })}>
                      <option value="standard">Standard</option>
                      <option value="studio">Studio</option>
                      <option value="1br">1 Bedroom</option>
                      <option value="2br">2 Bedroom</option>
                      <option value="3br">3 Bedroom</option>
                      <option value="penthouse">Penthouse</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Base Rent (KES)</label>
                    <input type="number" className="input" value={t.rent_base ?? ''} onChange={(e) => updateTemplate(i, { rent_base: +e.target.value || undefined })} />
                  </div>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={t.furnished} onChange={(e) => updateTemplate(i, { furnished: e.target.checked })} />
                    Furnished
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={t.is_premium} onChange={(e) => updateTemplate(i, { is_premium: e.target.checked })} />
                    Premium
                  </label>
                </div>
              </div>
            ))}
            <button onClick={addTemplate} className="text-blue-600 text-sm font-medium">+ Add Template</button>
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
              <strong>{totalUnits}</strong> units will be generated
              {totalUnits > 200 && <span className="ml-2 text-orange-600">(async — will run in background)</span>}
            </div>
          </div>
        )}

        {/* ── Step 3: Utilities ── */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Utility Defaults</h2>
            <p className="text-sm text-gray-500">Enable and configure utilities. Metered utilities support tiered pricing.</p>
            <UtilityConfigCard label="Electricity" utilityKey="electricity" value={utilities.electricity} onChange={(v) => setUtility('electricity', v)} accounts={orgAccounts} />
            <UtilityConfigCard label="Water" utilityKey="water" value={utilities.water} onChange={(v) => setUtility('water', v)} accounts={orgAccounts} />
            <UtilityConfigCard label="Gas" utilityKey="gas" value={utilities.gas} onChange={(v) => setUtility('gas', v)} accounts={orgAccounts} />
            <UtilityConfigCard label="Internet" utilityKey="internet" value={utilities.internet} onChange={(v) => setUtility('internet', v)} accounts={orgAccounts} />
            <UtilityConfigCard label="Garbage Collection" utilityKey="garbage" value={utilities.garbage} onChange={(v) => setUtility('garbage', v)} accounts={orgAccounts} />
            <UtilityConfigCard label="Security Fee" utilityKey="security" value={utilities.security} onChange={(v) => setUtility('security', v)} accounts={orgAccounts} />

            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Custom Utilities</p>
              {customUtilities.map((cu, i) => (
                <CustomUtilityCard
                  key={i}
                  value={cu}
                  onChange={(v) => setCustomUtilities((prev) => prev.map((x, idx) => idx === i ? v : x))}
                  onRemove={() => setCustomUtilities((prev) => prev.filter((_, idx) => idx !== i))}
                  accounts={orgAccounts}
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

        {/* ── Step 4: Deposit ── */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Deposit Configuration</h2>
            <div>
              <label className="label">Deposit Rule</label>
              <select
                className="input"
                value={pricing.deposit_rule}
                onChange={(e) => setPricing({ ...pricing, deposit_rule: e.target.value as PricingDefaults['deposit_rule'] })}
              >
                <option value="1x_rent">1× Rent</option>
                <option value="2x_rent">2× Rent</option>
                <option value="3x_rent">3× Rent</option>
                <option value="custom">Custom Amount</option>
              </select>
            </div>
            {pricing.deposit_rule === 'custom' && (
              <div>
                <label className="label">Deposit Amount (KES)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={pricing.deposit_amount ?? ''}
                  onChange={(e) => setPricing({ ...pricing, deposit_amount: e.target.value ? parseFloat(e.target.value) : undefined })}
                />
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pricing.deposit_refundable}
                onChange={(e) => setPricing({ ...pricing, deposit_refundable: e.target.checked })}
              />
              <span className="text-sm">Deposit is refundable</span>
            </label>
            {pricing.deposit_refundable && (
              <>
                <div>
                  <label className="label">Refund Policy</label>
                  <select
                    className="input"
                    value={pricing.deposit_refund_policy}
                    onChange={(e) => setPricing({ ...pricing, deposit_refund_policy: e.target.value as PricingDefaults['deposit_refund_policy'] })}
                  >
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
                    value={pricing.deposit_refund_days}
                    onChange={(e) => setPricing({ ...pricing, deposit_refund_days: +e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 5: Lease Terms ── */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Lease Term Defaults</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Default Duration (months)</label>
                <input
                  type="number" className="input" min={1}
                  value={leaseDefaults.default_duration_months}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, default_duration_months: +e.target.value })}
                />
              </div>
              <div>
                <label className="label">Minimum Duration (months)</label>
                <input
                  type="number" className="input" min={1}
                  value={leaseDefaults.min_duration_months}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, min_duration_months: +e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notice Period (days)</label>
                <input
                  type="number" className="input" min={0}
                  value={leaseDefaults.notice_days}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, notice_days: +e.target.value })}
                />
              </div>
              <div>
                <label className="label">Termination Fee Type</label>
                <select
                  className="input"
                  value={leaseDefaults.termination_fee_type}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, termination_fee_type: e.target.value as LeaseDefaults['termination_fee_type'] })}
                >
                  <option value="none">None</option>
                  <option value="flat">Flat Amount (KES)</option>
                  <option value="months_rent">Months of Rent</option>
                </select>
              </div>
              {leaseDefaults.termination_fee_type !== 'none' && (
                <div>
                  <label className="label">
                    {leaseDefaults.termination_fee_type === 'flat' ? 'Fee Amount (KES)' : 'Number of Months'}
                  </label>
                  <input
                    type="number" className="input" min={0}
                    value={leaseDefaults.termination_fee_value ?? ''}
                    onChange={(e) => setLeaseDefaults({ ...leaseDefaults, termination_fee_value: e.target.value ? +e.target.value : undefined })}
                  />
                </div>
              )}
              <div>
                <label className="label">Annual Rent Escalation (%)</label>
                <input
                  type="number" className="input" min={0} step={0.1}
                  value={leaseDefaults.rent_escalation_pct}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, rent_escalation_pct: +e.target.value })}
                />
              </div>
              <div>
                <label className="label">Escalation Review (months)</label>
                <input
                  type="number" className="input" min={1}
                  value={leaseDefaults.escalation_review_months}
                  onChange={(e) => setLeaseDefaults({ ...leaseDefaults, escalation_review_months: +e.target.value })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={leaseDefaults.auto_renewal}
                onChange={(e) => setLeaseDefaults({ ...leaseDefaults, auto_renewal: e.target.checked })}
              />
              <span className="text-sm">Auto-renew lease on expiry</span>
            </label>
          </div>
        )}

        {/* ── Step 6: Policies ── */}
        {step === 6 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold">Unit Policies</h2>

            <div>
              <label className="label">Pet Policy</label>
              <select
                className="input"
                value={unitPolicies.pet_policy}
                onChange={(e) => setUnitPolicies({ ...unitPolicies, pet_policy: e.target.value as UnitPolicyDefaults['pet_policy'] })}
              >
                <option value="not_allowed">Not Allowed</option>
                <option value="allowed">Allowed</option>
                <option value="allowed_with_deposit">Allowed with Deposit</option>
              </select>
            </div>
            {unitPolicies.pet_policy === 'allowed_with_deposit' && (
              <div>
                <label className="label">Pet Deposit (KES)</label>
                <input
                  type="number" className="input" min={0}
                  value={unitPolicies.pet_deposit ?? ''}
                  onChange={(e) => setUnitPolicies({ ...unitPolicies, pet_deposit: e.target.value ? +e.target.value : undefined })}
                />
              </div>
            )}

            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={unitPolicies.smoking_allowed}
                  onChange={(e) => setUnitPolicies({ ...unitPolicies, smoking_allowed: e.target.checked })}
                />
                Smoking Allowed
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={unitPolicies.parking_available}
                  onChange={(e) => setUnitPolicies({ ...unitPolicies, parking_available: e.target.checked })}
                />
                Parking Available
              </label>
            </div>

            {unitPolicies.parking_available && (
              <div>
                <label className="label">Parking Fee (KES/month)</label>
                <input
                  type="number" className="input" min={0}
                  value={unitPolicies.parking_fee ?? ''}
                  onChange={(e) => setUnitPolicies({ ...unitPolicies, parking_fee: e.target.value ? +e.target.value : undefined })}
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
                      checked={unitPolicies.amenities.includes(a.id)}
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
                placeholder="e.g. Guests allowed up to 7 days per month. Prior approval required for stays exceeding 3 days."
                value={unitPolicies.guest_policy ?? ''}
                onChange={(e) => setUnitPolicies({ ...unitPolicies, guest_policy: e.target.value || undefined })}
              />
            </div>
          </div>
        )}

        {/* ── Step 7: Billing ── */}
        {step === 7 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Billing Settings</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Invoice Day (1–28)</label>
                <input type="number" className="input" value={billing.invoice_day} min={1} max={28} onChange={(e) => setBilling({ ...billing, invoice_day: +e.target.value })} />
              </div>
              <div>
                <label className="label">Due Days After Invoice</label>
                <input type="number" className="input" value={billing.due_days} min={1} onChange={(e) => setBilling({ ...billing, due_days: +e.target.value })} />
              </div>
              <div>
                <label className="label">Grace Days</label>
                <input type="number" className="input" value={billing.grace_days} min={0} onChange={(e) => setBilling({ ...billing, grace_days: +e.target.value })} />
              </div>
              <div>
                <label className="label">Late Fee Type</label>
                <select className="input" value={billing.late_fee_type} onChange={(e) => setBilling({ ...billing, late_fee_type: e.target.value as BillingSettings['late_fee_type'] })}>
                  <option value="flat">Flat Amount</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div>
                <label className="label">Late Fee Value {billing.late_fee_type === 'flat' ? '(KES)' : '(%)'}</label>
                <input type="number" className="input" value={billing.late_fee_value} min={0} onChange={(e) => setBilling({ ...billing, late_fee_value: +e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 8: Review ── */}
        {step === 8 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Review & Create</h2>
            <dl className="divide-y border rounded">
              {[
                ['Name', basics.name],
                ['Type', basics.property_type],
                ['Region', basics.region],
                ['Address', `${basics.address.street}, ${basics.address.city}`],
                ['Wings', hasWings ? wings.map((w) => w.name).join(', ') : 'None (single block)'],
                ['Templates', templates.length.toString()],
                ['Total Units', totalUnits.toString()],
                ['Utilities', [...Object.entries(utilities).filter(([, v]) => v).map(([k]) => k), ...customUtilities.map(c => c.label || c.key)].join(', ') || 'None'],
                ['Deposit Rule', pricing.deposit_rule],
                ['Deposit Refundable', pricing.deposit_refundable ? 'Yes' : 'No'],
                ...(pricing.deposit_refundable ? [
                  ['Refund Policy', pricing.deposit_refund_policy.replace(/_/g, ' ')],
                  ['Refund Days', `${pricing.deposit_refund_days} days`],
                ] : []),
                ['Lease Duration', `${leaseDefaults.default_duration_months} months (min ${leaseDefaults.min_duration_months})`],
                ['Notice Period', `${leaseDefaults.notice_days} days`],
                ['Auto-Renewal', leaseDefaults.auto_renewal ? 'Yes' : 'No'],
                ['Rent Escalation', leaseDefaults.rent_escalation_pct > 0 ? `${leaseDefaults.rent_escalation_pct}% / ${leaseDefaults.escalation_review_months} months` : 'None'],
                ['Pet Policy', unitPolicies.pet_policy.replace(/_/g, ' ')],
                ['Smoking', unitPolicies.smoking_allowed ? 'Allowed' : 'Not allowed'],
                ['Parking', unitPolicies.parking_available ? `Available${unitPolicies.parking_fee ? ` (KES ${unitPolicies.parking_fee}/mo)` : ''}` : 'Not available'],
                ['Amenities', unitPolicies.amenities.length > 0 ? unitPolicies.amenities.map((id) => AMENITY_OPTIONS.find((a) => a.id === id)?.label ?? id).join(', ') : 'None'],
                ['Invoice Day', `Day ${billing.invoice_day} of month`],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-3 flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-right max-w-[55%]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
            disabled={step === 0}
            className="px-4 py-2 border rounded text-sm disabled:opacity-30"
          >
            Back
          </button>

          {step < 8 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="px-6 py-2 bg-blue-600 text-white rounded text-sm font-medium"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2 bg-green-600 text-white rounded text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Property'}
            </button>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
