import { useEffect, useState } from 'react'
import { feedbackApi } from '@/api/feedback'
import type { ConfusionMatrix as CM, AccuracyTrend, FeedbackSummary } from '@/types/feedback'
import type { ModelDeployment } from '@/types/trainer'
import ConfusionMatrixView from './ConfusionMatrix'
import VersionDropdown from './VersionDropdown'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { RefreshCw } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  trainerName: string
  refreshTrigger: number
  deployment?: ModelDeployment
  allDeployments?: ModelDeployment[]
}

export default function MetricsPanel({ trainerName, refreshTrigger, deployment, allDeployments }: Props) {
  const [selectedDeploy, setSelectedDeploy] = useState<ModelDeployment | undefined>(deployment)
  const deploymentId = selectedDeploy?.id

  const [cm, setCm] = useState<CM | null>(null)
  const [trend, setTrend] = useState<AccuracyTrend[]>([])
  const [summary, setSummary] = useState<FeedbackSummary | null>(null)
  const [bucket, setBucket] = useState<'day' | 'hour'>('day')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [cmData, trendData, summaryData] = await Promise.all([
        feedbackApi.confusionMatrix(trainerName, deploymentId),
        feedbackApi.accuracyTrend(trainerName, bucket, deploymentId),
        feedbackApi.summary(trainerName, deploymentId),
      ])
      setCm(cmData)
      setTrend(trendData)
      setSummary(summaryData)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [trainerName, bucket, refreshTrigger, deploymentId])

  return (
    <div className="space-y-8">
      {allDeployments && selectedDeploy && (
        <VersionDropdown
          deployments={allDeployments}
          selected={selectedDeploy}
          onChange={d => setSelectedDeploy(d)}
          label="Metrics for version:"
        />
      )}
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Total Feedback" value={summary.total_feedback} />
          <SummaryCard label="Correct" value={summary.correct} color="emerald" />
          <SummaryCard label="Incorrect" value={summary.incorrect} color="red" />
          <SummaryCard label="Accuracy"
            value={summary.accuracy != null ? `${(summary.accuracy * 100).toFixed(1)}%` : '—'}
            color="brand"
          />
        </div>
      )}

      {/* Accuracy trend */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200">Accuracy Over Time</h3>
          <div className="flex gap-1">
            {(['day', 'hour'] as const).map(b => (
              <button key={b} onClick={() => setBucket(b)}
                className={clsx('px-2 py-1 text-xs rounded-md', b === bucket ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}
              >{b}</button>
            ))}
          </div>
        </div>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
              <YAxis domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Accuracy']}
              />
              <Line type="monotone" dataKey="accuracy" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center py-8 text-gray-600 text-sm">No data yet</p>
        )}
      </div>

      {/* Confusion matrix */}
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200">Confusion Matrix</h3>
          <button onClick={load} disabled={loading}
            className="text-gray-500 hover:text-gray-300 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {cm ? <ConfusionMatrixView data={cm} /> : <p className="text-center py-8 text-gray-600 text-sm">Loading…</p>}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color = 'gray' }: { label: string; value: string | number; color?: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    brand: 'text-brand-500',
    gray: 'text-gray-200',
  }
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
