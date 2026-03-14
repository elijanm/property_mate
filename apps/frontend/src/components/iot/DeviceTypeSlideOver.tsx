import { useState } from 'react'
import { deviceTypesApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import type { DeviceType, DeviceCategory, DeviceProtocol, TelemetryField, RpcCommand } from '@/types/iot'

interface Props {
  deviceType?: DeviceType      // undefined = create mode
  onClose: () => void
  onSaved: (dt: DeviceType) => void
}

const CATEGORIES: { value: DeviceCategory; label: string; icon: string }[] = [
  { value: 'smart_lock',  label: 'Smart Lock',   icon: '🔒' },
  { value: 'meter',       label: 'Meter',         icon: '📊' },
  { value: 'sensor',      label: 'Sensor',        icon: '🌡️' },
  { value: 'camera',      label: 'Camera',        icon: '📷' },
  { value: 'gateway',     label: 'Gateway',       icon: '📡' },
  { value: 'lora_node',   label: 'LoRa Node',     icon: '📶' },
  { value: 'modbus',      label: 'Modbus',        icon: '⚙️' },
  { value: 'custom',      label: 'Custom',        icon: '🔧' },
]

const PROTOCOLS = ['mqtt', 'http', 'lorawan', 'modbus', 'custom']

const CAPABILITY_OPTIONS = [
  { key: 'telemetry',  label: 'Telemetry',       hint: 'Device publishes sensor data' },
  { key: 'rpc',        label: 'Remote Commands',  hint: 'Send commands to device' },
  { key: 'ota',        label: 'OTA Updates',      hint: 'Push firmware over the air' },
  { key: 'ssh',        label: 'SSH Access',       hint: 'SSH tunnel via Tailscale' },
  { key: 'attributes', label: 'Attributes',       hint: 'Static device properties' },
  { key: 'streaming',  label: 'Streaming',        hint: 'Live video/audio stream' },
]

const DATA_TYPES = ['number', 'string', 'boolean']

const EMPTY_TELEMETRY_FIELD = (): TelemetryField => ({
  key: '', label: '', unit: '', data_type: 'number',
  min_value: undefined, max_value: undefined, description: '',
})

const EMPTY_RPC_COMMAND = (): RpcCommand => ({
  name: '', label: '', description: '', params_schema: {},
})

// Sub-components for each section
function TelemetrySchemaEditor({
  fields, onChange, title,
}: { fields: TelemetryField[]; onChange: (f: TelemetryField[]) => void; title: string }) {
  function update(i: number, patch: Partial<TelemetryField>) {
    const next = fields.map((f, idx) => idx === i ? { ...f, ...patch } : f)
    onChange(next)
  }
  function remove(i: number) { onChange(fields.filter((_, idx) => idx !== i)) }
  function add() { onChange([...fields, EMPTY_TELEMETRY_FIELD()]) }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <button
          type="button"
          onClick={add}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add Field
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-xs text-slate-400 italic mb-2">No fields defined</p>
      )}

      <div className="space-y-3">
        {fields.map((f, i) => (
          <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Key *</label>
                <input
                  value={f.key}
                  onChange={e => update(i, { key: e.target.value })}
                  placeholder="temperature"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Label *</label>
                <input
                  value={f.label}
                  onChange={e => update(i, { label: e.target.value })}
                  placeholder="Temperature"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Data Type</label>
                <select
                  value={f.data_type}
                  onChange={e => update(i, { data_type: e.target.value as 'number' | 'string' | 'boolean' })}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Unit</label>
                <input
                  value={f.unit ?? ''}
                  onChange={e => update(i, { unit: e.target.value })}
                  placeholder="°C, %, kWh…"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {f.data_type === 'number' && (
                <>
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Min</label>
                    <input
                      type="number"
                      value={f.min_value ?? ''}
                      onChange={e => update(i, { min_value: e.target.value ? Number(e.target.value) : undefined })}
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Max</label>
                    <input
                      type="number"
                      value={f.max_value ?? ''}
                      onChange={e => update(i, { max_value: e.target.value ? Number(e.target.value) : undefined })}
                      className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={f.description ?? ''}
                onChange={e => update(i, { description: e.target.value })}
                placeholder="Optional description"
                className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-red-400 hover:text-red-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RpcCommandsEditor({ commands, onChange }: { commands: RpcCommand[]; onChange: (c: RpcCommand[]) => void }) {
  function update(i: number, patch: Partial<RpcCommand>) {
    onChange(commands.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }
  function remove(i: number) { onChange(commands.filter((_, idx) => idx !== i)) }
  function add() { onChange([...commands, EMPTY_RPC_COMMAND()]) }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">RPC Commands</span>
        <button type="button" onClick={add} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          + Add Command
        </button>
      </div>

      {commands.length === 0 && (
        <p className="text-xs text-slate-400 italic mb-2">No RPC commands defined</p>
      )}

      <div className="space-y-3">
        {commands.map((c, i) => (
          <div key={i} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Command Name *</label>
                <input
                  value={c.name}
                  onChange={e => update(i, { name: e.target.value })}
                  placeholder="unlock"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">Display Label *</label>
                <input
                  value={c.label}
                  onChange={e => update(i, { label: e.target.value })}
                  placeholder="Unlock Door"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={c.description ?? ''}
                onChange={e => update(i, { description: e.target.value })}
                placeholder="Description (optional)"
                className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-red-400 hover:text-red-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Step navigation ────────────────────────────────────────────────────────
type Step = 'basics' | 'telemetry' | 'commands' | 'capabilities'

const STEPS: { id: Step; label: string }[] = [
  { id: 'basics',       label: 'Basics' },
  { id: 'telemetry',    label: 'Telemetry Schema' },
  { id: 'commands',     label: 'RPC Commands' },
  { id: 'capabilities', label: 'Capabilities' },
]

// ── Main component ─────────────────────────────────────────────────────────
export default function DeviceTypeSlideOver({ deviceType, onClose, onSaved }: Props) {
  const isEdit = !!deviceType

  const [step, setStep] = useState<Step>('basics')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [name, setName] = useState(deviceType?.name ?? '')
  const [category, setCategory] = useState<DeviceCategory>(deviceType?.category ?? 'sensor')
  const [protocol, setProtocol] = useState<DeviceProtocol>(deviceType?.protocol ?? 'mqtt')
  const [description, setDescription] = useState(deviceType?.description ?? '')
  const [icon, setIcon] = useState(deviceType?.icon ?? '')
  const [otaSupported, setOtaSupported] = useState(deviceType?.ota_supported ?? false)
  const [telemetrySchema, setTelemetrySchema] = useState<TelemetryField[]>(
    deviceType?.telemetry_schema ?? []
  )
  const [attributeSchema, setAttributeSchema] = useState<TelemetryField[]>(
    deviceType?.attribute_schema ?? []
  )
  const [rpcCommands, setRpcCommands] = useState<RpcCommand[]>(
    deviceType?.rpc_commands ?? []
  )
  const [capabilities, setCapabilities] = useState<string[]>(
    deviceType?.capabilities ?? ['telemetry']
  )

  function toggleCapability(key: string) {
    setCapabilities(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    )
  }

  const stepIndex = STEPS.findIndex(s => s.id === step)
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  function validateBasics() {
    if (!name.trim()) { setError('Name is required'); return false }
    return true
  }

  function handleNext() {
    setError('')
    if (step === 'basics' && !validateBasics()) return
    if (!isLast) setStep(STEPS[stepIndex + 1].id)
  }

  async function handleSave() {
    setError('')
    if (!validateBasics()) { setStep('basics'); return }

    setSaving(true)
    const payload = {
      name: name.trim(),
      category,
      protocol,
      description: description.trim() || undefined,
      icon: icon.trim() || undefined,
      ota_supported: otaSupported,
      telemetry_schema: telemetrySchema.filter(f => f.key && f.label),
      attribute_schema: attributeSchema.filter(f => f.key && f.label),
      rpc_commands: rpcCommands.filter(c => c.name && c.label),
      capabilities,
    }

    try {
      let result: DeviceType
      if (isEdit) {
        result = await deviceTypesApi.update(deviceType!.id, payload) as DeviceType
      } else {
        result = await deviceTypesApi.create(payload)
      }
      onSaved(result)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const currentCat = CATEGORIES.find(c => c.value === category)

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isEdit ? 'Edit Device Type' : 'New Device Type'}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {isEdit ? `Editing "${deviceType!.name}"` : 'Define a template for your IoT devices'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-slate-100 px-6">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { setError(''); setStep(s.id) }}
              className={`py-3 px-3 text-sm font-medium border-b-2 -mb-px mr-1 transition-colors ${
                step === s.id
                  ? 'border-blue-600 text-blue-600'
                  : i <= stepIndex
                    ? 'border-transparent text-slate-600 hover:text-slate-900'
                    : 'border-transparent text-slate-400'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-1.5 ${
                i < stepIndex ? 'bg-green-100 text-green-700' :
                i === stepIndex ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {i < stepIndex ? '✓' : i + 1}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Step: Basics */}
          {step === 'basics' && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Smart Temperature Sensor"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Category *</label>
                <div className="grid grid-cols-4 gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(cat.value)}
                      className={`flex flex-col items-center gap-1 rounded-xl p-2.5 border text-xs font-medium transition-colors ${
                        category === cat.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-lg">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Protocol</label>
                  <select
                    value={protocol}
                    onChange={e => setProtocol(e.target.value as DeviceProtocol)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Icon (emoji)</label>
                  <input
                    value={icon}
                    onChange={e => setIcon(e.target.value)}
                    placeholder={currentCat?.icon ?? '🔧'}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of this device type…"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-sm font-medium text-slate-700">OTA Firmware Updates</p>
                  <p className="text-xs text-slate-500 mt-0.5">Devices of this type support over-the-air firmware updates</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOtaSupported(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${otaSupported ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${otaSupported ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>
          )}

          {/* Step: Telemetry Schema */}
          {step === 'telemetry' && (
            <div className="space-y-6">
              <TelemetrySchemaEditor
                title="Telemetry Fields"
                fields={telemetrySchema}
                onChange={setTelemetrySchema}
              />
              <div className="border-t border-slate-200 pt-5">
                <TelemetrySchemaEditor
                  title="Attribute Fields (static device properties)"
                  fields={attributeSchema}
                  onChange={setAttributeSchema}
                />
              </div>
            </div>
          )}

          {/* Step: RPC Commands */}
          {step === 'commands' && (
            <RpcCommandsEditor commands={rpcCommands} onChange={setRpcCommands} />
          )}

          {/* Step: Capabilities */}
          {step === 'capabilities' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Select which capabilities devices of this type support. These determine which
                features are available for each device.
              </p>
              {CAPABILITY_OPTIONS.map(cap => {
                const checked = capabilities.includes(cap.key)
                return (
                  <button
                    key={cap.key}
                    type="button"
                    onClick={() => toggleCapability(cap.key)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-colors ${
                      checked
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                    }`}>
                      {checked && <span className="text-white text-xs">✓</span>}
                    </span>
                    <div>
                      <p className={`text-sm font-medium ${checked ? 'text-blue-700' : 'text-slate-700'}`}>
                        {cap.label}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{cap.hint}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => isFirst ? onClose() : setStep(STEPS[stepIndex - 1].id)}
            className="text-sm text-slate-600 hover:text-slate-900 font-medium"
          >
            {isFirst ? 'Cancel' : '← Back'}
          </button>

          {!isLast ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Device Type'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
