import { useState } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import StatusBadge from './StatusBadge'
import { useAuth } from '../context/AuthContext'
import { trainersApi } from '../api/trainers'
import { Brain, Tag, ChevronRight, Search, Trash2, Loader2, Globe, Lock, LayoutGrid, List, ChevronLeft } from 'lucide-react'
import clsx from 'clsx'

const PAGE_SIZE = 12

interface Props {
  deployments: ModelDeployment[]
  onSelect: (dep: ModelDeployment) => void
  onDelete: (id: string) => void
  onUpdated?: (dep: ModelDeployment) => void
  loading: boolean
}

type FilterType = 'all' | 'active' | 'inactive' | 'archived'

// Priority order for display on cards: show mAP/Precision/Recall first
const METRIC_PRIORITY = ['map50', 'map50-95', 'precision', 'recall', 'f1', 'accuracy']

function prioritisedMetrics(metrics: Record<string, number>): [string, number][] {
  const entries = Object.entries(metrics)
  const priority: [string, number][] = []
  const rest: [string, number][] = []
  for (const e of entries) {
    if (METRIC_PRIORITY.includes(e[0].toLowerCase())) priority.push(e)
    else rest.push(e)
  }
  return [...priority, ...rest].slice(0, 3)
}

// Deduplicate by trainer_name — keep the default, or highest version number
function dedupe(deployments: ModelDeployment[]): ModelDeployment[] {
  const map = new Map<string, ModelDeployment>()
  for (const d of deployments) {
    const existing = map.get(d.trainer_name)
    if (!existing) { map.set(d.trainer_name, d); continue }
    // Prefer is_default; break ties by highest mlflow_model_version
    const dv = parseInt(d.mlflow_model_version || '0', 10)
    const ev = parseInt(existing.mlflow_model_version || '0', 10)
    if (d.is_default || (!existing.is_default && dv > ev)) {
      map.set(d.trainer_name, d)
    }
  }
  return Array.from(map.values())
}

const METRIC_LABELS: Record<string, string> = {
  map50: 'mAP@50', 'map50-95': 'mAP@50-95', precision: 'Precision',
  recall: 'Recall', f1: 'F1', accuracy: 'Accuracy',
}
function metricLabel(k: string) { return METRIC_LABELS[k.toLowerCase()] ?? k }

