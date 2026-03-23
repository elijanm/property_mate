import { useState, useEffect, useRef } from 'react'
import { trainersApi } from '@/api/trainers'
import { datasetsApi } from '@/api/datasets'
import { walletApi } from '@/api/wallet'
import type { TrainerRegistration, GpuOption, LocalGpuInfo } from '@/types/trainer'
import type { Wallet } from '@/types/wallet'
import type { DatasetProfile } from '@/types/dataset'
import DatasetUploadModal from './DatasetUploadModal'
import JobsPanel from './JobsPanel'
import { useTrainingJob } from '@/hooks/useTrainingJob'
import { Play, Upload, Loader2, CheckCircle2, AlertCircle, ChevronRight, X, Search, Zap, Cpu, ShieldCheck, Database, Download, RefreshCw, Terminal, ArrowDownToLine, Minimize2 } from 'lucide-react'
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

// ── Auto-loaded data source description panel ────────────────────────────────

const SOURCE_ICONS: Record<string, string> = {
  memory:        '🧠',
  url:           '🌐',
  mongodb:       '🍃',
  postgresql:    '🐘',
  sql:           '🗄️',
  s3:            '☁️',
  gcs:           '☁️',
  azure_blob:    '☁️',
  local_file:    '📁',
  huggingface:   '🤗',
  kafka:         '⚡',
  paginated_api: '🔗',
  redis:         '🔴',
  ftp:           '📡',
  sftp:          '📡',
}

function buildSourceLines(dsInfo: Record<string, unknown>): string[] {
  const t = dsInfo.type as string
  const lines: string[] = []
  switch (t) {
    case 'memory':
      lines.push('Data is prepared directly inside the trainer code (in-memory).')
      lines.push('No file upload is needed — just click Start Training.')
      break
    case 'url':
      if (dsInfo.url) lines.push(`Fetches data from: ${dsInfo.url}`)
      lines.push('The file is downloaded automatically when the training job starts.')
      break
    case 'mongodb':
      if (dsInfo.database && dsInfo.collection)
        lines.push(`Queries MongoDB collection: ${dsInfo.database}.${dsInfo.collection}`)
      if (dsInfo.limit && Number(dsInfo.limit) > 0)
        lines.push(`Row limit: ${dsInfo.limit}`)
      lines.push('Records are pulled from the database when the job starts.')
      break
    case 'postgresql':
    case 'sql':
      if (dsInfo.query) lines.push(`Query: ${String(dsInfo.query).slice(0, 120)}${String(dsInfo.query).length > 120 ? '…' : ''}`)
      lines.push('Rows are fetched from the database when the job starts.')
      break
    case 's3':
      if (dsInfo.bucket && dsInfo.key) lines.push(`S3 path: s3://${dsInfo.bucket}/${dsInfo.key}`)
      lines.push('Downloaded from S3 / MinIO when the job starts.')
      break
    case 'gcs':
      if (dsInfo.bucket && dsInfo.blob) lines.push(`GCS path: gs://${dsInfo.bucket}/${dsInfo.blob}`)
      lines.push('Downloaded from Google Cloud Storage when the job starts.')
      break
    case 'azure_blob':
      if (dsInfo.container && dsInfo.blob) lines.push(`Azure path: ${dsInfo.container}/${dsInfo.blob}`)
      lines.push('Downloaded from Azure Blob Storage when the job starts.')
      break
    case 'local_file':
      if (dsInfo.path) lines.push(`Local path: ${dsInfo.path}`)
      lines.push('Read from the server filesystem when the job starts.')
      break
    case 'huggingface':
      if (dsInfo.dataset) lines.push(`HuggingFace dataset: ${dsInfo.dataset}${dsInfo.split ? ` (split: ${dsInfo.split})` : ''}`)
      lines.push('Downloaded from the HuggingFace Hub when the job starts.')
      break
    case 'kafka':
      if (dsInfo.topic) lines.push(`Kafka topic: ${dsInfo.topic}`)
      if (dsInfo.max_messages) lines.push(`Max messages: ${dsInfo.max_messages}`)
      lines.push('Messages are consumed when the job starts.')
      break
    case 'paginated_api':
      if (dsInfo.url) lines.push(`API endpoint: ${String(dsInfo.url).slice(0, 80)}`)
      lines.push('All pages are fetched when the job starts.')
      break
    case 'redis':
      if (dsInfo.key) lines.push(`Redis key: ${dsInfo.key}`)
      lines.push('Data is read from Redis when the job starts.')
      break
    case 'ftp':
    case 'sftp':
      if (dsInfo.host && dsInfo.path) lines.push(`${t.toUpperCase()} path: ${dsInfo.host}${dsInfo.path}`)
      lines.push('File is downloaded when the job starts.')
      break
    default:
      lines.push('Data is loaded automatically when the job starts.')
  }
  return lines
}

