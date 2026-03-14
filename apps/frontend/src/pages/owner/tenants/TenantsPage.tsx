import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tenantsApi } from '@/api/tenants'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import DashboardLayout from '@/layouts/DashboardLayout'
import type { Tenant, TenantCreateRequest } from '@/types/tenant'

const PAGE_SIZE = 20

function AddTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (t: Tenant) => void
}) {
  const [form, setForm] = useState<TenantCreateRequest>({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    password: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(field: keyof TenantCreateRequest, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const tenant = await tenantsApi.create({
        ...form,
        phone: form.phone || undefined,
      })
      onCreated(tenant)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[440px]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Add Tenant</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First Name *</label>
              <input className="input" required value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Last Name *</label>
              <input className="input" required value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254..." />
          </div>
          <div>
            <label className="label">Password *</label>
            <input className="input" type="password" required minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating…' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TenantsPage() {
  const { user } = useAuth()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const canCreate = user?.role === 'owner' || user?.role === 'superadmin'

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const result = await tenantsApi.list({ page, page_size: PAGE_SIZE })
      setTenants(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page])

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
            {!loading && (
              <p className="text-sm text-gray-500 mt-1">{total} total</p>
            )}
          </div>
          {canCreate && (
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              + Add Tenant
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Email</th>
                <th className="table-th">Phone</th>
                <th className="table-th">Status</th>
                <th className="table-th">Joined</th>
                <th className="table-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No tenants yet</td>
                </tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-td font-medium text-gray-900">
                      {t.first_name} {t.last_name}
                    </td>
                    <td className="table-td text-gray-600">{t.email}</td>
                    <td className="table-td text-gray-600">{t.phone ?? '—'}</td>
                    <td className="table-td">
                      <span className={t.is_active ? 'badge-green' : 'badge-gray'}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="table-td text-gray-500">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td className="table-td text-right">
                      <Link to={`/tenants/${t.id}`} className="text-blue-600 text-xs font-medium hover:underline">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-outline btn-sm disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-sm text-gray-500">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={tenants.length < PAGE_SIZE}
              className="btn-outline btn-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddTenantModal
          onClose={() => setShowAdd(false)}
          onCreated={(t) => {
            setTenants((prev) => [t, ...prev])
            setTotal((n) => n + 1)
            setShowAdd(false)
          }}
        />
      )}
    </DashboardLayout>
  )
}
