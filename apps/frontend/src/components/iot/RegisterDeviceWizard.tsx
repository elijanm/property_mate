import { useEffect, useState } from 'react'
import { inventoryApi } from '@/api/inventory'
import { deviceTypesApi, syncApi } from '@/api/iot'
import { unitsApi } from '@/api/units'
import { extractApiError } from '@/utils/apiError'
import { useProperty } from '@/context/PropertyContext'
import type { InventoryItem, StockSerial } from '@/types/inventory'
import type { DeviceType, RegisterDeviceResult } from '@/types/iot'
import type { Unit } from '@/types/unit'

interface Props {
  propertyId: string
  onClose: () => void
  onRegistered: (device: RegisterDeviceResult) => void
}

type Step = 'inventory' | 'serial' | 'identity' | 'capabilities' | 'review'

const STEPS: { id: Step; label: string }[] = [
  { id: 'inventory', label: 'Find in Inventory' },
  { id: 'serial', label: 'Select Serial' },
  { id: 'identity', label: 'Identity & Type' },
  { id: 'capabilities', label: 'Capabilities & Assignment' },
  { id: 'review', label: 'Review & Register' },
]

const IOT_KEYWORDS = ['iot', 'smart', 'sensor', 'lock', 'meter', 'camera', 'gateway', 'lora', 'modbus']

