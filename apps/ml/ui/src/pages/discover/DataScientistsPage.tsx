import { useState, useEffect, useMemo } from 'react'
import { Search, X, ChevronRight, Loader2, Brain, Database, Star, Users, ArrowLeft, ExternalLink, Cpu } from 'lucide-react'
import clsx from 'clsx'
import { discoverApi, type DiscoverEngineer, type DiscoverEngineerDetail, type DiscoverModel, type DiscoverDataset } from '@/api/discover'

// ── Framework colour map ───────────────────────────────────────────────────────

const FW_COLORS: Record<string, string> = {
  pytorch:      'bg-orange-900/50 text-orange-300 border-orange-700/50',
  tensorflow:   'bg-amber-900/50 text-amber-300 border-amber-700/50',
  sklearn:      'bg-sky-900/50 text-sky-300 border-sky-700/50',
  xgboost:      'bg-lime-900/50 text-lime-300 border-lime-700/50',
  yolo:         'bg-violet-900/50 text-violet-300 border-violet-700/50',
  transformers: 'bg-pink-900/50 text-pink-300 border-pink-700/50',
  keras:        'bg-red-900/50 text-red-300 border-red-700/50',
  onnx:         'bg-cyan-900/50 text-cyan-300 border-cyan-700/50',
}
const fwColor = (fw: string) => FW_COLORS[fw.toLowerCase()] ?? 'bg-gray-800 text-gray-400 border-gray-700'

const FRAMEWORK_OPTIONS = ['PyTorch', 'TensorFlow', 'Sklearn', 'XGBoost', 'YOLO', 'Transformers', 'Keras', 'ONNX']

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'md', crown = false }: { name: string; size?: 'sm' | 'md' | 'lg'; crown?: boolean }) {
  const initials = name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase() || '?'
  const hue = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0) % 360
  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-16 h-16 text-xl' : 'w-11 h-11 text-sm'
  return (
    <div className="relative shrink-0">
      <div className={clsx('rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white/10', sizeClass)}
        style={{ background: `hsl(${hue},55%,35%)` }}>
        {initials}
      </div>
      {crown && (
        <div className="absolute -top-2 -right-1 text-sm" title="Top Contributor">👑</div>
      )}
    </div>
  )
}

// ── Framework tag ──────────────────────────────────────────────────────────────

function FwTag({ fw }: { fw: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold border', fwColor(fw))}>
      {fw}
    </span>
  )
}

// ── Engineer card ─────────────────────────────────────────────────────────────

function EngineerCard({ eng, onSelect }: { eng: DiscoverEngineer; onSelect: () => void }) {
  const isCrown = eng.model_count >= 5
  return (
    <div
      onClick={onSelect}
      className="group relative bg-gray-900 border border-gray-800 rounded-2xl p-5 cursor-pointer hover:border-indigo-600/60 hover:bg-gray-800/80 transition-all duration-200 overflow-hidden"
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />

      <div className="relative flex items-start gap-4">
        <Avatar name={eng.name} crown={isCrown} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{eng.name}</h3>
            {eng.role === 'admin' && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-purple-900/50 text-purple-300 border border-purple-700/50">Admin</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{eng.email_domain}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
            <span className="flex items-center gap-1"><Brain size={11} className="text-indigo-400" />{eng.model_count} models</span>
            <span className="flex items-center gap-1"><Database size={11} className="text-emerald-400" />{eng.dataset_count} datasets</span>
          </div>
          {eng.frameworks.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {eng.frameworks.slice(0, 4).map(fw => <FwTag key={fw} fw={fw} />)}
              {eng.frameworks.length > 4 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] text-gray-600 border border-gray-700">+{eng.frameworks.length - 4}</span>
              )}
            </div>
          )}
        </div>
        <ChevronRight size={15} className="text-gray-700 group-hover:text-indigo-400 shrink-0 mt-1 transition-colors" />
      </div>
    </div>
  )
}

