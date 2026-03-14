import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import {
  devicesApi,
  sshApi,
  alertRulesApi,
  otaApi,
  fleetsApi,
  deviceTypesApi,
} from '@/api/iot'
import { unitsApi } from '@/api/units'
import type {
  Device,
  DeviceStatus,
  DeviceCategory,
  ProvisionedDevice,
  SSHAccessRequest,
  AlertRule,
  OTAUpdate,
  DeviceGroup,
} from '@/types/iot'
import RegisterDeviceWizard from '@/components/iot/RegisterDeviceWizard'
import DeviceDetailSlideOver from '@/components/iot/DeviceDetailSlideOver'
import SSHRequestModal from '@/components/iot/SSHRequestModal'
import AlertRuleSlideOver from '@/components/iot/AlertRuleSlideOver'
import OTAUploadModal from '@/components/iot/OTAUploadModal'
import FleetSlideOver from '@/components/iot/FleetSlideOver'
import DeviceTypeSlideOver from '@/components/iot/DeviceTypeSlideOver'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-KE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function timeAgo(s?: string) {
  if (!s) return '—'
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Status Dot ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: DeviceStatus }) {
  if (status === 'online') {
    return (
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
    )
  }
  const colors: Record<DeviceStatus, string> = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    quarantined: 'bg-red-500',
    provisioned: 'bg-yellow-400',
    decommissioned: 'bg-gray-300',
  }
  return <span className={`inline-flex h-2.5 w-2.5 rounded-full ${colors[status]}`} />
}

