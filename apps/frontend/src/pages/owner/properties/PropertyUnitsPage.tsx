import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { unitsApi } from '@/api/units'
import { invoicesApi } from '@/api/invoices'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { propertiesApi } from '@/api/properties'
import { extractApiError } from '@/utils/apiError'
import UnitEditModal from '@/components/UnitEditModal'
import { useAuth } from '@/hooks/useAuth'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import type { Unit, UnitStatus } from '@/types/unit'
import type { Property } from '@/types/property'

const STATUS_COLORS: Record<UnitStatus, string> = {
  vacant: 'bg-green-100 text-green-800',
  reserved: 'bg-yellow-100 text-yellow-800',
  occupied: 'bg-blue-100 text-blue-800',
  inactive: 'bg-gray-100 text-gray-600',
}

export default function PropertyUnitsPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { user } = useAuth()
  const { orgProfile } = useOrgProfile()
  const [property, setProperty] = useState<Property | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [filterWing, setFilterWing] = useState('')

  // Reserve modal
  const [reserveUnit, setReserveUnit] = useState<Unit | null>(null)
  const [tenantId, setTenantId] = useState('')
  const [reserveLoading, setReserveLoading] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)

  // Unit edit modal
  const [editUnit, setEditUnit] = useState<Unit | null>(null)

  // Bulk rent modal
  const [bulkRent, setBulkRent] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

  // Smart meter seed
  const [seedUnit, setSeedUnit] = useState<Unit | null>(null)
  const [seedStep, setSeedStep] = useState<'confirm' | 'seeding' | 'attaching' | 'done' | 'error'>('confirm')
  const [seedResult, setSeedResult] = useState<{ inserted: number; invoice_ref?: string } | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)

  const canEdit = user?.role === 'owner' || user?.role === 'superadmin'

  useEffect(() => {
    if (!propertyId) return
    propertiesApi.get(propertyId).then((p) => setProperty(p)).catch(() => {})
  }, [propertyId])

  async function load() {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await unitsApi.list(propertyId, {
        status: filterStatus || undefined,
        wing: filterWing || undefined,
        page,
        page_size: 50,
      })
      setUnits(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId, filterStatus, filterWing, page])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === units.length ? new Set() : new Set(units.map((u) => u.id))
    )
  }

  async function handleReserve() {
    if (!reserveUnit || !tenantId.trim()) return
    setReserveLoading(true)
    setReserveError(null)
    try {
      await unitsApi.reserve(reserveUnit.id, tenantId.trim())
      setReserveUnit(null)
      setTenantId('')
      load()
    } catch (err) {
      setReserveError(extractApiError(err).message)
    } finally {
      setReserveLoading(false)
    }
  }

  async function handleBulkRent() {
    if (!propertyId || !bulkRent || selected.size === 0) return
    setBulkLoading(true)
    try {
      await unitsApi.bulkUpdate(propertyId, {
        updates: [...selected].map((unit_id) => ({
          unit_id,
          updates: { rent_base: parseFloat(bulkRent) },
        })),
      })
      setBulkRent('')
      setSelected(new Set())
      load()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleRelease(unit: Unit) {
    try {
      await unitsApi.releaseReservation(unit.id)
      load()
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  async function handleSeedSmartMeter() {
    if (!seedUnit) return
    setSeedError(null)
    setSeedStep('seeding')
    try {
      const seeded = await unitsApi.seedWaterReadings(seedUnit.id)
      setSeedStep('attaching')
      // Find latest invoice for this unit
      const invoiceList = await invoicesApi.list({ property_id: propertyId, page: 1, page_size: 50 })
      const unitInvoice = invoiceList.items.find(inv => inv.unit_id === seedUnit.id && inv.status !== 'void')
      let invoiceRef: string | undefined
      if (unitInvoice) {
        const result = await invoicesApi.applySmartMeter(unitInvoice.id)
        invoiceRef = result.invoice.reference_no
      }
      setSeedResult({ inserted: seeded.inserted, invoice_ref: invoiceRef })
      setSeedStep('done')
    } catch (err) {
      setSeedError(extractApiError(err).message)
      setSeedStep('error')
    }
  }

  return (
    <>
    <div className="p-8">
        <PropertyBreadcrumb page="Units" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Units {!loading && <span className="text-gray-400 font-normal text-base">({total})</span>}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/portfolio/properties/${propertyId}/leases`}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 font-medium transition-colors"
            >
              Manage Leases →
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <select
            className="input w-40"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
          >
            <option value="">All Statuses</option>
            <option value="vacant">Vacant</option>
            <option value="reserved">Reserved</option>
            <option value="occupied">Occupied</option>
            <option value="inactive">Inactive</option>
          </select>
          <input
            className="input w-32"
            placeholder="Wing"
            value={filterWing}
            onChange={(e) => { setFilterWing(e.target.value); setPage(1) }}
          />
        </div>

        {/* Bulk actions */}
        {canEdit && selected.size > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-4">
            <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
            <input
              className="input w-36"
              type="number"
              placeholder="New rent (KES)"
              value={bulkRent}
              onChange={(e) => setBulkRent(e.target.value)}
            />
            <button
              onClick={handleBulkRent}
              disabled={!bulkRent || bulkLoading}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50 font-medium"
            >
              {bulkLoading ? '…' : 'Apply Rent'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {canEdit && (
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === units.length && units.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Floor</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Rent (KES)</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : units.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center text-gray-400">
                    No units found
                  </td>
                </tr>
              ) : (
                units.map((unit) => (
                  <tr key={unit.id} className="hover:bg-gray-50 transition-colors">
                    {canEdit && (
                      <td className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(unit.id)}
                          onChange={() => toggleSelect(unit.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {unit.unit_code}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{unit.floor}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{unit.unit_type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[unit.status]}`}
                      >
                        {unit.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {unit.rent_base != null ? unit.rent_base.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditUnit(unit)}
                            className="text-gray-500 text-xs font-medium hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setSeedUnit(unit); setSeedStep('confirm'); setSeedResult(null); setSeedError(null) }}
                            className="text-cyan-600 text-xs font-medium hover:underline"
                            title="Seed 30 days of smart meter water readings"
                          >
                            💧 Seed
                          </button>
                          {unit.status === 'vacant' && (
                            <button
                              onClick={() => setReserveUnit(unit)}
                              className="text-blue-600 text-xs font-medium hover:underline"
                            >
                              Reserve
                            </button>
                          )}
                          {unit.status === 'reserved' && (
                            <button
                              onClick={() => handleRelease(unit)}
                              className="text-orange-600 text-xs font-medium hover:underline"
                            >
                              Release
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 50 && (
          <div className="flex justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-sm text-gray-500">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={units.length < 50}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Unit edit modal */}
      {editUnit && property && (
        <UnitEditModal
          unit={editUnit}
          propertyUtilityDefaults={property.utility_defaults}
          accounts={property.ledger_settings?.accounts ?? orgProfile?.ledger_settings?.accounts ?? []}
          onClose={() => setEditUnit(null)}
          onSaved={(updated) => {
            setUnits((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
            setEditUnit(null)
          }}
        />
      )}

      {/* Smart Meter Seed modal */}
      {seedUnit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💧</span>
              <div>
                <h3 className="font-semibold text-lg">Smart Meter Demo</h3>
                <p className="text-sm text-gray-500">Unit {seedUnit.unit_code}</p>
              </div>
            </div>

            {seedStep === 'confirm' && (
              <>
                <div className="bg-cyan-50 border border-cyan-100 rounded-lg p-3 text-sm text-cyan-800 space-y-1">
                  <p className="font-medium">This will:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs">
                    <li>Generate 90 simulated water meter readings (30 days × 3/day)</li>
                    <li>Attach the readings to the unit&apos;s latest invoice as smart meter data</li>
                    <li>Compute usage trend and generate advice</li>
                  </ol>
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setSeedUnit(null)}
                    className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSeedSmartMeter}
                    className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-700"
                  >
                    Seed &amp; Attach
                  </button>
                </div>
              </>
            )}

            {(seedStep === 'seeding' || seedStep === 'attaching') && (
              <div className="flex flex-col items-center py-4 gap-3">
                <div className="w-8 h-8 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-600">
                  {seedStep === 'seeding' ? 'Generating 90 meter readings…' : 'Attaching to invoice…'}
                </p>
              </div>
            )}

            {seedStep === 'done' && seedResult && (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                  <p className="text-green-700 font-medium text-sm">✓ Done!</p>
                  <p className="text-xs text-green-600">{seedResult.inserted} meter readings inserted.</p>
                  {seedResult.invoice_ref ? (
                    <p className="text-xs text-green-600">
                      Smart meter data attached to invoice <span className="font-mono font-semibold">{seedResult.invoice_ref}</span>.
                      Open the invoice and click the 💧 Smart Meter tab to view usage graphs and insights.
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600">No active invoice found for this unit. Readings are saved and will be used in the next billing cycle.</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setSeedUnit(null)}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
                  >
                    Close
                  </button>
                </div>
              </>
            )}

            {seedStep === 'error' && (
              <>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {seedError}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setSeedUnit(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">Close</button>
                  <button onClick={handleSeedSmartMeter} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium">Retry</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reserve modal */}
      {reserveUnit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="font-semibold text-lg mb-1">Reserve Unit {reserveUnit.unit_code}</h3>
            <p className="text-sm text-gray-500 mb-4">Enter the tenant ID to reserve this unit.</p>
            <div className="mb-4">
              <label className="label">Tenant ID *</label>
              <input
                className="input"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="tenant_..."
                autoFocus
              />
            </div>
            {reserveError && (
              <p className="text-red-600 text-sm mb-3">{reserveError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setReserveUnit(null); setReserveError(null); setTenantId('') }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReserve}
                disabled={reserveLoading || !tenantId.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {reserveLoading ? 'Reserving…' : 'Reserve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
