import type { TrainerSubmission } from '@/types/trainerSubmission'
import { ShieldCheck, ShieldAlert, X } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  open: boolean
  onClose: () => void
  submission: TrainerSubmission | null
}

const SEVERITY_STYLE: Record<string, string> = {
  none:      'bg-emerald-900/30 text-emerald-400 border-emerald-800/40',
  low:       'bg-yellow-900/30 text-yellow-400 border-yellow-800/40',
  high:      'bg-orange-900/30 text-orange-400 border-orange-800/40',
  critical:  'bg-red-900/30 text-red-400 border-red-800/40',
  malicious: 'bg-red-950 text-red-300 border-red-700',
}

export default function TrainerAnomalyModal({ open, onClose, submission }: Props) {
  if (!open || !submission) return null

  const scan = submission.llm_scan_result || {}
  const severity = scan.severity || 'low'
  const isPassed = scan.passed === true
  const trainerName = submission.trainer_name || 'Unknown Trainer'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            {isPassed
              ? <ShieldCheck size={18} className="text-emerald-400" />
              : <ShieldAlert size={18} className="text-amber-400" />}
            <div>
              <div className="text-sm font-bold text-white">
                {isPassed ? 'Security Scan Passed' : 'Security Issue Detected'}
              </div>
              <div className="text-[11px] text-gray-500 font-mono">{trainerName}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Severity badge */}
          <div>
            <span className={clsx(
              'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border capitalize',
              SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low
            )}>
              Severity: {severity}
            </span>
          </div>

          {/* Summary */}
          {scan.summary && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-xs text-gray-400 leading-relaxed">
              {scan.summary}
            </div>
          )}

          {/* Issues */}
          {scan.issues && scan.issues.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Issues Found</div>
              <div className="border-l-2 border-red-800/50 pl-3 space-y-1">
                {scan.issues.map((issue, i) => (
                  <p key={i} className="text-xs text-red-400">• {typeof issue === 'string' ? issue : (issue.detail || issue.message)}</p>
                ))}
              </div>
            </div>
          )}

          {/* Status message */}
          <div className={clsx(
            'rounded-xl px-3 py-2.5 text-xs',
            isPassed
              ? 'bg-emerald-900/20 border border-emerald-800/40 text-emerald-400'
              : 'bg-amber-900/20 border border-amber-800/40 text-amber-400'
          )}>
            {isPassed
              ? 'Your trainer passed the automated security review and is now active.'
              : 'Your trainer has been submitted for admin review. You will be notified once it is approved or rejected.'}
          </div>

          {/* Model used */}
          {scan.model_used && (
            <p className="text-[10px] text-gray-600 text-right">Scanned by: {scan.model_used}</p>
          )}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-brand-600 hover:bg-brand-500 text-white rounded-xl transition-colors text-sm font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
