import { useState, useEffect, useRef } from 'react'
import { trainersApi } from '@/api/trainers'
import { datasetsApi } from '@/api/datasets'
import { trainerSubmissionsApi } from '@/api/trainerSubmissions'
import client from '@/api/client'
import type { TrainerRegistration, TrainerGroup } from '@/types/trainer'
import type { DatasetProfile } from '@/types/dataset'
import type { TrainerSubmission } from '@/types/trainerSubmission'
import StatusBadge from './StatusBadge'
import JobsPanel from './JobsPanel'
import DatasetUploadModal from './DatasetUploadModal'
import TrainerAnomalyModal from './TrainerAnomalyModal'
import {
  Upload, RefreshCw, Scan, Trash2, Brain, Loader2, ChevronDown, ChevronRight,
  ChevronLeft, Play, Database, AlertTriangle, CheckCircle2, X, Plus, ExternalLink,
  Download, ShieldCheck, ShieldAlert, Clock, Copy, Globe, Lock,
} from 'lucide-react'
import clsx from 'clsx'

const PAGE_SIZE = 10

interface Props {
  onStartTraining?: (trainerName: string) => void
  onGoDatasets?: () => void
}

type Tab = 'trainers' | 'jobs'
type TrainerScope = 'private' | 'public'

// ─── Dataset status chip (for trainer card) ────────────────────────────────

