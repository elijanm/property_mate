/**
 * GitPanel — sidebar panel for the code editor.
 * Shows git status, commit, push, and history for the active project.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  GitBranch, Upload, RotateCcw, CheckCircle2, AlertCircle,
  Loader2, ChevronDown, ChevronRight, Clock, Plus,
  GitCommit as GitCommitIcon, Globe,
} from 'lucide-react'
import clsx from 'clsx'
import { gitApi } from '@/api/git'
import type { GitStatus, GitCommit } from '@/types/git'

interface Props {
  projectName: string
  onInitRepo?: () => void
}

export default function GitPanel({ projectName, onInitRepo }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [loadingLog, setLoadingLog] = useState(false)
  const [notGit, setNotGit] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectName) return
    setLoadingStatus(true)
    setError('')
    setNotGit(false)
    try {
      const s = await gitApi.status(projectName)
      setStatus(s)
    } catch (e: any) {
      const msg: string = e.response?.data?.detail || e.message || ''
      if (msg.includes('not a git')) {
        setNotGit(true)
      } else {
        setError(msg)
      }
      setStatus(null)
    } finally {
      setLoadingStatus(false)
    }
  }, [projectName])

  useEffect(() => { refresh() }, [refresh])

  const loadLog = async () => {
    if (!projectName) return
    setLoadingLog(true)
    try {
      const data = await gitApi.log(projectName, 15)
      setCommits(data.commits)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Failed to load log')
    } finally {
      setLoadingLog(false)
    }
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    setCommitting(true)
    setError('')
    setSuccess('')
    try {
      const res = await gitApi.commit(projectName, commitMsg)
      setCommitMsg('')
      setSuccess(res.sha ? `Committed ${res.sha.slice(0, 7)}` : 'Nothing to commit')
      await refresh()
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const handlePush = async () => {
    setPushing(true)
    setError('')
    setSuccess('')
    try {
      await gitApi.push(projectName)
      setSuccess('Pushed to remote')
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  if (!projectName) {
    return (
      <div className="p-3 text-xs text-gray-500 text-center">
        No project selected
      </div>
    )
  }

  if (notGit) {
    return (
      <div className="p-3 space-y-3">
        <p className="text-xs text-gray-500">This project is not a git repository.</p>
        {onInitRepo && (
          <button
            onClick={onInitRepo}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            <Plus size={12} />
            Init Git Repo
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Branch + refresh */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-1.5 text-gray-400">
          <GitBranch size={12} />
          <span className="font-medium">{status?.branch ?? '—'}</span>
        </div>
        <button
          onClick={refresh}
          disabled={loadingStatus}
          className="p-1 text-gray-600 hover:text-gray-400 transition-colors"
        >
          <RotateCcw size={11} className={loadingStatus ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Remote */}
      {status?.remote_url && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-800 text-[11px] text-gray-600 truncate">
          <Globe size={10} />
          <span className="truncate">{status.remote_url}</span>
        </div>
      )}

      {/* Changed files */}
      <div className="flex-1 overflow-y-auto">
        {loadingStatus ? (
          <div className="flex justify-center py-4">
            <Loader2 size={14} className="animate-spin text-gray-600" />
          </div>
        ) : status ? (
          <>
            {status.clean ? (
              <div className="flex items-center gap-1.5 px-3 py-3 text-[11px] text-gray-500">
                <CheckCircle2 size={12} className="text-green-600" />
                Working tree clean
              </div>
            ) : (
              <div className="px-3 py-2">
                <p className="text-[11px] text-gray-500 mb-1.5">{status.changed.length} changed file{status.changed.length !== 1 ? 's' : ''}</p>
                <div className="space-y-0.5 max-h-36 overflow-y-auto">
                  {status.changed.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className={clsx(
                        'text-[10px] font-mono w-4 text-center flex-shrink-0',
                        f.status.includes('M') ? 'text-yellow-500' :
                        f.status.includes('A') ? 'text-green-500' :
                        f.status.includes('D') ? 'text-red-500' : 'text-gray-400',
                      )}>
                        {f.status}
                      </span>
                      <span className="text-[11px] text-gray-400 truncate">{f.path}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : error ? null : (
          <div className="px-3 py-3 text-[11px] text-gray-600">Loading…</div>
        )}

        {/* Error / success */}
        {error && (
          <div className="mx-3 mb-2 flex items-start gap-1.5 px-2 py-1.5 bg-red-950/50 border border-red-800/30 rounded-lg text-[11px] text-red-300">
            <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        {success && (
          <div className="mx-3 mb-2 flex items-center gap-1.5 px-2 py-1.5 bg-green-950/50 border border-green-800/30 rounded-lg text-[11px] text-green-300">
            <CheckCircle2 size={11} />
            {success}
          </div>
        )}
      </div>

      {/* Commit */}
      <div className="px-3 py-2 border-t border-gray-800 space-y-2">
        <textarea
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim()}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-40"
          >
            {committing ? <Loader2 size={11} className="animate-spin" /> : <GitCommitIcon size={11} />}
            Commit
          </button>
          <button
            onClick={handlePush}
            disabled={pushing}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] bg-brand-700 hover:bg-brand-600 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            {pushing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            Push
          </button>
        </div>
      </div>

      {/* Commit log toggle */}
      <div className="border-t border-gray-800">
        <button
          onClick={() => {
            const next = !showLog
            setShowLog(next)
            if (next && commits.length === 0) loadLog()
          }}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-gray-500 hover:text-gray-300 hover:bg-gray-900 transition-colors"
        >
          <span className="flex items-center gap-1.5"><Clock size={11} />Commit history</span>
          {showLog ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {showLog && (
          <div className="px-3 pb-2 max-h-48 overflow-y-auto space-y-1.5">
            {loadingLog ? (
              <div className="flex justify-center py-2"><Loader2 size={13} className="animate-spin text-gray-600" /></div>
            ) : commits.length === 0 ? (
              <p className="text-[11px] text-gray-600 py-1">No commits yet</p>
            ) : (
              commits.map(c => (
                <div key={c.sha} className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <code className="text-[10px] text-brand-400 font-mono">{c.sha.slice(0, 7)}</code>
                    <span className="text-[11px] text-gray-300 line-clamp-1">{c.message}</span>
                  </div>
                  <div className="text-[10px] text-gray-600">{c.author} · {c.date.slice(0, 10)}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
