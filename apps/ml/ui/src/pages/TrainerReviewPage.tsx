import { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert, ShieldCheck, RefreshCw, CheckCircle2,
  XCircle, ChevronDown, ChevronUp, Loader2, FileCode, Clock,
  AlertTriangle, Eye, X, Copy, Check,
} from 'lucide-react'
import clsx from 'clsx'
import { trainerSubmissionsApi } from '@/api/trainerSubmissions'
import type { TrainerSubmission, AdminTicket } from '@/types/trainerSubmission'

// ── Source + Analysis slide-over ──────────────────────────────────────────────

function ReviewSlideOver({
  sub,
  onClose,
  onApprove,
  onReject,
  approving,
}: {
  sub: TrainerSubmission
  onClose: () => void
  onApprove: (id: string) => void
  onReject:  (id: string) => void
  approving: string | null
}) {
  const [source, setSource] = useState<string | null>(null)
  const [astViolations, setAstViolations] = useState<{ line: number; rule: string; message: string }[]>([])
  const [loadingSource, setLoadingSource] = useState(true)
  const [copied, setCopied] = useState(false)
  const [codeTab, setCodeTab] = useState<'analysis' | 'code'>('analysis')
  const scan = sub.llm_scan_result ?? {}
  const isPending = sub.status === 'pending_admin' || sub.status === 'flagged'

  useEffect(() => {
    setLoadingSource(true)
    trainerSubmissionsApi.getSource(sub.id)
      .then(r => {
        setSource(r.source)
        setAstViolations(r.ast_violations ?? [])
      })
      .catch(() => setSource(null))
      .finally(() => setLoadingSource(false))
  }, [sub.id])

  const flaggedLines = new Set(astViolations.map(v => v.line))

  const copySource = () => {
    if (!source) return
    navigator.clipboard.writeText(source)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="w-[680px] max-w-full bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <ShieldAlert size={16} className={sub.status === 'flagged' ? 'text-red-400' : 'text-amber-400'} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{sub.trainer_name}.py</h2>
            <p className="text-[11px] text-gray-500">{sub.owner_email} · {new Date(sub.submitted_at).toLocaleString()}</p>
          </div>
          {isPending && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onReject(sub.id)}
                disabled={approving === sub.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-900/40 border border-red-700/60 text-red-400 hover:bg-red-900/70 rounded-lg transition-colors disabled:opacity-40"
              >
                <XCircle size={12} /> Reject
              </button>
              <button
                onClick={() => onApprove(sub.id)}
                disabled={approving === sub.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-900/50 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-800/60 rounded-lg transition-colors disabled:opacity-40"
              >
                {approving === sub.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Approve
              </button>
            </div>
          )}
          <button onClick={onClose} className="p-1 text-gray-600 hover:text-gray-300 transition-colors ml-1">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0">
          {(['analysis', 'code'] as const).map(t => (
            <button
              key={t}
              onClick={() => setCodeTab(t)}
              className={clsx(
                'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
                codeTab === t
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              )}
            >
              {t === 'analysis' ? 'Security Analysis' : 'Source Code'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {codeTab === 'analysis' && (
            <div className="p-5 space-y-5">
              {/* Verdict */}
              <div className={clsx(
                'rounded-xl p-4 border',
                scan.passed
                  ? 'bg-emerald-900/20 border-emerald-800/40'
                  : 'bg-red-900/20 border-red-800/40'
              )}>
                <div className="flex items-center gap-2 mb-1">
                  {scan.passed
                    ? <CheckCircle2 size={15} className="text-emerald-400" />
                    : <ShieldAlert size={15} className="text-red-400" />
                  }
                  <span className={clsx('text-sm font-bold', scan.passed ? 'text-emerald-300' : 'text-red-300')}>
                    {scan.passed ? 'Scan Passed' : 'Scan Failed'}
                  </span>
                  <span className={clsx(
                    'ml-auto px-2 py-0.5 rounded text-[10px] font-semibold uppercase',
                    scan.severity === 'critical' || scan.severity === 'malicious' ? 'bg-red-900/60 text-red-400' :
                    scan.severity === 'high' ? 'bg-orange-900/60 text-orange-400' :
                    scan.severity === 'low' ? 'bg-yellow-900/40 text-yellow-400' :
                    'bg-gray-800 text-gray-400'
                  )}>
                    {scan.severity ?? 'unknown'}
                  </span>
                </div>
                {scan.summary && (
                  <p className="text-sm text-gray-300 leading-relaxed">{scan.summary}</p>
                )}
                <p className="text-[10px] text-gray-600 mt-2">Scanned by: {scan.model_used ?? sub.llm_model_used ?? 'unknown'}</p>
              </div>

              {/* Issues */}
              {(scan.issues ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">Issues Detected</p>
                  <ul className="space-y-2">
                    {(scan.issues ?? []).map((issue, i) => {
                      if (typeof issue === 'string') {
                        return (
                          <li key={i} className="flex items-start gap-2.5 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5">
                            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-gray-300">{issue}</span>
                          </li>
                        )
                      }
                      const isBlock = issue.block
                      const isIndep = issue.source === 'independent'
                      return (
                        <li key={i} className={`bg-gray-900 border rounded-lg px-3 py-2.5 ${isBlock ? 'border-red-800/60' : 'border-gray-800'}`}>
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle size={13} className={`flex-shrink-0 mt-0.5 ${isBlock ? 'text-red-400' : 'text-amber-500'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {isBlock && (
                                  <span className="px-1.5 py-0.5 bg-red-900/60 text-red-400 text-[9px] font-bold uppercase rounded">BLOCK</span>
                                )}
                                {isIndep && (
                                  <span className="px-1.5 py-0.5 bg-purple-900/50 text-purple-400 text-[9px] font-bold uppercase rounded" title="Found independently by LLM — AST missed this">LLM-ONLY</span>
                                )}
                                {issue.line != null && (
                                  <span className="text-[10px] text-gray-600 font-mono">line {issue.line}</span>
                                )}
                                <span className="text-[10px] text-gray-600 font-mono">{issue.rule}</span>
                              </div>
                              <p className="text-sm text-gray-300">{issue.detail || issue.message}</p>
                              {issue.fix && (
                                <p className="text-xs text-gray-500 mt-1">Fix: {issue.fix}</p>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Pattern hits */}
              {(scan.quick_hits ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">Static Pattern Matches</p>
                  <div className="flex flex-wrap gap-2">
                    {(scan.quick_hits ?? []).map((h, i) => (
                      <span key={i} className="px-2.5 py-1 bg-yellow-900/30 border border-yellow-700/40 text-yellow-400 text-xs rounded-full">{h}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              {sub.parsed_metadata && Object.keys(sub.parsed_metadata).length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">Neural Metadata</p>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
                    {Object.entries(sub.parsed_metadata).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-xs text-gray-600 w-28 flex-shrink-0">{k}</span>
                        <span className="text-xs text-gray-300 flex-1 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submission info */}
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">Submission Info</p>
                <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
                  {[
                    ['Submission ID', sub.id],
                    ['Org ID', sub.org_id],
                    ['Namespace', sub.namespace],
                    ['Hash', sub.submission_hash?.slice(0, 16) + '…'],
                    ...(sub.admin_ticket_id ? [['Ticket ID', sub.admin_ticket_id]] : []),
                    ...(sub.rejection_reason ? [['Rejection Reason', sub.rejection_reason]] : []),
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-xs text-gray-600 w-28 flex-shrink-0">{k}</span>
                      <span className="text-xs text-gray-400 font-mono flex-1 truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {codeTab === 'code' && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0 bg-gray-900/60">
                <span className="text-xs text-gray-500 font-mono">{sub.trainer_name}.py</span>
                <button
                  onClick={copySource}
                  disabled={!source}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {loadingSource ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={18} className="animate-spin text-gray-600" />
                </div>
              ) : source === null ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <FileCode size={20} className="text-gray-700" />
                  <p className="text-sm text-gray-600">Source file not available</p>
                </div>
              ) : (
                <pre className="flex-1 overflow-auto p-0 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre">
                  {source.split('\n').map((line, i) => {
                    const lineNo = i + 1
                    const violation = astViolations.find(v => v.line === lineNo)
                    return (
                      <div
                        key={i}
                        title={violation ? `[${violation.rule}] ${violation.message}` : undefined}
                        className={clsx(
                          'flex px-4 py-0.5 group',
                          violation
                            ? 'bg-red-900/25 border-l-2 border-red-500'
                            : 'border-l-2 border-transparent'
                        )}
                      >
                        <span className="select-none w-10 text-right text-gray-700 flex-shrink-0 pr-4">{lineNo}</span>
                        <span className="flex-1">{line}</span>
                        {violation && (
                          <span className="ml-3 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity truncate max-w-[200px] flex-shrink-0">
                            {violation.rule}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity?: string }) {
  const s = severity ?? 'low'
  return (
    <span className={clsx(
      'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
      s === 'critical' || s === 'malicious' ? 'bg-red-900/50 text-red-400' :
      s === 'high'     ? 'bg-orange-900/50 text-orange-400' :
      s === 'low'      ? 'bg-yellow-900/40 text-yellow-500' :
      'bg-gray-800 text-gray-500',
    )}>
      {s}
    </span>
  )
}

function StatusBadge({ status }: { status: TrainerSubmission['status'] }) {
  return (
    <span className={clsx(
      'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
      status === 'approved'      ? 'bg-emerald-900/50 text-emerald-400' :
      status === 'pending_admin' ? 'bg-amber-900/50 text-amber-400' :
      status === 'flagged'       ? 'bg-red-900/50 text-red-400' :
      status === 'rejected'      ? 'bg-gray-800 text-gray-500' :
      status === 'scanning'      ? 'bg-blue-900/50 text-blue-400' :
      'bg-gray-800 text-gray-500',
    )}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Submission row ─────────────────────────────────────────────────────────────

function SubmissionRow({
  sub,
  onApprove,
  onReject,
  onReview,
  approving,
}: {
  sub: TrainerSubmission
  onApprove: (id: string) => void
  onReject:  (id: string) => void
  onReview:  (sub: TrainerSubmission) => void
  approving: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const scan = sub.llm_scan_result ?? {}
  const isPending = sub.status === 'pending_admin' || sub.status === 'flagged'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ShieldAlert size={15} className={clsx(
          'flex-shrink-0',
          sub.status === 'flagged' ? 'text-red-400' : 'text-amber-400'
        )} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-white truncate">{sub.trainer_name}.py</span>
            <StatusBadge status={sub.status} />
            <SeverityBadge severity={scan.severity} />
            {scan.model_used && (
              <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                via {scan.model_used}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-gray-600">{sub.owner_email}</span>
            <span className="text-gray-700">·</span>
            <span className="text-[11px] text-gray-600 flex items-center gap-1">
              <Clock size={10} /> {new Date(sub.submitted_at).toLocaleString()}
            </span>
          </div>
          {scan.summary && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-1">{scan.summary}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onReview(sub)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
            title="View analysis and source code"
          >
            <Eye size={12} /> Review
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors"
            title="Quick expand"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {isPending && (
            <>
              <button
                onClick={() => onReject(sub.id)}
                disabled={approving === sub.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-900/40 border border-red-700/60 text-red-400 hover:bg-red-900/70 rounded-lg transition-colors disabled:opacity-40"
              >
                <XCircle size={12} /> Reject
              </button>
              <button
                onClick={() => onApprove(sub.id)}
                disabled={approving === sub.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-900/50 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-800/60 rounded-lg transition-colors disabled:opacity-40"
              >
                {approving === sub.id
                  ? <Loader2 size={12} className="animate-spin" />
                  : <CheckCircle2 size={12} />
                }
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded scan report */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-3 bg-gray-950/60 space-y-3">
          {/* Issues list */}
          {(scan.issues ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Scan Issues</p>
              <ul className="space-y-1">
                {(scan.issues ?? []).map((issue, i) => {
                  const isStr = typeof issue === 'string'
                  const isBlock = !isStr && issue.block
                  const isIndep = !isStr && issue.source === 'independent'
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <AlertTriangle size={11} className={`flex-shrink-0 mt-0.5 ${isBlock ? 'text-red-400' : 'text-amber-500'}`} />
                      <span>
                        {isIndep && <span className="text-purple-400 mr-1">[LLM]</span>}
                        {isBlock && <span className="text-red-400 mr-1">[BLOCK]</span>}
                        {isStr ? issue : (issue.detail || issue.message)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Quick pattern hits */}
          {(scan.quick_hits ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Pattern Matches</p>
              <div className="flex flex-wrap gap-1.5">
                {(scan.quick_hits ?? []).map((h, i) => (
                  <span key={i} className="px-2 py-0.5 bg-yellow-900/30 border border-yellow-700/40 text-yellow-500 text-[10px] rounded-full">{h}</span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {sub.parsed_metadata && Object.keys(sub.parsed_metadata).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-1.5">Neural Metadata</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(sub.parsed_metadata).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5 text-xs">
                    <span className="text-gray-600">{k}:</span>
                    <span className="text-gray-400 truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* IDs */}
          <div className="flex items-center gap-4 text-[10px] text-gray-700">
            <span>submission: {sub.id}</span>
            {sub.admin_ticket_id && <span>ticket: {sub.admin_ticket_id}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reject modal ──────────────────────────────────────────────────────────────

function RejectModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: (reason: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <h3 className="text-base font-bold text-white mb-1">Reject Submission</h3>
        <p className="text-xs text-gray-500 mb-4">Provide a reason — this will be shown to the trainer owner.</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Uses subprocess to execute shell commands — security policy violation"
          className="w-full h-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim() || loading}
            className="flex-1 py-2 text-sm font-semibold bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FilterStatus = 'pending' | 'approved' | 'rejected' | 'all'

export default function TrainerReviewPage() {
  const [submissions, setSubmissions] = useState<TrainerSubmission[]>([])
  const [tickets, setTickets] = useState<AdminTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('pending')
  const [approving, setApproving] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectLoading, setRejectLoading] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<TrainerSubmission | null>(null)
  const [tab, setTab] = useState<'submissions' | 'tickets'>('submissions')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [subRes, ticketRes] = await Promise.all([
        trainerSubmissionsApi.list(),
        trainerSubmissionsApi.listTickets(),
      ])
      setSubmissions(subRes.items)
      setTickets(ticketRes.items)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleApprove = async (id: string) => {
    setApproving(id)
    try {
      await trainerSubmissionsApi.approve(id)
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'approved' } : s))
      setReviewTarget(prev => prev?.id === id ? { ...prev, status: 'approved' } : prev)
    } catch {}
    finally { setApproving(null) }
  }

  const handleReject = async (reason: string) => {
    if (!rejectTarget) return
    setRejectLoading(true)
    try {
      await trainerSubmissionsApi.reject(rejectTarget, reason)
      setSubmissions(prev => prev.map(s => s.id === rejectTarget ? { ...s, status: 'rejected', rejection_reason: reason } : s))
      setReviewTarget(prev => prev?.id === rejectTarget ? { ...prev, status: 'rejected', rejection_reason: reason } : prev)
      setRejectTarget(null)
    } catch {}
    finally { setRejectLoading(false) }
  }

  const filtered = submissions.filter(s => {
    if (filter === 'pending') return s.status === 'pending_admin' || s.status === 'flagged'
    if (filter === 'approved') return s.status === 'approved'
    if (filter === 'rejected') return s.status === 'rejected'
    return true
  })

  const pendingCount = submissions.filter(s => s.status === 'pending_admin' || s.status === 'flagged').length
  const openTickets  = tickets.filter(t => t.status === 'open' || t.status === 'reviewing').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert size={20} className="text-amber-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Security Reviews</h1>
            <p className="text-xs text-gray-600">Neural submissions flagged by the security scanner</p>
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
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pending Review', value: pendingCount, color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-800/40' },
          { label: 'Open Tickets',   value: openTickets,  color: 'text-red-400',   bg: 'bg-red-900/20 border-red-800/40' },
          { label: 'Total Scanned',  value: submissions.length, color: 'text-gray-300', bg: 'bg-gray-800/60 border-gray-700/40' },
        ].map(s => (
          <div key={s.label} className={clsx('border rounded-xl p-4', s.bg)}>
            <div className={clsx('text-2xl font-bold', s.color)}>{s.value}</div>
            <div className="text-xs text-gray-600 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {([
          { id: 'submissions', label: 'Submissions', count: pendingCount },
          { id: 'tickets',     label: 'Admin Tickets', count: openTickets },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-900/60 text-amber-400 rounded-full text-[10px] font-bold">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Submissions tab */}
      {tab === 'submissions' && (
        <>
          {/* Filter bar */}
          <div className="flex gap-2">
            {([
              { id: 'pending',  label: 'Pending',  count: submissions.filter(s => s.status === 'pending_admin' || s.status === 'flagged').length },
              { id: 'approved', label: 'Approved', count: submissions.filter(s => s.status === 'approved').length },
              { id: 'rejected', label: 'Rejected', count: submissions.filter(s => s.status === 'rejected').length },
              { id: 'all',      label: 'All',      count: submissions.length },
            ] as const).map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  filter === f.id
                    ? 'bg-brand-900/50 border-brand-700/60 text-brand-300'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                )}
              >
                {f.label}
                <span className="text-[10px] text-gray-600">{f.count}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-gray-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <ShieldCheck size={28} className="text-emerald-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {filter === 'pending' ? 'No pending submissions — all clear.' : 'Nothing to show.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(sub => (
                <SubmissionRow
                  key={sub.id}
                  sub={sub}
                  onApprove={handleApprove}
                  onReject={id => setRejectTarget(id)}
                  onReview={sub => setReviewTarget(sub)}
                  approving={approving}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Tickets tab */}
      {tab === 'tickets' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-gray-600" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16">
              <ShieldCheck size={28} className="text-emerald-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No admin tickets.</p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-white">{ticket.title}</span>
                      <SeverityBadge severity={ticket.severity} />
                      <span className={clsx(
                        'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide',
                        ticket.status === 'open'      ? 'bg-amber-900/40 text-amber-400' :
                        ticket.status === 'reviewing' ? 'bg-blue-900/40 text-blue-400' :
                        ticket.status === 'resolved'  ? 'bg-emerald-900/40 text-emerald-400' :
                        'bg-gray-800 text-gray-500',
                      )}>
                        {ticket.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{ticket.owner_email}</p>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ticket.body}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {(ticket.status === 'open' || ticket.status === 'reviewing') && (
                      <>
                        <button
                          onClick={() => trainerSubmissionsApi.updateTicket(ticket.id, 'dismissed').then(load)}
                          className="px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-500 hover:text-white rounded-lg transition-colors"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => trainerSubmissionsApi.updateTicket(ticket.id, 'resolved').then(load)}
                          className="px-2.5 py-1.5 text-xs bg-emerald-900/50 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-800/60 rounded-lg transition-colors"
                        >
                          Resolve
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-gray-700 mt-2">
                  <Clock size={9} className="inline mr-1" />
                  {new Date(ticket.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <RejectModal
          onConfirm={handleReject}
          onCancel={() => setRejectTarget(null)}
          loading={rejectLoading}
        />
      )}

      {/* Review slide-over */}
      {reviewTarget && (
        <ReviewSlideOver
          sub={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onApprove={handleApprove}
          onReject={id => setRejectTarget(id)}
          approving={approving}
        />
      )}
    </div>
  )
}
