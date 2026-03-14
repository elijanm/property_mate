import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { assetsApi } from '@/api/assets'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import VendorPicker from '@/components/VendorPicker'
import StoreLocationPicker from '@/components/StoreLocationPicker'
import type { Asset, AssetCounts, AssetLifecycleStatus } from '@/types/asset'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n?: number) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

const LIFECYCLE_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  in_maintenance: 'bg-yellow-100 text-yellow-800',
  checked_out: 'bg-blue-100 text-blue-800',
  retired: 'bg-gray-100 text-gray-600',
  disposed: 'bg-red-100 text-red-700',
  written_off: 'bg-red-100 text-red-700',
}

const CONDITION_COLORS: Record<string, string> = {
  new: 'bg-emerald-100 text-emerald-800',
  excellent: 'bg-green-100 text-green-800',
  good: 'bg-blue-100 text-blue-700',
  fair: 'bg-yellow-100 text-yellow-800',
  poor: 'bg-orange-100 text-orange-800',
  damaged: 'bg-red-100 text-red-700',
}

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

// ── Create Asset Modal ────────────────────────────────────────────────────────

interface CreateAssetModalProps {
  propertyId: string
  onClose: () => void
  onCreated: (asset: Asset) => void
}

function CreateAssetModal({ propertyId, onClose, onCreated }: CreateAssetModalProps) {
  const [form, setForm] = useState({
    name: '',
    category: '',
    subcategory: '',
    description: '',
    serial_number: '',
    manufacturer: '',
    model: '',
    vendor_name: '',
    purchase_cost: '',
    purchase_date: '',
    warranty_expiry: '',
    condition: 'good',
    location: '',
    notes: '',
  })
  const [storeLocationId, setStoreLocationId] = useState('')
  const [storeLocationPath, setStoreLocationPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.category.trim()) {
      setError('Name and category are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const asset = await assetsApi.create({
        ...form,
        property_id: propertyId,
        purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : undefined,
        purchase_date: form.purchase_date || undefined,
        warranty_expiry: form.warranty_expiry || undefined,
        condition: form.condition as Asset['condition'],
        store_location_id: storeLocationId || undefined,
        store_location_path: storeLocationPath || undefined,
      })
      onCreated(asset)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Add Asset</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Name *</label>
              <input className="input mt-1 w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Air Conditioner Unit" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Category *</label>
              <input className="input mt-1 w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. HVAC" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Subcategory</label>
              <input className="input mt-1 w-full" value={form.subcategory} onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))} placeholder="e.g. Air Conditioning" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Manufacturer</label>
              <input className="input mt-1 w-full" value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Model</label>
              <input className="input mt-1 w-full" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Serial Number</label>
              <input className="input mt-1 w-full" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Vendor / Supplier</label>
              <VendorPicker
                className="mt-1"
                value={form.vendor_name}
                onChange={name => setForm(f => ({ ...f, vendor_name: name }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Purchase Cost (KES)</label>
              <input type="number" className="input mt-1 w-full" value={form.purchase_cost} onChange={e => setForm(f => ({ ...f, purchase_cost: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Purchase Date</label>
              <input type="date" className="input mt-1 w-full" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Warranty Expiry</label>
              <input type="date" className="input mt-1 w-full" value={form.warranty_expiry} onChange={e => setForm(f => ({ ...f, warranty_expiry: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Condition</label>
              <select className="input mt-1 w-full" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                {['new', 'excellent', 'good', 'fair', 'poor', 'damaged'].map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Location (free text)</label>
              <input className="input mt-1 w-full" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Store Room A" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Store Location</label>
              <StoreLocationPicker
                propertyId={propertyId}
                value={storeLocationId}
                onChange={(id, path) => { setStoreLocationId(id); setStoreLocationPath(path) }}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Notes</label>
              <textarea className="input mt-1 w-full" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Asset Detail Slide-Over ───────────────────────────────────────────────────

interface AssetDetailProps {
  asset: Asset
  onClose: () => void
  onUpdate: (updated: Asset) => void
}

function AssetDetailSlideOver({ asset, onClose, onUpdate }: AssetDetailProps) {
  const [tab, setTab] = useState<'details' | 'maintenance' | 'history' | 'audit'>('details')
  const [showMaintenance, setShowMaintenance] = useState(false)
  const [showValuation, setShowValuation] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [maintenanceForm, setMaintenanceForm] = useState({ date: '', maintenance_type: 'preventive', description: '', cost: '', next_due: '' })
  const [valuationForm, setValuationForm] = useState({ date: new Date().toISOString().slice(0, 10), value: '', method: 'manual' })
  const [checkoutForm, setCheckoutForm] = useState({ checked_out_to: '', checked_out_to_name: '', expected_return: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitMaintenance(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const updated = await assetsApi.addMaintenance(asset.id, {
        ...maintenanceForm,
        cost: maintenanceForm.cost ? parseFloat(maintenanceForm.cost) : undefined,
        next_due: maintenanceForm.next_due || undefined,
      })
      onUpdate(updated)
      setShowMaintenance(false)
      setMaintenanceForm({ date: '', maintenance_type: 'preventive', description: '', cost: '', next_due: '' })
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  async function submitValuation(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const updated = await assetsApi.addValuation(asset.id, { ...valuationForm, value: parseFloat(valuationForm.value) })
      onUpdate(updated)
      setShowValuation(false)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  async function submitCheckout(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const updated = await assetsApi.checkout(asset.id, { ...checkoutForm, expected_return: checkoutForm.expected_return || undefined })
      onUpdate(updated)
      setShowCheckout(false)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  async function handleCheckin() {
    setSaving(true); setError(null)
    try {
      const updated = await assetsApi.checkin(asset.id, {})
      onUpdate(updated)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400">{asset.asset_id}</span>
              <Badge label={asset.lifecycle_status} colorClass={LIFECYCLE_COLORS[asset.lifecycle_status] ?? 'bg-gray-100 text-gray-600'} />
              <Badge label={asset.condition} colorClass={CONDITION_COLORS[asset.condition] ?? 'bg-gray-100 text-gray-600'} />
            </div>
            <h2 className="text-base font-bold text-gray-900">{asset.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{asset.category}{asset.subcategory ? ` › ${asset.subcategory}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {asset.lifecycle_status === 'active' && (
              <button onClick={() => setShowCheckout(true)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Check Out</button>
            )}
            {asset.lifecycle_status === 'checked_out' && (
              <button onClick={handleCheckin} disabled={saving} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Check In</button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {(['details', 'maintenance', 'history', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {error && <p className="mx-6 mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'details' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Info label="Current Value" value={fmtCurrency(asset.current_value)} />
                <Info label="Purchase Cost" value={fmtCurrency(asset.purchase_cost)} />
                <Info label="Purchase Date" value={fmtDate(asset.purchase_date)} />
                <Info label="Warranty Expiry" value={fmtDate(asset.warranty_expiry)} />
                <Info label="Serial Number" value={asset.serial_number} />
                <Info label="Manufacturer" value={asset.manufacturer} />
                <Info label="Model" value={asset.model} />
                <Info label="Vendor" value={asset.vendor_name} />
                <Info label="Location" value={asset.location} />
                {asset.store_location_path && (
                  <Info label="Store Location" value={asset.store_location_path} />
                )}
                <Info label="Department" value={asset.department} />
                <Info label="Assigned To" value={asset.assigned_to_name} />
                <Info label="Next Service" value={fmtDate(asset.next_service_date)} />
                <Info label="Depreciation Method" value={asset.depreciation_method?.replace(/_/g, ' ')} />
                <Info label="Useful Life" value={asset.useful_life_years ? `${asset.useful_life_years} years` : undefined} />
              </div>
              {asset.notes && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">{asset.notes}</div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowValuation(true)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Record Valuation</button>
              </div>
            </>
          )}

          {tab === 'maintenance' && (
            <>
              <button onClick={() => setShowMaintenance(true)} className="w-full text-sm px-4 py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50">
                + Add Maintenance Record
              </button>
              {asset.maintenance_history.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No maintenance records yet</p>
              )}
              {[...asset.maintenance_history].reverse().map((m) => (
                <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-700 capitalize">{m.maintenance_type.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-gray-400">{fmtDate(m.date)}</span>
                  </div>
                  <p className="text-sm text-gray-700">{m.description}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    {m.cost != null && <span>Cost: {fmtCurrency(m.cost)}</span>}
                    {m.performed_by_name && <span>By: {m.performed_by_name}</span>}
                    {m.next_due && <span>Next due: {fmtDate(m.next_due)}</span>}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'history' && (
            <>
              {/* Transfer History */}
              {asset.transfer_history.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Transfers</p>
                  {[...asset.transfer_history].reverse().map((t) => (
                    <div key={t.id} className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 mb-2">
                      <span className="font-medium">{t.from_property_name || t.from_location || '—'}</span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="font-medium">{t.to_property_name || t.to_location || '—'}</span>
                      <span className="ml-2 text-gray-400">{fmtDate(t.transferred_at)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Checkout History */}
              {asset.checkout_history.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Checkouts</p>
                  {[...asset.checkout_history].reverse().map((c) => (
                    <div key={c.id} className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 mb-2 flex justify-between">
                      <div>
                        <span className="font-medium">{c.checked_out_to_name || c.checked_out_to}</span>
                        {c.returned_at
                          ? <span className="ml-2 text-green-600">Returned {fmtDate(c.returned_at)}</span>
                          : <span className="ml-2 text-blue-600">Outstanding</span>}
                      </div>
                      <span className="text-gray-400">{fmtDate(c.checked_out_at)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Valuation History */}
              {asset.valuation_history.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Valuations</p>
                  {[...asset.valuation_history].reverse().map((v) => (
                    <div key={v.id} className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 mb-2 flex justify-between">
                      <span>{fmtCurrency(v.value)} <span className="text-gray-400">({v.method})</span></span>
                      <span className="text-gray-400">{fmtDate(v.date)}</span>
                    </div>
                  ))}
                </div>
              )}
              {asset.transfer_history.length === 0 && asset.checkout_history.length === 0 && asset.valuation_history.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No history yet</p>
              )}
            </>
          )}

          {tab === 'audit' && (
            <>
              {asset.audit_trail.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No audit entries</p>
              )}
              {[...asset.audit_trail].reverse().map((e) => (
                <div key={e.id} className="flex gap-3 text-sm">
                  <div className="flex-shrink-0 w-1 bg-gray-200 rounded-full" />
                  <div>
                    <p className="text-gray-700">{e.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(e.timestamp)} {e.actor_name && `· ${e.actor_name}`}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Inline forms */}
        {showMaintenance && (
          <div className="border-t border-gray-100 p-6 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900 mb-3">Add Maintenance Record</p>
            <form onSubmit={submitMaintenance} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Date *</label>
                  <input type="date" className="input mt-1 w-full" value={maintenanceForm.date} onChange={e => setMaintenanceForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Type</label>
                  <select className="input mt-1 w-full" value={maintenanceForm.maintenance_type} onChange={e => setMaintenanceForm(f => ({ ...f, maintenance_type: e.target.value }))}>
                    {['preventive', 'corrective', 'inspection', 'cleaning', 'calibration'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Description *</label>
                  <input className="input mt-1 w-full" value={maintenanceForm.description} onChange={e => setMaintenanceForm(f => ({ ...f, description: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Cost (KES)</label>
                  <input type="number" className="input mt-1 w-full" value={maintenanceForm.cost} onChange={e => setMaintenanceForm(f => ({ ...f, cost: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Next Due</label>
                  <input type="date" className="input mt-1 w-full" value={maintenanceForm.next_due} onChange={e => setMaintenanceForm(f => ({ ...f, next_due: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowMaintenance(false)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-white">Cancel</button>
                <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        )}

        {showValuation && (
          <div className="border-t border-gray-100 p-6 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900 mb-3">Record Valuation</p>
            <form onSubmit={submitValuation} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Date *</label>
                  <input type="date" className="input mt-1 w-full" value={valuationForm.date} onChange={e => setValuationForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Value (KES) *</label>
                  <input type="number" className="input mt-1 w-full" value={valuationForm.value} onChange={e => setValuationForm(f => ({ ...f, value: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Method</label>
                  <select className="input mt-1 w-full" value={valuationForm.method} onChange={e => setValuationForm(f => ({ ...f, method: e.target.value }))}>
                    {['manual', 'purchase', 'appraised', 'depreciated'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowValuation(false)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-white">Cancel</button>
                <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        )}

        {showCheckout && (
          <div className="border-t border-gray-100 p-6 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900 mb-3">Check Out Asset</p>
            <form onSubmit={submitCheckout} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Checked Out To *</label>
                  <input className="input mt-1 w-full" value={checkoutForm.checked_out_to} onChange={e => setCheckoutForm(f => ({ ...f, checked_out_to: e.target.value }))} placeholder="User ID or name" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Name</label>
                  <input className="input mt-1 w-full" value={checkoutForm.checked_out_to_name} onChange={e => setCheckoutForm(f => ({ ...f, checked_out_to_name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Expected Return</label>
                  <input type="date" className="input mt-1 w-full" value={checkoutForm.expected_return} onChange={e => setCheckoutForm(f => ({ ...f, expected_return: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowCheckout(false)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-white">Cancel</button>
                <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving…' : 'Check Out'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{value ?? '—'}</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PropertyAssetsPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [assets, setAssets] = useState<Asset[]>([])
  const [counts, setCounts] = useState<AssetCounts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<AssetLifecycleStatus | ''>('')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  async function load() {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const [listRes, countsRes] = await Promise.all([
        assetsApi.list({
          property_id: propertyId,
          lifecycle_status: filterStatus || undefined,
          category: filterCategory || undefined,
          search: search || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        assetsApi.getCounts({ property_id: propertyId }),
      ])
      setAssets(listRes.items)
      setTotal(listRes.total)
      setCounts(countsRes)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId, filterStatus, filterCategory, search, page])

  const selectedAsset = assets.find(a => a.id === selectedId) ?? null

  function handleUpdated(updated: Asset) {
    setAssets(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Assets" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assets</h1>
          <p className="text-sm text-gray-500 mt-0.5">Long-term physical assets tracked for this property</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + Add Asset
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-6 gap-3 mb-6">
          <StatCard label="Total" value={counts.total} color="text-gray-900" />
          <StatCard label="Active" value={counts.active} color="text-green-700" />
          <StatCard label="In Maintenance" value={counts.in_maintenance} color="text-yellow-700" />
          <StatCard label="Checked Out" value={counts.checked_out} color="text-blue-700" />
          <StatCard label="Retired" value={counts.retired} color="text-gray-500" />
          <StatCard label="Disposed" value={counts.disposed + counts.written_off} color="text-red-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="input text-sm flex-1 min-w-[200px]"
          placeholder="Search name, ID, serial…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="input text-sm"
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as AssetLifecycleStatus | ''); setPage(1) }}
        >
          <option value="">All Statuses</option>
          {['active', 'in_maintenance', 'checked_out', 'retired', 'disposed', 'written_off'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          className="input text-sm"
          placeholder="Category filter"
          value={filterCategory}
          onChange={e => { setFilterCategory(e.target.value); setPage(1) }}
        />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Asset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Condition</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Value</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Next Service</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={7} className="text-center py-10 text-sm text-gray-400">Loading…</td></tr>
            )}
            {!loading && assets.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-14">
                  <span className="text-4xl block mb-2">🏷️</span>
                  <p className="text-sm text-gray-500">No assets found for this property</p>
                  <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-blue-600 hover:underline">
                    Add your first asset
                  </button>
                </td>
              </tr>
            )}
            {assets.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedId(a.id)}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 truncate max-w-[180px]">{a.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{a.asset_id}</p>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {a.category}{a.subcategory ? <span className="text-gray-400"> › {a.subcategory}</span> : ''}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {a.store_location_path
                    ? <span title={a.store_location_path} className="text-blue-600 text-xs">📦 {a.store_location_path.split(' / ').pop()}</span>
                    : (a.location ?? '—')
                  }
                </td>
                <td className="px-4 py-3">
                  <Badge label={a.condition} colorClass={CONDITION_COLORS[a.condition] ?? 'bg-gray-100 text-gray-600'} />
                </td>
                <td className="px-4 py-3">
                  <Badge label={a.lifecycle_status} colorClass={LIFECYCLE_COLORS[a.lifecycle_status] ?? 'bg-gray-100 text-gray-600'} />
                </td>
                <td className="px-4 py-3 text-gray-900 font-medium">{fmtCurrency(a.current_value)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(a.next_service_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{total} assets total</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        </div>
      )}

      {showCreate && propertyId && (
        <CreateAssetModal
          propertyId={propertyId}
          onClose={() => setShowCreate(false)}
          onCreated={(asset) => { setAssets(prev => [asset, ...prev]); setShowCreate(false) }}
        />
      )}

      {selectedAsset && (
        <AssetDetailSlideOver
          asset={selectedAsset}
          onClose={() => setSelectedId(null)}
          onUpdate={handleUpdated}
        />
      )}
    </div>
  )
}
