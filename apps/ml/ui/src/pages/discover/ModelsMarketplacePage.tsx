import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, X, ArrowLeft, Loader2, Cpu, ChevronRight, Play, Zap, BarChart2, Filter } from 'lucide-react'
import clsx from 'clsx'
import { discoverApi, type DiscoverModel } from '@/api/discover'

// ── Helpers ────────────────────────────────────────────────────────────────────

const FW_COLORS: Record<string, string> = {
  pytorch:      'bg-orange-900/50 text-orange-300 border-orange-700/50',
  tensorflow:   'bg-amber-900/50 text-amber-300 border-amber-700/50',
  sklearn:      'bg-sky-900/50 text-sky-300 border-sky-700/50',
  xgboost:      'bg-lime-900/50 text-lime-300 border-lime-700/50',
  yolo:         'bg-violet-900/50 text-violet-300 border-violet-700/50',
  transformers: 'bg-pink-900/50 text-pink-300 border-pink-700/50',
  keras:        'bg-red-900/50 text-red-300 border-red-700/50',
}
const fwColor = (fw: string) => FW_COLORS[fw.toLowerCase()] ?? 'bg-gray-800 text-gray-400 border-gray-700'

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase() || '?'
  const hue = name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0) % 360
  return (
    <div className={clsx('rounded-full flex items-center justify-center font-bold text-white ring-1 ring-white/10',
      size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-9 h-9 text-xs')}
      style={{ background: `hsl(${hue},55%,35%)` }}>
      {initials}
    </div>
  )
}

// ── In-page test panel ─────────────────────────────────────────────────────────

function ModelTestPanel({ model, onClose }: { model: DiscoverModel; onClose: () => void }) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [result, setResult] = useState<unknown>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const inputSchema = model.input_schema as Record<string, { type: string; label?: string; description?: string; required?: boolean; example?: string }>

  const run = async () => {
    setRunning(true); setError(''); setResult(null)
    try {
      // Build the inference payload — same shape as InferencePanel
      const payload: Record<string, string> = {}
      for (const [k, v] of Object.entries(inputs)) {
        if (v) payload[k] = v
      }
      const { default: client } = await import('@/api/client')
      const r = await client.post(`/inference/run`, {
        model_id: model.id,
        inputs: payload,
      })
      setResult(r.data?.output ?? r.data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string; error?: { message?: string } } }; message?: string }
      setError(err?.response?.data?.detail || err?.response?.data?.error?.message || err?.message || 'Inference failed')
    } finally { setRunning(false) }
  }

  return (
    <div className="fixed inset-0 z-[80] flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Play size={14} className="text-indigo-400" /> Test Model
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5 font-mono">{model.trainer_name} v{model.version}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Input fields */}
          {Object.entries(inputSchema).map(([key, field]) => (
            <div key={key}>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                {field.label || key}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {field.description && <p className="text-[11px] text-gray-600 mb-1">{field.description}</p>}

              {field.type === 'image' || field.type === 'file' ? (
                <div>
                  <input type="file" className="hidden" ref={el => { fileRefs.current[key] = el }}
                    accept={field.type === 'image' ? 'image/*' : '*/*'}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const b64 = (ev.target?.result as string).split(',')[1] ?? ''
                        setInputs(prev => ({ ...prev, [key]: b64, [`${key}_name`]: file.name, [`${key}_mime`]: file.type }))
                      }
                      reader.readAsDataURL(file)
                    }} />
                  <button onClick={() => fileRefs.current[key]?.click()}
                    className={clsx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs transition-colors',
                      inputs[key] ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-indigo-600 hover:text-gray-300')}>
                    {inputs[key] ? `✓ ${inputs[`${key}_name`] || 'File selected'}` : `Choose ${field.type}…`}
                  </button>
                </div>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  placeholder={field.example ?? `Enter ${field.label || key}…`}
                  value={inputs[key] ?? ''}
                  onChange={e => setInputs(prev => ({ ...prev, [key]: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>
          ))}

          {Object.keys(inputSchema).length === 0 && (
            <p className="text-xs text-gray-500 py-4 text-center">This model has no defined input schema.</p>
          )}

          {error && (
            <div className="bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3 text-xs text-red-300">{error}</div>
          )}

          {/* Result */}
          {result !== null && (
            <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-xl p-4">
              <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mb-2">Result</p>
              <pre className="text-xs text-emerald-300 whitespace-pre-wrap break-words">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="border-t border-gray-800 px-5 py-4">
          <button onClick={run} disabled={running}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
            {running ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <><Zap size={14} /> Run Inference</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Model card ─────────────────────────────────────────────────────────────────

function ModelCard({ model, onTest }: { model: DiscoverModel; onTest: () => void }) {
  const fw = model.tags?.framework || model.tags?.Framework || ''
  const catLabel = model.category?.label || model.category?.key || ''
  const topMetrics = Object.entries(model.metrics || {}).slice(0, 3)

  return (
    <div className="group relative bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-600/50 transition-all duration-200 overflow-hidden flex flex-col">
      {/* Glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none" />

      {/* Top row */}
      <div className="flex items-start gap-3 relative">
        <div className="p-2.5 rounded-xl bg-indigo-900/40 border border-indigo-800/30 shrink-0">
          <Cpu size={16} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{model.trainer_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-600 font-mono">v{model.version}</span>
            {fw && <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold border', fwColor(fw))}>{fw}</span>}
            {catLabel && <span className="px-2 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400 border border-gray-700">{catLabel}</span>}
          </div>
        </div>
      </div>

      {/* Metrics */}
      {topMetrics.length > 0 && (
        <div className="flex gap-3 mt-4 relative">
          {topMetrics.map(([k, v]) => (
            <div key={k} className="flex-1 min-w-0 bg-gray-800/60 rounded-lg p-2 text-center">
              <p className="text-xs font-bold text-emerald-400">{typeof v === 'number' ? v.toFixed(3) : v}</p>
              <p className="text-[9px] text-gray-600 mt-0.5 truncate">{k}</p>
            </div>
          ))}
        </div>
      )}

      {/* Publisher */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800 relative">
        <div className="flex items-center gap-2">
          <Avatar name={model.publisher_name || 'Unknown'} />
          <div>
            <p className="text-[11px] text-gray-400">{model.publisher_name || 'Unknown'}</p>
            {model.created_at && <p className="text-[10px] text-gray-600">{new Date(model.created_at).toLocaleDateString()}</p>}
          </div>
        </div>
        <button onClick={onTest}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
          <Play size={11} /> Test
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const FRAMEWORK_OPTIONS = ['PyTorch', 'TensorFlow', 'Sklearn', 'XGBoost', 'YOLO', 'Transformers', 'Keras']
const CATEGORY_OPTIONS = ['vision', 'nlp', 'tabular', 'audio', 'detection', 'classification', 'regression']

export default function ModelsMarketplacePage({ onBack }: { onBack: () => void }) {
  const [models, setModels] = useState<DiscoverModel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterFw, setFilterFw] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [sort, setSort] = useState<'newest' | 'alpha' | 'metrics'>('newest')
  const [testModel, setTestModel] = useState<DiscoverModel | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    discoverApi.listModels().then(setModels).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = models.filter(m => {
      if (search && !m.trainer_name.toLowerCase().includes(search.toLowerCase())) return false
      const fw = m.tags?.framework || m.tags?.Framework || ''
      if (filterFw && fw.toLowerCase() !== filterFw.toLowerCase()) return false
      const cat = m.category?.key || m.category?.label || ''
      if (filterCat && !cat.toLowerCase().includes(filterCat.toLowerCase())) return false
      return true
    })
    if (sort === 'newest') list = [...list].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    else if (sort === 'alpha') list = [...list].sort((a, b) => a.trainer_name.localeCompare(b.trainer_name))
    else list = [...list].sort((a, b) => Object.keys(b.metrics).length - Object.keys(a.metrics).length)
    return list
  }, [models, search, filterFw, filterCat, sort])

  // unique frameworks from loaded models
  const availableFws = useMemo(() => {
    const fws = new Set<string>()
    models.forEach(m => { const fw = m.tags?.framework || m.tags?.Framework; if (fw) fws.add(fw) })
    return Array.from(fws)
  }, [models])

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
              <Cpu size={18} className="text-indigo-400" /> Trained Models
            </h1>
            <p className="text-xs text-gray-500">Browse and test publicly available models</p>
          </div>
          <span className="text-xs text-gray-500">{filtered.length} model{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
        {/* Search + filter bar */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
              className="w-full pl-9 pr-8 py-2 bg-gray-900 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X size={13} /></button>}
          </div>

          <button onClick={() => setShowFilters(s => !s)}
            className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors',
              (filterFw || filterCat) ? 'bg-indigo-900/40 border-indigo-600 text-indigo-300' : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white')}>
            <Filter size={13} /> Filters {(filterFw || filterCat) ? '•' : ''}
          </button>

          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500">
            <option value="newest">Newest first</option>
            <option value="alpha">A–Z</option>
            <option value="metrics">Most metrics</option>
          </select>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
            <div>
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Framework</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setFilterFw('')}
                  className={clsx('px-3 py-1 rounded-full text-xs border transition-colors',
                    !filterFw ? 'bg-indigo-600 text-white border-transparent' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
                  All
                </button>
                {(availableFws.length > 0 ? availableFws : FRAMEWORK_OPTIONS).map(fw => (
                  <button key={fw} onClick={() => setFilterFw(fw === filterFw ? '' : fw)}
                    className={clsx('px-3 py-1 rounded-full text-xs border transition-colors',
                      filterFw === fw ? fwColor(fw) : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
                    {fw}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Category</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setFilterCat('')}
                  className={clsx('px-3 py-1 rounded-full text-xs border transition-colors',
                    !filterCat ? 'bg-indigo-600 text-white border-transparent' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
                  All
                </button>
                {CATEGORY_OPTIONS.map(cat => (
                  <button key={cat} onClick={() => setFilterCat(cat === filterCat ? '' : cat)}
                    className={clsx('px-3 py-1 rounded-full text-xs border capitalize transition-colors',
                      filterCat === cat ? 'bg-indigo-600 text-white border-transparent' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Intro banner */}
        <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-transparent border border-indigo-900/40 rounded-2xl p-5 flex items-center gap-5">
          <div className="p-3 rounded-xl bg-indigo-900/40 border border-indigo-800/30">
            <BarChart2 size={22} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Test any model instantly — no API key needed</h3>
            <p className="text-xs text-gray-400 mt-0.5">Click "Test" on any model card to run live inference directly in your browser.</p>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-indigo-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 space-y-2">
            <Cpu size={36} className="text-gray-800 mx-auto" />
            <p className="text-gray-500">No models found</p>
            {(search || filterFw || filterCat) && (
              <button onClick={() => { setSearch(''); setFilterFw(''); setFilterCat('') }}
                className="text-indigo-400 hover:text-indigo-300 text-sm flex items-center gap-1 mx-auto">
                <X size={13} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(m => (
              <ModelCard key={m.id} model={m} onTest={() => setTestModel(m)} />
            ))}
          </div>
        )}
      </div>

      {testModel && <ModelTestPanel model={testModel} onClose={() => setTestModel(null)} />}
    </div>
  )
}