function AutoSourcePanel({
  dsInfo,
  trainerDescription,
}: {
  dsInfo: Record<string, unknown>
  trainerDescription: string
}) {
  const type  = dsInfo.type as string
  const icon  = SOURCE_ICONS[type] ?? '📦'
  const lines = buildSourceLines(dsInfo)

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
        <span className="text-sm leading-none">{icon}</span>
        <span className="text-xs font-semibold text-gray-200">Data Source</span>
        <span className="ml-auto text-[10px] font-mono text-gray-600 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded">{type}</span>
      </div>
      <div className="p-4 space-y-3">
        {/* Trainer description (tells the user what data this trainer works with) */}
        {trainerDescription && (
          <p className="text-xs text-gray-300 leading-relaxed">{trainerDescription}</p>
        )}
        {/* Source-specific lines */}
        <ul className="space-y-1">
          {lines.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-gray-500">
              <span className="text-gray-700 mt-0.5 flex-shrink-0">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {/* Positive call-to-action */}
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-[11px] text-emerald-400">
          <CheckCircle2 size={11} className="flex-shrink-0" />
          No upload needed — data is loaded automatically at training time.
        </div>
      </div>
    </div>
  )
}

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

        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 flex-1 min-w-[140px]">
            <Search size={11} className="text-gray-500 flex-shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search GPU…"
              className="bg-transparent text-xs text-gray-200 placeholder-gray-600 focus:outline-none w-full" />
          </div>
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">Max</span>
            <span className="text-[10px] text-gray-600">$</span>
            <input type="number" min={0} step={0.5} value={filterMaxPrice === 999 ? '' : filterMaxPrice}
              placeholder="any"
              onChange={e => setMax(e.target.value ? parseFloat(e.target.value) : 999)}
              className="w-12 bg-transparent text-xs text-gray-200 focus:outline-none" />
            <span className="text-[10px] text-gray-500">/hr</span>
          </div>
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">≥</span>
            <input type="number" min={0} step={8} value={filterMinVram || ''}
              placeholder="any"
              onChange={e => setMinVram(e.target.value ? parseInt(e.target.value) : 0)}
              className="w-10 bg-transparent text-xs text-gray-200 focus:outline-none" />
            <span className="text-[10px] text-gray-500">GB</span>
          </div>
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
                            : 'border-gray-700 hover:border-gray-500 bg-gray-800/50 hover:bg-gray-800'
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

        {source === 'live' && !loading && (
          <div className="px-5 py-2.5 border-t border-gray-800 text-[10px] text-gray-700">
            Live GPU prices · refreshed every 5 min · prices shown are final
          </div>
        )}
      </div>
    </div>
  )
}

