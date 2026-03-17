import { useState, useEffect } from 'react'
import type { ModelDeployment } from '@/types/trainer'
import type { InferenceResult } from '@/types/inference'
import InferencePanel from './InferencePanel'
import FeedbackPanel from './FeedbackPanel'
import MetricsPanel from './MetricsPanel'
import InferenceHistoryPanel from './InferenceHistoryPanel'
import JobsPanel from './JobsPanel'
import EvaluationPanel from './EvaluationPanel'
import TrainingResultsPanel from './TrainingResultsPanel'
import VersionComparePanel from './VersionComparePanel'
import IntegrationPanel from './IntegrationPanel'
import ApiDocsPanel from './ApiDocsPanel'
import { trainersApi } from '@/api/trainers'
import {
  Brain, FlaskConical, ThumbsUp, BarChart2, Clock, History,
  Cpu, ChevronRight, Target, TrendingUp, GitCompare, ChevronDown,
  CheckCircle2, Code2, BookOpen,
} from 'lucide-react'
import clsx from 'clsx'

const METRIC_PRIORITY = ['map50', 'map50-95', 'precision', 'recall', 'f1', 'accuracy']
function prioritisedMetrics(metrics: Record<string, number>): [string, number][] {
  const entries = Object.entries(metrics)
  const priority: [string, number][] = []
  const rest: [string, number][] = []
  for (const e of entries) {
    if (METRIC_PRIORITY.includes(e[0].toLowerCase())) priority.push(e)
    else rest.push(e)
  }
  return [...priority, ...rest].slice(0, 4)
}
const METRIC_LABELS: Record<string, string> = {
  map50: 'mAP@50', 'map50-95': 'mAP@50-95', precision: 'Precision',
  recall: 'Recall', f1: 'F1', accuracy: 'Accuracy',
}
function metricLabel(k: string) { return METRIC_LABELS[k.toLowerCase()] ?? k }

interface Props {
  deployment: ModelDeployment
  onClose: () => void
}

type Tab = 'inference' | 'results' | 'feedback' | 'metrics' | 'inferences' | 'jobs' | 'evaluation' | 'training' | 'compare' | 'integration' | 'api-docs'

