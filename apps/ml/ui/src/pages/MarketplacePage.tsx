import { useState, useEffect } from 'react'
import { marketplaceApi } from '../api/marketplace'
import {
  Search, Brain, Download, Copy, RefreshCw, AlertTriangle,
  Tag, Globe, Lock, ShieldCheck, Star,
} from 'lucide-react'
import clsx from 'clsx'

interface MarketplaceTrainer {
  id: string
  name: string
  full_name: string
  namespace: string
  description: string
  framework: string
  version: string
  author: string
  author_email: string
  author_url: string
  commercial: string
  downloadable: boolean
  protect_model: boolean
  icon_url: string
  license: string
  tags: Record<string, string> | string[]
  category?: { key: string; label: string }
  org_id: string
}

const FRAMEWORK_BADGE: Record<string, string> = {
  sklearn:  'bg-blue-900/30 text-blue-400 border-blue-800/40',
  pytorch:  'bg-orange-900/30 text-orange-400 border-orange-800/40',
  torch:    'bg-orange-900/30 text-orange-400 border-orange-800/40',
  custom:   'bg-gray-800 text-gray-400 border-gray-700',
  xgboost:  'bg-green-900/30 text-green-400 border-green-800/40',
  keras:    'bg-red-900/30 text-red-400 border-red-800/40',
}

function FrameworkBadge({ fw }: { fw: string }) {
  const cls = FRAMEWORK_BADGE[fw.toLowerCase()] ?? FRAMEWORK_BADGE.custom
  return (
    <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize', cls)}>
      {fw}
    </span>
  )
}

function tagList(tags: Record<string, string> | string[] | undefined): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  return Object.keys(tags)
}

function TrainerCard({
  trainer,
  onClone,
  cloning,
}: {
  trainer: MarketplaceTrainer
  onClone: (id: string) => void
  cloning: string | null
}) {
  const tags = tagList(trainer.tags)
  const isSystem = trainer.namespace === 'system' || !trainer.org_id

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-brand-400 flex-shrink-0">
            <Brain size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{trainer.name.replace(/_/g, ' ')}</div>
            <div className="text-[10px] text-gray-500 font-mono truncate">{trainer.full_name || `${trainer.namespace}/${trainer.name}`}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isSystem && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-900/30 text-brand-400 border border-brand-800/40">
              official
            </span>
          )}
          {trainer.commercial === 'private' && <Lock size={11} className="text-gray-600" />}
          {trainer.commercial === 'public' && <Globe size={11} className="text-gray-600" />}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-400 leading-relaxed flex-1 line-clamp-3">
        {trainer.description || 'No description provided.'}
      </p>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map(t => (
            <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              <Tag size={8} /> {t}
            </span>
          ))}
          {tags.length > 4 && (
            <span className="text-[10px] text-gray-600">+{tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-800">
        <div className="flex items-center gap-2">
          <FrameworkBadge fw={trainer.framework} />
          {trainer.protect_model && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
              <ShieldCheck size={10} /> protected
            </span>
          )}
          {trainer.license && (
            <span className="text-[10px] text-gray-600">{trainer.license}</span>
          )}
        </div>
        <button
          onClick={() => onClone(trainer.id)}
          disabled={cloning === trainer.id}
          title="Clone into my workspace"
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg transition-colors disabled:opacity-40"
        >
          {cloning === trainer.id
            ? <RefreshCw size={11} className="animate-spin" />
            : <Copy size={11} />}
          Clone
        </button>
      </div>
    </div>
  )
}

export default function MarketplacePage() {
  const [trainers, setTrainers] = useState<MarketplaceTrainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [cloning, setCloning] = useState<string | null>(null)
  const [cloneMsg, setCloneMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await marketplaceApi.listTrainers()
      setTrainers(data.items ?? data ?? [])
    } catch {
      setError('Failed to load marketplace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleClone = async (id: string) => {
    setCloning(id)
    setCloneMsg(null)
    try {
      const res = await marketplaceApi.cloneTrainer(id)
      setCloneMsg({ ok: true, text: `Cloned as "${res.name}" — available in your Neurals tab.` })
    } catch {
      setCloneMsg({ ok: false, text: 'Clone failed. Please try again.' })
    } finally {
      setCloning(null)
      setTimeout(() => setCloneMsg(null), 4000)
    }
  }

  const filtered = search
    ? trainers.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.framework.toLowerCase().includes(search.toLowerCase()) ||
        tagList(t.tags).some(tag => tag.toLowerCase().includes(search.toLowerCase()))
      )
    : trainers

  const official  = filtered.filter(t => t.namespace === 'system' || !t.org_id)
  const community = filtered.filter(t => t.namespace !== 'system' && !!t.org_id)

  return (
    <div className="space-y-6 max-w-6xl p-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Neural Marketplace</h1>
          <p className="text-xs text-gray-500 mt-0.5">Browse and clone public neurals into your workspace</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Clone toast */}
      {cloneMsg && (
        <div className={clsx(
          'flex items-center gap-2 text-sm px-4 py-3 rounded-xl border',
          cloneMsg.ok
            ? 'bg-emerald-900/20 border-emerald-800/40 text-emerald-400'
            : 'bg-red-900/20 border-red-800/40 text-red-400'
        )}>
          {cloneMsg.ok ? <Star size={14} /> : <AlertTriangle size={14} />}
          {cloneMsg.text}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search neurals, frameworks, tags…"
          className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-8 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-600"
        />
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Official trainers */}
      {!loading && official.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold text-gray-600 uppercase tracking-widest mb-3">
            Official ({official.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {official.map(t => (
              <TrainerCard key={t.id} trainer={t} onClone={handleClone} cloning={cloning} />
            ))}
          </div>
        </section>
      )}

      {/* Community trainers */}
      {!loading && community.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold text-gray-600 uppercase tracking-widest mb-3">
            Community ({community.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {community.map(t => (
              <TrainerCard key={t.id} trainer={t} onClone={handleClone} cloning={cloning} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <Brain size={32} className="mx-auto text-gray-700 mb-3" />
          <p className="text-gray-500 text-sm font-medium">
            {search ? 'No neurals match your search' : 'No public neurals available yet'}
          </p>
          <p className="text-gray-600 text-xs mt-1">Upload a neural with Commercial: public to list it here.</p>
        </div>
      )}
    </div>
  )
}
