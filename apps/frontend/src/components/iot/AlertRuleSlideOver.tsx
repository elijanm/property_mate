import { useEffect, useState } from 'react'
import { alertRulesApi, deviceTypesApi, devicesApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import type { AlertRule, AlertRulePayload, AlertOperator, AlertSeverity, DeviceType, Device } from '@/types/iot'

interface Props {
  propertyId: string
  rule?: AlertRule
  onClose: () => void
  onSaved: (rule: AlertRule) => void
}

type Scope = 'org' | 'device_type' | 'device'

const OPERATOR_OPTIONS: { value: AlertOperator; label: string }[] = [
  { value: 'gt', label: '> (greater than)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'gte', label: '≥ (greater or equal)' },
  { value: 'lte', label: '≤ (less or equal)' },
  { value: 'eq', label: '= (equal)' },
  { value: 'neq', label: '≠ (not equal)' },
]

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string; color: string }[] = [
  { value: 'info', label: 'Info', color: 'text-blue-600' },
  { value: 'warning', label: 'Warning', color: 'text-yellow-600' },
  { value: 'critical', label: 'Critical', color: 'text-red-600' },
]

export default function AlertRuleSlideOver({ propertyId, rule, onClose, onSaved }: Props) {
  const isEdit = !!rule

  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')
  const [scope, setScope] = useState<Scope>(
    rule?.device_id ? 'device' : rule?.device_type_id ? 'device_type' : 'org'
  )
  const [deviceTypeId, setDeviceTypeId] = useState(rule?.device_type_id ?? '')
  const [deviceId, setDeviceId] = useState(rule?.device_id ?? '')
  const [telemetryKey, setTelemetryKey] = useState(rule?.telemetry_key ?? '')
  const [operator, setOperator] = useState<AlertOperator>(rule?.operator ?? 'gt')
  const [threshold, setThreshold] = useState(rule?.threshold?.toString() ?? '')
  const [consecutiveViolations, setConsecutiveViolations] = useState(rule?.consecutive_violations?.toString() ?? '1')
  const [cooldownM, setCooldownM] = useState(rule?.cooldown_m?.toString() ?? '30')
  const [severity, setSeverity] = useState<AlertSeverity>(rule?.severity ?? 'warning')
  const [createTicket, setCreateTicket] = useState(rule?.create_ticket ?? false)
  const [notifyEmail, setNotifyEmail] = useState(rule?.notify_email ?? true)

  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    deviceTypesApi.list().then(setDeviceTypes).catch(() => {})
    devicesApi.list({ property_id: propertyId, page_size: 200 }).then(data => {
      setDevices(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [propertyId])

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!telemetryKey.trim()) { setError('Telemetry key is required'); return }
    const thresholdNum = parseFloat(threshold)
    if (isNaN(thresholdNum)) { setError('Threshold must be a number'); return }

    setError('')
    setSaving(true)
    try {
      const payload: AlertRulePayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        property_id: propertyId,
        device_id: scope === 'device' ? deviceId : undefined,
        device_type_id: scope === 'device_type' ? deviceTypeId : undefined,
        telemetry_key: telemetryKey.trim(),
        operator,
        threshold: thresholdNum,
        consecutive_violations: parseInt(consecutiveViolations) || 1,
        cooldown_m: parseInt(cooldownM) || 30,
        severity,
        create_ticket: createTicket,
        notify_email: notifyEmail,
      }

      const saved = isEdit
        ? await alertRulesApi.update(rule.id, payload)
        : await alertRulesApi.create(payload)
      onSaved(saved)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {isEdit ? 'Edit Alert Rule' : 'New Alert Rule'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Name *</label>
            <input type="text" className="input w-full text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. High Temperature Alert" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Description</label>
            <input type="text" className="input w-full text-sm" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>

          {/* Scope */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">Scope</label>
            <div className="flex gap-2">
              {([
                { value: 'org', label: 'Org-wide' },
                { value: 'device_type', label: 'Device Type' },
                { value: 'device', label: 'Specific Device' },
              ] as { value: Scope; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScope(opt.value)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-colors ${
                    scope === opt.value
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {scope === 'device_type' && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Device Type</label>
              <select className="input w-full text-sm" value={deviceTypeId} onChange={e => setDeviceTypeId(e.target.value)}>
                <option value="">Select device type…</option>
                {deviceTypes.map(dt => (
                  <option key={dt.id} value={dt.id}>{dt.name}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'device' && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Device</label>
              <select className="input w-full text-sm" value={deviceId} onChange={e => setDeviceId(e.target.value)}>
                <option value="">Select device…</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.device_uid})</option>
                ))}
              </select>
            </div>
          )}

          {/* Condition */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Telemetry Key *</label>
            <input
              type="text"
              className="input w-full text-sm font-mono"
              value={telemetryKey}
              onChange={e => setTelemetryKey(e.target.value)}
              placeholder="e.g. temperature, battery_pct, voltage"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Operator</label>
              <select className="input w-full text-sm" value={operator} onChange={e => setOperator(e.target.value as AlertOperator)}>
                {OPERATOR_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Threshold *</label>
              <input
                type="number"
                className="input w-full text-sm"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                placeholder="e.g. 80"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Consecutive Violations</label>
              <input
                type="number"
                className="input w-full text-sm"
                min="1" max="10"
                value={consecutiveViolations}
                onChange={e => setConsecutiveViolations(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Cooldown (minutes)</label>
              <input
                type="number"
                className="input w-full text-sm"
                min="1"
                value={cooldownM}
                onChange={e => setCooldownM(e.target.value)}
              />
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">Severity</label>
            <div className="flex gap-2">
              {SEVERITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSeverity(opt.value)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-colors ${
                    severity === opt.value
                      ? 'border-current bg-opacity-10'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  } ${severity === opt.value ? opt.color : ''}`}
                  style={severity === opt.value ? { backgroundColor: 'rgba(0,0,0,0.04)' } : {}}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-gray-700 block">Actions on Trigger</label>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm font-medium text-gray-800">Create Ticket</p>
                <p className="text-xs text-gray-500">Auto-create a maintenance ticket</p>
              </div>
              <button
                onClick={() => setCreateTicket(!createTicket)}
                className={`relative inline-flex h-6 w-10 cursor-pointer rounded-full transition-colors ${createTicket ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${createTicket ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm font-medium text-gray-800">Email Notification</p>
                <p className="text-xs text-gray-500">Send email to org admins</p>
              </div>
              <button
                onClick={() => setNotifyEmail(!notifyEmail)}
                className={`relative inline-flex h-6 w-10 cursor-pointer rounded-full transition-colors ${notifyEmail ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${notifyEmail ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
