import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { orgConfigApi, type OrgConfig } from '../api/orgConfig'
import { useOrgConfig } from '../context/OrgConfigContext'
import {
  User, Shield, Wrench, Eye, Pencil, Check, X, Loader2,
  Building2, RefreshCw, Link2, Lock, Mail, KeyRound, AlertTriangle, Clock,
} from 'lucide-react'
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

const _SLUG_RE = /^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$/

function _autoSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
}

function _appendSuffix(base: string): string {
  const suffix = Math.floor(1000 + Math.random() * 9000).toString()
  return `${base.slice(0, 24).replace(/-+$/, '')}-${suffix}`
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken'

function _deriveSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
  if (!base) return ''
  // 6-char random hex suffix for uniqueness
  const suffix = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
  return `${base}-${suffix}`
}

function RoleBadge({ role }: { role: string }) {
  const m = ROLE_META[role] ?? ROLE_META.viewer
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border font-medium', m.color)}>
      {m.icon} {m.label}
    </span>
  )
}

type Tab = 'profile' | 'organisation' | 'security' | 'access'

const TABS: { id: Tab; label: string; icon: React.ReactNode; roles?: string[] }[] = [
  { id: 'profile',      label: 'Profile',       icon: <User size={12} /> },
  { id: 'organisation', label: 'Workspace',  icon: <Building2 size={12} />, roles: ['engineer', 'admin'] },
  { id: 'security',     label: 'Security',      icon: <Lock size={12} /> },
  { id: 'access',       label: 'Role & Access', icon: <Shield size={12} /> },
]

type PwStep = 'idle' | 'sending_otp' | 'otp_sent' | 'changing' | 'done'

