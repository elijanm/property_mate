import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import {
  getPortalDashboard,
  getPortalProfile,
  updatePortalProfile,
  getPortalContracts,
  getPortalTickets,
} from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type {
  VendorProfile,
  VendorPortalDashboard,
  VendorContract,
  VendorContractStatus,
} from '@/types/vendor'

type Tab = 'dashboard' | 'tickets' | 'contracts' | 'profile'

const CONTRACT_STATUS_BADGE: Record<VendorContractStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-yellow-100 text-yellow-700',
  vendor_signed: 'bg-blue-100 text-blue-700',
  org_signed: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  terminated: 'bg-red-100 text-red-600',
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-3xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  )
}

export default function VendorPortalPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dashboard, setDashboard] = useState<VendorPortalDashboard | null>(null)
  const [profile, setProfile] = useState<VendorProfile | null>(null)
  const [contracts, setContracts] = useState<VendorContract[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterTicketStatus, setFilterTicketStatus] = useState('')

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ contact_phone: '', website: '', address: '', service_areas: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => { loadInitial() }, [])
  useEffect(() => {
    if (tab === 'tickets') loadTickets()
    if (tab === 'contracts') loadContracts()
  }, [tab, filterTicketStatus])

  async function loadInitial() {
    setLoading(true)
    setError(null)
    try {
      const [dash, prof] = await Promise.all([getPortalDashboard(), getPortalProfile()])
      setDashboard(dash)
      setProfile(prof)
      setProfileForm({
        contact_phone: prof.contact_phone ?? '',
        website: prof.website ?? '',
        address: prof.address ?? '',
        service_areas: prof.service_areas.join(', '),
      })
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadContracts() {
    try {
      const res = await getPortalContracts()
      setContracts(res.items)
    } catch {}
  }

  async function loadTickets() {
    try {
      const res = await getPortalTickets({ status: filterTicketStatus || undefined })
      setTickets(res.items ?? [])
    } catch {}
  }

  async function saveProfile() {
    setSavingProfile(true)
    try {
      const updated = await updatePortalProfile({
        contact_phone: profileForm.contact_phone || undefined,
        website: profileForm.website || undefined,
        address: profileForm.address || undefined,
        service_areas: profileForm.service_areas
          ? profileForm.service_areas.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      } as any)
      setProfile(updated)
      setEditingProfile(false)
    } catch {}
    setSavingProfile(false)
  }

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '◫' },
    { key: 'tickets', label: 'Tickets', icon: '🎫' },
    { key: 'contracts', label: 'Contracts', icon: '📄' },
    { key: 'profile', label: 'Profile', icon: '🏢' },
  ]

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Portal</h1>
          {profile && <p className="text-sm text-gray-500 mt-0.5">{profile.company_name}</p>}
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                'pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

        {loading ? (
          <p className="text-gray-400 text-sm text-center py-12">Loading…</p>
        ) : (
          <>
            {/* Dashboard */}
            {tab === 'dashboard' && dashboard && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Open Tickets" value={dashboard.open_tickets} icon="🎫" color="text-blue-600" />
                  <StatCard label="Active Contracts" value={dashboard.active_contracts} icon="📄" color="text-green-600" />
                  <StatCard label="Pending Docs" value={dashboard.pending_documents} icon="📎" color="text-yellow-600" />
                  <StatCard label="Total Ratings" value={dashboard.total_ratings} icon="⭐" color="text-gray-900" />
                </div>

                {dashboard.total_ratings > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <p className="text-sm text-gray-500 mb-1">Average Rating</p>
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-bold text-gray-900">{dashboard.rating_avg.toFixed(1)}</span>
                      <span className="text-yellow-400 text-2xl">{'★'.repeat(Math.round(dashboard.rating_avg))}</span>
                      <span className="text-sm text-gray-400">/ 5</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tickets */}
            {tab === 'tickets' && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <select
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={filterTicketStatus}
                    onChange={(e) => setFilterTicketStatus(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    <option value="open">Open</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left">
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Ticket</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Priority</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tickets.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No tickets assigned to you.</td></tr>
                      ) : (
                        tickets.map((t: any) => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{t.title}</p>
                              {t.description && <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>}
                            </td>
                            <td className="px-4 py-3">
                              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs">{t.category}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-medium">{t.status.replace('_', ' ')}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium ${
                                t.priority === 'urgent' ? 'text-red-600' :
                                t.priority === 'high' ? 'text-orange-600' :
                                'text-gray-600'
                              }`}>{t.priority}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(t.created_at)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Contracts */}
            {tab === 'contracts' && (
              <div className="grid gap-4">
                {contracts.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">No contracts found.</p>
                ) : (
                  contracts.map((c) => (
                    <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">{c.title}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CONTRACT_STATUS_BADGE[c.status]}`}>
                              {c.status.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-gray-400">
                              {fmtDate(c.start_date)} – {fmtDate(c.end_date)}
                            </span>
                          </div>
                          {c.contract_fee > 0 && (
                            <p className="text-sm text-gray-500 mt-1">
                              Contract Fee: KES {c.contract_fee.toLocaleString()}
                            </p>
                          )}
                        </div>
                        {c.status === 'sent' && (
                          <span className="px-3 py-1.5 bg-yellow-100 text-yellow-700 text-xs rounded-lg">
                            Check email for signing link
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Profile */}
            {tab === 'profile' && profile && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Company Profile</h2>
                  <button
                    onClick={() => setEditingProfile(!editingProfile)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
                  >
                    {editingProfile ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                {/* Read-only info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Company', profile.company_name],
                    ['Trading Name', profile.trading_name ?? '—'],
                    ['Registration No.', profile.registration_number ?? '—'],
                    ['KRA PIN', profile.tax_pin ?? '—'],
                    ['Company Type', profile.company_type],
                    ['Contact Name', profile.contact_name],
                    ['Email', profile.contact_email],
                    ['Categories', profile.service_categories.join(', ') || '—'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className="font-medium text-gray-900">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Editable fields */}
                {editingProfile && (
                  <div className="border-t border-gray-100 pt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={profileForm.contact_phone}
                          onChange={(e) => setProfileForm((f) => ({ ...f, contact_phone: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Website</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={profileForm.website}
                          onChange={(e) => setProfileForm((f) => ({ ...f, website: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        value={profileForm.address}
                        onChange={(e) => setProfileForm((f) => ({ ...f, address: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Service Areas (comma-separated)</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        value={profileForm.service_areas}
                        onChange={(e) => setProfileForm((f) => ({ ...f, service_areas: e.target.value }))}
                      />
                    </div>
                    <button
                      onClick={saveProfile}
                      disabled={savingProfile}
                      className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingProfile ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                )}

                {/* Rating summary */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-medium">Rating</p>
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 text-xl">{'★'.repeat(Math.round(profile.rating_avg))}</span>
                    <span className="text-lg font-semibold text-gray-900">{profile.rating_avg.toFixed(1)}</span>
                    <span className="text-sm text-gray-400">({profile.rating_count} reviews)</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