function StatusBadge({ status }: { status: DeviceStatus }) {
  const styles: Record<DeviceStatus, string> = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-gray-100 text-gray-600',
    quarantined: 'bg-red-100 text-red-700',
    provisioned: 'bg-yellow-100 text-yellow-800',
    decommissioned: 'bg-gray-100 text-gray-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      <StatusDot status={status} />
      {status}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-yellow-100 text-yellow-800',
    critical: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[severity] ?? 'bg-gray-100 text-gray-600'}`}>
      {severity}
    </span>
  )
}

function OTAStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    active: 'bg-blue-100 text-blue-700',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function SSHStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    expired: 'bg-gray-100 text-gray-600',
    revoked: 'bg-red-100 text-red-700',
    denied: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────

type Tab = 'devices' | 'device-types' | 'ssh' | 'ota' | 'alert-rules' | 'fleets' | 'security'

const TABS: { id: Tab; label: string }[] = [
  { id: 'devices', label: 'Devices' },
  { id: 'device-types', label: 'Device Types' },
  { id: 'ssh', label: 'SSH Access' },
  { id: 'ota', label: 'OTA' },
  { id: 'alert-rules', label: 'Alert Rules' },
  { id: 'fleets', label: 'Fleets' },
  { id: 'security', label: 'Security' },
]

// ── Category label map ────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  smart_lock: 'Smart Lock',
  meter: 'Meter',
  sensor: 'Sensor',
  camera: 'Camera',
  gateway: 'Gateway',
  lora_node: 'LoRa Node',
  modbus: 'Modbus',
  custom: 'Custom',
}

// ── Device Row Context Menu ────────────────────────────────────────────────

interface DeviceMenuProps {
  device: Device
  onDetail: () => void
  onSSH: () => void
  onRotate: () => void
  onQuarantine: () => void
  onUnquarantine: () => void
  onDecommission: () => void
}

function DeviceRowMenu({ device, onDetail, onSSH, onRotate, onQuarantine, onUnquarantine, onDecommission }: DeviceMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const canSSH = device.capabilities.ssh && device.status === 'online' && !!device.tailscale_ip

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // Menu width ~208px; position below button, align right edge
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - 208,
      })
    }
    setOpen(v => !v)
  }

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="px-2 py-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded text-sm"
      >
        ···
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] w-52 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden text-sm"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button onClick={() => { setOpen(false); onDetail() }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50">
              View Details
            </button>
            {canSSH && (
              <button onClick={() => { setOpen(false); onSSH() }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50">
                Open SSH Terminal
              </button>
            )}
            <button onClick={() => { setOpen(false); onRotate() }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50">
              Rotate Credentials
            </button>
            <div className="border-t border-gray-100" />
            {device.status === 'quarantined' ? (
              <button onClick={() => { setOpen(false); onUnquarantine() }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-green-700">
                Unquarantine
              </button>
            ) : (
              <button onClick={() => { setOpen(false); onQuarantine() }} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-yellow-700">
                Quarantine Device
              </button>
            )}
            <button onClick={() => { setOpen(false); onDecommission() }} className="w-full text-left px-4 py-2.5 hover:bg-red-50 text-red-600">
              Decommission
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Devices Tab ───────────────────────────────────────────────────────────

interface DevicesTabProps {
  devices: Device[]
  unitMap: Record<string, string>
  loading: boolean
  error: string
  filterStatus: string
  filterCategory: string
  search: string
  page: number
  pageSize: number
  total: number
  onFilterStatus: (v: string) => void
  onFilterCategory: (v: string) => void
  onSearch: (v: string) => void
  onPage: (p: number) => void
  onDetail: (d: Device) => void
  onSSH: (d: Device) => void
  onRotate: (d: Device) => void
  onQuarantine: (d: Device) => void
  onUnquarantine: (d: Device) => void
  onDecommission: (d: Device) => void
}

function DevicesTab({
  devices, unitMap, loading, error,
  filterStatus, filterCategory, search, page, pageSize, total,
  onFilterStatus, onFilterCategory, onSearch, onPage,
  onDetail, onSSH, onRotate, onQuarantine, onUnquarantine, onDecommission,
}: DevicesTabProps) {
  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <select
          className="input text-sm"
          value={filterStatus}
          onChange={e => onFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          {(['online', 'offline', 'provisioned', 'quarantined', 'decommissioned'] as DeviceStatus[]).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="input text-sm"
          value={filterCategory}
          onChange={e => onFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {(Object.keys(CATEGORY_LABELS) as DeviceCategory[]).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <input
          type="text"
          className="input text-sm flex-1"
          placeholder="Search by name, UID, serial..."
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tailscale IP</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Firmware</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Seen</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={8} className="text-center py-10 text-sm text-gray-400">Loading devices…</td></tr>
            )}
            {!loading && devices.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <div className="text-4xl mb-2">📡</div>
                  <p className="text-sm text-gray-500">No devices found for this property</p>
                </td>
              </tr>
            )}
            {devices.map(device => (
              <tr
                key={device.id}
                className={`hover:bg-gray-50 cursor-pointer ${device.status === 'decommissioned' ? 'opacity-50' : ''}`}
                onClick={() => onDetail(device)}
              >
                <td className="px-4 py-3">
                  <StatusBadge status={device.status} />
                </td>
                <td className="px-4 py-3">
                  <div className={`font-medium text-gray-900 ${device.status === 'decommissioned' ? 'line-through' : ''}`}>
                    {device.name}
                  </div>
                  <div className="text-xs text-gray-400">{device.device_uid}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {CATEGORY_LABELS[device.device_type_category] ?? device.device_type_category}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {device.unit_id
                    ? <span className="text-xs font-medium">{unitMap[device.unit_id] ?? device.unit_id.slice(-8)}</span>
                    : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">
                  {device.tailscale_ip ?? '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">
                  {device.firmware_version ?? '—'}
                  {device.ota_pending_version && (
                    <span className="ml-1.5 text-blue-600">→ {device.ota_pending_version}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {timeAgo(device.last_seen_at)}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <DeviceRowMenu
                    device={device}
                    onDetail={() => onDetail(device)}
                    onSSH={() => onSSH(device)}
                    onRotate={() => onRotate(device)}
                    onQuarantine={() => onQuarantine(device)}
                    onUnquarantine={() => onUnquarantine(device)}
                    onDecommission={() => onDecommission(device)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{total} total</p>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => onPage(page - 1)}
                className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Prev
              </button>
              <button
                disabled={page * pageSize >= total}
                onClick={() => onPage(page + 1)}
                className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── SSH Tab ───────────────────────────────────────────────────────────────

interface SSHTabProps {
  propertyId: string
  devices: Device[]
  onOpenSSHRequest: (device?: Device) => void
}

function SSHTab({ propertyId, devices: _devices, onOpenSSHRequest }: SSHTabProps) {
  const [requests, setRequests] = useState<SSHAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await sshApi.listRequests({ property_id: propertyId })
      setRequests(Array.isArray(data) ? data : (data as any).items ?? [])
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId])

  const pending = requests.filter(r => r.status === 'pending')
  const active = requests.filter(r => r.status === 'active')

  async function handleApprove(id: string) {
    try { await sshApi.approve(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }
  async function handleDeny(id: string) {
    const reason = window.prompt('Denial reason:')
    if (reason == null) return
    try { await sshApi.deny(id, reason); load() }
    catch (err) { alert(extractApiError(err).message) }
  }
  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this SSH session?')) return
    try { await sshApi.revoke(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading SSH requests…</p>
  if (error) return <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Pending Requests */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Pending Requests ({pending.length})</h3>
        <div className="space-y-3">
          {pending.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">
              No pending SSH requests
            </div>
          )}
          {pending.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{r.target_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{r.reason}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {r.requested_duration_m}m · {fmtDateTime(r.created_at)}
                  </p>
                </div>
                <SSHStatusBadge status={r.status} />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleApprove(r.id)}
                  className="flex-1 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDeny(r.id)}
                  className="flex-1 py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Sessions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Active Sessions ({active.length})</h3>
          <button
            onClick={() => onOpenSSHRequest()}
            className="px-3 py-1.5 text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg"
          >
            + Request SSH Access
          </button>
        </div>
        <div className="space-y-3">
          {active.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">
              No active SSH sessions
            </div>
          )}
          {active.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{r.target_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">{r.target_tailscale_ip}:{r.target_port}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Expires: {fmtDateTime(r.expires_at)}
                  </p>
                </div>
                <SSHStatusBadge status={r.status} />
              </div>
              <button
                onClick={() => handleRevoke(r.id)}
                className="mt-3 w-full py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── OTA Tab ────────────────────────────────────────────────────────────────

interface OTATabProps {
  propertyId: string
  onUpload: () => void
}

function OTATab({ onUpload }: OTATabProps) {
  const [updates, setUpdates] = useState<OTAUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await otaApi.list()
      setUpdates(Array.isArray(data) ? data : (data as any).items ?? [])
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleStart(id: string) {
    try { await otaApi.start(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }
  async function handlePause(id: string) {
    try { await otaApi.pause(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }
  async function handleCancel(id: string) {
    if (!window.confirm('Cancel this OTA update?')) return
    try { await otaApi.cancel(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading OTA updates…</p>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={onUpload}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + Upload Firmware
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>}

      <div className="space-y-3">
        {updates.length === 0 && !loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="text-4xl mb-2">📦</div>
            <p className="text-sm text-gray-500">No OTA updates yet</p>
          </div>
        )}
        {updates.map(ota => {
          const completed = ota.device_statuses.filter(d => d.status === 'completed').length
          const total = ota.device_statuses.length
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0
          return (
            <div key={ota.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">v{ota.target_version}</span>
                    <OTAStatusBadge status={ota.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{ota.release_notes ?? 'No release notes'}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {completed}/{total} devices · {ota.rollout_pct}% rollout · {fmtDate(ota.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {ota.status === 'draft' && (
                    <button onClick={() => handleStart(ota.id)} className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                      Start
                    </button>
                  )}
                  {ota.status === 'active' && (
                    <button onClick={() => handlePause(ota.id)} className="px-3 py-1 text-xs font-semibold text-yellow-700 border border-yellow-200 hover:bg-yellow-50 rounded-lg">
                      Pause
                    </button>
                  )}
                  {['draft', 'active', 'paused'].includes(ota.status) && (
                    <button onClick={() => handleCancel(ota.id)} className="px-3 py-1 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg">
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              {total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Alert Rules Tab ────────────────────────────────────────────────────────

interface AlertRulesTabProps {
  propertyId: string
  onNew: () => void
  onEdit: (rule: AlertRule) => void
}

function AlertRulesTab({ propertyId, onNew, onEdit }: AlertRulesTabProps) {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await alertRulesApi.list({ property_id: propertyId })
      setRules(Array.isArray(data) ? data : (data as any).items ?? [])
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId])

  async function handleToggle(rule: AlertRule) {
    try {
      const updated = await alertRulesApi.toggle(rule.id, !rule.is_active)
      setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this alert rule?')) return
    try { await alertRulesApi.delete(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }

  const OPERATOR_LABELS: Record<string, string> = {
    gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', neq: '≠',
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading alert rules…</p>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={onNew}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + New Rule
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Condition</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Severity</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Scope</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <div className="text-4xl mb-2">🔔</div>
                  <p className="text-sm text-gray-500">No alert rules configured</p>
                </td>
              </tr>
            )}
            {rules.map(rule => (
              <tr key={rule.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{rule.name}</p>
                  {rule.description && <p className="text-xs text-gray-400">{rule.description}</p>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {rule.telemetry_key} {OPERATOR_LABELS[rule.operator]} {rule.threshold}
                </td>
                <td className="px-4 py-3"><SeverityBadge severity={rule.severity} /></td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {rule.device_id ? 'Device' : rule.device_type_id ? 'Device Type' : 'Property'}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full transition-colors ${rule.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${rule.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => onEdit(rule)} className="text-xs text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Fleets Tab ─────────────────────────────────────────────────────────────

interface FleetsTabProps {
  propertyId: string
  devices: Device[]
  onNew: () => void
  onEdit: (fleet: DeviceGroup) => void
}

function FleetsTab({ propertyId, devices: _devices, onNew, onEdit }: FleetsTabProps) {
  const [fleets, setFleets] = useState<DeviceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await fleetsApi.list({ property_id: propertyId })
      setFleets(Array.isArray(data) ? data : (data as any).items ?? [])
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this fleet?')) return
    try { await fleetsApi.delete(id); load() }
    catch (err) { alert(extractApiError(err).message) }
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading fleets…</p>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={onNew}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + New Fleet
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        {fleets.length === 0 && (
          <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="text-4xl mb-2">🚀</div>
            <p className="text-sm text-gray-500">No fleets yet. Group devices for bulk management.</p>
          </div>
        )}
        {fleets.map(fleet => {
          const memberCount = fleet.member_count ?? fleet.device_ids.length
          return (
            <div key={fleet.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{fleet.name}</p>
                  {fleet.description && <p className="text-xs text-gray-500 mt-0.5">{fleet.description}</p>}
                  <p className="text-xs text-gray-400 mt-2">{memberCount} devices</p>
                  {fleet.tag_filter && (
                    <p className="text-xs text-gray-400">Tag filter: <span className="font-mono">{fleet.tag_filter}</span></p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => onEdit(fleet)} className="flex-1 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg">
                  Edit
                </button>
                <button onClick={() => handleDelete(fleet.id)} className="py-1.5 px-3 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg">
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Security Tab ───────────────────────────────────────────────────────────

interface SecurityTabProps {
  propertyId: string
  devices: Device[]
  onRotateCredentials: (device: Device) => void
}

function SecurityTab({ devices, onRotateCredentials }: SecurityTabProps) {
  const [auditLogs, setAuditLogs] = useState<import('@/types/iot').SSHAuditLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)

  useEffect(() => {
    sshApi.listAuditLogs({ page: 1, page_size: 20 })
      .then(d => setAuditLogs(Array.isArray(d) ? d : (d as any).items ?? []))
      .catch(() => {})
      .finally(() => setLogsLoading(false))
  }, [])

  const now = Date.now()
  const certUrgency = (expiresAt?: string) => {
    if (!expiresAt) return 'none'
    const diff = new Date(expiresAt).getTime() - now
    const days = diff / 86400000
    if (days < 0) return 'expired'
    if (days < 7) return 'critical'
    if (days < 30) return 'warning'
    return 'ok'
  }

  const quarantined = devices.filter(d => d.status === 'quarantined')

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Certificates */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Certificates</h3>
        <div className="space-y-2">
          {devices.filter(d => d.cert_expires_at).map(d => {
            const urgency = certUrgency(d.cert_expires_at)
            const colors = { ok: 'text-green-700', warning: 'text-yellow-700', critical: 'text-red-600', expired: 'text-red-800', none: 'text-gray-400' }
            return (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 truncate">{d.name}</span>
                <span className={`text-xs font-mono ${colors[urgency]}`}>
                  {fmtDate(d.cert_expires_at)}
                </span>
              </div>
            )
          })}
          {devices.filter(d => d.cert_expires_at).length === 0 && (
            <p className="text-sm text-gray-400">No certificate data</p>
          )}
        </div>
      </div>

      {/* Quarantine Log */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Quarantine Log ({quarantined.length})</h3>
        <div className="space-y-2">
          {quarantined.length === 0 && <p className="text-sm text-gray-400">No quarantined devices</p>}
          {quarantined.map(d => (
            <div key={d.id} className="text-sm">
              <p className="font-medium text-red-700">{d.name}</p>
              <p className="text-xs text-gray-500">{d.quarantine_reason ?? 'No reason provided'}</p>
              <p className="text-xs text-gray-400">{fmtDateTime(d.quarantined_at)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* SSH Session Log */}
      <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">SSH Session Log</h3>
        {logsLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-left py-2 pr-4">Session Start</th>
                <th className="text-left py-2 pr-4">Duration</th>
                <th className="text-left py-2 pr-4">Source IP</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2">Reason</th>
                <th className="text-left py-2">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">No SSH sessions recorded</td>
                </tr>
              )}
              {auditLogs.map(log => (
                <tr key={log.id}>
                  <td className="py-2 pr-4 text-gray-600">{fmtDateTime(log.session_start)}</td>
                  <td className="py-2 pr-4 text-gray-600">
                    {log.duration_seconds != null ? `${Math.floor(log.duration_seconds / 60)}m ${log.duration_seconds % 60}s` : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-600">{log.source_ip}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${log.status === 'completed' ? 'bg-green-100 text-green-700' : log.status === 'terminated' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{log.termination_reason ?? '—'}</td>
                  <td className="py-2">
                    {log.recording_s3_key && (
                      <a
                        href={`#replay-${log.id}`}
                        className="text-blue-600 hover:underline text-xs"
                        onClick={async (e) => {
                          e.preventDefault()
                          try {
                            const res = await sshApi.getReplayUrl(log.ssh_request_id, log.id)
                            window.open(res.replay_url, '_blank')
                          } catch {
                            alert('Unable to load replay URL')
                          }
                        }}
                      >
                        ▶ Replay
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Credentials */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Credentials</h3>
        <div className="space-y-2">
          {devices.map(d => (
            <div key={d.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-700 truncate mr-2">{d.name}</span>
              <button
                onClick={() => onRotateCredentials(d)}
                className="text-xs text-blue-600 hover:underline flex-shrink-0"
              >
                Rotate
              </button>
            </div>
          ))}
          {devices.length === 0 && <p className="text-sm text-gray-400">No devices</p>}
        </div>
      </div>

      {/* Config */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2">⚙️</div>
          <p className="text-sm font-medium text-gray-700">Security Config</p>
          <p className="text-xs text-gray-400 mt-1">Coming soon</p>
        </div>
      </div>
    </div>
  )
}