export default function ModelWorkspace({ deployment, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('inference')
  const [lastResult, setLastResult] = useState<InferenceResult | null>(null)
  const [lastInputs, setLastInputs] = useState<unknown>(null)
  const [results, setResults] = useState<Array<{ result: InferenceResult; ts: string }>>([])
  const [feedbackRefresh, setFeedbackRefresh] = useState(0)
  const [schema, setSchema] = useState<Record<string, unknown>>({})
  const [outputSchema, setOutputSchema] = useState<Record<string, unknown>>({})

  // Version management
  const [versions, setVersions] = useState<ModelDeployment[]>([deployment])
  const [current, setCurrent] = useState<ModelDeployment>(deployment)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)

  useEffect(() => {
    trainersApi.getSchema(deployment.trainer_name).then(s => {
      setSchema(s.input_schema ?? s)
      if (s.output_schema) setOutputSchema(s.output_schema)
    }).catch(() => {})
    if (!sessionStorage.getItem('ml_session_id')) {
      sessionStorage.setItem('ml_session_id', Math.random().toString(36).slice(2))
    }
    // Load all versions for this trainer
    setLoadingVersions(true)
    trainersApi.listVersions(deployment.trainer_name)
      .then(v => {
        if (v.length > 0) setVersions(v)
      })
      .catch(() => {})
      .finally(() => setLoadingVersions(false))
  }, [deployment.trainer_name])

  // When deployment prop changes (e.g. parent re-selects), reset
  useEffect(() => {
    setCurrent(deployment)
  }, [deployment.id])

  const handleResult = (result: InferenceResult, inputs?: unknown) => {
    setLastResult(result)
    setLastInputs(inputs ?? null)
    setResults(prev => [{ result, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 50))
    setTab('results')
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'inference', label: 'Inference', icon: <Brain size={14} /> },
    { id: 'results', label: `Results${results.length ? ` (${results.length})` : ''}`, icon: <FlaskConical size={14} /> },
    { id: 'feedback', label: 'Feedback', icon: <ThumbsUp size={14} /> },
    { id: 'metrics', label: 'Metrics', icon: <BarChart2 size={14} /> },
    { id: 'inferences', label: 'Inferences', icon: <History size={14} /> },
    { id: 'jobs', label: 'Jobs', icon: <Cpu size={14} /> },
    { id: 'evaluation', label: 'Evaluation', icon: <Target size={14} /> },
    { id: 'training', label: 'Training', icon: <TrendingUp size={14} /> },
    ...(versions.length > 1 ? [{ id: 'compare' as Tab, label: 'Compare', icon: <GitCompare size={14} /> }] : []),
    { id: 'integration' as Tab, label: 'Integration', icon: <Code2 size={14} /> },
    { id: 'api-docs' as Tab, label: 'API Docs', icon: <BookOpen size={14} /> },
  ]

  const sortedVersions = [...versions].sort((a, b) => {
    const av = parseInt(a.mlflow_model_version || '0', 10)
    const bv = parseInt(b.mlflow_model_version || '0', 10)
    return bv - av  // newest first
  })

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1">
          Models <ChevronRight size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-bold text-white truncate">{current.mlflow_model_name}</h2>

            {/* Version switcher */}
            <div className="relative">
              <button
                onClick={() => setVersionsOpen(v => !v)}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-300 transition-colors"
              >
                <span className="font-mono text-brand-400">v{current.mlflow_model_version}</span>
                {current.is_default && (
                  <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>
                )}
                {!loadingVersions && versions.length > 1 && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-500">{versions.length} versions</span>
                  </>
                )}
                <ChevronDown size={11} className={clsx('text-gray-500 transition-transform', versionsOpen && 'rotate-180')} />
              </button>

              {versionsOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl min-w-56 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800">
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest">Switch Version</p>
                  </div>
                  {sortedVersions.map(v => (
                    <button
                      key={v.id}
                      onClick={() => { setCurrent(v); setVersionsOpen(false); setResults([]); setLastResult(null) }}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-800 transition-colors text-left',
                        v.id === current.id && 'bg-gray-800/60'
                      )}
                    >
                      <span className="font-mono text-brand-400 w-8 text-xs">v{v.mlflow_model_version}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {v.is_default && (
                            <span className="text-[9px] text-emerald-500 uppercase tracking-widest">latest</span>
                          )}
                          <span className="text-[10px] text-gray-600 truncate">
                            {v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                        {Object.keys(v.metrics ?? {}).length > 0 && (
                          <div className="flex gap-2 mt-0.5">
                            {prioritisedMetrics(v.metrics).slice(0, 2).map(([k, val]) => (
                              <span key={k} className="text-[10px] text-gray-500">
                                {metricLabel(k)}: {val <= 1 ? `${(val * 100).toFixed(1)}%` : val.toFixed(3)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {v.id === current.id && <CheckCircle2 size={13} className="text-brand-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="text-[10px] uppercase tracking-widest text-gray-600">
              {current.source_type.replace('_', ' ')}
            </span>
          </div>
          {current.run_id && (
            <p className="text-xs text-gray-600 font-mono mt-0.5">run: {current.run_id.slice(0, 12)}…</p>
          )}
        </div>

        {/* Metric chips */}
        <div className="hidden md:flex items-center gap-4 flex-shrink-0">
          {prioritisedMetrics(current.metrics ?? {}).map(([k, v]) => (
            <div key={k} className="text-center">
              <div className="text-sm font-bold text-brand-400">
                {v <= 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)}
              </div>
              <div className="text-[10px] text-gray-600">{metricLabel(k)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-6 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              t.id === tab ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t.icon} {t.label}
            {t.id === 'compare' && versions.length > 1 && (
              <span className="ml-1 text-[10px] bg-brand-900/50 text-brand-500 px-1.5 py-0.5 rounded-full">
                {versions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Close version dropdown on outside click */}
      {versionsOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setVersionsOpen(false)} />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'inference' && (
          <InferencePanel
            deployment={{ ...current, input_schema: schema as typeof current.input_schema }}
            allDeployments={versions}
            onResult={(result, inputs) => handleResult(result, inputs)}
            onDeploymentChange={d => setCurrent(d)}
          />
        )}

        {tab === 'results' && (
          <div className="space-y-3">
            {results.length === 0 && (
              <div className="text-center py-16 text-gray-600 text-sm">No results yet — run an inference first.</div>
            )}
            {results.map((r, i) => (
              <div key={i} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Clock size={12} /> {r.ts}
                    <span className="text-gray-700">·</span>
                    <span className="font-mono text-brand-600">v{current.mlflow_model_version}</span>
                  </div>
                  {r.result.latency_ms != null && (
                    <span className="text-xs text-gray-600">{r.result.latency_ms.toFixed(0)}ms</span>
                  )}
                </div>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-auto max-h-64">
                  {JSON.stringify(r.result.result ?? r.result.prediction, null, 2)}
                </pre>
                {typeof r.result.result === 'object' && r.result.result !== null && (() => {
                  const res = r.result.result as Record<string, unknown>
                  const urls = [res.annotated_url, res.original_url].filter(Boolean) as string[]
                  if (!urls.length) return null
                  return (
                    <div className="mt-3 flex gap-3 flex-wrap">
                      {urls.map((url, ui) => (
                        <div key={ui}>
                          <p className="text-[10px] text-gray-600 mb-1">{ui === 0 ? 'Annotated' : 'Original'}</p>
                          <img src={url} alt="" className="max-h-48 rounded-lg border border-gray-700" />
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )}

        {tab === 'feedback' && (
          <FeedbackPanel
            deployment={current}
            allDeployments={versions}
            onSubmitted={() => setFeedbackRefresh(n => n + 1)}
          />
        )}

        {tab === 'metrics' && (
          <MetricsPanel trainerName={current.trainer_name} deployment={current} allDeployments={versions} refreshTrigger={feedbackRefresh} />
        )}

        {tab === 'inferences' && (
          <InferenceHistoryPanel deployment={current} allDeployments={versions} refreshTrigger={feedbackRefresh} />
        )}

        {tab === 'jobs' && (
          <JobsPanel trainerName={current.trainer_name} />
        )}

        {tab === 'evaluation' && (
          <EvaluationPanel deployment={current} allDeployments={versions} />
        )}

        {tab === 'training' && (
          <TrainingResultsPanel deployment={current} allDeployments={versions} />
        )}

        {tab === 'compare' && (
          <VersionComparePanel
            versions={versions}
            currentDeployment={current}
            lastInputs={lastInputs}
          />
        )}

        {tab === 'integration' && (
          <IntegrationPanel
            deployment={current}
            inputSchema={schema}
            outputSchema={outputSchema}
          />
        )}

        {tab === 'api-docs' && (
          <ApiDocsPanel deployment={current} />
        )}
      </div>
    </div>
  )
}
