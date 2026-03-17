import { useState, useEffect } from 'react'
import { adminApi } from '../api/admin'
import { usersApi, type MLUser } from '../api/users'
import { UserCheck, Loader2, Shield, Wrench, Eye } from 'lucide-react'
import clsx from 'clsx'

const ROLE_META = {
  admin:    { label: 'Admin',    icon: <Shield size={11} />,  color: 'text-red-400 bg-red-900/20 border-red-800/40' },
  engineer: { label: 'Engineer', icon: <Wrench size={11} />,  color: 'text-brand-400 bg-brand-900/20 border-brand-800/40' },
  viewer:   { label: 'Viewer',   icon: <Eye size={11} />,     color: 'text-gray-400 bg-gray-800 border-gray-700' },
}

function RoleBadge({ role }: { role: string }) {
  const m = ROLE_META[role as keyof typeof ROLE_META] ?? ROLE_META.viewer
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium', m.color)}>
      {m.icon} {m.label}
    </span>
  )
}

interface AccountRow {
  id: string
  email: string
  full_name?: string
  role: string
  org_id: string
  created_at: string
  is_active: boolean
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      // Try dedicated accounts endpoint first; fall back to users list
      try {
        const data = await adminApi.listAccounts()
        const items: AccountRow[] = Array.isArray(data) ? data : (data.items ?? [])
        setAccounts(items)
        setTotal(data.total ?? items.length)
      } catch {
        // Fallback: GET /admin/users (all users, shown as accounts)
        const res = await usersApi.list({ limit: 500 })
        const items: AccountRow[] = (res.items as MLUser[]).map(u => ({
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          role: u.role,
          org_id: (u as unknown as { org_id?: string }).org_id ?? '',
          created_at: u.created_at,
          is_active: u.is_active,
        }))
        setAccounts(items)
        setTotal(res.total)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <UserCheck size={16} className="text-brand-400" />
        <h2 className="text-sm font-semibold text-white">All Accounts</h2>
        {!loading && <span className="text-xs text-gray-600">{total} total</span>}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center h-32 items-center">
          <Loader2 size={18} className="animate-spin text-gray-600" />
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-800">
                {['Name / Email', 'Role', 'Org ID', 'Created', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {accounts.map(a => (
                <tr key={a.id} className={clsx('hover:bg-gray-800/30 transition-colors', !a.is_active && 'opacity-40')}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{a.email}</div>
                    {a.full_name && <div className="text-gray-500 text-[10px] mt-0.5">{a.full_name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={a.role} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10px] text-gray-500 select-all">{a.org_id || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded border',
                      a.is_active
                        ? 'text-emerald-400 border-emerald-800 bg-emerald-900/10'
                        : 'text-gray-600 border-gray-700'
                    )}>
                      {a.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accounts.length === 0 && (
            <div className="text-center py-10 text-gray-600 text-sm">No accounts found</div>
          )}
        </div>
      )}
    </div>
  )
}
