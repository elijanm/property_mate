import { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert, ShieldCheck, Clock, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, XCircle, FileCode, Play,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'
import { trainerSubmissionsApi } from '@/api/trainerSubmissions'
import type { TrainerSubmission } from '@/types/trainerSubmission'

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TrainerSubmission['status'],
  { label: string; icon: React.ElementType; color: string; bg: string; desc: string }
> = {
  scanning: {
    label: 'Scanning',
    icon: Loader2,
    color: 'text-blue-400',
    bg: 'bg-blue-900/30 border-blue-800/40',
    desc: 'Security scan in progress…',
  },
  pending_admin: {
    label: 'Pending Review',
    icon: Clock,
    color: 'text-amber-400',
    bg: 'bg-amber-900/20 border-amber-800/40',
    desc: 'Awaiting admin review. You will be notified by email.',
  },
  flagged: {
    label: 'Flagged',
    icon: ShieldAlert,
    color: 'text-red-400',
    bg: 'bg-red-900/20 border-red-800/40',
    desc: 'Security issues detected. Awaiting admin decision.',
  },
  approved: {
    label: 'Approved',
    icon: ShieldCheck,
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/20 border-emerald-800/40',
    desc: 'Approved and active. You can run this trainer.',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    color: 'text-gray-400',
    bg: 'bg-gray-800/60 border-gray-700/40',
    desc: 'Submission rejected. See reason below and resubmit.',
  },
}

function StatusBadge({ status }: { status: TrainerSubmission['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending_admin
  const Icon = cfg.icon
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', cfg.bg, cfg.color)}>
      <Icon size={11} className={status === 'scanning' ? 'animate-spin' : undefined} />
      {cfg.label}
    </span>
  )
}

// ── Submission card ────────────────────────────────────────────────────────────

function SubmissionCard({ sub, onRun }: { sub: TrainerSubmission; onRun: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.pending_admin
  const scan = sub.llm_scan_result ?? {}
  const canRun = sub.status === 'approved'

  return (
    <div className={clsx('border rounded-xl overflow-hidden transition-all', cfg.bg)}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', cfg.bg)}>
          {(() => { const Icon = cfg.icon; return <Icon size={16} className={clsx(cfg.color, sub.status === 'scanning' && 'animate-spin')} /> })()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-white truncate">{sub.trainer_name}.py</span>
            <StatusBadge status={sub.status} />
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Clock size={10} /> {new Date(sub.submitted_at).toLocaleString()}
            {sub.reviewed_by && (
              <span className="text-gray-600">· reviewed by {sub.reviewed_by}</span>
            )}
          </p>
          <p className="text-xs text-gray-500 mt-1">{cfg.desc}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {canRun && (
            <button
              onClick={() => onRun(sub.trainer_name)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-900/50 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-800/60 rounded-lg transition-colors"
            >
              <Play size={11} /> Run
            </button>
          )}
          {(scan.summary || sub.rejection_reason) && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 bg-black/20 space-y-3">
          {sub.rejection_reason && (
            <div className="flex items-start gap-2.5 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-300 mb-1">Rejection Reason</p>
                <p className="text-xs text-red-200 leading-relaxed">{sub.rejection_reason}</p>
              </div>
            </div>
          )}

          {scan.summary && (
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Scan Summary</p>
              <p className="text-xs text-gray-400 leading-relaxed">{scan.summary}</p>
            </div>
          )}

          {(scan.issues ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Issues Found</p>
              <ul className="space-y-1.5">
                {(scan.issues ?? []).map((issue, i) => {
                  const isStr = typeof issue === 'string'
                  const isBlock = !isStr && issue.block
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <AlertTriangle size={11} className={`flex-shrink-0 mt-0.5 ${isBlock ? 'text-red-400' : 'text-amber-500'}`} />
                      <span>
                        {isBlock && <span className="text-red-400 mr-1">[BLOCK]</span>}
                        {isStr ? issue : (issue.detail || issue.message)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {sub.parsed_metadata && Object.keys(sub.parsed_metadata).length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(sub.parsed_metadata).map(([k, v]) => (
                <span key={k} className="text-[11px] text-gray-600">
                  <span className="text-gray-500">{k}:</span> {v}
                </span>
              ))}
            </div>
          )}

          <p className="text-[10px] text-gray-700 font-mono">id: {sub.id}</p>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MySubmissionsPage() {
  const [submissions, setSubmissions] = useState<TrainerSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await trainerSubmissionsApi.list()
      setSubmissions(res.items)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh while any submission is scanning
  useEffect(() => {
    const scanning = submissions.some(s => s.status === 'scanning')
    if (!scanning) return
    const t = setTimeout(load, 4000)
    return () => clearTimeout(t)
  }, [submissions, load])

  const handleRun = (trainerName: string) => {
    // Navigate to code editor with this trainer selected
    window.location.href = `/editor?trainer=${encodeURIComponent(trainerName)}`
  }

  const pending = submissions.filter(s => s.status === 'pending_admin' || s.status === 'flagged' || s.status === 'scanning').length
  const approved = submissions.filter(s => s.status === 'approved').length
  const rejected = submissions.filter(s => s.status === 'rejected').length

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileCode size={20} className="text-brand-400" />
          <div>
            <h1 className="text-lg font-bold text-white">My Trainer Submissions</h1>
            <p className="text-xs text-gray-600">Track approval status of your uploaded trainers</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
        >
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Stats */}
      {submissions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Pending',  value: pending,  color: 'text-amber-400',   bg: 'bg-amber-900/20 border-amber-800/40' },
            { label: 'Approved', value: approved, color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-800/40' },
            { label: 'Rejected', value: rejected, color: 'text-gray-400',    bg: 'bg-gray-800/60 border-gray-700/40' },
          ].map(s => (
            <div key={s.label} className={clsx('border rounded-xl p-4', s.bg)}>
              <div className={clsx('text-2xl font-bold', s.color)}>{s.value}</div>
              <div className="text-xs text-gray-600 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-gray-600" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-20 space-y-3">
          <FileCode size={32} className="text-gray-700 mx-auto" />
          <p className="text-sm text-gray-500">No trainer submissions yet.</p>
          <p className="text-xs text-gray-600">Upload a <code className="text-gray-400">.py</code> trainer from the code editor to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Approved notice */}
          {approved > 0 && (
            <div className="flex items-center gap-2.5 bg-emerald-900/20 border border-emerald-800/40 rounded-xl px-4 py-3">
              <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-300">
                {approved} trainer{approved > 1 ? 's are' : ' is'} approved and ready to run.
              </p>
            </div>
          )}

          {submissions.map(sub => (
            <SubmissionCard key={sub.id} sub={sub} onRun={handleRun} />
          ))}
        </div>
      )}
    </div>
  )
}
