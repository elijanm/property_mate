import { useState } from 'react'
import { fleetsApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import type { Device, DeviceGroup, DeviceGroupPayload, DeviceStatus } from '@/types/iot'

interface Props {
  propertyId: string
  fleet?: DeviceGroup
  devices: Device[]
  onClose: () => void
  onSaved: (fleet: DeviceGroup) => void
}

const STATUS_DOT_COLORS: Record<DeviceStatus, string> = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  quarantined: 'bg-red-500',
  provisioned: 'bg-yellow-400',
  decommissioned: 'bg-gray-300',
}

export default function FleetSlideOver({ propertyId, fleet, devices, onClose, onSaved }: Props) {
  const isEdit = !!fleet

  const [name, setName] = useState(fleet?.name ?? '')
  const [description, setDescription] = useState(fleet?.description ?? '')
  const [tagFilter, setTagFilter] = useState(fleet?.tag_filter ?? '')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(fleet?.device_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Bulk action state
  const [showBulkCmd, setShowBulkCmd] = useState(false)
  const [bulkCmdName, setBulkCmdName] = useState('')
  const [bulkCmdRunning, setBulkCmdRunning] = useState(false)
  const [bulkCmdResult, setBulkCmdResult] = useState<string | null>(null)

  function toggleDevice(id: string) {
    setSelectedDeviceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  // Devices auto-included by tag filter
  const tagFilteredDevices = tagFilter.trim()
    ? devices.filter(d => d.tags.includes(tagFilter.trim()))
    : []

  const effectiveDeviceIds = Array.from(new Set([
    ...selectedDeviceIds,
    ...tagFilteredDevices.map(d => d.id),
  ]))

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    setSaving(true)
    try {
      const payload: DeviceGroupPayload = {
        name: name.trim(),
        description: description.trim() || undefined,
        property_id: propertyId,
        device_ids: selectedDeviceIds,
        tag_filter: tagFilter.trim() || undefined,
      }

      const saved = isEdit
        ? await fleetsApi.update(fleet.id, payload)
        : await fleetsApi.create(payload)
      onSaved(saved)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkCommand() {
    if (!fleet || !bulkCmdName.trim()) return
    setBulkCmdRunning(true)
    setBulkCmdResult(null)
    try {
      const result = await fleetsApi.bulkCommand(fleet.id, { command_name: bulkCmdName })
      setBulkCmdResult(`Sent ${result.length} commands successfully`)
    } catch (err) {
      setBulkCmdResult(`Error: ${extractApiError(err).message}`)
    } finally {
      setBulkCmdRunning(false)
    }
  }

  async function handleBulkQuarantine() {
    if (!fleet) return
    const reason = window.prompt('Quarantine reason for all devices in this fleet:')
    if (reason == null) return
    try {
      const result = await fleetsApi.bulkQuarantine(fleet.id, reason)
      alert(`Quarantined ${result.quarantined} devices (${result.skipped} skipped)`)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {isEdit ? `Edit Fleet: ${fleet.name}` : 'New Fleet'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Fleet Name *</label>
            <input type="text" className="input w-full text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Building A Locks, Meter Readers" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Description</label>
            <input type="text" className="input w-full text-sm" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Tag Filter</label>
            <input
              type="text"
              className="input w-full text-sm font-mono"
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              placeholder="e.g. wing-a, floor-2"
            />
            <p className="text-xs text-gray-400 mt-1">
              Devices with this tag will be auto-included
              {tagFilteredDevices.length > 0 && ` (${tagFilteredDevices.length} matched)`}
            </p>
          </div>

          {/* Device selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Devices ({effectiveDeviceIds.length} selected)</label>
              {selectedDeviceIds.length > 0 && (
                <button onClick={() => setSelectedDeviceIds([])} className="text-xs text-gray-400 hover:text-gray-600">
                  Clear all
                </button>
              )}
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {devices.length === 0 && (
                <p className="text-sm text-gray-400">No devices in this property</p>
              )}
              {devices.map(device => {
                const fromTag = tagFilteredDevices.some(d => d.id === device.id)
                const checked = selectedDeviceIds.includes(device.id) || fromTag
                return (
                  <label
                    key={device.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                      checked ? 'bg-blue-50 border border-blue-200' : 'border border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={fromTag}
                      onChange={() => !fromTag && toggleDevice(device.id)}
                      className="rounded"
                    />
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${STATUS_DOT_COLORS[device.status]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{device.name}</p>
                      <p className="text-xs text-gray-400">{device.device_type_category}</p>
                    </div>
                    {fromTag && (
                      <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">via tag</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Bulk actions (edit mode only) */}
          {isEdit && (
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Bulk Actions</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Send Command to All</label>
                  {showBulkCmd ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        className="input w-full text-sm font-mono"
                        value={bulkCmdName}
                        onChange={e => setBulkCmdName(e.target.value)}
                        placeholder="Command name (e.g. reboot)"
                      />
                      {bulkCmdResult && (
                        <p className={`text-xs ${bulkCmdResult.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                          {bulkCmdResult}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setShowBulkCmd(false)} className="flex-1 py-1.5 text-xs border border-gray-200 rounded-xl hover:bg-gray-50">
                          Cancel
                        </button>
                        <button
                          onClick={handleBulkCommand}
                          disabled={bulkCmdRunning || !bulkCmdName.trim()}
                          className="flex-1 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                        >
                          {bulkCmdRunning ? 'Sending…' : 'Send to All'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowBulkCmd(true)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50"
                    >
                      Send Command to All
                    </button>
                  )}
                </div>

                <div>
                  <button
                    onClick={handleBulkQuarantine}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50"
                  >
                    Quarantine All Devices
                  </button>
                </div>
              </div>
            </div>
          )}

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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Fleet'}
          </button>
        </div>
      </div>
    </div>
  )
}
