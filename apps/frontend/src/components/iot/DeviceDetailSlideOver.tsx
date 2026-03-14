import { useEffect, useRef, useState } from 'react'
import { devicesApi, commandsApi, sshApi, otaApi, syncApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import { useProperty } from '@/context/PropertyContext'
import { XTermConsole } from '@/components/iot/XTermConsole'
import { TelemetrySandbox } from '@/components/iot/TelemetrySandbox'
import type {
  Device,
  DeviceCommand,
  OTAUpdate,
  SSHAuditLog,
  SSHAccessRequest,
  ProvisionedDevice,
  DeviceStatus,
} from '@/types/iot'

interface Props {
  device: Device
  unitMap?: Record<string, string>
  onClose: () => void
  onUpdated: (device: Device) => void
}

type Tab = 'overview' | 'telemetry' | 'commands' | 'ota' | 'security' | 'ssh'
type SSHSubTab = 'requests' | 'logs' | 'terminal'

type TabDef = { id: Tab; label: string; requireSSH?: boolean }

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'commands', label: 'Commands' },
  { id: 'ota', label: 'OTA' },
  { id: 'security', label: 'Security' },
  { id: 'ssh', label: 'SSH', requireSSH: true },
]

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

function StatusBadge({ status }: { status: DeviceStatus }) {
  const styles: Record<DeviceStatus, string> = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-gray-100 text-gray-600',
    quarantined: 'bg-red-100 text-red-700',
    provisioned: 'bg-yellow-100 text-yellow-800',
    decommissioned: 'bg-gray-100 text-gray-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  )
}

function CommandStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-100 text-blue-700',
    acknowledged: 'bg-yellow-100 text-yellow-700',
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    timeout: 'bg-orange-100 text-orange-700',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 flex-shrink-0"
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