export default function ModelGrid({ deployments, onSelect, onDelete, onUpdated, loading }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card')
  const [currentPage, setCurrentPage] = useState(1)

  // One card per trainer — pick the default/latest version
  const unique = dedupe(deployments)

  // Derive unique categories from all deployments
  const categories = Array.from(
    new Map(
      unique
        .filter(d => d.category?.key)
        .map(d => [d.category.key, d.category.label || d.category.key])
    ).entries()
  )

  const filtered = unique.filter(d => {
    const matchStatus = filter === 'all' || d.status === filter
    const matchSearch = !search || d.trainer_name.toLowerCase().includes(search.toLowerCase()) ||
      d.mlflow_model_name.toLowerCase().includes(search.toLowerCase())
    const matchCategory = !category || d.category?.key === category
    return matchStatus && matchSearch && matchCategory
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const counts = {
    all: unique.length,
    active: unique.filter(d => d.status === 'active').length,
    inactive: unique.filter(d => d.status === 'inactive').length,
    archived: unique.filter(d => d.status === 'archived').length,
  }

  const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all', label: `All (${counts.all})` },
    { id: 'active', label: `Active (${counts.active})` },
    { id: 'inactive', label: `Inactive (${counts.inactive})` },
    { id: 'archived', label: `Archived (${counts.archived})` },
  ]

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => { setFilter(f.id); setCurrentPage(1) }}
              className={clsx('px-3 py-1.5 text-xs rounded-lg font-medium transition-colors', f.id === filter
                ? 'bg-brand-600 text-white'
                : 'text-gray-500 hover:text-gray-300'
              )}
            >{f.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
              placeholder="Search models…"
              className="pl-8 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm text-gray-200 focus:outline-none focus:border-brand-500 w-48"
            />
          </div>
          {/* View toggle */}
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-xl p-1 gap-0.5">
            <button onClick={() => setViewMode('card')}
              title="Card view"
              className={clsx('p-1.5 rounded-lg transition-colors', viewMode === 'card' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
              <LayoutGrid size={13} />
            </button>
            <button onClick={() => setViewMode('table')}
              title="Table view"
              className={clsx('p-1.5 rounded-lg transition-colors', viewMode === 'table' ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
              <List size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCategory(null)}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              !category ? 'bg-brand-900/50 border-brand-700 text-brand-300' : 'bg-gray-900 border-gray-700 text-gray-500 hover:border-gray-600'
            )}>All categories</button>
          {categories.map(([key, label]) => (
            <button key={key} onClick={() => setCategory(category === key ? null : key)}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                category === key ? 'bg-brand-900/50 border-brand-700 text-brand-300' : 'bg-gray-900 border-gray-700 text-gray-500 hover:border-gray-600'
              )}>{label}</button>
          ))}
        </div>
      )}

      {/* Models count */}
      <div className="text-[11px] text-gray-600">
        {filtered.length} model{filtered.length !== 1 ? 's' : ''}
        {filtered.length > PAGE_SIZE && ` · page ${safePage} of ${totalPages}`}
      </div>

      {/* Grid / Table */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-gray-900 rounded-2xl h-48 border border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <Brain size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No models found</p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paginated.map(dep => (
            <ModelCard key={dep.id} dep={dep} onClick={() => onSelect(dep)} onDelete={onDelete}
              isAdmin={isAdmin} onUpdated={onUpdated} />
          ))}
        </div>
      ) : (
        /* Table view */
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Model</th>
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-600 uppercase tracking-widest font-semibold hidden sm:table-cell">Version</th>
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-600 uppercase tracking-widest font-semibold">Status</th>
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-600 uppercase tracking-widest font-semibold hidden md:table-cell">Metrics</th>
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-600 uppercase tracking-widest font-semibold hidden lg:table-cell">Source</th>
                <th className="px-4 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {paginated.map(dep => {
                const topMetrics = prioritisedMetrics(dep.metrics).slice(0, 2)
                return (
                  <tr key={dep.id} onClick={() => onSelect(dep)}
                    className="hover:bg-gray-900/60 cursor-pointer transition-colors group">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100 group-hover:text-white text-sm">{dep.mlflow_model_name}</div>
                      <div className="text-[10px] text-gray-600 font-mono mt-0.5">{dep.trainer_name}</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-[10px] bg-brand-900/50 text-brand-400 border border-brand-800/40 px-1.5 py-0.5 rounded-full font-mono">
                        v{dep.mlflow_model_version}
                      </span>
                      {dep.is_default && <span className="ml-1.5 text-[9px] text-emerald-500">default</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={dep.status} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {topMetrics.length > 0 ? (
                        <div className="flex items-center gap-3">
                          {topMetrics.map(([k, v]) => (
                            <div key={k} className="text-xs">
                              <span className="text-brand-400 font-semibold">
                                {typeof v === 'number' && v <= 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)}
                              </span>
                              <span className="text-gray-600 ml-1">{metricLabel(k)}</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-gray-700 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[10px] text-gray-600">{dep.source_type.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {isAdmin && (
                          <button onClick={async e => {
                            e.stopPropagation()
                            const newVis = dep.visibility === 'viewer' ? 'engineer' : 'viewer'
                            try { const u = await trainersApi.setVisibility(dep.id, newVis); onUpdated?.(u) } catch {}
                          }} title="Toggle visibility" className="p-1 text-gray-600 hover:text-brand-400 rounded">
                            {dep.visibility === 'viewer' ? <Lock size={11} /> : <Globe size={11} />}
                          </button>
                        )}
                        <button onClick={async e => {
                          e.stopPropagation()
                          if (!confirm(`Delete "${dep.mlflow_model_name}"?`)) return
                          await onDelete(dep.id)
                        }} className="p-1 text-gray-600 hover:text-red-400 rounded">
                          <Trash2 size={11} />
                        </button>
                        <ChevronRight size={12} className="text-gray-600 group-hover:text-brand-400" />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
            <ChevronLeft size={12} /> Prev
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                acc.push(p); return acc
              }, [])
              .map((p, i) => p === '...'
                ? <span key={`e${i}`} className="px-1 text-xs text-gray-600">…</span>
                : <button key={p} onClick={() => setCurrentPage(p as number)}
                    className={clsx('w-7 h-7 text-xs rounded-lg transition-colors',
                      p === safePage ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
                    {p}
                  </button>
              )}
          </div>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
            Next <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

function ModelCard({ dep, onClick, onDelete, isAdmin, onUpdated }: {
  dep: ModelDeployment
  onClick: () => void
  onDelete: (id: string) => void
  isAdmin?: boolean
  onUpdated?: (dep: ModelDeployment) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [togglingVis, setTogglingVis] = useState(false)
  const hasMetrics = Object.keys(dep.metrics ?? {}).length > 0

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete deployment "${dep.mlflow_model_name}"?`)) return
    setDeleting(true)
    try { await onDelete(dep.id) }
    finally { setDeleting(false) }
  }

  const handleToggleVisibility = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newVis = dep.visibility === 'viewer' ? 'engineer' : 'viewer'
    setTogglingVis(true)
    try {
      const updated = await trainersApi.setVisibility(dep.id, newVis)
      onUpdated?.(updated)
    } catch {}
    finally { setTogglingVis(false) }
  }

  return (
    <div onClick={onClick} className="cursor-pointer text-left bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-brand-700 rounded-2xl p-5 transition-all group relative">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-brand-900/40 border border-brand-800/50 flex items-center justify-center">
          <Brain size={18} className="text-brand-400" />
        </div>
        <div className="flex items-center gap-2">
          {dep.is_default && (
            <span className="text-[9px] uppercase tracking-widest bg-brand-900/50 text-brand-400 px-2 py-0.5 rounded-full border border-brand-800">default</span>
          )}
          <StatusBadge status={dep.status} />
        </div>
      </div>

      <h3 className="font-bold text-gray-100 text-sm mb-0.5 group-hover:text-white">{dep.mlflow_model_name}</h3>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-600 font-mono">{dep.trainer_name}</span>
        <span className="text-[10px] bg-brand-900/50 text-brand-400 border border-brand-800/40 px-1.5 py-0.5 rounded-full font-mono">
          v{dep.mlflow_model_version}
        </span>
        {dep.is_default && (
          <span className="text-[9px] uppercase tracking-widest text-emerald-500">latest</span>
        )}
      </div>

      {hasMetrics && (
        <div className="flex flex-wrap gap-3 mb-3">
          {prioritisedMetrics(dep.metrics).map(([k, v]) => (
            <div key={k}>
              <div className="text-sm font-bold text-brand-400">
                {typeof v === 'number' && v <= 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)}
              </div>
              <div className="text-[10px] text-gray-600">{metricLabel(k)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <Tag size={10} /> {dep.source_type.replace(/_/g, ' ')}
          </div>
          {dep.category?.label && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
              {dep.category.label}
            </span>
          )}
          {/* Visibility badge */}
          {dep.visibility === 'viewer' ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/20 text-emerald-500 border border-emerald-800/30">
              <Globe size={8} /> Public
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-600 border border-gray-700">
              <Lock size={8} /> Engineers
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Admin visibility toggle */}
          {isAdmin && (
            <button onClick={handleToggleVisibility} disabled={togglingVis}
              title={dep.visibility === 'viewer' ? 'Restrict to engineers' : 'Make public (all users)'}
              className="p-1.5 rounded-lg text-gray-700 hover:text-brand-400 hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40">
              {togglingVis ? <Loader2 size={12} className="animate-spin" /> : dep.visibility === 'viewer' ? <Lock size={12} /> : <Globe size={12} />}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-lg text-gray-700 hover:text-red-400 hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
          <ChevronRight size={14} className="text-gray-600 group-hover:text-brand-400 transition-colors" />
        </div>
      </div>
    </div>
  )
}
