import { useState, useEffect } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import { modelsApi } from '@/api/models'
import VersionDropdown from './VersionDropdown'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, Image as ImageIcon, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

interface MetricPoint { step: number; value: number; timestamp: number }
type MetricHistory = Record<string, MetricPoint[]>
interface Artifact { path: string; url: string; label: string }

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
}

// Metric display groups — order matters for chart colours
const METRIC_GROUPS: { keys: string[]; label: string; color: string }[] = [
  { keys: ['map50', 'metrics/mAP50(B)', 'mAP50'], label: 'mAP@50', color: '#6366f1' },
  { keys: ['map50-95', 'metrics/mAP50-95(B)', 'mAP50-95'], label: 'mAP@50-95', color: '#8b5cf6' },
  { keys: ['precision', 'metrics/precision(B)', 'train/precision'], label: 'Precision', color: '#22c55e' },
  { keys: ['recall', 'metrics/recall(B)', 'train/recall'], label: 'Recall', color: '#f59e0b' },
  { keys: ['box_loss', 'train/box_loss', 'val/box_loss'], label: 'Box Loss', color: '#ef4444' },
  { keys: ['cls_loss', 'train/cls_loss', 'val/cls_loss'], label: 'Cls Loss', color: '#f97316' },
  { keys: ['dfl_loss', 'train/dfl_loss', 'val/dfl_loss'], label: 'DFL Loss', color: '#ec4899' },
  { keys: ['loss', 'train_loss', 'training_loss'], label: 'Train Loss', color: '#ef4444' },
  { keys: ['val_loss', 'validation_loss', 'eval/loss'], label: 'Val Loss', color: '#f97316' },
  { keys: ['accuracy', 'train_accuracy', 'acc'], label: 'Accuracy', color: '#06b6d4' },
  { keys: ['val_accuracy', 'eval_accuracy', 'eval/accuracy'], label: 'Val Accuracy', color: '#14b8a6' },
  { keys: ['f1', 'f1_score'], label: 'F1', color: '#84cc16' },
]

// Normalise raw metric name → friendly group label + color
function resolveMetric(key: string): { label: string; color: string } | null {
  const lower = key.toLowerCase()
  for (const g of METRIC_GROUPS) {
    if (g.keys.some(k => k.toLowerCase() === lower)) return { label: g.label, color: g.color }
  }
  return null
}

// Build a single chart series from metric points
function toChartData(series: Record<string, MetricPoint[]>): { epoch: number; [k: string]: number }[] {
  const maxLen = Math.max(...Object.values(series).map(s => s.length), 0)
  const rows: { epoch: number; [k: string]: number }[] = []
  for (let i = 0; i < maxLen; i++) {
    const row: { epoch: number; [k: string]: number } = { epoch: i + 1 }
    for (const [key, pts] of Object.entries(series)) {
      if (pts[i] !== undefined) row[key] = Number(pts[i].value.toFixed(5))
    }
    rows.push(row)
  }
  return rows
}

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#ec4899',
  '#06b6d4', '#84cc16', '#8b5cf6', '#f97316', '#14b8a6',
]

