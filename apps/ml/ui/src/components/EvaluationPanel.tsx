import { useState } from 'react'
import { evaluationApi } from '@/api/evaluation'
import type { ModelDeployment } from '@/types/trainer'
import VersionDropdown from './VersionDropdown'
import { Play, Loader2, AlertCircle } from 'lucide-react'

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
}

export default function EvaluationPanel({ deployment, allDeployments }: Props) {
  const [selectedDeploy, setSelectedDeploy] = useState<ModelDeployment>(deployment)
  const [inputsJson, setInputsJson] = useState('[]')
  const [labelsJson, setLabelsJson] = useState('[]')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      const inputs = JSON.parse(inputsJson)
      const labels = JSON.parse(labelsJson)
      const res = await evaluationApi.evaluate(selectedDeploy.trainer_name, inputs, labels)
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-5">
      {allDeployments && (
        <VersionDropdown
          deployments={allDeployments}
          selected={selectedDeploy}
          onChange={d => { setSelectedDeploy(d); setResult(null) }}
          label="Evaluate version:"
        />
      )}
      <p className="text-xs text-gray-500">Provide test inputs and ground-truth labels. The model runs predictions and computes metrics (accuracy, F1, confusion matrix).</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Test Inputs (JSON array)</label>
          <textarea value={inputsJson} onChange={e => setInputsJson(e.target.value)} rows={8}
            placeholder={'[\n  {"image_b64": "..."},\n  {"image_b64": "..."}\n]'}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Ground Truth Labels (JSON array)</label>
          <textarea value={labelsJson} onChange={e => setLabelsJson(e.target.value)} rows={8}
            placeholder={'[\n  "04823",\n  "12345"\n]'}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none" />
        </div>
      </div>

      <button onClick={run} disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 rounded-xl text-sm font-semibold text-white transition-colors">
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {loading ? 'Evaluating…' : 'Run Evaluation'}
      </button>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-3 flex items-start gap-2 text-sm text-red-400">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(result).filter(([k]) => k !== 'confusion_matrix_png' && k !== 'per_class').map(([k, v]) => (
              <div key={k} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                <div className="text-lg font-bold text-brand-400">
                  {typeof v === 'number' ? (v <= 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)) : String(v as string)}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">{k}</div>
              </div>
            ))}
          </div>

          {/* Confusion matrix PNG */}
          {!!result.confusion_matrix_png && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Confusion Matrix</p>
              <img src={`data:image/png;base64,${result.confusion_matrix_png as string}`}
                alt="Confusion Matrix" className="max-w-md rounded-xl border border-gray-800" />
            </div>
          )}

          {/* Per-class metrics */}
          {!!result.per_class && typeof result.per_class === 'object' && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Per-Class Metrics</p>
              <pre className="bg-gray-900 rounded-xl p-4 text-xs font-mono text-gray-300 overflow-auto max-h-48">
                {JSON.stringify(result.per_class, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
