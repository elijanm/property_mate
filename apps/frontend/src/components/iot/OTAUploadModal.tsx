import { useEffect, useRef, useState } from 'react'
import { otaApi, deviceTypesApi } from '@/api/iot'
import { extractApiError } from '@/utils/apiError'
import type { DeviceType, OTAUpdate } from '@/types/iot'

interface Props {
  propertyId: string
  onClose: () => void
  onUploaded: (ota: OTAUpdate) => void
}

export default function OTAUploadModal({ propertyId, onClose, onUploaded }: Props) {
  const [deviceTypeId, setDeviceTypeId] = useState('')
  const [targetVersion, setTargetVersion] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [rolloutPct, setRolloutPct] = useState(100)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<OTAUpdate | null>(null)
  const [startingRollout, setStartingRollout] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    deviceTypesApi.list().then(setDeviceTypes).catch(() => {})
  }, [])

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  async function handleUpload() {
    if (!deviceTypeId) { setError('Device type is required'); return }
    if (!targetVersion.trim()) { setError('Target version is required'); return }
    if (!file) { setError('Firmware file is required'); return }

    setError('')
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('device_type_id', deviceTypeId)
      formData.append('target_version', targetVersion.trim())
      formData.append('rollout_pct', rolloutPct.toString())
      formData.append('property_id', propertyId)
      if (releaseNotes.trim()) formData.append('release_notes', releaseNotes.trim())
      formData.append('firmware', file)

      const ota = await otaApi.uploadFirmware(formData)
      setResult(ota)
    } catch (err) {
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
    } catch (err) {
      alert(extractApiError(err).message)
      setStartingRollout(false)
    }
  }

  const ROLLOUT_STEPS = [10, 25, 50, 75, 100]

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Upload Firmware</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                <p className="font-semibold text-green-800 text-sm">Firmware uploaded successfully!</p>
                <p className="text-sm text-green-700 mt-1">v{result.target_version} is ready to deploy.</p>
              </div>
              <p className="text-sm text-gray-700 mb-4">
                Would you like to start the rollout now ({result.rollout_pct}% of devices)?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onUploaded(result)}
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
                >
                  Later
                </button>
                <button
                  onClick={handleStartRollout}
                  disabled={startingRollout}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                >
                  {startingRollout ? 'Starting…' : 'Start Rollout'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Device Type *</label>
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
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Target Version *</label>
                <input
                  type="text"
                  className="input w-full text-sm font-mono"
                  value={targetVersion}
                  onChange={e => setTargetVersion(e.target.value)}
                  placeholder="e.g. 2.2.0"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Release Notes</label>
                <textarea
                  className="input w-full text-sm h-20 resize-none"
                  value={releaseNotes}
                  onChange={e => setReleaseNotes(e.target.value)}
                  placeholder="What's new in this version?"
                />
              </div>

              {/* Firmware file */}
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Firmware File *</label>
                <div
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {file ? (
                    <div>
                      <p className="text-sm font-medium text-gray-800">{file.name}</p>
                      <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div>
                      <div className="text-3xl mb-2">📁</div>
                      <p className="text-sm text-gray-600">Drag & drop or click to upload</p>
                      <p className="text-xs text-gray-400 mt-1">Accepts .bin, .tar.gz, .zip</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".bin,.tar.gz,.zip,.gz"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              {/* Rollout % */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">Rollout Percentage</label>
                  <span className="text-xs font-semibold text-blue-600">{rolloutPct}%</span>
                </div>
                <input
                  type="range"
                  className="w-full"
                  min="10" max="100" step="5"
                  value={rolloutPct}
                  onChange={e => setRolloutPct(Number(e.target.value))}
                />
                <div className="flex justify-between mt-1">
                  {ROLLOUT_STEPS.map(s => (
                    <button
                      key={s}
                      onClick={() => setRolloutPct(s)}
                      className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                        rolloutPct === s ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {s}%
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={saving}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                >
                  {saving ? 'Uploading…' : 'Upload Firmware'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
