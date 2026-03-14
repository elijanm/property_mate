import { useState, useEffect } from 'react'
import { sshApi, tailscaleApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import type { Device, SSHAccessRequest } from '@/types/iot'

interface Props {
  device: Device
  onClose: () => void
  onCreated: (request: SSHAccessRequest) => void
}

interface TsNode { name: string; ip: string }

const DURATION_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
]

// Device UIDs follow the pattern XXXX-nn (all caps + digits + dash) — used to
// filter device nodes out and leave only admin/laptop nodes in the picker.
function looksLikeDevice(name: string) {
  return /^[A-Z0-9]+-\d+$/.test(name)
}

export default function SSHRequestModal({ device, onClose, onCreated }: Props) {
  if (!device) return null
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState(60)
  const [requesterIp, setRequesterIp] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [tsNodes, setTsNodes] = useState<TsNode[]>([])

  useEffect(() => {
    tailscaleApi.listNodes()
      .then((data: any) => {
        const raw: any[] = Array.isArray(data) ? data : (data?.nodes ?? [])
        const nodes: TsNode[] = raw
          .map((n: any) => ({
            name: n.name ?? n.hostname ?? '',
            ip: (n.ipAddresses ?? n.ip_addresses ?? [])[0] ?? '',
          }))
          .filter(n => n.ip && !looksLikeDevice(n.name))
        setTsNodes(nodes)
        // Auto-populate with first non-device node
        if (nodes.length > 0 && !requesterIp) setRequesterIp(nodes[0].ip)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit() {
    if (!reason.trim()) { setError('Reason is required'); return }
    setError('')
    setSaving(true)
    try {
      const result = await sshApi.createRequest({
        target_type: 'device',
        target_id: device.id,
        reason: reason.trim(),
        requested_duration_m: duration,
        requester_tailscale_ip: (requesterIp === '__manual__' || !requesterIp.trim()) ? undefined : requesterIp.trim(),
      })
      setSubmitted(true)
      onCreated(result)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">Request SSH Access</h3>
            <p className="text-sm text-gray-500 mt-0.5">Target: <strong>{device.name}</strong></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {submitted ? (
          <div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
              <p className="font-semibold text-green-800 text-sm">Request Submitted</p>
              <p className="text-sm text-green-700 mt-1">
                Awaiting approval. You will receive an email when your request is approved or denied.
              </p>
            </div>
            {device.tailscale_ip && (
              <div className="bg-gray-50 rounded-xl p-4 text-xs font-mono text-gray-700 mb-4">
                <p className="text-xs text-gray-500 mb-1">SSH command (once approved):</p>
                <code>ssh root@{device.tailscale_ip}</code>
              </div>
            )}
            <button onClick={onClose} className="w-full py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-xl">
              Close
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {!device.tailscale_ip && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                This device has no Tailscale IP. SSH access requires Tailscale/Headscale registration.
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Reason *</label>
              <textarea
                className="input w-full text-sm h-24 resize-none"
                placeholder="Why do you need SSH access? (required)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Duration</label>
              <select
                className="input w-full text-sm"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              >
                {DURATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Your Tailscale IP (optional)</label>
              {tsNodes.length > 0 ? (
                <select
                  className="input w-full text-sm font-mono"
                  value={requesterIp}
                  onChange={e => setRequesterIp(e.target.value)}
                >
                  <option value="">— select your node —</option>
                  {tsNodes.map(n => (
                    <option key={n.ip} value={n.ip}>{n.name} ({n.ip})</option>
                  ))}
                  <option value="__manual__">Enter manually…</option>
                </select>
              ) : (
                <input
                  type="text"
                  className="input w-full text-sm font-mono"
                  placeholder="100.x.x.x"
                  value={requesterIp}
                  onChange={e => setRequesterIp(e.target.value)}
                />
              )}
              {requesterIp === '__manual__' && (
                <input
                  type="text"
                  className="input w-full text-sm font-mono mt-1"
                  placeholder="100.x.x.x"
                  autoFocus
                  onChange={e => setRequesterIp(e.target.value)}
                />
              )}
              <p className="text-xs text-gray-400 mt-0.5">Your Tailscale/VPN IP — used to grant you SSH access via Headscale ACL</p>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !reason.trim()}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
