import { useState, useEffect, useRef } from 'react'
import { trainersApi } from '@/api/trainers'
import type { TrainerRegistration } from '@/types/trainer'
import StatusBadge from './StatusBadge'
import JobsPanel from './JobsPanel'
import { Upload, RefreshCw, Scan, Trash2, Brain, Loader2, ChevronDown, ChevronRight, ChevronLeft, Play } from 'lucide-react'
import clsx from 'clsx'

const PAGE_SIZE = 10

interface Props {
  onStartTraining?: (trainerName: string) => void
}

type Tab = 'trainers' | 'jobs'

export default function TrainersPage({ onStartTraining }: Props) {
  const [tab, setTab] = useState<Tab>('trainers')
  const [trainers, setTrainers] = useState<TrainerRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await trainersApi.list()
      setTrainers(data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await trainersApi.scan()
      setUploadMsg(`Scan complete — ${res.trainers_registered} trainer(s) registered`)
      await load()
    } catch {}
    finally { setScanning(false); setTimeout(() => setUploadMsg(null), 3000) }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadMsg(null)
    try {
      const res = await trainersApi.upload(file)
      setUploadMsg(`Uploaded "${res.uploaded}" — ${res.trainers_registered} trainer(s) registered`)
      await load()
    } catch (err: unknown) {
      setUploadMsg(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      setTimeout(() => setUploadMsg(null), 4000)
    }
  }

  const handleDeactivate = async (name: string) => {
    if (!confirm(`Deactivate trainer "${name}"?`)) return
    await trainersApi.deactivate(name)
    setTrainers(prev => prev.filter(t => t.name !== name))
  }

  const frameworkColor = (fw: string) => {
    const map: Record<string, string> = {
      sklearn: 'text-orange-400', pytorch: 'text-red-400', tensorflow: 'text-yellow-400',
      keras: 'text-pink-400', yolo: 'text-green-400', roboflow: 'text-purple-400',
    }
    return map[fw?.toLowerCase()] ?? 'text-gray-400'
  }

  const totalPages = Math.max(1, Math.ceil(trainers.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = trainers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'trainers', label: 'Trainer Plugins', count: trainers.length },
    { id: 'jobs',     label: 'Training Jobs' },
  ]

  return (
    <div className="space-y-5">
      {/* Actions bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-colors"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Upload Plugin (.py)
        </button>
        <input ref={fileRef} type="file" accept=".py" className="hidden"
          onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

        <button onClick={handleScan} disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-xl text-sm font-medium text-gray-300 border border-gray-700 transition-colors">
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Scan size={14} />}
          Scan Plugin Dir
        </button>

        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-gray-300 text-sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {uploadMsg && (
          <span className={clsx('text-xs px-3 py-1.5 rounded-lg border', uploadMsg.includes('failed')
            ? 'bg-red-950/50 text-red-400 border-red-800'
            : 'bg-emerald-950/50 text-emerald-400 border-emerald-800'
          )}>
            {uploadMsg}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300'
            )}>
            {t.label}
            {t.count !== undefined && (
              <span className={clsx('ml-2 text-[10px] px-1.5 py-0.5 rounded-full',
                tab === t.id ? 'bg-brand-900/60 text-brand-400' : 'bg-gray-800 text-gray-600')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Trainers tab ── */}
      {tab === 'trainers' && (
        <>
          <p className="text-xs text-gray-600">
            {trainers.length} registered trainer{trainers.length !== 1 ? 's' : ''}
            {totalPages > 1 && ` · page ${safePage}/${totalPages}`}
            {' · '}Plugin directory: <code className="text-gray-500">/app/trainers</code>
          </p>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-gray-900 rounded-2xl h-16 border border-gray-800 animate-pulse" />
              ))}
            </div>
          ) : trainers.length === 0 ? (
            <div className="text-center py-16 text-gray-600">
              <Brain size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No trainers registered. Upload a .py plugin or scan the plugin directory.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {paginated.map(t => (
                  <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-3 px-5 py-4">
                      <button onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                        className="text-gray-500 hover:text-gray-300">
                        {expanded === t.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <div className="w-9 h-9 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
                        <Brain size={16} className="text-brand-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-gray-100">{t.name}</span>
                          <span className="text-[10px] text-gray-600">v{t.version}</span>
                          <span className={clsx('text-[10px] font-medium', frameworkColor(t.framework))}>{t.framework}</span>
                          {!t.is_active && <StatusBadge status="inactive" />}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{t.description || 'No description'}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {onStartTraining && (
                          <button onClick={() => onStartTraining(t.name)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-900/50 hover:bg-brand-900 text-brand-400 border border-brand-800/50 rounded-lg transition-colors">
                            <Play size={11} /> Train
                          </button>
                        )}
                        <button onClick={() => handleDeactivate(t.name)}
                          className="p-1.5 text-gray-700 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {expanded === t.id && (
                      <div className="border-t border-gray-800 px-5 py-4 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <Info label="Framework" value={t.framework} />
                          <Info label="Schedule" value={t.schedule || 'Manual only'} />
                          <Info label="Last Trained" value={t.last_trained_at ? new Date(t.last_trained_at).toLocaleDateString() : 'Never'} />
                          <Info label="Registered" value={new Date(t.created_at).toLocaleDateString()} />
                        </div>
                        {t.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {t.tags.map(tag => (
                              <span key={tag} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                      .reduce<(number | '...')[]>((acc, p, i, arr) => {
                        if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                        acc.push(p); return acc
                      }, [])
                      .map((p, i) => p === '...'
                        ? <span key={`e${i}`} className="px-1 text-xs text-gray-600">…</span>
                        : <button key={p} onClick={() => setPage(p as number)}
                            className={clsx('w-7 h-7 text-xs rounded-lg transition-colors',
                              p === safePage ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
                            {p}
                          </button>
                      )}
                  </div>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors">
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Jobs tab ── */}
      {tab === 'jobs' && <JobsPanel />}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-gray-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-gray-300 font-medium">{value}</p>
    </div>
  )
}
