import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getMyWorkOrder, respondToWorkOrder, submitPreInspection,
} from '@/api/frameworkPortal'
import type { WorkOrderDetail, PreInspectionItem } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-blue-100 text-blue-700',
  en_route: 'bg-indigo-100 text-indigo-700',
  pre_inspection: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function FrameworkPortalWorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>()
  const navigate = useNavigate()

  const [wo, setWo] = useState<WorkOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'details' | 'pre_inspection'>('details')
  const [actioning, setActioning] = useState(false)
  const [error, setError] = useState('')

  // Pre-inspection form
  const [piDate, setPiDate] = useState(new Date().toISOString().slice(0, 10))
  const [piTech, setPiTech] = useState('')
  const [piNotes, setPiNotes] = useState('')
  const [piItems, setPiItems] = useState<PreInspectionItem[]>([{
    part_name: '', quantity: 1, estimated_unit_cost: 0,
  }])
  const [submittingPi, setSubmittingPi] = useState(false)

  useEffect(() => {
    if (!workOrderId) return
    getMyWorkOrder(workOrderId)
      .then(data => { setWo(data); setLoading(false) })
      .catch(() => { setError('Work order not found'); setLoading(false) })
  }, [workOrderId])

  async function handleAction(action: 'accept' | 'start' | 'complete') {
    if (!wo) return
    setError('')
    setActioning(true)
    try {
      const updated = await respondToWorkOrder(wo.id, action)
      setWo(prev => prev ? { ...prev, ...updated } : null)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setActioning(false)
    }
  }

  async function handleSubmitPi() {
    if (!wo) return
    const validItems = piItems.filter(i => i.part_name.trim())
    setError('')
    setSubmittingPi(true)
    try {
      const result = await submitPreInspection(wo.id, {
        inspection_date: piDate,
        technician_name: piTech,
        condition_notes: piNotes,
        items: validItems,
      })
      setWo(prev => prev ? { ...prev, status: result.status as any, has_pre_inspection: true } : null)
      setTab('details')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmittingPi(false)
    }
  }

  function addPiItem() {
    setPiItems(prev => [...prev, { part_name: '', quantity: 1, estimated_unit_cost: 0 }])
  }

  function updatePiItem(i: number, field: keyof PreInspectionItem, val: string | number) {
    setPiItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item))
  }

  function removePiItem(i: number) {
    setPiItems(prev => prev.filter((_, idx) => idx !== i))
  }

  const piTotal = piItems.reduce((s, i) => s + (i.quantity * i.estimated_unit_cost), 0)

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!wo) return (
    <div className="text-center py-20 px-4">
      <p className="text-sm text-gray-500">{error || 'Work order not found'}</p>
      <button onClick={() => navigate(-1)} className="mt-4 text-sm text-amber-600 font-medium">← Back</button>
    </div>
  )

  const canAccept = wo.status === 'assigned'
  const canStart = wo.status === 'en_route'
  const canComplete = wo.status === 'in_progress'
  const canSubmitPi = ['assigned', 'en_route', 'in_progress'].includes(wo.status) && !wo.has_pre_inspection

  return (
    <div className="max-w-lg mx-auto">
      {/* Back + header */}
      <div className="px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="text-xs text-amber-600 font-medium mb-3 flex items-center gap-1">
          ← Work Orders
        </button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">{wo.work_order_number}</div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">{wo.title}</h1>
          </div>
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${STATUS_COLORS[wo.status] || 'bg-gray-100 text-gray-600'}`}>
            {wo.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {error && <p className="mx-4 text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 mb-2">{error}</p>}

      {/* Action bar */}
      {(canAccept || canStart || canComplete) && (
        <div className="mx-4 mb-4 space-y-2">
          {canAccept && (
            <button
              onClick={() => handleAction('accept')}
              disabled={actioning}
              className="w-full py-3 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {actioning ? 'Updating…' : '✅ Accept — I\'m En Route'}
            </button>
          )}
          {canStart && (
            <button
              onClick={() => handleAction('start')}
              disabled={actioning}
              className="w-full py-3 text-sm font-semibold text-amber-700 border-2 border-amber-400 rounded-xl hover:bg-amber-50 disabled:opacity-50"
            >
              {actioning ? 'Updating…' : '🚀 Mark as In Progress'}
            </button>
          )}
          {canComplete && (
            <button
              onClick={() => handleAction('complete')}
              disabled={actioning}
              className="w-full py-3 text-sm font-semibold text-green-700 border-2 border-green-400 rounded-xl hover:bg-green-50 disabled:opacity-50"
            >
              {actioning ? 'Updating…' : '🏁 Mark as Completed'}
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-100 mx-4 mb-4">
        {(['details', 'pre_inspection'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
              tab === t ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-400'
            }`}
          >
            {t === 'details' ? 'Details' : 'Pre-Inspection'}
            {t === 'pre_inspection' && wo.has_pre_inspection && (
              <span className="ml-1 w-2 h-2 bg-purple-500 rounded-full inline-block" />
            )}
          </button>
        ))}
      </div>

      <div className="px-4 pb-6">
        {/* ── Details tab ── */}
        {tab === 'details' && (
          <div className="space-y-4">
            {/* Route stops */}
            <Section title="Route Stops">
              <div className="space-y-2">
                {wo.route_stops.length === 0 ? (
                  <p className="text-sm text-gray-400">No stops assigned</p>
                ) : (
                  wo.route_stops.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        s.status === 'completed' ? 'bg-green-100 text-green-700' :
                        s.status === 'skipped' ? 'bg-red-100 text-red-500' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {s.sequence}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{s.site_name}</div>
                        <div className="text-xs text-gray-400">{s.site_code}</div>
                      </div>
                      {s.gps_lat && s.gps_lng && (
                        <a
                          href={`https://maps.google.com/?q=${s.gps_lat},${s.gps_lng}`}
                          target="_blank" rel="noreferrer"
                          className="text-xs text-blue-500 shrink-0"
                        >
                          Maps 📍
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Section>

            {/* Dates */}
            <Section title="Timeline">
              <div className="grid grid-cols-2 gap-2">
                <InfoItem label="Planned Date" value={wo.planned_date} />
                <InfoItem label="Start Date" value={wo.start_date || '—'} />
                <InfoItem label="Completion" value={wo.completion_date || '—'} />
                <InfoItem label="Total Sites" value={String(wo.total_assets)} />
              </div>
            </Section>

            {/* Parts used */}
            {wo.parts_used && wo.parts_used.length > 0 && (
              <Section title="Parts Used">
                <div className="space-y-2">
                  {wo.parts_used.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium text-gray-800">{p.part_name}</div>
                        {p.part_number && <div className="text-xs text-gray-400">{p.part_number}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">{p.quantity} × KES {p.unit_cost.toLocaleString()}</div>
                        <div className="font-semibold text-gray-900">KES {p.total_cost.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Pre-inspection summary */}
            {wo.pre_inspection && (
              <Section title="Pre-Inspection Summary">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Status</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      wo.pre_inspection.status === 'approved' ? 'bg-green-100 text-green-700' :
                      wo.pre_inspection.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>{wo.pre_inspection.status}</span>
                  </div>
                  <InfoItem label="Estimated Total" value={`KES ${wo.pre_inspection.estimated_total.toLocaleString()}`} />
                  <InfoItem label="Technician" value={wo.pre_inspection.technician_name} />
                  {wo.pre_inspection.condition_notes && (
                    <InfoItem label="Condition Notes" value={wo.pre_inspection.condition_notes} />
                  )}
                  {wo.pre_inspection.approval_notes && (
                    <InfoItem label="Approval Notes" value={wo.pre_inspection.approval_notes} />
                  )}
                </div>
              </Section>
            )}

            {wo.report_notes && (
              <Section title="Report Notes">
                <p className="text-sm text-gray-700">{wo.report_notes}</p>
              </Section>
            )}
          </div>
        )}

        {/* ── Pre-inspection tab ── */}
        {tab === 'pre_inspection' && (
          <div className="space-y-4">
            {wo.has_pre_inspection && wo.pre_inspection ? (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
                <div className="font-semibold text-purple-800 text-sm mb-3">Pre-Inspection Submitted</div>
                <div className="space-y-2">
                  {wo.pre_inspection.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-white rounded-xl px-3 py-2 border border-purple-100">
                      <div>
                        <div className="font-medium text-gray-900">{item.part_name}</div>
                        {item.part_number && <div className="text-xs text-gray-400">#{item.part_number}</div>}
                        {item.notes && <div className="text-xs text-gray-400">{item.notes}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Qty {item.quantity}</div>
                        <div className="font-semibold text-gray-900">KES {item.estimated_total_cost.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t border-purple-100 font-bold text-sm text-purple-800">
                    <span>Total Estimate</span>
                    <span>KES {wo.pre_inspection.estimated_total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : canSubmitPi ? (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">List the spare parts and materials required for this job. These will be sent to the client for purchase approval.</p>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Inspection Date</label>
                  <input type="date" value={piDate} onChange={e => setPiDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Technician Name *</label>
                  <input value={piTech} onChange={e => setPiTech(e.target.value)} placeholder="Lead technician"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Condition Notes *</label>
                  <textarea value={piNotes} onChange={e => setPiNotes(e.target.value)} rows={3}
                    placeholder="Describe the current condition of the equipment…"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700">Required Parts / Materials</label>
                    <button onClick={addPiItem} className="text-xs font-medium text-amber-600 border border-amber-300 px-2 py-1 rounded-lg hover:bg-amber-50">
                      + Add Item
                    </button>
                  </div>
                  <div className="space-y-3">
                    {piItems.map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={item.part_name}
                            onChange={e => updatePiItem(i, 'part_name', e.target.value)}
                            placeholder="Part name *"
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                          />
                          {piItems.length > 1 && (
                            <button onClick={() => removePiItem(i)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500">Part No.</label>
                            <input value={item.part_number || ''} onChange={e => updatePiItem(i, 'part_number', e.target.value)}
                              placeholder="Optional"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">Qty</label>
                            <input type="number" min={1} value={item.quantity}
                              onChange={e => updatePiItem(i, 'quantity', parseFloat(e.target.value) || 1)}
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">Unit Cost (KES)</label>
                            <input type="number" min={0} value={item.estimated_unit_cost}
                              onChange={e => updatePiItem(i, 'estimated_unit_cost', parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          </div>
                        </div>
                        <input value={item.notes || ''} onChange={e => updatePiItem(i, 'notes', e.target.value)}
                          placeholder="Notes (optional)"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                        <div className="text-right text-xs font-semibold text-gray-700">
                          Total: KES {(item.quantity * item.estimated_unit_cost).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Total */}
                <div className="flex justify-between items-center bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-amber-800">Estimated Total</span>
                  <span className="text-lg font-bold text-amber-700">KES {piTotal.toLocaleString()}</span>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

                <button
                  onClick={handleSubmitPi}
                  disabled={submittingPi || !piTech.trim() || !piNotes.trim()}
                  className="w-full py-3 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {submittingPi ? 'Submitting…' : '📋 Submit Pre-Inspection'}
                </button>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-sm text-gray-500">
                  {wo.status === 'completed' || wo.status === 'signed_off'
                    ? 'Pre-inspection was not submitted for this work order.'
                    : 'Accept the work order first to submit a pre-inspection.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="bg-white rounded-2xl border border-gray-100 p-4">{children}</div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 uppercase">{label}</div>
      <div className="text-sm text-gray-800 font-medium">{value}</div>
    </div>
  )
}