// ── Local compute card ───────────────────────────────────────────────────────
function LocalComputeCard({
  info, wallet, priceOverride,
}: {
  info: LocalGpuInfo
  wallet: Wallet | null
  priceOverride: number
}) {
  const isFree      = info.is_free
  const reservation = isFree ? 0 : priceOverride * 1.5
  const hasBalance  = wallet == null || wallet.balance >= reservation

  return (
    <div className="mt-3 space-y-3">
      {/* Hardware chip */}
      <div className={clsx(
        'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border',
        info.is_cuda_available
          ? 'border-sky-600/60 bg-sky-900/20'
          : 'border-gray-700 bg-gray-900',
      )}>
        <div className="flex items-center gap-2.5">
          <Cpu size={13} className={info.is_cuda_available ? 'text-sky-400 flex-shrink-0' : 'text-gray-500 flex-shrink-0'} />
          <div className="text-left">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-white">{info.gpu_name}</span>
              {info.vram_gb > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-800/40 bg-sky-900/20 text-sky-300 font-mono">
                  {info.vram_gb} GB
                </span>
              )}
              {info.compute_capability && (
                <span className="text-[10px] text-gray-600">SM {info.compute_capability}</span>
              )}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {info.is_cuda_available ? `${info.gpu_count} device${info.gpu_count !== 1 ? 's' : ''} · CUDA` : 'CPU-only compute'}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          {isFree ? (
            <span className="text-sm font-bold text-emerald-400">Free</span>
          ) : (
            <div className="text-right">
              <div className="text-sm font-bold text-white">${priceOverride.toFixed(2)}</div>
              <div className="text-[10px] text-gray-600">USD / hr</div>
            </div>
          )}
        </div>
      </div>

      {/* Billing detail card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5 text-xs">
        {isFree ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <ShieldCheck size={13} />
              {info.is_exempt
                ? 'Your account is exempt — no charge for standard training'
                : info.global_free
                  ? 'Free for all users — global override is ON'
                  : 'Free — no charges apply'}
            </div>
            {(info.global_free || info.is_exempt) && (
              <p className="text-[10px] text-gray-600 pl-5">
                {info.global_free
                  ? 'To start charging, go to Admin → Billing Settings → Pricing and turn off "Always free (global override)".'
                  : 'To remove exemption, go to Admin → Billing Settings → User Plan and toggle off "Exempt from local GPU charges".'}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex justify-between text-gray-500">
              <span>Rate</span>
              <span className="text-gray-300">${priceOverride.toFixed(2)} USD / hr</span>
            </div>
            <div className="flex justify-between text-amber-500 font-medium">
              <span>Reservation (1.5×)</span>
              <span>${reservation.toFixed(2)} USD</span>
            </div>
            {wallet != null && (
              <div className={clsx('flex justify-between font-semibold pt-1 border-t border-gray-800',
                hasBalance ? 'text-emerald-400' : 'text-red-400')}>
                <span>Wallet balance</span>
                <span>${wallet.balance.toFixed(2)} USD</span>
              </div>
            )}
            {wallet != null && !hasBalance && (
              <p className="text-red-400 text-[10px]">Insufficient balance — top up your wallet.</p>
            )}
            <p className="text-gray-600 text-[10px] pt-0.5">
              Charged on actual wall-clock time after job completes. Reservation released if less was used.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
interface Props {
  onJobCompleted?: (trainerName: string) => void
  initialTrainer?: string
}

export default function TrainingPage({ onJobCompleted, initialTrainer }: Props) {
  const [trainers, setTrainers]         = useState<TrainerRegistration[]>([])
  const [selected, setSelected]         = useState<string>(initialTrainer ?? '')
  const [mode, setMode]                 = useState<'simple' | 'with-data'>('simple')
  const [configOverrides, setConfigOverrides] = useState('')
  const [file, setFile]                 = useState<File | null>(null)
  const [loading, setLoading]           = useState(false)
  const [submitError, setSubmitError]   = useState<string | null>(null)
  const [jobsKey, setJobsKey]           = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Live training job tracking via SSE
  const job = useTrainingJob(selected || '__none__')

  const [compute, setCompute]           = useState<'local' | 'cloud_gpu'>('local')
  const [gpuTypeId, setGpuTypeId]       = useState<string>('')
  const [gpuOptions, setGpuOptions]     = useState<GpuOption[]>([])
  const [gpuAvailable, setGpuAvailable] = useState(false)
  const [gpuSource, setGpuSource]       = useState<string>('static')
  const [gpuLoading, setGpuLoading]     = useState(false)
  const [gpuModalOpen, setGpuModalOpen] = useState(false)
  const [wallet, setWallet]             = useState<Wallet | null>(null)
  const [localInfo, setLocalInfo]       = useState<LocalGpuInfo | null>(null)
  const [localInfoLoading, setLocalInfoLoading] = useState(false)
  const [localInfoError, setLocalInfoError] = useState(false)
  const [localPriceOverride, setLocalPriceOverride] = useState<number>(0.15)

  // Dataset-datasource state
  const [dsDataset, setDsDataset]         = useState<DatasetProfile | null>(null)
  const [dsEntryCount, setDsEntryCount]   = useState<number | null>(null)
  const [dsLoading, setDsLoading]         = useState(false)
  const [dsError, setDsError]             = useState<string | null>(null)
  const [showDsUpload, setShowDsUpload]   = useState(false)

  // Dataset override picker
  const [datasetOverrideSlug, setDatasetOverrideSlug] = useState<string | null>(null)
  const [showDsPicker, setShowDsPicker]               = useState(false)
  const [allDatasets, setAllDatasets]                 = useState<DatasetProfile[]>([])
  const [allDsLoading, setAllDsLoading]               = useState(false)

  // Auto-select trainer when coming from TrainersPage
  useEffect(() => {
    if (initialTrainer) setSelected(initialTrainer)
  }, [initialTrainer])

  // Reset dataset override when trainer changes
  useEffect(() => {
    setDatasetOverrideSlug(null)
    setShowDsPicker(false)
  }, [selected])

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

  // Fetch dataset info whenever the selected trainer changes
  const selectedTrainer = trainers.find(t => t.name === selected) ?? null
  const dsInfo = selectedTrainer?.data_source_info as Record<string, unknown> | undefined
  const isDatasetSource = dsInfo?.type === 'dataset'
  // file/UploadedFileDataSource — user must supply data at run time
  const isFileSource    = dsInfo?.type === 'file'
  // All other types load data automatically — no upload needed
  const isAutoSource    = !!selected && !!dsInfo?.type && !isDatasetSource && !isFileSource

  useEffect(() => {
    if (!isDatasetSource) { setDsDataset(null); setDsEntryCount(null); setDsError(null); return }
    // Use override slug if set, otherwise fall back to trainer's default
    const effectiveSlug = datasetOverrideSlug ?? (dsInfo?.dataset_slug as string | undefined)
    const id            = dsInfo?.dataset_id as string | undefined
    if (!effectiveSlug && !id) return
    setDsLoading(true); setDsDataset(null); setDsEntryCount(null); setDsError(null)
    const fetchDataset = effectiveSlug ? datasetsApi.getBySlug(effectiveSlug) : datasetsApi.get(id!)
    fetchDataset.then(async ds => {
      setDsDataset(ds)
      const { count } = await datasetsApi.getEntryCount(ds.id)
      setDsEntryCount(count)
    }).catch(() => {
      setDsError('Dataset not found — it may not have been created yet.')
    }).finally(() => setDsLoading(false))
  }, [selected, isDatasetSource, datasetOverrideSlug]) // eslint-disable-line

  // Fetch local GPU + billing info on mount (always needed for local tab)
  useEffect(() => {
    setLocalInfoLoading(true)
    trainersApi.getLocalInfo()
      .then(info => { setLocalInfo(info); setLocalPriceOverride(info.price_per_hour) })
      .catch(() => setLocalInfoError(true))
      .finally(() => setLocalInfoLoading(false))
  }, [])

  const selectedGpu = gpuOptions.find(g => g.id === gpuTypeId)
  const cloudEstimatedCost  = selectedGpu ? selectedGpu.price_per_hour : 0
  const cloudReservation    = cloudEstimatedCost * 3
  const insufficientBalance = compute === 'cloud_gpu' && wallet != null && wallet.balance < cloudReservation
  const localInsufficient   = compute === 'local' && !localInfo?.is_free && wallet != null && wallet.balance < localPriceOverride * 1.5

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [job.state.logs])

  // Fire onJobCompleted when job finishes
  useEffect(() => {
    if (job.state.status === 'completed' && job.state.trainerName) {
      onJobCompleted?.(job.state.trainerName)
      setJobsKey(k => k + 1)
    }
  }, [job.state.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!selected) return
    setLoading(true); setSubmitError(null)
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
        res = await trainersApi.startTraining(
          selected,
          overrides,
          { compute_type: compute, gpu_type_id: compute === 'cloud_gpu' ? gpuTypeId : undefined },
          datasetOverrideSlug ?? undefined,
        )
      }
      job.startTracking(res.job_id)
      setJobsKey(k => k + 1)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  return (
    <>
      {/* Dataset upload slide-over */}
      {showDsUpload && dsDataset && (
        <DatasetUploadModal
          dataset={dsDataset}
          onClose={() => setShowDsUpload(false)}
          onUploaded={async () => {
            setShowDsUpload(false)
            // Refresh entry count
            try {
              const { count } = await datasetsApi.getEntryCount(dsDataset.id)
              setDsEntryCount(count)
            } catch {}
          }}
        />
      )}

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

          {/* Mode toggle — only for file-source trainers (user supplies the data file) */}
          {isFileSource && (
            <div className="flex gap-1 bg-gray-900 rounded-xl p-1 w-fit">
              {(['simple', 'with-data'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={clsx('px-3 py-1.5 text-xs rounded-lg font-medium transition-colors',
                    m === mode ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
                  {m === 'simple' ? 'Standard' : 'Upload Data'}
                </button>
              ))}
            </div>
          )}

          {/* ── Dataset datasource panel ─────────────────────────────────────── */}
          {isDatasetSource && selected && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <Database size={13} className="text-sky-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-200">Training Dataset</span>
                  {datasetOverrideSlug && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-900/40 border border-brand-700/50 text-brand-400">overridden</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowDsPicker(v => {
                        if (!v && allDatasets.length === 0) {
                          setAllDsLoading(true)
                          datasetsApi.list().then(setAllDatasets).catch(() => {}).finally(() => setAllDsLoading(false))
                        }
                        return !v
                      })
                    }}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-brand-400 transition-colors"
                    title="Switch dataset"
                  >
                    <ChevronRight size={11} className={clsx('transition-transform', showDsPicker && 'rotate-90')} />
                    Switch
                  </button>
                  <button
                    onClick={() => {
                      setDsLoading(true)
                      const effectiveSlug = datasetOverrideSlug ?? (dsInfo?.dataset_slug as string | undefined)
                      const id            = dsInfo?.dataset_id as string | undefined
                      const req = effectiveSlug ? datasetsApi.getBySlug(effectiveSlug) : datasetsApi.get(id!)
                      req.then(async ds => {
                        setDsDataset(ds)
                        const { count } = await datasetsApi.getEntryCount(ds.id)
                        setDsEntryCount(count)
                      }).catch(() => {}).finally(() => setDsLoading(false))
                    }}
                    className="text-gray-600 hover:text-gray-300 transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={12} className={dsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* ── Dataset picker ─────────────────────────────────────────────── */}
              {showDsPicker && (
                <div className="border-b border-gray-800 bg-gray-950/60 px-4 py-3 space-y-2">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Select a dataset</p>
                  {allDsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                      <Loader2 size={11} className="animate-spin" /> Loading datasets…
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {/* "Default" option */}
                      <button
                        onClick={() => { setDatasetOverrideSlug(null); setShowDsPicker(false) }}
                        className={clsx(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors',
                          !datasetOverrideSlug
                            ? 'bg-brand-900/30 border border-brand-700/40 text-brand-300'
                            : 'bg-gray-800/60 border border-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                        )}
                      >
                        <Database size={11} className="flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate">
                          {dsInfo?.dataset_slug as string} <span className="text-gray-600">(default)</span>
                        </span>
                        {!datasetOverrideSlug && <CheckCircle2 size={11} className="text-brand-400 flex-shrink-0" />}
                      </button>
                      {allDatasets
                        .filter(d => d.slug !== (dsInfo?.dataset_slug as string))
                        .map(d => (
                          <button
                            key={d.id}
                            onClick={() => { setDatasetOverrideSlug(d.slug); setShowDsPicker(false) }}
                            className={clsx(
                              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors',
                              datasetOverrideSlug === d.slug
                                ? 'bg-brand-900/30 border border-brand-700/40 text-brand-300'
                                : 'bg-gray-800/60 border border-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                            )}
                          >
                            <Database size={11} className="flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="truncate block">{d.name}</span>
                              {d.slug && <span className="font-mono text-[10px] text-gray-600">{d.slug}</span>}
                            </div>
                            {datasetOverrideSlug === d.slug && <CheckCircle2 size={11} className="text-brand-400 flex-shrink-0" />}
                          </button>
                        ))
                      }
                      {allDatasets.filter(d => d.slug !== (dsInfo?.dataset_slug as string)).length === 0 && (
                        <p className="text-[11px] text-gray-600 px-2 py-1">No other datasets — upload data to the default dataset or create a new one.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Body */}
              <div className="p-4 space-y-4">
                {dsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={12} className="animate-spin" /> Loading dataset info…
                  </div>

                ) : dsError ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2.5">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>{dsError}</span>
                    </div>
                    <p className="text-[11px] text-gray-600">
                      Slug: <code className="font-mono text-gray-500">{datasetOverrideSlug ?? (dsInfo?.dataset_slug as string)}</code>
                    </p>
                  </div>

                ) : dsDataset ? (
                  <div className="space-y-3">
                    {/* Dataset identity */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{dsDataset.name}</p>
                        {dsDataset.slug && (
                          <p className="text-[11px] text-gray-600 font-mono mt-0.5">{dsDataset.slug}</p>
                        )}
                        {dsDataset.description && (
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{dsDataset.description}</p>
                        )}
                      </div>
                      {/* Entry count badge */}
                      <div className={clsx(
                        'flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border',
                        dsEntryCount === null
                          ? 'bg-gray-800 border-gray-700 text-gray-500'
                          : dsEntryCount === 0
                          ? 'bg-red-950/40 border-red-800/50 text-red-400'
                          : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400',
                      )}>
                        {dsEntryCount === null ? '—' : dsEntryCount === 0 ? 'Empty' : `${dsEntryCount} entr${dsEntryCount === 1 ? 'y' : 'ies'}`}
                      </div>
                    </div>

                    {/* Empty warning */}
                    {dsEntryCount === 0 && (
                      <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2.5">
                        <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                        <span>Dataset is empty — upload training data before starting a run.</span>
                      </div>
                    )}

                    {/* Fields list */}
                    {dsDataset.fields.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Fields</p>
                        <div className="space-y-1">
                          {dsDataset.fields.sort((a, b) => a.order - b.order).map(f => (
                            <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800/60 rounded-lg">
                              <Database size={10} className="text-sky-600 flex-shrink-0" />
                              <span className="text-xs text-gray-200 flex-1 min-w-0 truncate">{f.label}</span>
                              <span className="text-[10px] text-gray-600 bg-gray-900 border border-gray-700 px-1.5 py-0.5 rounded font-mono flex-shrink-0">{f.type}</span>
                              {f.required && <span className="text-[10px] text-red-500 flex-shrink-0">*</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {dsDataset.fields.length === 0 && (
                      <p className="text-xs text-gray-600">No fields defined on this dataset.</p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => setShowDsUpload(true)}
                        className={clsx(
                          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                          dsEntryCount === 0
                            ? 'bg-brand-600 hover:bg-brand-700 text-white'
                            : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white',
                        )}
                      >
                        <Upload size={11} />
                        {dsEntryCount === 0 ? 'Upload Training Data' : 'Add More Data'}
                      </button>
                      {(dsInfo?.sample_csv_endpoint as string) && (
                        <a
                          href={dsInfo.sample_csv_endpoint as string}
                          download
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 bg-gray-800 border border-gray-700 rounded-lg transition-colors"
                        >
                          <Download size={11} /> Sample CSV
                        </a>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ── Auto-loaded data source description ─────────────────────────── */}
          {isAutoSource && selected && (
            <AutoSourcePanel dsInfo={dsInfo!} trainerDescription={selectedTrainer?.description ?? ''} />
          )}

          {/* ── File upload (UploadedFileDataSource only) ────────────────────── */}
          {isFileSource && mode === 'with-data' && (
            <div>
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

          {/* Compute selector — tab style */}
          <div>
            <div className="flex gap-0.5 border-b border-gray-800 mb-4">
              {([
                { id: 'local',     label: '🖥 Standard' },
                { id: 'cloud_gpu', label: '⚡ Accelerated' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCompute(tab.id)}
                  className={clsx(
                    'px-4 py-2.5 text-sm font-medium transition-colors relative',
                    compute === tab.id
                      ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                      : 'text-gray-500 hover:text-gray-300',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Local compute card */}
            {compute === 'local' && (
              localInfoLoading ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={12} className="animate-spin" /> Loading compute info…
                </div>
              ) : localInfo ? (
                <LocalComputeCard
                  info={localInfo}
                  wallet={wallet}
                  priceOverride={localPriceOverride}
                />
              ) : (
                /* Fallback: API failed — still show price card so user can proceed */
                <div className="mt-3 space-y-3">
                  <div className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-700 bg-gray-900">
                    <div className="flex items-center gap-2.5">
                      <Cpu size={13} className="text-gray-500 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-white">Standard compute</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {localInfoError ? 'Could not detect hardware' : 'Detecting…'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-white">${localPriceOverride.toFixed(2)}</div>
                      <div className="text-[10px] text-gray-600">USD / hr</div>
                    </div>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-500">
                      <span>Rate</span>
                      <span className="text-gray-300">${localPriceOverride.toFixed(2)} USD / hr</span>
                    </div>
                    <div className="flex justify-between text-amber-500 font-medium">
                      <span>Reservation (1.5×)</span>
                      <span>${(localPriceOverride * 1.5).toFixed(2)} USD</span>
                    </div>
                    {wallet && (
                      <div className={clsx('flex justify-between font-semibold pt-1 border-t border-gray-800',
                        wallet.balance >= localPriceOverride * 1.5 ? 'text-emerald-400' : 'text-red-400')}>
                        <span>Wallet balance</span>
                        <span>${wallet.balance.toFixed(2)} USD</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {/* Cloud GPU */}
            {compute === 'cloud_gpu' && (
              <div className="mt-3 space-y-3">
                {!gpuAvailable ? (
                  <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                    No cloud GPU configured. Add <code className="font-mono">RUNPOD_API_KEY</code> in Config.
                  </p>
                ) : (
                  <>
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

                    {selectedGpu && wallet && (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between text-gray-500">
                          <span>Est. cost (1 hr)</span>
                          <span className="text-gray-300">${cloudEstimatedCost.toFixed(2)} USD</span>
                        </div>
                        <div className="flex justify-between text-amber-500 font-medium">
                          <span>Reservation (3×)</span>
                          <span>${cloudReservation.toFixed(2)} USD</span>
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
          {(() => {
            const dsAllowEmpty = dsInfo?.allow_empty === true
            const datasetEmpty = isDatasetSource && !dsAllowEmpty && (dsEntryCount === 0 || (dsLoading && dsEntryCount === null))
            const datasetNotFound = isDatasetSource && !!dsError
            const isDisabled =
              loading
              || !selected
              || (compute === 'cloud_gpu' && !gpuAvailable)
              || (compute === 'cloud_gpu' && insufficientBalance)
              || localInsufficient
              || datasetEmpty
              || datasetNotFound
            return (
              <div className="space-y-2">
                <button
                  onClick={submit}
                  disabled={isDisabled}
                  className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                  {loading ? 'Queueing…' : 'Start Training'}
                </button>
                {datasetEmpty && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/30 border border-amber-800/40 rounded-lg text-xs text-amber-300">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    <span>
                      Training is blocked — the dataset is empty.{' '}
                      <button
                        onClick={() => setShowDsUpload(true)}
                        className="underline underline-offset-2 hover:text-amber-100 transition-colors"
                      >
                        Upload data
                      </button>
                      {' '}to continue.
                    </span>
                  </div>
                )}
                {datasetNotFound && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-950/30 border border-red-800/40 rounded-lg text-xs text-red-400">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    <span>Dataset not found — install the trainer plugin first to create it.</span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Submit error */}
          {submitError && (
            <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={15} /> {submitError}
            </div>
          )}

          {/* ── Live training logs panel ──────────────────────────────────── */}
          {job.state.jobId && !job.isBackground && (
            <div className="border border-gray-700/60 rounded-xl overflow-hidden bg-gray-950">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-700/60 bg-gray-900/60">
                <Terminal size={13} className="text-gray-500" />
                <span className="text-xs font-mono text-gray-400 flex-1">
                  {job.state.trainerName ?? selected}
                  {' '}
                  <span className={clsx('font-semibold', {
                    'text-blue-400': job.state.status === 'queued',
                    'text-amber-400 animate-pulse': job.state.status === 'running',
                    'text-emerald-400': job.state.status === 'completed',
                    'text-red-400': job.state.status === 'failed',
                  })}>
                    [{job.state.status ?? 'connecting…'}]
                  </span>
                </span>

                {/* Metrics inline */}
                {Object.entries(job.state.metrics).slice(0, 3).map(([k, v]) => (
                  <span key={k} className="text-[10px] text-gray-600 font-mono">
                    {k}: <span className="text-gray-400">{typeof v === 'number' ? v.toFixed(4) : v}</span>
                  </span>
                ))}

                <div className="flex items-center gap-1.5">
                  {/* Run in background */}
                  {job.state.status === 'running' && (
                    <button
                      onClick={job.runInBackground}
                      title="Run in background — you'll get a notification when done"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 border border-gray-700 rounded-lg transition-colors"
                    >
                      <Minimize2 size={10} /> Background
                    </button>
                  )}
                  {/* Reconnect when SSE is disconnected */}
                  {!job.state.status?.match(/running|queued/) && (
                    <button onClick={job.reconnect} className="p-1 text-gray-600 hover:text-gray-300 transition-colors" title="Reconnect">
                      <RefreshCw size={11} />
                    </button>
                  )}
                  {/* Dismiss */}
                  <button onClick={job.dismiss} className="p-1 text-gray-700 hover:text-gray-400 transition-colors" title="Dismiss">
                    <X size={11} />
                  </button>
                </div>
              </div>

              {/* Log lines */}
              <div className="h-56 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px]">
                {job.state.logs.length === 0 && (
                  <p className="text-gray-700">Waiting for logs…</p>
                )}
                {job.state.logs.map((line, i) => (
                  <div key={i} className={clsx('leading-relaxed', {
                    'text-red-400': line.includes('[error]') || line.includes('Error') || line.includes('✗'),
                    'text-emerald-400': line.includes('✓') || line.includes('complete'),
                    'text-amber-300': line.includes('Metrics:'),
                    'text-gray-500': !line.includes('[error]') && !line.includes('✓') && !line.includes('Metrics:'),
                  })}>
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>

              {/* Error */}
              {job.state.error && (
                <div className="border-t border-red-800/40 px-4 py-2 bg-red-950/20 text-xs text-red-400">
                  {job.state.error}
                </div>
              )}

              {/* Completed CTA */}
              {job.state.status === 'completed' && (
                <div className="border-t border-emerald-800/40 px-4 py-2.5 bg-emerald-950/20 flex items-center gap-3">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <span className="text-xs text-emerald-300 flex-1">Training complete — model deployed</span>
                  <button
                    onClick={job.dismiss}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-900/50 border border-emerald-700 text-emerald-400 rounded-lg hover:bg-emerald-800/50 transition-colors"
                  >
                    <ArrowDownToLine size={11} /> View in Jobs
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Background job banner */}
          {job.state.jobId && job.isBackground && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-950/30 border border-amber-800/40 rounded-xl">
              <Loader2 size={13} className="text-amber-400 animate-spin flex-shrink-0" />
              <span className="text-xs text-amber-300 flex-1">
                Training running in background — you'll get a notification when done
              </span>
              <button
                onClick={job.reconnect}
                className="text-xs text-amber-400 hover:text-amber-200 underline"
              >
                Show logs
              </button>
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
