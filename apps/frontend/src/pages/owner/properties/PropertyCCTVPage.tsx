import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cctvApi } from '@/api/cctv'
import { extractApiError } from '@/utils/apiError'
import type { CCTVCamera, CCTVCameraPayload, CCTVEvent } from '@/types/cctv'

// ── helpers ───────────────────────────────────────────────────────────────────
const EVENT_COLORS: Record<string, string> = {
  suspicious: 'bg-red-100 text-red-700 border-red-200',
  intrusion:  'bg-red-100 text-red-700 border-red-200',
  loitering:  'bg-orange-100 text-orange-700 border-orange-200',
  motion:     'bg-yellow-100 text-yellow-700 border-yellow-200',
  person:     'bg-blue-100 text-blue-700 border-blue-200',
  vehicle:    'bg-indigo-100 text-indigo-700 border-indigo-200',
  fire:       'bg-red-200 text-red-900 border-red-300',
}
const EVENT_ICONS: Record<string, string> = {
  suspicious: '⚠️', intrusion: '🚨', loitering: '👥',
  motion: '〰️', person: '🚶', vehicle: '🚗', fire: '🔥',
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Camera config slide-over ──────────────────────────────────────────────────
function CameraSlideOver({
  initial, onClose, onSaved, propertyId,
}: {
  initial?: CCTVCamera
  onClose: () => void
  onSaved: (cam: CCTVCamera) => void
  propertyId: string
}) {
  const [form, setForm] = useState<CCTVCameraPayload>({
    name: initial?.name ?? '',
    location: initial?.location ?? '',
    description: initial?.description ?? '',
    onvif_host: initial?.onvif_host ?? '',
    onvif_port: initial?.onvif_port ?? 80,
    onvif_username: initial?.onvif_username ?? '',
    onvif_password: '',
    rtsp_url: initial?.rtsp_url ?? '',
    hls_url: initial?.hls_url ?? '',
    snapshot_url: initial?.snapshot_url ?? '',
    is_sandbox: initial?.is_sandbox ?? false,
    sandbox_youtube_id: initial?.sandbox_youtube_id ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true); setError(null)
    try {
      let cam: CCTVCamera
      if (initial) {
        cam = await cctvApi.updateCamera(initial.id, form)
      } else {
        cam = await cctvApi.createCamera(propertyId, form)
      }
      onSaved(cam)
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{initial ? 'Edit Camera' : '+ Add Camera'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Camera Name *</label>
            <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Entrance" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Location</label>
              <input className={inp} value={form.location ?? ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Gate A" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Description</label>
              <input className={inp} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>

          {/* Sandbox toggle */}
          <div className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-100 rounded-lg">
            <input type="checkbox" id="sandbox" checked={form.is_sandbox} onChange={e => setForm(f => ({ ...f, is_sandbox: e.target.checked }))} className="w-4 h-4 accent-purple-600" />
            <div>
              <label htmlFor="sandbox" className="text-sm font-medium text-purple-800 cursor-pointer">Sandbox / Demo mode</label>
              <p className="text-xs text-purple-600">Shows a YouTube video instead of a live RTSP feed</p>
            </div>
          </div>

          {form.is_sandbox ? (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">YouTube Video ID</label>
              <input className={inp} value={form.sandbox_youtube_id ?? ''} onChange={e => setForm(f => ({ ...f, sandbox_youtube_id: e.target.value }))} placeholder="e.g. dQw4w9WgXcQ" />
              <p className="text-xs text-gray-400 mt-1">The ID after ?v= in the YouTube URL</p>
            </div>
          ) : (
            <>
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">ONVIF / Network</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Host / IP</label>
                    <input className={inp} value={form.onvif_host ?? ''} onChange={e => setForm(f => ({ ...f, onvif_host: e.target.value }))} placeholder="192.168.1.100" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Port</label>
                    <input className={inp} type="number" value={form.onvif_port} onChange={e => setForm(f => ({ ...f, onvif_port: parseInt(e.target.value) || 80 }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Username</label>
                    <input className={inp} value={form.onvif_username ?? ''} onChange={e => setForm(f => ({ ...f, onvif_username: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Password</label>
                    <input className={inp} type="password" value={form.onvif_password ?? ''} onChange={e => setForm(f => ({ ...f, onvif_password: e.target.value }))} placeholder={initial ? '(unchanged)' : ''} />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stream URLs</p>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">RTSP URL</label>
                  <input className={inp} value={form.rtsp_url ?? ''} onChange={e => setForm(f => ({ ...f, rtsp_url: e.target.value }))} placeholder="rtsp://..." />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">HLS URL <span className="text-gray-400 font-normal">(browser-compatible)</span></label>
                  <input className={inp} value={form.hls_url ?? ''} onChange={e => setForm(f => ({ ...f, hls_url: e.target.value }))} placeholder="http://...stream.m3u8" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Snapshot URL</label>
                  <input className={inp} value={form.snapshot_url ?? ''} onChange={e => setForm(f => ({ ...f, snapshot_url: e.target.value }))} placeholder="http://.../snapshot.jpg" />
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
        </div>

        <div className="border-t px-6 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700">
            {saving ? 'Saving…' : (initial ? 'Save Changes' : 'Add Camera')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Fullscreen video viewer ───────────────────────────────────────────────────
function VideoViewer({
  camera,
  events,
  initialOffset,
  onClose,
}: {
  camera: CCTVCamera
  events: CCTVEvent[]
  initialOffset?: number
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [seekTarget, setSeekTarget] = useState<number | null>(initialOffset ?? null)

  useEffect(() => {
    if (seekTarget !== null && videoRef.current) {
      videoRef.current.currentTime = seekTarget
      setSeekTarget(null)
    }
  }, [seekTarget])

  const camEvents = events.filter(e => e.camera_id === camera.id).slice(0, 20)

  return (
    <div className="fixed inset-0 z-[20000] bg-black flex">
      {/* Video */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/80 text-white">
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${camera.status === 'online' ? 'bg-green-400 animate-pulse' : camera.status === 'offline' ? 'bg-red-400' : 'bg-gray-400'}`} />
            <span className="font-semibold">{camera.name}</span>
            {camera.location && <span className="text-gray-400 text-sm">· {camera.location}</span>}
            {camera.is_sandbox && (
              <span className="text-xs px-2 py-0.5 bg-purple-600 rounded-full">Sandbox</span>
            )}
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-300 text-2xl leading-none">✕</button>
        </div>

        {/* Player */}
        <div className="flex-1 flex items-center justify-center bg-black">
          {camera.is_sandbox && camera.sandbox_youtube_id ? (
            <iframe
              className="w-full h-full max-w-5xl"
              src={`https://www.youtube.com/embed/${camera.sandbox_youtube_id}?autoplay=1&mute=1&controls=1`}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : camera.hls_url ? (
            <video
              ref={videoRef}
              className="max-w-full max-h-full"
              src={camera.hls_url}
              controls
              autoPlay
              muted
            />
          ) : (
            <div className="text-center text-gray-400 space-y-3">
              <p className="text-5xl">📹</p>
              <p className="text-sm">No playback URL configured.</p>
              {camera.rtsp_url && (
                <p className="text-xs text-gray-500 max-w-xs">
                  RTSP stream available: <code className="bg-gray-800 px-1 rounded">{camera.rtsp_url}</code>
                  <br />Set up a media server (e.g. go2rtc) to proxy to HLS for browser playback.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Events sidebar */}
      {camEvents.length > 0 && (
        <div className="w-72 bg-gray-900 text-white flex flex-col">
          <div className="px-4 py-3 border-b border-gray-700">
            <p className="font-semibold text-sm">Events</p>
            <p className="text-xs text-gray-400">{camEvents.length} recent events</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-800">
            {camEvents.map(ev => (
              <button
                key={ev.id}
                onClick={() => setSeekTarget(ev.clip_offset_seconds)}
                className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span>{EVENT_ICONS[ev.event_type] ?? '📌'}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${ev.is_suspicious ? 'bg-red-900/60 text-red-300 border-red-700' : 'bg-gray-800 text-gray-300 border-gray-700'} capitalize`}>
                    {ev.event_type}
                  </span>
                  {ev.is_suspicious && <span className="text-xs text-red-400">⚠</span>}
                </div>
                <p className="text-xs text-gray-300 line-clamp-2">{ev.description}</p>
                <p className="text-[10px] text-gray-500 mt-1">{fmtTime(ev.occurred_at)}</p>
                {ev.clip_offset_seconds > 0 && (
                  <p className="text-[10px] text-blue-400 mt-0.5">▶ Jump to {ev.clip_offset_seconds.toFixed(0)}s</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Camera thumbnail card ─────────────────────────────────────────────────────
function CameraCard({
  camera,
  suspiciousCount,
  onExpand,
  onEdit,
  onDelete,
  onSeed,
}: {
  camera: CCTVCamera
  suspiciousCount: number
  onExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onSeed: () => void
}) {
  const [imgError, setImgError] = useState(false)

  const statusDot =
    camera.status === 'online' ? 'bg-green-400 animate-pulse' :
    camera.status === 'offline' ? 'bg-red-400' : 'bg-gray-300'

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
      {/* Thumbnail area */}
      <div
        className="relative bg-gray-900 cursor-pointer"
        style={{ paddingTop: '56.25%' }}
        onClick={onExpand}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          {camera.is_sandbox && camera.sandbox_youtube_id ? (
            <img
              src={`https://img.youtube.com/vi/${camera.sandbox_youtube_id}/mqdefault.jpg`}
              alt={camera.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : camera.snapshot_url && !imgError ? (
            <img
              src={camera.snapshot_url}
              alt={camera.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center text-gray-500 gap-2">
              <span className="text-4xl">📷</span>
              <span className="text-xs">{camera.is_sandbox ? 'Sandbox' : 'No snapshot'}</span>
            </div>
          )}
        </div>

        {/* Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
          <span className="text-white text-sm font-medium">▶ View Live</span>
        </div>
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          {camera.status}
        </div>
        {camera.is_sandbox && (
          <div className="absolute top-2 right-2 bg-purple-600/80 text-white text-[10px] px-2 py-0.5 rounded-full">
            Sandbox
          </div>
        )}
        {suspiciousCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-red-600/90 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
            ⚠ {suspiciousCount} alert{suspiciousCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="p-3">
        <p className="font-semibold text-sm text-gray-900 truncate">{camera.name}</p>
        {camera.location && <p className="text-xs text-gray-500 truncate mt-0.5">{camera.location}</p>}
        <div className="flex gap-2 mt-2">
          <button onClick={onExpand} className="flex-1 py-1.5 bg-gray-900 text-white rounded text-xs font-medium hover:bg-gray-700 transition-colors">▶ View</button>
          <button onClick={onEdit} className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50">Edit</button>
          {camera.is_sandbox && (
            <button onClick={onSeed} className="px-3 py-1.5 border border-purple-200 rounded text-xs text-purple-600 hover:bg-purple-50" title="Seed demo events">🎲</button>
          )}
          <button onClick={onDelete} className="px-3 py-1.5 border border-red-200 rounded text-xs text-red-500 hover:bg-red-50">✕</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PropertyCCTVPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [cameras, setCameras] = useState<CCTVCamera[]>([])
  const [events, setEvents] = useState<CCTVEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [editCamera, setEditCamera] = useState<CCTVCamera | null>(null)
  const [viewCamera, setViewCamera] = useState<CCTVCamera | null>(null)
  const [viewOffset, setViewOffset] = useState<number | undefined>()

  // Events panel
  const [evtFilter, setEvtFilter] = useState<'all' | 'suspicious'>('all')
  const [evtCamera, setEvtCamera] = useState<string>('all')

  async function load() {
    if (!propertyId) return
    setLoading(true)
    try {
      const [camRes, evtRes] = await Promise.all([
        cctvApi.listCameras(propertyId),
        cctvApi.listEvents(propertyId, { page_size: 100 }),
      ])
      setCameras(camRes.items)
      setEvents(evtRes.items)
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId])

  function handleCameraSaved(cam: CCTVCamera) {
    setCameras(prev => {
      const idx = prev.findIndex(c => c.id === cam.id)
      return idx >= 0 ? prev.map(c => c.id === cam.id ? cam : c) : [...prev, cam]
    })
    setShowAdd(false); setEditCamera(null)
  }

  async function handleDelete(cam: CCTVCamera) {
    if (!window.confirm(`Delete camera "${cam.name}"?`)) return
    try {
      await cctvApi.deleteCamera(cam.id)
      setCameras(prev => prev.filter(c => c.id !== cam.id))
    } catch (e) {
      alert(extractApiError(e).message)
    }
  }

  async function handleSeedEvents(cam: CCTVCamera) {
    if (!propertyId) return
    try {
      await cctvApi.seedEvents(propertyId, cam.id)
      const evtRes = await cctvApi.listEvents(propertyId, { page_size: 100 })
      setEvents(evtRes.items)
    } catch (e) {
      alert(extractApiError(e).message)
    }
  }

  async function handleReviewEvent(ev: CCTVEvent) {
    try {
      const updated = await cctvApi.reviewEvent(ev.id)
      setEvents(prev => prev.map(e => e.id === updated.id ? updated : e))
    } catch (e) {
      alert(extractApiError(e).message)
    }
  }

  function openEventInViewer(ev: CCTVEvent) {
    const cam = cameras.find(c => c.id === ev.camera_id)
    if (cam) { setViewCamera(cam); setViewOffset(ev.clip_offset_seconds) }
  }

  const suspiciousCountByCam = (camId: string) =>
    events.filter(e => e.camera_id === camId && e.is_suspicious).length

  const filteredEvents = events.filter(e => {
    if (evtFilter === 'suspicious' && !e.is_suspicious) return false
    if (evtCamera !== 'all' && e.camera_id !== evtCamera) return false
    return true
  })

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CCTV Integration</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {cameras.length} camera{cameras.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          + Add Camera
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
              <div className="bg-gray-200" style={{ paddingTop: '56.25%' }} />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <p className="text-5xl mb-4">📹</p>
          <p className="text-gray-700 font-semibold">No cameras configured</p>
          <p className="text-sm text-gray-400 mt-1 mb-6">Add your first ONVIF-compatible IP camera or use sandbox mode for a demo.</p>
          <button onClick={() => setShowAdd(true)} className="px-6 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700">
            + Add Camera
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Camera grid — 2 cols */}
          <div className="xl:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cameras.map(cam => (
                <CameraCard
                  key={cam.id}
                  camera={cam}
                  suspiciousCount={suspiciousCountByCam(cam.id)}
                  onExpand={() => { setViewCamera(cam); setViewOffset(undefined) }}
                  onEdit={() => setEditCamera(cam)}
                  onDelete={() => handleDelete(cam)}
                  onSeed={() => handleSeedEvents(cam)}
                />
              ))}
            </div>
          </div>

          {/* Events feed */}
          <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-[calc(100vh-220px)] min-h-96">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-sm text-gray-900">Events</p>
                <span className="text-xs text-gray-500">{filteredEvents.length} events</span>
              </div>
              <div className="flex gap-2">
                <select
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1"
                  value={evtCamera}
                  onChange={e => setEvtCamera(e.target.value)}
                >
                  <option value="all">All cameras</option>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  onClick={() => setEvtFilter(f => f === 'all' ? 'suspicious' : 'all')}
                  className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${evtFilter === 'suspicious' ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {evtFilter === 'suspicious' ? '⚠ Suspicious' : 'All Events'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {filteredEvents.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  {events.length === 0 ? 'No events yet. Add a sandbox camera and seed demo events (🎲).' : 'No matching events.'}
                </div>
              ) : (
                filteredEvents.map(ev => {
                  const cam = cameras.find(c => c.id === ev.camera_id)
                  return (
                    <div
                      key={ev.id}
                      className={`px-4 py-3 hover:bg-gray-50 transition-colors ${ev.is_suspicious ? 'border-l-2 border-l-red-500' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-base mt-0.5 flex-shrink-0">{EVENT_ICONS[ev.event_type] ?? '📌'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize ${EVENT_COLORS[ev.event_type] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                              {ev.event_type}
                            </span>
                            {ev.is_suspicious && <span className="text-[10px] font-bold text-red-600">SUSPICIOUS</span>}
                            {!ev.is_reviewed && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">New</span>}
                          </div>
                          <p className="text-xs text-gray-700 mt-1 line-clamp-2">{ev.description}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] text-gray-400">{cam?.name ?? '—'}</span>
                            <span className="text-gray-200">·</span>
                            <span className="text-[10px] text-gray-400">{fmtTime(ev.occurred_at)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button
                            onClick={() => openEventInViewer(ev)}
                            className="text-[10px] px-2 py-1 bg-gray-900 text-white rounded hover:bg-gray-700"
                          >▶</button>
                          {!ev.is_reviewed && (
                            <button
                              onClick={() => handleReviewEvent(ev)}
                              className="text-[10px] px-2 py-1 border border-green-300 text-green-600 rounded hover:bg-green-50"
                            >✓</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit slide-over */}
      {(showAdd || editCamera) && propertyId && (
        <CameraSlideOver
          initial={editCamera ?? undefined}
          propertyId={propertyId}
          onClose={() => { setShowAdd(false); setEditCamera(null) }}
          onSaved={handleCameraSaved}
        />
      )}

      {/* Fullscreen viewer */}
      {viewCamera && (
        <VideoViewer
          camera={viewCamera}
          events={events}
          initialOffset={viewOffset}
          onClose={() => { setViewCamera(null); setViewOffset(undefined) }}
        />
      )}
    </div>
  )
}