// ── Quarantine Modal ───────────────────────────────────────────────────────

interface QuarantineModalProps {
  device: Device
  onClose: () => void
  onQuarantined: (d: Device) => void
}

function QuarantineModal({ device, onClose, onQuarantined }: QuarantineModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!reason.trim()) { setError('Reason is required'); return }
    setSaving(true)
    try {
      const updated = await devicesApi.quarantine(device.id, { reason })
      onQuarantined(updated)
      onClose()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Quarantine Device</h3>
        <p className="text-sm text-gray-500 mb-4">Quarantining <strong>{device.name}</strong> will block all MQTT/SSH access.</p>
        <textarea
          className="input w-full text-sm h-24 resize-none"
          placeholder="Reason for quarantine (required)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50"
          >
            {saving ? 'Quarantining…' : 'Quarantine'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RotateCredentials Modal ────────────────────────────────────────────────

interface RotateCredentialsModalProps {
  device: Device
  onClose: () => void
}

function RotateCredentialsModal({ device, onClose }: RotateCredentialsModalProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProvisionedDevice | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleRotate() {
    setLoading(true)
    try {
      const data = await devicesApi.rotateCredentials(device.id)
      setResult(data)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  function copyPassword() {
    if (!result?.mqtt_password) return
    navigator.clipboard.writeText(result.mqtt_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-1">Rotate Credentials</h3>
        <p className="text-sm text-gray-500 mb-4">Generate new MQTT credentials for <strong>{device.name}</strong>. Old credentials will stop working immediately.</p>

        {!result && (
          <>
            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleRotate}
                disabled={loading}
                className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
              >
                {loading ? 'Rotating…' : 'Rotate Credentials'}
              </button>
            </div>
          </>
        )}

        {result && (
          <div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              <p className="text-xs text-amber-800 font-semibold">Save this password — it will not be shown again</p>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">MQTT Username</label>
                <p className="font-mono text-sm text-gray-800">{result.mqtt_username}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500">MQTT Password</label>
                <div className="flex items-center gap-2 mt-1">
                  <p className="font-mono text-sm text-gray-800 flex-1 bg-gray-50 rounded px-2 py-1 border border-gray-200 truncate">
                    {result.mqtt_password}
                  </p>
                  <button onClick={copyPassword} className="px-3 py-1 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="mt-4 w-full py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-xl">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Device Types Tab ──────────────────────────────────────────────────────

function DeviceTypesTab() {
  const [types, setTypes] = useState<import('@/types/iot').DeviceType[]>([])
  const [loading, setLoading] = useState(true)
  const [showSlideOver, setShowSlideOver] = useState(false)
  const [editing, setEditing] = useState<import('@/types/iot').DeviceType | undefined>()
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await deviceTypesApi.list()
      setTypes(Array.isArray(data) ? data : (data as any).items ?? [])
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    if (!confirm('Delete this device type? Existing devices will not be affected.')) return
    try {
      await deviceTypesApi.delete(id)
      setTypes(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      setError(extractApiError(err).message)
    }
  }

  const CAT_ICONS: Record<string, string> = {
    smart_lock: '🔒', meter: '📊', sensor: '🌡️', camera: '📷',
    gateway: '📡', lora_node: '📶', modbus: '⚙️', custom: '🔧',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-900">Device Types</h3>
          <p className="text-sm text-slate-500 mt-0.5">Templates that define capabilities, telemetry schema, and RPC commands for your devices</p>
        </div>
        <button
          onClick={() => { setEditing(undefined); setShowSlideOver(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          + New Device Type
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : types.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
          <span className="text-4xl block mb-3">📡</span>
          <p className="text-slate-600 font-medium">No device types yet</p>
          <p className="text-sm text-slate-400 mt-1">Create a type to define the capabilities and telemetry schema for your IoT devices</p>
          <button
            onClick={() => { setEditing(undefined); setShowSlideOver(true) }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            + New Device Type
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map(dt => (
            <div key={dt.id} className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{dt.icon || CAT_ICONS[dt.category] || '🔧'}</span>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{dt.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{dt.category.replace('_', ' ')} · {dt.protocol.toUpperCase()}</p>
                  </div>
                </div>
                {!dt.org_id && (
                  <span className="text-xs bg-purple-100 text-purple-700 font-medium px-2 py-0.5 rounded-full">Platform</span>
                )}
              </div>

              {/* Description */}
              {dt.description && (
                <p className="text-xs text-slate-500 line-clamp-2">{dt.description}</p>
              )}

              {/* Capability chips */}
              <div className="flex flex-wrap gap-1.5">
                {dt.capabilities.map(cap => (
                  <span key={cap} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">{cap}</span>
                ))}
                {dt.ota_supported && (
                  <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">OTA</span>
                )}
              </div>

              {/* Schema summary */}
              <div className="flex gap-3 text-xs text-slate-500">
                <span>📈 {dt.telemetry_schema.length} telemetry fields</span>
                {dt.rpc_commands.length > 0 && <span>⚡ {dt.rpc_commands.length} commands</span>}
              </div>

              {/* Actions — only for org-owned types */}
              {dt.org_id && (
                <div className="flex gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => { setEditing(dt); setShowSlideOver(true) }}
                    className="flex-1 text-xs text-slate-600 hover:text-blue-600 font-medium py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(dt.id)}
                    className="flex-1 text-xs text-slate-600 hover:text-red-600 font-medium py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showSlideOver && (
        <DeviceTypeSlideOver
          deviceType={editing}
          onClose={() => { setShowSlideOver(false); setEditing(undefined) }}
          onSaved={dt => {
            setShowSlideOver(false)
            setEditing(undefined)
            if (editing) {
              setTypes(prev => prev.map(t => t.id === dt.id ? dt : t))
            } else {
              setTypes(prev => [...prev, dt])
            }
          }}
        />
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function PropertySmartDevicesPage() {
  const { propertyId } = useParams<{ propertyId: string }>()

  const [devices, setDevices] = useState<Device[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('devices')
  const [unitMap, setUnitMap] = useState<Record<string, string>>({})

  const [showRegister, setShowRegister] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showSSHRequest, setShowSSHRequest] = useState(false)
  const [sshTargetDevice, setSshTargetDevice] = useState<Device | null>(null)
  const [showQuarantine, setShowQuarantine] = useState(false)
  const [quarantineTarget, setQuarantineTarget] = useState<Device | null>(null)
  const [showRotate, setShowRotate] = useState(false)
  const [rotateTarget, setRotateTarget] = useState<Device | null>(null)
  const [showAlertRule, setShowAlertRule] = useState(false)
  const [editAlertRule, setEditAlertRule] = useState<AlertRule | undefined>(undefined)
  const [showOTAUpload, setShowOTAUpload] = useState(false)
  const [showFleet, setShowFleet] = useState(false)
  const [editFleet, setEditFleet] = useState<DeviceGroup | undefined>(undefined)

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  async function load() {
    if (!propertyId) return
    setLoading(true)
    setError('')
    try {
      const data = await devicesApi.list({
        property_id: propertyId,
        status: filterStatus || undefined,
        category: filterCategory || undefined,
        search: search || undefined,
        page,
        page_size: pageSize,
      })
      const items = Array.isArray(data) ? data : (data as any).items ?? []
      const total = Array.isArray(data) ? data.length : (data as any).total ?? 0
      setDevices(items)
      setTotal(total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [propertyId, filterStatus, filterCategory, search, page])

  useEffect(() => {
    if (!propertyId) return
    unitsApi.list(propertyId, { page_size: 200 }).then(data => {
      const items = Array.isArray(data) ? data : (data as any).items ?? []
      const map: Record<string, string> = {}
      items.forEach((u: { id: string; unit_code: string }) => { map[u.id] = u.unit_code })
      setUnitMap(map)
    }).catch(() => {})
  }, [propertyId])

  async function handleUnquarantine(device: Device) {
    if (!window.confirm(`Unquarantine ${device.name}?`)) return
    try {
      const updated = await devicesApi.unquarantine(device.id)
      setDevices(prev => prev.map(d => d.id === device.id ? updated : d))
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleDecommission(device: Device) {
    if (!window.confirm(`Decommission ${device.name}? This cannot be undone.`)) return
    try {
      await devicesApi.delete(device.id)
      load()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Smart Devices" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Smart Devices</h1>
          <p className="text-sm text-gray-500 mt-0.5">IoT device management for this property</p>
        </div>
        <button
          onClick={() => setShowRegister(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + Register Device
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'devices' && propertyId && (
        <DevicesTab
          devices={devices}
          unitMap={unitMap}
          loading={loading}
          error={error}
          filterStatus={filterStatus}
          filterCategory={filterCategory}
          search={search}
          page={page}
          pageSize={pageSize}
          total={total}
          onFilterStatus={v => { setFilterStatus(v); setPage(1) }}
          onFilterCategory={v => { setFilterCategory(v); setPage(1) }}
          onSearch={v => { setSearch(v); setPage(1) }}
          onPage={setPage}
          onDetail={d => { setSelectedDevice(d); setShowDetail(true) }}
          onSSH={d => { setSshTargetDevice(d); setShowSSHRequest(true) }}
          onRotate={d => { setRotateTarget(d); setShowRotate(true) }}
          onQuarantine={d => { setQuarantineTarget(d); setShowQuarantine(true) }}
          onUnquarantine={handleUnquarantine}
          onDecommission={handleDecommission}
        />
      )}

      {activeTab === 'device-types' && (
        <DeviceTypesTab />
      )}

      {activeTab === 'ssh' && propertyId && (
        <SSHTab
          propertyId={propertyId}
          devices={devices}
          onOpenSSHRequest={device => {
            setSshTargetDevice(device ?? null)
            setShowSSHRequest(true)
          }}
        />
      )}

      {activeTab === 'ota' && propertyId && (
        <OTATab
          propertyId={propertyId}
          onUpload={() => setShowOTAUpload(true)}
        />
      )}

      {activeTab === 'alert-rules' && propertyId && (
        <AlertRulesTab
          propertyId={propertyId}
          onNew={() => { setEditAlertRule(undefined); setShowAlertRule(true) }}
          onEdit={rule => { setEditAlertRule(rule); setShowAlertRule(true) }}
        />
      )}

      {activeTab === 'fleets' && propertyId && (
        <FleetsTab
          propertyId={propertyId}
          devices={devices}
          onNew={() => { setEditFleet(undefined); setShowFleet(true) }}
          onEdit={fleet => { setEditFleet(fleet); setShowFleet(true) }}
        />
      )}

      {activeTab === 'security' && propertyId && (
        <SecurityTab
          propertyId={propertyId}
          devices={devices}
          onRotateCredentials={d => { setRotateTarget(d); setShowRotate(true) }}
        />
      )}

      {/* Modals / Slide-Overs */}
      {showRegister && propertyId && (
        <RegisterDeviceWizard
          propertyId={propertyId}
          onClose={() => setShowRegister(false)}
          onRegistered={async (result) => {
            setShowRegister(false)
            // Immediately fetch the newly-registered device and prepend it so it
            // shows up without waiting for the full list reload
            try {
              const newDev = await devicesApi.get(result.device_id)
              setDevices(prev => [newDev as unknown as Device, ...prev.filter(d => d.id !== result.device_id)])
              setTotal(prev => prev + 1)
            } catch {}
            load()
          }}
        />
      )}

      {showDetail && selectedDevice && (
        <DeviceDetailSlideOver
          device={selectedDevice}
          unitMap={unitMap}
          onClose={() => { setShowDetail(false); setSelectedDevice(null) }}
          onUpdated={updated => {
            setDevices(prev => prev.map(d => d.id === updated.id ? updated : d))
            setSelectedDevice(updated)
          }}
        />
      )}

      {showSSHRequest && sshTargetDevice && (
        <SSHRequestModal
          device={sshTargetDevice}
          onClose={() => { setShowSSHRequest(false); setSshTargetDevice(null) }}
          onCreated={() => { setShowSSHRequest(false); setSshTargetDevice(null) }}
        />
      )}

      {showSSHRequest && !sshTargetDevice && devices.length > 0 && (
        <SSHRequestModal
          device={devices[0]}
          onClose={() => setShowSSHRequest(false)}
          onCreated={() => setShowSSHRequest(false)}
        />
      )}

      {showQuarantine && quarantineTarget && (
        <QuarantineModal
          device={quarantineTarget}
          onClose={() => { setShowQuarantine(false); setQuarantineTarget(null) }}
          onQuarantined={updated => {
            setDevices(prev => prev.map(d => d.id === updated.id ? updated : d))
            setShowQuarantine(false)
            setQuarantineTarget(null)
          }}
        />
      )}

      {showRotate && rotateTarget && (
        <RotateCredentialsModal
          device={rotateTarget}
          onClose={() => { setShowRotate(false); setRotateTarget(null) }}
        />
      )}

      {showAlertRule && propertyId && (
        <AlertRuleSlideOver
          propertyId={propertyId}
          rule={editAlertRule}
          onClose={() => { setShowAlertRule(false); setEditAlertRule(undefined) }}
          onSaved={() => { setShowAlertRule(false); setEditAlertRule(undefined) }}
        />
      )}

      {showOTAUpload && propertyId && (
        <OTAUploadModal
          propertyId={propertyId}
          onClose={() => setShowOTAUpload(false)}
          onUploaded={() => setShowOTAUpload(false)}
        />
      )}

      {showFleet && propertyId && (
        <FleetSlideOver
          propertyId={propertyId}
          fleet={editFleet}
          devices={devices}
          onClose={() => { setShowFleet(false); setEditFleet(undefined) }}
          onSaved={() => { setShowFleet(false); setEditFleet(undefined) }}
        />
      )}
    </div>
  )
}
