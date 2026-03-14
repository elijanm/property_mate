/**
 * Reusable utility configuration card.
 * Handles shared / metered / subscription types, tiered pricing, enable toggle,
 * income account mapping, and inline meter reading recording with audit history.
 */
import { useCallback, useEffect, useState } from 'react'
import { meterReadingsApi } from '@/api/meterReadings'
import { extractApiError } from '@/utils/apiError'
import type { AccountEntry } from '@/types/org'
import type { CustomUtilityDetail, PricingTier, UtilityDetail } from '@/types/property'
import type { MeterReading } from '@/types/meter_reading'
import type { MeterReadingCacheEntry } from '@/types/unit'

// ── Tier editor ───────────────────────────────────────────────────────────────

function TierRow({
  tier,
  onChange,
  onRemove,
}: {
  tier: PricingTier
  onChange: (t: PricingTier) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="input w-24 text-sm"
        placeholder="From"
        value={tier.from_units}
        min={0}
        step={0.01}
        onChange={(e) => onChange({ ...tier, from_units: parseFloat(e.target.value) || 0 })}
      />
      <span className="text-gray-400 text-xs">–</span>
      <input
        type="number"
        className="input w-24 text-sm"
        placeholder="To (∞)"
        value={tier.to_units ?? ''}
        min={0}
        step={0.01}
        onChange={(e) =>
          onChange({ ...tier, to_units: e.target.value ? parseFloat(e.target.value) : undefined })
        }
      />
      <input
        type="number"
        className="input w-28 text-sm"
        placeholder="Rate"
        value={tier.rate}
        min={0}
        step={0.01}
        onChange={(e) => onChange({ ...tier, rate: parseFloat(e.target.value) || 0 })}
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-red-400 hover:text-red-600 text-sm px-1"
        title="Remove tier"
      >
        ×
      </button>
    </div>
  )
}

export function TierEditor({
  tiers,
  onChange,
}: {
  tiers: PricingTier[]
  onChange: (tiers: PricingTier[]) => void
}) {
  function addTier() {
    const last = tiers[tiers.length - 1]
    onChange([
      ...tiers,
      {
        from_units: last?.to_units ?? 0,
        to_units: undefined,
        rate: last?.rate ?? 0,
      },
    ])
  }

  function updateTier(i: number, t: PricingTier) {
    onChange(tiers.map((x, idx) => (idx === i ? t : x)))
  }

  function removeTier(i: number) {
    onChange(tiers.filter((_, idx) => idx !== i))
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
        <span className="w-24">From units</span>
        <span className="w-4" />
        <span className="w-24">To units</span>
        <span className="w-28">Rate (KES/unit)</span>
      </div>
      {tiers.map((t, i) => (
        <TierRow
          key={i}
          tier={t}
          onChange={(u) => updateTier(i, u)}
          onRemove={() => removeTier(i)}
        />
      ))}
      <button
        type="button"
        onClick={addTier}
        className="text-blue-600 text-xs font-medium hover:underline"
      >
        + Add tier
      </button>
    </div>
  )
}

// ── Income account select ─────────────────────────────────────────────────────

function IncomeAccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountEntry[]
  value: string | undefined
  onChange: (code: string | undefined) => void
}) {
  if (accounts.length === 0) return null
  return (
    <div>
      <label className="label">Income Account</label>
      <select
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">— Org default —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.code}>
            {a.code} · {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Meter Reading Widget ──────────────────────────────────────────────────────

/**
 * Inline meter reading recorder + audit log.
 * Used in both property-level (no unitId) and unit-level (unitId provided) utility cards.
 */
export function MeterReadingWidget({
  propertyId,
  unitId,
  utilityKey,
  unitStr,
  cachedReading,
}: {
  propertyId: string
  unitId?: string
  utilityKey: string
  unitStr?: string
  cachedReading?: MeterReadingCacheEntry   // pre-loaded from unit.meter_reading_cache
}) {
  const [history, setHistory] = useState<MeterReading[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [currentReading, setCurrentReading] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Use API history as primary source; fall back to cache for instant display before fetch
  const latest = history[0]
  const prevValue = latest?.current_reading ?? cachedReading?.value

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await meterReadingsApi.list(propertyId, {
        unit_id: unitId,
        utility_key: utilityKey,
        page_size: 5,
      })
      setHistory(res.items)
    } catch {
      // non-critical
    } finally {
      setLoading(false)
    }
  }, [propertyId, unitId, utilityKey])

  useEffect(() => { load() }, [load])

  function handleReadingChange(raw: string) {
    setCurrentReading(raw)
    setSaveError(null)
    if (raw === '') { setValidationError(null); return }
    const val = parseFloat(raw)
    if (prevValue !== undefined && val < prevValue) {
      setValidationError(`Must be ≥ previous reading (${prevValue})`)
    } else {
      setValidationError(null)
    }
  }

  async function handleSave() {
    if (!currentReading || validationError) return
    setSaving(true)
    setSaveError(null)
    try {
      await meterReadingsApi.record(propertyId, {
        unit_id: unitId,
        utility_key: utilityKey,
        current_reading: parseFloat(currentReading),
        notes: notes || undefined,
        source: 'manual',
      })
      setCurrentReading('')
      setNotes('')
      setShowForm(false)
      await load()
    } catch (err) {
      setSaveError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Meter Readings
        </span>
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); setSaveError(null) }}
          className="text-xs text-blue-600 hover:underline font-medium"
        >
          {showForm ? 'Cancel' : '+ Record Reading'}
        </button>
      </div>

      {/* Last reading summary */}
      {loading && !cachedReading && !latest ? (
        <p className="text-[11px] text-gray-400">Loading…</p>
      ) : latest ? (
        <div className="bg-gray-50 rounded-md px-3 py-2 text-xs mb-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Last reading</span>
            <span className="font-semibold text-gray-800">
              {latest.current_reading} {unitStr}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-gray-400">{fmtDate(latest.read_at)}</span>
            <span className="text-gray-400">by {latest.read_by_name || 'Unknown'}</span>
          </div>
          {latest.units_consumed != null && (
            <p className="text-gray-400 mt-0.5">
              Consumed: {latest.units_consumed.toFixed(2)} {unitStr}
            </p>
          )}
        </div>
      ) : cachedReading ? (
        /* Show cached value instantly while API fetch is in flight */
        <div className="bg-gray-50 rounded-md px-3 py-2 text-xs mb-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Last reading</span>
            <span className="font-semibold text-gray-800">
              {cachedReading.value} {unitStr}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-gray-400">{fmtDate(cachedReading.read_at)}</span>
            <span className="text-gray-400">by {cachedReading.read_by_name || 'Unknown'}</span>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400 mb-2">No readings recorded yet.</p>
      )}

      {/* Record form */}
      {showForm && (
        <div className="bg-blue-50 rounded-md p-3 space-y-2 mb-2">
          <div>
            <label className="label text-[11px]">
              Current Reading {unitStr ? `(${unitStr})` : ''}
            </label>
            <input
              type="number"
              min={prevValue ?? 0}
              step={0.01}
              placeholder="Enter meter value"
              value={currentReading}
              onChange={(e) => handleReadingChange(e.target.value)}
              className={`input text-sm ${validationError ? 'border-red-400 bg-red-50' : ''}`}
            />
            {validationError && (
              <p className="text-[11px] text-red-600 mt-0.5">{validationError}</p>
            )}
            {currentReading && !validationError && prevValue !== undefined && (
              <p className="text-[11px] text-blue-600 mt-0.5">
                Consumption: {Math.max(0, parseFloat(currentReading) - prevValue).toFixed(2)} {unitStr}
              </p>
            )}
          </div>
          <div>
            <label className="label text-[11px]">Notes (optional)</label>
            <input
              className="input text-sm"
              placeholder="e.g. End-of-month read"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !currentReading || !!validationError}
            className="btn-primary w-full text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Reading'}
          </button>
        </div>
      )}

      {/* Audit history */}
      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
            History
          </p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left pb-1 font-medium">Date</th>
                <th className="text-right pb-1 font-medium">Reading</th>
                <th className="text-right pb-1 font-medium">Consumed</th>
                <th className="text-left pb-1 pl-2 font-medium">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="py-1 text-gray-600">{fmtDate(r.read_at)}</td>
                  <td className="py-1 text-right font-mono text-gray-800">
                    {r.current_reading} {unitStr}
                  </td>
                  <td className="py-1 text-right text-gray-500">
                    {r.units_consumed != null ? r.units_consumed.toFixed(2) : '—'}
                  </td>
                  <td className="py-1 pl-2 text-gray-500 truncate max-w-[100px]">
                    {r.read_by_name || 'Unknown'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Named utility card ────────────────────────────────────────────────────────

export function UtilityConfigCard({
  label,
  utilityKey,
  value,
  onChange,
  accounts = [],
  propertyId,
}: {
  label: string
  utilityKey: string            // canonical key: "electricity" | "water" | "gas" | etc.
  value: UtilityDetail | undefined
  onChange: (v: UtilityDetail | undefined) => void
  accounts?: AccountEntry[]
  propertyId?: string           // when provided, shows MeterReadingWidget for metered utilities
}) {
  const enabled = !!value
  const detail = value ?? { type: 'shared' as const }

  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? { type: 'shared' } : undefined)}
            className="rounded"
          />
          <span className="text-xs text-gray-500">Enabled</span>
        </label>
      </div>

      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={detail.type}
                onChange={(e) => {
                  const t = e.target.value as UtilityDetail['type']
                  onChange({
                    ...detail,
                    type: t,
                    tiers: t === 'metered' ? (detail.tiers ?? []) : undefined,
                    current_reading: t === 'metered' ? detail.current_reading : undefined,
                  })
                }}
              >
                <option value="shared">Shared</option>
                <option value="metered">Metered</option>
                <option value="subscription">Subscription</option>
              </select>
            </div>
            <div>
              <label className="label">
                {detail.type === 'metered' ? 'Flat rate (fallback)' : 'Rate / Amount'}
              </label>
              <input
                className="input"
                type="number"
                placeholder="0.00"
                value={detail.rate ?? ''}
                onChange={(e) =>
                  onChange({ ...detail, rate: e.target.value ? parseFloat(e.target.value) : undefined })
                }
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <input
                className="input"
                placeholder="KWh, m³, KES/mo"
                value={detail.unit ?? ''}
                onChange={(e) => onChange({ ...detail, unit: e.target.value || undefined })}
              />
            </div>
            <div>
              <label className="label">Display Name</label>
              <input
                className="input"
                placeholder="e.g. Water"
                value={detail.label ?? ''}
                onChange={(e) => onChange({ ...detail, label: e.target.value || undefined })}
              />
            </div>
            <IncomeAccountSelect
              accounts={accounts}
              value={detail.income_account}
              onChange={(code) => onChange({ ...detail, income_account: code })}
            />
            <div>
              <label className="label">Deposit (KES)</label>
              <input
                className="input"
                type="number"
                placeholder="0.00"
                min={0}
                step={0.01}
                value={detail.deposit ?? ''}
                onChange={(e) =>
                  onChange({ ...detail, deposit: e.target.value ? parseFloat(e.target.value) : undefined })
                }
              />
            </div>
          </div>

          {detail.type === 'metered' && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-600">Tiered Pricing</span>
                <span className="text-xs text-gray-400">(leave empty to use flat rate above)</span>
              </div>
              <TierEditor
                tiers={detail.tiers ?? []}
                onChange={(tiers) => onChange({ ...detail, tiers: tiers.length ? tiers : undefined })}
              />
            </div>
          )}

          {detail.type === 'metered' && propertyId && (
            <MeterReadingWidget
              propertyId={propertyId}
              utilityKey={utilityKey}
              unitStr={detail.unit}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Custom utility card ───────────────────────────────────────────────────────

export function CustomUtilityCard({
  value,
  onChange,
  onRemove,
  accounts = [],
  propertyId,
}: {
  value: CustomUtilityDetail
  onChange: (v: CustomUtilityDetail) => void
  onRemove: () => void
  accounts?: AccountEntry[]
  propertyId?: string
}) {
  const detail = value

  return (
    <div className="border border-blue-100 bg-blue-50/30 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">Custom Utility</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 text-sm"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="label">Name (display)</label>
          <input
            className="input"
            placeholder="e.g. Gym Membership"
            value={detail.label ?? ''}
            onChange={(e) => onChange({ ...detail, label: e.target.value || undefined })}
          />
        </div>
        <div>
          <label className="label">Key (slug)</label>
          <input
            className="input font-mono text-sm"
            placeholder="gym_membership"
            value={detail.key}
            onChange={(e) =>
              onChange({ ...detail, key: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })
            }
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={detail.type}
            onChange={(e) => {
              const t = e.target.value as UtilityDetail['type']
              onChange({
                ...detail,
                type: t,
                tiers: t === 'metered' ? (detail.tiers ?? []) : undefined,
                current_reading: t === 'metered' ? detail.current_reading : undefined,
              })
            }}
          >
            <option value="shared">Shared</option>
            <option value="metered">Metered</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>
        <div>
          <label className="label">
            {detail.type === 'metered' ? 'Flat rate (fallback)' : 'Rate / Amount'}
          </label>
          <input
            className="input"
            type="number"
            placeholder="0.00"
            value={detail.rate ?? ''}
            onChange={(e) =>
              onChange({ ...detail, rate: e.target.value ? parseFloat(e.target.value) : undefined })
            }
          />
        </div>
        <div>
          <label className="label">Unit</label>
          <input
            className="input"
            placeholder="visits/mo, KES/mo"
            value={detail.unit ?? ''}
            onChange={(e) => onChange({ ...detail, unit: e.target.value || undefined })}
          />
        </div>
        <IncomeAccountSelect
          accounts={accounts}
          value={detail.income_account}
          onChange={(code) => onChange({ ...detail, income_account: code })}
        />
        <div>
          <label className="label">Deposit (KES)</label>
          <input
            className="input"
            type="number"
            placeholder="0.00"
            min={0}
            step={0.01}
            value={detail.deposit ?? ''}
            onChange={(e) =>
              onChange({ ...detail, deposit: e.target.value ? parseFloat(e.target.value) : undefined })
            }
          />
        </div>
      </div>

      {detail.type === 'metered' && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-600">Tiered Pricing</span>
            <span className="text-xs text-gray-400">(leave empty to use flat rate)</span>
          </div>
          <TierEditor
            tiers={detail.tiers ?? []}
            onChange={(tiers) => onChange({ ...detail, tiers: tiers.length ? tiers : undefined })}
          />
        </div>
      )}

      {detail.type === 'metered' && propertyId && detail.key && (
        <MeterReadingWidget
          propertyId={propertyId}
          utilityKey={detail.key}
          unitStr={detail.unit}
        />
      )}
    </div>
  )
}
