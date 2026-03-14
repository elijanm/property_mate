import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { whatsappApi } from '@/api/whatsapp'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { useWebSocket, type WsNotification } from '@/context/WebSocketContext'
import { useSound } from '@/hooks/useSound'
import { extractApiError } from '@/utils/apiError'
import type { WhatsAppEvent, WhatsAppInstance, WhatsAppStatus, WhatsAppWsEvent } from '@/types/whatsapp'

function parseWhatsAppMsg(n: WsNotification): WhatsAppWsEvent | null {
  try {
    if (n.type === 'whatsapp_event' || n.type === 'whatsapp_status') {
      return n as unknown as WhatsAppWsEvent
    }
    // Also try data field
    const d = n.data as WhatsAppWsEvent | undefined
    if (d && (d.type === 'whatsapp_event' || d.type === 'whatsapp_status')) return d
  } catch { /* ignore */ }
  return null
}

/* ─── Status pill ────────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<WhatsAppStatus, { cls: string; dot: string; label: string }> = {
  connected:    { cls: 'bg-green-100 text-green-700',   dot: 'bg-green-500 animate-pulse', label: 'Connected' },
  connecting:   { cls: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-400 animate-pulse', label: 'Connecting…' },
  disconnected: { cls: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-400',                label: 'Disconnected' },
  logged_out:   { cls: 'bg-red-100 text-red-600',       dot: 'bg-red-400',                 label: 'Logged out' },
}

function StatusBadge({ status }: { status: WhatsAppStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

/* ─── Event type badge ───────────────────────────────────────────────────── */

const EVENT_COLORS: Record<string, string> = {
  Message:    'bg-blue-100 text-blue-700',
  QR:         'bg-yellow-100 text-yellow-700',
  Connected:  'bg-green-100 text-green-700',
  LoggedOut:  'bg-red-100 text-red-600',
  ReadReceipt:'bg-purple-100 text-purple-700',
  Presence:   'bg-indigo-100 text-indigo-700',
  unknown:    'bg-gray-100 text-gray-500',
}