export default function ProfilePage() {
  const { user } = useAuth()

  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const { refetch: refetchOrgConfig } = useOrgConfig()

  // ── security / password change ───────────────────────────────────────────
  const [pwStep, setPwStep] = useState<PwStep>('idle')
  const [currentPw, setCurrentPw] = useState('')
  const [otp, setOtp] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  // ── profile ──────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  // ── org ──────────────────────────────────────────────────────────────────
  const [orgConfig, setOrgConfig] = useState<OrgConfig | null>(null)
  const [orgLoading, setOrgLoading] = useState(true)

  const [editingOrgName, setEditingOrgName] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgNameSaving, setOrgNameSaving] = useState(false)

  const [editingSlug, setEditingSlug] = useState(false)
  const [slug, setSlug] = useState('')
  const [slugError, setSlugError] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  // Auto-derive slug from org name when user is editing the name
  const [orgNameSlugStatus, setOrgNameSlugStatus] = useState<SlugStatus>('idle')
  const [derivedSlugForName, setDerivedSlugForName] = useState('')
  const orgNameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Slug-field availability status (for the dedicated slug edit section)
  const [slugFieldStatus, setSlugFieldStatus] = useState<SlugStatus>('idle')
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    orgConfigApi.get()
      .then(cfg => {
        setOrgConfig(cfg)
        setOrgName(cfg.org_name || cfg.display_name)
        setSlug(cfg.slug)
      })
      .catch(() => {})
      .finally(() => setOrgLoading(false))
  }, [])

  // When editing org name: auto-derive + check slug availability
  const checkOrgNameSlug = useCallback(async (name: string) => {
    const candidate = _autoSlug(name)
    if (!candidate || !_SLUG_RE.test(candidate)) {
      setOrgNameSlugStatus('idle')
      setDerivedSlugForName('')
      return
    }
    setOrgNameSlugStatus('checking')
    try {
      const res = await orgConfigApi.checkSlug(candidate)
      if (res.available) {
        setDerivedSlugForName(candidate)
        setOrgNameSlugStatus('available')
      } else {
        const fallback = _appendSuffix(candidate)
        setDerivedSlugForName(fallback)
        setOrgNameSlugStatus('available')
      }
    } catch {
      setOrgNameSlugStatus('idle')
      setDerivedSlugForName('')
    }
  }, [])

  useEffect(() => {
    if (!editingOrgName) return
    if (orgNameCheckTimer.current) clearTimeout(orgNameCheckTimer.current)
    if (!orgName.trim() || orgConfig?.slug) {
      // Don't auto-suggest if they already have a slug
      setOrgNameSlugStatus('idle')
      setDerivedSlugForName('')
      return
    }
    orgNameCheckTimer.current = setTimeout(() => checkOrgNameSlug(orgName), 450)
    return () => { if (orgNameCheckTimer.current) clearTimeout(orgNameCheckTimer.current) }
  }, [orgName, editingOrgName, orgConfig?.slug, checkOrgNameSlug])

  // When editing slug field directly: check availability
  const handleSlugFieldChange = (val: string) => {
    const lower = val.toLowerCase()
    setSlug(lower)
    setSlugError('')
    setSlugFieldStatus('checking')
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current)
    if (!lower) { setSlugFieldStatus('idle'); return }
    slugCheckTimer.current = setTimeout(async () => {
      try {
        const res = await orgConfigApi.checkSlug(lower)
        setSlugFieldStatus(res.available ? 'available' : 'taken')
      } catch {
        setSlugFieldStatus('idle')
      }
    }, 450)
  }

  const loadSuggestions = async () => {
    setLoadingSuggestions(true)
    try {
      const res = await orgConfigApi.suggestSlug()
      setSuggestions(res.suggestions)
    } catch {}
    finally { setLoadingSuggestions(false) }
  }

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

  const handleSaveOrgName = async () => {
    setOrgNameSaving(true)
    try {
      const trimmed = orgName.trim()
      const payload: { org_name: string; display_name: string; slug?: string } = {
        org_name: trimmed,
        display_name: trimmed,
      }
      // Auto-set slug if none exists yet — use the checked + resolved candidate
      if (!orgConfig?.slug && derivedSlugForName) {
        payload.slug = derivedSlugForName
        setSlug(derivedSlugForName)
      }
      const updated = await orgConfigApi.update(payload)
      setOrgConfig(updated)
      setOrgName(updated.org_name)
      if (updated.slug) setSlug(updated.slug)
      setEditingOrgName(false)
      setOrgNameSlugStatus('idle')
      setDerivedSlugForName('')
      refetchOrgConfig()
    } catch {}
    finally { setOrgNameSaving(false) }
  }

  const handleSaveSlug = async () => {
    setSlugError('')
    const trimmed = slug.trim().toLowerCase()
    if (!_SLUG_RE.test(trimmed)) {
      setSlugError('3–40 chars, lowercase letters, numbers and hyphens only, no leading/trailing hyphens.')
      return
    }
    setSlugSaving(true)
    try {
      const updated = await orgConfigApi.update({ slug: trimmed })
      setOrgConfig(updated)
      setSlug(updated.slug)
      setEditingSlug(false)
      setSuggestions([])
      refetchOrgConfig()
    } catch (e: any) {
      setSlugError(e?.response?.data?.detail ?? 'Failed to save slug')
    } finally { setSlugSaving(false) }
  }

  const handleRequestOtp = async () => {
    setPwError('')
    if (!currentPw) { setPwError('Enter your current password first'); return }
    setPwLoading(true)
    setPwStep('sending_otp')
    try {
      await authApi.requestSecurityOtp('change your password')
      setPwStep('otp_sent')
    } catch (e: unknown) {
      setPwError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to send code')
      setPwStep('idle')
    } finally {
      setPwLoading(false)
    }
  }

  const handleChangePassword = async () => {
    setPwError('')
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    if (!otp) { setPwError('Enter the security code from your email'); return }
    setPwLoading(true)
    setPwStep('changing')
    try {
      await authApi.changePassword(currentPw, newPw, otp)
      setPwStep('done')
      setCurrentPw(''); setNewPw(''); setConfirmPw(''); setOtp('')
    } catch (e: unknown) {
      setPwError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to change password')
      setPwStep('otp_sent')
    } finally {
      setPwLoading(false)
    }
  }

  if (!user) return null

  const role = user.role ?? 'viewer'
  const roleMeta = ROLE_META[role] ?? ROLE_META.viewer

  const visibleTabs = TABS.filter(t => !t.roles || t.roles.includes(role))

  return (
    <div className="max-w-2xl space-y-4">
      {/* ── User header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="w-14 h-14 rounded-full bg-brand-800 flex items-center justify-center flex-shrink-0 overflow-hidden ring-2 ring-gray-700">
          {user.avatar_url
            ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            : <User size={22} className="text-brand-300" />
          }
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{user.full_name || user.email}</div>
          <div className="text-xs text-gray-500 truncate">{user.email}</div>
          <div className={clsx('inline-flex items-center gap-1 mt-1 text-[11px] px-2 py-0.5 rounded-full border', roleMeta.color)}>
            {roleMeta.icon}{roleMeta.label}
          </div>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              activeTab === t.id
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Profile tab ──────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
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
                  <button onClick={handleSaveName} disabled={saving} className="p-2 text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button onClick={() => { setEditing(false); setFullName(user.full_name ?? ''); setSaveError('') }} className="p-2 text-gray-500 hover:text-gray-300">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">
                    {user.full_name || <span className="text-gray-600 italic">Not set</span>}
                  </span>
                  <button onClick={() => setEditing(true)} className="text-gray-600 hover:text-gray-400 transition-colors">
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Email */}
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
          </div>
        </div>
      )}

      {/* ── Workspace tab ────────────────────────────────────────────────── */}
      {activeTab === 'organisation' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-white">Workspace</h2>
            {orgConfig && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 uppercase tracking-wide">
                {orgConfig.org_type}
              </span>
            )}
          </div>

          {orgLoading ? (
            <div className="flex items-center gap-2 py-4 text-gray-600">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-4">
              {/* Org name */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Workspace name</label>
                {editingOrgName ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={orgName}
                        onChange={e => setOrgName(e.target.value)}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                        placeholder="e.g. Acme AI, My Research Lab"
                        autoFocus
                      />
                      <button onClick={handleSaveOrgName} disabled={orgNameSaving} className="p-2 text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                        {orgNameSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button onClick={() => { setEditingOrgName(false); setOrgName(orgConfig?.org_name || '') }} className="p-2 text-gray-500 hover:text-gray-300">
                        <X size={14} />
                      </button>
                    </div>
                    {/* Auto-derived slug preview — only shown when no slug exists yet */}
                    {!orgConfig?.slug && orgName.trim() && (
                      <div className="flex items-center gap-1.5 text-[11px] pl-1">
                        <Link2 size={10} className="text-gray-600 shrink-0" />
                        <span className="text-gray-600">Slug will be auto-set to</span>
                        {orgNameSlugStatus === 'checking' && (
                          <Loader2 size={10} className="animate-spin text-gray-500" />
                        )}
                        {derivedSlugForName && orgNameSlugStatus === 'available' && (
                          <>
                            <span className="font-mono text-brand-400">{derivedSlugForName}</span>
                            <Check size={9} className="text-emerald-500" />
                          </>
                        )}
                        {!derivedSlugForName && orgNameSlugStatus === 'idle' && (
                          <span className="font-mono text-gray-600">
                            {_autoSlug(orgName) || '…'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">
                      {orgConfig?.org_name || <span className="text-gray-600 italic">No workspace name set</span>}
                    </span>
                    <button onClick={() => setEditingOrgName(true)} className="text-gray-600 hover:text-gray-400 transition-colors">
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Slug */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">Workspace slug <span className="text-gray-700">(used in inference API URLs)</span></label>
                  {!editingSlug && (
                    <button
                      onClick={() => { setEditingSlug(true); loadSuggestions() }}
                      className="text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
                    >
                      Change slug
                    </button>
                  )}
                </div>

                {editingSlug ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={slug}
                          onChange={e => handleSlugFieldChange(e.target.value)}
                          className={clsx(
                            'w-full bg-gray-800 border rounded-lg px-3 py-2 pr-8 text-sm text-white font-mono focus:outline-none transition-colors',
                            slugFieldStatus === 'available'
                              ? 'border-emerald-700 focus:border-emerald-500'
                              : slugFieldStatus === 'taken'
                                ? 'border-amber-700 focus:border-amber-500'
                                : 'border-gray-700 focus:border-brand-500'
                          )}
                          placeholder="e.g. mike-a3f7b2c1"
                          autoFocus
                        />
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                          {slugFieldStatus === 'checking' && <Loader2 size={12} className="animate-spin text-gray-500" />}
                          {slugFieldStatus === 'available' && <Check size={12} className="text-emerald-400" />}
                          {slugFieldStatus === 'taken' && <X size={12} className="text-amber-400" />}
                        </div>
                      </div>
                      <button onClick={handleSaveSlug} disabled={slugSaving || slugFieldStatus === 'checking' || slugFieldStatus === 'taken'} className="p-2 text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                        {slugSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button onClick={() => { setEditingSlug(false); setSlug(orgConfig?.slug || ''); setSlugError(''); setSuggestions([]); setSlugFieldStatus('idle') }} className="p-2 text-gray-500 hover:text-gray-300">
                        <X size={14} />
                      </button>
                    </div>
                    {slugFieldStatus === 'available' && slug && (
                      <p className="text-[11px] text-emerald-500 flex items-center gap-1"><Check size={9} /> Available</p>
                    )}
                    {slugFieldStatus === 'taken' && (
                      <p className="text-[11px] text-amber-500">That slug is already taken — try a different one.</p>
                    )}
                    {/* Warn when the new slug differs from the saved slug */}
                    {orgConfig?.slug && slug.trim() !== orgConfig.slug && slug.trim().length > 0 && (
                      <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2.5">
                        <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                          <p className="text-xs text-amber-300 font-medium">Changing your slug will break existing integrations</p>
                          <p className="text-[11px] text-amber-500/80">
                            Any app or script using{' '}
                            <code className="font-mono text-amber-400">/inference/{orgConfig.slug}/…</code>{' '}
                            will stop working. The old slug stays active as a deprecated alias, but you should update all integrations to use the new URL.
                          </p>
                        </div>
                      </div>
                    )}
                    {slugError && <p className="text-xs text-red-400">{slugError}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-gray-600">Suggestions:</span>
                      {loadingSuggestions ? (
                        <Loader2 size={11} className="animate-spin text-gray-600" />
                      ) : (
                        suggestions.map(s => (
                          <button
                            key={s}
                            onClick={() => { setSlug(s); setSlugError('') }}
                            className="text-[11px] px-2 py-0.5 bg-gray-800 border border-gray-700 text-brand-400 hover:bg-gray-700 rounded-full font-mono transition-colors"
                          >
                            {s}
                          </button>
                        ))
                      )}
                      <button onClick={loadSuggestions} className="text-[10px] text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors">
                        <RefreshCw size={10} /> more
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm font-mono text-brand-400 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2">
                    {orgConfig?.slug || <span className="text-gray-600 italic font-sans text-xs">No slug set — click "Change slug" to set one</span>}
                  </div>
                )}
              </div>

              {/* Inference URL preview */}
              {orgConfig?.slug && (
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500 flex items-center gap-1"><Link2 size={10} /> Inference URL</label>
                  <div className="bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2">
                    <code className="text-xs text-gray-400">
                      POST /api/v1/inference/<span className="text-brand-400">{orgConfig.slug}</span>/{'<trainer_name>'}
                    </code>
                  </div>
                </div>
              )}

              {/* Deprecated (old) slugs still active as aliases */}
              {orgConfig?.previous_slugs && orgConfig.previous_slugs.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock size={10} /> Legacy slug aliases
                    <span className="ml-1 text-[10px] text-amber-500/70 font-normal">(deprecated — still routed)</span>
                  </label>
                  <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-3 py-2 space-y-1">
                    {orgConfig.previous_slugs.map(s => (
                      <div key={s} className="flex items-center gap-2">
                        <code className="text-[11px] font-mono text-amber-400/70 line-through">{s}</code>
                        <span className="text-[10px] text-amber-600/60">→ still works, update integrations</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workspace ID — read-only */}
              {user.org_id && user.org_id !== 'system' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Workspace ID</label>
                  <div className="text-xs text-gray-600 bg-gray-800/50 border border-gray-800 rounded-lg px-3 py-2 font-mono select-all">
                    {user.org_id}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Security tab ─────────────────────────────────────────────────── */}
      {activeTab === 'security' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-white">Security</h2>
          </div>

          {/* Password change */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound size={13} className="text-gray-500" />
              <span className="text-xs font-medium text-gray-300">Change password</span>
            </div>

            {pwStep === 'done' ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-950/30 border border-emerald-900 rounded-xl px-4 py-3">
                <Check size={14} /> Password changed successfully.
                <button onClick={() => setPwStep('idle')} className="ml-auto text-xs text-gray-500 hover:text-gray-300">
                  Change again
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {pwError && (
                  <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{pwError}</p>
                )}

                {/* Step 1: current password + request OTP */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Current password</label>
                  <input
                    type="password"
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    disabled={pwStep === 'otp_sent' || pwStep === 'changing'}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 disabled:opacity-50"
                    placeholder="Current password"
                  />
                </div>

                {pwStep === 'idle' && (
                  <button
                    onClick={handleRequestOtp}
                    disabled={pwLoading || !currentPw}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-700 hover:bg-brand-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {pwLoading ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                    Send security code to {user.email}
                  </button>
                )}

                {/* Step 2: OTP + new password */}
                {(pwStep === 'otp_sent' || pwStep === 'changing') && (
                  <>
                    <div className="bg-brand-950/30 border border-brand-800/40 rounded-lg px-4 py-3 text-xs text-brand-300">
                      A 6-digit security code was sent to <strong>{user.email}</strong>. Enter it below to continue.
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500">Security code</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otp}
                        onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-brand-500"
                        placeholder="000000"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500">New password</label>
                      <input
                        type="password"
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                        placeholder="At least 8 characters"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500">Confirm new password</label>
                      <input
                        type="password"
                        value={confirmPw}
                        onChange={e => setConfirmPw(e.target.value)}
                        className={clsx(
                          'w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none',
                          confirmPw && newPw !== confirmPw ? 'border-red-700 focus:border-red-500' : 'border-gray-700 focus:border-brand-500',
                        )}
                        placeholder="Repeat new password"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleChangePassword}
                        disabled={pwLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        {pwLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Change password
                      </button>
                      <button
                        onClick={() => { setPwStep('idle'); setPwError(''); setOtp(''); setNewPw(''); setConfirmPw('') }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Account info */}
          <div className="border-t border-gray-800 pt-5 space-y-3">
            <span className="text-xs font-medium text-gray-500">Account</span>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-300">{user.email}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Account status</span>
              <span className="text-emerald-400 flex items-center gap-1"><Check size={10} /> Active &amp; verified</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Org ID</span>
              <span className="text-gray-600 font-mono">{user.org_id || '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Role & Access tab ────────────────────────────────────────────── */}
      {activeTab === 'access' && (
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
                  <li key={p} className={clsx('text-xs flex items-start gap-1.5', p.startsWith('Everything') ? 'text-brand-400' : 'text-gray-400')}>
                    <span className="mt-0.5 text-emerald-500">&#10003;</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
