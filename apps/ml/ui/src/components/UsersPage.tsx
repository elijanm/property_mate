import { useState, useEffect } from 'react'
import { usersApi, type MLUser } from '../api/users'
import { useAuth } from '../context/AuthContext'
import { Users, Plus, Shield, Wrench, Eye, Loader2, ToggleRight, ToggleLeft, Pencil, Check, X, Link2, Copy } from 'lucide-react'
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

function InlineRoleSelect({ value, onSave, onCancel }: { value: string; onSave: (r: string) => Promise<void>; onCancel: () => void }) {
  const [role, setRole] = useState(value)
  const [saving, setSaving] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <select value={role} onChange={e => setRole(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none">
        <option value="viewer">Viewer</option>
        <option value="engineer">Engineer</option>
        <option value="admin">Admin</option>
      </select>
      <button onClick={async () => { setSaving(true); await onSave(role); setSaving(false) }} disabled={saving}
        className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button onClick={onCancel} className="p-1 text-gray-500 hover:text-gray-300"><X size={12} /></button>
    </div>
  )
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<MLUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingRole, setEditingRole] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState('')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [loadingInvite, setLoadingInvite] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await usersApi.list({ role: roleFilter || undefined, limit: 200 })
      setUsers(res.items)
      setTotal(res.total)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [roleFilter])

  const handleCreate = async () => {
    if (!form.email || !form.password) { setError('Email and password are required'); return }
    setError('')
    setSaving(true)
    try {
      await usersApi.create(form)
      setShowCreate(false)
      setForm({ email: '', password: '', full_name: '', role: 'viewer' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create user')
    } finally { setSaving(false) }
  }

  const updateRole = async (id: string, role: string) => {
    await usersApi.update(id, { role })
    setEditingRole(null)
    await load()
  }

  const toggleActive = async (user: MLUser) => {
    await usersApi.update(user.id, { is_active: !user.is_active })
    await load()
  }

  const handleInvite = async () => {
    setLoadingInvite(true)
    try {
      const { token } = await usersApi.generateInviteToken()
      setInviteToken(token)
    } catch {} finally { setLoadingInvite(false) }
  }
  const copyInvite = async () => {
    const link = `${window.location.origin}?invite=${inviteToken}`
    await navigator.clipboard.writeText(link)
    setCopiedInvite(true)
    setTimeout(() => setCopiedInvite(false), 2000)
  }

  const roleCount = (r: string) => users.filter(u => u.role === r).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">User Management</h2>
          <span className="text-xs text-gray-600">{total} total</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Role filter */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {['', 'viewer', 'engineer', 'admin'].map(r => (
              <button key={r} onClick={() => setRoleFilter(r)}
                className={clsx('px-3 py-1.5 text-xs capitalize transition-colors',
                  roleFilter === r ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300')}>
                {r || 'All'}
              </button>
            ))}
          </div>
          <button onClick={handleInvite} disabled={loadingInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded-lg transition-colors border border-gray-700 disabled:opacity-50">
            {loadingInvite ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Invite link
          </button>
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors">
            <Plus size={12} /> New user
          </button>
        </div>
      </div>

      {inviteToken && (
        <div className="bg-gray-900 border border-brand-800/40 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-1">Share this link — valid for 7 days. Registrants join your org as Viewer.</p>
            <code className="text-[11px] text-brand-400 font-mono break-all">{`${window.location.origin}?invite=${inviteToken}`}</code>
          </div>
          <button onClick={copyInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs rounded-lg text-gray-300 shrink-0">
            {copiedInvite ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copiedInvite ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Role summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(['viewer', 'engineer', 'admin'] as const).map(r => {
          const m = ROLE_META[r]
          return (
            <div key={r} className={clsx('bg-gray-900 border rounded-xl px-4 py-3', r === 'admin' ? 'border-red-900/30' : r === 'engineer' ? 'border-brand-900/30' : 'border-gray-800')}>
              <div className="flex items-center gap-2 mb-1">
                <span className={clsx('text-xs', r === 'admin' ? 'text-red-400' : r === 'engineer' ? 'text-brand-400' : 'text-gray-400')}>{m.icon}</span>
                <span className="text-xs text-gray-400 capitalize">{m.label}s</span>
              </div>
              <div className="text-2xl font-bold text-white">{roleCount(r)}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">
                {r === 'viewer' ? 'Read-only access' : r === 'engineer' ? 'Can train & deploy' : 'Full platform access'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Create user</h3>
          {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Email', key: 'email', type: 'email', placeholder: 'user@example.com' },
              { label: 'Full name', key: 'full_name', type: 'text', placeholder: 'Jane Smith' },
              { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-gray-500">{f.label}</label>
                <input type={f.type} value={(form as Record<string, string>)[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500" />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Role</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                <option value="viewer">Viewer — read-only</option>
                <option value="engineer">Engineer — train &amp; deploy</option>
                <option value="admin">Admin — full access</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create
            </button>
            <button onClick={() => { setShowCreate(false); setError('') }}
              className="px-4 py-2 text-xs text-gray-400 bg-gray-800 rounded-lg hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* User table */}
      {loading ? (
        <div className="flex justify-center h-32 items-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-800">
                {['User', 'Role', 'Status', 'Last login', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map(u => (
                <tr key={u.id} className={clsx('hover:bg-gray-800/30 transition-colors', !u.is_active && 'opacity-40')}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{u.email}</div>
                    {u.full_name && <div className="text-gray-500 text-[10px] mt-0.5">{u.full_name}</div>}
                    {u.email === me?.email && <span className="text-[10px] text-brand-400">you</span>}
                  </td>
                  <td className="px-4 py-3">
                    {editingRole === u.id ? (
                      <InlineRoleSelect value={u.role} onSave={r => updateRole(u.id, r)} onCancel={() => setEditingRole(null)} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <RoleBadge role={u.role} />
                        {u.email !== me?.email && (
                          <button onClick={() => setEditingRole(u.id)} className="text-gray-600 hover:text-gray-400 transition-colors"><Pencil size={11} /></button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border', u.is_active ? 'text-emerald-400 border-emerald-800 bg-emerald-900/10' : 'text-gray-600 border-gray-700')}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : <span className="text-gray-700">Never</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {u.email !== me?.email && (
                      <button onClick={() => toggleActive(u)} title={u.is_active ? 'Deactivate' : 'Reactivate'}
                        className="text-gray-600 hover:text-gray-300 transition-colors">
                        {u.is_active ? <ToggleRight size={15} className="text-emerald-500" /> : <ToggleLeft size={15} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="text-center py-10 text-gray-600 text-sm">No users found</div>
          )}
        </div>
      )}

      {/* Role legend */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-400 mb-3">Role permissions</h3>
        <div className="grid grid-cols-3 gap-4 text-xs">
          {[
            { role: 'viewer', perms: ['View models & deployments', 'Run inference', 'View logs & monitoring', 'Manage own API keys', 'View A/B tests & alerts'] },
            { role: 'engineer', perms: ['Everything in Viewer', 'Train & deploy models', 'Create A/B tests', 'Create alert rules', 'Submit batch jobs', 'Set drift baselines', 'Manage circuit breakers'] },
            { role: 'admin', perms: ['Everything in Engineer', 'Manage users', 'Ban / unban IPs', 'View audit log', 'Revoke any API key', 'Full config access'] },
          ].map(({ role, perms }) => (
            <div key={role}>
              <RoleBadge role={role} />
              <ul className="mt-2 space-y-1">
                {perms.map(p => (
                  <li key={p} className={clsx('text-[10px] flex items-start gap-1', p.startsWith('Everything') ? 'text-brand-500' : 'text-gray-500')}>
                    <span className="mt-0.5">•</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
