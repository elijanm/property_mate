import { useEffect, useState } from 'react'
import { feedbackApi, type FeedbackPayload } from '@/api/feedback'
import { inferenceApi } from '@/api/inference'
import type { ModelDeployment } from '@/types/trainer'
import type { InferenceLogSummary, OutputFieldSpec } from '@/types/inference'
import InferenceResultRenderer from './InferenceResultRenderer'
import { ThumbsUp, ThumbsDown, Send, Loader2, ChevronDown, Clock, GitBranch } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
  onSubmitted: () => void
}

export default function FeedbackPanel({ deployment, allDeployments, onSubmitted }: Props) {
  // ── Version selector ───────────────────────────────────────────────────────
  const sortedDeploys = allDeployments
    ? [...allDeployments].sort((a, b) => parseInt(b.mlflow_model_version || '0') - parseInt(a.mlflow_model_version || '0'))
    : null
  const [selectedDeployId, setSelectedDeployId] = useState<string>(deployment.id)
  const selectedDeploy = sortedDeploys?.find(d => d.id === selectedDeployId) ?? deployment

  // ── Recent inferences ─────────────────────────────────────────────────────
  const [logs, setLogs] = useState<InferenceLogSummary[]>([])
  const [displaySpec, setDisplaySpec] = useState<OutputFieldSpec[]>([])
  const [selected, setSelected] = useState<InferenceLogSummary | null>(null)
  const [loadingLogs, setLoadingLogs] = useState(true)

  // ── Feedback form ─────────────────────────────────────────────────────────
  const [predictedLabel, setPredictedLabel] = useState('')
  const [actualLabel, setActualLabel] = useState('')
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoadingLogs(true)
      setSelected(null)
      // Only pass deploymentId filter when a non-default version was explicitly selected,
      // so we don't miss logs served by a different active deployment record.
      const deployIdFilter = selectedDeployId !== deployment.id ? selectedDeployId : undefined
      try {
        const [recentLogs, schema] = await Promise.all([
          inferenceApi.recentLogs(deployment.trainer_name, 20, deployIdFilter),
          inferenceApi.getSchema(deployment.trainer_name).catch(() => null),
        ])
        setLogs(recentLogs)
        setDisplaySpec(schema?.output_display ?? [])
        if (recentLogs.length > 0) selectLog(recentLogs[0], schema?.output_display ?? [])
      } catch {}
      finally { setLoadingLogs(false) }
    }
    load()
  }, [deployment.trainer_name, selectedDeployId, deployment.id])

  function selectLog(log: InferenceLogSummary, spec?: OutputFieldSpec[]) {
    setSelected(log)
    setPredictedLabel(log.predicted_label_hint ?? '')
    setActualLabel('')
    setIsCorrect(null)
    setNotes('')
    if (spec) setDisplaySpec(spec)
  }

  function handleCorrect() {
    setIsCorrect(true)
    setActualLabel(predictedLabel)  // confirmed → actual == predicted
  }

  function handleIncorrect() {
    setIsCorrect(false)
    setActualLabel('')
  }

  const primaryHint = displaySpec.find(s => s.primary)?.hint || 'Enter the correct value'

  const canSubmit = selected !== null && isCorrect !== null &&
    (isCorrect === true || actualLabel.trim().length > 0)

  const handleSubmit = async () => {
    if (!selected) return
    setLoading(true)
    try {
      // Use deployment_id from the log itself — most accurate for A/B routing
      const effectiveDeployId = selected.deployment_id ?? selectedDeploy.id
      const effectiveDeploy = sortedDeploys?.find(d => d.id === effectiveDeployId) ?? selectedDeploy
      const payload: FeedbackPayload = {
        trainer_name: deployment.trainer_name,
        deployment_id: effectiveDeployId,
        run_id: effectiveDeploy.run_id ?? undefined,
        inference_log_id: selected.id,
        model_output: selected.outputs,
        predicted_label: predictedLabel || undefined,
        actual_label: actualLabel || undefined,
        is_correct: isCorrect ?? undefined,
        notes: notes || undefined,
        session_id: sessionStorage.getItem('ml_session_id') ?? undefined,
      }
      await feedbackApi.submit(payload)
      setDone(true)
      onSubmitted()
      setTimeout(() => {
        setDone(false)
        // Advance to next unreviewed log
        const nextIdx = logs.findIndex(l => l.id === selected.id) + 1
        if (nextIdx < logs.length) selectLog(logs[nextIdx])
        else { setSelected(null); setPredictedLabel(''); setIsCorrect(null) }
      }, 1500)
    } catch (err) {
      console.error(err)
    } finally { setLoading(false) }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-emerald-400">
        <ThumbsUp size={32} className="mb-3" />
        <p className="font-semibold">Feedback recorded</p>
        <p className="text-xs text-gray-500 mt-1">Loading next inference…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Version picker ─────────────────────────────────────────────────── */}
      {sortedDeploys && sortedDeploys.length > 1 && (
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-gray-500 shrink-0" />
          <span className="text-xs text-gray-500 shrink-0">Version:</span>
          <div className="relative flex-1">
            <select
              value={selectedDeployId}
              onChange={e => setSelectedDeployId(e.target.value)}
              className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 pr-7 text-xs text-gray-200 focus:outline-none focus:border-brand-500"
            >
              {sortedDeploys.map(d => (
                <option key={d.id} value={d.id}>
                  v{d.mlflow_model_version}{d.is_default ? ' ★ default' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
          <span className="text-[10px] text-gray-600 shrink-0">showing logs for this version</span>
        </div>
      )}

      {/* ── Inference selector ─────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Select Inference</label>
        {loadingLogs ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
            <Loader2 size={13} className="animate-spin" /> Loading recent inferences…
          </div>
        ) : logs.length === 0 ? (
          <p className="text-xs text-gray-600 py-2">No inference logs yet — run a prediction first.</p>
        ) : (
          <div className="relative">
            <select
              value={selected?.id ?? ''}
              onChange={e => {
                const log = logs.find(l => l.id === e.target.value)
                if (log) selectLog(log)
              }}
              className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 pr-9 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            >
              {logs.map(log => (
                <option key={log.id} value={log.id}>
                  {timeAgo(log.created_at)}
                  {log.ab_test_variant ? ` [A/B:${log.ab_test_variant.toUpperCase()}]` : ''}
                  {log.predicted_label_hint ? ` — ${truncate(log.predicted_label_hint, 40)}` : ''}
                  {log.latency_ms ? ` · ${Math.round(log.latency_ms)}ms` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
        )}
      </div>

      {/* ── Inference result display ───────────────────────────────────────── */}
      {selected?.outputs && (
        <div className="bg-gray-950 rounded-2xl border border-gray-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={11} className="text-gray-600" />
            <span className="text-[10px] text-gray-500">{timeAgo(selected.created_at)}</span>
          </div>
          <InferenceResultRenderer
            outputs={selected.outputs as Record<string, unknown>}
            displaySpec={displaySpec}
          />
        </div>
      )}

      {/* ── Predicted label (auto-filled, editable) ───────────────────────── */}
      {selected && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Predicted <span className="text-gray-600">(auto-filled · edit if wrong)</span>
            </label>
            <input
              value={predictedLabel}
              onChange={e => setPredictedLabel(e.target.value)}
              placeholder="what the model returned"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* ── Approve / Reject ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs text-gray-400 mb-2">Was this correct?</p>
            <div className="flex gap-3">
              <button
                onClick={handleCorrect}
                className={clsx(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-semibold transition-colors',
                  isCorrect === true
                    ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-emerald-700 hover:text-emerald-400',
                )}
              >
                <ThumbsUp size={14} /> Correct
              </button>
              <button
                onClick={handleIncorrect}
                className={clsx(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-semibold transition-colors',
                  isCorrect === false
                    ? 'bg-red-950/60 border-red-700 text-red-300'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400',
                )}
              >
                <ThumbsDown size={14} /> Incorrect
              </button>
            </div>
          </div>

          {/* ── Actual value (only shown on Incorrect) ────────────────────── */}
          {isCorrect === false && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Correct value <span className="text-gray-600">(ground truth)</span>
              </label>
              <input
                value={actualLabel}
                onChange={e => setActualLabel(e.target.value)}
                placeholder={primaryHint}
                autoFocus
                className="w-full bg-gray-900 border border-red-800/60 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-red-500"
              />
            </div>
          )}

          {/* ── Notes (optional, collapsed) ───────────────────────────────── */}
          <details>
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none">
              Add notes (optional)
            </summary>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any observations about this prediction…"
              className="mt-2 w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500 resize-none"
            />
          </details>

          <button
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Submit Feedback
          </button>
        </>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
