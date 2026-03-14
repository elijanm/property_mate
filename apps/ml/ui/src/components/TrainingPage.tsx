import { useState, useEffect, useRef } from 'react'
import { trainersApi } from '@/api/trainers'
import { walletApi } from '@/api/wallet'
import type { TrainerRegistration, GpuOption } from '@/types/trainer'
import type { Wallet } from '@/types/wallet'
import JobsPanel from './JobsPanel'
import { Play, Upload, Loader2, CheckCircle2, AlertCircle, ChevronRight, X, Search, Zap } from 'lucide-react'
import clsx from 'clsx'

const PRESETS = [
  { label: 'GPU fast',     value: { cuda_device: 'cuda', mixed_precision: 'fp16', batch_size: 64, max_epochs: 30, optimizer: 'adamw', lr_scheduler: 'cosine' } },
  { label: 'CPU safe',     value: { cuda_device: 'cpu', mixed_precision: 'no', batch_size: 32, workers: 2, dataloader_pin_memory: false } },
  { label: 'Fine-tune NLP',value: { optimizer: 'adamw', learning_rate: 2e-5, warmup_ratio: 0.1, lr_scheduler: 'linear', max_epochs: 5, gradient_clip: 1.0 } },
  { label: 'Quick test',   value: { max_epochs: 3, batch_size: 16, test_split: 0.3, val_split: 0.1, early_stopping: false } },
]

const TIER_ORDER  = ['budget', 'standard', 'performance', 'enterprise'] as const
const TIER_LABEL: Record<string, string> = { budget: 'Budget', standard: 'Standard', performance: 'Performance', enterprise: 'Enterprise' }
const TIER_COLOR: Record<string, string> = { budget: 'text-emerald-400', standard: 'text-blue-400', performance: 'text-violet-400', enterprise: 'text-amber-400' }
const TIER_BG:    Record<string, string> = { budget: 'bg-emerald-900/20 border-emerald-800/40', standard: 'bg-blue-900/20 border-blue-800/40', performance: 'bg-violet-900/20 border-violet-800/40', enterprise: 'bg-amber-900/20 border-amber-800/40' }

