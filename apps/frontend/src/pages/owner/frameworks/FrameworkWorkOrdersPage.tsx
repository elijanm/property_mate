import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listWorkOrders, createWorkOrder, updateWorkOrder, listFrameworkAssets, submitPreInspection, reviewPreInspection } from '@/api/frameworks'
import type { WorkOrder, FrameworkAsset } from '@/types/framework'
import { SERVICE_TYPE_LABELS, KVA_RANGES } from '@/types/framework'
import { extractApiError } from '@/utils/apiError'
import type { PreInspectionItemPayload } from '@/api/frameworks'

const ACCENT = '#D97706'

const STATUS_COLORS: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-600',
  assigned:         'bg-blue-100 text-blue-700',
  en_route:         'bg-indigo-100 text-indigo-700',
  pre_inspection:   'bg-purple-100 text-purple-700',
  pending_approval: 'bg-orange-100 text-orange-700',
  in_progress:      'bg-yellow-100 text-yellow-700',
  completed:        'bg-green-100 text-green-700',
  signed_off:       'bg-emerald-100 text-emerald-800',
  cancelled:        'bg-gray-50 text-gray-400',
}

// Status advance flow — pre_inspection and pending_approval are managed via
// dedicated pre-inspection submit/approve actions, not the generic advance button
const STATUS_FLOW: Record<string, string> = {
  draft:       'assigned',
  assigned:    'en_route',
  en_route:    'pre_inspection',
  in_progress: 'completed',
  completed:   'signed_off',
}

const STATUS_LABELS: Record<string, string> = {
  draft:            'Draft',
  assigned:         'Assigned',
  en_route:         'En Route',
  pre_inspection:   'Pre-Inspection',
  pending_approval: 'Pending Approval',
  in_progress:      'In Progress',
  completed:        'Completed',
  signed_off:       'Signed Off',
  cancelled:        'Cancelled',
}

export default function FrameworkWorkOrdersPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [selected, setSelected] = useState<WorkOrder | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    if (!frameworkId) return
    setLoading(true)
    try {
      const res = await listWorkOrders(frameworkId, { status: filterStatus, page })
      const items = res.items ?? (res as unknown as WorkOrder[])
      setWorkOrders(items)
      setTotal(res.total ?? items.length)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [frameworkId, filterStatus, page])

  async function advanceStatus(wo: WorkOrder) {
    const next = STATUS_FLOW[wo.status]
    if (!next || !frameworkId) return
    try {
      const updated = await updateWorkOrder(frameworkId, wo.id, { status: next as WorkOrder['status'] })
      setWorkOrders(p => p.map(w => w.id === wo.id ? updated : w))
      if (selected?.id === wo.id) setSelected(updated)
    } catch { /* handled by interceptor */ }
  }

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} work orders</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: ACCENT }}
        >
          + New Work Order
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {['', 'draft', 'assigned', 'en_route', 'pre_inspection', 'pending_approval', 'in_progress', 'completed', 'signed_off'].map(s => (
          <button
            key={s}
            onClick={() => { setFilterStatus(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              filterStatus === s ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={filterStatus === s ? { backgroundColor: ACCENT } : {}}
          >
            {s === '' ? 'All' : (STATUS_LABELS[s] ?? s)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : workOrders.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-4xl mb-3">🔧</div>
          <p className="text-sm font-semibold text-gray-700">No work orders yet</p>
          <p className="text-xs text-gray-400 mt-1">Create a work order to dispatch technicians to site.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workOrders.map(wo => (
            <div
              key={wo.id}
              onClick={() => setSelected(wo)}
              className="bg-white rounded-xl border border-gray-200 hover:border-amber-300 hover:shadow-sm cursor-pointer transition-all p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-bold text-gray-900">{wo.work_order_number}</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[wo.status]}`}>
                      {STATUS_LABELS[wo.status] ?? wo.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{wo.title}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>🔧 {SERVICE_TYPE_LABELS[wo.service_type]}</span>
                    <span>⚡ {wo.total_assets} asset{wo.total_assets !== 1 ? 's' : ''}</span>
                    {wo.assigned_vendor_name && <span>👷 {wo.assigned_vendor_name}</span>}
                    <span>📅 {new Date(wo.planned_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {wo.total_cost != null && (
                    <span className="text-sm font-semibold text-gray-700">
                      KES {wo.total_cost.toLocaleString()}
                    </span>
                  )}
                  {STATUS_FLOW[wo.status] && (
                    <button
                      onClick={e => { e.stopPropagation(); advanceStatus(wo) }}
                      className="px-3 py-1 text-xs font-semibold text-white rounded-lg"
                      style={{ backgroundColor: ACCENT }}
                    >
                      Mark {STATUS_FLOW[wo.status].replace('_', ' ')} →
                    </button>
                  )}
                </div>
              </div>

              {/* Route stops preview */}
              {(wo.route_stops?.length ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-1.5 overflow-hidden">
                  {wo.route_stops.slice(0, 6).map((stop, i) => (
                    <span key={i} className="flex items-center gap-1 text-xs text-gray-500">
                      {i > 0 && <span className="text-gray-300">→</span>}
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                        stop.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'
                      }`}>{stop.sequence}</span>
                      <span className="truncate max-w-[80px]">{stop.site_name}</span>
                    </span>
                  ))}
                  {wo.route_stops.length > 6 && (
                    <span className="text-xs text-gray-400">+{wo.route_stops.length - 6} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 20 && (
        <div className="flex justify-between items-center mt-4">
          <span className="text-xs text-gray-500">Page {page}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">‹ Prev</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-sm border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50">Next ›</button>
          </div>
        </div>
      )}

      {selected && (
        <WorkOrderDetailSlideOver
          wo={selected}
          frameworkId={frameworkId!}
          onClose={() => setSelected(null)}
          onAdvance={() => advanceStatus(selected)}
          onUpdated={updated => {
            setWorkOrders(p => p.map(w => w.id === updated.id ? updated : w))
            setSelected(updated)
          }}
        />
      )}

      {showCreate && (
        <CreateWorkOrderModal
          frameworkId={frameworkId!}
          onClose={() => setShowCreate(false)}
          onCreated={(wo) => { setWorkOrders(p => [wo, ...p]); setTotal(t => t + 1); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function WorkOrderDetailSlideOver({ wo, onClose, onAdvance, onUpdated, frameworkId }: {
  wo: WorkOrder
  frameworkId: string
  onClose: () => void
  onAdvance: () => void
  onUpdated: (wo: WorkOrder) => void
}) {
  const next = STATUS_FLOW[wo.status]
  const [tab, setTab] = useState<'details' | 'pre-inspection'>('details')
  const [showPreInspForm, setShowPreInspForm] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [approveNotes, setApproveNotes] = useState('')

  async function handleApprove(approved: boolean) {
    setReviewing(true)
    try {
      const updated = await reviewPreInspection(frameworkId, wo.id, approved, approveNotes || undefined)
      onUpdated(updated)
      setApproveNotes('')
    } catch { /* interceptor handles */ } finally {
      setReviewing(false)
    }
  }

  const pi = wo.pre_inspection
  const INSP_STATUS_STYLE = {
    submitted: 'bg-orange-100 text-orange-700',
    approved:  'bg-green-100 text-green-700',
    rejected:  'bg-red-100 text-red-700',
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{wo.work_order_number}</h2>
            <p className="text-xs text-gray-400">{wo.title}</p>
          </div>
          <div className="flex items-center gap-2">
            {next && (
              <button onClick={onAdvance} className="px-3 py-1 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
                → {STATUS_LABELS[next]}
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 shrink-0">
          {(['details', 'pre-inspection'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${
                tab === t ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t === 'pre-inspection' ? (
                <span className="flex items-center gap-1.5">
                  Pre-Inspection
                  {pi && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${INSP_STATUS_STYLE[pi.status]}`}>
                      {pi.status}
                    </span>
                  )}
                </span>
              ) : 'Details'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {tab === 'details' && (
            <>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[wo.status]}`}>
                  {STATUS_LABELS[wo.status] ?? wo.status}
                </span>
                <span className="text-xs text-gray-500">{SERVICE_TYPE_LABELS[wo.service_type]}</span>
              </div>

              <DetailSection title="Details">
                <DetailRow label="Planned Date" value={new Date(wo.planned_date).toLocaleDateString('en-GB')} />
                {wo.start_date && <DetailRow label="Started" value={new Date(wo.start_date).toLocaleDateString('en-GB')} />}
                {wo.completion_date && <DetailRow label="Completed" value={new Date(wo.completion_date).toLocaleDateString('en-GB')} />}
                <DetailRow label="Service Provider" value={wo.assigned_vendor_name ?? 'Unassigned'} />
                {(wo.technician_names?.length ?? 0) > 0 && <DetailRow label="Technicians" value={wo.technician_names!.join(', ')} />}
                <DetailRow label="Total Assets" value={String(wo.total_assets)} />
              </DetailSection>

              {(wo.route_stops?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Route Stops</p>
                  <div className="space-y-2">
                    {wo.route_stops.map(stop => (
                      <div key={stop.sequence} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${stop.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'}`}>{stop.sequence}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-900 truncate">{stop.site_name}</div>
                          <div className="text-[11px] text-gray-400 truncate">{stop.physical_address}</div>
                        </div>
                        <span className="text-[10px] text-gray-500 capitalize">{stop.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(wo.parts_used?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Parts Used</p>
                  <div className="bg-gray-50 rounded-lg divide-y divide-gray-100">
                    {wo.parts_used.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <div className="text-xs font-medium text-gray-900">{p.part_name}</div>
                          {p.part_number && <div className="text-[10px] text-gray-400">P/N: {p.part_number}</div>}
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-gray-700">KES {p.total_cost.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-400">×{p.quantity} @ {p.unit_cost.toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(wo.labor_hours != null || wo.transport_cost != null || wo.accommodation_cost != null || wo.total_cost != null) && (
                <DetailSection title="Costs">
                  {wo.labor_hours != null && <DetailRow label="Labour Hours" value={`${wo.labor_hours} hrs`} />}
                  {wo.transport_cost != null && <DetailRow label="Transport" value={`KES ${wo.transport_cost.toLocaleString()}`} />}
                  {wo.accommodation_cost != null && <DetailRow label="Accommodation" value={`KES ${wo.accommodation_cost.toLocaleString()}`} />}
                  {wo.total_cost != null && <DetailRow label="Total Cost" value={`KES ${wo.total_cost.toLocaleString()}`} />}
                </DetailSection>
              )}

              {wo.report_notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Report Notes</p>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{wo.report_notes}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Technician Signature', key: wo.technician_signature_url },
                  { label: 'Client Sign-off', key: wo.client_signature_url },
                ].map(sig => (
                  <div key={sig.label} className="border border-dashed border-gray-200 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-gray-400 mb-1">{sig.label}</p>
                    {sig.key ? <div className="text-xs text-green-600 font-semibold">✓ Signed</div> : <div className="text-xs text-gray-300">Pending</div>}
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'pre-inspection' && (
            <div className="space-y-4">
              {!pi ? (
                /* No pre-inspection yet */
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
                  <div className="text-3xl mb-2">🔍</div>
                  <p className="text-sm font-semibold text-gray-700">No pre-inspection yet</p>
                  <p className="text-xs text-gray-400 mt-1 mb-4">Submit a pre-inspection to assess site condition and required spare parts.</p>
                  {(wo.status === 'en_route' || wo.status === 'pre_inspection') && (
                    <button onClick={() => setShowPreInspForm(true)}
                      className="px-4 py-2 text-sm font-semibold text-white rounded-lg"
                      style={{ backgroundColor: ACCENT }}>
                      + Submit Pre-Inspection
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Pre-inspection summary */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${INSP_STATUS_STYLE[pi.status]}`}>
                        {pi.status.charAt(0).toUpperCase() + pi.status.slice(1)}
                      </span>
                      <span className="text-xs text-gray-500">by {pi.technician_name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{new Date(pi.inspection_date).toLocaleDateString('en-GB')}</span>
                  </div>

                  {pi.status === 'rejected' && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Rejected — re-inspection required</p>
                      {pi.approval_notes && <p className="text-xs text-red-600">{pi.approval_notes}</p>}
                    </div>
                  )}

                  {pi.status === 'approved' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-green-700 mb-0.5">✓ Approved — work in progress</p>
                      {pi.approval_notes && <p className="text-xs text-green-600">{pi.approval_notes}</p>}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Condition Assessment</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{pi.condition_notes}</p>
                  </div>

                  {pi.items.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Required Parts</p>
                        <span className="text-xs font-bold text-gray-700">
                          Est. KES {pi.estimated_total.toLocaleString()}
                        </span>
                      </div>
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                        {pi.items.map(item => (
                          <div key={item.id} className="flex items-center justify-between px-3 py-2.5">
                            <div>
                              <div className="text-xs font-medium text-gray-900">{item.part_name}</div>
                              <div className="text-[10px] text-gray-400">
                                {item.part_number && `P/N: ${item.part_number} · `}
                                {item.kva_range && `${item.kva_range} KVA · `}
                                ×{item.quantity}
                              </div>
                              {item.notes && <div className="text-[10px] text-gray-400 italic mt-0.5">{item.notes}</div>}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-semibold text-gray-700">KES {item.estimated_total_cost.toLocaleString()}</div>
                              <div className="text-[10px] text-gray-400">@ {item.estimated_unit_cost.toLocaleString()}/unit</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Approval panel — only for pending_approval status */}
                  {wo.status === 'pending_approval' && pi.status === 'submitted' && (
                    <div className="border border-orange-200 rounded-xl bg-orange-50 p-4 space-y-3">
                      <p className="text-xs font-bold text-orange-800">Awaiting your approval to proceed</p>
                      <p className="text-xs text-orange-700">Review the required parts list above, then approve to start maintenance or reject to request a re-inspection.</p>
                      <textarea
                        rows={2}
                        value={approveNotes}
                        onChange={e => setApproveNotes(e.target.value)}
                        placeholder="Approval / rejection notes (optional)…"
                        className="w-full border border-orange-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(true)}
                          disabled={reviewing}
                          className="flex-1 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          {reviewing ? '…' : '✓ Approve & Start Work'}
                        </button>
                        <button
                          onClick={() => handleApprove(false)}
                          disabled={reviewing}
                          className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50"
                        >
                          {reviewing ? '…' : '✕ Reject'}
                        </button>
                      </div>
                    </div>
                  )}

                  {(wo.status === 'pre_inspection' || pi.status === 'rejected') && (
                    <button onClick={() => setShowPreInspForm(true)}
                      className="w-full py-2 text-sm font-semibold text-white rounded-lg"
                      style={{ backgroundColor: ACCENT }}>
                      Re-submit Pre-Inspection
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showPreInspForm && (
        <PreInspectionModal
          frameworkId={frameworkId}
          workOrderId={wo.id}
          onClose={() => setShowPreInspForm(false)}
          onSubmitted={updated => { onUpdated(updated); setShowPreInspForm(false); setTab('pre-inspection') }}
        />
      )}
    </div>
  )
}

function CreateWorkOrderModal({ frameworkId, onClose, onCreated }: {
  frameworkId: string
  onClose: () => void
  onCreated: (wo: WorkOrder) => void
}) {
  const [form, setForm] = useState({
    title: '',
    service_type: 'biannual_a' as WorkOrder['service_type'],
    planned_date: '',
    assigned_vendor_name: '',
    report_notes: '',
  })
  const [assets, setAssets] = useState<FrameworkAsset[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [assetSearch, setAssetSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listFrameworkAssets(frameworkId, { page: 1 }).then(r => setAssets(r.items ?? []))
  }, [frameworkId])

  function toggleAsset(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredAssets = assets.filter(a =>
    !assetSearch ||
    a.site_name.toLowerCase().includes(assetSearch.toLowerCase()) ||
    a.site_code.toLowerCase().includes(assetSearch.toLowerCase()) ||
    a.region.toLowerCase().includes(assetSearch.toLowerCase())
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // Build route stops in order of selection
      const selected = assets.filter(a => selectedIds.has(a.id))
      const route_stops = selected.map((a, i) => ({
        sequence: i + 1,
        asset_id: a.id,
        site_name: a.site_name,
        site_code: a.site_code,
        physical_address: a.physical_address ?? '',
        gps_lat: a.gps_lat,
        gps_lng: a.gps_lng,
        status: 'pending' as const,
      }))

      const wo = await createWorkOrder(frameworkId, {
        ...form,
        status: 'draft',
        route_stops,
        parts_used: [],
        total_assets: route_stops.length,
      })
      onCreated(wo)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">New Work Order</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 p-6 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Title *</label>
              <input required value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="PPM-A Nairobi Central Sites"
                className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Service Type *</label>
                <select required value={form.service_type}
                  onChange={e => setForm(p => ({ ...p, service_type: e.target.value as typeof form.service_type }))}
                  className={inputCls}>
                  {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Planned Date *</label>
                <input required type="date" value={form.planned_date}
                  onChange={e => setForm(p => ({ ...p, planned_date: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Service Provider</label>
              <input value={form.assigned_vendor_name}
                onChange={e => setForm(p => ({ ...p, assigned_vendor_name: e.target.value }))}
                placeholder="Vendor name"
                className={inputCls} />
            </div>

            {/* ── Asset selection ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-700">
                  Associated Assets
                  {selectedIds.size > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-white text-[10px]" style={{ backgroundColor: ACCENT }}>
                      {selectedIds.size} selected
                    </span>
                  )}
                </label>
                {selectedIds.size > 0 && (
                  <button type="button" onClick={() => setSelectedIds(new Set())}
                    className="text-[11px] text-gray-400 hover:text-gray-600">
                    Clear all
                  </button>
                )}
              </div>

              <input
                value={assetSearch}
                onChange={e => setAssetSearch(e.target.value)}
                placeholder="Search assets by site name, code or region…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />

              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
                {filteredAssets.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">
                    {assets.length === 0 ? 'No assets in this contract yet' : 'No assets match your search'}
                  </p>
                ) : (
                  filteredAssets.map(a => {
                    const checked = selectedIds.has(a.id)
                    return (
                      <label
                        key={a.id}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAsset(a.id)}
                          className="accent-amber-500 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-900 truncate">{a.site_name}</div>
                          <div className="text-[10px] text-gray-400">{a.site_code} · {a.region} · {a.kva_rating} KVA</div>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded capitalize shrink-0 ${
                          a.operational_status === 'operational' ? 'bg-green-100 text-green-700' :
                          a.operational_status === 'fault' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {a.operational_status.replace('_', ' ')}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>

              {/* Selected assets ordered preview */}
              {selectedIds.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {assets.filter(a => selectedIds.has(a.id)).map((a, i) => (
                    <span key={a.id} className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
                      <span className="font-bold">{i + 1}.</span>
                      {a.site_name}
                      <button type="button" onClick={() => toggleAsset(a.id)} className="ml-0.5 text-amber-400 hover:text-amber-700">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Notes</label>
              <textarea rows={2} value={form.report_notes}
                onChange={e => setForm(p => ({ ...p, report_notes: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                placeholder="Special instructions…" />
            </div>
          </div>

          <div className="flex justify-between items-center gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <span className="text-xs text-gray-400">
              {selectedIds.size} asset{selectedIds.size !== 1 ? 's' : ''} · {selectedIds.size} route stop{selectedIds.size !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}>
                {saving ? 'Creating…' : 'Create Work Order'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Pre-Inspection Modal ──────────────────────────────────────────────────────

function PreInspectionModal({ frameworkId, workOrderId, onClose, onSubmitted }: {
  frameworkId: string
  workOrderId: string
  onClose: () => void
  onSubmitted: (wo: WorkOrder) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    inspection_date: today,
    technician_name: '',
    condition_notes: '',
  })
  const [items, setItems] = useState<PreInspectionItemPayload[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addItem() {
    setItems(p => [...p, { part_name: '', quantity: 1, estimated_unit_cost: 0 }])
  }
  function removeItem(i: number) {
    setItems(p => p.filter((_, idx) => idx !== i))
  }
  function updateItem(i: number, patch: Partial<PreInspectionItemPayload>) {
    setItems(p => p.map((item, idx) => idx === i ? { ...item, ...patch } : item))
  }

  const estimatedTotal = items.reduce((s, it) => s + it.quantity * it.estimated_unit_cost, 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const updated = await submitPreInspection(frameworkId, workOrderId, { ...form, items })
      onSubmitted(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Pre-Inspection Report</h2>
            <p className="text-xs text-gray-400">Assess site condition and list required spare parts before starting work</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 p-6 space-y-5">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Inspection Date *</label>
                <input required type="date" value={form.inspection_date}
                  onChange={e => setForm(p => ({ ...p, inspection_date: e.target.value }))}
                  className={`w-full ${inp}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Technician Name *</label>
                <input required value={form.technician_name}
                  onChange={e => setForm(p => ({ ...p, technician_name: e.target.value }))}
                  placeholder="John Kamau"
                  className={`w-full ${inp}`} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Condition Assessment *</label>
              <textarea required rows={3} value={form.condition_notes}
                onChange={e => setForm(p => ({ ...p, condition_notes: e.target.value }))}
                placeholder="Describe the current condition of the equipment — oil levels, battery state, fuel, visible damage, runtime hours observed…"
                className={`w-full ${inp} resize-none`} />
            </div>

            {/* Parts list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Required Spare Parts</p>
                  <p className="text-[10px] text-gray-400">List parts needed to complete the maintenance</p>
                </div>
                {estimatedTotal > 0 && (
                  <span className="text-sm font-bold text-gray-900">KES {estimatedTotal.toLocaleString()}</span>
                )}
              </div>

              {items.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl py-5 text-center text-xs text-gray-400">
                  No parts added yet — click below to add required items
                </div>
              ) : (
                <div className="space-y-2 mb-2">
                  {items.map((item, i) => (
                    <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
                      <div className="grid grid-cols-[1fr_80px_100px_80px_24px] gap-2 items-start">
                        <div>
                          <input required value={item.part_name}
                            onChange={e => updateItem(i, { part_name: e.target.value })}
                            placeholder="Part name *"
                            className={`w-full ${inp} text-xs`} />
                        </div>
                        <input value={item.part_number ?? ''}
                          onChange={e => updateItem(i, { part_number: e.target.value || undefined })}
                          placeholder="P/N"
                          className={`w-full ${inp} text-xs`} />
                        <select value={item.kva_range ?? ''}
                          onChange={e => updateItem(i, { kva_range: e.target.value || undefined })}
                          className={`w-full ${inp} text-xs`}>
                          <option value="">KVA range</option>
                          {KVA_RANGES.map(r => <option key={r} value={r}>{r} KVA</option>)}
                        </select>
                        <input required type="number" min={1} step={0.5} value={item.quantity}
                          onChange={e => updateItem(i, { quantity: Number(e.target.value) })}
                          placeholder="Qty"
                          className={`w-full ${inp} text-xs`} />
                        <button type="button" onClick={() => removeItem(i)}
                          className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-500 text-lg leading-none mt-1">✕</button>
                      </div>
                      <div className="grid grid-cols-[1fr_120px] gap-2 items-center">
                        <input value={item.notes ?? ''}
                          onChange={e => updateItem(i, { notes: e.target.value || undefined })}
                          placeholder="Notes about this part…"
                          className={`w-full ${inp} text-xs`} />
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">Unit cost KES</span>
                          <input required type="number" min={0} step={100} value={item.estimated_unit_cost}
                            onChange={e => updateItem(i, { estimated_unit_cost: Number(e.target.value) })}
                            className={`w-full ${inp} text-xs text-right`} />
                        </div>
                      </div>
                      {item.quantity > 0 && item.estimated_unit_cost > 0 && (
                        <p className="text-[10px] text-right text-amber-700 font-semibold">
                          Subtotal: KES {(item.quantity * item.estimated_unit_cost).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={addItem}
                className="w-full py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-amber-400 hover:text-amber-600 transition">
                + Add Spare Part
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center px-6 py-4 border-t border-gray-100 shrink-0">
            <span className="text-xs text-gray-400">
              {items.length} part{items.length !== 1 ? 's' : ''} · Est. KES {estimatedTotal.toLocaleString()}
            </span>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}>
                {saving ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="bg-gray-50 rounded-lg divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-900">{value}</span>
    </div>
  )
}
