import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { verifyBadge } from '@/api/frameworkPortal'
import type { BadgeVerification } from '@/api/frameworkPortal'

const ACCENT = '#D97706'

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  active:         { label: 'Active Contractor', color: 'bg-green-100 text-green-800 border-green-200', icon: '✅' },
  pending_review: { label: 'Pending Approval',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: '⏳' },
  suspended:      { label: 'Suspended',          color: 'bg-red-100 text-red-800 border-red-200',    icon: '🚫' },
  invited:        { label: 'Not Yet Activated',  color: 'bg-gray-100 text-gray-600 border-gray-200', icon: '📨' },
}

const WO_STATUS: Record<string, string> = {
  assigned:    'bg-blue-100 text-blue-700',
  en_route:    'bg-purple-100 text-purple-700',
  in_progress: 'bg-amber-100 text-amber-700',
}

export default function FrameworkPortalVerifyPage() {
  const { vendorId } = useParams<{ vendorId: string }>()
  const [data, setData] = useState<BadgeVerification | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!vendorId) return
    verifyBadge(vendorId)
      .then(setData)
      .catch(() => setError('Badge not found or invalid QR code.'))
      .finally(() => setLoading(false))
  }, [vendorId])

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-4">❌</div>
      <h1 className="text-lg font-bold text-gray-900 mb-2">Invalid Badge</h1>
      <p className="text-sm text-gray-500">{error || 'Could not verify this badge.'}</p>
    </div>
  )

  const statusMeta = STATUS_MAP[data.status] || STATUS_MAP.invited
  const isValid = data.valid

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-sm space-y-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-2" style={{ backgroundColor: ACCENT }}>
            🪪
          </div>
          <h1 className="text-lg font-bold text-gray-900">Contractor Verification</h1>
          <p className="text-xs text-gray-500">{data.org_name}</p>
        </div>

        {/* Validity banner */}
        <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${statusMeta.color}`}>
          <span className="text-2xl">{statusMeta.icon}</span>
          <div>
            <div className="font-bold text-sm">{statusMeta.label}</div>
            <div className="text-xs opacity-80">{isValid ? 'This badge is authentic and active.' : 'This badge is not currently valid.'}</div>
          </div>
        </div>

        {/* Identity card */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          {/* Photo + name */}
          <div className="flex items-center gap-4 p-4" style={{ background: '#FFFBEB' }}>
            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-amber-300 shrink-0">
              {data.selfie_url ? (
                <img src={data.selfie_url} alt={data.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl bg-amber-100">👷</div>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 truncate">{data.name}</h2>
              <p className="text-sm text-gray-600 truncate">{data.company}</p>
              <p className="text-xs text-gray-400 mt-0.5">{data.specialization}</p>
              <div className="mt-1">
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {data.badge_no}
                </span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="divide-y divide-gray-50 px-4">
            <Row label="Framework" value={data.framework_name} />
            <Row label="Authorised By" value={data.org_name} />
            <Row label="Valid Until" value={data.contract_end || '—'} />
          </div>

          {/* Sites */}
          {data.site_codes.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-50">
              <p className="text-xs text-gray-400 mb-1.5">AUTHORISED SITES</p>
              <div className="flex flex-wrap gap-1">
                {data.site_codes.map(sc => (
                  <span key={sc} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                    {sc}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Active work orders */}
        {data.active_work_orders.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Active Assignments</h3>
            <div className="space-y-2">
              {data.active_work_orders.map(wo => (
                <div key={wo.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-gray-700 truncate">{wo.title}</span>
                    </div>
                    <div className="text-[10px] text-gray-400">{wo.work_order_number} · {wo.planned_date}</div>
                    {wo.sites.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wo.sites.map(s => (
                          <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${WO_STATUS[wo.status] || 'bg-gray-100 text-gray-500'}`}>
                    {wo.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.active_work_orders.length === 0 && isValid && (
          <div className="text-center py-4 text-sm text-gray-400">No active assignments at this time.</div>
        )}

        <p className="text-center text-[10px] text-gray-300 pb-4">
          Verified · {new Date().toLocaleString()} · {data.org_name}
        </p>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs font-semibold text-gray-800 text-right max-w-[60%] truncate">{value}</span>
    </div>
  )
}
