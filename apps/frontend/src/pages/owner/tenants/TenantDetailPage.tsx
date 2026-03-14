import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { tenantsApi } from '@/api/tenants'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import DashboardLayout from '@/layouts/DashboardLayout'
import type { Tenant } from '@/types/tenant'

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const { user } = useAuth()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Editable fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [isActive, setIsActive] = useState(true)

  const canEdit = user?.role === 'owner' || user?.role === 'superadmin'

  useEffect(() => {
    if (!tenantId) return
    tenantsApi
      .get(tenantId)
      .then((t) => {
        setTenant(t)
        setFirstName(t.first_name)
        setLastName(t.last_name)
        setPhone(t.phone ?? '')
        setIsActive(t.is_active)
      })
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [tenantId])

  async function handleSave() {
    if (!tenantId) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const updated = await tenantsApi.update(tenantId, {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
        is_active: isActive,
      })
      setTenant(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="p-8 max-w-2xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link to="/tenants" className="hover:text-blue-600 transition-colors">Tenants</Link>
          <span>›</span>
          <span className="text-gray-900 font-medium">
            {tenant ? `${tenant.first_name} ${tenant.last_name}` : '…'}
          </span>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">{error}</div>
        )}

        {loading && (
          <div className="text-center py-16 text-gray-400">Loading…</div>
        )}

        {tenant && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold text-gray-900">
                {tenant.first_name} {tenant.last_name}
              </h1>
              <span className={tenant.is_active ? 'badge-green' : 'badge-gray'}>
                {tenant.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Email</label>
                <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">{tenant.email}</p>
              </div>

              {canEdit ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">First Name</label>
                      <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Last Name</label>
                      <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Phone</label>
                    <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254..." />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm font-semibold text-gray-600">Active</span>
                    </label>
                  </div>
                  {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                  {saved && <p className="text-sm text-green-600">Saved!</p>}
                  <div className="flex justify-end pt-2">
                    <button onClick={handleSave} disabled={saving} className="btn-primary">
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Phone</label>
                    <p className="text-sm text-gray-700">{tenant.phone ?? '—'}</p>
                  </div>
                </>
              )}

              <div className="border-t border-gray-100 pt-4 mt-4 text-xs text-gray-400 space-y-1">
                <p>Created: {new Date(tenant.created_at).toLocaleString()}</p>
                <p>Updated: {new Date(tenant.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