export default function TrainingResultsPanel({ deployment, allDeployments }: Props) {
  const [selectedDeploy, setSelectedDeploy] = useState<ModelDeployment>(deployment)
  const [metrics, setMetrics] = useState<MetricHistory>({})
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedImg, setExpandedImg] = useState<string | null>(null)
  const [showAllGraphs, setShowAllGraphs] = useState(false)

  useEffect(() => {
    if (!selectedDeploy.id) return
    setLoading(true)
    setError('')
    Promise.all([
      modelsApi.getMetricHistory(selectedDeploy.id).catch(() => ({ metrics: {} })),
      modelsApi.getTrainingArtifacts(selectedDeploy.id).catch(() => ({ artifacts: [] })),
    ]).then(([mh, af]) => {
      setMetrics(mh.metrics)
      setArtifacts(af.artifacts)
    }).catch(e => setError(e?.message ?? 'Failed to load training results'))
      .finally(() => setLoading(false))
  }, [selectedDeploy.id])

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
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-brand-500" />
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

  const hasMetrics = Object.keys(metrics).length > 0
  const hasArtifacts = artifacts.length > 0
  const empty = !hasMetrics && !hasArtifacts

  // Summary header metrics (mAP50, Precision, Recall from deployment.metrics)
  const KEY_METRICS: [string, string][] = [
    ['map50', 'mAP@50'],
    ['map50-95', 'mAP@50-95'],
    ['precision', 'Precision'],
    ['recall', 'Recall'],
    ['f1', 'F1'],
  ]
  const summaryMetrics = KEY_METRICS
    .map(([k, label]) => {
      const v = deployment.metrics?.[k]
      if (v == null) return null
      return { label, value: v }
    })
    .filter(Boolean) as { label: string; value: number }[]

  // Group metric series into logical charts
  // Each chart: all loss metrics together, all accuracy/map metrics together, rest individually
  const lossKeys = Object.keys(metrics).filter(k => k.toLowerCase().includes('loss'))
  const mapKeys = Object.keys(metrics).filter(k =>
    k.toLowerCase().includes('map') || k.toLowerCase().includes('precision') ||
    k.toLowerCase().includes('recall') || k.toLowerCase().includes('accuracy') ||
    k.toLowerCase().includes('f1')
  )
  const otherKeys = Object.keys(metrics).filter(k => !lossKeys.includes(k) && !mapKeys.includes(k))

  const chartGroups: { title: string; keys: string[] }[] = []
  if (mapKeys.length) chartGroups.push({ title: 'mAP / Precision / Recall / Accuracy', keys: mapKeys })
  if (lossKeys.length) chartGroups.push({ title: 'Loss Curves', keys: lossKeys })
  if (otherKeys.length) chartGroups.push({ title: 'Other Metrics', keys: otherKeys })

  const visibleGroups = showAllGraphs ? chartGroups : chartGroups.slice(0, 2)

  return (
    <div className="space-y-8">
      {allDeployments && (
        <VersionDropdown
          deployments={allDeployments}
          selected={selectedDeploy}
          onChange={d => { setSelectedDeploy(d); setMetrics({}); setArtifacts([]) }}
          label="Training run:"
        />
      )}
      {/* Summary metric pills */}
      {summaryMetrics.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {summaryMetrics.map(m => (
            <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 text-center">
              <div className="text-xl font-bold text-brand-400">
                {m.value <= 1 ? `${(m.value * 100).toFixed(1)}%` : m.value.toFixed(3)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{m.label}</div>
            </div>
          ))}
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 text-center">
            <div className="text-xl font-bold text-gray-400 font-mono">{deployment.run_id?.slice(0, 8)}…</div>
            <div className="text-xs text-gray-500 mt-0.5">MLflow Run</div>
          </div>
        </div>
      )}

      {empty && (
        <div className="text-center py-16 text-gray-600 text-sm">
          <TrendingUp size={28} className="mx-auto mb-3 opacity-30" />
          <p>No training graphs or artifacts found for this run.</p>
          <p className="text-xs mt-1 text-gray-700">Run ID: {deployment.run_id}</p>
        </div>
      )}

      {/* Training graphs */}
      {hasMetrics && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-brand-500" />
            Training Graphs
          </h3>
          <div className="space-y-6">
            {visibleGroups.map(group => {
              const chartData = toChartData(
                Object.fromEntries(group.keys.map(k => [k, metrics[k]]))
              )
              return (
                <div key={group.title} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <h4 className="text-xs font-medium text-gray-400 mb-4">{group.title}</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        dataKey="epoch"
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        label={{ value: 'Epoch', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#6b7280' }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={48} />
                      <Tooltip
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#9ca3af' }}
                        itemStyle={{ color: '#e5e7eb' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                      {group.keys.map((key, ci) => {
                        const resolved = resolveMetric(key)
                        return (
                          <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={resolved?.label ?? key}
                            stroke={resolved?.color ?? CHART_COLORS[ci % CHART_COLORS.length]}
                            dot={false}
                            strokeWidth={1.5}
                            activeDot={{ r: 3 }}
                          />
                        )
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            })}

            {chartGroups.length > 2 && (
              <button
                onClick={() => setShowAllGraphs(v => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showAllGraphs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showAllGraphs ? 'Show less' : `Show ${chartGroups.length - 2} more chart${chartGroups.length - 2 > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Artifacts — confusion matrices + training plots */}
      {hasArtifacts && (
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <ImageIcon size={14} className="text-brand-500" />
            Training Artifacts
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {artifacts.map(a => (
              <div
                key={a.path}
                className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden group cursor-pointer hover:border-brand-700 transition-colors"
                onClick={() => setExpandedImg(expandedImg === a.url ? null : a.url)}
              >
                <div className="relative">
                  <img
                    src={a.url}
                    alt={a.label}
                    className="w-full object-contain max-h-52 bg-gray-950"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-xs text-white bg-black/60 px-3 py-1 rounded-full">
                      {expandedImg === a.url ? 'Collapse' : 'Expand'}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-2 border-t border-gray-800">
                  <p className="text-xs font-medium text-gray-300">{a.label}</p>
                  <p className="text-[10px] text-gray-600 font-mono mt-0.5 truncate">{a.path}</p>
                </div>
                {expandedImg === a.url && (
                  <div className="px-3 pb-3">
                    <img src={a.url} alt={a.label} className="w-full rounded-lg border border-gray-700" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
