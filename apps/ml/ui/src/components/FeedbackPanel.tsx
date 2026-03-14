import { useState } from 'react'
import { feedbackApi, type FeedbackPayload } from '@/api/feedback'
import type { ModelDeployment } from '@/types/trainer'
import type { InferenceResult } from '@/types/inference'
import { ThumbsUp, ThumbsDown, Send, Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  deployment: ModelDeployment
  lastResult: InferenceResult | null
  onSubmitted: () => void
}

export default function FeedbackPanel({ deployment, lastResult, onSubmitted }: Props) {
  const [predictedLabel, setPredictedLabel] = useState('')
  const [actualLabel, setActualLabel] = useState('')
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [confidence, setConfidence] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const payload: FeedbackPayload = {
        trainer_name: deployment.trainer_name,
        deployment_id: deployment.id,
        run_id: deployment.run_id ?? undefined,
        model_output: lastResult?.result,
        predicted_label: predictedLabel || undefined,
        actual_label: actualLabel || undefined,
        is_correct: isCorrect ?? undefined,
        confidence_reported: confidence ? Number(confidence) : undefined,
        notes: notes || undefined,
        session_id: sessionStorage.getItem('ml_session_id') ?? undefined,
      }
      await feedbackApi.submit(payload)
      setDone(true)
      onSubmitted()
      setTimeout(() => {
        setDone(false)
        setPredictedLabel(''); setActualLabel('')
        setIsCorrect(null); setConfidence(''); setNotes('')
      }, 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-emerald-400">
        <ThumbsUp size={32} className="mb-3" />
        <p className="font-semibold">Feedback submitted!</p>
        <p className="text-xs text-gray-500 mt-1">Thank you — this improves the confusion matrix.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {lastResult && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <p className="text-xs text-gray-500 mb-1">Last prediction</p>
          <pre className="text-xs text-gray-300 overflow-auto max-h-32 font-mono whitespace-pre-wrap">
            {JSON.stringify(lastResult.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Quick thumbs */}
      <div>
        <p className="text-xs text-gray-400 mb-2">Was this prediction correct?</p>
        <div className="flex gap-3">
          <button onClick={() => setIsCorrect(true)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors', isCorrect === true
              ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
            )}
          >
            <ThumbsUp size={14} /> Correct
          </button>
          <button onClick={() => setIsCorrect(false)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors', isCorrect === false
              ? 'bg-red-950/50 border-red-700 text-red-300'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
            )}
          >
            <ThumbsDown size={14} /> Incorrect
          </button>
        </div>
      </div>

      {/* Labels */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Predicted Label</label>
          <input value={predictedLabel} onChange={e => setPredictedLabel(e.target.value)}
            placeholder="what model said"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Actual Label <span className="text-gray-600">(ground truth)</span></label>
          <input value={actualLabel} onChange={e => setActualLabel(e.target.value)}
            placeholder="correct answer"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Confidence */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Your Confidence in This Label (0–1)</label>
        <input type="number" min="0" max="1" step="0.01"
          value={confidence} onChange={e => setConfidence(e.target.value)}
          placeholder="0.95"
          className="w-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          rows={2} placeholder="Optional notes about this prediction…"
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500 resize-none"
        />
      </div>

      <button onClick={handleSubmit} disabled={loading || (isCorrect === null && !actualLabel)}
        className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        Submit Feedback
      </button>
    </div>
  )
}