function EventBadge({ type }: { type: string }) {
  const cls = EVENT_COLORS[type] ?? EVENT_COLORS.unknown
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls}`}>{type}</span>
}

/* ─── QR Modal ───────────────────────────────────────────────────────────── */

function QrModal({
  instance,
  onClose,
  onConnected,
}: {
  instance: WhatsAppInstance
  onClose: () => void
  onConnected: (inst: WhatsAppInstance) => void
}) {
  const [qr, setQr] = useState<string | null>(instance.qr_code ?? null)
  const [status, setStatus] = useState<WhatsAppStatus>(instance.status)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { subscribe } = useWebSocket()
  const { playQrReadySound } = useSound()
  const qrPlayedRef = useRef(false)

  // Start session if not already connecting
  useEffect(() => {
    if (status === 'connecting' || status === 'connected') return
    setConnecting(true)
    whatsappApi.connect(instance.id)
      .then(() => setStatus('connecting'))
      .catch(e => setError(extractApiError(e).message))
      .finally(() => setConnecting(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Play chime once when QR first becomes available
  useEffect(() => {
    if (qr && !qrPlayedRef.current) {
      qrPlayedRef.current = true
      playQrReadySound()
    }
  }, [qr, playQrReadySound])

  // Poll for QR + instance status while connecting
  useEffect(() => {
    if (status !== 'connecting') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        // Poll QR code
        const { qr_code } = await whatsappApi.getQr(instance.id)
        if (qr_code) setQr(qr_code)
      } catch { /* ignore */ }
      try {
        // Fallback: poll instance status directly (catches WS misses)
        const inst = await whatsappApi.getInstance(instance.id)
        if (inst.status === 'connected') {
          onConnected(inst)
        }
      } catch { /* ignore */ }
    }, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [status, instance.id, onConnected])

  // Listen for real-time WS events for this instance
  useEffect(() => {
    return subscribe(n => {
      const msg = parseWhatsAppMsg(n)
      if (!msg || msg.instance_id !== instance.id) return
      if (msg.qr_code) setQr(msg.qr_code)
      if (msg.status) setStatus(msg.status)
      if (msg.status === 'connected') {
        whatsappApi.getInstance(instance.id).then(onConnected).catch(() => {})
      }
    })
  }, [subscribe, instance.id, onConnected])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">{instance.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Scan with WhatsApp to connect</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-6 flex flex-col items-center gap-4">
          <StatusBadge status={status} />

          {status === 'connected' ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">✓</div>
              <p className="text-sm font-semibold text-green-700">WhatsApp Connected!</p>
              {instance.phone_number && (
                <p className="text-xs text-gray-500">+{instance.phone_number}</p>
              )}
            </div>
          ) : connecting ? (
            <div className="py-8 text-sm text-gray-400">Starting session…</div>
          ) : qr ? (
            <div className="space-y-3 flex flex-col items-center">
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="WhatsApp QR Code"
                className="w-56 h-56 rounded-xl border border-gray-200"
              />
              <p className="text-xs text-gray-400 text-center">
                Open WhatsApp → Linked Devices → Link a Device
              </p>
            </div>
          ) : (
            <div className="py-8 text-sm text-gray-400">Waiting for QR code…</div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 w-full text-center">{error}</p>}
        </div>
      </div>
    </div>
  )
}

/* ─── Add Instance Modal ─────────────────────────────────────────────────── */

function AddInstanceModal({
  propertyId,
  onCreated,
  onClose,
}: {
  propertyId: string
  onCreated: (inst: WhatsAppInstance) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const inst = await whatsappApi.createInstance(propertyId, name.trim())
      onCreated(inst)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add WhatsApp Line</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Line, Support, Maintenance"
              autoFocus
            />
            <p className="text-[10px] text-gray-400 mt-1">Used to identify this WhatsApp number.</p>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create & Scan QR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Event log panel ────────────────────────────────────────────────────── */

interface LiveEvent extends WhatsAppEvent {
  _live?: boolean
}

function EventLogPanel({ instanceId }: { instanceId: string }) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const { subscribe } = useWebSocket()
  const { playWhatsAppMessageSound } = useSound()
  const soundRef = useRef(playWhatsAppMessageSound)
  soundRef.current = playWhatsAppMessageSound
  const logRef = useRef<HTMLDivElement>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Initial load
  useEffect(() => {
    setLoading(true)
    seenIdsRef.current = new Set()
    whatsappApi.listEvents(instanceId, { limit: 50 })
      .then(data => {
        data.forEach(e => seenIdsRef.current.add(e.id))
        setEvents(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [instanceId])

  // Poll every 8 s as fallback (catches events that slip past WS)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const fresh = await whatsappApi.listEvents(instanceId, { limit: 20 })
        const newOnes = fresh.filter(e => !seenIdsRef.current.has(e.id))
        if (newOnes.length === 0) return
        newOnes.forEach(e => seenIdsRef.current.add(e.id))
        if (newOnes.some(e => e.event_type === 'Message')) soundRef.current()
        setEvents(prev => [...newOnes, ...prev].slice(0, 200))
        logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } catch { /* ignore */ }
    }, 8000)
    return () => clearInterval(timer)
  }, [instanceId])

  // Live WS path — prepends events immediately without waiting for poll
  useEffect(() => {
    return subscribe(n => {
      const msg = parseWhatsAppMsg(n)
      if (!msg || msg.type !== 'whatsapp_event' || msg.instance_id !== instanceId) return
      if (msg.event_type === 'Message') soundRef.current()
      const liveId = `live-${msg.received_at ?? Date.now()}`
      if (seenIdsRef.current.has(liveId)) return
      seenIdsRef.current.add(liveId)
      const live: LiveEvent = {
        id: liveId,
        instance_id: instanceId,
        event_type: msg.event_type ?? 'unknown',
        payload: msg.payload ?? {},
        received_at: msg.received_at ?? new Date().toISOString(),
        _live: true,
      }
      setEvents(prev => [live, ...prev.slice(0, 199)])
      logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [subscribe, instanceId])

  if (loading) return <div className="p-6 text-center text-sm text-gray-400">Loading events…</div>

  return (
    <div ref={logRef} className="overflow-y-auto max-h-[480px] divide-y divide-gray-50">
      {events.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">
          <p className="text-2xl mb-2">📭</p>
          No events yet. Connect WhatsApp and send a message.
        </div>
      ) : events.map(ev => (
        <div key={ev.id} className={`px-4 py-3 transition-colors ${ev._live ? 'bg-green-50/60' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <EventBadge type={ev.event_type} />
              {ev._live && (
                <span className="text-[9px] font-bold text-green-600 uppercase tracking-wide">live</span>
              )}
            </div>
            <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
              {new Date(ev.received_at).toLocaleTimeString()}
            </span>
          </div>
          <EventPayloadPreview
            payload={ev.payload}
            mediaUrl={ev.media_url}
            mediaContentType={ev.media_content_type}
          />
        </div>
      ))}
    </div>
  )
}

