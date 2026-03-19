import { useEffect, useState, useRef } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { adminUsersApi } from '@/api/adminUsers'
import type { AdminUser } from '@/api/adminUsers'
import { extractApiError } from '@/utils/apiError'

const PAGE_SIZE = 20

const ROLE_BADGE: Record<string, string> = {
  owner:            'bg-blue-50 text-blue-700',
  agent:            'bg-violet-50 text-violet-700',
  tenant:           'bg-emerald-50 text-emerald-700',
  service_provider: 'bg-amber-50 text-amber-700',
  superadmin:       'bg-red-50 text-red-700',
}

const ROLES = ['owner', 'agent', 'tenant', 'service_provider', 'superadmin']

function fullName(u: AdminUser) {
  return `${u.first_name} ${u.last_name}`.trim() || '—'
}

function initials(u: AdminUser) {
  const n = fullName(u)
  if (n === '—') return u.email[0].toUpperCase()
  return n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function AdminUsersPage() {
  const [users, setUsers]         = useState<AdminUser[]>([])
  const [total, setTotal]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const [query, setQuery]               = useState('')
  const [roleFilter, setRoleFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [view, setView]                 = useState<'grid' | 'table'>('table')
  const [page, setPage]                 = useState(1)

  const [suspending, setSuspending] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPage(1)
  }, [query, roleFilter, statusFilter])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      const params: Record<string, unknown> = { page, page_size: PAGE_SIZE }
      if (query) params.q = query
      if (roleFilter) params.role = roleFilter
      if (statusFilter === 'active') params.is_active = true
      if (statusFilter === 'suspended') params.is_active = false

      adminUsersApi
        .list(params)
        .then(r => {
          setUsers(r.items)
          setTotal(r.total)
          setTotalPages(r.total_pages)
        })
        .catch(err => setError(extractApiError(err).message))
        .finally(() => setLoading(false))
    }, 300)
  }, [query, roleFilter, statusFilter, page])

  async function toggleSuspend(u: AdminUser) {
    setSuspending(u.id)
    try {
      const updated = await adminUsersApi.suspend(u.id, !u.is_active)
      setUsers(prev => prev.map(x => (x.id === updated.id ? updated : x)))
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSuspending(null)
    }
  }

  // Pagination helpers
  const pages: number[] = []
  const start = Math.max(1, page - 2)
  const end   = Math.min(totalPages, page + 2)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Users</h1>
            <p className="text-sm text-gray-500 mt-1">
              {loading ? '…' : `${total.toLocaleString()} account${total !== 1 ? 's' : ''} on platform`}
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-5 flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search by name or email…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All roles</option>
            {ROLES.map(r => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>

          <div className="flex-1" />

          {/* Grid / Table toggle */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setView('grid')}
              title="Grid view"
              className={`px-3 py-2 text-sm transition-colors ${view === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              ⊞
            </button>
            <button
              onClick={() => setView('table')}
              title="Table view"
              className={`px-3 py-2 text-sm transition-colors ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              ☰
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Summary line */}
        <p className="text-xs text-gray-400 mb-4">
          {loading
            ? 'Loading…'
            : `${total === 0 ? 'No' : total.toLocaleString()} user${total !== 1 ? 's' : ''}${query || roleFilter || statusFilter !== 'all' ? ' matching filters' : ''}${totalPages > 1 ? ` · page ${page}/${totalPages}` : ''}`
          }
        </p>

        {/* ── Grid view ────────────────────────────────────────────────── */}
        {!loading && view === 'grid' && users.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            {users.map(u => (
              <div
                key={u.id}
                className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${!u.is_active ? 'opacity-60' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {initials(u)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{fullName(u)}</p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                    {u.role.replace('_', ' ')}
                  </span>
                  {!u.is_active && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                      suspended
                    </span>
                  )}
                </div>

                {u.org_id && (
                  <p className="text-xs text-gray-400 font-mono truncate">{u.org_id}</p>
                )}

                <p className="text-xs text-gray-400">
                  Joined {new Date(u.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>

                <button
                  onClick={() => toggleSuspend(u)}
                  disabled={suspending === u.id}
                  className={`mt-auto text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    u.is_active
                      ? 'bg-red-50 text-red-700 hover:bg-red-100'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  } disabled:opacity-50`}
                >
                  {suspending === u.id ? '…' : u.is_active ? 'Suspend' : 'Reactivate'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Table view ───────────────────────────────────────────────── */}
        {!loading && view === 'table' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 sticky top-0 z-10">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Org ID</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Joined</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        No users found.
                      </td>
                    </tr>
                  )}
                  {users.map((u, i) => (
                    <tr
                      key={u.id}
                      className={`transition-colors hover:bg-gray-50 ${!u.is_active ? 'opacity-60' : ''} ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {initials(u)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{fullName(u)}</p>
                            <p className="text-xs text-gray-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {u.org_id ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                          {u.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(u.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => toggleSuspend(u)}
                          disabled={suspending === u.id}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            u.is_active
                              ? 'bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          } disabled:opacity-50`}
                        >
                          {suspending === u.id ? '…' : u.is_active ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && users.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            No users found{query || roleFilter || statusFilter !== 'all' ? ' matching your filters' : ' on the platform'}.
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-400">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                «
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                ‹
              </button>
              {pages.map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    p === page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
