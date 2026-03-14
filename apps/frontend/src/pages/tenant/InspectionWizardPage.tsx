import { useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { inspectionsApi } from '@/api/inspections'
import { extractApiError } from '@/utils/apiError'
import type { InspectionReport } from '@/types/inspection'

// ── Expiry helpers ─────────────────────────────────────────────────────────────

function useInspectionExpiry(report: InspectionReport | null) {
  const now = new Date()
  if (!report?.expires_at) return { isExpired: false, daysLeft: null }
  const expiresAt = new Date(report.expires_at)
  const diffMs = expiresAt.getTime() - now.getTime()
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return { isExpired: diffMs <= 0, daysLeft: Math.max(0, daysLeft) }
}

function ExpiryBanner({ report }: { report: InspectionReport }) {
  const { isExpired, daysLeft } = useInspectionExpiry(report)
  if (!report.expires_at) return null
  if (isExpired) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3 mb-6">
        <span className="text-red-500 mt-0.5">⏰</span>
        <div>
          <p className="text-sm font-semibold text-red-800">Inspection window has closed</p>
          <p className="text-xs text-red-600 mt-0.5">
            The {report.window_days}-day self-inspection period has ended. No new defects can be added.
            {report.defects.length > 0 && ' Your previously logged items are shown below.'}
          </p>
        </div>
      </div>
    )
  }
  const isUrgent = daysLeft !== null && daysLeft <= 3
  return (
    <div className={isUrgent
      ? 'rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 flex items-start gap-3 mb-6'
      : 'rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3 mb-6'}>
      <span className={isUrgent ? 'text-yellow-500 mt-0.5' : 'text-blue-500 mt-0.5'}>📋</span>
      <div>
        <p className={isUrgent ? 'text-sm font-semibold text-yellow-800' : 'text-sm font-semibold text-blue-800'}>
          {daysLeft === 0 ? 'Last day' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`} to log defects
        </p>
        <p className={isUrgent ? 'text-xs text-yellow-600 mt-0.5' : 'text-xs text-blue-600 mt-0.5'}>
          You have until {new Date(report.expires_at).toLocaleDateString()} to document any issues in your unit.
        </p>
      </div>
    </div>
  )
}

type Step = 'welcome' | 'meters' | 'defects' | 'review' | 'done'

const DEFECT_LOCATIONS = [
  'Living Room', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4',
  'Bathroom', 'Kitchen', 'Balcony', 'Exterior', 'Other',
]

// ── Camera support detection ──────────────────────────────────────────────────

function useCameraSupport() {
  const [hasCamera, setHasCamera] = useState(false)

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setHasCamera(devices.some((d) => d.kind === 'videoinput'))
    }).catch(() => {})
  }, [])

  return hasCamera
}

// ── Single-photo input ────────────────────────────────────────────────────────
// Uses <label htmlFor> to trigger inputs — the only reliable cross-browser way
// to forward the `capture` attribute. JS .click() on hidden inputs silently
// drops `capture` on Safari/iOS/Chrome Android.

interface SinglePhotoInputProps {
  hasCamera: boolean
  file: File | null
  onChange: (f: File | null) => void
  label?: string
}

function SinglePhotoInput({ hasCamera, file, onChange, label = 'Photo (optional)' }: SinglePhotoInputProps) {
  const uid = useId()
  const cameraId = `${uid}-cam`
  const galleryId = `${uid}-gal`

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.files?.[0] ?? null)
    e.target.value = '' // allow re-selecting same file
  }

  if (hasCamera) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">{label}</p>

        <div className="flex gap-2">
          {/* label → input is the reliable way to open camera with `capture` */}
          <label
            htmlFor={cameraId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 text-blue-700 text-xs font-medium cursor-pointer hover:bg-blue-50 active:bg-blue-100 select-none"
          >
            📷 Camera
          </label>
          <label
            htmlFor={galleryId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium cursor-pointer hover:bg-gray-50 select-none"
          >
            🖼 Gallery
          </label>
        </div>

        {/* `capture="environment"` tells the browser to open the rear camera */}
        <input id={cameraId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handle} />
        {/* No `capture` = normal file / gallery picker */}
        <input id={galleryId} type="file" accept="image/*" className="sr-only" onChange={handle} />

        {file && (
          <div className="flex items-center gap-2">
            <img src={URL.createObjectURL(file)} alt="preview" className="w-12 h-12 object-cover rounded-lg" />
            <span className="text-xs text-green-600 truncate max-w-[160px]">✓ {file.name}</span>
            <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-400 hover:text-red-500">✕</button>
          </div>
        )}
      </div>
    )
  }

  // Plain file picker for desktop / no-camera browsers
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500">{label}</p>
      <input
        type="file"
        accept="image/*"
        onChange={handle}
        className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700"
      />
      {file && <p className="text-xs text-green-600">✓ {file.name}</p>}
    </div>
  )
}

// ── Multi-photo input ─────────────────────────────────────────────────────────
// Camera: "Take Photo" (one shot, accumulated up to max) + "Gallery" (multi-pick).
// `capture` + `multiple` is broken on many mobile browsers — keep them separate.
// Fallback: plain multi-file picker.

interface MultiPhotoInputProps {
  hasCamera: boolean
  files: File[]
  onChange: (files: File[]) => void
  max?: number
  label?: string
}

function MultiPhotoInput({ hasCamera, files, onChange, max = 3, label = `Photos (up to ${max})` }: MultiPhotoInputProps) {
  const uid = useId()
  const cameraId = `${uid}-cam`
  const galleryId = `${uid}-gal`
  const canAdd = files.length < max

  function handleCamera(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f && files.length < max) onChange([...files, f])
    e.target.value = ''
  }

  function handleGallery(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).slice(0, max - files.length)
    onChange([...files, ...picked].slice(0, max))
    e.target.value = ''
  }

  function remove(idx: number) {
    onChange(files.filter((_, i) => i !== idx))
  }

  if (hasCamera) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">{label}</p>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative">
                <img src={URL.createObjectURL(f)} alt={`photo-${i}`} className="w-16 h-16 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {canAdd && (
          <div className="flex gap-2">
            <label
              htmlFor={cameraId}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 text-blue-700 text-xs font-medium cursor-pointer hover:bg-blue-50 active:bg-blue-100 select-none"
            >
              📷 Take Photo
            </label>
            <label
              htmlFor={galleryId}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium cursor-pointer hover:bg-gray-50 select-none"
            >
              🖼 Gallery
            </label>
          </div>
        )}

        {/* Single capture per tap — no `multiple` (broken with `capture` on mobile) */}
        <input id={cameraId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleCamera} />
        <input id={galleryId} type="file" accept="image/*" multiple className="sr-only" onChange={handleGallery} />
      </div>
    )
  }

  // Plain multi-file fallback
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500">{label}</p>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => onChange(Array.from(e.target.files ?? []).slice(0, max))}
        className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700"
      />
      {files.length > 0 && <p className="text-xs text-green-600">✓ {files.length} photo(s) selected</p>}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: Step[] = ['welcome', 'meters', 'defects', 'review']
  const labels: Record<string, string> = {
    welcome: 'Welcome', meters: 'Meters', defects: 'Defects', review: 'Review',
  }
  const idx = steps.indexOf(current)
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            i < idx ? 'bg-blue-600 text-white' :
            i === idx ? 'bg-blue-600 text-white ring-4 ring-blue-100' :
            'bg-gray-100 text-gray-400'
          }`}>
            {i < idx ? '✓' : i + 1}
          </div>
          <span className={`text-xs ${i === idx ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
            {labels[s]}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px w-8 ${i < idx ? 'bg-blue-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InspectionWizardPage() {
  const { token } = useParams<{ token: string }>()
  const hasCamera = useCameraSupport()

  const [report, setReport] = useState<InspectionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('welcome')

  const { isExpired } = useInspectionExpiry(report)

  // Meters step state
  const [meterData, setMeterData] = useState<Record<string, { reading: string; file: File | null }>>({})
  const [meterLoading, setMeterLoading] = useState(false)
  const [meterError, setMeterError] = useState<string | null>(null)

  // Defects step state
  const [defectLocation, setDefectLocation] = useState(DEFECT_LOCATIONS[0])
  const [defectCustomLocation, setDefectCustomLocation] = useState('')
  const [defectDescription, setDefectDescription] = useState('')
  const [defectPhotos, setDefectPhotos] = useState<File[]>([])
  const [defectLoading, setDefectLoading] = useState(false)
  const [defectError, setDefectError] = useState<string | null>(null)

  // Submit state
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    inspectionsApi.getByToken(token)
      .then((r) => {
        setReport(r)
        const initial: Record<string, { reading: string; file: File | null }> = {}
        r.meter_readings.forEach((mr) => {
          initial[mr.utility_key] = { reading: String(mr.reading), file: null }
        })
        setMeterData(initial)
      })
      .catch((err) => setLoadError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [token])

  async function saveMeterReadings() {
    if (!token || !report) return
    setMeterError(null)
    setMeterLoading(true)
    try {
      let updated = report
      for (const utility of utilityKeys()) {
        const d = meterData[utility.key] || { reading: '', file: null }
        if (!d.reading) continue
        updated = await inspectionsApi.addMeter(token, {
          utility_key: utility.key,
          utility_label: utility.label,
          reading: parseFloat(d.reading),
          unit_label: utility.unit,
        }, d.file || undefined)
      }
      setReport(updated)
      setStep('defects')
    } catch (err) {
      setMeterError(extractApiError(err).message)
    } finally {
      setMeterLoading(false)
    }
  }

  async function addDefect() {
    if (!token) return
    setDefectError(null)
    setDefectLoading(true)
    try {
      const loc = defectLocation === 'Other' ? (defectCustomLocation || 'Other') : defectLocation
      const updated = await inspectionsApi.addDefect(token, {
        location: loc,
        description: defectDescription,
      }, defectPhotos)
      setReport(updated)
      setDefectDescription('')
      setDefectPhotos([])
      setDefectCustomLocation('')
    } catch (err) {
      setDefectError(extractApiError(err).message)
    } finally {
      setDefectLoading(false)
    }
  }

  async function submitInspection() {
    if (!token) return
    setSubmitError(null)
    setSubmitLoading(true)
    try {
      await inspectionsApi.submit(token)
      setStep('done')
    } catch (err) {
      setSubmitError(extractApiError(err).message)
    } finally {
      setSubmitLoading(false)
    }
  }

  function utilityKeys() {
    if (!report || report.meter_readings.length === 0) {
      return [
        { key: 'electricity', label: 'Electricity', unit: 'kWh' },
        { key: 'water', label: 'Water', unit: 'm³' },
      ]
    }
    return report.meter_readings.map((mr) => ({
      key: mr.utility_key,
      label: mr.utility_label,
      unit: mr.unit_label,
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (loadError || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-sm text-center">
          <p className="text-red-600 font-medium mb-2">Unable to load inspection</p>
          <p className="text-sm text-gray-500">{loadError || 'Invalid or expired link.'}</p>
        </div>
      </div>
    )
  }

  const inspectionLabel = report.type === 'pre_move_in' ? 'Pre-Move-In' : 'Move-Out'

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-3">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{inspectionLabel} Inspection</h1>
          <p className="text-sm text-gray-500 mt-1">Please complete all sections carefully.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {step !== 'done' && <StepIndicator current={step} />}

          {/* ── Welcome ── */}
          {step === 'welcome' && (
            <div className="space-y-5">
              {report.expires_at && <ExpiryBanner report={report} />}

              <div className="bg-blue-50 rounded-lg p-4">
                <h2 className="font-semibold text-blue-900 mb-1">How it works</h2>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Record meter readings with optional photos</li>
                  <li>Document any defects or damage you observe</li>
                  <li>Review your report and submit</li>
                </ol>
              </div>

              {report.status === 'submitted' ? (
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-green-800 font-medium">✓ You have already submitted this inspection.</p>
                  <p className="text-green-700 text-sm mt-1">Your property manager will review it shortly.</p>
                </div>
              ) : isExpired ? (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-gray-600 text-sm">The inspection window has closed. You can view your logged items below.</p>
                </div>
              ) : (
                <button
                  onClick={() => setStep('meters')}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                >
                  Start Inspection →
                </button>
              )}

              {/* Always show logged defects (even after submission or expiry) */}
              {(report.defects?.length ?? 0) > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Logged Defects ({report.defects.length})
                  </p>
                  <div className="space-y-2">
                    {report.defects.map((d) => (
                      <div key={d.id} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm font-medium text-gray-800">{d.location}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{d.description}</p>
                        {d.photo_urls.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {d.photo_urls.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img src={url} alt={`defect-${i}`} className="w-12 h-12 object-cover rounded" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Meters ── */}
          {step === 'meters' && (
            <div className="space-y-5">
              <h2 className="font-semibold text-gray-900">Meter Readings</h2>
              <p className="text-sm text-gray-500">Record the current reading for each utility.</p>

              {utilityKeys().map((u) => {
                const d = meterData[u.key] || { reading: '', file: null }
                return (
                  <div key={u.key} className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-800">{u.label}</p>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Reading ({u.unit})</label>
                      <input
                        type="number"
                        step="0.01"
                        value={d.reading}
                        onChange={(e) => setMeterData({ ...meterData, [u.key]: { ...d, reading: e.target.value } })}
                        placeholder="0.00"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <SinglePhotoInput
                      hasCamera={hasCamera}
                      file={d.file}
                      onChange={(f) => setMeterData({ ...meterData, [u.key]: { ...d, file: f } })}
                    />
                  </div>
                )
              })}

              {meterError && <p className="text-sm text-red-600">{meterError}</p>}

              <div className="flex justify-between">
                <button onClick={() => setStep('welcome')} className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={saveMeterReadings}
                  disabled={meterLoading}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {meterLoading ? 'Saving…' : 'Continue →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Defects ── */}
          {step === 'defects' && (
            <div className="space-y-5">
              <h2 className="font-semibold text-gray-900">Defects & Damage</h2>
              <p className="text-sm text-gray-500">
                Document any existing damage or issues. You can add multiple items.
              </p>

              {/* Already-saved defects */}
              {(report.defects?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  {report.defects.map((d) => (
                    <div key={d.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <p className="font-medium text-gray-800">{d.location}</p>
                      <p className="text-gray-600 text-xs mt-0.5">{d.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add defect form */}
              <div className="border border-dashed border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-medium text-gray-600">Add a defect</p>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Location</label>
                  <select
                    value={defectLocation}
                    onChange={(e) => setDefectLocation(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    {DEFECT_LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
                {defectLocation === 'Other' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Custom location</label>
                    <input
                      type="text"
                      value={defectCustomLocation}
                      onChange={(e) => setDefectCustomLocation(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={defectDescription}
                    onChange={(e) => setDefectDescription(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                    placeholder="Describe the issue…"
                  />
                </div>

                <MultiPhotoInput
                  hasCamera={hasCamera}
                  files={defectPhotos}
                  onChange={setDefectPhotos}
                  max={3}
                />

                {defectError && <p className="text-xs text-red-600">{defectError}</p>}
                <button
                  onClick={addDefect}
                  disabled={defectLoading || !defectDescription.trim() || isExpired}
                  className="w-full py-2 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {defectLoading ? 'Adding…' : isExpired ? 'Window expired' : '+ Add Another Defect'}
                </button>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep('meters')} className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={() => setStep('review')}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"
                >
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Review ── */}
          {step === 'review' && (
            <div className="space-y-5">
              <h2 className="font-semibold text-gray-900">Review & Submit</h2>

              <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Meter Readings</p>
                  {report.meter_readings.length === 0 ? (
                    <p className="text-xs text-gray-500">No readings recorded.</p>
                  ) : (
                    <div className="space-y-1">
                      {report.meter_readings.map((mr) => (
                        <div key={mr.utility_key} className="flex justify-between text-sm">
                          <span className="text-gray-700">{mr.utility_label}</span>
                          <span className="font-medium text-gray-900">{mr.reading} {mr.unit_label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Defects ({report.defects?.length ?? 0})
                  </p>
                  {(report.defects?.length ?? 0) === 0 ? (
                    <p className="text-xs text-gray-500">None recorded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {report.defects.map((d) => (
                        <li key={d.id} className="text-sm text-gray-700">
                          <span className="font-medium">{d.location}</span>: {d.description}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              <div className="flex justify-between">
                <button onClick={() => setStep('defects')} className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={submitInspection}
                  disabled={submitLoading}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {submitLoading ? 'Submitting…' : 'Submit Report ✓'}
                </button>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {step === 'done' && (
            <div className="space-y-6">
              <div className="text-center py-4 space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
                  <span className="text-3xl">✓</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900">Inspection Submitted!</h2>
                <p className="text-sm text-gray-500 max-w-xs mx-auto">
                  Your {inspectionLabel.toLowerCase()} inspection report has been submitted successfully.
                  Your property manager will review it shortly.
                </p>
              </div>

              {/* Show what was logged */}
              {(report.defects?.length ?? 0) > 0 && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Defects You Logged ({report.defects.length})
                  </p>
                  <div className="space-y-2">
                    {report.defects.map((d) => (
                      <div key={d.id} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm font-medium text-gray-800">{d.location}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{d.description}</p>
                        {d.photo_urls.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {d.photo_urls.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img src={url} alt={`defect-${i}`} className="w-12 h-12 object-cover rounded" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">
                    These defects are on record. They protect you from being charged for pre-existing issues.
                  </p>
                </div>
              )}

              {(report.defects?.length ?? 0) === 0 && (
                <div className="text-center text-sm text-gray-400">
                  No defects were logged.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