// ── GPU picker modal ────────────────────────────────────────────────────────
function GpuPickerModal({
  options, selected, onSelect, onClose, loading, source,
}: {
  options: GpuOption[]
  selected: string
  onSelect: (id: string) => void
  onClose: () => void
  loading: boolean
  source: string
}) {
  const [search, setSearch]         = useState('')
  const [sortBy, setSortBy]         = useState<'price' | 'vram'>('price')
  const [filterMaxPrice, setMax]    = useState<number>(999)
  const [filterMinVram, setMinVram] = useState<number>(0)

  const filtered = options
    .filter(g => g.available)
    .filter(g => g.price_per_hour <= filterMaxPrice && g.vram_gb >= filterMinVram)
    .filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === 'price' ? a.price_per_hour - b.price_per_hour : b.vram_gb - a.vram_gb)

  const groups = TIER_ORDER
    .map(tier => ({ tier, items: filtered.filter(g => g.tier === tier) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl" style={{ maxHeight: '85vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Select GPU</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {loading ? 'Fetching live prices…' : `${options.filter(g => g.available).length} GPUs available${source === 'live' ? ' · live prices' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 flex-1 min-w-[140px]">
            <Search size={11} className="text-gray-500 flex-shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search GPU…"
              className="bg-transparent text-xs text-gray-200 placeholder-gray-600 focus:outline-none w-full" />
          </div>
          {/* Max price */}
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">Max</span>
            <span className="text-[10px] text-gray-600">$</span>
            <input type="number" min={0} step={0.5} value={filterMaxPrice === 999 ? '' : filterMaxPrice}
              placeholder="any"
              onChange={e => setMax(e.target.value ? parseFloat(e.target.value) : 999)}
              className="w-12 bg-transparent text-xs text-gray-200 focus:outline-none" />
            <span className="text-[10px] text-gray-500">/hr</span>
          </div>
          {/* Min VRAM */}
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">≥</span>
            <input type="number" min={0} step={8} value={filterMinVram || ''}
              placeholder="any"
              onChange={e => setMinVram(e.target.value ? parseInt(e.target.value) : 0)}
              className="w-10 bg-transparent text-xs text-gray-200 focus:outline-none" />
            <span className="text-[10px] text-gray-500">GB</span>
          </div>
          {/* Sort */}
          <div className="flex gap-0.5 bg-gray-800 border border-gray-700 rounded-lg p-0.5">
            {(['price', 'vram'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={clsx('px-2.5 py-1 text-[10px] rounded font-medium transition-colors',
                  sortBy === s ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
                {s === 'price' ? '$ Price' : '⬛ VRAM'}
              </button>
            ))}
          </div>
        </div>

        {/* GPU list — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-10">
              <Loader2 size={14} className="animate-spin" /> Fetching live GPU prices…
            </div>
          ) : groups.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-10">No GPUs match your filters.</p>
          ) : (
            groups.map(({ tier, items }) => (
              <div key={tier}>
                <div className={clsx('text-[10px] font-bold uppercase tracking-widest mb-2', TIER_COLOR[tier])}>
                  {TIER_LABEL[tier]}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map(gpu => {
                    const isSelected = selected === gpu.id
                    return (
                      <button key={gpu.id} onClick={() => { onSelect(gpu.id); onClose() }}
                        className={clsx(
                          'relative flex items-center justify-between p-3 rounded-xl border text-left transition-all',
                          isSelected
                            ? 'border-brand-500 bg-brand-900/30 ring-1 ring-brand-500/30'
                            : `border-gray-700 hover:border-gray-500 bg-gray-800/50 hover:bg-gray-800`
                        )}>
                        {isSelected && (
                          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-400" />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-white">{gpu.name}</span>
                            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-mono', TIER_BG[gpu.tier])}>
                              {gpu.vram_gb} GB
                            </span>
                            {gpu.recommended && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-900/60 text-brand-400 font-medium">
                                ★ Best
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-600 mt-1 capitalize">{gpu.tier}</div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-sm font-bold text-white">${gpu.price_per_hour.toFixed(2)}</div>
                          <div className="text-[10px] text-gray-600">USD / hr</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {source === 'live' && !loading && (
          <div className="px-5 py-2.5 border-t border-gray-800 text-[10px] text-gray-700">
            Live GPU prices · refreshed every 5 min · prices shown are final
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
interface Props {
  onJobCompleted?: (trainerName: string) => void
}

export default function TrainingPage({ onJobCompleted }: Props) {
  const [trainers, setTrainers]         = useState<TrainerRegistration[]>([])
  const [selected, setSelected]         = useState<string>('')
  const [mode, setMode]                 = useState<'simple' | 'with-data'>('simple')
  const [configOverrides, setConfigOverrides] = useState('')
  const [file, setFile]                 = useState<File | null>(null)
  const [loading, setLoading]           = useState(false)
  const [result, setResult]             = useState<string | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [jobsKey, setJobsKey]           = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const [compute, setCompute]           = useState<'local' | 'cloud_gpu'>('local')
  const [gpuTypeId, setGpuTypeId]       = useState<string>('')
  const [gpuOptions, setGpuOptions]     = useState<GpuOption[]>([])
  const [gpuAvailable, setGpuAvailable] = useState(false)
  const [gpuSource, setGpuSource]       = useState<string>('static')
  const [gpuLoading, setGpuLoading]     = useState(false)
  const [gpuModalOpen, setGpuModalOpen] = useState(false)
  const [wallet, setWallet]             = useState<Wallet | null>(null)

  useEffect(() => {
    trainersApi.list().then(setTrainers).catch(() => {})
    setGpuLoading(true)
    trainersApi.listGpuOptions().then(({ options, available, source }) => {
      setGpuOptions(options)
      setGpuAvailable(available)
      setGpuSource(source)
      const recommended = options.find(o => o.recommended) ?? options[0]
      if (recommended && !gpuTypeId) setGpuTypeId(recommended.id)
    }).catch(() => {}).finally(() => setGpuLoading(false))
    walletApi.get().then(setWallet).catch(() => {})
  }, [])

  const selectedGpu = gpuOptions.find(g => g.id === gpuTypeId)
  const estimatedCost  = selectedGpu ? selectedGpu.price_per_hour : 0
  const reservation    = estimatedCost * 3
  const insufficientBalance = wallet != null && wallet.balance < reservation

  const submit = async () => {
    if (!selected) return
    setLoading(true); setError(null); setResult(null)
    try {
      let overrides: Record<string, unknown> | undefined
      if (configOverrides.trim()) {
        try { overrides = JSON.parse(configOverrides) } catch { throw new Error('Config overrides must be valid JSON') }
      }
      let res: { job_id: string }
      if (mode === 'with-data' && file) {
        const fd = new FormData()
        fd.append('trainer_name', selected)
        fd.append('file', file)
        fd.append('compute_type', compute)
        if (compute === 'cloud_gpu' && gpuTypeId) fd.append('gpu_type_id', gpuTypeId)
        const r = await fetch('/api/v1/training/start-with-data', { method: 'POST', body: fd })
        if (!r.ok) throw new Error(await r.text())
        res = await r.json()
      } else {
        res = await trainersApi.startTraining(selected, overrides, {
          compute_type: compute,
          gpu_type_id: compute === 'cloud_gpu' ? gpuTypeId : undefined,
        })
      }
      setResult(res.job_id)
      setJobsKey(k => k + 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  return (
    <>
      {gpuModalOpen && (
        <GpuPickerModal
          options={gpuOptions}
          selected={gpuTypeId}
          onSelect={setGpuTypeId}
          onClose={() => setGpuModalOpen(false)}
          loading={gpuLoading}
          source={gpuSource}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Left: Start training */}
        <div className="space-y-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest">Start Training Run</h2>

          {/* Trainer picker */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Trainer *</label>
            <select value={selected} onChange={e => setSelected(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500">
              <option value="">— select a trainer —</option>
              {trainers.map(t => (
                <option key={t.name} value={t.name}>{t.name} ({t.framework})</option>
              ))}
            </select>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit">
            {(['simple', 'with-data'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={clsx('px-3 py-1.5 text-xs rounded-lg font-medium transition-colors',
                  m === mode ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
                {m === 'simple' ? 'Standard' : 'Upload Data'}
              </button>
            ))}
          </div>

          {/* File upload */}
          {mode === 'with-data' && (
            <div>
              <label className="block text-xs text-gray-400 mb-2">Training Data File</label>
              <div onClick={() => fileRef.current?.click()}
                className={clsx('border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
                  file ? 'border-brand-600 bg-brand-900/20' : 'border-gray-700 hover:border-gray-600')}>
                <Upload size={18} className="mx-auto mb-1.5 text-gray-500" />
                {file
                  ? <p className="text-sm text-brand-400 font-medium">{file.name}</p>
                  : <p className="text-sm text-gray-500">CSV, JSON, or any training data file</p>}
                <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
          )}

          {/* Compute selector */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Compute</label>
            <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit">
              {(['local', 'cloud_gpu'] as const).map(c => (
                <button key={c} onClick={() => setCompute(c)}
                  className={clsx('px-3 py-1.5 text-xs rounded-lg font-medium transition-colors',
                    c === compute ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
                  {c === 'local' ? '🖥 Local' : '⚡ Cloud GPU'}
                </button>
              ))}
            </div>

            {compute === 'cloud_gpu' && (
              <div className="mt-3 space-y-3">
                {!gpuAvailable ? (
                  <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                    No cloud GPU configured. Add <code className="font-mono">RUNPOD_API_KEY</code> in Config.
                  </p>
                ) : (
                  <>
                    {/* Selected GPU chip + change button */}
                    <button onClick={() => setGpuModalOpen(true)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all',
                        selectedGpu
                          ? 'border-brand-600/60 bg-brand-900/20 hover:border-brand-500'
                          : 'border-gray-700 bg-gray-900 hover:border-gray-600'
                      )}>
                      {selectedGpu ? (
                        <div className="flex items-center gap-2.5">
                          <Zap size={13} className="text-brand-400 flex-shrink-0" />
                          <div className="text-left">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-semibold text-white">{selectedGpu.name}</span>
                              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-mono', TIER_BG[selectedGpu.tier])}>
                                {selectedGpu.vram_gb} GB
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-500 capitalize mt-0.5">{selectedGpu.tier} tier</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">Select a GPU…</span>
                      )}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {selectedGpu && (
                          <span className="text-sm font-bold text-white">${selectedGpu.price_per_hour.toFixed(2)}<span className="text-[10px] text-gray-500 font-normal"> USD/hr</span></span>
                        )}
                        <ChevronRight size={14} className="text-gray-500" />
                      </div>
                    </button>

                    {/* Wallet estimate */}
                    {selectedGpu && wallet && (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between text-gray-500">
                          <span>Est. cost (1 hr)</span>
                          <span className="text-gray-300">${estimatedCost.toFixed(2)} USD</span>
                        </div>
                        <div className="flex justify-between text-amber-500 font-medium">
                          <span>Reservation (3×)</span>
                          <span>${reservation.toFixed(2)} USD</span>
                        </div>
                        <div className={clsx('flex justify-between font-semibold pt-1 border-t border-gray-800',
                          insufficientBalance ? 'text-red-400' : 'text-emerald-400')}>
                          <span>Wallet balance</span>
                          <span>${wallet.balance.toFixed(2)} USD</span>
                        </div>
                        {insufficientBalance && (
                          <p className="text-red-400 text-[10px]">Insufficient balance — top up your wallet.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Config overrides */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">
                Config Overrides <span className="text-gray-600">(optional JSON)</span>
              </label>
              <div className="flex gap-1">
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => setConfigOverrides(JSON.stringify(p.value, null, 2))}
                    className="text-xs px-2 py-0.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={configOverrides} onChange={e => setConfigOverrides(e.target.value)}
              rows={5} placeholder={'{\n  "max_epochs": 50,\n  "batch_size": 16\n}'}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none" />
          </div>

          {/* Submit */}
          <button onClick={submit} disabled={
            loading
            || !selected
            || (compute === 'cloud_gpu' && !gpuAvailable)
            || (compute === 'cloud_gpu' && insufficientBalance)
          }
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {loading ? 'Queueing…' : 'Start Training'}
          </button>

          {result && (
            <div className="bg-emerald-950/40 border border-emerald-800 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 size={15} />
              Job queued{compute === 'cloud_gpu' && selectedGpu ? ` · ⚡ ${selectedGpu.name}` : ''} ·
              <code className="font-mono text-xs text-emerald-500">{result}</code>
            </div>
          )}
          {error && (
            <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>

        {/* Right: Recent jobs */}
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest mb-5">Recent Jobs</h2>
          <JobsPanel key={jobsKey} onJobCompleted={job => onJobCompleted?.(job.trainer_name)} />
        </div>
      </div>
    </>
  )
}
