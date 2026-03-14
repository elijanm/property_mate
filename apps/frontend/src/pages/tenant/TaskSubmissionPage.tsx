import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { generalTicketsApi } from '@/api/tickets'
import { extractApiError } from '@/utils/apiError'
import type { Ticket, TicketTask } from '@/types/ticket'

type Step = 'loading' | 'welcome' | 'method' | 'capture' | 'done' | 'error'
type CaptureMethod = 'auto' | 'manual'

function progress(tasks: TicketTask[]) {
  const done = tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').length
  return { done, total: tasks.length }
}

export default function TaskSubmissionPage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const capturedBy = searchParams.get('user_id') ?? undefined

  const [step, setStep] = useState<Step>('loading')
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Wizard state
  const [taskIndex, setTaskIndex] = useState(0)
  const [method, setMethod] = useState<CaptureMethod>('manual')
  const [reading, setReading] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoKey, setPhotoKey] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [aiReading, setAiReading] = useState<number | null>(null)
  const [aiConfidence, setAiConfidence] = useState<number>(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const autoFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid link — no token provided.')
      setStep('error')
      return
    }
    generalTicketsApi
      .getByToken(token)
      .then((t) => {
        setTicket(t)
        if (t.status === 'resolved' || t.status === 'closed') {
          setStep('done')
        } else {
          setStep('welcome')
        }
      })
      .catch((err) => {
        setLoadError(extractApiError(err).message)
        setStep('error')
      })
  }, [token])

  const meterTasks = ticket?.tasks.filter((t) => t.task_type === 'meter_reading') ?? []
  const currentTask = meterTasks[taskIndex] as TicketTask | undefined

  function resetTaskForm() {
    setReading('')
    setNotes('')
    setPhoto(null)
    setPhotoPreview(null)
    setPhotoKey(null)
    setAiReading(null)
    setAiConfidence(0)
    setTaskError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (autoFileInputRef.current) autoFileInputRef.current.value = ''
  }

  async function handleStartCapture() {
    if (!token) return
    try {
      const updated = await generalTicketsApi.startCapture(token)
      setTicket(updated)
      setStep('method')
    } catch (err) {
      setLoadError(extractApiError(err).message)
    }
  }

  function handleSelectMethod(m: CaptureMethod) {
    setMethod(m)
    setStep('capture')
  }

  async function handlePhotoSelected(file: File, isAuto: boolean) {
    setPhoto(file)
    const url = URL.createObjectURL(file)
    setPhotoPreview(url)
    setPhotoKey(null)

    if (isAuto && token && currentTask) {
      setAiLoading(true)
      setTaskError(null)
      try {
        const result = await generalTicketsApi.readMeterAI(token, currentTask.id, file)
        if (result.reading !== null && result.reading !== undefined) {
          setAiReading(result.reading)
          setAiConfidence(result.confidence)
          setReading(String(result.reading))
        } else {
          setTaskError(result.error ?? 'Could not read meter. Please enter manually.')
        }
      } catch {
        setTaskError('AI read failed. Please enter reading manually.')
      } finally {
        setAiLoading(false)
      }
    }
  }

  async function handleSubmitTask() {
    if (!token || !currentTask) return
    const value = parseFloat(reading)
    if (isNaN(value) || value < 0) {
      setTaskError('Please enter a valid meter reading.')
      return
    }

    // Validate not lower than previous
    if (currentTask.previous_reading !== undefined && currentTask.previous_reading !== null) {
      if (value < currentTask.previous_reading) {
        setTaskError(
          `Reading (${value}) cannot be lower than previous reading (${currentTask.previous_reading}).`
        )
        return
      }
    }

    setSubmitting(true)
    setTaskError(null)

    let uploadedKey = photoKey
    // Upload photo if we have one and haven't uploaded yet
    if (photo && !uploadedKey) {
      setUploadingPhoto(true)
      try {
        const result = await generalTicketsApi.uploadTaskPhoto(token, currentTask.id, photo)
        uploadedKey = result.photo_key
        setPhotoKey(uploadedKey)
      } catch {
        // Photo upload failure is non-blocking
      } finally {
        setUploadingPhoto(false)
      }
    }

    try {
      const updated = await generalTicketsApi.submitTaskReading(token, currentTask.id, {
        current_reading: value,
        notes: notes || undefined,
        captured_by: capturedBy,
        photo_key: uploadedKey ?? undefined,
        meter_number: currentTask.meter_number ?? undefined,
      })
      setTicket(updated)

      const nextIndex = taskIndex + 1
      if (nextIndex < meterTasks.length) {
        setTaskIndex(nextIndex)
        resetTaskForm()
      } else {
        await handleComplete(updated)
      }
    } catch (err) {
      setTaskError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleComplete = useCallback(
    async (_latestTicket?: Ticket) => {
      if (!token) return
      setCompleting(true)
      try {
        await generalTicketsApi.completeSession(token)
        setStep('done')
      } catch (err) {
        setTaskError(extractApiError(err).message)
      } finally {
        setCompleting(false)
      }
    },
    [token],
  )

  function jumpToTask(idx: number) {
    setTaskIndex(idx)
    resetTaskForm()
  }

  const { done, total } = progress(meterTasks)
  const allDone = done === total && total > 0
  const isLastTask = taskIndex === meterTasks.length - 1

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start py-8 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-5">
          <p className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-0.5">PMS Portal</p>
          <h1 className="text-white text-xl font-bold">
            {step === 'done' ? 'Session Complete' : 'Meter Reading Capture'}
          </h1>
          {ticket && step === 'capture' && (
            <p className="text-blue-200 text-xs mt-1">{ticket.title}</p>
          )}
        </div>

        <div className="p-6">
          {step === 'loading' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-base font-semibold text-gray-900 mb-2">Link Unavailable</h2>
              <p className="text-sm text-gray-500">{loadError ?? 'This link is no longer valid.'}</p>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">All readings captured!</h2>
                <p className="text-sm text-gray-500 mt-1">
                  The meter readings have been saved and invoices will be updated automatically.
                </p>
              </div>
              {meterTasks.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2">
                  {meterTasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="text-gray-700 font-medium">{t.unit_code ?? t.unit_id ?? '—'}</span>
                        {t.meter_number && (
                          <span className="text-gray-400 text-xs ml-2">({t.meter_number})</span>
                        )}
                      </div>
                      <span className="font-mono font-medium text-gray-900">
                        {t.current_reading ?? '—'} {t.unit_of_measure ?? 'units'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'welcome' && ticket && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-0.5">
                  Utility Reading
                </p>
                <h2 className="text-lg font-semibold text-gray-900">{ticket.title}</h2>
                {ticket.description && (
                  <p className="text-sm text-gray-600 mt-1">{ticket.description}</p>
                )}
              </div>

              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
                <p className="font-medium mb-1">Instructions</p>
                <p>
                  Capture meter readings for <strong>{meterTasks.length}</strong> unit
                  {meterTasks.length !== 1 ? 's' : ''}. Use Auto Capture for AI-assisted
                  reading or Manual to enter values directly.
                </p>
              </div>

              {meterTasks.length > 0 && (
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Units</p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {meterTasks.map((t, i) => (
                      <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {t.unit_code ?? t.unit_id ?? 'Unit'}
                          </p>
                          {t.meter_number && (
                            <p className="text-xs text-gray-400">{t.meter_number}</p>
                          )}
                          {t.tenant_name && (
                            <p className="text-xs text-gray-400">{t.tenant_name}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 font-mono">
                          Prev: {t.previous_reading != null ? t.previous_reading : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={handleStartCapture}
                className="w-full py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
              >
                Start Capture →
              </button>
            </div>
          )}

          {/* Method selection */}
          {step === 'method' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Choose Capture Method</h2>
                <p className="text-sm text-gray-500 mt-1">How would you like to record meter readings?</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleSelectMethod('auto')}
                  className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
                >
                  <span className="text-4xl">📷</span>
                  <div className="text-center">
                    <p className="font-semibold text-gray-900 text-sm">Auto Capture</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Take a photo, AI reads the meter
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => handleSelectMethod('manual')}
                  className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
                >
                  <span className="text-4xl">✏️</span>
                  <div className="text-center">
                    <p className="font-semibold text-gray-900 text-sm">Manual Entry</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Type reading, optional photo
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Capture wizard */}
          {step === 'capture' && ticket && currentTask && (
            <div className="space-y-5">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Unit {taskIndex + 1} of {meterTasks.length}</span>
                  <span>{done} captured</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-blue-500 rounded-full transition-all"
                    style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Unit header */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                      {currentTask.utility_key ?? 'Meter'}
                    </p>
                    <h2 className="text-base font-bold text-gray-900 mt-0.5">
                      {currentTask.unit_code ?? currentTask.unit_id ?? 'Unit'}
                    </h2>
                    {currentTask.meter_number && (
                      <p className="text-xs text-gray-500 font-mono">{currentTask.meter_number}</p>
                    )}
                    {currentTask.tenant_name && (
                      <p className="text-sm text-gray-500">{currentTask.tenant_name}</p>
                    )}
                  </div>
                  {currentTask.previous_reading != null && (
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Previous reading</p>
                      <p className="text-lg font-mono font-bold text-gray-700">
                        {currentTask.previous_reading}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Mode switcher */}
              <div className="flex gap-2">
                {(['auto', 'manual'] as CaptureMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMethod(m); resetTaskForm() }}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      method === m
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    {m === 'auto' ? '📷 Auto Capture' : '✏️ Manual Entry'}
                  </button>
                ))}
              </div>

              {/* Auto capture */}
              {method === 'auto' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">
                      Take a photo of the meter display
                    </p>
                    <label className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-blue-300 transition-colors">
                      <span className="text-3xl">📷</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700">
                          {photo ? photo.name : 'Open camera to capture meter'}
                        </p>
                        <p className="text-xs text-gray-400">AI will extract the reading</p>
                      </div>
                      <input
                        ref={autoFileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) handlePhotoSelected(f, true)
                        }}
                      />
                    </label>
                  </div>

                  {photoPreview && (
                    <div className="rounded-xl overflow-hidden border border-gray-200">
                      <img src={photoPreview} alt="Meter" className="w-full h-48 object-cover" />
                    </div>
                  )}

                  {aiLoading && (
                    <div className="flex items-center gap-2 text-sm text-blue-600">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Reading meter with AI…
                    </div>
                  )}

                  {aiReading !== null && !aiLoading && (
                    <div className="bg-green-50 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-green-600 font-medium">AI detected reading</p>
                        <p className="text-sm text-green-800">
                          Confidence: {Math.round(aiConfidence * 100)}%
                        </p>
                      </div>
                      <span className="font-mono text-xl font-bold text-green-700">{aiReading}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Manual capture */}
              {method === 'manual' && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Meter Photo (optional)</p>
                  <label className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-blue-300 transition-colors">
                    <span className="text-2xl">📷</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">
                        {photo ? photo.name : 'Capture photo as evidence'}
                      </p>
                      <p className="text-xs text-gray-400">Optional</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handlePhotoSelected(f, false)
                      }}
                    />
                  </label>
                  {photoPreview && (
                    <div className="mt-2 rounded-xl overflow-hidden border border-gray-200">
                      <img src={photoPreview} alt="Meter" className="w-full h-32 object-cover" />
                    </div>
                  )}
                </div>
              )}

              {/* Reading input */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Current Reading <span className="text-red-500">*</span>
                  {currentTask.previous_reading != null && (
                    <span className="text-gray-400 font-normal ml-1">
                      (must be ≥ {currentTask.previous_reading})
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={currentTask.previous_reading ?? 0}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. 1234.56"
                  value={reading}
                  onChange={(e) => setReading(e.target.value)}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                  rows={2}
                  placeholder="Any remarks about this reading…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {taskError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{taskError}</p>
              )}

              {/* Navigation */}
              <div className="flex gap-3">
                {taskIndex > 0 && (
                  <button
                    onClick={() => jumpToTask(taskIndex - 1)}
                    disabled={submitting}
                    className="px-4 py-2.5 text-sm text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    ← Prev
                  </button>
                )}
                <button
                  onClick={handleSubmitTask}
                  disabled={submitting || uploadingPhoto || !reading}
                  className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-60 transition-colors"
                >
                  {uploadingPhoto
                    ? 'Uploading photo…'
                    : submitting
                      ? 'Saving…'
                      : isLastTask
                        ? 'Save & End Session'
                        : 'Save & Next Unit →'}
                </button>
              </div>

              {/* Unit jump list */}
              {meterTasks.length > 1 && (
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-2">Jump to unit</p>
                  <div className="flex flex-wrap gap-2">
                    {meterTasks.map((t, i) => {
                      const isDone = t.status === 'completed' || t.status === 'skipped'
                      return (
                        <button
                          key={t.id}
                          onClick={() => jumpToTask(i)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            i === taskIndex
                              ? 'bg-blue-600 text-white border-blue-600'
                              : isDone
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                          }`}
                        >
                          {t.unit_code ?? `Unit ${i + 1}`}
                          {isDone && ' ✓'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {allDone && !isLastTask && (
                <button
                  onClick={() => handleComplete()}
                  disabled={completing}
                  className="w-full py-2.5 text-sm font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-xl border border-green-200 transition-colors"
                >
                  {completing ? 'Closing…' : 'All units done — End Session ✓'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