export default function DeviceDetailSlideOver({ device, unitMap = {}, onClose, onUpdated }: Props) {
  const property = useProperty()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [sshSubTab, setSshSubTab] = useState<SSHSubTab>('requests')
  const [telSubTab, setTelSubTab] = useState<'live' | 'sandbox'>('live')
  const [showOTAUpload, setShowOTAUpload] = useState(false)

  // ── Real-time device state ── poll /devices/{id} every 10s ────────────────
  const [liveDevice, setLiveDevice] = useState<Device>(device)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setLiveDevice(device)
  }, [device])

  useEffect(() => {
    const poll = async () => {
      try {
        const fresh = await devicesApi.get(device.id)
        setLiveDevice(fresh as Device)
        // Propagate status/tailscale_ip changes back to parent list
        if (fresh.status !== liveDevice.status || fresh.tailscale_ip !== liveDevice.tailscale_ip) {
          onUpdated(fresh as Device)
        }
      } catch {}
    }
    pollRef.current = setInterval(poll, 10_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [device.id])

  // Use liveDevice for rendering (keeps up-to-date without full parent re-render)
  const d = liveDevice

  // Commands tab state
  const [commandName, setCommandName] = useState('')
  const [commandParams, setCommandParams] = useState('{}')
  const [sendingCmd, setSendingCmd] = useState(false)
  const [cmdError, setCmdError] = useState('')
  const [commands, setCommands] = useState<DeviceCommand[]>([])
  const [cmdsLoading, setCmdsLoading] = useState(false)

  // OTA tab state
  const [otas, setOtas] = useState<OTAUpdate[]>([])
  const [otasLoading, setOtasLoading] = useState(false)

  // Security tab state
  const [showRotateConfirm, setShowRotateConfirm] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [rotateResult, setRotateResult] = useState<ProvisionedDevice | null>(null)
  const [rotateError, setRotateError] = useState('')
  const [copiedPwd, setCopiedPwd] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  const [quarantining, setQuarantining] = useState(false)
  const [quarantineError, setQuarantineError] = useState('')
  const [showQuarantineInput, setShowQuarantineInput] = useState(false)

  // SSH log tab state
  const [auditLogs, setAuditLogs] = useState<SSHAuditLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // SSH requests tab state
  const [sshRequests, setSshRequests] = useState<SSHAccessRequest[]>([])
  const [sshReqLoading, setSshReqLoading] = useState(false)
  const [showNewSSHReq, setShowNewSSHReq] = useState(false)
  const [sshReason, setSshReason] = useState('')
  const [sshDuration, setSshDuration] = useState(60)
  const [submittingSSH, setSubmittingSSH] = useState(false)
  const [sshReqError, setSshReqError] = useState('')

  // Telemetry tab state — rolling log of received payloads
  const [telemetryLog, setTelemetryLog] = useState<{ ts: string; data: Record<string, unknown> }[]>([])
  const [telemetryPollRef, setTelemetryPollRef] = useState<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (activeTab === 'telemetry') {
      const fetchTelemetry = async () => {
        try {
          const result = await devicesApi.getLastTelemetry(device.id)
          if (result.data && result.ts) {
            setTelemetryLog(prev => {
              // Only add if newer than the last entry
              if (prev.length > 0 && prev[0].ts === result.ts) return prev
              return [{ ts: result.ts!, data: result.data as Record<string, unknown> }, ...prev].slice(0, 50)
            })
          }
        } catch {}
      }
      fetchTelemetry()
      const interval = setInterval(fetchTelemetry, 5_000)
      setTelemetryPollRef(interval)
      return () => clearInterval(interval)
    } else {
      if (telemetryPollRef) { clearInterval(telemetryPollRef); setTelemetryPollRef(null) }
    }
  }, [activeTab, device.id])

  // CA cert — fetched once for all devices (needed for mTLS connection setup)
  const [caCertPem, setCaCertPem] = useState<string | null>(null)

  useEffect(() => {
    syncApi.getCACert().then(d => setCaCertPem(d.ca_cert_pem)).catch(() => {})
  }, [device.id])

  // Tailscale join state
  const [tsKeyLoading, setTsKeyLoading] = useState(false)
  const [tsPreauthData, setTsPreauthData] = useState<{ preauth_key: string; tailscale_cmd: string; docker_tailscale_cmd?: string } | null>(null)
  const [tsCmdMode, setTsCmdMode] = useState<'device' | 'docker'>('docker')
  const [tsSyncing, setTsSyncing] = useState(false)
  const [tsSyncResult, setTsSyncResult] = useState<{ synced: boolean; tailscale_ip?: string; message?: string } | null>(null)

  async function handleGetPreauthKey() {
    setTsKeyLoading(true)
    try {
      const data = await devicesApi.getTailscalePreauthKey(device.id)
      setTsPreauthData(data)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setTsKeyLoading(false)
    }
  }

  async function handleTailscaleSync() {
    setTsSyncing(true)
    setTsSyncResult(null)
    try {
      const result = await devicesApi.syncTailscaleNode(device.id)
      setTsSyncResult(result)
      if (result.synced) onUpdated({ ...device, tailscale_ip: result.tailscale_ip ?? null } as any)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setTsSyncing(false)
    }
  }

  // Tabs that need data
  useEffect(() => {
    if (activeTab === 'commands') {
      setCmdsLoading(true)
      commandsApi.list(device.id, { page_size: 20 })
        .then(d => setCommands(Array.isArray(d) ? d : (d as any).items ?? []))
        .catch(() => {})
        .finally(() => setCmdsLoading(false))
    }
    if (activeTab === 'ota') {
      setOtasLoading(true)
      otaApi.list()
        .then(d => setOtas(Array.isArray(d) ? d : (d as any).items ?? []))
        .catch(() => {})
        .finally(() => setOtasLoading(false))
    }
    if (activeTab === 'ssh' && sshSubTab === 'logs') {
      setLogsLoading(true)
      sshApi.listAuditLogs({ device_id: device.id, page_size: 20 })
        .then(d => setAuditLogs(Array.isArray(d) ? d : (d as any).items ?? []))
        .catch(() => {})
        .finally(() => setLogsLoading(false))
    }
    if (activeTab === 'ssh' && sshSubTab === 'requests') {
      setSshReqLoading(true)
      sshApi.listRequests({ target_id: device.id, page_size: 20 })
        .then(d => setSshRequests(Array.isArray(d) ? d : (d as any).items ?? []))
        .catch(() => {})
        .finally(() => setSshReqLoading(false))
    }
  }, [activeTab, sshSubTab, device.id])

  async function handleSendCommand() {
    setCmdError('')
    let params: Record<string, unknown> = {}
    try { params = JSON.parse(commandParams) } catch { setCmdError('Invalid JSON in params'); return }
    setSendingCmd(true)
    try {
      await commandsApi.send(device.id, { command_name: commandName, params })
      setCommandName('')
      setCommandParams('{}')
      // Reload commands
      const updated = await commandsApi.list(device.id, { page_size: 20 })
      setCommands(updated)
    } catch (err) {
      setCmdError(extractApiError(err).message)
    } finally {
      setSendingCmd(false)
    }
  }

  async function handleRotateCredentials() {
    setRotating(true)
    setRotateError('')
    try {
      const result = await devicesApi.rotateCredentials(device.id)
      setRotateResult(result)
      setShowRotateConfirm(false)
      onUpdated(result)
    } catch (err) {
      setRotateError(extractApiError(err).message)
    } finally {
      setRotating(false)
    }
  }

  async function handleQuarantine() {
    if (!quarantineReason.trim()) return
    setQuarantining(true)
    setQuarantineError('')
    try {
      const updated = await devicesApi.quarantine(device.id, { reason: quarantineReason })
      onUpdated(updated)
      setShowQuarantineInput(false)
    } catch (err) {
      setQuarantineError(extractApiError(err).message)
    } finally {
      setQuarantining(false)
    }
  }

  async function handleUnquarantine() {
    if (!window.confirm('Unquarantine this device?')) return
    try {
      const updated = await devicesApi.unquarantine(device.id)
      onUpdated(updated)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleSubmitSSHRequest() {
    if (!sshReason.trim()) return
    setSubmittingSSH(true)
    setSshReqError('')
    try {
      await sshApi.createRequest({
        target_type: 'device',
        target_id: device.id,
        reason: sshReason,
        requested_duration_m: sshDuration,
      })
      setSshReason('')
      setSshDuration(60)
      setShowNewSSHReq(false)
      // Refresh list
      const fresh = await sshApi.listRequests({ target_id: device.id, page_size: 20 })
      setSshRequests(Array.isArray(fresh) ? fresh : (fresh as any).items ?? [])
    } catch (err) {
      setSshReqError(extractApiError(err).message)
    } finally {
      setSubmittingSSH(false)
    }
  }

  async function handleSSHApprove(reqId: string) {
    try {
      await sshApi.approve(reqId)
      const fresh = await sshApi.listRequests({ target_id: device.id, page_size: 20 })
      setSshRequests(Array.isArray(fresh) ? fresh : (fresh as any).items ?? [])
    } catch (err) { alert(extractApiError(err).message) }
  }

  async function handleSSHDeny(reqId: string) {
    try {
      await sshApi.deny(reqId)
      const fresh = await sshApi.listRequests({ target_id: device.id, page_size: 20 })
      setSshRequests(Array.isArray(fresh) ? fresh : (fresh as any).items ?? [])
    } catch (err) { alert(extractApiError(err).message) }
  }

  async function handleSSHRevoke(reqId: string) {
    try {
      await sshApi.revoke(reqId)
      const fresh = await sshApi.listRequests({ target_id: device.id, page_size: 20 })
      setSshRequests(Array.isArray(fresh) ? fresh : (fresh as any).items ?? [])
    } catch (err) { alert(extractApiError(err).message) }
  }

  const certDaysLeft = d.cert_expires_at
    ? Math.floor((new Date(d.cert_expires_at).getTime() - Date.now()) / 86400000)
    : null

  const mqttHost = (import.meta as any).env?.VITE_MQTT_HOST ?? window.location.hostname
  // Inside Docker containers, localhost = the container's own loopback.
  // Replace with host.docker.internal so the test command reaches the host machine.
  const dockerMqttHost = (mqttHost === 'localhost' || mqttHost === '127.0.0.1')
    ? 'host.docker.internal'
    : mqttHost
  const mqttUsername = d.mqtt_username ?? d.device_uid
  const telemetryTopic = `pms/${d.org_id}/${d.property_id}/${d.device_uid}/telemetry`
  const samplePayload = JSON.stringify({ temperature: 25.5, humidity: 60, status: 'ok' })

  // File names match what the registration response downloads
  const caFileName = `${d.device_uid}-ca.crt`
  const certFileName = `${d.device_uid}.crt`
  const keyFileName = `${d.device_uid}.key`

  // mTLS (port 8883) is the primary auth method when a CA cert was issued.
  // Port 1883 password auth will be rejected if EMQX verify_peer is enforced.
  const mqttTlsPort = '8883'
  const mqttPlainPort = '1883'

  // mTLS command — requires client cert + key from registration (shown once)
  const dockerMtlsCmd =
`docker run --rm --user root \\
  -v $HOME/Downloads/${caFileName}:/certs/ca.crt:ro \\
  -v $HOME/Downloads/${certFileName}:/certs/device.crt:ro \\
  -v $HOME/Downloads/${keyFileName}:/certs/device.key:ro \\
  eclipse-mosquitto:2 \\
  mosquitto_pub \\
  -h ${dockerMqttHost} -p ${mqttTlsPort} \\
  --cafile /certs/ca.crt \\
  --cert   /certs/device.crt \\
  --key    /certs/device.key \\
  --insecure \\
  -i "d:${d.device_uid}" \\
  -t "${telemetryTopic}" \\
  -m '${samplePayload}'`

  // Plain password command — only works when EMQX fail_if_no_peer_cert is false
  const dockerPasswordCmd =
`docker run --rm eclipse-mosquitto:2 \\
  mosquitto_pub \\
  -h ${dockerMqttHost} -p ${mqttPlainPort} \\
  -u "${mqttUsername}" -P "<MQTT_PASSWORD>" \\
  -i "d:${d.device_uid}" \\
  -t "${telemetryTopic}" \\
  -m '${samplePayload}'`

  const dockerAgentCmd =
`docker run --rm --user root \\
  -v $HOME/Downloads/${caFileName}:/certs/ca.crt:ro \\
  -v $HOME/Downloads/${certFileName}:/certs/device.crt:ro \\
  -v $HOME/Downloads/${keyFileName}:/certs/device.key:ro \\
  -e MQTT_BROKER=${dockerMqttHost} \\
  -e MQTT_PORT=${mqttTlsPort} \\
  -e MQTT_TLS=true \\
  -e MQTT_CA_CERT_PATH=/certs/ca.crt \\
  -e MQTT_CLIENT_CERT_PATH=/certs/device.crt \\
  -e MQTT_CLIENT_KEY_PATH=/certs/device.key \\
  -e DEVICE_ID=${mqttUsername} \\
  nexidra/pms-device-agent:latest`

  const [dockerTab, setDockerTab] = useState<'test-mtls' | 'test-password' | 'agent'>('test-mtls')

  return (
    <>
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">{d.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={d.status} />
                <span className="text-xs text-gray-400">{d.device_uid}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {d.capabilities?.ssh && d.status === 'online' && (
              <button
                onClick={() => { setActiveTab('ssh'); setSshSubTab('requests'); setShowNewSSHReq(true) }}
                className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg"
              >
                🔑 SSH Access
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-stretch gap-0 border-b border-gray-100 px-4 overflow-x-auto">
          {TABS.map((tab) => {
            if (tab.requireSSH && !d.capabilities?.ssh) return null
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className={`flex-1 overflow-hidden flex flex-col ${activeTab === 'ssh' && sshSubTab === 'terminal' ? '' : 'overflow-y-auto p-6'}`}>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Device identity */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <h3 className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-2">Device Identity</h3>
                <Row label="UID" value={d.device_uid} mono />
                <Row label="Serial" value={d.serial_number} mono />
                <Row label="Category" value={d.device_type_category} />
                <Row label="Status" value={<StatusBadge status={d.status} />} />
                <Row label="Firmware" value={d.firmware_version} mono />
                {d.ota_pending_version && (
                  <Row label="Pending OTA" value={d.ota_pending_version} mono />
                )}
              </div>

              {/* Assignment */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <h3 className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-2">Assignment</h3>
                <Row label="Unit" value={d.unit_id ? (unitMap[d.unit_id] ?? d.unit_id.slice(-8)) : '—'} />
                <Row label="Property" value={property?.name ?? d.property_id.slice(-8)} />
              </div>

              {/* Tailscale */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-700 text-xs uppercase tracking-wide">Tailscale / VPN</h3>
                    {d.tailscale_status ? (
                      d.tailscale_status.online ? (
                        <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          Online
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <span className="inline-flex h-2 w-2 rounded-full bg-gray-400" />
                          Offline
                        </span>
                      )
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleGetPreauthKey}
                      disabled={tsKeyLoading}
                      className="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 font-medium"
                    >
                      {tsKeyLoading ? '...' : '🔑 Join Key'}
                    </button>
                    <button
                      onClick={handleTailscaleSync}
                      disabled={tsSyncing}
                      className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 font-medium"
                    >
                      {tsSyncing ? '...' : '🔄 Sync IP'}
                    </button>
                  </div>
                </div>
                <Row label="IP" value={d.tailscale_ip ?? (d.tailscale_status?.ip ?? 'Not registered')} mono />
                <Row label="Hostname" value={d.tailscale_hostname ?? d.tailscale_status?.hostname ?? d.device_uid} mono />
                <Row label="Node ID" value={d.tailscale_node_id ?? d.tailscale_status?.node_id ?? '—'} mono />
                {d.tailscale_status?.os && (
                  <Row label="OS" value={d.tailscale_status.os} />
                )}
                {d.tailscale_status?.last_seen && (
                  <Row label="Last Seen" value={timeAgo(d.tailscale_status.last_seen)} />
                )}
                {tsPreauthData && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-500 font-medium flex-1">Run to join VPN:</p>
                      <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                        <button
                          onClick={() => setTsCmdMode('docker')}
                          className={`px-2 py-0.5 font-medium ${tsCmdMode === 'docker' ? 'bg-gray-800 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                        >
                          Docker
                        </button>
                        <button
                          onClick={() => setTsCmdMode('device')}
                          className={`px-2 py-0.5 font-medium ${tsCmdMode === 'device' ? 'bg-gray-800 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                        >
                          Device
                        </button>
                      </div>
                    </div>
                    <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all select-all leading-relaxed">
                      {tsCmdMode === 'docker' ? (tsPreauthData.docker_tailscale_cmd ?? tsPreauthData.tailscale_cmd) : tsPreauthData.tailscale_cmd}
                    </pre>
                  </div>
                )}
                {tsSyncResult && (
                  <div className={`text-xs px-3 py-2 rounded-lg ${tsSyncResult.synced ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                    {tsSyncResult.synced
                      ? `Synced — IP: ${tsSyncResult.tailscale_ip}`
                      : tsSyncResult.message ?? 'Node not found in Headscale'}
                  </div>
                )}
              </div>

              {/* Simulator download */}
              <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl p-4 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-sm mb-0.5">Device Simulator</h3>
                    <p className="text-xs text-slate-300 leading-snug">
                      Self-contained shell script — creates a Docker container with embedded certs, sends telemetry, listens for commands &amp; OTA, joins Tailscale.
                    </p>
                  </div>
                  <button
                    onClick={() => devicesApi.downloadTestScript(d.id, `${d.device_uid}_simulator.sh`).catch(e => alert(extractApiError(e).message))}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg border border-white/20 transition-colors"
                  >
                    ⬇ Download .sh
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-2 font-mono">chmod +x {d.device_uid}_simulator.sh &amp;&amp; ./{d.device_uid}_simulator.sh</p>
              </div>

              {/* Capabilities */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-3">Capabilities</h3>
                <div className="flex flex-wrap gap-2">
                  {d.capabilities?.telemetry && <Cap label="Telemetry" color="green" />}
                  {d.capabilities?.ssh && <Cap label="SSH" color="blue" />}
                  {d.capabilities?.rpc && <Cap label="RPC" color="purple" />}
                  {d.capabilities?.ota && <Cap label="OTA" color="yellow" />}
                  {d.capabilities?.streaming && <Cap label="Streaming" color="pink" />}
                  {d.capabilities?.attributes && <Cap label="Attributes" color="gray" />}
                </div>
              </div>

              {/* Timestamps */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <h3 className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-2">Activity</h3>
                <Row label="Last Seen" value={timeAgo(d.last_seen_at)} />
                <Row label="Last Telemetry" value={timeAgo(d.last_telemetry_at)} />
                <Row label="Registered" value={fmtDateTime(d.created_at)} />
              </div>

              {/* Connection Setup — shown when device hasn't connected yet */}
              {(d.status === 'provisioned' || d.status === 'offline') && (
                <div className="border border-blue-200 bg-blue-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🔌</span>
                    <h3 className="font-semibold text-blue-900 text-sm">
                      {d.status === 'provisioned'
                        ? 'Device not connected yet — run the setup below to test'
                        : 'Device offline — reconnect using the commands below'}
                    </h3>
                  </div>

                  {d.status === 'provisioned' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800">
                      <strong>No SSH access or active status</strong> until the device connects to the MQTT broker at least once.
                      Use the commands below to simulate or deploy a real device.
                    </div>
                  )}

                  {/* mTLS notice */}
                  <div className="bg-white border border-blue-200 rounded-lg px-3 py-2 mb-3 text-xs text-blue-800">
                    <strong>EMQX port 8883 requires mTLS</strong> — you need the CA cert, device cert, and device key
                    that were generated at registration. Password auth on port 1883 will be rejected
                    (<code>fail_if_no_peer_cert = true</code>).
                  </div>

                  {/* Tab toggle */}
                  <div className="flex gap-1 mb-3 flex-wrap">
                    {([
                      { id: 'test-mtls', label: 'mTLS Test (8883)' },
                      { id: 'test-password', label: 'Password (1883)' },
                      { id: 'agent', label: 'Full Agent' },
                    ] as const).map(t => (
                      <button
                        key={t.id}
                        onClick={() => setDockerTab(t.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                          dockerTab === t.id ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-100'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* mTLS Test */}
                  {dockerTab === 'test-mtls' && (
                    <div className="space-y-2">
                      <p className="text-xs text-blue-700">
                        Uses <strong>mTLS on port 8883</strong>. Cert files must be in <code className="bg-blue-100 px-1 rounded">~/Downloads</code>:
                        <code className="bg-blue-100 px-1 rounded mx-1">{caFileName}</code>
                        <code className="bg-blue-100 px-1 rounded mx-1">{certFileName}</code>
                        <code className="bg-blue-100 px-1 rounded">{keyFileName}</code>.
                        <span className="ml-1 text-blue-500">--insecure skips server hostname check (dev only).</span>
                      </p>
                      <div className="bg-gray-900 rounded-xl p-3 relative">
                        <pre className="text-xs text-green-300 font-mono overflow-x-auto whitespace-pre">{dockerMtlsCmd}</pre>
                        <div className="absolute top-2 right-2">
                          <CopyButton text={dockerMtlsCmd} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-3 py-1.5 mt-1">
                        <span className="text-xs text-gray-500 flex-shrink-0">Topic:</span>
                        <code className="text-xs font-mono text-gray-800 flex-1">{telemetryTopic}</code>
                        <CopyButton text={telemetryTopic} />
                      </div>
                    </div>
                  )}

                  {/* Password Test */}
                  {dockerTab === 'test-password' && (
                    <div className="space-y-2">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                        ⚠ This will be <strong>rejected</strong> if EMQX has <code>fail_if_no_peer_cert = true</code> on port 1883.
                        Only use this if you've disabled mTLS enforcement. Replace <code className="bg-amber-100 px-1 rounded">&lt;MQTT_PASSWORD&gt;</code> with the raw password from registration.
                      </div>
                      <div className="bg-gray-900 rounded-xl p-3 relative">
                        <pre className="text-xs text-green-300 font-mono overflow-x-auto whitespace-pre">{dockerPasswordCmd}</pre>
                        <div className="absolute top-2 right-2">
                          <CopyButton text={dockerPasswordCmd} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full Agent */}
                  {dockerTab === 'agent' && (
                    <div className="space-y-2">
                      <p className="text-xs text-blue-700">
                        Mounts cert files and runs the full PMS device agent — heartbeats, telemetry, RPC, Tailscale/SSH registration.
                      </p>
                      <div className="bg-gray-900 rounded-xl p-3 relative">
                        <pre className="text-xs text-green-300 font-mono overflow-x-auto whitespace-pre">{dockerAgentCmd}</pre>
                        <div className="absolute top-2 right-2">
                          <CopyButton text={dockerAgentCmd} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CA Cert download */}
                  {caCertPem ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-blue-800">CA Certificate (for TLS auth)</p>
                        <div className="flex gap-1">
                          <CopyButton text={caCertPem} label="Copy PEM" />
                          <button
                            onClick={() => {
                              const blob = new Blob([caCertPem], { type: 'text/plain' })
                              const a = document.createElement('a')
                              a.href = URL.createObjectURL(blob)
                              a.download = `${d.device_uid}-ca.crt`
                              a.click()
                            }}
                            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                          >
                            ↓ Download
                          </button>
                        </div>
                      </div>
                      <pre className="bg-gray-900 text-green-300 text-[10px] font-mono rounded-lg p-2 max-h-24 overflow-y-auto">
                        {caCertPem.slice(0, 300)}{caCertPem.length > 300 ? '…' : ''}
                      </pre>
                    </div>
                  ) : (
                    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                      CA certificate not available — ensure <code>IOT_CA_CERT_PEM</code> is configured in the IoT service environment.
                    </div>
                  )}

                  <p className="text-xs text-blue-600 mt-3">
                    Once the device sends its first message, status changes to <strong>online</strong> and SSH access becomes available.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Telemetry Tab */}
          {activeTab === 'telemetry' && (
            <div className="space-y-4">
              {/* Sub-tab bar */}
              <div className="flex gap-1 -mt-2 pb-2 border-b border-gray-100">
                {(['live', 'sandbox'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setTelSubTab(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      telSubTab === st ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {st === 'live' ? '● Live' : '◈ Sandbox'}
                  </button>
                ))}
              </div>

              {/* ── Live sub-tab ── */}
              {telSubTab === 'live' && (<>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Live Telemetry</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {telemetryLog.length > 0
                      ? `Last update ${timeAgo(telemetryLog[0].ts)} · polling every 5s`
                      : 'Polling every 5s · waiting for data'}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  Live
                </span>
              </div>

              {d.status !== 'online' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                  Device is <strong>{d.status}</strong> — telemetry will appear once connected.
                </div>
              )}

              {/* MQTT topic pill */}
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-[10px] font-mono text-gray-400 truncate flex-1">
                  pms/{d.org_id}/{d.property_id}/{d.device_uid}/telemetry
                </span>
                <CopyButton text={`pms/${d.org_id}/${d.property_id}/${d.device_uid}/telemetry`} label="Copy" />
              </div>

              {telemetryLog.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-10 text-center border border-dashed border-gray-200">
                  <div className="text-4xl mb-3">📡</div>
                  <p className="text-sm font-medium text-gray-600">No telemetry received yet</p>
                  <p className="text-xs text-gray-400 mt-1">Publish a message to the topic above to see live data here.</p>
                </div>
              ) : (
                <>
                  {/* Latest reading — metric cards */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Latest Reading</p>
                      <span className="text-xs text-gray-400 font-mono">
                        {new Date(telemetryLog[0].ts).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(telemetryLog[0].data).map(([key, val]) => {
                        const isNum = typeof val === 'number'
                        const isBool = typeof val === 'boolean'
                        const displayVal = isBool
                          ? (val ? 'true' : 'false')
                          : typeof val === 'object'
                          ? JSON.stringify(val)
                          : String(val)
                        return (
                          <div key={key} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
                            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide truncate">
                              {key.replace(/_/g, ' ')}
                            </p>
                            <p className={`text-xl font-bold mt-1 leading-tight truncate ${
                              isBool
                                ? val ? 'text-emerald-600' : 'text-red-500'
                                : isNum ? 'text-gray-900' : 'text-blue-700'
                            }`}>
                              {displayVal}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* History — compact timeline */}
                  {telemetryLog.length > 1 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">History</p>
                      <div className="divide-y divide-gray-50">
                        {telemetryLog.slice(1).map((entry, i) => (
                          <div key={i} className="flex items-start gap-3 py-2.5">
                            <span className="text-[10px] text-gray-300 font-mono w-16 flex-shrink-0 mt-0.5 text-right">
                              {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 min-w-0">
                              {Object.entries(entry.data).map(([k, v]) => (
                                <span key={k} className="text-xs text-gray-500">
                                  <span className="text-gray-300">{k}:</span>{' '}
                                  <span className="text-gray-600 font-mono">
                                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              </>)}

              {/* ── Sandbox sub-tab ── */}
              {telSubTab === 'sandbox' && <TelemetrySandbox />}
            </div>
          )}

          {/* Commands Tab */}
          {activeTab === 'commands' && (
            <div className="space-y-5">
              {d.capabilities?.rpc && d.status === 'online' ? (
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <h3 className="font-semibold text-gray-700 text-sm">Send Command</h3>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Command Name</label>
                    <input
                      type="text"
                      className="input w-full text-sm"
                      value={commandName}
                      onChange={e => setCommandName(e.target.value)}
                      placeholder="e.g. reboot, set_config, get_status"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Params (JSON)</label>
                    <textarea
                      className="input w-full text-sm font-mono h-24 resize-none"
                      value={commandParams}
                      onChange={e => setCommandParams(e.target.value)}
                    />
                  </div>
                  {cmdError && <p className="text-xs text-red-600">{cmdError}</p>}
                  <button
                    onClick={handleSendCommand}
                    disabled={sendingCmd || !commandName.trim()}
                    className="w-full py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                  >
                    {sendingCmd ? 'Sending…' : 'Send Command'}
                  </button>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500">
                  {!d.capabilities?.rpc
                    ? 'This device does not have RPC capability enabled.'
                    : 'Device must be online to send commands.'}
                </div>
              )}

              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Command History</h3>
                {cmdsLoading ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : (
                  <div className="space-y-2">
                    {commands.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-6">No commands sent yet</p>
                    )}
                    {commands.map(cmd => (
                      <div key={cmd.id} className="bg-gray-50 rounded-xl p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium text-gray-800">{cmd.command_name}</span>
                          <CommandStatusBadge status={cmd.status} />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{fmtDateTime(cmd.created_at)}</p>
                        {cmd.response != null && (
                          <pre className="text-xs text-gray-600 bg-white rounded p-2 mt-2 overflow-x-auto border border-gray-100">
                            {JSON.stringify(cmd.response, null, 2)}
                          </pre>
                        )}
                        {cmd.error_message && (
                          <p className="text-xs text-red-600 mt-1">{cmd.error_message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OTA Tab */}
          {activeTab === 'ota' && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-700">Current Firmware</h3>
                  {d.capabilities?.ota && (
                    <button
                      onClick={() => setShowOTAUpload(true)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                    >
                      ↑ Upload Firmware
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-gray-900">{d.firmware_version ?? 'Unknown'}</span>
                  {d.ota_pending_version && (
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      Update pending: v{d.ota_pending_version}
                    </span>
                  )}
                </div>
              </div>

              {otasLoading ? (
                <p className="text-sm text-gray-400">Loading OTA history…</p>
              ) : (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-3">OTA History</h3>
                  <div className="space-y-2">
                    {otas.filter(o => o.device_ids.includes(d.id) || o.device_statuses.some(ds => ds.device_id === d.id)).map(ota => {
                      const otaDs = ota.device_statuses.find(ds => ds.device_id === d.id)
                      return (
                        <div key={ota.id} className="bg-gray-50 rounded-xl p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-medium">v{ota.target_version}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${otaDs?.status === 'completed' ? 'bg-green-100 text-green-700' : otaDs?.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                              {otaDs?.status ?? ota.status}
                            </span>
                          </div>
                          {otaDs && otaDs.progress_pct > 0 && (
                            <div className="mt-2">
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${otaDs.progress_pct}%` }} />
                              </div>
                            </div>
                          )}
                          <p className="text-xs text-gray-400 mt-1">{fmtDateTime(ota.created_at)}</p>
                        </div>
                      )
                    })}
                    {otas.filter(o => o.device_ids.includes(d.id) || o.device_statuses.some(ds => ds.device_id === d.id)).length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-6">No OTA updates for this device</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Security Tab — Credentials + Quarantine + Certificates */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              {/* Provisioned warning */}
              {d.status === 'provisioned' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-800">⚠ Device not active</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Status is <strong>provisioned</strong> — the device has credentials but has never connected. SSH access and most security features are inactive until the device comes online. See the <button onClick={() => setActiveTab('overview')} className="underline">Overview tab</button> for connection setup.
                  </p>
                </div>
              )}

              {/* Rotate Credentials */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-700 text-sm mb-2">Credentials</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Rotating credentials invalidates the current MQTT password immediately.
                </p>
                {!rotateResult && !showRotateConfirm && (
                  <button
                    onClick={() => setShowRotateConfirm(true)}
                    className="px-4 py-2 text-sm font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-xl"
                  >
                    Rotate Credentials
                  </button>
                )}
                {showRotateConfirm && !rotateResult && (
                  <div>
                    <p className="text-sm text-gray-700 mb-3">Are you sure? The device will need to reconnect with new credentials.</p>
                    {rotateError && <p className="text-xs text-red-600 mb-2">{rotateError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => setShowRotateConfirm(false)} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
                      <button onClick={handleRotateCredentials} disabled={rotating} className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
                        {rotating ? 'Rotating…' : 'Confirm Rotate'}
                      </button>
                    </div>
                  </div>
                )}
                {rotateResult && (
                  <div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 mb-3">
                      <p className="text-xs text-amber-800 font-semibold">Save this password — shown once only</p>
                    </div>
                    <div className="space-y-2 text-sm">
                      <Row label="Username" value={rotateResult.mqtt_username} mono />
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Password</p>
                        <div className="flex gap-2">
                          <p className="font-mono text-xs bg-white border border-gray-200 rounded px-2 py-1 flex-1 truncate">{rotateResult.mqtt_password}</p>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(rotateResult.mqtt_password)
                              setCopiedPwd(true)
                              setTimeout(() => setCopiedPwd(false), 2000)
                            }}
                            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
                          >
                            {copiedPwd ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Quarantine */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-700 text-sm mb-2">Quarantine</h3>
                {d.status === 'quarantined' ? (
                  <div>
                    <p className="text-sm text-red-600 mb-1">Device is quarantined</p>
                    <p className="text-xs text-gray-500 mb-3">{device.quarantine_reason ?? 'No reason recorded'}</p>
                    <button onClick={handleUnquarantine} className="px-4 py-2 text-sm font-semibold text-green-700 border border-green-200 hover:bg-green-50 rounded-xl">
                      Unquarantine
                    </button>
                  </div>
                ) : (
                  <div>
                    {!showQuarantineInput ? (
                      <button onClick={() => setShowQuarantineInput(true)} className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-xl">
                        Quarantine Device
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <textarea
                          className="input w-full text-sm h-20 resize-none"
                          placeholder="Reason for quarantine"
                          value={quarantineReason}
                          onChange={e => setQuarantineReason(e.target.value)}
                        />
                        {quarantineError && <p className="text-xs text-red-600">{quarantineError}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => setShowQuarantineInput(false)} className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
                          <button onClick={handleQuarantine} disabled={quarantining || !quarantineReason.trim()} className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50">
                            {quarantining ? 'Quarantining…' : 'Quarantine'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Certificates */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-700 text-sm">mTLS Certificate</h3>
                  {d.cert_fingerprint && certDaysLeft != null && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      certDaysLeft < 7 ? 'bg-red-100 text-red-700' :
                      certDaysLeft < 30 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {certDaysLeft < 7 ? `Expires in ${certDaysLeft}d!` : certDaysLeft < 30 ? `${certDaysLeft}d left` : `Valid · ${certDaysLeft}d`}
                    </span>
                  )}
                </div>
                {!d.cert_fingerprint ? (
                  <p className="text-xs text-gray-500">
                    No certificate issued — download the test script from the <button onClick={() => setActiveTab('overview')} className="underline text-blue-600">Overview tab</button> to auto-issue one.
                  </p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <Row label="Fingerprint" value={<span className="font-mono text-[10px] break-all">{d.cert_fingerprint}</span>} />
                    <Row label="Serial" value={d.cert_serial ? <span className="font-mono">{d.cert_serial}</span> : undefined} />
                    <Row label="Issued" value={d.cert_issued_at ? fmtDateTime(d.cert_issued_at) : undefined} />
                    <Row label="Expires" value={d.cert_expires_at ? (
                      <span className={certDaysLeft != null && certDaysLeft < 7 ? 'text-red-600 font-semibold' : certDaysLeft != null && certDaysLeft < 30 ? 'text-yellow-700' : undefined}>
                        {fmtDateTime(d.cert_expires_at)}{certDaysLeft != null ? ` (${certDaysLeft}d)` : ''}
                      </span>
                    ) : undefined} />
                    <Row label="MQTT User" value={d.mqtt_username} mono />
                    <Row label="Protocol" value="mTLS · port 8883" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SSH Tab — sub-tabs: Requests / Logs / Terminal */}
          {activeTab === 'ssh' && sshSubTab !== 'terminal' && (
            <div className="space-y-4">
              {/* Sub-tab bar */}
              <div className="flex gap-1 -mt-2 -mx-0 pb-2 border-b border-gray-100">
                {(['requests', 'logs', 'terminal'] as SSHSubTab[]).map(st => (
                  <button
                    key={st}
                    onClick={() => setSshSubTab(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      sshSubTab === st
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {st === 'requests' ? 'Requests' : st === 'logs' ? 'Logs' : '⌨ Terminal'}
                  </button>
                ))}
              </div>

              {/* Requests sub-tab */}
              {sshSubTab === 'requests' && (<>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">SSH Access Requests</p>
                  <p className="text-xs text-gray-400 mt-0.5">Request and manage SSH access to this device via Headscale VPN</p>
                </div>
                {!showNewSSHReq && (
                  <button
                    onClick={() => setShowNewSSHReq(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                  >
                    + New Request
                  </button>
                )}
              </div>

              {/* New request form */}
              {showNewSSHReq && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-emerald-800">New SSH Access Request</p>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Reason <span className="text-red-500">*</span></label>
                    <textarea
                      className="input w-full text-sm h-20 resize-none"
                      placeholder="Why do you need SSH access? (e.g. debugging firmware issue, log collection)"
                      value={sshReason}
                      onChange={e => setSshReason(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Duration</label>
                    <select
                      className="input w-full text-sm"
                      value={sshDuration}
                      onChange={e => setSshDuration(Number(e.target.value))}
                    >
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={120}>2 hours</option>
                      <option value={240}>4 hours</option>
                      <option value={480}>8 hours</option>
                    </select>
                  </div>
                  {sshReqError && <p className="text-xs text-red-600">{sshReqError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setShowNewSSHReq(false); setSshReason(''); setSshReqError('') }}
                      className="flex-1 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
                    >Cancel</button>
                    <button
                      onClick={handleSubmitSSHRequest}
                      disabled={submittingSSH || !sshReason.trim()}
                      className="flex-1 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
                    >
                      {submittingSSH ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </div>
                </div>
              )}

              {/* Requests list */}
              {sshReqLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : sshRequests.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-8 text-center border border-dashed border-gray-200">
                  <p className="text-sm font-medium text-gray-500">🔑 No SSH requests yet</p>
                  <p className="text-xs text-gray-400 mt-1">Click "New Request" to request access.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sshRequests.map(req => {
                    const statusColors: Record<string, string> = {
                      pending:  'bg-yellow-100 text-yellow-700',
                      active:   'bg-emerald-100 text-emerald-700',
                      expired:  'bg-gray-100 text-gray-500',
                      revoked:  'bg-red-100 text-red-600',
                      denied:   'bg-red-100 text-red-600',
                    }
                    return (
                      <div key={req.id} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate">{req.reason}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {req.requester_email ?? req.requester_user_id} · {req.requested_duration_m}m · {fmtDateTime(req.created_at)}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${statusColors[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {req.status}
                          </span>
                        </div>
                        {req.status === 'active' && req.expires_at && (
                          <p className="text-[10px] text-emerald-600 font-medium">
                            Access active · expires {timeAgo(req.expires_at)}
                          </p>
                        )}
                        {req.denial_reason && (
                          <p className="text-[10px] text-red-500">Denied: {req.denial_reason}</p>
                        )}
                        {/* Actions */}
                        <div className="flex gap-1.5">
                          {req.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleSSHApprove(req.id)}
                                className="px-2.5 py-1 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                              >✓ Approve</button>
                              <button
                                onClick={() => handleSSHDeny(req.id)}
                                className="px-2.5 py-1 text-[10px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
                              >✗ Deny</button>
                            </>
                          )}
                          {req.status === 'active' && (
                            <button
                              onClick={() => handleSSHRevoke(req.id)}
                              className="px-2.5 py-1 text-[10px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
                            >Revoke</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              </>)}

              {/* Logs sub-tab */}
              {sshSubTab === 'logs' && (<>
              <div>
                <p className="text-sm font-semibold text-gray-900">SSH Session Log</p>
                <p className="text-xs text-gray-400 mt-0.5">Audit trail of all SSH sessions to this device</p>
              </div>
              {logsLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : auditLogs.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-8 text-center border border-dashed border-gray-200">
                  <p className="text-sm font-medium text-gray-500">No SSH sessions recorded</p>
                  <p className="text-xs text-gray-400 mt-1">Sessions appear here once SSH access is used.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map(log => (
                    <div key={log.id} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700 text-xs font-medium">{fmtDateTime(log.session_start)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${log.status === 'completed' ? 'bg-green-100 text-green-700' : log.status === 'terminated' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {log.status}
                        </span>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-gray-400">
                        <span>From {log.source_ip}</span>
                        {log.duration_seconds != null && (
                          <span>{Math.floor(log.duration_seconds / 60)}m {log.duration_seconds % 60}s</span>
                        )}
                        {log.commands_count != null && <span>{log.commands_count} cmds</span>}
                        {log.bytes_rx != null && <span>↓{(log.bytes_rx / 1024).toFixed(1)}KB</span>}
                        {log.bytes_tx != null && <span>↑{(log.bytes_tx / 1024).toFixed(1)}KB</span>}
                      </div>
                      {log.termination_reason && (
                        <p className="text-[10px] text-gray-400 mt-1">Reason: {log.termination_reason}</p>
                      )}
                      {log.recording_s3_key && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await sshApi.getReplayUrl(log.ssh_request_id, log.id)
                              window.open(res.replay_url, '_blank')
                            } catch { alert('Unable to load replay URL') }
                          }}
                          className="mt-2 text-xs text-blue-600 hover:underline"
                        >▶ Replay Recording</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              </>)}
            </div>
          )}

          {/* SSH Terminal sub-tab — full-height, no padding wrapper */}
          {activeTab === 'ssh' && sshSubTab === 'terminal' && (
            <div className="flex flex-col h-full">
              {/* Sub-tab bar */}
              <div className="flex gap-1 px-4 py-2 border-b border-gray-100 flex-shrink-0">
                {(['requests', 'logs', 'terminal'] as SSHSubTab[]).map(st => (
                  <button
                    key={st}
                    onClick={() => setSshSubTab(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      sshSubTab === st
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {st === 'requests' ? 'Requests' : st === 'logs' ? 'Logs' : '⌨ Terminal'}
                  </button>
                ))}
              </div>
              {/* Terminal */}
              {!d.tailscale_ip ? (
                <div className="p-6">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm font-medium text-amber-800">
                      No Tailscale/VPN IP — cannot open SSH console
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Register the device with Headscale then click ↺ Sync Tailscale in the Overview tab.
                    </p>
                  </div>
                </div>
              ) : (
                <XTermConsole
                  deviceId={d.id}
                  iotBaseUrl={import.meta.env.VITE_IOT_API_BASE_URL
                    ? `${import.meta.env.VITE_IOT_API_BASE_URL}/api/v1`
                    : 'http://localhost:8020/api/v1'}
                  active={activeTab === 'ssh' && sshSubTab === 'terminal'}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* OTA Upload Slide-over */}
    {showOTAUpload && (
      <OTAUploadSlideOver
        propertyId={property?.id ?? d.property_id}
        deviceTypeId={d.device_type_id}
        onClose={() => setShowOTAUpload(false)}
        onUploaded={(ota) => {
          setShowOTAUpload(false)
          setOtas(prev => [ota, ...prev])
        }}
      />
    )}
  </>
  )
}

// ── OTA Upload Slide-Over ────────────────────────────────────────────────────

type OTASource = 'file' | 'github' | 'url'

function OTAUploadSlideOver({
  propertyId, deviceTypeId, onClose, onUploaded
}: {
  propertyId: string
  deviceTypeId?: string
  onClose: () => void
  onUploaded: (ota: import('@/types/iot').OTAUpdate) => void
}) {
  const [source, setSource] = useState<OTASource>('file')
  const [targetVersion, setTargetVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [rolloutPct, setRolloutPct] = useState(100)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [ghRepo, setGhRepo] = useState('')        // e.g. owner/repo
  const [ghTag, setGhTag] = useState('')          // e.g. v1.2.0
  const [ghAsset, setGhAsset] = useState('')      // e.g. firmware.bin
  const [directUrl, setDirectUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<import('@/types/iot').OTAUpdate | null>(null)
  const [startingRollout, setStartingRollout] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function resolveFile(): Promise<File | null> {
    if (source === 'file') return file
    const url = source === 'github'
      ? `https://github.com/${ghRepo}/releases/download/${ghTag}/${ghAsset || 'firmware.bin'}`
      : directUrl.trim()
    if (!url) { setError('URL is required'); return null }
    setFetching(true)
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${resp.statusText}`)
      const blob = await resp.blob()
      const name = url.split('/').pop() ?? 'firmware.bin'
      return new File([blob], name)
    } catch (e: any) {
      setError(`Failed to fetch firmware: ${e.message}`)
      return null
    } finally {
      setFetching(false)
    }
  }

  async function handleUpload() {
    if (!targetVersion.trim()) { setError('Target version is required'); return }
    setError('')
    setSaving(true)
    try {
      const fw = await resolveFile()
      if (!fw) { setSaving(false); return }
      const formData = new FormData()
      if (deviceTypeId) formData.append('device_type_id', deviceTypeId)
      formData.append('target_version', targetVersion.trim())
      formData.append('rollout_pct', rolloutPct.toString())
      formData.append('property_id', propertyId)
      if (releaseNotes.trim()) formData.append('release_notes', releaseNotes.trim())
      formData.append('firmware', fw)
      const ota = await otaApi.uploadFirmware(formData)
      setResult(ota)
    } catch (err: any) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleStartRollout() {
    if (!result) return
    setStartingRollout(true)
    try {
      const updated = await otaApi.start(result.id)
      onUploaded(updated)
    } catch (err: any) {
      setError(extractApiError(err).message)
      setStartingRollout(false)
    }
  }

  const ROLLOUT_STEPS = [10, 25, 50, 75, 100]

  return (
    <div className="fixed inset-0 z-[10001] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Upload Firmware</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {result ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="font-semibold text-green-800 text-sm">Firmware uploaded!</p>
                <p className="text-sm text-green-700 mt-1">v{result.target_version} is ready · {result.rollout_pct}% rollout</p>
              </div>
              <p className="text-sm text-gray-700">Start the rollout now or do it later from the OTA list.</p>
              <div className="flex gap-2">
                <button onClick={() => onUploaded(result)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
                  Later
                </button>
                <button onClick={handleStartRollout} disabled={startingRollout}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
                  {startingRollout ? 'Starting…' : '▶ Start Rollout'}
                </button>
              </div>
            </div>
          ) : (<>
            {/* Source tabs */}
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Firmware Source</p>
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {([['file', '📁 File'], ['github', '🐙 GitHub'], ['url', '🔗 URL']] as [OTASource, string][]).map(([s, label]) => (
                  <button key={s} onClick={() => { setSource(s); setError('') }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      source === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* File drop zone */}
            {source === 'file' && (
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                    <button onClick={e => { e.stopPropagation(); setFile(null) }} className="text-xs text-red-500 mt-1 hover:underline">Remove</button>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-2">📦</div>
                    <p className="text-sm text-gray-600">Drag & drop or click to upload</p>
                    <p className="text-xs text-gray-400 mt-1">.bin · .zip · .tar.gz · .hex</p>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept=".bin,.zip,.tar.gz,.gz,.hex" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
              </div>
            )}

            {/* GitHub release */}
            {source === 'github' && (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                  <p>Downloads the firmware asset from a GitHub release.</p>
                  <p className="font-mono text-gray-400">github.com/{'{'}owner/repo{'}'}/releases/download/{'{'}tag{'}'}/{'{'}asset{'}'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Repository <span className="text-red-500">*</span></label>
                  <input className="input w-full text-sm font-mono" value={ghRepo}
                    onChange={e => setGhRepo(e.target.value)} placeholder="owner/repo" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1">Tag / Release <span className="text-red-500">*</span></label>
                    <input className="input w-full text-sm font-mono" value={ghTag}
                      onChange={e => setGhTag(e.target.value)} placeholder="v1.2.0" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1">Asset filename</label>
                    <input className="input w-full text-sm font-mono" value={ghAsset}
                      onChange={e => setGhAsset(e.target.value)} placeholder="firmware.bin" />
                  </div>
                </div>
                {ghRepo && ghTag && (
                  <p className="text-[10px] text-gray-400 font-mono bg-gray-50 rounded px-2 py-1 break-all">
                    https://github.com/{ghRepo}/releases/download/{ghTag}/{ghAsset || 'firmware.bin'}
                  </p>
                )}
              </div>
            )}

            {/* Direct URL */}
            {source === 'url' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-700 block">Direct download URL <span className="text-red-500">*</span></label>
                <input className="input w-full text-sm font-mono" value={directUrl}
                  onChange={e => setDirectUrl(e.target.value)}
                  placeholder="https://example.com/firmware.bin" />
                <p className="text-xs text-gray-400">The URL must be publicly accessible or allow CORS from this origin.</p>
              </div>
            )}

            {/* Version + Notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Target Version <span className="text-red-500">*</span></label>
                <input className="input w-full text-sm font-mono" value={targetVersion}
                  onChange={e => setTargetVersion(e.target.value)} placeholder="1.2.0" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">Rollout %</label>
                  <span className="text-xs font-semibold text-blue-600">{rolloutPct}%</span>
                </div>
                <input type="range" className="w-full" min="10" max="100" step="5"
                  value={rolloutPct} onChange={e => setRolloutPct(Number(e.target.value))} />
                <div className="flex justify-between mt-0.5">
                  {ROLLOUT_STEPS.map(s => (
                    <button key={s} onClick={() => setRolloutPct(s)}
                      className={`text-[10px] px-1 rounded ${rolloutPct === s ? 'text-blue-700 font-bold' : 'text-gray-400'}`}>
                      {s}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Release Notes</label>
              <textarea className="input w-full text-sm h-16 resize-none" value={releaseNotes}
                onChange={e => setReleaseNotes(e.target.value)} placeholder="What's new in this version?" />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </>)}
        </div>

        {!result && (
          <div className="border-t border-gray-100 px-6 py-4 flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={handleUpload} disabled={saving || fetching}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
              {fetching ? 'Fetching…' : saving ? 'Uploading…' : '↑ Upload'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Utility Components ────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 flex-shrink-0 mt-0.5">{label}</span>
      <span className={`text-xs text-right ${mono ? 'font-mono text-gray-800' : 'text-gray-700'}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function Cap({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    pink: 'bg-pink-100 text-pink-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] ?? colors.gray}`}>
      {label}
    </span>
  )
}
