import { useContext, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listFrameworkAssets, createFrameworkAsset, updateRegionsSites } from '@/api/frameworks'
import type { FrameworkAsset, FrameworkAssetCreateRequest, KvaRange } from '@/types/framework'
import { KVA_RANGES } from '@/types/framework'
import { extractApiError } from '@/utils/apiError'
import { FrameworkContext } from './FrameworkWorkspacePage'

const ACCENT = '#D97706'

const STATUS_COLORS: Record<string, string> = {
  operational:       'bg-green-100 text-green-700',
  under_maintenance: 'bg-yellow-100 text-yellow-700',
  fault:             'bg-red-100 text-red-700',
  standby:           'bg-blue-100 text-blue-700',
  decommissioned:    'bg-gray-100 text-gray-500',
}

const ENGINE_MAKES = ['Cummins', 'SDMO', 'FG Wilson', 'Perkins', 'Caterpillar', 'Kohler', 'Deutz', 'Volvo Penta', 'MTU', 'Other']

export default function FrameworkAssetsPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [assets, setAssets] = useState<FrameworkAsset[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterKva, setFilterKva] = useState('')
  const [filterRegion, setFilterRegion] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<FrameworkAsset | null>(null)

  async function load() {
    if (!frameworkId) return
    setLoading(true)
    try {
      const res = await listFrameworkAssets(frameworkId, {
        search, status: filterStatus, kva: filterKva, region: filterRegion, page,
      })
      setAssets(res.items ?? (res as unknown as FrameworkAsset[]))
      setTotal(res.total ?? 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [frameworkId, search, filterStatus, filterKva, filterRegion, page])

  const regions = [...new Set(assets.map(a => a.region).filter(Boolean))]

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Asset Registry</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} assets tracked in this framework</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: ACCENT }}
        >
          + Add Asset
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search site name, serial…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 w-56"
        />
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="operational">Operational</option>
          <option value="under_maintenance">Under Maintenance</option>
          <option value="fault">Fault</option>
          <option value="standby">Standby</option>
          <option value="decommissioned">Decommissioned</option>
        </select>
        <select
          value={filterKva}
          onChange={e => { setFilterKva(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">All KVA</option>
          {KVA_RANGES.map(k => <option key={k} value={k}>{k} KVA</option>)}
        </select>
        {regions.length > 0 && (
          <select
            value={filterRegion}
            onChange={e => { setFilterRegion(e.target.value); setPage(1) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">All regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Site / Asset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">KVA</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Engine</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Region</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">GPS</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Next Service</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading…</td></tr>
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16">
                  <div className="text-3xl mb-2">⚡</div>
                  <p className="text-sm text-gray-500">No assets found. Add your first generator site.</p>
                </td>
              </tr>
            ) : assets.map(asset => (
              <tr
                key={asset.id}
                onClick={() => setSelected(asset)}
                className="hover:bg-amber-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{asset.site_name}</div>
                  <div className="text-xs text-gray-400">{asset.asset_tag} · S/N {asset.serial_number}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-amber-700">{asset.kva_rating} KVA</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <div>{asset.engine_make}</div>
                  <div className="text-xs text-gray-400">{asset.engine_model}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{asset.region}</td>
                <td className="px-4 py-3">
                  {asset.gps_lat && asset.gps_lng ? (
                    <span className="text-xs text-green-600 font-medium">📍 Tracked</span>
                  ) : (
                    <span className="text-xs text-gray-300">No GPS</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {asset.next_service_date ? (
                    <span className={`text-xs font-medium ${
                      new Date(asset.next_service_date) < new Date() ? 'text-red-600' : 'text-gray-700'
                    }`}>
                      {new Date(asset.next_service_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[asset.operational_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {asset.operational_status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
              >
                ‹ Prev
              </button>
              <button
                disabled={page * 20 >= total}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateAssetModal
          frameworkId={frameworkId!}
          onClose={() => setShowCreate(false)}
          onCreated={(a) => { setAssets(p => [a, ...p]); setTotal(t => t + 1); setShowCreate(false) }}
        />
      )}

      {/* Detail Slide-Over */}
      {selected && (
        <AssetDetailSlideOver asset={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function CreateAssetModal({ frameworkId, onClose, onCreated }: {
  frameworkId: string
  onClose: () => void
  onCreated: (a: FrameworkAsset) => void
}) {
  const { framework } = useContext(FrameworkContext)
  const sch4 = framework?.schedule4_entries ?? []
  const fwSites = framework?.sites ?? []
  const fwRegions = framework?.regions ?? []

  const [form, setForm] = useState<FrameworkAssetCreateRequest>({
    site_name: '', site_code: '', kva_rating: '22-35', engine_make: 'Cummins',
    fuel_type: 'diesel', region: '', service_frequency: 'biannual',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // When user picks a site code from Schedule 4 entries, pre-populate matching fields
  function onSiteCodeSelect(siteCode: string) {
    // First look in Schedule 4
    const sch4Entry = sch4.find(e => e.site_code === siteCode)
    // Also look in framework sites for address/GPS/contact
    const fwSite = fwSites.find(s => s.site_code === siteCode)

    setForm(p => ({
      ...p,
      site_code: siteCode,
      site_name: sch4Entry?.site_name ?? fwSite?.site_name ?? p.site_name,
      region: sch4Entry?.region ?? fwSite?.region ?? p.region,
      engine_make: sch4Entry?.brand ?? p.engine_make,
      kva_rating: (sch4Entry?.kva_rating as KvaRange) ?? p.kva_rating,
      physical_address: fwSite?.physical_address ?? p.physical_address,
      gps_lat: fwSite?.gps_lat ?? p.gps_lat,
      gps_lng: fwSite?.gps_lng ?? p.gps_lng,
      site_contact_name: fwSite?.contact_name ?? p.site_contact_name,
      site_contact_phone: fwSite?.contact_phone ?? p.site_contact_phone,
    }))
  }

  // Unique site codes from Schedule 4 + framework sites
  const allSiteCodes = [...new Set([
    ...sch4.filter(e => e.site_code).map(e => e.site_code!),
    ...fwSites.map(s => s.site_code),
  ])]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const asset = await createFrameworkAsset(frameworkId, form)

      // Sync GPS / contact back to framework Regions & Sites if the site exists there
      const existingSite = fwSites.find(s => s.site_code === form.site_code)
      const hasNewGps = form.gps_lat != null || form.gps_lng != null
      const hasNewContact = form.site_contact_name || form.site_contact_phone
      if (existingSite && (hasNewGps || hasNewContact)) {
        const updatedSites = fwSites.map(s =>
          s.site_code === form.site_code
            ? {
                ...s,
                gps_lat: form.gps_lat ?? s.gps_lat,
                gps_lng: form.gps_lng ?? s.gps_lng,
                contact_name: form.site_contact_name ?? s.contact_name,
                contact_phone: form.site_contact_phone ?? s.contact_phone,
                physical_address: form.physical_address ?? s.physical_address,
              }
            : s
        )
        updateRegionsSites(frameworkId, { regions: fwRegions, sites: updatedSites }).catch(() => {})
      }

      onCreated(asset)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  function field(label: string, key: keyof FrameworkAssetCreateRequest, props: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
        <input
          {...props}
          value={(form[key] as string) ?? ''}
          onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-bold text-gray-900">Add Generator Asset</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Site Code — primary lookup */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Site Code *</label>
              {allSiteCodes.length > 0 ? (
                <select
                  required
                  value={form.site_code}
                  onChange={e => onSiteCodeSelect(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">— Select site —</option>
                  {allSiteCodes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input
                  required
                  value={form.site_code}
                  onChange={e => setForm(p => ({ ...p, site_code: e.target.value }))}
                  placeholder="KCB-UPH-001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              )}
            </div>
            {field('Site Name *', 'site_name', { required: true, placeholder: 'KCB Upperhill Branch' })}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">KVA *</label>
              <input
                required
                value={form.kva_rating}
                onChange={e => setForm(p => ({ ...p, kva_rating: e.target.value as KvaRange }))}
                list="kva-opts"
                placeholder="e.g. 100 KVA"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <datalist id="kva-opts">
                {KVA_RANGES.map(k => <option key={k} value={k}>{k} KVA</option>)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Brand / Engine Make *</label>
              <input
                required
                value={form.engine_make}
                onChange={e => setForm(p => ({ ...p, engine_make: e.target.value }))}
                list="make-opts"
                placeholder="Cummins"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <datalist id="make-opts">
                {ENGINE_MAKES.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
            {field('Engine Model', 'engine_model', { placeholder: 'QSB7-G5 (optional)' })}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {field('Serial Number', 'serial_number', { placeholder: 'CUM2025001 (optional)' })}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Manufacture Year</label>
              <input
                type="number"
                min={2000}
                max={2030}
                value={form.manufacture_year ?? ''}
                onChange={e => setForm(p => ({ ...p, manufacture_year: Number(e.target.value) || undefined }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                placeholder="2022"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Region *</label>
              {fwRegions.length > 0 ? (
                <select
                  required
                  value={form.region}
                  onChange={e => setForm(p => ({ ...p, region: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="">— Select region —</option>
                  {fwRegions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input
                  required
                  value={form.region}
                  onChange={e => setForm(p => ({ ...p, region: e.target.value }))}
                  placeholder="Central Region"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              )}
            </div>
            {field('Physical Address', 'physical_address', { placeholder: 'Upperhill, Nairobi' })}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">GPS Latitude</label>
              <input
                type="number"
                step="any"
                value={form.gps_lat ?? ''}
                onChange={e => setForm(p => ({ ...p, gps_lat: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                placeholder="-1.2921"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">GPS Longitude</label>
              <input
                type="number"
                step="any"
                value={form.gps_lng ?? ''}
                onChange={e => setForm(p => ({ ...p, gps_lng: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                placeholder="36.8219"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {field('Site Contact Name', 'site_contact_name', { placeholder: 'John Kamau' })}
            {field('Site Contact Phone', 'site_contact_phone', { placeholder: '+254 7XX XXX XXX' })}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Service Frequency</label>
              <select
                value={form.service_frequency}
                onChange={e => setForm(p => ({ ...p, service_frequency: e.target.value as typeof form.service_frequency }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="biannual">Biannual (PPM)</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Installation Date</label>
              <input
                type="date"
                value={form.installation_date ?? ''}
                onChange={e => setForm(p => ({ ...p, installation_date: e.target.value || undefined }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Warranty Expiry</label>
              <input
                type="date"
                value={form.warranty_expiry ?? ''}
                onChange={e => setForm(p => ({ ...p, warranty_expiry: e.target.value || undefined }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.notes ?? ''}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value || undefined }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              placeholder="Additional notes about this asset…"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? 'Adding…' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssetDetailSlideOver({ asset, onClose }: { asset: FrameworkAsset; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{asset.site_name}</h2>
            <p className="text-xs text-gray-400">{asset.asset_tag} · {asset.serial_number}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 shrink-0">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${STATUS_COLORS[asset.operational_status] ?? 'bg-gray-100 text-gray-600'}`}>
              {asset.operational_status.replace('_', ' ')}
            </span>
            <span className="text-xs text-amber-700 font-bold bg-amber-50 px-3 py-1 rounded-full">
              {asset.kva_rating} KVA
            </span>
          </div>

          {/* Technical specs */}
          <Section title="Technical Specifications">
            <Row label="Engine Make" value={asset.engine_make} />
            <Row label="Engine Model" value={asset.engine_model ?? '—'} />
            <Row label="Serial Number" value={asset.serial_number ?? '—'} />
            <Row label="Manufacture Year" value={asset.manufacture_year?.toString() ?? '—'} />
            <Row label="Fuel Type" value={asset.fuel_type} />
            <Row label="KVA Rating" value={`${asset.kva_rating} KVA`} />
            {asset.total_runtime_hours != null && (
              <Row label="Total Runtime" value={`${asset.total_runtime_hours.toLocaleString()} hrs`} />
            )}
          </Section>

          {/* Location */}
          <Section title="Location">
            <Row label="Region" value={asset.region} />
            <Row label="Address" value={asset.physical_address ?? '—'} />
            {asset.gps_lat && asset.gps_lng && (
              <Row label="GPS Coordinates" value={`${asset.gps_lat.toFixed(6)}, ${asset.gps_lng.toFixed(6)}`} />
            )}
            {asset.site_contact_name && <Row label="Site Contact" value={asset.site_contact_name} />}
            {asset.site_contact_phone && <Row label="Contact Phone" value={asset.site_contact_phone} />}
          </Section>

          {/* Service */}
          <Section title="Service Schedule">
            <Row label="Frequency" value={asset.service_frequency} />
            <Row label="Last Service" value={asset.last_service_date ? new Date(asset.last_service_date).toLocaleDateString('en-GB') : '—'} />
            <Row
              label="Next Service"
              value={asset.next_service_date ? new Date(asset.next_service_date).toLocaleDateString('en-GB') : '—'}
              highlight={asset.next_service_date ? new Date(asset.next_service_date) < new Date() : false}
            />
            {asset.last_service_type && <Row label="Last Service Type" value={asset.last_service_type.replace('_', ' ')} />}
          </Section>

          {/* Dates */}
          <Section title="Dates">
            {asset.installation_date && <Row label="Installed" value={new Date(asset.installation_date).toLocaleDateString('en-GB')} />}
            {asset.warranty_expiry && <Row label="Warranty Expiry" value={new Date(asset.warranty_expiry).toLocaleDateString('en-GB')} />}
          </Section>

          {/* GPS Map placeholder */}
          {asset.gps_lat && asset.gps_lng && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Location Preview</p>
              <div className="rounded-lg bg-gray-100 border border-gray-200 h-32 flex flex-col items-center justify-center text-gray-400 text-sm">
                <span className="text-3xl mb-1">📍</span>
                <span className="font-mono text-xs">{asset.gps_lat.toFixed(6)}, {asset.gps_lng.toFixed(6)}</span>
                <a
                  href={`https://www.google.com/maps?q=${asset.gps_lat},${asset.gps_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 text-xs text-amber-600 hover:underline"
                >
                  Open in Google Maps →
                </a>
              </div>
            </div>
          )}

          {asset.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{asset.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="bg-gray-50 rounded-lg divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}
