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
  Camera, Upload, CheckCircle2, ChevronLeft, ChevronRight,
  Loader2, X, Star, Gift, AlertCircle, RefreshCw, Image as ImageIcon,
  Plus, Repeat2, MapPin, Navigation, ShieldCheck, Video, Film,
  Square, Circle,
} from 'lucide-react'
import clsx from 'clsx'
import { collectApi } from '@/api/datasets'
import { useMultipartUpload } from '@/hooks/useMultipartUpload'
import type { CollectFormDefinition, DatasetField, DatasetEntry } from '@/types/dataset'

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

// ── Field card ────────────────────────────────────────────────────────────────

function FieldCard({
  field, session, token, locationState,
  onSubmitted,
}: {
  field: DatasetField
  session: FieldSession
  token: string
  locationState: LocationState
  onSubmitted: (entry: DatasetEntry, preview: string | null) => void
}) {
  const [showCamera, setShowCamera] = useState(false)
  const [showVideoCapture, setShowVideoCapture] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
        })
      } else {
        entry = await collectApi.submit(
          token, field.id,
          local.file,
          (field.type === 'text' || field.type === 'number') ? local.textValue : undefined,
          local.description || undefined,
          gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
        )
      }

      const preview = local.preview
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
            <div className="flex gap-1.5 flex-wrap">
              {session.submissions.map((s, i) => s.preview ? (
                s.entry.file_mime?.startsWith('video/') ? (
                  <div key={i} className="w-14 h-14 rounded-xl bg-black border border-emerald-800/40 flex items-center justify-center overflow-hidden">
                    <Video size={20} className="text-rose-400" />
                  </div>
                ) : (
                  <img key={i} src={s.preview} alt={`capture ${i + 1}`}
                    className="w-14 h-14 rounded-xl object-cover border border-emerald-800/40" />
                )
              ) : (
                <div key={i} className="w-14 h-14 rounded-xl bg-emerald-900/20 border border-emerald-800/30 flex items-center justify-center">
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
            const btnCount = (showPhotoBtn ? 1 : 0) + (showVideoBtn ? 1 : 0) + (showUploadBtn ? 1 : 0)
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

                {/* Capture / upload buttons — max 2 columns on mobile */}
                <div className="space-y-2">
                  {(showPhotoBtn || showVideoBtn) && (
                    <div className={clsx('grid gap-2', (showPhotoBtn && showVideoBtn) ? 'grid-cols-2' : 'grid-cols-1')}>
                      {showPhotoBtn && (
                        <button onClick={() => setShowCamera(true)}
                          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-sky-600/20 active:bg-sky-600/30 border border-sky-600/30 text-sky-400 text-sm font-medium transition-colors [touch-action:manipulation]">
                          <Camera size={16} /> Photo
                        </button>
                      )}
                      {showVideoBtn && (
                        <button onClick={() => setShowVideoCapture(true)}
                          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-rose-600/20 active:bg-rose-600/30 border border-rose-600/30 text-rose-400 text-sm font-medium transition-colors [touch-action:manipulation]">
                          <Video size={16} /> Record
                        </button>
                      )}
                    </div>
                  )}
                  {showUploadBtn && (
                    <>
                      <button onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-purple-600/20 active:bg-purple-600/30 border border-purple-600/30 text-purple-400 text-sm font-medium transition-colors [touch-action:manipulation]">
                        <Upload size={16} /> Upload File
                      </button>
                      <input ref={fileInputRef} type="file" accept={acceptAttr}
                        className="hidden" onChange={e => { if (e.target.files?.[0]) { pickFile(e.target.files[0]); e.target.value = '' } }} />
                    </>
                  )}
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

          <button onClick={submit} disabled={local.submitting}
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

        {/* Current field */}
        {fields[currentIdx] && locationResolved && (
          <FieldCard
            key={fields[currentIdx].id}
            field={fields[currentIdx]}
            session={sessions[fields[currentIdx].id] ?? blankSession()}
            token={token}
            locationState={locationState}
            onSubmitted={(entry, preview) => handleSubmitted(fields[currentIdx].id, entry, preview)}
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