function DatasetChip({
  datasetId,
  datasetSlug,
  onUpload,
  onGoDatasets,
}: {
  datasetId?: string
  datasetSlug?: string
  onUpload: (dataset: DatasetProfile) => void
  onGoDatasets?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState<number | null>(null)
  const [dataset, setDataset] = useState<DatasetProfile | null>(null)
  const [error, setError] = useState(false)

  const fetchInfo = async () => {
    setLoading(true)
    setError(false)
    try {
      // Prefer slug-based lookup; fall back to id-based
      let profile: DatasetProfile
      if (datasetSlug) {
        profile = await datasetsApi.getBySlug(datasetSlug)
      } else if (datasetId) {
        profile = await datasetsApi.get(datasetId)
      } else {
        setError(true)
        setLoading(false)
        return
      }
      const { count: c } = await datasetsApi.getEntryCount(profile.id)
      setDataset(profile)
      setCount(c)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInfo() }, [datasetId, datasetSlug])

  if (loading) return (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
      <Loader2 size={11} className="animate-spin" /> checking dataset…
    </div>
  )

  if (error || !dataset) return (
    <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
      <AlertTriangle size={11} />
      Dataset not found
      {datasetSlug && <span className="font-mono text-amber-400"> #{datasetSlug}</span>}
      {!datasetSlug && datasetId && <span className="text-amber-400"> ({datasetId.slice(0, 8)}…)</span>}
      {' — '}create it in Datasets first
    </div>
  )

  if (count === 0) return (
    <div className="flex items-start gap-3 p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl">
      <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-300">Dataset is empty — training will fail</p>
        <p className="text-[11px] text-amber-400/70 mt-0.5">
          <span className="font-medium text-amber-200">{dataset.name}</span>
          {dataset.slug && <span className="ml-1 text-amber-500/60">#{dataset.slug}</span>}
          {' '}has no entries yet.
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onUpload(dataset)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-[11px] font-medium text-white rounded-lg transition-colors"
          >
            <Upload size={10} /> Upload Training Data
          </button>
          {onGoDatasets && (
            <button
              onClick={onGoDatasets}
              className="flex items-center gap-1 text-[11px] text-amber-500 hover:text-amber-300 transition-colors"
            >
              <ExternalLink size={10} /> Open Datasets
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <CheckCircle2 size={12} className="text-emerald-400" />
      <span className="text-gray-300 font-medium">{dataset.name}</span>
      {dataset.slug && (
        <span className="text-[10px] text-gray-600 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded font-mono">
          #{dataset.slug}
        </span>
      )}
      <span className="text-gray-600">·</span>
      <span className="text-emerald-400">{count?.toLocaleString()} entries</span>
      {onGoDatasets && (
        <button onClick={onGoDatasets} className="text-gray-600 hover:text-brand-400 transition-colors ml-1">
          <ExternalLink size={10} />
        </button>
      )}
    </div>
  )
}

// ─── Data source info row ──────────────────────────────────────────────────

function autoDataDescription(type: string, info: Record<string, unknown>): string {
  switch (type) {
    case 'memory':   return 'Uses built-in data — no upload needed.'
    case 'inline':   return 'Data is embedded directly in the trainer.'
    case 's3':       return `Fetches data from S3 bucket "${info.bucket ?? ''}${info.key ? `/${info.key}` : ''}".`
    case 'mongodb':  return `Queries MongoDB collection "${info.collection ?? ''}"${info.database ? ` in database "${info.database}"` : ''}.`
    case 'postgresql':
    case 'sql':      return 'Runs a SQL query to load training data automatically.'
    case 'url':      return `Downloads training data from: ${info.url ?? 'a remote URL'}.`
    case 'huggingface': return `Loads the "${info.dataset ?? ''}" dataset from Hugging Face Hub.`
    case 'kafka':    return `Consumes messages from Kafka topic "${info.topic ?? ''}".`
    case 'redis':    return `Reads training data from Redis key "${info.key ?? ''}".`
    case 'local_file': return `Reads training data from local path "${info.path ?? ''}".`
    case 'paginated_api': return `Fetches training data from a paginated API.`
    case 'file':     return 'Training data is uploaded when the training job is started.'
    default:         return `Fetches its own training data automatically (source: ${type}).`
  }
}

function DataSourceRow({
  info,
  onUpload,
  onGoDatasets,
}: {
  info: Record<string, unknown>
  onUpload: (dataset: DatasetProfile) => void
  onGoDatasets?: () => void
}) {
  const type = (info.type as string) ?? 'unknown'
  const [downloading, setDownloading] = useState(false)

  const sampleCsvEndpoint = typeof info.sample_csv_endpoint === 'string' ? info.sample_csv_endpoint : null
  const datasetId = typeof info.dataset_id === 'string' && info.dataset_id ? info.dataset_id : undefined
  const datasetSlug = typeof info.dataset_slug === 'string' && info.dataset_slug ? info.dataset_slug : undefined
  const isDataset = type === 'dataset' && (datasetId || datasetSlug)

  const handleDownloadSample = async () => {
    if (!sampleCsvEndpoint) return
    setDownloading(true)
    try {
      const resp = await client.get(sampleCsvEndpoint, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'sample_training_data.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
    finally { setDownloading(false) }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Database size={12} className="text-brand-400" />
        <span className="text-[10px] text-gray-600 uppercase tracking-widest">Training Data</span>

        {isDataset ? (
          /* Dataset source — show badge + optional sample download */
          <>
            <span className="text-[10px] text-brand-300 bg-brand-900/40 border border-brand-800/50 px-1.5 py-0.5 rounded">
              MLDock Dataset
            </span>
            {sampleCsvEndpoint && (
              <button
                onClick={handleDownloadSample}
                disabled={downloading}
                className="flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-300 transition-colors disabled:opacity-50"
              >
                {downloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                Download Sample CSV
              </button>
            )}
          </>
        ) : (
          /* Non-dataset source — describe where data comes from, no upload UI */
          <span className="text-[11px] text-gray-500 italic">
            {autoDataDescription(type, info)}
          </span>
        )}
      </div>

      {/* Dataset chip with empty-state upload — only for dataset sources */}
      {isDataset && (
        <DatasetChip
          datasetId={datasetId}
          datasetSlug={datasetSlug}
          onUpload={onUpload}
          onGoDatasets={onGoDatasets}
        />
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function TrainersPage({ onStartTraining, onGoDatasets }: Props) {
  const [tab, setTab] = useState<Tab>('trainers')
  const [scope, setScope] = useState<TrainerScope>('private')
  const [trainers, setTrainers] = useState<TrainerRegistration[]>([])
  const [publicTrainers, setPublicTrainers] = useState<TrainerRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [uploadDataset, setUploadDataset] = useState<DatasetProfile | null>(null)
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({})
  const [expandedTab, setExpandedTab] = useState<Record<string, 'details' | 'upload'>>({})
  const [cloningName, setCloningName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // LLM scan state
  const [scanSubmission, setScanSubmission] = useState<TrainerSubmission | null>(null)
  const [scanPolling, setScanPolling] = useState(false)
  const [anomalyModalOpen, setAnomalyModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [priv, pub] = await Promise.all([trainersApi.list(), trainersApi.listPublic()])
      setTrainers(priv)
      setPublicTrainers(pub)
    } catch {}
    finally { setLoading(false) }
  }

  const handleClone = async (name: string) => {
    setCloningName(name)
    try {
      await trainersApi.clone(name)
      setUploadMsg(`Cloned "${name}" to your workspace`)
      setScope('private')
      await load()
    } catch {
      setUploadMsg(`Failed to clone "${name}"`)
    } finally {
      setCloningName(null)
      setTimeout(() => setUploadMsg(null), 4000)
    }
  }

  useEffect(() => { load() }, [])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await trainersApi.scan()
      setUploadMsg(`Scan complete — ${res.trainers_registered} trainer(s) registered`)
      await load()
    } catch {}
    finally { setScanning(false); setTimeout(() => setUploadMsg(null), 3000) }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadMsg(null)
    setScanSubmission(null)
    try {
      // Use submission API — triggers security scan in background
      const submission = await trainerSubmissionsApi.upload(file)
      setScanSubmission(submission)
      setUploadMsg(`Uploaded "${file.name}" — running security scan…`)

      // Poll until scan completes (not 'scanning')
      setScanPolling(true)
      let attempts = 0
      const poll = async () => {
        try {
          const updated = await trainerSubmissionsApi.get(submission.id)
          setScanSubmission(updated)
          if (updated.status !== 'scanning' || attempts >= 30) {
            setScanPolling(false)
            setAnomalyModalOpen(true)
            setUploadMsg(
              updated.status === 'approved'
                ? `✓ "${file.name}" passed security scan and is now active`
                : `⚠ "${file.name}" flagged for review — see scan results`
            )
            await load()
          } else {
            attempts++
            setTimeout(poll, 2000)
          }
        } catch {
          setScanPolling(false)
        }
      }
      setTimeout(poll, 2000)
    } catch (err: unknown) {
      setUploadMsg(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
      setUploading(false)
    } finally {
      setUploading(false)
      setTimeout(() => setUploadMsg(null), 8000)
    }
  }

  const handleDeactivate = async (name: string) => {
    if (!confirm(`Deactivate trainer "${name}"?`)) return
    await trainersApi.deactivate(name)
    setTrainers(prev => prev.filter(t => t.name !== name))
  }

  const frameworkColor = (fw: string) => {
    const map: Record<string, string> = {
      sklearn: 'text-orange-400', pytorch: 'text-red-400', tensorflow: 'text-yellow-400',
      keras: 'text-pink-400', yolo: 'text-green-400', roboflow: 'text-purple-400',
    }
    return map[fw?.toLowerCase()] ?? 'text-gray-400'
  }

  const activeList = scope === 'private' ? trainers : publicTrainers

  // Group trainers by base_name so versioned trainers appear as one entry
  const groups: TrainerGroup[] = (() => {
    const map = new Map<string, TrainerRegistration[]>()
    for (const t of activeList) {
      const key = t.base_name || t.name.replace(/_v\d+$/, '') || t.name
      const arr = map.get(key) ?? []
      arr.push(t)
      map.set(key, arr)
    }
    return Array.from(map.entries()).map(([base_name, versions]) => {
      // Sort highest plugin_version first
      const sorted = [...versions].sort((a, b) => (b.plugin_version ?? 0) - (a.plugin_version ?? 0))
      // Prefer the highest approved+active version as the "latest" shown on the card.
      // If none are approved (e.g. all under review) fall back to the highest version.
      const approved = sorted.filter(v => v.is_active && v.approval_status === 'approved')
      const latest = approved[0] ?? sorted[0]
      return { base_name, latest, versions: sorted }
    })
  })()

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = groups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'trainers', label: 'Trainer Plugins', count: groups.length },
    { id: 'jobs',     label: 'Training Jobs' },
  ]

  const SCOPE_TABS: { id: TrainerScope; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'private', label: 'My Trainers',     icon: <Lock size={11} />,  count: trainers.length },
    { id: 'public',  label: 'Public Library',  icon: <Globe size={11} />, count: publicTrainers.length },
  ]

  return (
    <div className="space-y-5">
      {/* Actions bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-colors"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Upload Plugin (.py)
        </button>
        <input ref={fileRef} type="file" accept=".py" className="hidden"
          onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

        <button onClick={handleScan} disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-xl text-sm font-medium text-gray-300 border border-gray-700 transition-colors">
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
          Scan Plugin Dir
        </button>

        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Scan status badge */}
        {scanSubmission && (
          <button
            onClick={() => setAnomalyModalOpen(true)}
            className={clsx(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
              scanPolling
                ? 'bg-amber-950/40 border-amber-800/50 text-amber-400'
                : scanSubmission.status === 'approved'
                  ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400'
                  : 'bg-red-950/40 border-red-800/50 text-red-400'
            )}
          >
            {scanPolling
              ? <><Loader2 size={11} className="animate-spin" /> Scanning…</>
              : scanSubmission.status === 'approved'
                ? <><ShieldCheck size={11} /> Scan passed</>
                : <><ShieldAlert size={11} /> Review needed</>}
          </button>
        )}

        {uploadMsg && !scanSubmission && (
          <span className={clsx('text-xs px-3 py-1.5 rounded-lg border', uploadMsg.includes('failed')
            ? 'bg-red-950/50 text-red-400 border-red-800'
            : 'bg-emerald-950/50 text-emerald-400 border-emerald-800'
          )}>
            {uploadMsg}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300'
            )}>
            {t.label}
            {t.count !== undefined && (
              <span className={clsx('ml-2 text-[10px] px-1.5 py-0.5 rounded-full',
                tab === t.id ? 'bg-brand-900/60 text-brand-400' : 'bg-gray-800 text-gray-600')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Trainers tab ── */}
      {tab === 'trainers' && (
        <>
          {/* Scope sub-tabs */}
          <div className="flex gap-1 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
            {SCOPE_TABS.map(st => (
              <button
                key={st.id}
                onClick={() => { setScope(st.id); setPage(1); setExpanded(null) }}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  scope === st.id
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                )}
              >
                {st.icon}
                {st.label}
                <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full',
                  scope === st.id ? 'bg-gray-600 text-gray-200' : 'bg-gray-800 text-gray-600')}>
                  {st.count}
                </span>
              </button>
            ))}
          </div>

          {scope === 'public' && (
            <p className="text-[11px] text-gray-600">
              Public trainers are read-only templates. Clone one to your workspace to train and customise it.
            </p>
          )}
          <p className="text-xs text-gray-600">
            {activeList.length} trainer{activeList.length !== 1 ? 's' : ''}
            {totalPages > 1 && ` · page ${safePage}/${totalPages}`}
          </p>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-gray-900 rounded-2xl h-16 border border-gray-800 animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <Brain size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No trainers registered. Upload a .py plugin or scan the plugin directory.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {paginated.map(group => {
                  const t = group.latest
                  const groupKey = group.base_name
                  const dsInfo = t.data_source_info ?? {}
                  const isDatasetSource = dsInfo.type === 'dataset' && Boolean(dsInfo.dataset_id || dsInfo.dataset_slug)
                  const hasVersions = group.versions.length > 1
                  return (
                    <div key={groupKey} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      {/* ── Header row ─────────────────────────────────── */}
                      <div className="flex items-center gap-3 px-5 py-4">
                        <button onClick={() => setExpanded(expanded === groupKey ? null : groupKey)}
                          className="text-gray-500 hover:text-gray-300">
                          {expanded === groupKey ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <div className="w-9 h-9 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
                          <Brain size={16} className="text-brand-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-100">{group.base_name}</span>
                            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700 font-mono">
                              {t.version_full ?? `v${t.plugin_version ?? 0}.0.0.0`}
                            </span>
                            <span className={clsx('text-[10px] font-medium', frameworkColor(t.framework))}>{t.framework}</span>
                            {isDatasetSource && (
                              <span className="flex items-center gap-1 text-[10px] text-brand-300 bg-brand-900/30 border border-brand-800/40 px-1.5 py-0.5 rounded">
                                <Database size={9} /> dataset
                              </span>
                            )}
                            {hasVersions && (
                              <span className="text-[10px] text-gray-600">
                                {group.versions.length} versions
                              </span>
                            )}
                            {!t.is_active && <StatusBadge status="inactive" />}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-0.5">{t.description || 'No description'}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {scope === 'public' ? (
                            <button
                              onClick={() => handleClone(t.name)}
                              disabled={cloningName === t.name}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {cloningName === t.name
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Copy size={11} />}
                              Clone
                            </button>
                          ) : (
                            <>
                              {onStartTraining && (
                                <button onClick={() => onStartTraining(t.name)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-900/50 hover:bg-brand-900 text-brand-400 border border-brand-800/50 rounded-lg transition-colors">
                                  <Play size={11} /> Train
                                </button>
                              )}
                              <button onClick={() => handleDeactivate(t.name)}
                                className="p-1.5 text-gray-700 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors"
                                title="Deactivate">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* ── Expanded panel ─────────────────────────────── */}
                      {expanded === groupKey && (() => {
                        const activeTab = expandedTab[t.id] ?? 'details'
                        const hasDataSource = typeof dsInfo.type === 'string' && dsInfo.type
                        return (
                          <div className="border-t border-gray-800">
                            {/* Tab bar */}
                            <div className="flex gap-0 border-b border-gray-800 px-5">
                              {(['details', ...(hasDataSource ? ['upload'] : [])] as const).map(tab => (
                                <button
                                  key={tab}
                                  onClick={() => setExpandedTab(prev => ({ ...prev, [t.id]: tab as 'details' | 'upload' }))}
                                  className={clsx(
                                    'px-3 py-2 text-[11px] font-medium transition-colors relative capitalize',
                                    activeTab === tab
                                      ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500'
                                      : 'text-gray-500 hover:text-gray-300'
                                  )}
                                >
                                  {tab === 'upload' ? 'Training Data' : 'Details'}
                                </button>
                              ))}
                            </div>

                            {/* Tab content */}
                            <div className="px-5 py-4 space-y-4">
                              {activeTab === 'details' && (
                                <>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                    <Info label="Framework" value={t.framework} />
                                    <Info label="Schedule" value={t.schedule || 'Manual only'} />
                                    <Info label="Last Trained" value={t.last_trained_at ? new Date(t.last_trained_at).toLocaleDateString() : 'Never'} />
                                    <Info label="Registered" value={t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'} />
                                  </div>
                                  {t.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {t.tags.map(tag => (
                                        <span key={tag} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">{tag}</span>
                                      ))}
                                    </div>
                                  )}

                                  {/* ── Previous versions collapsible ──── */}
                                  {hasVersions && (
                                    <VersionHistory
                                      versions={group.versions.slice(1)}
                                      onStartTraining={scope === 'private' ? onStartTraining : undefined}
                                      onDeactivate={handleDeactivate}
                                      readOnly={scope === 'public'}
                                    />
                                  )}
                                </>
                              )}
                              {activeTab === 'upload' && hasDataSource && (
                                <DataSourceRow
                                  info={dsInfo}
                                  key={`${t.id}-${refreshKeys[dsInfo.dataset_id as string] ?? 0}`}
                                  onUpload={ds => setUploadDataset(ds)}
                                  onGoDatasets={onGoDatasets}
                                />
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
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
                        : <button key={p} onClick={() => setPage(p as number)}
                            className={clsx('w-7 h-7 text-xs rounded-lg transition-colors',
                              p === safePage ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
                            {p}
                          </button>
                      )}
                  </div>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Jobs tab ── */}
      {tab === 'jobs' && <JobsPanel />}

      {/* Dataset upload modal */}
      {uploadDataset && (
        <DatasetUploadModal
          dataset={uploadDataset}
          onClose={() => setUploadDataset(null)}
          onUploaded={() => {
            const dsId = uploadDataset.id
            setRefreshKeys(prev => ({ ...prev, [dsId]: (prev[dsId] ?? 0) + 1 }))
          }}
        />
      )}

      {/* Scan result modal */}
      <TrainerAnomalyModal
        open={anomalyModalOpen}
        onClose={() => setAnomalyModalOpen(false)}
        submission={scanSubmission}
      />
    </div>
  )
}

// ─── Version history collapsible ──────────────────────────────────────────

function VersionHistory({
  versions,
  onStartTraining,
  onDeactivate,
  readOnly = false,
}: {
  versions: TrainerRegistration[]
  onStartTraining?: (name: string) => void
  onDeactivate: (name: string) => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (versions.length === 0) return null

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-medium text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Clock size={11} />
          Older plugin versions ({versions.length})
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div className="divide-y divide-gray-800/60">
          {versions.map(v => {
            const pv = v.plugin_version ?? 0
            const tp = v.latest_training_patch ?? 0
            const vFull = v.version_full ?? `v${pv}.0.0.${tp}`
            return (
            <div key={v.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-gray-400">{v.name}</span>
                  <span className="text-[10px] font-mono text-gray-600 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded">
                    {vFull}
                  </span>
                  <span className="text-[10px] text-gray-700">plugin v{pv}</span>
                  {!v.is_active && (
                    <span className="text-[10px] text-gray-700 bg-gray-800 px-1.5 py-0.5 rounded">inactive</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {v.created_at ? `Registered ${new Date(v.created_at).toLocaleDateString()}` : ''}
                  {v.last_trained_at && ` · Last trained ${new Date(v.last_trained_at).toLocaleDateString()}`}
                  {tp > 0 && ` · ${tp} retrain${tp !== 1 ? 's' : ''}`}
                </p>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {onStartTraining && v.is_active && (
                    <button
                      onClick={() => onStartTraining(v.name)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-gray-800 hover:bg-brand-900/50 text-gray-400 hover:text-brand-400 border border-gray-700 hover:border-brand-800/50 rounded-lg transition-colors"
                    >
                      <Play size={9} /> Train
                    </button>
                  )}
                  <button
                    onClick={() => onDeactivate(v.name)}
                    className="p-1 text-gray-700 hover:text-red-400 rounded hover:bg-gray-800 transition-colors"
                    title="Deactivate this version"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-gray-300 font-medium">{value}</p>
    </div>
  )
}
