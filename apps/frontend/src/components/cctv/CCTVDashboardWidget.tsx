/**
 * CCTVDashboardWidget — 2-column camera thumbnail grid for the property dashboard.
 * Shows live YouTube embed (sandbox) or snapshot image (real camera).
 * Click any thumbnail → fullscreen modal with event timeline sidebar.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cctvApi } from '@/api/cctv'
import type { CCTVCamera, CCTVEvent } from '@/types/cctv'

const EVENT_ICONS: Record<string, string> = {
  suspicious: '⚠️', intrusion: '🚨', loitering: '👥',
  motion: '〰️', person: '🚶', vehicle: '🚗', fire: '🔥',
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── Fullscreen overlay ────────────────────────────────────────────────────────
function FullscreenViewer({
  camera,
  events,
  onClose,
  onNavigate,
}: {
  camera: CCTVCamera
  events: CCTVEvent[]
  onClose: () => void
  onNavigate: () => void
}) {
  const [seekOffset, setSeekOffset] = useState<number | null>(null)
  const camEvents = events.filter(e => e.camera_id === camera.id).slice(0, 30)

  return (
    <div className="fixed inset-0 z-[20000] bg-black/95 flex flex-col" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-black/80 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${camera.status === 'online' ? 'bg-green-400 animate-pulse' : camera.status === 'offline' ? 'bg-red-400' : 'bg-gray-500'}`} />
          <span className="text-white font-semibold">{camera.name}</span>
          {camera.location && <span className="text-gray-400 text-sm">· {camera.location}</span>}
          {camera.is_sandbox && <span className="text-xs px-2 py-0.5 bg-purple-700 text-purple-200 rounded-full">Sandbox</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onNavigate} className="text-xs text-gray-400 hover:text-white px-3 py-1 border border-gray-700 rounded-lg">Open CCTV →</button>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none">✕</button>
        </div>
      </div>

      {/* Body: player + events */}
      <div className="flex flex-1 min-h-0">
        {/* Player */}
        <div className="flex-1 flex items-center justify-center bg-black p-4">
          {camera.is_sandbox && camera.sandbox_youtube_id ? (
            <iframe
              key={camera.sandbox_youtube_id}
              className="w-full h-full max-w-4xl rounded-xl"
              src={`https://www.youtube.com/embed/${camera.sandbox_youtube_id}?autoplay=1&mute=1&controls=1${seekOffset != null ? `&start=${Math.floor(seekOffset)}` : ''}`}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          ) : camera.hls_url ? (
            <video className="max-w-full max-h-full rounded-xl" src={camera.hls_url} controls autoPlay muted />
          ) : (
            <div className="text-center text-gray-400 space-y-3">
              <p className="text-5xl">📹</p>
              <p className="text-sm">No playback URL configured</p>
              {camera.rtsp_url && <p className="text-xs font-mono text-gray-500 bg-gray-900 px-3 py-1 rounded">{camera.rtsp_url}</p>}
            </div>
          )}
        </div>

        {/* Events sidebar */}
        {camEvents.length > 0 && (
          <div className="w-64 bg-gray-950 border-l border-gray-800 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-white text-sm font-semibold">Events Timeline</p>
              <p className="text-gray-500 text-xs">{camEvents.length} events</p>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
              {camEvents.map(ev => (
                <button
                  key={ev.id}
                  onClick={() => setSeekOffset(ev.clip_offset_seconds)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-900 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{EVENT_ICONS[ev.event_type] ?? '📌'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize font-medium ${ev.is_suspicious ? 'bg-red-900/70 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
                      {ev.event_type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 line-clamp-2 leading-snug">{ev.description}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-gray-600">{fmtTime(ev.occurred_at)}</span>
                    {ev.clip_offset_seconds > 0 && (
                      <span className="text-[10px] text-blue-500">▶ {ev.clip_offset_seconds.toFixed(0)}s</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Thumbnail cell ────────────────────────────────────────────────────────────
function CameraThumbnail({
  camera,
  suspiciousCount,
  onClick,
}: {
  camera: CCTVCamera
  suspiciousCount: number
  onClick: () => void
}) {
  const [imgErr, setImgErr] = useState(false)

  return (
    <div
      onClick={onClick}
      className="relative bg-gray-900 overflow-hidden cursor-pointer group"
      style={{ paddingTop: '56.25%' }}
    >
      <div className="absolute inset-0">
        {camera.is_sandbox && camera.sandbox_youtube_id ? (
          <iframe
            className="w-full h-full pointer-events-none"
            src={`https://www.youtube.com/embed/${camera.sandbox_youtube_id}?autoplay=1&mute=1&loop=1&playlist=${camera.sandbox_youtube_id}&controls=0&modestbranding=1&playsinline=1&disablekb=1`}
            allow="autoplay"
            title={camera.name}
          />
        ) : camera.hls_url ? (
          <video
            className="w-full h-full object-cover pointer-events-none"
            src={camera.hls_url}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : camera.snapshot_url && !imgErr ? (
          <img src={camera.snapshot_url} alt={camera.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
            <span className="text-3xl">📷</span>
            <span className="text-[10px] mt-1">{camera.is_sandbox ? 'Sandbox' : 'No feed'}</span>
          </div>
        )}
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <span className="text-white text-xs font-medium bg-black/60 px-3 py-1.5 rounded-full">⛶ Full Screen</span>
      </div>

      {/* Camera name */}
      <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-white text-xs font-medium truncate">{camera.name}</p>
        {camera.location && <p className="text-white/60 text-[10px] truncate">{camera.location}</p>}
      </div>

      {/* Status dot */}
      <div className="absolute top-2 left-2">
        <span className={`w-2 h-2 rounded-full inline-block ${camera.status === 'online' ? 'bg-green-400 animate-pulse' : camera.status === 'offline' ? 'bg-red-400' : 'bg-gray-400'}`} />
      </div>

      {/* Suspicious badge */}
      {suspiciousCount > 0 && (
        <div className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          ⚠ {suspiciousCount}
        </div>
      )}

      {/* Sandbox badge */}
      {camera.is_sandbox && (
        <div className="absolute top-2 right-2 bg-purple-600/80 text-white text-[10px] px-1.5 py-0.5 rounded-full" style={{ top: suspiciousCount > 0 ? '24px' : undefined }}>
          Demo
        </div>
      )}
    </div>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────
export default function CCTVDashboardWidget() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()
  const [cameras, setCameras] = useState<CCTVCamera[]>([])
  const [events, setEvents] = useState<CCTVEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCamera, setActiveCamera] = useState<CCTVCamera | null>(null)

  useEffect(() => {
    if (!propertyId) return
    Promise.allSettled([
      cctvApi.listCameras(propertyId),
      cctvApi.listEvents(propertyId, { page_size: 100 }),
    ]).then(([camRes, evtRes]) => {
      if (camRes.status === 'fulfilled') setCameras(camRes.value.items)
      if (evtRes.status === 'fulfilled') setEvents(evtRes.value.items)
    }).finally(() => setLoading(false))
  }, [propertyId])

  const [showAlerts, setShowAlerts] = useState(false)

  const suspiciousCount = (camId: string) => events.filter(e => e.camera_id === camId && e.is_suspicious && !e.is_reviewed).length
  const recentSuspicious = events.filter(e => e.is_suspicious).slice(0, 5)
  const unreviewed = events.filter(e => e.is_suspicious && !e.is_reviewed).length

  if (loading) return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2].map(i => (
        <div key={i} className="bg-gray-200 rounded-xl animate-pulse" style={{ paddingTop: '56.25%' }} />
      ))}
    </div>
  )

  if (cameras.length === 0) return (
    <div
      onClick={() => navigate(`/portfolio/properties/${propertyId}/cctv`)}
      className="flex flex-col items-center justify-center py-10 bg-gray-50 border border-dashed border-gray-300 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors"
    >
      <p className="text-3xl mb-2">📹</p>
      <p className="text-sm font-medium text-gray-600">Add CCTV Cameras</p>
      <p className="text-xs text-gray-400 mt-0.5">Connect ONVIF cameras or use sandbox mode</p>
    </div>
  )

  return (
    <div className="space-y-2">
      {/* Alert toggle button — shown above grid when suspicious events exist */}
      {recentSuspicious.length > 0 && (
        <button
          onClick={() => setShowAlerts(v => !v)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors text-left ${
            showAlerts
              ? 'bg-red-600 border-red-500 text-white'
              : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-sm ${showAlerts ? '' : 'animate-pulse'}`}>⚠</span>
            <span className="text-xs font-semibold">
              {unreviewed > 0 ? `${unreviewed} Suspicious Activities` : 'All Activities'}
            </span>
          </div>
          <span className="text-[11px] opacity-70">{showAlerts ? 'Hide ▲' : 'Review ▼'}</span>
        </button>
      )}

      {/* Camera grid with optional full overlay */}
      <div className="relative rounded-xl overflow-hidden border border-gray-200">
        {/* Activities overlay — covers entire camera grid when open */}
        {showAlerts && recentSuspicious.length > 0 && (
          <div className="absolute inset-0 z-10 bg-black/85 backdrop-blur-sm flex flex-col">
            {/* Overlay header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-red-400 animate-pulse">⚠</span>
                <span className="text-white text-xs font-semibold uppercase tracking-wide">Suspicious Events</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/portfolio/properties/${propertyId}/cctv`)}
                  className="text-[11px] text-red-300 hover:text-white border border-red-500/50 hover:border-white/50 px-2 py-0.5 rounded transition-colors"
                >
                  Manage →
                </button>
                <button onClick={() => setShowAlerts(false)} className="text-white/50 hover:text-white text-lg leading-none">✕</button>
              </div>
            </div>
            {/* Event list */}
            <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto p-3">
              {recentSuspicious.map(ev => {
                const cam = cameras.find(c => c.id === ev.camera_id)
                return (
                  <button
                    key={ev.id}
                    onClick={() => { setShowAlerts(false); const c = cameras.find(c => c.id === ev.camera_id); if (c) setActiveCamera(c) }}
                    className="flex items-start gap-2.5 text-left hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
                  >
                    <span className="text-base mt-0.5 flex-shrink-0">{EVENT_ICONS[ev.event_type] ?? '📌'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-[11px] font-medium leading-snug">{ev.description}</p>
                      <p className="text-white/50 text-[10px] mt-0.5">{cam?.name ?? ''} · {fmtTime(ev.occurred_at)}</p>
                    </div>
                    <span className="text-white/30 text-xs self-center">▶</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Camera grid — 2 columns */}
        <div className="grid grid-cols-2 gap-0.5 bg-gray-300">
          {cameras.slice(0, 4).map(cam => (
            <CameraThumbnail
              key={cam.id}
              camera={cam}
              suspiciousCount={suspiciousCount(cam.id)}
              onClick={() => setActiveCamera(cam)}
            />
          ))}
        </div>
      </div>

      {/* Fullscreen viewer */}
      {activeCamera && (
        <FullscreenViewer
          camera={activeCamera}
          events={events}
          onClose={() => setActiveCamera(null)}
          onNavigate={() => { setActiveCamera(null); navigate(`/portfolio/properties/${propertyId}/cctv`) }}
        />
      )}
    </div>
  )
}
