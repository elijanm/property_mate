import { useState, useEffect, useCallback } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import { modelsApi } from '@/api/models'
import { trainersApi } from '@/api/trainers'
import VersionDropdown from './VersionDropdown'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Image as ImageIcon, AlertCircle, Loader2,
  ChevronDown, ChevronUp, ZoomIn, ChevronLeft, ChevronRight, X,
  Download, Activity, Star, Minus, Lock, Settings2, Tag,
} from 'lucide-react'

interface MetricPoint { step: number; value: number; timestamp: number }
type MetricHistory = Record<string, MetricPoint[]>
interface Artifact { path: string; url: string; label: string }

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
}

// ── Metric colour catalogue ───────────────────────────────────────────────────
const METRIC_COLOR: Record<string, string> = {
  map50: '#6366f1', 'map50-95': '#8b5cf6',
  precision: '#22c55e', recall: '#f59e0b',
  accuracy: '#06b6d4', val_accuracy: '#14b8a6', eval_accuracy: '#14b8a6',
  f1: '#84cc16', f1_score: '#84cc16',
  loss: '#ef4444', train_loss: '#ef4444', training_loss: '#ef4444',
  val_loss: '#f97316', validation_loss: '#f97316',
  box_loss: '#dc2626', cls_loss: '#ea580c', dfl_loss: '#ec4899',
  r2: '#a78bfa', mse: '#fb923c', mae: '#fbbf24',
}
const FALLBACK_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#ec4899',
  '#06b6d4', '#84cc16', '#8b5cf6', '#f97316', '#14b8a6',
]
function colorOf(key: string, idx = 0) {
  return METRIC_COLOR[key.toLowerCase()] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

// Human-friendly label for a raw metric key
function labelOf(key: string): string {
  const MAP: Record<string, string> = {
    map50: 'mAP@50', 'map50-95': 'mAP@50-95',
    val_accuracy: 'Val Accuracy', eval_accuracy: 'Val Accuracy',
    train_loss: 'Train Loss', training_loss: 'Train Loss',
    val_loss: 'Val Loss', validation_loss: 'Val Loss',
    f1_score: 'F1',
  }
  return MAP[key.toLowerCase()] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// System/internal metrics that should never be charted
const SYSTEM_KEYS = new Set([
  'training_duration_s', 'training_duration', 'eval_error',
  'step', 'epoch', 'timestamp',
])
function isSystemKey(key: string) {
  const k = key.toLowerCase()
  return SYSTEM_KEYS.has(k) || k.startsWith('_') || k.endsWith('_timestamp')
}

// Pure loss (cross-entropy, BCE, etc.) — lower is better
function isLossKey(key: string) {
  return key.toLowerCase().includes('loss')
}

// Regression error metrics — lower is better (except r2 which is higher is better)
function isRegressionKey(key: string) {
  const k = key.toLowerCase()
  return k === 'mae' || k === 'mse' || k === 'rmse' || k === 'r2' || k === 'r²' ||
    k.includes('mean_abs') || k.includes('mean_sq') || k.includes('root_mean')
}

// Ratio/performance metrics 0–1 — higher is better
function isRatioKey(key: string) {
  const k = key.toLowerCase()
  return k.includes('accuracy') || k.includes('precision') || k.includes('recall') ||
    k.includes('map') || k === 'f1' || k === 'f1_score' || k.includes('auc') ||
    k === 'iou' || k.includes('dice')
}

// Whether higher value = better result
function isHigherBetter(key: string): boolean {
  const k = key.toLowerCase()
  if (k === 'r2' || k === 'r²') return true
  if (isLossKey(key) || (isRegressionKey(key) && k !== 'r2' && k !== 'r²')) return false
  return true
}

// Build chart rows from a set of MetricPoint series
function toChartData(series: Record<string, MetricPoint[]>) {
  const maxLen = Math.max(...Object.values(series).map(s => s.length), 0)
  if (maxLen === 0) return []
  const rows: { epoch: number; [k: string]: number }[] = []
  for (let i = 0; i < maxLen; i++) {
    const row: { epoch: number; [k: string]: number } = { epoch: i + 1 }
    for (const [key, pts] of Object.entries(series)) {
      if (pts[i] !== undefined) row[key] = pts[i].value
    }
    rows.push(row)
  }
  return rows
}

// Epoch index (1-based) of the best value
function bestEpoch(pts: MetricPoint[], higherBetter: boolean): number {
  if (!pts.length) return -1
  let best = 0
  for (let i = 1; i < pts.length; i++) {
    if (higherBetter ? pts[i].value > pts[best].value : pts[i].value < pts[best].value) best = i
  }
  return best + 1
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes) return null
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return 'n/a'
  // MongoDB sometimes returns "$date" sub-object or plain ISO string
  const iso = typeof raw === 'object' ? (raw as any).$date ?? String(raw) : raw
  const d = new Date(iso)
  if (isNaN(d.getTime())) return raw  // fallback: show raw string
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, isRatio, higherBetter, delta, color }: {
  label: string; value: number; isRatio: boolean; higherBetter: boolean
  delta?: number | null; color: string
}) {
  const health = isRatio && higherBetter
    ? value >= 0.85 ? 'good' : value >= 0.60 ? 'ok' : 'poor'
    : null

  const borderCls = health === 'good' ? 'border-green-800/50' : health === 'ok' ? 'border-yellow-800/50' : health === 'poor' ? 'border-red-900/50' : 'border-gray-700'
  const valueCls  = health === 'good' ? 'text-green-400' : health === 'ok' ? 'text-yellow-400' : health === 'poor' ? 'text-red-400' : 'text-white'

  const display = isRatio
    ? `${(value * 100).toFixed(1)}%`
    : Math.abs(value) >= 1000 ? value.toFixed(0)
    : Math.abs(value) >= 10   ? value.toFixed(2)
    : value.toFixed(4)

  const dPos = delta != null && delta > 0
  const dNeg = delta != null && delta < 0
  const dGood = higherBetter ? dPos : dNeg
  const dStr = delta != null
    ? (dPos ? '+' : '') + (isRatio ? `${(delta * 100).toFixed(1)}%` : Math.abs(delta) < 0.01 ? delta.toFixed(4) : delta.toFixed(3))
    : null

  return (
    <div className={`relative rounded-xl border bg-gray-900 px-4 py-3 min-w-[100px] flex-1`} style={{ borderColor: borderCls.includes('green') ? '#166534' : borderCls.includes('yellow') ? '#92400e' : borderCls.includes('red') ? '#7f1d1d' : '#374151' }}>
      <div className={`text-2xl font-bold tabular-nums tracking-tight ${valueCls}`}>{display}</div>
      <div className="text-[11px] text-gray-400 mt-0.5 font-medium">{label}</div>
      {isRatio && (
        <div className="mt-2 h-1 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(value * 100, 100)}%`, background: color }} />
        </div>
      )}
      {dStr && (
        <div className={`absolute top-2 right-2 flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dGood ? 'bg-green-950/60 text-green-400' : 'bg-red-950/60 text-red-400'}`}>
          {dPos ? <TrendingUp size={8} /> : dNeg ? <TrendingDown size={8} /> : <Minus size={8} />}
          {dStr}
        </div>
      )}
    </div>
  )
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ artifacts, index, onClose, onNav }: {
  artifacts: Artifact[]; index: number; onClose: () => void; onNav: (i: number) => void
}) {
  const a = artifacts[index]
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowRight') onNav((index + 1) % artifacts.length)
    if (e.key === 'ArrowLeft') onNav((index - 1 + artifacts.length) % artifacts.length)
  }, [index, artifacts.length, onClose, onNav])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-w-5xl w-full mx-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-white">{a.label}</p>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">{a.path}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{index + 1} / {artifacts.length}</span>
            <a href={a.url} download className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors" title="Download">
              <Download size={13} />
            </a>
            <button onClick={onClose} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>
        <div className="bg-gray-950 rounded-xl overflow-hidden border border-gray-800">
          <img src={a.url} alt={a.label} className="w-full max-h-[72vh] object-contain" />
        </div>
        {artifacts.length > 1 && (
          <>
            <button onClick={() => onNav((index - 1 + artifacts.length) % artifacts.length)}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 p-2.5 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => onNav((index + 1) % artifacts.length)}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 p-2.5 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white">
              <ChevronRight size={18} />
            </button>
          </>
        )}
        {artifacts.length > 1 && (
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {artifacts.map((art, i) => (
              <button key={art.path} onClick={() => onNav(i)}
                className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-colors ${i === index ? 'border-brand-500' : 'border-gray-700 hover:border-gray-500'}`}>
                <img src={art.url} alt={art.label} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Custom tooltip for charts ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-xl text-xs min-w-[140px]">
      <p className="text-gray-400 mb-2 font-medium">Epoch {label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-0.5">
          <span className="flex items-center gap-1.5 text-gray-300">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
            {labelOf(p.dataKey)}
          </span>
          <span className="font-mono font-semibold" style={{ color: p.color }}>
            {typeof p.value === 'number' ? (Math.abs(p.value) < 1 ? p.value.toFixed(4) : p.value.toFixed(3)) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TrainingResultsPanel({ deployment, allDeployments }: Props) {
  const [selectedDeploy, setSelectedDeploy] = useState<ModelDeployment>(deployment)
  const [metrics, setMetrics] = useState<MetricHistory>({})
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [runParams, setRunParams] = useState<{ params: Record<string, string>; tags: Record<string, string> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [showAllGraphs, setShowAllGraphs] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [downloadable, setDownloadable] = useState<boolean | null>(null)  // null = loading
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const prevDeploy = allDeployments
    ?.filter(d => d.training_patch < selectedDeploy.training_patch)
    .sort((a, b) => b.training_patch - a.training_patch)[0] ?? null

  useEffect(() => {
    if (!selectedDeploy.id) return
    setLoading(true)
    setError('')
    Promise.all([
      modelsApi.getMetricHistory(selectedDeploy.id).catch(() => ({ metrics: {} })),
      modelsApi.getTrainingArtifacts(selectedDeploy.id).catch(() => ({ artifacts: [] })),
      modelsApi.getRunParams(selectedDeploy.id).catch(() => null),
    ]).then(([mh, af, rp]) => {
      setMetrics(mh.metrics)
      setArtifacts(af.artifacts)
      setRunParams(rp)
    }).catch(e => setError(e?.message ?? 'Failed to load training results'))
      .finally(() => setLoading(false))
  }, [selectedDeploy.id])

  // Check if model is downloadable
  useEffect(() => {
    if (!selectedDeploy.trainer_name) return
    setDownloadable(null)
    trainersApi.get(selectedDeploy.trainer_name)
      .then(reg => setDownloadable(reg?.trainer_model_downloadable ?? false))
      .catch(() => setDownloadable(false))
  }, [selectedDeploy.trainer_name])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError('')
    try {
      const filename = `${selectedDeploy.trainer_name}_v${selectedDeploy.training_patch}.zip`
      await modelsApi.downloadModel(selectedDeploy.id, filename)
    } catch (e: any) {
      const msg = e?.response?.data?.detail?.message ?? e?.response?.data?.detail ?? e?.message ?? 'Download failed'
      setDownloadError(msg)
    } finally {
      setDownloading(false)
    }
  }

  if (!selectedDeploy.run_id) {
    return (
      <div className="text-center py-20 text-gray-600 text-sm">
        <TrendingUp size={28} className="mx-auto mb-3 opacity-30" />
        <p>No training run associated with this deployment.</p>
        <p className="text-xs mt-1 text-gray-700">Pre-trained imports don't have MLflow run history.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-12 rounded-xl bg-gray-800/60 animate-pulse" />
        <div className="flex gap-3">
          {[1,2,3,4].map(i => <div key={i} className="flex-1 h-20 rounded-xl bg-gray-900 animate-pulse" />)}
        </div>
        <div className="h-56 rounded-xl bg-gray-900 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 rounded-xl bg-gray-900 animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 bg-red-950/30 border border-red-900 rounded-xl p-4 text-red-400 text-sm">
        <AlertCircle size={16} className="flex-shrink-0" />
        {error}
      </div>
    )
  }

  // ── Build metric cards from deployment.metrics (all keys, not just known ones) ──
  const deployMetrics = selectedDeploy.metrics ?? {}
  const summaryCards = Object.entries(deployMetrics)
    .filter(([key]) => !isSystemKey(key))
    .map(([key, value]) => {
      const prev = prevDeploy?.metrics?.[key]
      return {
        key,
        label: labelOf(key),
        value,
        isRatio: isRatioKey(key) || (value >= 0 && value <= 1 && !isRegressionKey(key) && !isLossKey(key)),
        higherBetter: isHigherBetter(key),
        delta: prev != null ? value - prev : null,
        color: colorOf(key),
      }
    })
    .sort((a, b) => {
      // Ratio metrics first, then scale metrics; within each group alphabetical
      if (a.isRatio !== b.isRatio) return a.isRatio ? -1 : 1
      return a.label.localeCompare(b.label)
    })

  // Radar — ratio metrics that are "higher is better" and not regression keys
  const radarItems = summaryCards.filter(m => m.isRatio && m.higherBetter && !isRegressionKey(m.key))

  // ── Build chart groups ──────────────────────────────────────────────────────
  const allMetricKeys = Object.keys(metrics).filter(k => !isSystemKey(k))
  const lossKeys       = allMetricKeys.filter(isLossKey)
  const ratioKeys      = allMetricKeys.filter(k => isRatioKey(k) && !isLossKey(k))
  const regressionKeys = allMetricKeys.filter(k => isRegressionKey(k) && !isLossKey(k) && !isRatioKey(k))
  const otherKeys      = allMetricKeys.filter(k =>
    !lossKeys.includes(k) && !ratioKeys.includes(k) && !regressionKeys.includes(k))

  interface ChartGroup { title: string; keys: string[]; higherBetter: boolean }
  const chartGroups: ChartGroup[] = []
  if (ratioKeys.length)      chartGroups.push({ title: 'Performance Metrics', keys: ratioKeys, higherBetter: true })
  if (lossKeys.length)       chartGroups.push({ title: 'Loss Curves', keys: lossKeys, higherBetter: false })
  if (regressionKeys.length) chartGroups.push({ title: 'Regression Error', keys: regressionKeys, higherBetter: false })
  if (otherKeys.length)      chartGroups.push({ title: 'Other Metrics', keys: otherKeys, higherBetter: true })

  const visibleGroups = showAllGraphs ? chartGroups : chartGroups.slice(0, 2)
  const hasMetrics   = chartGroups.length > 0
  const hasArtifacts = artifacts.length > 0
  const hasCards     = summaryCards.length > 0
  const empty = !hasMetrics && !hasArtifacts && !hasCards

  const modelSize = formatSize((selectedDeploy as any).model_size_bytes)
  // Backend uses `deployed_at`; frontend type says `created_at` — accept either
  const trainedOn = formatDate((selectedDeploy as any).deployed_at ?? selectedDeploy.created_at)

  return (
    <>
      {lightboxIdx !== null && (
        <Lightbox artifacts={artifacts} index={lightboxIdx} onClose={() => setLightboxIdx(null)} onNav={setLightboxIdx} />
      )}

      <div className="space-y-6">
        {allDeployments && (
          <VersionDropdown
            deployments={allDeployments}
            selected={selectedDeploy}
            onChange={d => { setSelectedDeploy(d); setMetrics({}); setArtifacts([]); setRunParams(null) }}
            label="Training run:"
          />
        )}

        {/* ── Model info bar ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Version</div>
            <div className="text-sm font-bold text-brand-400">{selectedDeploy.version_full || selectedDeploy.version || `v${selectedDeploy.training_patch ?? 0}`}</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Run ID</div>
            <div className="text-sm font-mono text-gray-300 truncate">{selectedDeploy.run_id?.slice(0, 10) ?? 'n/a'}</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Trained on</div>
            <div className="text-sm text-gray-300">{trainedOn}</div>
          </div>
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Model size</div>
            <div className="text-sm text-gray-300">{modelSize ?? 'n/a'}</div>
          </div>
        </div>

        {/* ── Download model ───────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {downloadable === true && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white transition-colors"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {downloading ? 'Packaging…' : 'Download Model'}
            </button>
          )}
          {downloadable === false && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
              <Lock size={12} className="text-gray-600" />
              Model download not enabled by the trainer owner
            </div>
          )}
          {downloadError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={12} /> {downloadError}
            </p>
          )}
        </div>

        {/* ── Eval tags ─────────────────────────────────────────────────── */}
        {selectedDeploy.eval_tags && Object.keys(selectedDeploy.eval_tags).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(selectedDeploy.eval_tags).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-brand-900/30 border border-brand-800/50 text-brand-300">
                <span className="text-brand-500">{k}:</span>{v}
              </span>
            ))}
          </div>
        )}

        {/* ── Training config (MLflow params + tags) ─────────────────────── */}
        {runParams && (Object.keys(runParams.params).length > 0 || Object.keys(runParams.tags).length > 0) && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowConfig(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:bg-gray-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Settings2 size={13} className="text-brand-500" />
                Training Config
                <span className="font-normal text-gray-600 normal-case">
                  {Object.keys(runParams.params).length} params
                  {Object.keys(runParams.tags).length > 0 && ` · ${Object.keys(runParams.tags).length} tags`}
                </span>
              </span>
              {showConfig ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showConfig && (
              <div className="border-t border-gray-800 px-4 py-3 space-y-4">
                {Object.keys(runParams.params).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Parameters</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-1.5">
                      {Object.entries(runParams.params).map(([k, v]) => (
                        <div key={k} className="flex flex-col min-w-0">
                          <span className="text-[10px] text-gray-500 truncate">{k.replace(/_/g, ' ')}</span>
                          <span className="text-xs font-mono text-gray-200 truncate" title={v}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(runParams.tags).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2 flex items-center gap-1.5">
                      <Tag size={10} /> Tags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(runParams.tags).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-gray-800 border border-gray-700 text-gray-300">
                          <span className="text-gray-500">{k}:</span>{v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Metric cards ───────────────────────────────────────────────── */}
        {hasCards && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={13} className="text-brand-500" />
              Final Metrics
              {prevDeploy && <span className="font-normal text-gray-600">vs {prevDeploy.version_full}</span>}
            </h3>
            <div className="flex flex-wrap gap-3">
              {summaryCards.map(m => (
                <MetricCard key={m.key} label={m.label} value={m.value}
                  isRatio={m.isRatio} higherBetter={m.higherBetter}
                  delta={m.delta} color={m.color} />
              ))}
            </div>
          </div>
        )}

        {/* ── Radar chart ───────────────────────────────────────────────── */}
        {radarItems.length >= 3 && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
              <Star size={12} className="text-brand-500" />
              Model Profile
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarItems.map(m => ({ subject: m.label, value: Math.round(m.value * 100) }))}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#4b5563' }} tickCount={3} />
                <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 3 }} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [`${v}%`]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {empty && (
          <div className="text-center py-16 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl">
            <TrendingUp size={28} className="mx-auto mb-3 opacity-30" />
            <p>No training graphs or artifacts for this run.</p>
            <p className="text-xs mt-1 text-gray-700">Run: {selectedDeploy.run_id}</p>
          </div>
        )}

        {/* ── Training curves ───────────────────────────────────────────── */}
        {hasMetrics && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp size={13} className="text-brand-500" />
              Training Curves
            </h3>
            <div className="space-y-5">
              {visibleGroups.map(group => {
                const seriesMap = Object.fromEntries(group.keys.map(k => [k, metrics[k]]).filter(([, v]) => v))
                if (!Object.keys(seriesMap).length) return null
                const chartData = toChartData(seriesMap)
                const primaryKey = group.keys.find(k => seriesMap[k]) ?? group.keys[0]
                const bestEp = seriesMap[primaryKey] ? bestEpoch(seriesMap[primaryKey], group.higherBetter) : -1
                const single = Object.keys(seriesMap).length === 1
                const gradId = `grad-${group.title.replace(/\s/g, '-')}`
                const primaryColor = colorOf(primaryKey, 0)

                return (
                  <div key={group.title} className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-gray-200">{group.title}</h4>
                      {bestEp > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-900/40 px-2 py-0.5 rounded-full">
                          <Star size={9} /> Best epoch {bestEp}
                        </span>
                      )}
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      {single ? (
                        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
                          <defs>
                            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={primaryColor} stopOpacity={0.25} />
                              <stop offset="95%" stopColor={primaryColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                          <XAxis dataKey="epoch" tick={{ fontSize: 11, fill: '#6b7280' }}
                            label={{ value: 'Epoch', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#6b7280' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={52}
                            tickFormatter={v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)} />
                          <Tooltip content={<ChartTooltip />} />
                          {bestEp > 0 && (
                            <ReferenceLine x={bestEp} stroke="#ca8a04" strokeDasharray="5 3" strokeWidth={1.5}
                              label={{ value: '★', position: 'insideTopRight', fill: '#ca8a04', fontSize: 13 }} />
                          )}
                          <Area type="monotone" dataKey={primaryKey} name={labelOf(primaryKey)}
                            stroke={primaryColor} fill={`url(#${gradId})`} strokeWidth={2.5}
                            dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
                        </AreaChart>
                      ) : (
                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                          <XAxis dataKey="epoch" tick={{ fontSize: 11, fill: '#6b7280' }}
                            label={{ value: 'Epoch', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#6b7280' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={52}
                            tickFormatter={v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)} />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 8 }} />
                          {bestEp > 0 && (
                            <ReferenceLine x={bestEp} stroke="#ca8a04" strokeDasharray="5 3" strokeWidth={1.5}
                              label={{ value: '★', position: 'insideTopRight', fill: '#ca8a04', fontSize: 13 }} />
                          )}
                          {Object.keys(seriesMap).map((key, ci) => (
                            <Line key={key} type="monotone" dataKey={key} name={labelOf(key)}
                              stroke={colorOf(key, ci)} dot={false} strokeWidth={2.5} activeDot={{ r: 5, strokeWidth: 0 }} />
                          ))}
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                )
              })}

              {chartGroups.length > 2 && (
                <button onClick={() => setShowAllGraphs(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  {showAllGraphs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {showAllGraphs ? 'Show less' : `Show ${chartGroups.length - 2} more`}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Artifacts gallery ──────────────────────────────────────────── */}
        {hasArtifacts && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ImageIcon size={13} className="text-brand-500" />
              Training Artifacts
              <span className="ml-1 text-[10px] text-gray-600 normal-case font-normal">← → to navigate · click to fullscreen</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {artifacts.map((a, i) => (
                <button key={a.path}
                  className="text-left bg-gray-900 border border-gray-700 rounded-xl overflow-hidden group hover:border-brand-600 transition-all hover:shadow-lg hover:shadow-brand-900/20 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  onClick={() => setLightboxIdx(i)}>
                  <div className="relative overflow-hidden bg-gray-950">
                    <img src={a.url} alt={a.label}
                      className="w-full object-contain max-h-48 transition-transform duration-300 group-hover:scale-[1.03]"
                      onError={e => {
                        const el = e.target as HTMLImageElement
                        el.style.display = 'none'
                        el.parentElement!.innerHTML = '<div class="flex items-center justify-center h-32 text-gray-600 text-xs gap-2"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Image unavailable</div>'
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded-lg p-1.5">
                      <ZoomIn size={13} className="text-white" />
                    </div>
                  </div>
                  <div className="px-3 py-2.5 border-t border-gray-800">
                    <p className="text-xs font-semibold text-gray-200 truncate">{a.label}</p>
                    <p className="text-[10px] text-gray-600 font-mono mt-0.5 truncate">{a.path}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
