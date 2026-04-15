import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  listInvitedVendors, inviteVendor, reinviteVendor, removeInvitedVendor,
} from '@/api/frameworks'
import type { InvitedVendor, InviteVendorPayload } from '@/api/frameworks'
import { updateVendorStatus } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'

const ACCENT = '#D97706'

interface Vendor {
  id: string
  name: string
  contact_name: string
  phone: string
  email: string
  specialization: string
  regions: string[]
  active_work_orders: number
  rating?: number
  status: 'approved' | 'pending' | 'suspended'
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
}

export default function FrameworkVendorsPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [vendors] = useState<Vendor[]>([])
  const [invited, setInvited] = useState<InvitedVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'approved' | 'invited'>('approved')
  const [showInvite, setShowInvite] = useState(false)
  const [reinvitingId, setReinvitingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  useEffect(() => {
    if (!frameworkId) return
    listInvitedVendors(frameworkId).then(d => { setInvited(d); setLoading(false) })
  }, [frameworkId])

  async function handleInvited(payload: InviteVendorPayload) {
    if (!frameworkId) return
    const member = await inviteVendor(frameworkId, payload)
    setInvited(prev => [member, ...prev])
    setTab('invited')
  }

  async function handleReinvite(id: string) {
    if (!frameworkId) return
    setReinvitingId(id)
    try {
      const updated = await reinviteVendor(frameworkId, id)
      setInvited(prev => prev.map(m => m.id === id ? updated : m))
    } finally {
      setTimeout(() => setReinvitingId(null), 1500)
    }
  }

  async function handleRemove(id: string) {
    if (!frameworkId) return
    setRemovingId(id)
    try {
      await removeInvitedVendor(frameworkId, id)
      setInvited(prev => prev.filter(m => m.id !== id))
    } finally {
      setRemovingId(null)
    }
  }

  async function handleApprove(id: string) {
    setApprovingId(id)
    try {
      await updateVendorStatus(id, 'active')
      setInvited(prev => prev.map(m => m.id === id ? { ...m, status: 'active' } : m))
    } finally {
      setTimeout(() => setApprovingId(null), 1500)
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Service Providers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Approved vendors and technicians for this framework contract</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: ACCENT }}
        >
          + Invite Vendor
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Approved Vendors', value: vendors.filter(v => v.status === 'approved').length, icon: '✅' },
          { label: 'Invited (pending)', value: invited.length, icon: '📨' },
          { label: 'Active Work Orders', value: vendors.reduce((s, v) => s + v.active_work_orders, 0), icon: '🔧' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-lg mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {([
          { key: 'approved', label: 'Approved Vendors', count: vendors.length },
          { key: 'invited', label: 'Invited Members', count: invited.length },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Approved Vendors */}
      {tab === 'approved' && (
        vendors.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
            <div className="text-5xl mb-4">👷</div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No approved vendors yet</h3>
            <p className="text-sm text-gray-500 mb-6">Invite vendors — once approved they'll appear here.</p>
            <button onClick={() => setShowInvite(true)} className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
              Invite Vendor
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {vendors.map(v => (
              <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-amber-300 transition">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-lg">👷</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-900">{v.name}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[v.status]}`}>{v.status}</span>
                      </div>
                      <p className="text-xs text-gray-500">{v.contact_name} · {v.phone}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{v.specialization} · {v.regions.join(', ')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">{v.active_work_orders}</div>
                    <div className="text-xs text-gray-400">Active WOs</div>
                    {v.rating !== undefined && <div className="text-xs font-semibold text-amber-600 mt-0.5">★ {v.rating.toFixed(1)}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Invited Members */}
      {tab === 'invited' && (
        loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : invited.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
            <div className="text-5xl mb-4">📨</div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No invitations yet</h3>
            <p className="text-sm text-gray-500 mb-6">Invited vendors will appear here.</p>
            <button onClick={() => setShowInvite(true)} className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
              Invite Vendor
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">KYC</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Invited</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invited.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50 group">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{m.name}</div>
                      {m.specialization && <div className="text-[10px] text-gray-400 mt-0.5">{m.specialization}</div>}
                      {m.site_codes && m.site_codes.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {m.site_codes.slice(0, 3).map(sc => (
                            <span key={sc} className="text-[9px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded">{sc}</span>
                          ))}
                          {m.site_codes.length > 3 && <span className="text-[9px] text-gray-400">+{m.site_codes.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {m.contact_name}<br />
                      <span className="text-gray-400">{m.mobile || m.phone || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{m.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        m.status === 'active' ? 'bg-green-100 text-green-700' :
                        m.status === 'pending_review' ? 'bg-yellow-100 text-yellow-700' :
                        m.status === 'suspended' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>{m.status?.replace('_', ' ') || 'invited'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {m.activated_at ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-green-600 font-medium">✓ Activated</span>
                        </div>
                      ) : <span className="text-gray-400">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(m.reinvited_at ?? m.invited_at).toLocaleDateString()}
                      {m.reinvited_at && <span className="ml-1 text-amber-500">(re-sent)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {m.status === 'pending_review' && (
                          <button
                            onClick={() => handleApprove(m.id)}
                            disabled={approvingId === m.id}
                            className="px-2 py-1 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-60"
                          >
                            {approvingId === m.id ? '✓' : 'Approve'}
                          </button>
                        )}
                        <button
                          onClick={() => handleReinvite(m.id)}
                          disabled={reinvitingId === m.id}
                          className={`px-2 py-1 text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                            reinvitingId === m.id
                              ? 'bg-green-100 text-green-700'
                              : 'border border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-700'
                          }`}
                        >
                          {reinvitingId === m.id ? '✓' : 'Re-invite'}
                        </button>
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          className="px-2 py-1 text-xs text-red-400 border border-red-100 rounded-lg hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          {removingId === m.id ? '…' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showInvite && (
        <InviteVendorModal
          onClose={() => setShowInvite(false)}
          onInvited={handleInvited}
        />
      )}
    </div>
  )
}

function InviteVendorModal({
  onClose,
  onInvited,
}: {
  onClose: () => void
  onInvited: (p: InviteVendorPayload) => Promise<void>
}) {
  const [form, setForm] = useState<InviteVendorPayload>({ name: '', contact_name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onInvited(form)
      onClose()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Invite Service Provider</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {([
            { label: 'Company Name *', key: 'name' as const, placeholder: 'ABC Generator Services Ltd' },
            { label: 'Contact Person *', key: 'contact_name' as const, placeholder: 'John Kamau' },
            { label: 'Email *', key: 'email' as const, placeholder: 'john@abcgenerators.co.ke', type: 'email' },
            { label: 'Phone', key: 'phone' as const, placeholder: '+254 7XX XXX XXX' },
            { label: 'Specialization', key: 'specialization' as const, placeholder: 'Generator Maintenance, Cummins Certified' },
            { label: 'Coverage Regions', key: 'regions' as const, placeholder: 'Nairobi, Central, Rift Valley' },
          ] as const).map(f => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-gray-700 mb-1">{f.label}</label>
              <input
                type={'type' in f ? f.type : 'text'}
                required={f.label.includes('*')}
                value={form[f.key] ?? ''}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value || undefined }))}
                placeholder={f.placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
              {saving ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