// ── Engineer profile panel ─────────────────────────────────────────────────────

function EngineerProfile({ id, onBack, onTestModel }: {
  id: string
  onBack: () => void
  onTestModel: (model: DiscoverModel) => void
}) {
  const [data, setData] = useState<DiscoverEngineerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'models' | 'datasets' | 'about'>('models')

  useEffect(() => {
    setLoading(true)
    discoverApi.getEngineer(id).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-indigo-400" />
    </div>
  )
  if (!data) return null

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1.5 px-6 pt-6 pb-4 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={15} /> Back to engineers
      </button>

      {/* Hero */}
      <div className="px-6 pb-6 border-b border-gray-800">
        <div className="flex items-center gap-5">
          <Avatar name={data.name} size="lg" crown={data.model_count >= 5} />
          <div>
            <h2 className="text-xl font-bold text-white">{data.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{data.email_domain}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><Brain size={12} className="text-indigo-400" />{data.model_count} models</span>
              <span className="flex items-center gap-1"><Database size={12} className="text-emerald-400" />{data.dataset_count} datasets</span>
              {data.joined_at && <span className="text-gray-600">Joined {new Date(data.joined_at).getFullYear()}</span>}
            </div>
            {data.frameworks.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {data.frameworks.map(fw => <FwTag key={fw} fw={fw} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-6">
        {(['models', 'datasets', 'about'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={clsx('py-3 px-4 text-sm font-medium transition-colors capitalize border-b-2 -mb-px',
              activeTab === t ? 'text-indigo-400 border-indigo-500' : 'text-gray-500 border-transparent hover:text-gray-300')}>
            {t}
            {t === 'models' && <span className="ml-1.5 text-[10px] text-gray-600">({data.model_count})</span>}
            {t === 'datasets' && <span className="ml-1.5 text-[10px] text-gray-600">({data.dataset_count})</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6 space-y-4">
        {activeTab === 'models' && (
          data.models.length === 0
            ? <p className="text-sm text-gray-600 py-8 text-center">No deployed models yet.</p>
            : data.models.map(m => (
              <div key={m.id} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-start gap-4">
                <div className="p-2 rounded-lg bg-indigo-900/40 shrink-0">
                  <Cpu size={16} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">{m.trainer_name}</p>
                    <span className="text-[10px] text-gray-500">v{m.version}</span>
                    {m.tags.framework && <FwTag fw={m.tags.framework} />}
                    {m.category?.label && (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-gray-700 text-gray-400">{m.category.label}</span>
                    )}
                  </div>
                  {Object.keys(m.metrics).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {Object.entries(m.metrics).slice(0, 4).map(([k, v]) => (
                        <span key={k} className="text-[10px] text-gray-400">
                          <span className="text-gray-600">{k}:</span> <span className="text-emerald-400 font-mono">{typeof v === 'number' ? v.toFixed(3) : v}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => onTestModel(m)}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors">
                  Test →
                </button>
              </div>
            ))
        )}

        {activeTab === 'datasets' && (
          data.datasets.length === 0
            ? <p className="text-sm text-gray-600 py-8 text-center">No datasets published yet.</p>
            : data.datasets.map((d: DiscoverDataset) => (
              <div key={d.id} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{d.name}</p>
                    {d.slug && <p className="text-[11px] text-indigo-400 font-mono mt-0.5">#{d.slug}</p>}
                    {d.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><Database size={10} />{d.entry_count_cache.toLocaleString()} entries</span>
                      {(d.field_types ?? []).map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[9px] uppercase">{t}</span>)}
                    </div>
                  </div>
                  <span className={clsx('shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase',
                    d.status === 'active' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500')}>
                    {d.status}
                  </span>
                </div>
              </div>
            ))
        )}

        {activeTab === 'about' && (
          <div className="space-y-4">
            <div className="bg-gray-800/40 rounded-xl p-5 border border-gray-700/40">
              <p className="text-sm text-gray-400">
                This engineer's full bio and Medium articles will appear here once they configure their public profile.
              </p>
              <a href={`https://medium.com/search?q=${encodeURIComponent(data.name)}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                <ExternalLink size={12} /> Search Medium articles by {data.name}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DataScientistsPage({
  onBack,
  onTestModel,
}: {
  onBack: () => void
  onTestModel?: (model: DiscoverModel) => void
}) {
  const [engineers, setEngineers] = useState<DiscoverEngineer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterFw, setFilterFw] = useState('')
  const [sort, setSort] = useState<'models' | 'datasets' | 'alpha'>('models')
  const [profileId, setProfileId] = useState<string | null>(null)

  useEffect(() => {
    discoverApi.listEngineers().then(setEngineers).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = engineers.filter(e => {
      if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.email_domain.toLowerCase().includes(search.toLowerCase())) return false
      if (filterFw && !e.frameworks.some(f => f.toLowerCase() === filterFw.toLowerCase())) return false
      return true
    })
    if (sort === 'models') list = [...list].sort((a, b) => b.model_count - a.model_count)
    else if (sort === 'datasets') list = [...list].sort((a, b) => b.dataset_count - a.dataset_count)
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [engineers, search, filterFw, sort])

  const topEngineers = engineers.filter(e => e.model_count >= 3)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={15} /> Back
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Users size={18} className="text-indigo-400" /> Data Scientists
            </h1>
            <p className="text-xs text-gray-500">Explore engineers building with MLDock</p>
          </div>
        </div>
      </div>

      {profileId ? (
        <div className="max-w-3xl mx-auto w-full flex flex-col">
          <EngineerProfile
            id={profileId}
            onBack={() => setProfileId(null)}
            onTestModel={onTestModel ?? (() => {})}
          />
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full px-4 py-8 space-y-8">

          {/* Top contributors spotlight */}
          {topEngineers.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Star size={12} className="text-amber-400" /> Top Contributors
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {topEngineers.slice(0, 6).map(eng => (
                  <button key={eng.id} onClick={() => setProfileId(eng.id)}
                    className="shrink-0 flex flex-col items-center gap-2 p-4 rounded-2xl bg-gray-900 border border-gray-800 hover:border-amber-700/60 hover:bg-gray-800/80 transition-all w-28">
                    <Avatar name={eng.name} size="sm" crown />
                    <p className="text-[11px] text-white font-medium text-center leading-tight line-clamp-2">{eng.name}</p>
                    <p className="text-[10px] text-indigo-400">{eng.model_count} models</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search engineers…"
                className="w-full pl-9 pr-8 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X size={13} /></button>}
            </div>

            {/* Framework pills */}
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setFilterFw('')}
                className={clsx('px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  !filterFw ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700')}>
                All
              </button>
              {FRAMEWORK_OPTIONS.map(fw => (
                <button key={fw} onClick={() => setFilterFw(fw === filterFw ? '' : fw)}
                  className={clsx('px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                    filterFw === fw ? fwColor(fw) + ' ring-1 ring-current' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
                  {fw}
                </button>
              ))}
            </div>

            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
              className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500">
              <option value="models">Sort: Most Models</option>
              <option value="datasets">Sort: Most Datasets</option>
              <option value="alpha">Sort: A–Z</option>
            </select>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Users size={12} /> {filtered.length} engineer{filtered.length !== 1 ? 's' : ''}
            {(search || filterFw) && (
              <button onClick={() => { setSearch(''); setFilterFw('') }}
                className="ml-2 text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                <X size={11} /> Clear filters
              </button>
            )}
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 space-y-2">
              <Users size={36} className="text-gray-800 mx-auto" />
              <p className="text-gray-500">No engineers found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(eng => (
                <EngineerCard key={eng.id} eng={eng} onSelect={() => setProfileId(eng.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
