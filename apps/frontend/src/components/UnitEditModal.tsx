import { useCallback, useEffect, useState } from 'react'
import { unitsApi } from '@/api/units'
import { meterReadingsApi } from '@/api/meterReadings'
import { extractApiError } from '@/utils/apiError'
import { TierEditor, MeterReadingWidget } from '@/components/UtilityConfigSection'
import type { Unit, UtilityOverride, UtilityOverrideDetail, PricingTier, MeterReadingCacheEntry } from '@/types/unit'
import type { UtilityDefaults } from '@/types/property'
import type { AccountEntry } from '@/types/org'
import type { MeterReading } from '@/types/meter_reading'

type Tab = 'pricing' | 'utilities' | 'meters' | 'details'

const NAMED_KEYS = ['electricity', 'water', 'gas', 'internet', 'garbage', 'security'] as const

interface Props {
  unit: Unit
  propertyUtilityDefaults: UtilityDefaults
  accounts?: AccountEntry[]
  onClose: () => void
  onSaved: (u: Unit) => void
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function UtilityOverrideSection({
  label,
  utilityKey,
  propertyDefault,
  value,
  onChange,
  accounts = [],
  propertyId,
  unitId,
  cachedReading,
}: {
  label: string
  utilityKey: string
  propertyDefault: UtilityDefaults['electricity']
  value: UtilityOverrideDetail | undefined
  onChange: (v: UtilityOverrideDetail | undefined) => void
  accounts?: AccountEntry[]
  propertyId?: string
  unitId?: string
  cachedReading?: MeterReadingCacheEntry
}) {
  const overridden = value !== undefined
  const inheritLabel = propertyDefault
    ? `${propertyDefault.type}${propertyDefault.rate ? `, rate ${propertyDefault.rate}` : ''}${propertyDefault.unit ? ` ${propertyDefault.unit}` : ''}${propertyDefault.income_account ? ` · ${propertyDefault.income_account}` : ''}`
    : 'Not configured'

  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overridden}
            onChange={(e) => {
                if (e.target.checked) {
                  onChange({
                    type: propertyDefault?.type ?? 'metered',
                    rate: propertyDefault?.rate,
                    unit: propertyDefault?.unit,
                    label: propertyDefault?.label,
                    income_account: propertyDefault?.income_account,
                    tiers: propertyDefault?.tiers,
                    deposit: propertyDefault?.deposit,
                  })
                } else {
                  onChange(undefined)
                }
              }}
            className="rounded"
          />
          <span className="text-xs text-gray-500">Override</span>
        </label>
      </div>
      {!overridden && <p className="text-xs text-gray-400">Inherits: {inheritLabel}</p>}
      {overridden && (
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={value!.type}
              onChange={(e) => {
                const t = e.target.value as UtilityOverrideDetail['type']
                onChange({
                  ...value!,
                  type: t,
                  tiers: t === 'metered' ? (value!.tiers ?? []) : undefined,
                })
              }}
            >
              <option value="shared">Shared</option>
              <option value="metered">Metered</option>
              <option value="subscription">Subscription</option>
            </select>
          </div>
          <div>
            <label className="label">{value!.type === 'metered' ? 'Flat rate (fallback)' : 'Rate / Amount'}</label>
            <input
              className="input"
              type="number"
              placeholder="0.00"
              value={value!.rate ?? ''}
              onChange={(e) => onChange({ ...value!, rate: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
          <div>
            <label className="label">Unit / Label</label>
            <input
              className="input"
              placeholder="KWh, m³, KES/mo"
              value={value!.unit ?? ''}
              onChange={(e) => onChange({ ...value!, unit: e.target.value || undefined })}
            />
          </div>
          <div>
            <label className="label">Display Name</label>
            <input
              className="input"
              placeholder="e.g. Water"
              value={value!.label ?? ''}
              onChange={(e) => onChange({ ...value!, label: e.target.value || undefined })}
            />
          </div>
          {accounts.length > 0 && (
            <div>
              <label className="label">Income Account</label>
              <select
                className="input"
                value={value!.income_account ?? ''}
                onChange={(e) => onChange({ ...value!, income_account: e.target.value || undefined })}
              >
                <option value="">— Inherit from property —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Deposit (KES)</label>
            <input
              className="input"
              type="number"
              placeholder="0.00"
              min={0}
              step={0.01}
              value={value!.deposit ?? ''}
              onChange={(e) => onChange({ ...value!, deposit: e.target.value ? parseFloat(e.target.value) : undefined })}
            />
          </div>
        </div>
      )}
      {overridden && value!.type === 'metered' && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-600">Tiered Pricing</span>
            <span className="text-xs text-gray-400">(leave empty to use flat rate)</span>
          </div>
          <TierEditor
            tiers={value!.tiers ?? []}
            onChange={(tiers: PricingTier[]) =>
              onChange({ ...value!, tiers: tiers.length ? tiers : undefined })
            }
          />
        </div>
      )}
      {overridden && value!.type === 'metered' && propertyId && unitId && (
        <MeterReadingWidget
          propertyId={propertyId}
          unitId={unitId}
          utilityKey={utilityKey}
          unitStr={value!.unit}
          cachedReading={cachedReading}
        />
      )}
    </div>
  )
}

// ── Meters tab ────────────────────────────────────────────────────────────────

function MetersTab({ unit, propertyUtilityDefaults }: { unit: Unit; propertyUtilityDefaults: UtilityDefaults }) {
  // Compute all metered utilities visible for this unit
  const meteredUtilities: Array<{ key: string; label: string; unitStr: string }> = []

  for (const k of NAMED_KEYS) {
    const override = (unit.utility_overrides as unknown as Record<string, UtilityOverrideDetail | undefined> | undefined)?.[k]
    const propDefault = (propertyUtilityDefaults as unknown as Record<string, typeof propertyUtilityDefaults.electricity>)[k]
    const effective = override ?? propDefault
    if (effective?.type === 'metered') {
      meteredUtilities.push({
        key: k,
        label: effective.label ?? k.charAt(0).toUpperCase() + k.slice(1),
        unitStr: effective.unit ?? '',
      })
    }
  }
  for (const cu of propertyUtilityDefaults.custom ?? []) {
    if (cu.type === 'metered') {
      meteredUtilities.push({
        key: cu.key,
        label: cu.label ?? cu.key,
        unitStr: cu.unit ?? '',
      })
    }
  }

  const [selectedKey, setSelectedKey] = useState(meteredUtilities[0]?.key ?? '')
  const [currentReading, setCurrentReading] = useState('')
  const [readingValidationError, setReadingValidationError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [recordSuccess, setRecordSuccess] = useState(false)
  const [history, setHistory] = useState<MeterReading[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadHistory = useCallback(async (key: string) => {
    if (!key) return
    setLoadingHistory(true)
    try {
      const res = await meterReadingsApi.list(unit.property_id, {
        unit_id: unit.id,
        utility_key: key,
        page_size: 6,
      })
      setHistory(res.items)
    } catch {
      // non-critical
    } finally {
      setLoadingHistory(false)
    }
  }, [unit.id, unit.property_id])

  useEffect(() => {
    if (selectedKey) loadHistory(selectedKey)
  }, [selectedKey, loadHistory])

  async function handleRecord() {
    if (!currentReading || !selectedKey) return
    setRecording(true)
    setRecordError(null)
    setRecordSuccess(false)
    try {
      await meterReadingsApi.record(unit.property_id, {
        unit_id: unit.id,
        utility_key: selectedKey,
        current_reading: parseFloat(currentReading),
        notes: notes || undefined,
        source: 'manual',
      })
      setRecordSuccess(true)
      setCurrentReading('')
      setNotes('')
      loadHistory(selectedKey)
    } catch (err) {
      setRecordError(extractApiError(err).message)
    } finally {
      setRecording(false)
    }
  }

  if (meteredUtilities.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12 text-sm">
        No metered utilities configured for this unit.
        <br />
        Enable metered utilities on the property or override them above.
      </div>
    )
  }

  const selected = meteredUtilities.find((u) => u.key === selectedKey)
  const latestReading = history[0]
  const cachedEntry = unit.meter_reading_cache?.[selectedKey]
  // For validation: prefer live history value, fall back to cache
  const prevValue = latestReading?.current_reading ?? cachedEntry?.value

  return (
    <div className="space-y-5">
      {/* Utility selector */}
      {meteredUtilities.length > 1 && (
        <div>
          <label className="label">Utility</label>
          <select
            className="input"
            value={selectedKey}
            onChange={(e) => { setSelectedKey(e.target.value); setRecordSuccess(false) }}
          >
            {meteredUtilities.map((u) => (
              <option key={u.key} value={u.key}>{u.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Previous reading info — show cache immediately, replace with history once loaded */}
      {(latestReading || (loadingHistory && cachedEntry) || cachedEntry) && (
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Previous reading:</span>
            <span className="font-semibold">
              {latestReading ? latestReading.current_reading : cachedEntry!.value} {selected?.unitStr}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5 text-xs text-gray-400">
            <span>
              {new Date(latestReading ? latestReading.read_at : cachedEntry!.read_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span>by {latestReading ? (latestReading.read_by_name || 'Unknown') : (cachedEntry!.read_by_name || 'Unknown')}</span>
          </div>
        </div>
      )}

      {/* Record form */}
      <div className="space-y-3">
        <div>
          <label className="label">Current Reading {selected?.unitStr ? `(${selected.unitStr})` : ''}</label>
          <input
            type="number"
            placeholder="0.00"
            min={0}
            step={0.01}
            value={currentReading}
            onChange={(e) => {
              const raw = e.target.value
              setCurrentReading(raw)
              setRecordSuccess(false)
              if (raw && prevValue != null && parseFloat(raw) < prevValue) {
                setReadingValidationError(`Must be ≥ previous reading (${prevValue})`)
              } else {
                setReadingValidationError(null)
              }
            }}
            className={`input ${readingValidationError ? 'border-red-400 bg-red-50' : ''}`}
          />
          {readingValidationError && (
            <p className="text-xs text-red-600 mt-1">{readingValidationError}</p>
          )}
          {!readingValidationError && prevValue != null && currentReading && parseFloat(currentReading) > prevValue && (
            <p className="text-xs text-blue-600 mt-1">
              Consumption: {(parseFloat(currentReading) - prevValue).toFixed(2)} {selected?.unitStr}
            </p>
          )}
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <input
            className="input"
            placeholder="e.g. Estimated due to IoT downtime"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {recordError && <p className="text-sm text-red-600">{recordError}</p>}
        {recordSuccess && <p className="text-sm text-green-600">Reading recorded successfully.</p>}
        <button
          onClick={handleRecord}
          disabled={recording || !currentReading || !!readingValidationError}
          className="btn-primary w-full disabled:opacity-50"
        >
          {recording ? 'Recording…' : 'Record Reading'}
        </button>
      </div>

      {/* History */}
      {loadingHistory ? (
        <p className="text-xs text-gray-400">Loading history…</p>
      ) : history.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Readings</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b">
                <th className="text-left pb-1">Date</th>
                <th className="text-right pb-1">Reading</th>
                <th className="text-right pb-1">Consumed</th>
                <th className="text-left pb-1 pl-3">Recorded by</th>
                <th className="text-left pb-1 pl-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {history.map((r) => (
                <tr key={r.id} className="py-1">
                  <td className="py-1.5 text-gray-600">
                    {new Date(r.read_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="py-1.5 text-right font-medium font-mono">{r.current_reading}</td>
                  <td className="py-1.5 text-right text-gray-500">
                    {r.units_consumed != null ? r.units_consumed.toFixed(2) : '—'}
                  </td>
                  <td className="py-1.5 pl-3 text-gray-600 text-xs truncate max-w-[90px]">
                    {r.read_by_name || 'Unknown'}
                  </td>
                  <td className="py-1.5 pl-2 text-gray-400 text-xs truncate max-w-[80px]">{r.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function UnitEditModal({ unit, propertyUtilityDefaults, accounts = [], onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('pricing')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pricing
  const [rentBase, setRentBase] = useState<number | ''>(unit.rent_base ?? '')
  const [depositRule, setDepositRule] = useState(unit.deposit_rule ?? '1x_rent')
  const [depositAmount, setDepositAmount] = useState<number | ''>(unit.deposit_amount ?? '')
  const [utilityDeposit, setUtilityDeposit] = useState<number | ''>(unit.utility_deposit ?? '')

  // Utilities — normalize null (MongoDB) to undefined
  const [electricity, setElectricity] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.electricity ?? undefined)
  const [water, setWater] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.water ?? undefined)
  const [gas, setGas] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.gas ?? undefined)
  const [internet, setInternet] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.internet ?? undefined)
  const [garbage, setGarbage] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.garbage ?? undefined)
  const [security, setSecurity] = useState<UtilityOverrideDetail | undefined>(unit.utility_overrides?.security ?? undefined)

  // Details
  const [unitType, setUnitType] = useState(unit.unit_type)
  const [size, setSize] = useState<number | ''>(unit.size ?? '')
  const [furnished, setFurnished] = useState(unit.furnished)
  const [isPremium, setIsPremium] = useState(unit.is_premium)
  const [meterId, setMeterId] = useState(unit.meter_id ?? '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const utilityOverrides: UtilityOverride = {}
      if (electricity) utilityOverrides.electricity = electricity
      if (water) utilityOverrides.water = water
      if (gas) utilityOverrides.gas = gas
      if (internet) utilityOverrides.internet = internet
      if (garbage) utilityOverrides.garbage = garbage
      if (security) utilityOverrides.security = security

      const updated = await unitsApi.update(unit.id, {
        rent_base: rentBase !== '' ? rentBase : undefined,
        deposit_rule: depositRule,
        deposit_amount: depositRule === 'custom' && depositAmount !== '' ? depositAmount : undefined,
        utility_deposit: utilityDeposit !== '' ? utilityDeposit : undefined,
        unit_type: unitType,
        size: size !== '' ? size : undefined,
        furnished,
        is_premium: isPremium,
        utility_overrides: Object.keys(utilityOverrides).length > 0 ? utilityOverrides : undefined,
        meter_id: meterId || undefined,
      })
      onSaved(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[560px] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Edit Unit {unit.unit_code}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          <TabBtn active={tab === 'pricing'} onClick={() => setTab('pricing')}>Pricing</TabBtn>
          <TabBtn active={tab === 'utilities'} onClick={() => setTab('utilities')}>Utilities</TabBtn>
          <TabBtn active={tab === 'meters'} onClick={() => setTab('meters')}>Meters</TabBtn>
          <TabBtn active={tab === 'details'} onClick={() => setTab('details')}>Details</TabBtn>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'pricing' && (
            <div className="space-y-4">
              <div>
                <label className="label">Rent Base (KES)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={rentBase}
                  onChange={(e) => setRentBase(e.target.value ? parseFloat(e.target.value) : '')}
                />
              </div>
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
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value ? parseFloat(e.target.value) : '')}
                  />
                </div>
              )}
              <div className="pt-3 border-t border-gray-100">
                <label className="label">Security Deposit Required (KES)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Optional — one-time refundable deposit"
                  value={utilityDeposit}
                  onChange={(e) => setUtilityDeposit(e.target.value ? parseFloat(e.target.value) : '')}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Collected on move-in. Posted to the utility deposit income account configured on the property.
                </p>
              </div>
            </div>
          )}

          {tab === 'utilities' && (
            <div>
              <UtilityOverrideSection label="Electricity" utilityKey="electricity" propertyDefault={propertyUtilityDefaults.electricity} value={electricity} onChange={setElectricity} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.electricity} />
              <UtilityOverrideSection label="Water" utilityKey="water" propertyDefault={propertyUtilityDefaults.water} value={water} onChange={setWater} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.water} />
              <UtilityOverrideSection label="Gas" utilityKey="gas" propertyDefault={propertyUtilityDefaults.gas} value={gas} onChange={setGas} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.gas} />
              <UtilityOverrideSection label="Internet" utilityKey="internet" propertyDefault={propertyUtilityDefaults.internet} value={internet} onChange={setInternet} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.internet} />
              <UtilityOverrideSection label="Garbage Collection" utilityKey="garbage" propertyDefault={propertyUtilityDefaults.garbage} value={garbage} onChange={setGarbage} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.garbage} />
              <UtilityOverrideSection label="Security Fee" utilityKey="security" propertyDefault={propertyUtilityDefaults.security} value={security} onChange={setSecurity} accounts={accounts} propertyId={unit.property_id} unitId={unit.id} cachedReading={unit.meter_reading_cache?.security} />
              {(propertyUtilityDefaults.custom ?? []).length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Custom utilities ({(propertyUtilityDefaults.custom ?? []).map(c => c.label ?? c.key).join(', ')}) inherit property defaults and cannot be overridden per-unit.
                </p>
              )}
            </div>
          )}

          {tab === 'meters' && (
            <MetersTab unit={unit} propertyUtilityDefaults={propertyUtilityDefaults} />
          )}

          {tab === 'details' && (
            <div className="space-y-4">
              <div>
                <label className="label">Unit Type</label>
                <input className="input" value={unitType} onChange={(e) => setUnitType(e.target.value)} />
              </div>
              <div>
                <label className="label">Size (m²)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={size}
                  onChange={(e) => setSize(e.target.value ? parseFloat(e.target.value) : '')}
                />
              </div>
              <div>
                <label className="label">Meter ID</label>
                <input className="input" value={meterId} onChange={(e) => setMeterId(e.target.value)} />
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={furnished} onChange={(e) => setFurnished(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700">Furnished</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isPremium} onChange={(e) => setIsPremium(e.target.checked)} className="rounded" />
                  <span className="text-sm text-gray-700">Premium</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer — hidden on Meters tab (no bulk save for readings) */}
        {tab !== 'meters' && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            {error && <p className="text-sm text-red-600 flex-1">{error}</p>}
            <div className="flex gap-3 ml-auto">
              <button onClick={onClose} className="btn-outline">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {tab === 'meters' && (
          <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="btn-outline">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
