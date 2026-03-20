/**
 * CollectPage — public mobile-first data collection form.
 * Accessed via unique link: /collect/<token>
 * No authentication required.
 *
 * Supports repeatable fields: a field marked `repeatable` can be submitted
 * multiple times (infinite or up to `max_repeats`).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera, Upload, CheckCircle2, ChevronLeft, ChevronRight, ChevronUp,
  Loader2, X, Star, Gift, AlertCircle, RefreshCw, Image as ImageIcon,
  Plus, Repeat2, MapPin, Navigation, ShieldCheck, Video, Film,
  Square, Circle, FolderArchive, FileText, UserCheck, RotateCcw,
} from 'lucide-react'
import clsx from 'clsx'
import JSZip from 'jszip'
import { collectApi } from '@/api/datasets'
import { consentApi } from '@/api/consent'
import { useMultipartUpload } from '@/hooks/useMultipartUpload'
import type { CollectFormDefinition, DatasetField, DatasetEntry } from '@/types/dataset'
import type { ConsentRecord } from '@/types/consent'
import SignaturePad from '@/components/SignaturePad'

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getLoggedInAnnotator(): { email: string; name: string } | null {
  try {
    // Check new separate annotator namespace first, fall back to legacy ml_user
    const raw = localStorage.getItem('ml_annotator_user') || localStorage.getItem('ml_user')
    if (!raw) return null
    const u = JSON.parse(raw)
    if (u?.role === 'annotator' && u?.email) return { email: u.email, name: u.full_name || u.email }
    return null
  } catch { return null }
}

// ── Live video recording overlay ──────────────────────────────────────────────

function VideoCapture({
  onCapture, onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const nativeFallbackRef = useRef<HTMLInputElement>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    setError('')
    setStreaming(false)
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play()
        setStreaming(true)
      }
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera/microphone permission denied. Allow access in browser settings.'
        : err?.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : 'Camera unavailable — the page may need to be served over HTTPS.'
      setError(msg)
    }
  }, [])

  useEffect(() => {
    startCamera(facingMode)
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [facingMode, startCamera])

  const startRecording = () => {
    if (!streamRef.current) return
    chunksRef.current = []
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4'
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    recorderRef.current = recorder
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      onCapture(new File([blob], `video_${Date.now()}.${ext}`, { type: mimeType }))
    }
    recorder.start(100)
    setRecording(true)
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    setRecording(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={() => { if (recording) stopRecording(); onClose() }}
          className="p-2 rounded-full bg-white/10 text-white [touch-action:manipulation]"><X size={18} /></button>
        <div className="flex items-center gap-2">
          {recording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-sm font-medium text-white">
            {recording ? fmt(elapsed) : 'Record Video'}
          </span>
        </div>
        <button
          onClick={() => { if (!recording) setFacingMode(m => m === 'environment' ? 'user' : 'environment') }}
          disabled={!!error || recording}
          className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative overflow-hidden bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline autoPlay />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-black/80">
            <AlertCircle size={40} className="text-red-400" />
            <p className="text-sm text-white leading-relaxed">{error}</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button onClick={() => startCamera(facingMode)}
                className="py-2.5 px-5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium">
                Retry
              </button>
              <button onClick={() => nativeFallbackRef.current?.click()}
                className="py-2.5 px-5 bg-rose-600/80 hover:bg-rose-600 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2">
                <Video size={15} /> Use Device Camera
              </button>
            </div>
            <input ref={nativeFallbackRef} type="file" accept="video/*" capture="environment" className="hidden"
              onChange={e => { if (e.target.files?.[0]) { onCapture(e.target.files[0]); onClose() } }} />
          </div>
        )}
      </div>

      {/* Record / Stop button */}
      <div className="bg-black/80 py-8 flex justify-center" style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}>
        {recording ? (
          <button onClick={stopRecording}
            className="w-[72px] h-[72px] rounded-full bg-red-500 active:scale-95 transition-transform shadow-lg flex items-center justify-center">
            <Square size={26} fill="white" className="text-white" />
          </button>
        ) : (
          <button onClick={startRecording} disabled={!streaming || !!error}
            className="w-[72px] h-[72px] rounded-full border-4 border-white disabled:opacity-30 active:scale-95 transition-transform shadow-lg flex items-center justify-center">
            <Circle size={52} fill="#ef4444" className="text-red-500" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── In-browser camera overlay ─────────────────────────────────────────────────

function CameraCapture({
  onCapture, onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const nativeFallbackRef = useRef<HTMLInputElement>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState(false)

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    setError('')
    setStreaming(false)
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setStreaming(true)
      }
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Camera permission denied. Tap "Use Device Camera" below or allow camera access in browser settings.'
        : err?.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : 'Camera unavailable — the page may need to be served over HTTPS.'
      setError(msg)
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
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white [touch-action:manipulation]"><X size={18} /></button>
        <span className="text-sm font-medium text-white">Take Photo</span>
        <button
          onClick={() => setFacingMode(m => m === 'environment' ? 'user' : 'environment')}
          disabled={!!error}
          className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative overflow-hidden bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
        {streaming && !error && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-64 h-64 relative">
              {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
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
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-black/80">
            <AlertCircle size={40} className="text-red-400" />
            <p className="text-sm text-white leading-relaxed">{error}</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button onClick={() => startCamera(facingMode)}
                className="py-2.5 px-5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium">
                Retry
              </button>
              <button onClick={() => nativeFallbackRef.current?.click()}
                className="py-2.5 px-5 bg-sky-600/80 hover:bg-sky-600 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2">
                <Camera size={15} /> Use Device Camera
              </button>
            </div>
            <input ref={nativeFallbackRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { if (e.target.files?.[0]) { onCapture(e.target.files[0]); onClose() } }} />
          </div>
        )}
      </div>

      {/* Shutter */}
      <div className="bg-black/80 py-8 flex justify-center" style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}>
        <button onClick={capture} disabled={!streaming}
          className="w-[72px] h-[72px] rounded-full bg-white disabled:opacity-30 active:scale-95 transition-transform shadow-lg" />
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

// ── Per-field session state ───────────────────────────────────────────────────

interface Submission {
  preview: string | null
  entry: DatasetEntry
}

interface FieldSession {
  // active (in-progress) capture
  file: File | null
  preview: string | null
  textValue: string
  description: string
  submitting: boolean
  error: string
  uploadProgress: number
  // completed submissions for this field
  submissions: Submission[]
}

function blankSession(): FieldSession {
  return { file: null, preview: null, textValue: '', description: '', submitting: false, error: '', uploadProgress: 0, submissions: [] }
}

function canAddMore(field: DatasetField, session: FieldSession): boolean {
  if (!field.repeatable) return session.submissions.length === 0
  if (field.max_repeats === 0) return true
  return session.submissions.length < field.max_repeats
}

function isFieldDone(field: DatasetField, session: FieldSession): boolean {
  if (session.submissions.length === 0) return false
  if (!field.repeatable) return true
  if (field.max_repeats > 0) return session.submissions.length >= field.max_repeats
  return false // infinite — always open for more
}

// ── Location permission prompt ────────────────────────────────────────────────

type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted'; lat: number; lng: number; accuracy: number }
  | { status: 'denied' }
  | { status: 'skipped' }

function LocationPrompt({
  purpose, onResolved,
}: {
  purpose: string
  onResolved: (state: LocationState) => void
}) {
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')

  const requestLocation = () => {
    setRequesting(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setRequesting(false)
        onResolved({
          status: 'granted',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      err => {
        setRequesting(false)
        if (err.code === err.PERMISSION_DENIED) {
          setError('Location access was denied.')
          onResolved({ status: 'denied' })
        } else {
          setError('Could not get your location. Your IP will be used instead.')
          onResolved({ status: 'denied' })
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="rounded-2xl border border-amber-700/50 bg-amber-900/10 p-5 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-amber-900/50 flex items-center justify-center shrink-0">
          <MapPin size={16} className="text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-300">Location Required</p>
          <p className="text-xs text-amber-400/80 mt-0.5 leading-relaxed">
            {purpose || 'This dataset requires your location to verify where data is collected.'}
          </p>
        </div>
      </div>

      {/* How-to guide */}
      <div className="bg-black/30 rounded-xl p-3 mb-3 space-y-1.5 text-xs text-gray-400">
        <p className="font-semibold text-gray-300 text-[11px] uppercase tracking-wide mb-2">How to enable location</p>
        <p>1. Tap <strong className="text-white">Allow Location</strong> below — your browser will ask for permission.</p>
        <p>2. If blocked: open your browser <strong className="text-white">Settings → Site Settings → Location</strong> and allow this site.</p>
        <p>3. On iPhone: <strong className="text-white">Settings → Privacy → Location Services → Safari</strong> → While Using.</p>
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={requestLocation}
          disabled={requesting}
          className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
        >
          {requesting ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
          {requesting ? 'Getting location…' : 'Allow Location'}
        </button>
        <button
          onClick={() => onResolved({ status: 'skipped' })}
          className="px-4 py-2.5 rounded-xl border border-gray-700 text-gray-400 text-sm hover:text-white hover:border-gray-500 transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ── ZIP file picker overlay ───────────────────────────────────────────────────

function ZipFilePicker({
  files,
  skippedEmpty,
  skippedDuplicate,
  onConfirm,
  onClose,
}: {
  files: File[]
  skippedEmpty: number
  skippedDuplicate: number
  onConfirm: (selected: File[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(files.map((_, i) => i)))
  const [previews, setPreviews] = useState<Record<number, string>>({})

  useEffect(() => {
    const urls: Record<number, string> = {}
    files.forEach((f, i) => {
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
        urls[i] = URL.createObjectURL(f)
      }
    })
    setPreviews(urls)
    return () => { Object.values(urls).forEach(u => URL.revokeObjectURL(u)) }
  }, [files])

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(files.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <p className="text-sm font-semibold text-white">{files.length} file{files.length !== 1 ? 's' : ''} found in ZIP</p>
          <p className="text-xs text-gray-400">{selected.size} selected</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white"><X size={16} /></button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/50 shrink-0">
        <button onClick={selectAll} className="text-xs text-indigo-400 hover:text-indigo-300">Select all</button>
        <span className="text-gray-700">·</span>
        <button onClick={selectNone} className="text-xs text-gray-400 hover:text-white">Deselect all</button>
        {(skippedEmpty > 0 || skippedDuplicate > 0) && (
          <div className="ml-auto flex items-center gap-1.5">
            {skippedEmpty > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/30 border border-amber-700/40 rounded-full px-2 py-0.5">
                <AlertCircle size={9} /> {skippedEmpty} empty
              </span>
            )}
            {skippedDuplicate > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-900/30 border border-rose-700/40 rounded-full px-2 py-0.5">
                <X size={9} /> {skippedDuplicate} duplicate{skippedDuplicate > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Scrollable grid */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 scroll-smooth
        [scrollbar-width:thin] [scrollbar-color:#4b5563_transparent]
        [&::-webkit-scrollbar]:w-1.5
        [&::-webkit-scrollbar-track]:bg-transparent
        [&::-webkit-scrollbar-thumb]:bg-gray-600
        [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="grid grid-cols-2 gap-2">
          {files.map((f, i) => {
            const isSelected = selected.has(i)
            const preview = previews[i]
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                className={clsx(
                  'relative rounded-xl overflow-hidden aspect-square border-2 transition-all [touch-action:manipulation]',
                  isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-gray-700/50'
                )}
              >
                {preview ? (
                  f.type.startsWith('video/') ? (
                    <div className="w-full h-full bg-gray-900 flex items-center justify-center">
                      <Video size={22} className="text-rose-400" />
                    </div>
                  ) : (
                    <img src={preview} alt={f.name} className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-1 p-2">
                    <Upload size={18} className="text-gray-500" />
                    <span className="text-[9px] text-gray-500 text-center break-all leading-tight line-clamp-2">{f.name}</span>
                  </div>
                )}
                {isSelected && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center shadow">
                    <CheckCircle2 size={12} className="text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                  <p className="text-[8px] text-gray-300 truncate">{f.name}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 shrink-0" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <button
          onClick={() => onConfirm(files.filter((_, i) => selected.has(i)))}
          disabled={selected.size === 0}
          className="w-full py-3.5 rounded-xl bg-indigo-600 disabled:opacity-40 text-white font-semibold text-sm flex items-center justify-center gap-2 [touch-action:manipulation]"
        >
          <Upload size={15} /> Add {selected.size} file{selected.size !== 1 ? 's' : ''} to queue
        </button>
      </div>
    </div>
  )
}

// ── Consent panel + modal ─────────────────────────────────────────────────────

/** Compact chip list showing all captured consents + "Add" button. */
function ConsentPanel({
  records, activeToken, onSetActive, onNew,
}: {
  records: ConsentRecord[]
  activeToken: string | null
  onSetActive: (t: string) => void
  onNew: () => void
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-2xl border border-indigo-700/40 bg-indigo-950/30 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-900/60 flex items-center justify-center shrink-0">
            <FileText size={15} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Photo Consent Required</p>
            <p className="text-xs text-gray-400">Capture signed consent before taking photos.</p>
          </div>
        </div>
        <button
          onClick={onNew}
          className="w-full py-3 rounded-xl bg-indigo-600 active:bg-indigo-500 text-white font-semibold text-sm flex items-center justify-center gap-2 [touch-action:manipulation]"
        >
          <Plus size={14} /> Add Consent
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1">
          <ShieldCheck size={10} className="text-emerald-400" /> Consents ({records.length})
        </p>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 [touch-action:manipulation]"
        >
          <Plus size={11} /> New subject
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
        {records.map(r => {
          const isActive = r.token === activeToken
          const complete = r.status === 'complete'
          return (
            <button
              key={r.token}
              onClick={() => onSetActive(r.token)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium whitespace-nowrap shrink-0 transition-all [touch-action:manipulation]',
                isActive
                  ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200'
                  : complete
                  ? 'bg-emerald-900/20 border-emerald-800/40 text-emerald-400'
                  : 'bg-gray-800/60 border-gray-700/40 text-gray-400'
              )}
            >
              {complete ? <CheckCircle2 size={10} /> : <ShieldCheck size={10} />}
              {r.subject_name.split(' ')[0]}
              {r.consent_type === 'group' && <span className="text-[9px] opacity-60">group</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type ConsentStep = 'details' | 'method' | 'read' | 'subject_sign' | 'offline_capture' | 'collector_sign' | 'done'

/**
 * Full-screen bottom-sheet modal for capturing a consent record.
 *
 * Flow A — Sign on screen:
 *   details → method → read → subject_sign → collector_sign → done
 *
 * Flow B — Signed offline (paper):
 *   details → method → offline_capture (photo of paper form) → collector_sign → done
 */
function ConsentModal({
  collectToken, collectorName, defaultType, onDone, onClose,
}: {
  collectToken: string
  collectorName: string
  defaultType: 'individual' | 'group'
  onDone: (record: ConsentRecord) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<ConsentStep>('details')
  const [consentType, setConsentType] = useState<'individual' | 'group'>(defaultType)
  const [subjectName, setSubjectName] = useState('')
  const [subjectEmail, setSubjectEmail] = useState('')
  const [representativeName, setRepresentativeName] = useState('')
  const [signMethod, setSignMethod] = useState<'screen' | 'offline'>('screen')
  const [record, setRecord] = useState<ConsentRecord | null>(null)
  const [subjectSig, setSubjectSig] = useState('')
  const [collectorSig, setCollectorSig] = useState('')
  const [offlinePhoto, setOfflinePhoto] = useState<File | null>(null)
  const [offlinePreview, setOfflinePreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const STEP_LABELS: Record<ConsentStep, string> = {
    details: 'Subject Details',
    method: 'Signing Method',
    read: 'Review Agreement',
    subject_sign: 'Subject Signature',
    offline_capture: 'Paper Form Photo',
    collector_sign: 'Your Signature',
    done: 'Consent Captured',
  }

  const STEP_ORDER_SCREEN: ConsentStep[] = ['details', 'method', 'read', 'subject_sign', 'collector_sign', 'done']
  const STEP_ORDER_OFFLINE: ConsentStep[] = ['details', 'method', 'offline_capture', 'collector_sign', 'done']
  const stepOrder = signMethod === 'offline' ? STEP_ORDER_OFFLINE : STEP_ORDER_SCREEN
  const stepIdx = stepOrder.indexOf(step)

  async function initiateRecord() {
    setBusy(true); setErr('')
    try {
      const r = await consentApi.initiate(collectToken, {
        subject_name: subjectName.trim(),
        subject_email: subjectEmail.trim() || undefined,
        representative_name: representativeName.trim() || undefined,
        consent_type: consentType,
      })
      setRecord(r)
      return r
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to start consent')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function goNext() {
    setErr('')
    if (step === 'details') {
      if (!subjectName.trim()) { setErr('Subject name is required'); return }
      setStep('method')
      return
    }
    if (step === 'method') {
      const r = await initiateRecord()
      if (!r) return
      setStep(signMethod === 'offline' ? 'offline_capture' : 'read')
      return
    }
    if (step === 'read') { setStep('subject_sign'); return }

    if (step === 'subject_sign') {
      if (!subjectSig) { setErr('Draw a signature first'); return }
      if (!record) return
      setBusy(true)
      try {
        const updated = await consentApi.sign(record.token, {
          role: 'subject',
          signature_data: subjectSig,
          signer_name: record.subject_name,
          signer_email: record.subject_email,
        })
        setRecord(updated)
        setStep('collector_sign')
      } catch (e: any) {
        setErr(e?.response?.data?.detail || e?.message || 'Failed to save signature')
      } finally {
        setBusy(false)
      }
      return
    }

    if (step === 'offline_capture') {
      if (!offlinePhoto) { setErr('Take or upload a photo of the signed form'); return }
      if (!record) return
      setBusy(true)
      try {
        const updated = await consentApi.signOfflinePhoto(record.token, offlinePhoto, collectorName)
        setRecord(updated)
        setStep('collector_sign')
      } catch (e: any) {
        setErr(e?.response?.data?.detail || e?.message || 'Failed to upload photo')
      } finally {
        setBusy(false)
      }
      return
    }

    if (step === 'collector_sign') {
      if (!collectorSig) { setErr('Draw your signature first'); return }
      if (!record) return
      setBusy(true)
      try {
        const updated = await consentApi.sign(record.token, {
          role: 'collector',
          signature_data: collectorSig,
          signer_name: collectorName,
        })
        setRecord(updated)
        setStep('done')
      } catch (e: any) {
        setErr(e?.response?.data?.detail || e?.message || 'Failed to save signature')
      } finally {
        setBusy(false)
      }
      return
    }

    if (step === 'done' && record) {
      onDone(record)
    }
  }

  const handleOfflineFile = (file: File) => {
    setOfflinePhoto(file)
    setOfflinePreview(URL.createObjectURL(file))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060810]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={stepIdx > 0 && step !== 'done' ? () => setStep(stepOrder[stepIdx - 1]) : onClose}
          className="p-2 rounded-full bg-white/10 text-white [touch-action:manipulation]"
        >
          {stepIdx > 0 && step !== 'done' ? <ChevronLeft size={16} /> : <X size={16} />}
        </button>
        <div className="flex-1">
          <p className="text-xs text-gray-400">Consent {stepIdx + 1}/{stepOrder.length}</p>
          <p className="text-sm font-semibold text-white">{STEP_LABELS[step]}</p>
        </div>
        {/* Progress dots */}
        <div className="flex gap-1">
          {stepOrder.map((s, i) => (
            <div key={s} className={clsx(
              'w-1.5 h-1.5 rounded-full transition-colors',
              i < stepIdx ? 'bg-emerald-500' : i === stepIdx ? 'bg-indigo-400' : 'bg-gray-700'
            )} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 space-y-4">

        {/* ── Step: Subject Details ── */}
        {step === 'details' && (
          <>
            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              {(['individual', 'group'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setConsentType(t)}
                  className={clsx(
                    'py-3 rounded-xl border text-sm font-medium transition-all [touch-action:manipulation]',
                    consentType === t
                      ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200'
                      : 'bg-gray-800/60 border-gray-700/40 text-gray-400'
                  )}
                >
                  {t === 'individual' ? '👤 Individual' : '👥 Group'}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                {consentType === 'group' ? 'Group Name *' : 'Subject Full Name *'}
              </label>
              <input
                autoFocus
                type="text"
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-[16px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder={consentType === 'group' ? 'e.g. Class 4B' : 'Full name'}
                value={subjectName}
                onChange={e => setSubjectName(e.target.value)}
              />
            </div>
            {consentType === 'group' && (
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Representative Name</label>
                <input
                  type="text"
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-[16px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Person signing on behalf of group"
                  value={representativeName}
                  onChange={e => setRepresentativeName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                Email <span className="text-gray-600 font-normal normal-case">(optional — send signing link)</span>
              </label>
              <input
                type="email"
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 text-[16px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="subject@example.com"
                value={subjectEmail}
                onChange={e => setSubjectEmail(e.target.value)}
              />
            </div>
          </>
        )}

        {/* ── Step: Signing Method ── */}
        {step === 'method' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">How will <strong className="text-white">{subjectName}</strong> sign the consent?</p>
            <button
              onClick={() => setSignMethod('screen')}
              className={clsx(
                'w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all [touch-action:manipulation]',
                signMethod === 'screen'
                  ? 'bg-indigo-900/30 border-indigo-500/60'
                  : 'bg-gray-800/50 border-gray-700/40'
              )}
            >
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                signMethod === 'screen' ? 'bg-indigo-700/60' : 'bg-gray-700/60')}>
                <UserCheck size={18} className={signMethod === 'screen' ? 'text-indigo-300' : 'text-gray-400'} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Sign on screen</p>
                <p className="text-xs text-gray-400 mt-0.5">Subject draws their signature on this device.</p>
              </div>
              {signMethod === 'screen' && <CheckCircle2 size={16} className="text-indigo-400 ml-auto shrink-0" />}
            </button>
            <button
              onClick={() => setSignMethod('offline')}
              className={clsx(
                'w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all [touch-action:manipulation]',
                signMethod === 'offline'
                  ? 'bg-amber-900/20 border-amber-700/50'
                  : 'bg-gray-800/50 border-gray-700/40'
              )}
            >
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                signMethod === 'offline' ? 'bg-amber-900/60' : 'bg-gray-700/60')}>
                <Camera size={18} className={signMethod === 'offline' ? 'text-amber-300' : 'text-gray-400'} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Signed offline (paper)</p>
                <p className="text-xs text-gray-400 mt-0.5">Subject signed a paper form — take a photo as proof.</p>
              </div>
              {signMethod === 'offline' && <CheckCircle2 size={16} className="text-amber-400 ml-auto shrink-0" />}
            </button>
          </div>
        )}

        {/* ── Step: Read agreement ── */}
        {step === 'read' && record && (
          <div className="bg-gray-950/60 border border-gray-700/40 rounded-xl p-4 max-h-[55vh] overflow-y-auto">
            <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{record.rendered_body}</pre>
          </div>
        )}

        {/* ── Step: Subject signs on screen ── */}
        {step === 'subject_sign' && record && (
          <>
            <p className="text-xs text-gray-400">
              Ask <strong className="text-white">{record.subject_name}</strong> to draw their signature below.
            </p>
            <SignaturePad onSignature={setSubjectSig} height={180} label="Subject signs here" />
            {record.subject_email && (
              <p className="text-[11px] text-gray-500 text-center">
                A signing link was also emailed to {record.subject_email}
              </p>
            )}
          </>
        )}

        {/* ── Step: Offline photo capture ── */}
        {step === 'offline_capture' && (
          <>
            <p className="text-xs text-gray-400">
              Take a photo of the signed paper consent form for <strong className="text-white">{subjectName}</strong>.
            </p>
            {offlinePreview ? (
              <div className="relative">
                <img src={offlinePreview} alt="consent form" className="w-full rounded-xl border border-gray-700 object-contain max-h-72" />
                <button
                  onClick={() => { setOfflinePhoto(null); setOfflinePreview('') }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center">
                <Camera size={28} className="mx-auto text-gray-600 mb-2" />
                <p className="text-xs text-gray-500">No photo captured</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-700/30 border border-indigo-600/40 text-indigo-300 text-sm [touch-action:manipulation]"
              >
                <Camera size={15} /> Take Photo
              </button>
              <button
                onClick={() => uploadRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 border border-gray-700/60 text-gray-300 text-sm [touch-action:manipulation]"
              >
                <Upload size={15} /> Upload
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleOfflineFile(e.target.files[0]) }} />
            <input ref={uploadRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleOfflineFile(e.target.files[0]) }} />
          </>
        )}

        {/* ── Step: Collector signature ── */}
        {step === 'collector_sign' && (
          <>
            <p className="text-xs text-gray-400">
              You ({collectorName}) confirm you witnessed the signing.
            </p>
            <SignaturePad onSignature={setCollectorSig} height={180} label="Your signature here" />
          </>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-16 h-16 rounded-full bg-emerald-900/40 border-2 border-emerald-700/50 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-white">Consent Captured</p>
              <p className="text-sm text-gray-400 mt-1">
                {signMethod === 'offline' ? 'Paper form photo recorded.' : 'Both parties have signed.'} You can now take photos.
              </p>
            </div>
          </div>
        )}

        {err && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} /> {err}</p>}
      </div>

      {/* Footer CTA */}
      <div className="px-4 py-4 border-t border-gray-800 shrink-0" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <button
          onClick={goNext}
          disabled={busy}
          className={clsx(
            'w-full py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 [touch-action:manipulation]',
            step === 'done' ? 'bg-emerald-600 active:bg-emerald-500' : 'bg-indigo-600 active:bg-indigo-500'
          )}
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Please wait…</> :
           step === 'done' ? <><Camera size={15} /> Start Collecting</> :
           step === 'read' ? <><CheckCircle2 size={15} /> Understood — proceed to sign</> :
           step === 'subject_sign' ? <><CheckCircle2 size={15} /> {subjectSig ? 'Confirm Subject Signature' : 'Draw signature above first'}</> :
           step === 'offline_capture' ? <><Upload size={15} /> {offlinePhoto ? 'Use this photo' : 'Photo required'}</> :
           step === 'collector_sign' ? <><UserCheck size={15} /> {collectorSig ? 'Confirm My Signature' : 'Draw signature above first'}</> :
           'Continue →'}
        </button>
      </div>
    </div>
  )
}

// ── Field card ────────────────────────────────────────────────────────────────

function FieldCard({
  field, session, token, locationState,
  onSubmitted, consentRecordId,
}: {
  field: DatasetField
  session: FieldSession
  token: string
  locationState: LocationState
  onSubmitted: (entry: DatasetEntry, preview: string | null) => void
  consentRecordId?: string | null
}) {
  const [showCamera, setShowCamera] = useState(false)
  const [showVideoCapture, setShowVideoCapture] = useState(false)
  const [showUploadMenu, setShowUploadMenu] = useState(false)
  const [showZipPicker, setShowZipPicker] = useState(false)
  const [zipCandidates, setZipCandidates] = useState<File[]>([])
  const [zipSkippedEmpty, setZipSkippedEmpty] = useState(0)
  const [zipSkippedDuplicate, setZipSkippedDuplicate] = useState(0)
  const [fileQueue, setFileQueue] = useState<File[]>([])
  const [queueProgress, setQueueProgress] = useState<{ done: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  // Accumulated SHA-256 hashes of every file successfully submitted for this field
  const submittedHashesRef = useRef<Set<string>>(new Set())
  const [local, setLocal] = useState<FieldSession>(session)
  const set = (patch: Partial<FieldSession>) => setLocal(s => ({ ...s, ...patch }))

  const { upload: uploadMultipart } = useMultipartUpload({
    onProgress: (pct) => set({ uploadProgress: pct }),
  })

  // Reset active capture when a new repeat begins (submissions array grows)
  useEffect(() => {
    setLocal(s => ({ ...s, submissions: session.submissions }))
  }, [session.submissions.length])  // eslint-disable-line

  const pickFile = (file: File) => {
    const preview = (file.type.startsWith('image/') || file.type.startsWith('video/'))
      ? URL.createObjectURL(file)
      : null
    set({ file, preview, error: '' })
  }

  // Determine which MIME types are acceptable for a given field type
  const acceptedMimePattern = (type: string) => {
    if (type === 'image') return (f: File) => f.type.startsWith('image/')
    if (type === 'video') return (f: File) => f.type.startsWith('video/')
    if (type === 'media') return (f: File) => f.type.startsWith('image/') || f.type.startsWith('video/')
    return (_f: File) => true  // file type: accept all
  }

  const handleZipPick = async (zipFile: File) => {
    try {
      const zip = await JSZip.loadAsync(zipFile)
      const matcher = acceptedMimePattern(field.type)
      const candidates: { file: File; hash: string }[] = []
      let emptyCount = 0
      const promises: Promise<void>[] = []
      zip.forEach((relativePath, entry) => {
        if (entry.dir) return
        const name = relativePath.split('/').pop() || relativePath
        if (name.startsWith('.')) return
        promises.push(
          entry.async('blob').then(async blob => {
            const ext = name.split('.').pop()?.toLowerCase() || ''
            const mime = {
              jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
              gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
              mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
              avi: 'video/x-msvideo', mkv: 'video/x-matroska',
            }[ext] || blob.type || 'application/octet-stream'
            const file = new File([blob], name, { type: mime })
            if (!matcher(file)) return
            if (blob.size === 0) { emptyCount++; return }
            const hash = await sha256(file)
            candidates.push({ file, hash })
          })
        )
      })
      await Promise.all(promises)
      candidates.sort((a, b) => a.file.name.localeCompare(b.file.name))

      // Deduplicate: reject files whose hash matches already-submitted files or each other
      let dupCount = 0
      const seenInBatch = new Set<string>()
      const unique: File[] = []
      for (const { file, hash } of candidates) {
        if (submittedHashesRef.current.has(hash) || seenInBatch.has(hash)) {
          dupCount++
        } else {
          seenInBatch.add(hash)
          unique.push(file)
        }
      }

      if (unique.length === 0) {
        const parts = []
        if (emptyCount) parts.push(`${emptyCount} empty`)
        if (dupCount) parts.push(`${dupCount} duplicate${dupCount > 1 ? 's' : ''}`)
        set({ error: `No new ${field.type} files found in the ZIP.${parts.length ? ` (${parts.join(', ')} skipped)` : ''}` })
        return
      }
      setZipSkippedEmpty(emptyCount)
      setZipSkippedDuplicate(dupCount)
      setZipCandidates(unique)
      setShowZipPicker(true)
    } catch {
      set({ error: 'Failed to read ZIP file.' })
    }
  }

  const handleZipConfirm = (selected: File[]) => {
    setShowZipPicker(false)
    setZipCandidates([])
    setZipSkippedEmpty(0)
    setZipSkippedDuplicate(0)
    if (selected.length === 0) return
    if (selected.length === 1) {
      pickFile(selected[0])
    } else {
      setFileQueue(selected)
    }
  }

  const handleMultiFilePick = async (files: FileList) => {
    const arr = Array.from(files)
    const seenInBatch = new Set<string>()
    const unique: File[] = []
    let dupCount = 0
    for (const file of arr) {
      const hash = await sha256(file)
      if (submittedHashesRef.current.has(hash) || seenInBatch.has(hash)) {
        dupCount++
      } else {
        seenInBatch.add(hash)
        unique.push(file)
      }
    }
    if (unique.length === 0) {
      set({ error: `All ${dupCount} file${dupCount > 1 ? 's' : ''} already submitted.` })
      return
    }
    if (dupCount > 0) set({ error: `${dupCount} duplicate file${dupCount > 1 ? 's' : ''} skipped.` })
    if (unique.length === 1) {
      pickFile(unique[0])
    } else {
      setFileQueue(unique)
    }
  }

  // Submit all files in the queue sequentially
  const submitQueue = useCallback(async (queue: File[]) => {
    setQueueProgress({ done: 0, total: queue.length })
    const gps = locationState.status === 'granted' ? locationState : null
    for (let i = 0; i < queue.length; i++) {
      setQueueProgress({ done: i, total: queue.length })
      const file = queue[i]
      const preview = (file.type.startsWith('image/') || file.type.startsWith('video/'))
        ? URL.createObjectURL(file)
        : null
      try {
        const useMultipart = file.size > 5 * 1024 * 1024 || file.type.startsWith('video/')
        let entry: DatasetEntry
        if (useMultipart) {
          entry = await uploadMultipart(token, field.id, file, {
            description: local.description || undefined,
            lat: gps?.lat, lng: gps?.lng, accuracy: gps?.accuracy,
            consent_record_id: consentRecordId || undefined,
          } as any)
        } else {
          entry = await collectApi.submit(
            token, field.id, file,
            undefined,
            local.description || undefined,
            gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
            consentRecordId || null,
          )
        }
        sha256(file).then(h => submittedHashesRef.current.add(h))
        onSubmitted(entry, preview)
      } catch (e: any) {
        set({ error: `Failed on "${file.name}": ${e?.message || 'Upload error'}` })
        break
      }
    }
    setFileQueue([])
    setQueueProgress(null)
  }, [field.id, token, local.description, locationState, uploadMultipart, onSubmitted, consentRecordId])  // eslint-disable-line

  // Auto-start queue submission when fileQueue is populated
  useEffect(() => {
    if (fileQueue.length > 0 && !queueProgress) {
      submitQueue(fileQueue)
    }
  }, [fileQueue])  // eslint-disable-line

  const submit = async () => {
    if (['image', 'video', 'media', 'file'].includes(field.type) && !local.file && field.required) {
      set({ error: 'Please capture or upload a file.' }); return
    }
    if ((field.type === 'text' || field.type === 'number') && !local.textValue.trim() && field.required) {
      set({ error: 'This field is required.' }); return
    }
    if (field.description_required && !local.description.trim()) {
      set({ error: 'Description is required for this field.' }); return
    }
    set({ submitting: true, error: '', uploadProgress: 0 })
    try {
      const gps = locationState.status === 'granted' ? locationState : null
      let entry: DatasetEntry

      const useMultipart = local.file && (
        local.file.size > 5 * 1024 * 1024 ||
        local.file.type.startsWith('video/')
      )

      if (useMultipart && local.file) {
        entry = await uploadMultipart(token, field.id, local.file, {
          description: local.description || undefined,
          lat: gps?.lat,
          lng: gps?.lng,
          accuracy: gps?.accuracy,
          consent_record_id: consentRecordId || undefined,
        } as any)
      } else {
        entry = await collectApi.submit(
          token, field.id,
          local.file,
          (field.type === 'text' || field.type === 'number') ? local.textValue : undefined,
          local.description || undefined,
          gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
          consentRecordId || null,
        )
      }

      const preview = local.preview
      if (local.file) sha256(local.file).then(h => submittedHashesRef.current.add(h))
      // reset active capture for next repeat
      set({ file: null, preview: null, textValue: '', description: '', submitting: false, error: '', uploadProgress: 0 })
      onSubmitted(entry, preview)
    } catch (e: any) {
      set({ submitting: false, error: e?.message || 'Submission failed. Try again.' })
    }
  }

  const done = isFieldDone(field, session)
  const addMore = canAddMore(field, session)
  const count = session.submissions.length
  const cap = field.max_repeats > 0 ? field.max_repeats : null

  return (
    <div className="rounded-2xl border border-gray-700/60 bg-gray-800/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
            field.type === 'image' ? 'bg-sky-900/60'
            : field.type === 'video' ? 'bg-rose-900/60'
            : field.type === 'media' ? 'bg-violet-900/60'
            : field.type === 'file' ? 'bg-purple-900/60'
            : 'bg-gray-700/60')}>
            {field.type === 'image' ? <ImageIcon size={16} className="text-sky-400" />
            : field.type === 'video' ? <Video size={16} className="text-rose-400" />
            : field.type === 'media' ? <Film size={16} className="text-violet-400" />
            : field.type === 'file' ? <Upload size={16} className="text-purple-400" />
            : <span className="text-xs text-gray-400">T</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-white leading-snug">{field.label}</p>
              {field.repeatable && (
                <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-900/30 border border-indigo-800/40 rounded-full px-2 py-0.5">
                  <Repeat2 size={9} /> {cap ? `up to ${cap}×` : '∞'}
                </span>
              )}
            </div>
            {field.instruction && (
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{field.instruction}</p>
            )}
          </div>
          {field.required && <span className="text-[10px] text-red-400 font-semibold shrink-0 mt-1">Required</span>}
        </div>
      </div>

      {/* Thumbnails of past repeats */}
      {count > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-[11px] text-emerald-400 font-semibold">
              {count}{cap ? `/${cap}` : ''} captured
            </span>
            {session.submissions[0]?.entry.points_awarded > 0 && (
              <span className="text-[10px] text-amber-400 flex items-center gap-0.5 ml-auto">
                <Star size={9} fill="currentColor" /> +{count * session.submissions[0].entry.points_awarded} pts
              </span>
            )}
          </div>
          {session.submissions.some(s => s.preview) && (
            <div className="grid grid-rows-2 grid-flow-col auto-cols-[3.5rem] gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {session.submissions.map((s, i) => s.preview ? (
                s.entry.file_mime?.startsWith('video/') ? (
                  <div key={i} className="w-14 h-14 rounded-xl bg-black border border-emerald-800/40 flex items-center justify-center overflow-hidden shrink-0">
                    <Video size={20} className="text-rose-400" />
                  </div>
                ) : (
                  <img key={i} src={s.preview} alt={`capture ${i + 1}`}
                    className="w-14 h-14 rounded-xl object-cover border border-emerald-800/40 shrink-0" />
                )
              ) : (
                <div key={i} className="w-14 h-14 rounded-xl bg-emerald-900/20 border border-emerald-800/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Capture form — shown when more can be added */}
      {addMore && (
        <div className="px-4 pb-4 space-y-3">
          {count > 0 && (
            <p className="text-[11px] text-indigo-400 font-semibold flex items-center gap-1.5">
              <Plus size={11} /> Add another capture
            </p>
          )}

          {['image', 'video', 'media', 'file'].includes(field.type) && (() => {
            const isVideoFile = local.file?.type.startsWith('video/')
            const acceptAttr = field.type === 'image' ? 'image/*'
              : field.type === 'video' ? 'video/*'
              : field.type === 'media' ? 'image/*,video/*'
              : '*/*'
            // For media: count of camera buttons determines grid cols
            const showPhotoBtn = field.type !== 'video' && (field.capture_mode === 'camera_only' || field.capture_mode === 'both')
            const showVideoBtn = (field.type === 'video' || field.type === 'media') && (field.capture_mode === 'camera_only' || field.capture_mode === 'both')
            const showUploadBtn = field.capture_mode === 'upload_only' || field.capture_mode === 'both'
            return (
              <>
                {local.preview ? (
                  <div className="relative">
                    {isVideoFile ? (
                      <video src={local.preview} controls className="w-full max-h-52 rounded-xl border border-gray-600/50 bg-black" />
                    ) : (
                      <img src={local.preview} alt="Preview" className="w-full h-52 object-cover rounded-xl border border-gray-600/50" />
                    )}
                    <button onClick={() => set({ file: null, preview: null })}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80">
                      <X size={14} />
                    </button>
                  </div>
                ) : local.file ? (
                  <div className="flex items-center gap-3 bg-gray-700/50 rounded-xl px-3 py-3">
                    <Upload size={18} className="text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-300 truncate flex-1">{local.file.name}</span>
                    <button onClick={() => set({ file: null })} className="text-gray-500 hover:text-white"><X size={14} /></button>
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-gray-600/50 bg-gray-800/30 p-6 text-center">
                    {field.type === 'video' ? <Video size={28} className="text-gray-600 mx-auto mb-2" />
                      : field.type === 'media' ? <Film size={28} className="text-gray-600 mx-auto mb-2" />
                      : <ImageIcon size={28} className="text-gray-600 mx-auto mb-2" />}
                    <p className="text-xs text-gray-500">
                      {field.type === 'video' ? 'No video selected'
                        : field.type === 'media' ? 'No image or video selected'
                        : field.type === 'image' ? 'No image selected'
                        : 'No file selected'}
                    </p>
                  </div>
                )}

                {/* Single upload button with drop-up menu */}
                <div className="relative">
                  <button
                    onClick={() => setShowUploadMenu(m => !m)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-indigo-600/20 active:bg-indigo-600/30 border border-indigo-600/30 text-indigo-300 text-sm font-medium transition-colors [touch-action:manipulation]"
                  >
                    <Upload size={16} />
                    Upload
                    <ChevronUp size={14} className={clsx('transition-transform duration-200', showUploadMenu ? '' : 'rotate-180')} />
                  </button>

                  {showUploadMenu && (
                    <>
                      {/* backdrop */}
                      <div className="fixed inset-0 z-10" onClick={() => setShowUploadMenu(false)} />
                      {/* drop-up panel */}
                      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-gray-850 bg-gray-900 border border-gray-700/60 rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
                        {showPhotoBtn && (
                          <button
                            onClick={() => { setShowUploadMenu(false); setShowCamera(true) }}
                            className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-700/60 text-left [touch-action:manipulation]"
                          >
                            <div className="w-8 h-8 rounded-xl bg-sky-900/60 flex items-center justify-center shrink-0">
                              <Camera size={15} className="text-sky-400" />
                            </div>
                            <span className="text-sm font-medium text-white">Take Photo</span>
                          </button>
                        )}
                        {showVideoBtn && (
                          <button
                            onClick={() => { setShowUploadMenu(false); setShowVideoCapture(true) }}
                            className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-700/60 text-left border-t border-gray-700/40 [touch-action:manipulation]"
                          >
                            <div className="w-8 h-8 rounded-xl bg-rose-900/60 flex items-center justify-center shrink-0">
                              <Video size={15} className="text-rose-400" />
                            </div>
                            <span className="text-sm font-medium text-white">Record Video</span>
                          </button>
                        )}
                        {showUploadBtn && (
                          <>
                            <button
                              onClick={() => { setShowUploadMenu(false); fileInputRef.current?.click() }}
                              className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-700/60 text-left border-t border-gray-700/40 [touch-action:manipulation]"
                            >
                              <div className="w-8 h-8 rounded-xl bg-purple-900/60 flex items-center justify-center shrink-0">
                                {field.type === 'video' ? <Film size={15} className="text-purple-400" /> : <ImageIcon size={15} className="text-purple-400" />}
                              </div>
                              <span className="text-sm font-medium text-white">
                                {field.type === 'image' ? 'Choose Images' : field.type === 'video' ? 'Choose Videos' : field.type === 'media' ? 'Choose Images / Videos' : 'Choose Files'}
                              </span>
                            </button>
                            <button
                              onClick={() => { setShowUploadMenu(false); zipInputRef.current?.click() }}
                              className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-700/60 text-left border-t border-gray-700/40 [touch-action:manipulation]"
                            >
                              <div className="w-8 h-8 rounded-xl bg-amber-900/60 flex items-center justify-center shrink-0">
                                <FolderArchive size={15} className="text-amber-400" />
                              </div>
                              <span className="text-sm font-medium text-white">ZIP Folder</span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  <input ref={fileInputRef} type="file" accept={acceptAttr} multiple
                    className="hidden" onChange={e => { if (e.target.files && e.target.files.length > 0) { handleMultiFilePick(e.target.files); e.target.value = '' } }} />
                  <input ref={zipInputRef} type="file" accept=".zip,application/zip"
                    className="hidden" onChange={e => { if (e.target.files?.[0]) { handleZipPick(e.target.files[0]); e.target.value = '' } }} />
                </div>
              </>
            )
          })()}

          {field.type === 'text' && (
            <textarea rows={3}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-[16px] leading-snug text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Type your response here…"
              value={local.textValue}
              onChange={e => set({ textValue: e.target.value })} />
          )}

          {field.type === 'number' && (
            <input type="number"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-[16px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              placeholder="Enter a number"
              value={local.textValue}
              onChange={e => set({ textValue: e.target.value })} />
          )}

          {field.description_mode !== 'none' && (
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5 block">
                Description {field.description_required && <span className="text-red-400">*</span>}
              </label>
              {field.description_mode === 'free_text' ? (
                <textarea rows={2}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-[16px] leading-snug text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                  placeholder="Describe what you see…"
                  value={local.description}
                  onChange={e => set({ description: e.target.value })} />
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {field.description_presets.map(p => (
                    <button key={p} onClick={() => set({ description: p })}
                      className={clsx('py-2 px-3 rounded-xl border text-sm text-left transition-colors active:scale-[0.98]',
                        local.description === p
                          ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300 font-medium'
                          : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:border-gray-600')}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {local.error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={12} /> {local.error}
            </p>
          )}

          {queueProgress && (
            <div className="rounded-xl bg-gray-800/50 border border-gray-700/40 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-indigo-300 font-medium flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Uploading batch…
                </span>
                <span className="text-xs text-gray-400">{queueProgress.done}/{queueProgress.total}</span>
              </div>
              <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${queueProgress.total > 0 ? (queueProgress.done / queueProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          <button onClick={submit} disabled={local.submitting || !!queueProgress}
            className={clsx(
              'w-full py-3.5 rounded-xl disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors [touch-action:manipulation]',
              count > 0 ? 'bg-indigo-700 active:bg-indigo-600' : 'bg-indigo-600 active:bg-indigo-500',
            )}>
            {local.submitting
              ? local.uploadProgress > 0
                ? <><Loader2 size={16} className="animate-spin" /> Uploading {local.uploadProgress}%</>
                : <><Loader2 size={16} className="animate-spin" /> Submitting…</>
              : count > 0
              ? <><Plus size={15} /> Submit Another</>
              : 'Submit'}
          </button>
        </div>
      )}

      {/* Done state for non-repeatable / capped fields */}
      {done && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 text-emerald-400 bg-emerald-900/20 border border-emerald-800/30 rounded-xl px-4 py-2.5">
            <CheckCircle2 size={14} className="shrink-0" />
            <span className="text-xs font-semibold">
              {field.repeatable ? `All ${count} captures submitted ✓` : 'Submitted ✓'}
            </span>
          </div>
        </div>
      )}

      {showCamera && (
        <CameraCapture
          onCapture={file => { pickFile(file); setShowCamera(false) }}
          onClose={() => setShowCamera(false)}
        />
      )}
      {showVideoCapture && (
        <VideoCapture
          onCapture={file => { pickFile(file); setShowVideoCapture(false) }}
          onClose={() => setShowVideoCapture(false)}
        />
      )}
      {showZipPicker && (
        <ZipFilePicker
          files={zipCandidates}
          skippedEmpty={zipSkippedEmpty}
          skippedDuplicate={zipSkippedDuplicate}
          onConfirm={handleZipConfirm}
          onClose={() => { setShowZipPicker(false); setZipCandidates([]); setZipSkippedEmpty(0); setZipSkippedDuplicate(0) }}
        />
      )}
    </div>
  )
}

// ── Main CollectPage ──────────────────────────────────────────────────────────

export default function CollectPage({ token }: { token: string }) {
  const [form, setForm] = useState<CollectFormDefinition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState<Record<string, FieldSession>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [finished, setFinished] = useState(false)
  const [locationState, setLocationState] = useState<LocationState>({ status: 'idle' })
  const [locationResolved, setLocationResolved] = useState(false)

  // Consent state — supports multiple consent records per session
  const [consentRecords, setConsentRecords] = useState<ConsentRecord[]>([])
  const [activeConsentToken, setActiveConsentToken] = useState<string | null>(null)
  const [showConsentModal, setShowConsentModal] = useState(false)

  useEffect(() => {
    collectApi.getForm(token)
      .then(f => {
        setForm(f)
        const init: Record<string, FieldSession> = {}
        f.dataset.fields.forEach(field => { init[field.id] = blankSession() })
        setSessions(init)
        if (!f.dataset.require_location) {
          setLocationResolved(true)
        } else {
          // If browser has already granted geolocation, get it silently — no prompt needed
          if ('permissions' in navigator) {
            navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(status => {
              if (status.state === 'granted') {
                navigator.geolocation.getCurrentPosition(
                  pos => {
                    setLocationState({ status: 'granted', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
                    setLocationResolved(true)
                  },
                  () => {}, // fallback: show prompt
                )
              }
            }).catch(() => {})
          }
        }
      })
      .catch(e => setError(e?.message || 'Failed to load collection form.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleLocationResolved = (state: LocationState) => {
    setLocationState(state)
    setLocationResolved(true)
  }

  const handleSubmitted = (fieldId: string, entry: DatasetEntry, preview: string | null) => {
    setSessions(prev => {
      const existing = prev[fieldId] ?? blankSession()
      return {
        ...prev,
        [fieldId]: {
          ...existing,
          submissions: [...existing.submissions, { preview, entry }],
        },
      }
    })
    // auto-advance to next field only if non-repeatable and not already at end
    const field = form?.dataset.fields.find(f => f.id === fieldId)
    if (field && !field.repeatable && form) {
      const idx = form.dataset.fields.findIndex(f => f.id === fieldId)
      if (idx < form.dataset.fields.length - 1) {
        setTimeout(() => setCurrentIdx(idx + 1), 500)
      }
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

  // submissions in this browser session only
  const totalSubmissions = Object.values(sessions).reduce((n, s) => n + s.submissions.length, 0)
  // all-time total including prior visits
  const totalEver = (collector.entry_count ?? 0) + totalSubmissions
  // total points earned this session
  const pointsThisSession = Object.values(sessions)
    .reduce((n, s) => n + s.submissions.reduce((m, sub) => m + sub.entry.points_awarded, 0), 0)
  // required fields with at least one submission
  const requiredDone = fields.filter(f => f.required).every(f => (sessions[f.id]?.submissions.length ?? 0) > 0)
  // overall progress (fields with ≥1 submission / total fields)
  const fieldsWithEntry = fields.filter(f => (sessions[f.id]?.submissions.length ?? 0) > 0).length
  const progress = fields.length > 0 ? (fieldsWithEntry / fields.length) * 100 : 0

  if (finished) {
    const loggedIn = getLoggedInAnnotator()
    const totalPoints = collector.points_earned + pointsThisSession
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-sm w-full">
          <div className="w-20 h-20 rounded-full bg-emerald-900/40 border-2 border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">All done! 🎉</h2>
          <p className="text-sm text-gray-400 mb-1">
            Thank you for contributing to <strong className="text-white">{dataset.name}</strong>.
          </p>
          <p className="text-xs text-gray-500 mb-5">{totalEver} submission{totalEver !== 1 ? 's' : ''} recorded.</p>

          {dataset.points_enabled && totalPoints > 0 && (
            <div className="space-y-4 w-full">
              <div className="inline-flex items-center gap-2 bg-amber-900/30 border border-amber-800/40 rounded-full px-5 py-2.5">
                <Star size={16} className="text-amber-400" fill="currentColor" />
                <span className="text-sm font-semibold text-amber-300">{totalPoints} points earned</span>
              </div>

              {loggedIn ? (
                /* Already logged in — go straight to portal */
                <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-2xl p-4 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck size={15} className="text-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-200">Signed in as {loggedIn.name}</p>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    Your points have been added to your account. View your balance and redeem for airtime.
                  </p>
                  <a
                    href="/"
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                  >
                    View Rewards Portal →
                  </a>
                </div>
              ) : (
                /* Not logged in — prompt to claim */
                <div className="bg-indigo-900/20 border border-indigo-800/40 rounded-2xl p-4 text-left">
                  <p className="text-sm font-semibold text-indigo-200 mb-1">🎁 Claim your rewards!</p>
                  <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                    Create an account to track your points and redeem airtime — no extra verification needed, your email is already confirmed.
                  </p>
                  <a
                    href={`/claim/${token}`}
                    className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                  >
                    Claim Rewards →
                  </a>
                </div>
              )}
            </div>
          )}

          {dataset.points_enabled && totalPoints === 0 && !loggedIn && (
            <a href={`/claim/${token}`} className="text-xs text-indigo-400 underline">
              Access your portal →
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[#060810] text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-[#060810]/95 backdrop-blur border-b border-gray-800/50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 truncate">Hi {collector.name}</p>
              <h1 className="text-sm font-bold text-white truncate">{dataset.name}</h1>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">{fieldsWithEntry}/{fields.length} fields</p>
              {dataset.points_enabled && (
                <p className="text-xs text-amber-400 flex items-center gap-1 justify-end">
                  <Star size={10} fill="currentColor" /> {collector.points_earned + pointsThisSession} pts
                </p>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
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

        {dataset.description && (
          <p className="text-sm text-gray-400 leading-relaxed">{dataset.description}</p>
        )}

        {/* Field tabs */}
        {fields.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
            {fields.map((f, i) => {
              const count = sessions[f.id]?.submissions.length ?? 0
              const done = isFieldDone(f, sessions[f.id] ?? blankSession())
              return (
                <button key={f.id} onClick={() => setCurrentIdx(i)}
                  className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors shrink-0 [touch-action:manipulation]',
                    i === currentIdx
                      ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                      : done
                      ? 'bg-emerald-900/30 border border-emerald-800/40 text-emerald-400'
                      : count > 0
                      ? 'bg-indigo-900/20 border border-indigo-800/30 text-indigo-400'
                      : 'bg-gray-800/50 border border-gray-700/40 text-gray-500')}>
                  {done ? <CheckCircle2 size={10} /> : count > 0 ? <span className="text-[9px] font-bold">{count}×</span> : null}
                  {f.label.slice(0, 20)}{f.label.length > 20 ? '…' : ''}
                </button>
              )
            })}
          </div>
        )}

        {/* Location permission prompt — shown before fields if required and not yet resolved */}
        {form?.dataset.require_location && !locationResolved && (
          <LocationPrompt
            purpose={form.dataset.location_purpose}
            onResolved={handleLocationResolved}
          />
        )}

        {/* Location status badge — once resolved */}
        {locationResolved && form?.dataset.require_location && (
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-2 text-xs font-medium ${
            locationState.status === 'granted'
              ? 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-400'
              : 'bg-gray-800/50 border border-gray-700/40 text-gray-400'
          }`}>
            {locationState.status === 'granted'
              ? <><ShieldCheck size={12} /> Location enabled — GPS coordinates will be attached</>
              : <><MapPin size={12} /> Location skipped — your approximate IP location will be used</>
            }
          </div>
        )}

        {/* Consent management panel */}
        {locationResolved && dataset.require_consent && (
          <ConsentPanel
            records={consentRecords}
            activeToken={activeConsentToken}
            onSetActive={setActiveConsentToken}
            onNew={() => setShowConsentModal(true)}
          />
        )}

        {/* Consent modal — bottom sheet */}
        {showConsentModal && (
          <ConsentModal
            collectToken={token}
            collectorName={collector.name || collector.email || ''}
            defaultType={dataset.consent_type as 'individual' | 'group'}
            onDone={record => {
              setConsentRecords(prev => [...prev, record])
              setActiveConsentToken(record.token)
              setShowConsentModal(false)
            }}
            onClose={() => setShowConsentModal(false)}
          />
        )}

        {/* Current field — only show when consent is not blocking */}
        {fields[currentIdx] && locationResolved && !(dataset.require_consent && consentRecords.length === 0) && !showConsentModal && (
          <FieldCard
            key={fields[currentIdx].id}
            field={fields[currentIdx]}
            session={sessions[fields[currentIdx].id] ?? blankSession()}
            token={token}
            locationState={locationState}
            onSubmitted={(entry, preview) => handleSubmitted(fields[currentIdx].id, entry, preview)}
            consentRecordId={activeConsentToken}
          />
        )}

        {/* Prev / Next */}
        {fields.length > 1 && (
          <div className="flex gap-3">
            <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0}
              className="flex-1 py-3.5 rounded-xl bg-gray-800/60 disabled:opacity-30 text-gray-300 text-sm flex items-center justify-center gap-2 [touch-action:manipulation]">
              <ChevronLeft size={16} /> Previous
            </button>
            <button onClick={() => setCurrentIdx(i => Math.min(fields.length - 1, i + 1))} disabled={currentIdx === fields.length - 1}
              className="flex-1 py-3.5 rounded-xl bg-gray-800/60 disabled:opacity-30 text-gray-300 text-sm flex items-center justify-center gap-2 [touch-action:manipulation]">
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Finish button — shown when all required fields have ≥1 submission */}
        {requiredDone && (
          <button onClick={() => setFinished(true)}
            className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2 transition-colors [touch-action:manipulation] shadow-lg shadow-emerald-900/30">
            <CheckCircle2 size={16} /> Finish &amp; Submit
          </button>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[#060810]/90 backdrop-blur border-t border-gray-800/50 px-4 pt-3 text-center" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <p className="text-[10px] text-gray-600">Powered by <span className="text-gray-500">MLDock.io</span></p>
      </div>
    </div>
  )
}
