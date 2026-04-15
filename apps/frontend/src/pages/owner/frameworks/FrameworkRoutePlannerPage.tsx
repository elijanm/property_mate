import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listFrameworkAssets, generateRoute } from '@/api/frameworks'
import type { FrameworkAsset, WorkOrder } from '@/types/framework'

const ACCENT = '#D97706'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function nearestNeighborRoute(start: { lat: number; lng: number }, assets: FrameworkAsset[]): FrameworkAsset[] {
  const remaining = [...assets]
  const route: FrameworkAsset[] = []
  let cur = start

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((a, i) => {
      if (a.gps_lat && a.gps_lng) {
        const d = haversineKm(cur.lat, cur.lng, a.gps_lat, a.gps_lng)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
    })
    const next = remaining.splice(bestIdx, 1)[0]
    if (next.gps_lat && next.gps_lng) cur = { lat: next.gps_lat, lng: next.gps_lng }
    route.push(next)
  }
  return route
}

export default function FrameworkRoutePlannerPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [allAssets, setAllAssets] = useState<FrameworkAsset[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [startLat, setStartLat] = useState('')
  const [startLng, setStartLng] = useState('')
  const [route, setRoute] = useState<FrameworkAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedWorkOrder, setSavedWorkOrder] = useState<WorkOrder | null>(null)
  const [filterRegion, setFilterRegion] = useState('')
  const [dueOnly, setDueOnly] = useState(false)

  useEffect(() => {
    if (!frameworkId) return
    listFrameworkAssets(frameworkId, { page: 1 }).then(res => {
      setAllAssets(res.items ?? (res as unknown as FrameworkAsset[]))
    }).finally(() => setLoading(false))
  }, [frameworkId])

  const regions = [...new Set(allAssets.map(a => a.region).filter(Boolean))]
  const today = new Date()

  const filtered = allAssets.filter(a => {
    if (filterRegion && a.region !== filterRegion) return false
    if (dueOnly) {
      if (!a.next_service_date) return false
      if (new Date(a.next_service_date) > today) return false
    }
    return true
  })

  const gpsAssets = filtered.filter(a => a.gps_lat && a.gps_lng)
  const noGpsAssets = filtered.filter(a => !a.gps_lat || !a.gps_lng)

  function toggleAsset(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === gpsAssets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(gpsAssets.map(a => a.id)))
    }
  }

  function handleGenerateRoute() {
    const chosenAssets = gpsAssets.filter(a => selected.has(a.id))
    if (chosenAssets.length === 0) return
    setGenerating(true)
    const lat = parseFloat(startLat) || -1.2921
    const lng = parseFloat(startLng) || 36.8219
    const optimized = nearestNeighborRoute({ lat, lng }, chosenAssets)
    setRoute(optimized)
    setSavedWorkOrder(null)
    setGenerating(false)
  }

  async function handleSaveWorkOrder() {
    if (!frameworkId || route.length === 0) return
    setSaving(true)
    try {
      const wo = await generateRoute(
        frameworkId,
        route.map(a => a.id),
        parseFloat(startLat) || undefined,
        parseFloat(startLng) || undefined,
      )
      setSavedWorkOrder(wo)
    } catch { /* handled by interceptor */ }
    finally { setSaving(false) }
  }

  // Compute total distance
  const totalKm = route.length > 1
    ? route.reduce((acc, stop, i) => {
        if (i === 0) return acc
        const prev = route[i - 1]
        if (!prev.gps_lat || !prev.gps_lng || !stop.gps_lat || !stop.gps_lng) return acc
        return acc + haversineKm(prev.gps_lat, prev.gps_lng, stop.gps_lat, stop.gps_lng)
      }, 0)
    : 0

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Route Planner</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Select assets to service, set your start point, and generate an optimized route for your technicians.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asset selection panel */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Select Assets</h2>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={filterRegion}
                onChange={e => setFilterRegion(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
              >
                <option value="">All regions</option>
                {regions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dueOnly}
                  onChange={e => setDueOnly(e.target.checked)}
                  className="accent-amber-600"
                />
                Overdue only
              </label>
              <span className="ml-auto text-xs text-gray-400">{gpsAssets.length} GPS-tracked</span>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[420px]">
            {loading ? (
              <div className="py-12 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Select all */}
                {gpsAssets.length > 0 && (
                  <div
                    onClick={toggleAll}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.size === gpsAssets.length && gpsAssets.length > 0}
                      onChange={toggleAll}
                      className="accent-amber-600"
                    />
                    <span className="text-xs font-semibold text-gray-700">Select all ({gpsAssets.length})</span>
                  </div>
                )}

                {gpsAssets.map(a => {
                  const isOverdue = a.next_service_date && new Date(a.next_service_date) < today
                  return (
                    <div
                      key={a.id}
                      onClick={() => toggleAsset(a.id)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 ${
                        selected.has(a.id) ? 'bg-amber-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleAsset(a.id)}
                        className="accent-amber-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{a.site_name}</span>
                          {isOverdue && (
                            <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0">OVERDUE</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">{a.region} · {a.kva_rating} KVA</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-mono text-gray-400">
                          {a.gps_lat?.toFixed(4)}, {a.gps_lng?.toFixed(4)}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {noGpsAssets.length > 0 && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400">
                      ⚠️ {noGpsAssets.length} asset{noGpsAssets.length !== 1 ? 's' : ''} excluded (no GPS coordinates):{' '}
                      {noGpsAssets.slice(0, 3).map(a => a.site_name).join(', ')}
                      {noGpsAssets.length > 3 && ` +${noGpsAssets.length - 3} more`}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Config + Result panel */}
        <div className="space-y-5">
          {/* Start point */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Start Point (Depot / Office)</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={startLat}
                  onChange={e => setStartLat(e.target.value)}
                  placeholder="-1.2921"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={startLng}
                  onChange={e => setStartLng(e.target.value)}
                  placeholder="36.8219"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">Leave blank to use Nairobi CBD as default start.</p>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerateRoute}
            disabled={selected.size === 0 || generating}
            className="w-full py-3 text-sm font-bold text-white rounded-xl disabled:opacity-40 transition"
            style={{ backgroundColor: ACCENT }}
          >
            {generating ? 'Optimising route…' : `Generate Route for ${selected.size} Asset${selected.size !== 1 ? 's' : ''}`}
          </button>

          {/* Route result */}
          {route.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-200">
              <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100">
                <h2 className="text-sm font-bold text-gray-900">Optimised Route</h2>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>🛣️ ~{totalKm.toFixed(0)} km total</span>
                  <span>⏱️ ~{Math.ceil(totalKm / 50 * 60)} min drive</span>
                </div>
              </div>

              <div className="p-4 space-y-2">
                {/* Start */}
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">S</div>
                  <span className="text-xs text-gray-500">
                    Start: {startLat && startLng ? `${parseFloat(startLat).toFixed(4)}, ${parseFloat(startLng).toFixed(4)}` : 'Nairobi CBD'}
                  </span>
                </div>

                {route.map((asset, i) => {
                  const prevLat = i === 0 ? (parseFloat(startLat) || -1.2921) : route[i - 1].gps_lat!
                  const prevLng = i === 0 ? (parseFloat(startLng) || 36.8219) : route[i - 1].gps_lng!
                  const dist = asset.gps_lat && asset.gps_lng
                    ? haversineKm(prevLat, prevLng, asset.gps_lat, asset.gps_lng)
                    : 0

                  return (
                    <div key={asset.id}>
                      <div className="flex items-center gap-1 text-[10px] text-gray-300 ml-3 my-0.5">
                        <span>↓</span>
                        <span>{dist.toFixed(1)} km · ~{Math.ceil(dist / 50 * 60)} min</span>
                      </div>
                      <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${i % 2 === 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                             style={{ backgroundColor: ACCENT }}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-900 truncate">{asset.site_name}</div>
                          <div className="text-[11px] text-gray-400">{asset.physical_address} · {asset.kva_rating} KVA</div>
                        </div>
                        {asset.gps_lat && asset.gps_lng && (
                          <a
                            href={`https://www.google.com/maps?q=${asset.gps_lat},${asset.gps_lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-amber-600 hover:underline shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            Maps →
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="px-4 pb-4">
                {savedWorkOrder ? (
                  <div className="text-center py-2 text-sm text-green-700 font-semibold">
                    ✓ Work Order {savedWorkOrder.work_order_number} created
                  </div>
                ) : (
                  <button
                    onClick={handleSaveWorkOrder}
                    disabled={saving}
                    className="w-full py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-40 bg-gray-900 hover:bg-gray-800 transition"
                  >
                    {saving ? 'Creating Work Order…' : '+ Save as Work Order'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
