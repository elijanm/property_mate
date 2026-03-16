import { useState, useEffect, useCallback } from 'react'
import { staffApi, contributorsApi } from '@/api/staff'
import type { StaffMember, PlanStaffInfo, Contributor } from '@/types/staff'
import {
  UserPlus, Trash2, ChevronDown, Users, AlertCircle, CheckCircle,
  Search, ShieldCheck, ShieldAlert, ShieldX, Shield, Star,
  ToggleLeft, ToggleRight, MapPin, Activity,
} from 'lucide-react'

// ── Shared helpers ─────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
  engineer: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  viewer: 'bg-gray-800 text-gray-400 border border-gray-700',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGE[role] ?? ROLE_BADGE.viewer}`}>
      {role}
    </span>
  )
}

const KYC_BADGE: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  none:     { cls: 'bg-gray-800 text-gray-500 border-gray-700',            label: 'No KYC',  icon: <Shield size={10} /> },
  pending:  { cls: 'bg-amber-900/30 text-amber-400 border-amber-700/40',   label: 'Pending', icon: <ShieldAlert size={10} /> },
  approved: { cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/40', label: 'Verified', icon: <ShieldCheck size={10} /> },
  rejected: { cls: 'bg-red-900/30 text-red-400 border-red-700/40',         label: 'Rejected', icon: <ShieldX size={10} /> },
}

function KycBadge({ status }: { status: string }) {
  const b = KYC_BADGE[status] ?? KYC_BADGE.none
  return (
    <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${b.cls}`}>
      {b.icon} {b.label}
    </span>
  )
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border
      ${ok ? 'bg-green-950 border-green-700 text-green-300' : 'bg-red-950 border-red-700 text-red-300'}`}>
      {ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
      {msg}
    </div>
  )
}

function fmt(n: number) { return n.toLocaleString() }

// ── Invite modal ───────────────────────────────────────────────────────────────

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) { setError('Email is required'); return }
    setLoading(true); setError('')
    try {
      await staffApi.invite({ email, role, full_name: fullName })
      onSuccess(); onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg ?? 'Failed to invite staff member')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-4">Invite Staff Member</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              placeholder="colleague@company.com" required />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              placeholder="Jane Doe" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Role</label>
            <div className="relative">
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white appearance-none focus:outline-none focus:border-indigo-500">
                <option value="viewer">Viewer — read-only access</option>
                <option value="engineer">Engineer — can train + deploy models</option>
                <option value="admin">Admin — full org access</option>
              </select>
              <ChevronDown size={14} className="absolute right-3 top-3 text-gray-500 pointer-events-none" />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/40 border border-red-800/40 rounded-lg px-3 py-2">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
              {loading ? 'Inviting…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Staff tab ──────────────────────────────────────────────────────────────────

function StaffTab() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [plan, setPlan] = useState<PlanStaffInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [updatingRole, setUpdatingRole] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await staffApi.list()
      setMembers(res.items); setPlan(res.plan)
    } catch { showToast('Failed to load staff list', false) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleRemove = async (email: string) => {
    if (!confirm(`Deactivate ${email}?`)) return
    try { await staffApi.remove(email); showToast(`${email} deactivated`); load() }
    catch { showToast('Failed to remove staff member', false) }
  }

  const handleRoleChange = async (email: string, newRole: string) => {
    setUpdatingRole(email)
    try { await staffApi.updateRole(email, newRole); showToast(`Role updated to ${newRole}`); load() }
    catch { showToast('Failed to update role', false) }
    finally { setUpdatingRole(null) }
  }

  const canInvite = plan?.can_invite ?? false
  const maxAllowed = plan?.max_allowed ?? 3
  const currentCount = plan?.current_count ?? 0
  const isUnlimited = maxAllowed === -1
  const usedPct = isUnlimited ? 0 : Math.min(100, Math.round((currentCount / maxAllowed) * 100))

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div />
        <div title={!canInvite ? (plan?.reason ?? 'Plan limit reached') : undefined}>
          <button onClick={() => setShowInvite(true)} disabled={!canInvite}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
            <UserPlus size={15} /> Invite Staff
          </button>
        </div>
      </div>

      {plan && (
        <div className="mb-6 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Users size={14} className="text-gray-500" />
              <span>{isUnlimited ? `${currentCount} staff members (unlimited plan)` : `${currentCount} / ${maxAllowed} staff members used`}</span>
            </div>
            {!canInvite && !isUnlimited && (
              <span className="text-[11px] text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded-full px-2 py-0.5">Limit reached</span>
            )}
          </div>
          {!isUnlimited && (
            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${usedPct >= 100 ? 'bg-red-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                style={{ width: `${usedPct}%` }} />
            </div>
          )}
          {!canInvite && <p className="text-xs text-gray-500 mt-2">{plan.reason}</p>}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-600 text-sm">Loading staff…</div>
        ) : members.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={32} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm font-medium">No staff members yet</p>
            <p className="text-gray-600 text-xs mt-1">Invite your team to collaborate on this workspace.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Member</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Last Login</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-800/30 transition-colors group">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-gray-300">
                        {(m.full_name || m.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-white text-sm">{m.full_name || '—'}</div>
                        <div className="text-xs text-gray-500">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <RoleBadge role={m.role} />
                      <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                        <select value={m.role} disabled={updatingRole === m.email}
                          onChange={e => handleRoleChange(m.email, e.target.value)}
                          className="text-[11px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400 cursor-pointer focus:outline-none">
                          <option value="viewer">viewer</option>
                          <option value="engineer">engineer</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.is_active ? 'bg-green-900/30 text-green-400 border border-green-800/40' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                      {m.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500 hidden lg:table-cell">
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => handleRemove(m.email)} title="Deactivate"
                      className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onSuccess={() => { showToast('Invite sent!'); load() }} />}
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </>
  )
}

// ── Contributors tab ───────────────────────────────────────────────────────────

function ContributorsTab() {
  const [items, setItems] = useState<Contributor[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kycFilter, setKycFilter] = useState('')
  const [page, setPage] = useState(1)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const limit = 20

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await contributorsApi.list({ page, limit, search: search || undefined, kyc_status: kycFilter || undefined })
      setItems(res.items); setTotal(res.total)
    } catch { showToast('Failed to load contributors', false) }
    finally { setLoading(false) }
  }, [page, search, kycFilter])

  useEffect(() => { load() }, [load])

  const handleToggle = async (c: Contributor) => {
    setToggling(c.email)
    try {
      const res = await contributorsApi.toggleStatus(c.email)
      setItems(prev => prev.map(x => x.email === c.email ? { ...x, is_active: res.is_active } : x))
      showToast(`${c.email} ${res.is_active ? 'activated' : 'deactivated'}`)
    } catch { showToast('Failed to update status', false) }
    finally { setToggling(null) }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="relative">
          <select
            value={kycFilter}
            onChange={e => { setKycFilter(e.target.value); setPage(1) }}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white appearance-none focus:outline-none focus:border-indigo-500 pr-8"
          >
            <option value="">All KYC</option>
            <option value="none">No KYC</option>
            <option value="pending">Pending</option>
            <option value="approved">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-gray-600 mb-3">{total} contributor{total !== 1 ? 's' : ''} total</p>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-600 text-sm">Loading contributors…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Activity size={32} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-500 text-sm font-medium">No contributors found</p>
            <p className="text-gray-600 text-xs mt-1">Contributors register via the public annotator portal or dataset collect links.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contributor</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">KYC</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Points</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Activity</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {items.map(c => (
                  <tr key={c.email} className={`hover:bg-gray-800/30 transition-colors ${!c.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-900/50 border border-indigo-700/40 flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-300">
                          {(c.full_name || c.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-white text-sm">{c.full_name || '—'}</div>
                          <div className="text-xs text-gray-500">{c.email}</div>
                          {(c.country || c.county) && (
                            <div className="flex items-center gap-1 text-[10px] text-gray-600 mt-0.5">
                              <MapPin size={8} /> {[c.county, c.country].filter(Boolean).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <KycBadge status={c.kyc_status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 text-amber-400 font-semibold text-sm">
                        <Star size={11} fill="currentColor" />
                        {fmt(c.total_points_earned)}
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {fmt(c.redeemable_points)} redeemable · {fmt(c.total_points_redeemed)} redeemed
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <div className="text-xs text-white">{fmt(c.total_entries_submitted)} entries</div>
                      <div className="text-[10px] text-gray-600 mt-0.5">{c.total_tasks_completed} tasks done</div>
                      {c.last_active_at && (
                        <div className="text-[10px] text-gray-700 mt-0.5">
                          Active {new Date(c.last_active_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${c.is_active ? 'bg-green-900/30 text-green-400 border-green-800/40' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => handleToggle(c)}
                        disabled={toggling === c.email}
                        title={c.is_active ? 'Deactivate' : 'Activate'}
                        className="p-1 rounded-lg text-gray-600 hover:text-white transition-colors"
                      >
                        {c.is_active
                          ? <ToggleRight size={18} className="text-emerald-500" />
                          : <ToggleLeft size={18} className="text-gray-600" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors">
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors">
            Next
          </button>
        </div>
      )}

      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
    </>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const [tab, setTab] = useState<'staff' | 'contributors'>('staff')

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Staff</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage team members and data contributors</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setTab('staff')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'staff' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          <Users size={14} /> Team
        </button>
        <button
          onClick={() => setTab('contributors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'contributors' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          <Activity size={14} /> Contributors
        </button>
      </div>

      {tab === 'staff' ? <StaffTab /> : <ContributorsTab />}
    </div>
  )
}
