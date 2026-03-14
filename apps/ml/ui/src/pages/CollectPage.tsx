/**
 * CollectPage — public mobile-first data collection form.
 * Accessed via unique link: /collect/<token>
 * No authentication required.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Upload, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X, Star, Gift, AlertCircle, RefreshCw, Image as ImageIcon } from 'lucide-react'
import clsx from 'clsx'
import { collectApi } from '@/api/datasets'
import type { CollectFormDefinition, DatasetField, DatasetEntry } from '@/types/dataset'

// ── Camera capture component ─────────────────────────────────────────────────

function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setError('')
    } catch {
      setError('Camera not accessible. Please allow camera permissions and try again.')
    }
  }, [])

  useEffect(() => {
    startCamera(facingMode)
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [facingMode, startCamera])

  const capture = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      onCapture(new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10">
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white"><X size={18} /></button>
        <span className="text-sm font-medium text-white">Take Photo</span>
        <button onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')}
          className="p-2 rounded-full bg-white/10 text-white">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle size={40} className="text-red-400" />
            <p className="text-sm text-white">{error}</p>
            <button onClick={() => startCamera(facingMode)} className="px-4 py-2 bg-white/10 text-white rounded-xl text-sm">Retry</button>
          </div>
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
        )}
        {/* Corner guides */}
        {!error && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-64 h-64 relative">
              {(['tl','tr','bl','br'] as const).map(c => (
                <div key={c} className={clsx('absolute w-8 h-8 border-white border-2',
                  c === 'tl' && 'top-0 left-0 border-r-0 border-b-0 rounded-tl-lg',
                  c === 'tr' && 'top-0 right-0 border-l-0 border-b-0 rounded-tr-lg',
                  c === 'bl' && 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-lg',
                  c === 'br' && 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-lg',
                )} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shutter */}
      <div className="bg-black/80 py-8 flex justify-center">
        <button onClick={capture} disabled={!!error}
          className="w-18 h-18 w-[72px] h-[72px] rounded-full bg-white disabled:opacity-40 active:scale-95 transition-transform shadow-lg" />
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

// ── Field submission card ─────────────────────────────────────────────────────

interface FieldState {
  file: File | null
  preview: string | null
  textValue: string
  description: string
  submitted: boolean
  submitting: boolean
  error: string
  entry: DatasetEntry | null
}

function FieldCard({
  field, state, token, onSubmitted,
}: {
  field: DatasetField
  state: FieldState
  token: string
  onSubmitted: (entry: DatasetEntry) => void
}) {
  const [showCamera, setShowCamera] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [localState, setLocalState] = useState<FieldState>(state)

  const set = (patch: Partial<FieldState>) => setLocalState(s => ({ ...s, ...patch }))

  const pickFile = (file: File) => {
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    set({ file, preview, error: '' })
  }

  const submit = async () => {
    if (field.type === 'image' || field.type === 'file') {
      if (!localState.file && field.required) { set({ error: 'Please capture or upload a file.' }); return }
    } else {
      if (!localState.textValue.trim() && field.required) { set({ error: 'This field is required.' }); return }
    }
    if (field.description_required && !localState.description.trim()) {
      set({ error: 'Description is required for this field.' }); return
    }
    set({ submitting: true, error: '' })
    try {
      const entry = await collectApi.submit(
        token, field.id,
        localState.file,
        (field.type === 'text' || field.type === 'number') ? localState.textValue : undefined,
        localState.description || undefined,
      )
      set({ submitting: false, submitted: true, entry })
      onSubmitted(entry)
    } catch (e: any) {
      set({ submitting: false, error: e?.response?.data?.detail ?? 'Submission failed. Try again.' })
    }
  }

  if (localState.submitted) {
    return (
      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-900/20 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-900/60 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} className="text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-300">{field.label}</p>
            <p className="text-xs text-emerald-600 mt-0.5">Submitted ✓</p>
          </div>
          {localState.preview && (
            <img src={localState.preview} alt="" className="w-14 h-14 rounded-xl object-cover border border-emerald-800/50 shrink-0" />
          )}
        </div>
        {localState.entry && localState.entry.points_awarded > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
            <Star size={12} fill="currentColor" /> +{localState.entry.points_awarded} points earned
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-700/60 bg-gray-800/40 overflow-hidden">
      {/* Field header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
            field.type === 'image' ? 'bg-sky-900/60' : field.type === 'file' ? 'bg-purple-900/60' : 'bg-gray-700/60')}>
            {field.type === 'image' ? <ImageIcon size={16} className="text-sky-400" /> : <Upload size={16} className="text-purple-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-snug">{field.label}</p>
            {field.instruction && (
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{field.instruction}</p>
            )}
          </div>
          {field.required && <span className="text-[10px] text-red-400 font-semibold shrink-0 mt-1">Required</span>}
        </div>
      </div>

      {/* Content area */}
      <div className="px-4 pb-4 space-y-3">
        {(field.type === 'image' || field.type === 'file') && (
          <>
            {/* Preview */}
            {localState.preview ? (
              <div className="relative">
                <img src={localState.preview} alt="Preview" className="w-full h-52 object-cover rounded-xl border border-gray-600/50" />
                <button onClick={() => set({ file: null, preview: null })}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80">
                  <X size={14} />
                </button>
              </div>
            ) : localState.file ? (
              <div className="flex items-center gap-3 bg-gray-700/50 rounded-xl px-3 py-3">
                <Upload size={18} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-300 truncate flex-1">{localState.file.name}</span>
                <button onClick={() => set({ file: null })} className="text-gray-500 hover:text-white"><X size={14} /></button>
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed border-gray-600/50 bg-gray-800/30 p-6 text-center">
                <ImageIcon size={28} className="text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No image selected</p>
              </div>
            )}

            {/* Capture / upload buttons */}
            <div className={clsx('grid gap-2', field.capture_mode === 'both' ? 'grid-cols-2' : 'grid-cols-1')}>
              {(field.capture_mode === 'camera_only' || field.capture_mode === 'both') && (
                <button onClick={() => setShowCamera(true)}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 border border-sky-600/30 text-sky-400 text-sm font-medium transition-colors active:scale-[0.98]">
                  <Camera size={16} /> Take Photo
                </button>
              )}
              {(field.capture_mode === 'upload_only' || field.capture_mode === 'both') && (
                <>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/30 text-purple-400 text-sm font-medium transition-colors active:scale-[0.98]">
                    <Upload size={16} /> Upload
                  </button>
                  <input ref={fileInputRef} type="file"
                    accept={field.type === 'image' ? 'image/*' : '*/*'}
                    className="hidden" onChange={e => e.target.files?.[0] && pickFile(e.target.files[0])} />
                </>
              )}
            </div>
          </>
        )}

        {(field.type === 'text') && (
          <textarea rows={3}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
            placeholder="Type your response here…"
            value={localState.textValue}
            onChange={e => set({ textValue: e.target.value })} />
        )}

        {field.type === 'number' && (
          <input type="number"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            placeholder="Enter a number"
            value={localState.textValue}
            onChange={e => set({ textValue: e.target.value })} />
        )}

        {/* Description */}
        {field.description_mode !== 'none' && (
          <div>
            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5 block">
              Description {field.description_required && <span className="text-red-400">*</span>}
            </label>
            {field.description_mode === 'free_text' ? (
              <textarea rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                placeholder="Describe what you see…"
                value={localState.description}
                onChange={e => set({ description: e.target.value })} />
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {field.description_presets.map(p => (
                  <button key={p} onClick={() => set({ description: p })}
                    className={clsx('py-2 px-3 rounded-xl border text-sm text-left transition-colors active:scale-[0.98]',
                      localState.description === p
                        ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300 font-medium'
                        : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:border-gray-600')}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {localState.error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={12} /> {localState.error}
          </p>
        )}

        <button onClick={submit} disabled={localState.submitting}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.98]">
          {localState.submitting ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Submit'}
        </button>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={file => { pickFile(file); setShowCamera(false) }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  )
}

// ── Main CollectPage ──────────────────────────────────────────────────────────

interface Props {
  token: string
}

export default function CollectPage({ token }: Props) {
  const [form, setForm] = useState<CollectFormDefinition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({})
  const [currentIdx, setCurrentIdx] = useState(0)

  useEffect(() => {
    collectApi.getForm(token)
      .then(f => {
        setForm(f)
        const states: Record<string, FieldState> = {}
        f.dataset.fields.forEach(field => {
          states[field.id] = {
            file: null, preview: null, textValue: '', description: '',
            submitted: false, submitting: false, error: '', entry: null,
          }
        })
        setFieldStates(states)
      })
      .catch(e => setError(e?.response?.data?.detail ?? 'Failed to load collection form.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmitted = (fieldId: string, entry: DatasetEntry) => {
    setFieldStates(s => ({ ...s, [fieldId]: { ...s[fieldId], submitted: true, entry } }))
    if (form && currentIdx < form.dataset.fields.length - 1) {
      setTimeout(() => setCurrentIdx(i => i + 1), 600)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Unable to load form</p>
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!form) return null

  const { dataset, collector } = form
  const fields = dataset.fields
  const submittedCount = Object.values(fieldStates).filter(s => s.submitted).length
  const allDone = submittedCount === fields.length
  const progress = fields.length > 0 ? (submittedCount / fields.length) * 100 : 0

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-[#060810]/95 backdrop-blur border-b border-gray-800/50">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">Hi {collector.name}</p>
              <h1 className="text-sm font-bold text-white truncate">{dataset.name}</h1>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">{submittedCount}/{fields.length}</p>
              {dataset.points_enabled && (
                <p className="text-xs text-amber-400 flex items-center gap-1 justify-end">
                  <Star size={10} fill="currentColor" /> {collector.points_earned + submittedCount * dataset.points_per_entry} pts
                </p>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Points banner */}
        {dataset.points_enabled && dataset.points_redemption_info && (
          <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-800/40 rounded-2xl px-4 py-3">
            <Gift size={18} className="text-amber-400 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-300">Earn points for each submission</p>
              <p className="text-xs text-amber-600 mt-0.5">{dataset.points_redemption_info}</p>
            </div>
          </div>
        )}

        {/* Description */}
        {dataset.description && (
          <p className="text-sm text-gray-400 leading-relaxed">{dataset.description}</p>
        )}

        {/* All done state */}
        {allDone ? (
          <div className="text-center py-12 px-4">
            <div className="w-20 h-20 rounded-full bg-emerald-900/40 border-2 border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={36} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">All done! 🎉</h2>
            <p className="text-sm text-gray-400 mb-4">Thank you for contributing to <strong className="text-white">{dataset.name}</strong>.</p>
            {dataset.points_enabled && (
              <div className="inline-flex items-center gap-2 bg-amber-900/30 border border-amber-800/40 rounded-full px-5 py-2.5">
                <Star size={16} className="text-amber-400" fill="currentColor" />
                <span className="text-sm font-semibold text-amber-300">{collector.points_earned + submittedCount * dataset.points_per_entry} points earned</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Navigation (field tabs) */}
            {fields.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {fields.map((f, i) => (
                  <button key={f.id} onClick={() => setCurrentIdx(i)}
                    className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                      i === currentIdx
                        ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                        : fieldStates[f.id]?.submitted
                        ? 'bg-emerald-900/30 border border-emerald-800/40 text-emerald-400'
                        : 'bg-gray-800/50 border border-gray-700/40 text-gray-500')}>
                    {fieldStates[f.id]?.submitted && <CheckCircle2 size={10} />}
                    {f.label.slice(0, 20)}{f.label.length > 20 ? '…' : ''}
                  </button>
                ))}
              </div>
            )}

            {/* Current field */}
            {fields[currentIdx] && (
              <FieldCard
                key={fields[currentIdx].id}
                field={fields[currentIdx]}
                state={fieldStates[fields[currentIdx].id] ?? {
                  file: null, preview: null, textValue: '', description: '',
                  submitted: false, submitting: false, error: '', entry: null,
                }}
                token={token}
                onSubmitted={entry => handleSubmitted(fields[currentIdx].id, entry)}
              />
            )}

            {/* Prev / Next */}
            {fields.length > 1 && (
              <div className="flex gap-3">
                <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0}
                  className="flex-1 py-3 rounded-xl bg-gray-800/60 disabled:opacity-30 text-gray-300 text-sm flex items-center justify-center gap-2">
                  <ChevronLeft size={16} /> Previous
                </button>
                <button onClick={() => setCurrentIdx(i => Math.min(fields.length - 1, i + 1))} disabled={currentIdx === fields.length - 1}
                  className="flex-1 py-3 rounded-xl bg-gray-800/60 disabled:opacity-30 text-gray-300 text-sm flex items-center justify-center gap-2">
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}

            {/* Submitted fields overview */}
            {submittedCount > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Submitted</p>
                {fields.filter(f => fieldStates[f.id]?.submitted).map(f => (
                  <div key={f.id} className="flex items-center gap-3 bg-emerald-900/20 border border-emerald-800/30 rounded-xl px-4 py-2.5">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">{f.label}</span>
                    {fieldStates[f.id]?.preview && (
                      <img src={fieldStates[f.id].preview!} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#060810]/90 backdrop-blur border-t border-gray-800/50 px-4 py-3 text-center">
        <p className="text-[10px] text-gray-600">Powered by <span className="text-gray-500">MLDock.io</span></p>
      </div>
    </div>
  )
}
