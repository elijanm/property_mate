import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { User, Shield, Wrench, Eye, Pencil, Check, X, Loader2 } from 'lucide-react'
import clsx from 'clsx'

const ROLE_META: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  admin:    { label: 'Admin',    icon: <Shield size={12} />,  color: 'text-red-400 bg-red-900/20 border-red-800/40',       description: 'Full platform access' },
  engineer: { label: 'Engineer', icon: <Wrench size={12} />,  color: 'text-brand-400 bg-brand-900/20 border-brand-800/40', description: 'Can train & deploy models' },
  viewer:   { label: 'Viewer',   icon: <Eye size={12} />,     color: 'text-gray-400 bg-gray-800 border-gray-700',           description: 'Read-only access' },
}

const ENGINEER_PERMISSIONS = [
  'Code Editor — write & run Python',
  'Trainers — define & run training jobs',
  'Experiments — compare model versions',
  'Deploy — push models to production',
  'Batch inference jobs',
  'Create A/B tests & alert rules',
]

const ADMIN_PERMISSIONS = [
  'Everything in Engineer',
  'User management',
  'Platform analytics',
  'Audit log',
  'Security settings',
  'Full config access',
]

function RoleBadge({ role }: { role: string }) {
  const m = ROLE_META[role] ?? ROLE_META.viewer
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border font-medium', m.color)}>
      {m.icon} {m.label}
    </span>
  )
}

export default function ProfilePage() {
  const { user } = useAuth()

  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  const handleSaveName = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await authApi.updateProfile({ full_name: fullName })
      const stored = localStorage.getItem('ml_user')
      if (stored) {
        const parsed = JSON.parse(stored)
        localStorage.setItem('ml_user', JSON.stringify({ ...parsed, full_name: fullName }))
      }
      window.location.reload()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save profile')
      setSaving(false)
    }
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    setUpgradeError('')
    try {
      await authApi.updateProfile({ role: 'engineer' })
      const stored = localStorage.getItem('ml_user')
      if (stored) {
        const parsed = JSON.parse(stored)
        localStorage.setItem('ml_user', JSON.stringify({ ...parsed, role: 'engineer' }))
      }
      window.location.reload()
    } catch (e: unknown) {
      setUpgradeError(e instanceof Error ? e.message : 'Upgrade failed')
      setUpgrading(false)
    }
  }

  if (!user) return null

  const role = user.role ?? 'viewer'
  const roleMeta = ROLE_META[role] ?? ROLE_META.viewer

  return (
    <div className="max-w-2xl space-y-6">
      {/* Section 1: Profile Info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <User size={15} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Profile Info</h2>
        </div>

        {saveError && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
            {saveError}
          </p>
        )}

        <div className="space-y-4">
          {/* Full name */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Full name</label>
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  placeholder="Your full name"
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  disabled={saving}
                  className="p-2 text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button
                  onClick={() => { setEditing(false); setFullName(user.full_name ?? ''); setSaveError('') }}
                  className="p-2 text-gray-500 hover:text-gray-300"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-white">
                  {user.full_name || <span className="text-gray-600 italic">Not set</span>}
                </span>
                <button
                  onClick={() => setEditing(true)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Email — read-only */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Email</label>
            <div className="text-sm text-gray-400 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2 select-all">
              {user.email}
            </div>
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Role</label>
            <div className="flex items-center gap-2">
              <RoleBadge role={role} />
            </div>
          </div>

          {/* Org ID — read-only, monospace */}
          {user.org_id && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Org ID</label>
              <div className="text-xs text-gray-500 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2 font-mono select-all">
                {user.org_id}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Role & Plan */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield size={15} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Role & Access</h2>
        </div>

        <div className="flex items-center gap-3">
          <RoleBadge role={role} />
          <span className="text-xs text-gray-500">{roleMeta.description}</span>
        </div>

        {role === 'viewer' && (
          <div className="border border-brand-800/40 bg-brand-900/10 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base">&#x1F513;</span>
              <span className="text-sm font-semibold text-white">Unlock Engineer Access</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              Upgrade to Engineer to access Code Editor, Trainers, Experiments, Deploy and more.
            </p>
            {upgradeError && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                {upgradeError}
              </p>
            )}
            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {upgrading ? <Loader2 size={12} className="animate-spin" /> : null}
              Upgrade to Engineer &rarr;
            </button>
          </div>
        )}

        {(role === 'engineer' || role === 'admin') && (
          <div className={clsx(
            'border rounded-xl p-5 space-y-3',
            role === 'admin' ? 'border-red-800/30 bg-red-900/5' : 'border-emerald-800/30 bg-emerald-900/5'
          )}>
            <div className="flex items-center gap-2">
              <span className={clsx('text-xs font-semibold', role === 'admin' ? 'text-red-400' : 'text-emerald-400')}>
                {role === 'admin' ? 'Admin Access' : 'Engineer Access'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 border border-emerald-800/40 text-emerald-400">
                Active
              </span>
            </div>
            <ul className="space-y-1.5">
              {(role === 'admin' ? ADMIN_PERMISSIONS : ENGINEER_PERMISSIONS).map(p => (
                <li key={p} className={clsx(
                  'text-xs flex items-start gap-1.5',
                  p.startsWith('Everything') ? 'text-brand-400' : 'text-gray-400'
                )}>
                  <span className="mt-0.5 text-emerald-500">&#10003;</span> {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