export default function RegisterDeviceWizard({ propertyId, onClose, onRegistered }: Props) {
  const property = useProperty()
  const [step, setStep] = useState<Step>('inventory')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RegisterDeviceResult | null>(null)
  const [copiedPwd, setCopiedPwd] = useState(false)
  const [copiedCert, setCopiedCert] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  // Step 1: Inventory
  const [inventorySearch, setInventorySearch] = useState('')
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)

  // Step 2: Serial
  const [selectedSerial, setSelectedSerial] = useState<StockSerial | null>(null)

  // Step 3: Identity
  const [deviceName, setDeviceName] = useState('')
  const [deviceTypeId, setDeviceTypeId] = useState('')
  const [deviceUid, setDeviceUid] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([])
  const [deviceTypesLoading, setDeviceTypesLoading] = useState(false)

  // Step 4: Capabilities
  const [capTelemetry, setCapTelemetry] = useState(true)
  const [capSSH, setCapSSH] = useState(false)
  const [capRPC, setCapRPC] = useState(false)
  const [capOTA, setCapOTA] = useState(false)
  const [unitId, setUnitId] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [installer, setInstaller] = useState('')
  const [installDate, setInstallDate] = useState('')

  // Load inventory items on search change
  useEffect(() => {
    setInventoryLoading(true)
    inventoryApi.list({ property_id: propertyId, search: inventorySearch || undefined, page_size: 50 })
      .then(res => {
        const items = res.items ?? (Array.isArray(res) ? res as unknown as InventoryItem[] : [])
        // If no search, filter to likely IoT items
        if (!inventorySearch.trim()) {
          const filtered = items.filter(item =>
            IOT_KEYWORDS.some(k =>
              item.name.toLowerCase().includes(k) ||
              (item.category ?? '').toLowerCase().includes(k) ||
              (item.tags ?? []).some((t: string) => t.toLowerCase().includes(k))
            )
          )
          setInventoryItems(filtered.length > 0 ? filtered : items)
        } else {
          setInventoryItems(items)
        }
      })
      .catch(() => setInventoryItems([]))
      .finally(() => setInventoryLoading(false))
  }, [inventorySearch, propertyId])

  // Load device types
  useEffect(() => {
    setDeviceTypesLoading(true)
    deviceTypesApi.list()
      .then(setDeviceTypes)
      .catch(() => {})
      .finally(() => setDeviceTypesLoading(false))
  }, [])

  // Load units
  useEffect(() => {
    setUnitsLoading(true)
    unitsApi.list(propertyId, { page_size: 200 })
      .then(res => setUnits(res.items ?? []))
      .catch(() => {})
      .finally(() => setUnitsLoading(false))
  }, [propertyId])

  function selectItem(item: InventoryItem) {
    setSelectedItem(item)
    if (item.is_serialized) {
      setStep('serial')
    } else {
      // Skip serial step, prefill identity
      setDeviceName(item.name)
      setSerialNumber(item.sku ?? '')
      setDeviceUid(item.sku ?? `${item.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`)
      setStep('identity')
    }
  }

  function selectSerial(serial: StockSerial) {
    setSelectedSerial(serial)
    setSerialNumber(serial.serial_number)
    setDeviceUid(serial.serial_number)
    setDeviceName(selectedItem ? `${selectedItem.name} #${serial.serial_number}` : serial.serial_number)
    setStep('identity')
  }

  function addTag(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      const t = tagInput.trim()
      if (t && !tags.includes(t)) setTags(prev => [...prev, t])
      setTagInput('')
    }
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t))
  }

  async function handleSubmit() {
    setError('')
    if (!deviceTypeId) { setError('Device type is required'); return }
    if (!deviceUid.trim()) { setError('Device UID is required'); return }
    if (!deviceName.trim()) { setError('Device name is required'); return }

    const propertyName = property?.name ?? propertyId
    const selectedUnit = units.find(u => u.id === unitId)

    setSaving(true)
    try {
      const res = await syncApi.registerDevice({
        device_uid: deviceUid.trim(),
        device_name: deviceName.trim(),
        device_type_id: deviceTypeId,
        property_id: propertyId,
        property_name: propertyName,
        unit_id: unitId || undefined,
        unit_name: selectedUnit?.unit_code || undefined,
        serial_number: serialNumber || undefined,
        tags,
        description: selectedItem ? `Inventory: ${selectedItem.name}` : undefined,
        capabilities: {
          telemetry: capTelemetry,
          ssh: capSSH,
          rpc: capRPC,
          ota: capOTA,
          attributes: true,
          streaming: false,
        },
      })
      setResult(res)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  function handleDone() {
    if (result) onRegistered(result)
  }

  function downloadText(filename: string, content: string) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    a.download = filename
    a.click()
  }

  // If item is not serialized, skip the serial step
  const visibleSteps = selectedItem && !selectedItem.is_serialized
    ? STEPS.filter(s => s.id !== 'serial')
    : STEPS

  const visibleIndex = visibleSteps.findIndex(s => s.id === step)

  function goBack() {
    const prev = visibleSteps[visibleIndex - 1]
    if (prev) setStep(prev.id)
  }

  function goNext() {
    const next = visibleSteps[visibleIndex + 1]
    if (next) setStep(next.id)
  }

  const selectedDeviceType = deviceTypes.find(dt => dt.id === deviceTypeId)

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Register Device</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Step {visibleIndex + 1} of {visibleSteps.length}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-gray-100">
          <div className="flex gap-1">
            {visibleSteps.map((s, i) => (
              <div
                key={s.id}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i <= visibleIndex ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-gray-700 mt-2">{visibleSteps[visibleIndex]?.label}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Find in Inventory */}
          {step === 'inventory' && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Search your inventory for the physical device. IoT-related items are shown by default.
              </p>
              <input
                type="text"
                className="input w-full text-sm mb-4"
                placeholder="Search inventory items…"
                value={inventorySearch}
                onChange={e => setInventorySearch(e.target.value)}
              />
              {inventoryLoading ? (
                <p className="text-sm text-gray-400 text-center py-8">Searching…</p>
              ) : (
                <div className="space-y-2">
                  {inventoryItems.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No matching inventory items found</p>
                  )}
                  {inventoryItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        selectedItem?.id === item.id
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                          <p className="text-xs text-gray-500">
                            {item.category} {item.sku ? `· SKU: ${item.sku}` : ''}
                            {item.is_serialized ? ' · Serialized' : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">{item.unit_of_measure}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select Serial */}
          {step === 'serial' && selectedItem && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Select the serial unit for <strong>{selectedItem.name}</strong>.
              </p>
              <div className="space-y-2">
                {(selectedItem.serials ?? [])
                  .filter((s: StockSerial) => s.status === 'in_stock')
                  .map((serial: StockSerial) => (
                    <button
                      key={serial.id}
                      onClick={() => selectSerial(serial)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        selectedSerial?.id === serial.id
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-sm font-medium text-gray-900">{serial.serial_number}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {serial.status}
                            {serial.purchase_cost != null ? ` · Cost: KES ${serial.purchase_cost.toLocaleString()}` : ''}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                {((selectedItem.serials ?? []).filter((s: StockSerial) => s.status === 'in_stock').length === 0) && (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-400">No serials in stock for this item</p>
                    <button
                      onClick={() => setStep('identity')}
                      className="mt-3 text-xs text-blue-600 hover:underline"
                    >
                      Skip and enter manually
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Identity & Type */}
          {step === 'identity' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Device Name *</label>
                <input
                  type="text"
                  className="input w-full text-sm"
                  value={deviceName}
                  onChange={e => setDeviceName(e.target.value)}
                  placeholder="e.g. Front Door Lock, Unit 3A Meter"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Device Type *</label>
                {deviceTypesLoading ? (
                  <p className="text-sm text-gray-400">Loading device types…</p>
                ) : (
                  <select
                    className="input w-full text-sm"
                    value={deviceTypeId}
                    onChange={e => setDeviceTypeId(e.target.value)}
                  >
                    <option value="">Select device type…</option>
                    {deviceTypes.map(dt => (
                      <option key={dt.id} value={dt.id}>{dt.name} ({dt.category})</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Device UID *</label>
                <input
                  type="text"
                  className="input w-full text-sm font-mono"
                  value={deviceUid}
                  onChange={e => setDeviceUid(e.target.value)}
                  placeholder="Unique identifier (MAC, serial, etc.)"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Serial Number</label>
                <input
                  type="text"
                  className="input w-full text-sm font-mono"
                  value={serialNumber}
                  onChange={e => setSerialNumber(e.target.value)}
                  placeholder="Physical serial number"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                      {t}
                      <button onClick={() => removeTag(t)} className="hover:text-blue-900">×</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  className="input w-full text-sm"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={addTag}
                  placeholder="Type tag and press Space or Enter"
                />
              </div>
            </div>
          )}

          {/* Step 4: Capabilities & Assignment */}
          {step === 'capabilities' && (
            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-3">Capabilities</label>
                <div className="space-y-2">
                  {[
                    { key: 'telemetry', label: 'Telemetry', desc: 'Send sensor data to platform', value: capTelemetry, set: setCapTelemetry },
                    { key: 'ssh', label: 'SSH Access', desc: 'Remote shell via Tailscale VPN', value: capSSH, set: setCapSSH },
                    { key: 'rpc', label: 'Remote Commands', desc: 'Send commands to the device', value: capRPC, set: setCapRPC },
                    { key: 'ota', label: 'OTA Updates', desc: 'Over-the-air firmware updates', value: capOTA, set: setCapOTA },
                  ].map(cap => (
                    <div key={cap.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{cap.label}</p>
                        <p className="text-xs text-gray-500">{cap.desc}</p>
                      </div>
                      <button
                        onClick={() => cap.set(!cap.value)}
                        className={`relative inline-flex h-6 w-10 cursor-pointer rounded-full transition-colors ${cap.value ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${cap.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  ))}
                </div>
                {capSSH && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                    SSH is enabled — this device will be auto-registered in Headscale VPN on first connection.
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Assign to Unit</label>
                {unitsLoading ? (
                  <p className="text-sm text-gray-400">Loading units…</p>
                ) : (
                  <select
                    className="input w-full text-sm"
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                  >
                    <option value="">No unit assignment</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.unit_code} — {u.unit_type}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Installer Name</label>
                <input
                  type="text"
                  className="input w-full text-sm"
                  value={installer}
                  onChange={e => setInstaller(e.target.value)}
                  placeholder="Name of installer (optional)"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Installation Date</label>
                <input
                  type="date"
                  className="input w-full text-sm"
                  value={installDate}
                  onChange={e => setInstallDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 5: Review & Register */}
          {step === 'review' && !result && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                <h3 className="font-semibold text-gray-900 text-sm">Review Configuration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">Device Name</p>
                    <p className="font-medium text-gray-900">{deviceName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Device Type</p>
                    <p className="font-medium text-gray-900">{selectedDeviceType?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Device UID</p>
                    <p className="font-mono text-gray-900">{deviceUid}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Serial Number</p>
                    <p className="font-mono text-gray-900">{serialNumber || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Capabilities</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {capTelemetry && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">Telemetry</span>}
                      {capSSH && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">SSH</span>}
                      {capRPC && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">RPC</span>}
                      {capOTA && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">OTA</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Unit</p>
                    <p className="font-medium text-gray-900">
                      {unitId ? units.find(u => u.id === unitId)?.unit_code ?? unitId : 'None'}
                    </p>
                  </div>
                  {tags.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500">Tags</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {tags.map(t => (
                          <span key={t} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedItem && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500">Inventory Item</p>
                      <p className="font-medium text-gray-900">{selectedItem.name} {selectedItem.sku ? `(${selectedItem.sku})` : ''}</p>
                    </div>
                  )}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}
            </div>
          )}

          {/* Success: Full provisioning result */}
          {step === 'review' && result && (
            <div className="space-y-4">
              {/* Status banner */}
              {result.status === 'provisioned' ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="font-semibold text-green-800 text-sm">Device fully provisioned</p>
                  <p className="text-xs text-green-700 mt-1">{result.note}</p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="font-semibold text-amber-800 text-sm">Partially provisioned</p>
                  <p className="text-xs text-amber-700 mt-1">{result.note}</p>
                </div>
              )}

              {/* Provisioning steps audit trail */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Provisioning Steps</p>
                <div className="space-y-1.5">
                  {result.steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 flex-shrink-0 ${s.status === 'ok' ? 'text-green-600' : s.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                        {s.status === 'ok' ? '✓' : s.status === 'error' ? '✗' : '–'}
                      </span>
                      <span className="text-gray-700 font-medium w-36 flex-shrink-0">{s.name}</span>
                      <span className="text-gray-500 truncate">{s.detail || (s.status === 'skipped' ? 'skipped' : '')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ThingsBoard entities */}
              {(result.tb_tenant_id || result.tb_customer_id || result.tb_asset_id || result.tb_device_id) && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1.5 text-xs">
                  <p className="font-semibold text-blue-800 mb-2">ThingsBoard Entities</p>
                  {result.tb_tenant_id && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">Tenant (Org)</span>
                      <span className="font-mono text-blue-900 truncate ml-4">{result.tb_tenant_id}</span>
                    </div>
                  )}
                  {result.tb_customer_id && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">Customer (Property)</span>
                      <span className="font-mono text-blue-900 truncate ml-4">{result.tb_customer_id}</span>
                    </div>
                  )}
                  {result.tb_asset_id && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">Asset (Unit)</span>
                      <span className="font-mono text-blue-900 truncate ml-4">{result.tb_asset_id}</span>
                    </div>
                  )}
                  {result.tb_device_id && (
                    <div className="flex justify-between">
                      <span className="text-blue-600">Device</span>
                      <span className="font-mono text-blue-900 truncate ml-4">{result.tb_device_id}</span>
                    </div>
                  )}
                  {result.tb_dashboard_url && (
                    <a
                      href={result.tb_dashboard_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block text-blue-600 hover:underline"
                    >
                      Open in ThingsBoard →
                    </a>
                  )}
                </div>
              )}

              {/* MQTT credentials */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2">
                  MQTT Credentials — save now, password not shown again
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'Broker', value: `${result.mqtt_broker_host}:${result.mqtt_broker_port}` },
                    { label: 'Username', value: result.mqtt_username },
                    { label: 'Client ID', value: result.mqtt_client_id },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-amber-700 w-16 flex-shrink-0">{label}</span>
                      <span className="font-mono text-xs text-gray-800 bg-white px-2 py-1 rounded border border-amber-200 flex-1 truncate">{value}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-amber-700 w-16 flex-shrink-0">Password</span>
                    <span className="font-mono text-xs text-gray-800 bg-white px-2 py-1 rounded border border-amber-200 flex-1 truncate">{result.mqtt_password}</span>
                    <button onClick={() => { navigator.clipboard.writeText(result.mqtt_password); setCopiedPwd(true); setTimeout(() => setCopiedPwd(false), 2000) }}
                      className="px-2 py-1 text-xs text-blue-600 border border-blue-200 bg-white rounded hover:bg-blue-50 flex-shrink-0">
                      {copiedPwd ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* mTLS Certificate */}
              {result.device_cert_pem && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-700">mTLS Client Certificate</p>
                    <div className="flex gap-1">
                      <button onClick={() => { navigator.clipboard.writeText(result.device_cert_pem!); setCopiedCert(true); setTimeout(() => setCopiedCert(false), 2000) }}
                        className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50">
                        {copiedCert ? '✓ Copied' : 'Copy cert'}
                      </button>
                      <button onClick={() => downloadText(`${result.device_uid}.crt`, result.device_cert_pem!)}
                        className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50">
                        ↓ .crt
                      </button>
                    </div>
                  </div>
                  {result.cert_fingerprint && (
                    <p className="text-[10px] font-mono text-gray-500 mb-2 truncate">SHA-256: {result.cert_fingerprint}</p>
                  )}
                  <pre className="text-[10px] font-mono text-gray-600 bg-white border border-gray-200 rounded p-2 max-h-20 overflow-y-auto">
                    {result.device_cert_pem.slice(0, 200)}…
                  </pre>
                </div>
              )}
              {result.device_key_pem && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-700">Private Key — save securely, shown once</p>
                    <div className="flex gap-1">
                      <button onClick={() => { navigator.clipboard.writeText(result.device_key_pem!); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000) }}
                        className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                        {copiedKey ? '✓ Copied' : 'Copy key'}
                      </button>
                      <button onClick={() => downloadText(`${result.device_uid}.key`, result.device_key_pem!)}
                        className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">
                        ↓ .key
                      </button>
                    </div>
                  </div>
                  <pre className="text-[10px] font-mono text-gray-600 bg-white border border-gray-200 rounded p-2 max-h-20 overflow-y-auto">
                    {result.device_key_pem.slice(0, 200)}…
                  </pre>
                </div>
              )}

              {/* SSH setup */}
              {result.ssh_setup && !('error' in result.ssh_setup) && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-blue-800 mb-2">SSH / Tailscale Setup</p>
                  {(result.ssh_setup.tailscale_register_cmd as string) && (
                    <pre className="font-mono text-xs text-blue-900 bg-white border border-blue-200 rounded p-2 break-all whitespace-pre-wrap">
                      {result.ssh_setup.tailscale_register_cmd as string}
                    </pre>
                  )}
                  {Array.isArray(result.ssh_setup.setup_steps) && (
                    <ol className="mt-2 space-y-0.5 text-xs text-blue-700 list-none">
                      {(result.ssh_setup.setup_steps as string[]).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          {step === 'review' && result ? (
            <button
              onClick={handleDone}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-xl"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={visibleIndex === 0 ? onClose : goBack}
                className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                {visibleIndex === 0 ? 'Cancel' : 'Back'}
              </button>
              {step !== 'review' ? (
                <button
                  onClick={goNext}
                  disabled={
                    (step === 'inventory' && !selectedItem) ||
                    (step === 'serial' && !selectedSerial && (selectedItem?.is_serialized ?? false)) ||
                    (step === 'identity' && (!deviceName.trim() || !deviceTypeId || !deviceUid.trim()))
                  }
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Registering…' : 'Register Device'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