function EventPayloadPreview({
  payload,
  mediaUrl,
  mediaContentType,
}: {
  payload: Record<string, unknown>
  mediaUrl?: string
  mediaContentType?: string
}) {
  const [expanded, setExpanded] = useState(false)

  // Extract readable text summary
  const text =
    (payload as any)?.data?.message?.conversation
    ?? (payload as any)?.data?.message?.extendedTextMessage?.text
    ?? (payload as any)?.body?.text
    ?? null

  const from =
    (payload as any)?.data?.key?.remoteJid?.split('@')[0]
    ?? (payload as any)?.data?.info?.Id?.split('@')[0]
    ?? null

  const isImage = mediaContentType?.startsWith('image/')
  const isAudio = mediaContentType?.startsWith('audio/')
  const isVideo = mediaContentType?.startsWith('video/')
  const isDocument = mediaContentType && !isImage && !isAudio && !isVideo

  return (
    <div className="mt-1.5 space-y-1">
      {/* Text preview */}
      {text && (
        <p className="text-xs text-gray-700 bg-gray-50 rounded px-2 py-1 truncate">
          {from && <span className="font-semibold text-gray-500 mr-1">+{from}:</span>}
          {text}
        </p>
      )}

      {/* Media preview */}
      {mediaUrl && isImage && (
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img
            src={mediaUrl}
            alt="media"
            className="mt-1 max-h-40 rounded-lg border border-gray-200 object-cover cursor-pointer hover:opacity-90 transition-opacity"
          />
        </a>
      )}
      {mediaUrl && isAudio && (
        <audio
          controls
          src={mediaUrl}
          className="mt-1 w-full h-8 rounded"
          style={{ height: '32px' }}
        />
      )}
      {mediaUrl && isVideo && (
        <video
          controls
          src={mediaUrl}
          className="mt-1 max-h-40 rounded-lg border border-gray-200 w-full"
        />
      )}
      {mediaUrl && isDocument && (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2"
        >
          <span>📄</span>
          <span className="truncate">{mediaContentType}</span>
          <span className="ml-auto font-semibold flex-shrink-0">Download ↓</span>
        </a>
      )}

      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[10px] text-blue-500 hover:text-blue-700"
      >
        {expanded ? 'Hide raw' : 'Raw payload'}
      </button>
      {expanded && (
        <pre className="text-[10px] bg-gray-900 text-green-400 rounded-lg p-2 overflow-x-auto max-h-40">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ─── Instance card ──────────────────────────────────────────────────────── */

function InstanceCard({
  instance,
  onConnect,
  onDelete,
  onStatusChange,
  selected,
  onSelect,
}: {
  instance: WhatsAppInstance
  onConnect: () => void
  onDelete: () => void
  onStatusChange: (inst: WhatsAppInstance) => void
  selected: boolean
  onSelect: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { subscribe } = useWebSocket()

  // Listen for status updates for this instance
  useEffect(() => {
    return subscribe(n => {
      const msg = parseWhatsAppMsg(n)
      if (!msg || msg.instance_id !== instance.id || !msg.status) return
      onStatusChange({ ...instance, status: msg.status, qr_code: msg.qr_code ?? instance.qr_code })
    })
  }, [subscribe, instance.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn: () => Promise<WhatsAppInstance | void>) {
    setBusy(true)
    try { const r = await fn(); if (r) onStatusChange(r as WhatsAppInstance) }
    catch { /* error shown via toast */ }
    finally { setBusy(false) }
  }

  return (
    <div
      onClick={onSelect}
      className={[
        'border rounded-2xl p-4 cursor-pointer transition-all',
        selected ? 'border-green-400 bg-green-50/40 shadow-md' : 'border-gray-200 bg-white hover:shadow-sm',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-lg flex-shrink-0">
            💬
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">{instance.name}</p>
            {instance.phone_number && (
              <p className="text-xs text-gray-500">+{instance.phone_number}</p>
            )}
            {instance.push_name && !instance.phone_number && (
              <p className="text-xs text-gray-500">{instance.push_name}</p>
            )}
          </div>
        </div>
        <StatusBadge status={instance.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(instance.status === 'disconnected' || instance.status === 'logged_out') && (
          <button
            onClick={e => { e.stopPropagation(); onConnect() }}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
          >
            {busy ? '…' : 'Connect & Scan QR'}
          </button>
        )}
        {instance.status === 'connecting' && (
          <button
            onClick={e => { e.stopPropagation(); onConnect() }}
            className="px-3 py-1.5 text-xs font-semibold text-yellow-700 bg-yellow-100 hover:bg-yellow-200 rounded-lg"
          >
            Show QR
          </button>
        )}
        {instance.status === 'connected' && (
          <button
            onClick={e => { e.stopPropagation(); act(() => whatsappApi.disconnect(instance.id)) }}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg disabled:opacity-50"
          >
            Disconnect
          </button>
        )}
        {(instance.status === 'connected' || instance.status === 'disconnected') && (
          <button
            onClick={e => { e.stopPropagation(); act(() => whatsappApi.logout(instance.id)) }}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold text-orange-600 border border-orange-200 hover:border-orange-300 rounded-lg disabled:opacity-50"
          >
            Logout
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold text-red-500 hover:text-red-700 ml-auto disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function PropertyWhatsAppPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [qrInstance, setQrInstance] = useState<WhatsAppInstance | null>(null)
  const [_deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!propertyId) return
    whatsappApi.listInstances(propertyId)
      .then(list => {
        setInstances(list)
        if (!selectedId && list.length > 0) setSelectedId(list[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [propertyId, selectedId])

  useEffect(() => { load() }, [load])

  function handleStatusChange(updated: WhatsAppInstance) {
    setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
  }

  function handleCreated(inst: WhatsAppInstance) {
    setInstances(prev => [...prev, inst])
    setSelectedId(inst.id)
    setShowAdd(false)
    setQrInstance(inst) // immediately show QR
  }

  async function handleDelete(instanceId: string) {
    if (!confirm('Remove this WhatsApp line? The WhatsApp session will be deleted.')) return
    setDeleting(instanceId)
    try {
      await whatsappApi.deleteInstance(instanceId)
      setInstances(prev => prev.filter(i => i.id !== instanceId))
      if (selectedId === instanceId) setSelectedId(instances.find(i => i.id !== instanceId)?.id ?? null)
    } catch { /* toast handles it */ }
    finally { setDeleting(null) }
  }

  const selectedInstance = instances.find(i => i.id === selectedId) ?? null

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading WhatsApp lines…</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl">
      <PropertyBreadcrumb page="WhatsApp" />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">💬</span> WhatsApp Notifications
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect multiple WhatsApp numbers. Receive messages in real time.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl shadow-sm"
        >
          <span>+</span> Add WhatsApp Line
        </button>
      </div>

      {instances.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-gray-200 rounded-2xl">
          <div className="text-5xl mb-4">📱</div>
          <h2 className="text-lg font-bold text-gray-700 mb-1">No WhatsApp lines yet</h2>
          <p className="text-sm text-gray-400 mb-6 text-center max-w-xs">
            Add a WhatsApp number to start receiving messages and sending notifications.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl"
          >
            Add First Line
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: instance list */}
          <div className="lg:col-span-1 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
              Lines ({instances.length})
            </p>
            {instances.map(inst => (
              <InstanceCard
                key={inst.id}
                instance={inst}
                selected={selectedId === inst.id}
                onSelect={() => setSelectedId(inst.id)}
                onConnect={() => setQrInstance(inst)}
                onDelete={() => handleDelete(inst.id)}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>

          {/* Right: event log */}
          <div className="lg:col-span-2">
            {selectedInstance ? (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">📋</span>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{selectedInstance.name}</p>
                      <p className="text-[10px] text-gray-400">Real-time event log</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedInstance.status} />
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Live
                    </div>
                  </div>
                </div>

                {/* Event log */}
                <EventLogPanel
                  key={selectedInstance.id}
                  instanceId={selectedInstance.id}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-100 rounded-2xl text-sm text-gray-400">
                Select a line to view its events
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAdd && propertyId && (
        <AddInstanceModal
          propertyId={propertyId}
          onCreated={handleCreated}
          onClose={() => setShowAdd(false)}
        />
      )}
      {qrInstance && (
        <QrModal
          instance={qrInstance}
          onClose={() => setQrInstance(null)}
          onConnected={inst => {
            handleStatusChange(inst)
            setQrInstance(null)
          }}
        />
      )}
    </div>
  )
}
