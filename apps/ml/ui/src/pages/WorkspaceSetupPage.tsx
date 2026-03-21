/**
 * First-login workspace setup wizard.
 * Shown once when is_onboarded = false. Lets the user set their workspace
 * name and the slug used in all inference API URLs before entering the app.
 *
 * Slug behaviour:
 *  - Auto-derived from workspace name as the user types (debounced 450ms)
 *  - Availability checked via GET /org/config/check-slug
 *  - If taken → appends a 4-digit random number automatically
 *  - User can override the slug manually at any time
 *  - If user clears the slug field it reverts to auto-derive mode
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOrgConfig } from '../context/OrgConfigContext'
import { orgConfigApi } from '../api/orgConfig'
import { authApi } from '../api/auth'
import {
  Building2, Link2, RefreshCw, Check, Loader2, ChevronRight, Sparkles, X,
} from 'lucide-react'
import clsx from 'clsx'
import Logo from '../components/Logo'

const _SLUG_RE = /^[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]$/

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
}

function appendSuffix(base: string): string {
  const suffix = Math.floor(1000 + Math.random() * 9000).toString() // 4-digit
  const trimmed = base.slice(0, 24).replace(/-+$/, '')
  return `${trimmed}-${suffix}`
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken'

interface Props {
  onComplete: () => void
}

export default function WorkspaceSetupPage({ onComplete }: Props) {
  const { user, setOnboarded } = useAuth()
  const { refetch: refetchOrgConfig } = useOrgConfig()

  const [workspaceName, setWorkspaceName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false) // true when user typed in slug field
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')
  const [slugError, setSlugError] = useState('')
  const [saving, setSaving] = useState(false)

  // Debounce timer ref
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check availability and auto-resolve conflicts
  const checkAndResolve = useCallback(async (candidate: string) => {
    if (!candidate || !_SLUG_RE.test(candidate)) {
      setSlugStatus('idle')
      return
    }
    setSlugStatus('checking')
    try {
      const res = await orgConfigApi.checkSlug(candidate)
      if (res.available) {
        setSlugStatus('available')
        setSlug(candidate)
      } else {
        // Auto-append suffix so user has a ready-to-use alternative
        const fallback = appendSuffix(candidate)
        setSlug(fallback)
        setSlugStatus('available') // fallback is fresh random — treat as available
      }
    } catch {
      setSlugStatus('idle')
    }
  }, [])

  // Pre-fill from existing OrgConfig on mount
  useEffect(() => {
    orgConfigApi.get()
      .then(cfg => {
        const name = (cfg.org_name || cfg.display_name || '').replace(/_org$/, '') || ''
        setWorkspaceName(name)
        if (cfg.slug) {
          setSlug(cfg.slug)
          setSlugManual(true) // already set — don't overwrite
          setSlugStatus('available')
        }
      })
      .catch(() => {})
  }, [])

  // Auto-derive slug from workspace name (only in auto mode)
  useEffect(() => {
    if (slugManual) return
    if (checkTimer.current) clearTimeout(checkTimer.current)

    const derived = deriveSlug(workspaceName)
    if (!derived) {
      setSlug('')
      setSlugStatus('idle')
      return
    }
    // Optimistically show derived slug while debounce runs
    setSlug(derived)
    setSlugStatus('checking')

    checkTimer.current = setTimeout(() => {
      checkAndResolve(derived)
    }, 450)

    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [workspaceName, slugManual, checkAndResolve])

  // Check availability when user manually edits slug (debounced)
  const handleSlugChange = (val: string) => {
    const lower = val.toLowerCase()
    setSlug(lower)
    setSlugError('')
    setSlugManual(true)

    if (checkTimer.current) clearTimeout(checkTimer.current)
    if (!lower) {
      setSlugManual(false) // cleared → revert to auto mode
      setSlugStatus('idle')
      return
    }
    setSlugStatus('checking')
    checkTimer.current = setTimeout(() => {
      checkAndResolve(lower)
    }, 450)
  }

  const handleSave = async () => {
    setSlugError('')
    const trimmedSlug = slug.trim().toLowerCase()
    const trimmedName = workspaceName.trim()

    if (!trimmedName) {
      setSlugError('Workspace name is required.')
      return
    }
    if (trimmedSlug && !_SLUG_RE.test(trimmedSlug)) {
      setSlugError('Slug: 3–40 chars, lowercase letters, numbers and hyphens only.')
      return
    }

    setSaving(true)
    try {
      await orgConfigApi.update({
        org_name: trimmedName,
        display_name: trimmedName,
        ...(trimmedSlug ? { slug: trimmedSlug } : {}),
      })
      await authApi.updateProfile({ is_onboarded: true })
      setOnboarded()
      refetchOrgConfig()
      onComplete()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSlugError(detail ?? 'Failed to save workspace settings.')
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    setSaving(true)
    try { await authApi.updateProfile({ is_onboarded: true }) } catch {}
    setOnboarded()
    onComplete()
  }

  const canSubmit = !saving && workspaceName.trim().length > 0 && slugStatus !== 'checking'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        {/* Logo + header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <Logo size="md" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Set up your workspace</h1>
            <p className="text-sm text-gray-500 mt-1">
              Choose a name and URL slug for your inference endpoints.
              {user?.full_name ? ` Welcome, ${user.full_name.split(' ')[0]}.` : ''}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">

          {/* Workspace name */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <Building2 size={11} />
              Workspace name
            </label>
            <input
              type="text"
              value={workspaceName}
              onChange={e => setWorkspaceName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition-colors"
              placeholder="e.g. Acme AI, My Research Lab"
              autoFocus
            />
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <Link2 size={11} />
                Workspace slug
                <span className="text-gray-600 font-normal">(API URLs)</span>
              </label>
              {/* Show "auto" badge when slug is being auto-derived */}
              {!slugManual && workspaceName && (
                <span className="text-[10px] text-brand-500/70 bg-brand-900/20 border border-brand-800/30 px-1.5 py-0.5 rounded-full">
                  auto
                </span>
              )}
              {/* Allow resetting to auto mode when manually overridden */}
              {slugManual && (
                <button
                  onClick={() => { setSlugManual(false); setSlug(''); setSlugStatus('idle') }}
                  className="text-[10px] text-gray-600 hover:text-brand-400 flex items-center gap-0.5 transition-colors"
                >
                  <RefreshCw size={9} /> reset to auto
                </button>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={slug}
                onChange={e => handleSlugChange(e.target.value)}
                className={clsx(
                  'w-full bg-gray-800 border rounded-xl px-3 py-2.5 pr-9 text-sm text-white font-mono placeholder-gray-600 focus:outline-none transition-colors',
                  slugStatus === 'available' && slug
                    ? 'border-emerald-700 focus:border-emerald-500'
                    : slugStatus === 'taken'
                      ? 'border-amber-700 focus:border-amber-500'
                      : 'border-gray-700 focus:border-brand-500'
                )}
                placeholder="auto-generated from name"
              />
              {/* Status icon */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {slugStatus === 'checking' && (
                  <Loader2 size={13} className="animate-spin text-gray-500" />
                )}
                {slugStatus === 'available' && slug && (
                  <Check size={13} className="text-emerald-400" />
                )}
                {slugStatus === 'taken' && (
                  <X size={13} className="text-amber-400" />
                )}
              </div>
            </div>

            {/* Status message */}
            {slugStatus === 'available' && slug && (
              <p className="text-[11px] text-emerald-500 flex items-center gap-1">
                <Check size={10} /> Available
              </p>
            )}
            {slugStatus === 'taken' && (
              <p className="text-[11px] text-amber-500">
                That slug is taken — try the one above or edit it.
              </p>
            )}
            {slugError && (
              <p className="text-xs text-red-400">{slugError}</p>
            )}
          </div>

          {/* Live inference URL preview */}
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-2.5 space-y-1">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-medium">Your inference URL</p>
            <code className="text-xs text-gray-400 break-all">
              POST /api/v1/inference/
              {slug
                ? <span className="text-brand-400 font-semibold">{slug}</span>
                : <span className="text-gray-600 italic">{'<slug>'}</span>
              }
              /<span className="text-gray-500">your_model</span>
            </code>
          </div>

          {/* Submit */}
          <button
            onClick={handleSave}
            disabled={!canSubmit}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all',
              !canSubmit
                ? 'bg-brand-700/40 text-brand-400/50 cursor-not-allowed'
                : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40'
            )}
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Saving…</>
            ) : slugStatus === 'checking' ? (
              <><Loader2 size={14} className="animate-spin" /> Checking slug…</>
            ) : (
              <><Sparkles size={14} /> Start building <ChevronRight size={14} /></>
            )}
          </button>
        </div>

        {/* Skip */}
        <div className="text-center">
          <button
            onClick={handleSkip}
            disabled={saving}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-40"
          >
            Skip for now — I'll set this up in Profile settings
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5">
          <div className="w-5 h-1 rounded-full bg-brand-500" />
          <div className="w-1.5 h-1 rounded-full bg-gray-700" />
          <div className="w-1.5 h-1 rounded-full bg-gray-700" />
        </div>
      </div>
    </div>
  )
}
