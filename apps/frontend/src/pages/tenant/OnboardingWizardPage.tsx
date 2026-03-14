/**
 * Public onboarding wizard — /onboarding/:token (no auth required).
 * Steps: ID Front → ID Back → Selfie → Personal Details → Contract & Sign → Done
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { onboardingsApi, type OnboardingPublicResponse } from '@/api/onboardings'
import { extractApiError } from '@/utils/apiError'
import { calcProratedRent } from '@/utils/leaseCalculations'

type Step = 'id_front' | 'id_back' | 'selfie' | 'details' | 'pay' | 'contract' | 'done'
const STEPS: Step[] = ['id_front', 'id_back', 'selfie', 'details', 'pay', 'contract', 'done']
const STEP_LABELS: Record<Step, string> = {
  id_front: 'ID Front',
  id_back: 'ID Back',
  selfie: 'Selfie',
  details: 'Details',
  contract: 'Sign',
  pay: 'Payment',
  done: 'Done',
}

function fmt(n?: number) {
  return n != null ? `KES ${n.toLocaleString()}` : '—'
}

// ── Signature pad ─────────────────────────────────────────────────────────────

interface SignaturePadProps {
  onSign: (dataUrl: string) => void
  onClear: () => void
  isEmpty: boolean
}

function SignaturePad({ onSign, onClear, isEmpty }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = true
    lastPos.current = getPos(e)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    if (!pos || !lastPos.current) return
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
    onSign(canvas!.toDataURL('image/png'))
  }

  function stopDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = false
    lastPos.current = null
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onClear()
  }

  return (
    <div>
      <div className="relative border-2 border-gray-300 rounded-xl overflow-hidden bg-white touch-none"
           style={{ userSelect: 'none' }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full block cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-sm select-none">Draw your signature here</p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Clear signature
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OnboardingWizardPage() {
  const { token } = useParams<{ token: string }>()
  const [ob, setOb] = useState<OnboardingPublicResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('id_front')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Personal details form — pre-filled from onboarding record
  const [details, setDetails] = useState({
    id_type: '', id_number: '', first_name: '', last_name: '',
    date_of_birth: '', phone: '', emergency_contact_name: '', emergency_contact_phone: '',
  })
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  // Contract / signature
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [sigEmpty, setSigEmpty] = useState(true)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const signingRef = useRef(false)  // prevents double-submit on button click

  // Payment step
  const [payPhone, setPayPhone] = useState<string>('')
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [_paymentId, setPaymentId] = useState<string | null>(null)
  const [payStatus, setPayStatus] = useState<'idle' | 'pending' | 'completed' | 'failed'>('idle')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSandbox = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('sandbox') === '1'

  useEffect(() => {
    if (!token) return
    onboardingsApi
      .getByToken(token)
      .then((data) => {
        setOb(data)
        // Pre-fill all available personal details
        setDetails({
          id_type: data.id_type ?? '',
          id_number: data.id_number ?? '',
          first_name: data.first_name ?? '',
          last_name: data.last_name ?? '',
          date_of_birth: data.date_of_birth ?? '',
          phone: data.phone ?? '',
          emergency_contact_name: data.emergency_contact_name ?? '',
          emergency_contact_phone: data.emergency_contact_phone ?? '',
        })
        // Jump to the right step
        if (data.status === 'activated' || data.status === 'signed') {
          setStep('done')
        } else if (data.lease?.status === 'pending_signature') {
          // Paid but not yet signed
          setStep('contract')
        } else if (data.has_signature || data.status === 'kyc_submitted') {
          // Details submitted — advance to payment
          setStep('pay')
        } else if (data.has_id_front && data.has_id_back && data.has_selfie) {
          setStep('details')
        } else if (data.has_id_front && data.has_id_back) {
          setStep('selfie')
        } else if (data.has_id_front) {
          setStep('id_back')
        }
      })
      .catch((err) => setLoadError(extractApiError(err).message))
  }, [token])

  async function handleFileUpload(file: File, docType: 'id_front' | 'id_back' | 'selfie') {
    if (!token) return
    setUploading(true)
    setUploadError(null)
    try {
      let updated: OnboardingPublicResponse
      if (docType === 'id_front') updated = await onboardingsApi.uploadIdFront(token, file)
      else if (docType === 'id_back') updated = await onboardingsApi.uploadIdBack(token, file)
      else updated = await onboardingsApi.uploadSelfie(token, file)
      setOb(updated)
      const nextMap: Record<typeof docType, Step> = {
        id_front: 'id_back', id_back: 'selfie', selfie: 'details',
      }
      setStep(nextMap[docType])
    } catch (err) {
      setUploadError(extractApiError(err).message)
    } finally {
      setUploading(false)
    }
  }

  function pickFile(docType: 'id_front' | 'id_back' | 'selfie', useCamera: boolean) {
    const input = useCamera ? cameraRef.current : fileRef.current
    if (!input) return
    input.accept = docType === 'selfie' ? 'image/*' : 'image/*,.pdf'
    if (useCamera) input.capture = 'environment'
    else delete (input as unknown as Record<string, unknown>).capture
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) handleFileUpload(file, docType)
      input.value = ''
    }
    input.click()
  }

  async function handleSubmitDetails() {
    if (!token) return
    setSavingDetails(true)
    setDetailsError(null)
    try {
      const updated = await onboardingsApi.submitDetails(token, {
        id_type: details.id_type || undefined,
        id_number: details.id_number || undefined,
        first_name: details.first_name || undefined,
        last_name: details.last_name || undefined,
        date_of_birth: details.date_of_birth || undefined,
        phone: details.phone || undefined,
        emergency_contact_name: details.emergency_contact_name || undefined,
        emergency_contact_phone: details.emergency_contact_phone || undefined,
      })
      setOb(updated)
      setStep('pay')
    } catch (err) {
      setDetailsError(extractApiError(err).message)
    } finally {
      setSavingDetails(false)
    }
  }

  async function handleSign() {
    if (!token || !signatureData || signingRef.current) return
    signingRef.current = true
    setSigning(true)
    setSignError(null)
    try {
      const updated = await onboardingsApi.sign(token, signatureData)
      setOb(updated)
      setStep('done')
    } catch (err) {
      setSignError(extractApiError(err).message)
    } finally {
      signingRef.current = false
      setSigning(false)
    }
  }

  function startPayPolling(pid: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      if (!token) return
      try {
        const s = await onboardingsApi.getPayStatus(token, pid)
        if (s.status === 'completed') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setPayStatus('completed')
          setPayLoading(false)
          setTimeout(() => setStep('contract'), 2000)
        } else if (s.status === 'failed') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setPayStatus('failed')
          setPayError(s.message ?? 'Payment failed. Please try again.')
          setPayLoading(false)
        }
      } catch (_) { /* ignore transient network errors */ }
    }, 3000)
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function handlePayNow() {
    if (!token || !L) return
    const totalDue = L.deposit_amount + utilDepositTotal + proratedRent
    setPayLoading(true)
    setPayError(null)
    setPayStatus('pending')
    try {
      const resp = await onboardingsApi.initiatePayment(token, {
        phone: payPhone,
        amount: totalDue,
        sandbox: isSandbox,
      })
      setPaymentId(resp.payment_id)
      if (resp.status === 'completed') {
        setPayStatus('completed')
        setPayLoading(false)
        // Sandbox: payment confirmed immediately → proceed to sign
        setTimeout(() => setStep('contract'), 2000)
      } else {
        startPayPolling(resp.payment_id)
      }
    } catch (err) {
      setPayError(extractApiError(err).message)
      setPayStatus('idle')
      setPayLoading(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  // Normalise lease fields that may be absent on records created before the schema extension
  const L = ob?.lease ? {
    ...ob.lease,
    invoice_day:           ob.lease.invoice_day           ?? 1,
    due_days:              ob.lease.due_days              ?? 7,
    grace_days:            ob.lease.grace_days            ?? 3,
    late_fee_type:         ob.lease.late_fee_type         ?? 'flat',
    late_fee_value:        ob.lease.late_fee_value        ?? 0,
    notice_days:           ob.lease.notice_days           ?? 30,
    termination_fee_type:  ob.lease.termination_fee_type  ?? 'none',
    termination_fee_value: ob.lease.termination_fee_value ?? 0,
    deposit_refund_days:   ob.lease.deposit_refund_days   ?? 30,
    utilities:             ob.lease.utilities             ?? [],
  } : null
  const ord = (n: number) => n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
  const hasUtils = (L?.utilities.length ?? 0) > 0
  // Utility deposit: always sum from per-utility deposits (reflects unit overrides)
  const utilDepositTotal = L ? L.utilities.reduce((s, u) => s + (u.deposit ?? 0), 0) : 0
  // Prorated first-month rent — used in both contract display and payment step
  const { prorated: proratedRent, days: proratedDays, daysInMonth: proratedDaysInMonth } = calcProratedRent(L ?? { rent_amount: 0 })

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="font-semibold text-gray-800 mb-2">Link not found</h2>
          <p className="text-gray-500 text-sm">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!ob) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-700 text-white px-6 py-4">
        <h1 className="text-lg font-semibold">Tenant Onboarding</h1>
        {ob.invite_email && <p className="text-blue-200 text-sm mt-0.5">{ob.invite_email}</p>}
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-1 max-w-2xl">
          {STEPS.filter((s) => s !== 'done').map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                ${stepIndex > i ? 'bg-green-500 text-white' : stepIndex === i ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {stepIndex > i ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:block ${stepIndex === i ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                {STEP_LABELS[s]}
              </span>
              {i < STEPS.length - 2 && <div className="flex-1 h-px bg-gray-200 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={fileRef} type="file" className="hidden" />
      <input ref={cameraRef} type="file" className="hidden" />

      <div className="max-w-2xl mx-auto p-6">

        {/* ── ID Front ── */}
        {step === 'id_front' && (
          <UploadStep
            title="Upload ID — Front"
            description="Take a clear photo of the front of your National ID, Passport, or Driver's Licence."
            uploaded={ob.has_id_front}
            uploading={uploading}
            error={uploadError}
            onFile={() => pickFile('id_front', false)}
            onCamera={() => pickFile('id_front', true)}
            onSkip={ob.has_id_front ? () => setStep('id_back') : undefined}
          />
        )}

        {/* ── ID Back ── */}
        {step === 'id_back' && (
          <UploadStep
            title="Upload ID — Back"
            description="Now the back of the same ID document."
            uploaded={ob.has_id_back}
            uploading={uploading}
            error={uploadError}
            onFile={() => pickFile('id_back', false)}
            onCamera={() => pickFile('id_back', true)}
            onSkip={ob.has_id_back ? () => setStep('selfie') : undefined}
          />
        )}

        {/* ── Selfie ── */}
        {step === 'selfie' && (
          <UploadStep
            title="Take a Selfie"
            description="Take a clear selfie. Look straight at the camera in good lighting."
            uploaded={ob.has_selfie}
            uploading={uploading}
            error={uploadError}
            onFile={() => pickFile('selfie', false)}
            onCamera={() => pickFile('selfie', true)}
            cameraLabel="Take selfie"
            onSkip={ob.has_selfie ? () => setStep('details') : undefined}
          />
        )}

        {/* ── Personal Details ── */}
        {step === 'details' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Your Details</h2>
              <p className="text-sm text-gray-500 mt-0.5">Confirm or complete your personal information.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">First name *</label>
                <input className="input" value={details.first_name}
                  onChange={(e) => setDetails((p) => ({ ...p, first_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Last name *</label>
                <input className="input" value={details.last_name}
                  onChange={(e) => setDetails((p) => ({ ...p, last_name: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">ID Type *</label>
                <select className="input" value={details.id_type}
                  onChange={(e) => setDetails((p) => ({ ...p, id_type: e.target.value }))}>
                  <option value="">Select…</option>
                  <option value="national_id">National ID</option>
                  <option value="passport">Passport</option>
                  <option value="drivers_license">Driver's Licence</option>
                </select>
              </div>
              <div>
                <label className="label">ID Number *</label>
                <input className="input" value={details.id_number}
                  onChange={(e) => setDetails((p) => ({ ...p, id_number: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Date of birth</label>
                <input type="date" className="input" value={details.date_of_birth}
                  onChange={(e) => setDetails((p) => ({ ...p, date_of_birth: e.target.value }))} />
              </div>
              <div>
                <label className="label">Phone number</label>
                <input className="input" value={details.phone}
                  onChange={(e) => setDetails((p) => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 font-medium mb-3 uppercase tracking-wide">Emergency contact</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={details.emergency_contact_name}
                    onChange={(e) => setDetails((p) => ({ ...p, emergency_contact_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={details.emergency_contact_phone}
                    onChange={(e) => setDetails((p) => ({ ...p, emergency_contact_phone: e.target.value }))} />
                </div>
              </div>
            </div>

            {detailsError && <p className="text-red-600 text-sm">{detailsError}</p>}

            <button
              onClick={handleSubmitDetails}
              disabled={savingDetails || !details.first_name || !details.last_name || !details.id_type || !details.id_number}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {savingDetails ? 'Saving…' : 'Continue to Payment →'}
            </button>
          </div>
        )}

        {/* ── Contract & Signature ── */}
        {step === 'contract' && (
          <div className="space-y-4">
            {/* Lease contract card */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

              {/* ── Letterhead ── */}
              <div className="border-b-2 border-blue-900 bg-white px-6 pt-6 pb-4 text-center">
                {ob.org_logo_url && (
                  <img
                    src={ob.org_logo_url}
                    alt="company logo"
                    className="h-12 mx-auto mb-3 object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                {ob.org_name && (
                  <p className="text-base font-bold text-gray-900 tracking-wide uppercase">{ob.org_name}</p>
                )}
                {(ob.org_address || ob.org_phone || ob.org_email) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[ob.org_address, ob.org_phone && `Tel: ${ob.org_phone}`, ob.org_email && `Email: ${ob.org_email}`]
                      .filter(Boolean).join(' | ')}
                  </p>
                )}
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h2 className="text-lg font-bold text-gray-900 tracking-widest uppercase">Tenancy Agreement</h2>
                  {L?.reference_no && (
                    <p className="text-xs font-mono text-blue-700 bg-blue-50 inline-block px-3 py-0.5 rounded-full mt-1.5">
                      Reference: {L.reference_no}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Agreement date:{' '}
                    <strong>{L?.start_date ?? new Date().toISOString().split('T')[0]}</strong>
                  </p>
                </div>
              </div>

              {L ? (
                <div className="px-6 py-5 space-y-6 text-sm text-gray-700">

                  {/* 1. Parties */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">1. Parties to this Agreement</p>

                    {/* Tenant block */}
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-blue-900 uppercase tracking-wider mb-1">THE TENANT</p>
                      <div className="bg-gray-50 rounded-lg divide-y divide-gray-100 text-sm">
                        <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                          <span className="text-gray-500">Full Name</span>
                          <span className="font-semibold text-gray-900">
                            {[ob.first_name, ob.last_name].filter(Boolean).join(' ') || '—'}
                          </span>
                        </div>
                        {ob.id_type && (
                          <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                            <span className="text-gray-500">
                              {{national_id: 'National ID', passport: 'Passport', drivers_license: "Driver's Licence"}[ob.id_type] ?? ob.id_type}
                            </span>
                            <span className="font-mono text-gray-900">{ob.id_number || '—'}</span>
                          </div>
                        )}
                        {ob.phone && (
                          <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                            <span className="text-gray-500">Phone</span>
                            <span className="text-gray-900">{ob.phone}</span>
                          </div>
                        )}
                        {ob.invite_email && (
                          <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                            <span className="text-gray-500">Email</span>
                            <span className="text-gray-900">{ob.invite_email}</span>
                          </div>
                        )}
                        {ob.emergency_contact_name && (
                          <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                            <span className="text-gray-500">Emergency Contact</span>
                            <span className="text-gray-900">
                              {ob.emergency_contact_name}
                              {ob.emergency_contact_phone && <span className="text-gray-500 ml-1">({ob.emergency_contact_phone})</span>}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Landlord / property block */}
                    <div>
                      <p className="text-xs font-semibold text-blue-900 uppercase tracking-wider mb-1">THE LANDLORD / MANAGING AGENT</p>
                      <div className="bg-gray-50 rounded-lg divide-y divide-gray-100 text-sm">
                        <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                          <span className="text-gray-500">Managed by</span>
                          <span className="font-semibold text-gray-900">{ob.org_name ?? L.property_name ?? '—'}</span>
                        </div>
                        <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                          <span className="text-gray-500">Property</span>
                          <div>
                            <p className="text-gray-900 font-semibold">{L.property_name ?? '—'}</p>
                            {L.property_address && <p className="text-gray-400 text-xs mt-0.5">{L.property_address}</p>}
                          </div>
                        </div>
                        <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                          <span className="text-gray-500">Unit / House No.</span>
                          <span className="font-semibold text-gray-900">{L.unit_code ?? '—'}</span>
                        </div>
                        {L.reference_no && (
                          <div className="grid grid-cols-[160px_1fr] gap-2 px-4 py-2.5">
                            <span className="text-gray-500">Agreement Ref.</span>
                            <span className="font-mono text-gray-900">{L.reference_no}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* 2. Tenancy Period */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">2. Tenancy Period</p>
                    <p className="leading-relaxed">
                      The tenancy shall commence on <strong>{L.start_date ?? '—'}</strong> and{' '}
                      {L.end_date
                        ? <>shall terminate on <strong>{L.end_date}</strong>, unless sooner terminated or extended in accordance with the terms herein.</>
                        : <>shall continue on a month-to-month basis until terminated by either party in accordance with the notice provisions herein.</>
                      }
                    </p>
                  </section>

                  {/* 3. Financial Obligations */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">3. Financial Obligations</p>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Item</th>
                            <th className="px-4 py-2.5 text-left font-medium text-gray-500 text-xs">Description</th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Amount (KES)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          <tr>
                            <td className="px-4 py-3 font-medium text-gray-800">Monthly Rent</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              Recurring; payable in advance on the {L.invoice_day}{ord(L.invoice_day)} of each calendar month from month 2 onwards
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(L.rent_amount)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-medium text-gray-800">
                              Pro-rated First Month
                              {proratedDays > 0 && proratedDaysInMonth > 0 && (
                                <span className="ml-1 text-xs font-normal text-gray-400">({proratedDays}/{proratedDaysInMonth} days)</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              Rent for the partial first month from move-in date to end of month
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(proratedRent)}</td>
                          </tr>
                          <tr>
                            <td className="px-4 py-3 font-medium text-gray-800">Security Deposit</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              Refundable within {L.deposit_refund_days} days of vacating, subject to inspection
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(L.deposit_amount)}</td>
                          </tr>
                          {utilDepositTotal > 0 && (
                            <tr>
                              <td className="px-4 py-3 font-medium text-gray-800">Utility Deposit</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">
                                Refundable; covers final utility charges upon vacating.
                                Summed from per-utility deposits detailed in Section 4.
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(utilDepositTotal)}</td>
                            </tr>
                          )}
                          <tr className="bg-blue-50 font-bold">
                            <td className="px-4 py-3 text-blue-900">Total Due on Move-In</td>
                            <td className="px-4 py-3 text-blue-700 text-xs font-normal">Pro-rated first month + all deposits — payable before keys are released</td>
                            <td className="px-4 py-3 text-right text-blue-900 text-base">
                              {fmt(proratedRent + L.deposit_amount + utilDepositTotal)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* 4. Utility Charges */}
                  {hasUtils && (
                    <section>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">4. Utility Charges &amp; Deposits</p>
                      <p className="text-xs text-gray-500 mb-3">
                        The following utility charges apply to the premises. Shared and subscription utilities are billed
                        monthly alongside rent. Metered utilities are billed based on actual consumption readings.
                      </p>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-4 py-2 text-left font-semibold text-gray-600">Utility</th>
                              <th className="px-4 py-2 text-left font-semibold text-gray-600">Billing Method</th>
                              <th className="px-4 py-2 text-right font-semibold text-gray-600">Rate</th>
                              <th className="px-4 py-2 text-right font-semibold text-gray-600">Deposit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {L.utilities.map((u) => (
                              <tr key={u.key}>
                                <td className="px-4 py-2.5 font-medium text-gray-800">{u.label}</td>
                                <td className="px-4 py-2.5 text-gray-500 capitalize text-xs">{u.type}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700 text-xs">
                                  {u.rate != null
                                    ? `KES ${u.rate.toLocaleString()}${u.unit_label ? ' / ' + u.unit_label : '/mo'}`
                                    : <span className="text-gray-400">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right text-gray-700 text-xs">
                                  {u.deposit != null && u.deposit > 0 ? fmt(u.deposit) : <span className="text-gray-400">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* 5. Payment Terms & Late Penalty */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '5' : '4'}. Payment Terms &amp; Late Payment Penalty</p>
                    <p className="leading-relaxed mb-2">
                      Monthly rent of <strong>{fmt(L.rent_amount)}</strong> is due on the{' '}
                      <strong>{L.invoice_day}{ord(L.invoice_day)}</strong>{' '}
                      day of each calendar month and shall be considered overdue if not received within{' '}
                      <strong>{L.due_days} days</strong> of the invoice date.
                    </p>
                    <p className="leading-relaxed">
                      A grace period of <strong>{L.grace_days} day{L.grace_days !== 1 ? 's' : ''}</strong> is
                      granted beyond the due date, after which a late payment penalty of{' '}
                      <strong>
                        {L.late_fee_type === 'percentage'
                          ? `${L.late_fee_value}% of the outstanding rent`
                          : `KES ${L.late_fee_value.toLocaleString()} (flat fee)`}
                      </strong>{' '}
                      shall be levied on the outstanding balance. Persistent failure to pay rent on time constitutes a
                      material breach of this Agreement and may result in termination of the tenancy without further notice.
                    </p>
                  </section>

                  {/* 6. Security Deposit & Refund */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '6' : '5'}. Security Deposit &amp; Refund Policy</p>
                    <p className="leading-relaxed">
                      The security deposit of <strong>{fmt(L.deposit_amount)}</strong> shall be held by the Landlord
                      for the full duration of the tenancy as security against unpaid rent, damage beyond fair wear and
                      tear, or any other breach of this Agreement. Upon lawful termination, the deposit shall be refunded
                      to the Tenant within <strong>{L.deposit_refund_days} days</strong> following inspection and
                      final settlement of all outstanding charges. Deductions shall be itemised in writing and provided
                      to the Tenant at the time of refund.
                    </p>
                  </section>

                  {/* 7. Tenant Obligations */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '7' : '6'}. Tenant Obligations</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-gray-700 leading-relaxed">
                      <li>To pay rent and all applicable charges on or before the due date each month.</li>
                      <li>To maintain the premises in a clean, sanitary, and habitable condition and to cause no damage thereto beyond fair wear and tear.</li>
                      <li>Not to sublet, assign, or otherwise transfer any interest in the premises without the prior written consent of the Landlord.</li>
                      <li>Not to use or permit the premises to be used for any unlawful purpose or in a manner that constitutes a nuisance or annoyance to neighbouring occupants.</li>
                      <li>To comply with all applicable laws, regulations, and property rules as communicated by the Landlord from time to time.</li>
                      <li>To promptly notify the Landlord of any defect, damage, or required repair in or about the premises.</li>
                      <li>To permit the Landlord or their authorised agents reasonable access to the premises upon reasonable prior notice for inspection, repairs, or valuations.</li>
                      <li>To return the premises in substantially the same condition as received, save for fair wear and tear, upon expiration or termination of this Agreement.</li>
                    </ol>
                  </section>

                  {/* 8. Termination & Notice */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '8' : '7'}. Termination &amp; Notice to Vacate</p>
                    <p className="leading-relaxed mb-2">
                      Either party may terminate this Agreement by serving written notice of not less than{' '}
                      <strong>{L.notice_days} days</strong> on the other party. Notice must be delivered in writing
                      via hand delivery, registered post, or electronic mail to the last known address or email address
                      of the receiving party.
                    </p>
                    {L.termination_fee_type !== 'none' && (
                      <p className="leading-relaxed">
                        In the event of early termination by the Tenant prior to the agreed lease end date, a termination
                        fee of{' '}
                        <strong>
                          {L.termination_fee_type === 'flat'
                            ? `KES ${(L.termination_fee_value ?? 0).toLocaleString()}`
                            : `${L.termination_fee_value ?? 1} month${(L.termination_fee_value ?? 1) !== 1 ? 's' : ''} rent (KES ${((L.termination_fee_value ?? 1) * L.rent_amount).toLocaleString()})`}
                        </strong>{' '}
                        shall be payable to the Landlord in addition to any other outstanding amounts.
                      </p>
                    )}
                    <p className="leading-relaxed mt-2">
                      The Tenant shall vacate the premises and return all keys and access devices to the Landlord on or
                      before the termination date. Failure to vacate shall entitle the Landlord to pursue all available
                      legal remedies, including holdover occupation charges at a daily rate equivalent to the monthly rent.
                    </p>
                  </section>

                  {/* 9. Governing Law */}
                  <section>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '9' : '8'}. Governing Law &amp; Dispute Resolution</p>
                    <p className="leading-relaxed">
                      This Agreement shall be governed by and construed in accordance with the laws of the Republic of Kenya,
                      including the Landlord and Tenant (Shops, Hotels and Catering Establishments) Act (Cap. 301) and any
                      other applicable legislation in force. Any dispute arising out of or in connection with this Agreement
                      shall first be referred to good-faith negotiation between the parties. Failing resolution within
                      thirty (30) days, the dispute shall be submitted to the courts of competent jurisdiction in Kenya.
                    </p>
                  </section>

                  {L.notes && (
                    <section>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{hasUtils ? '10' : '9'}. Special Conditions</p>
                      <p className="leading-relaxed bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-3 text-gray-700">{L.notes}</p>
                    </section>
                  )}

                  {/* Execution block */}
                  <section className="border-t border-gray-200 pt-5">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Execution &amp; Electronic Consent</p>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      By affixing their electronic signature below, the Tenant confirms that they have read,
                      understood, and freely agree to be bound by all the terms and conditions set out in this
                      Residential Tenancy Agreement. Pursuant to the Kenya Information and Communications Act and
                      applicable e-commerce legislation, this electronic signature shall have the same legal force
                      and effect as a handwritten signature and shall be binding on both parties.
                    </p>
                  </section>
                </div>
              ) : (
                <div className="text-sm text-gray-500 bg-gray-50 px-4 py-6 text-center">
                  No lease details linked to this onboarding.<br />
                  <span className="text-xs text-gray-400">Please contact your property manager.</span>
                </div>
              )}
            </div>

            {/* Signature card */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900">Your Signature</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Draw your signature in the box below, then click <strong>Sign &amp; Continue</strong>.
                </p>
              </div>

              <SignaturePad
                onSign={(data) => { setSignatureData(data); setSigEmpty(false) }}
                onClear={() => { setSignatureData(null); setSigEmpty(true) }}
                isEmpty={sigEmpty}
              />

              {signError && (
                <p className="text-red-600 text-sm">{signError}</p>
              )}

              <p className="text-xs text-gray-400 text-center">
                By clicking Sign &amp; Continue you are electronically signing this agreement.
              </p>

              <button
                onClick={handleSign}
                disabled={sigEmpty || signing}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {signing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Signing your lease…
                  </>
                ) : (
                  'Sign & Continue →'
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Pay ── */}
        {step === 'pay' && (() => {
          const totalDue = L ? L.deposit_amount + utilDepositTotal + proratedRent : 0
          const pc = L?.payment_config

          return (
            <div className="space-y-4">
              {/* Success state */}
              {payStatus === 'completed' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-3">
                  <div className="text-4xl">✅</div>
                  <h3 className="font-semibold text-green-900">Payment received!</h3>
                  <p className="text-green-700 text-sm">Payment confirmed. Proceeding to sign your lease agreement…</p>
                </div>
              )}

              {/* Amount breakdown */}
              {L && payStatus !== 'completed' && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">Move-In Payment</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Complete payment to proceed to signing your lease.</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    <div className="flex justify-between px-5 py-3 text-sm">
                      <span className="text-gray-600">Security Deposit</span>
                      <span className="font-medium text-gray-900">{fmt(L.deposit_amount)}</span>
                    </div>
                    {utilDepositTotal > 0 && (
                      <div className="flex justify-between px-5 py-3 text-sm">
                        <span className="text-gray-600">Utility Deposit</span>
                        <span className="font-medium text-gray-900">{fmt(utilDepositTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between px-5 py-3 text-sm">
                      <span className="text-gray-600">
                        Pro-rated Rent
                        {proratedDays > 0 && proratedDaysInMonth > 0 && (
                          <span className="text-gray-400 ml-1 text-xs">({proratedDays}/{proratedDaysInMonth} days)</span>
                        )}
                      </span>
                      <span className="font-medium text-gray-900">{fmt(proratedRent)}</span>
                    </div>
                    <div className="flex justify-between px-5 py-3 bg-blue-50">
                      <span className="font-semibold text-blue-900 text-sm">Total Due</span>
                      <span className="font-bold text-blue-900">{fmt(totalDue)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Online payment (STK push) */}
              {pc?.online_payment_enabled && payStatus !== 'completed' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">Pay via Mpesa</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Enter your phone number and we'll send you a payment prompt.</p>
                  </div>

                  {payStatus === 'pending' && (
                    <div className="flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3 text-blue-700 text-sm">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 flex-shrink-0" />
                      <span>Waiting for payment… check your phone for the Mpesa prompt.</span>
                    </div>
                  )}

                  {payStatus === 'failed' && payError && (
                    <p className="text-red-600 text-sm">{payError}</p>
                  )}

                  {payStatus !== 'pending' && (
                    <>
                      <input
                        type="tel"
                        placeholder="e.g. 0712 345 678"
                        value={payPhone}
                        onChange={e => setPayPhone(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={handlePayNow}
                        disabled={payLoading || !payPhone.trim()}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                      >
                        {payLoading ? 'Processing…' : `Pay ${fmt(totalDue)} via Mpesa`}
                      </button>
                      {isSandbox && (
                        <button
                          onClick={handlePayNow}
                          className="w-full py-2 border border-gray-300 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition-colors"
                        >
                          🧪 Simulate Payment (Sandbox)
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Manual payment instructions */}
              {pc && payStatus !== 'completed' && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                  <h3 className="font-semibold text-gray-900 text-sm">Manual Payment Instructions</h3>
                  {pc.paybill_number && (
                    <div className="text-sm space-y-1">
                      <p className="text-gray-500">Mpesa Paybill</p>
                      <p className="font-bold text-gray-900 text-lg">{pc.paybill_number}</p>
                      {pc.account_reference && (
                        <p className="text-gray-600">Account number: <span className="font-semibold">{pc.account_reference}</span></p>
                      )}
                    </div>
                  )}
                  {!pc.paybill_number && pc.till_number && (
                    <div className="text-sm space-y-1">
                      <p className="text-gray-500">Mpesa Till Number</p>
                      <p className="font-bold text-gray-900 text-lg">{pc.till_number}</p>
                    </div>
                  )}
                  {pc.bank_name && (
                    <div className="text-sm space-y-1">
                      <p className="text-gray-500">Bank Transfer</p>
                      <p className="text-gray-700">{pc.bank_name}{pc.bank_branch ? ` — ${pc.bank_branch}` : ''}</p>
                      {pc.bank_account && <p className="font-semibold text-gray-900">Account: {pc.bank_account}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Fallback when no payment config at all */}
              {!pc && (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 text-sm text-gray-500">
                  Contact your property manager for payment details.
                </div>
              )}

              {payStatus !== 'completed' && (
                <button
                  onClick={() => setStep('contract')}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-2"
                >
                  I'll pay manually — proceed to sign →
                </button>
              )}
            </div>
          )
        })()}

        {/* ── Done ── */}
        {step === 'done' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
              <div className="text-5xl">🎉</div>
              <h2 className="font-semibold text-gray-900 text-xl">
                You're all set{ob.first_name ? `, ${ob.first_name}` : ''}!
              </h2>
              <p className="text-gray-600 text-sm max-w-md mx-auto">
                Your payment is confirmed and your lease has been signed. Your unit will be activated
                shortly and you'll receive a welcome email with your pre-move-in inspection link.
              </p>
            </div>
            <p className="text-center text-gray-400 text-xs">You can safely close this page.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Upload step component ─────────────────────────────────────────────────────

interface UploadStepProps {
  title: string
  description: string
  uploaded: boolean
  uploading: boolean
  error: string | null
  onFile: () => void
  onCamera: () => void
  cameraLabel?: string
  onSkip?: () => void
}

function UploadStep({ title, description, uploaded, uploading, error, onFile, onCamera, cameraLabel, onSkip }: UploadStepProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900 text-lg">{title}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>

      {uploaded && (
        <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-3 py-2 text-sm">
          <span>✓</span><span>Uploaded successfully</span>
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={onCamera}
          disabled={uploading}
          className="flex-1 py-3 border-2 border-blue-200 rounded-xl text-blue-700 font-medium text-sm hover:bg-blue-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <span>📷</span>{cameraLabel ?? 'Take photo'}
        </button>
        <button
          onClick={onFile}
          disabled={uploading}
          className="flex-1 py-3 border-2 border-gray-200 rounded-xl text-gray-700 font-medium text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <span>📁</span>Upload file
        </button>
      </div>

      {uploading && <p className="text-sm text-gray-400 text-center">Uploading…</p>}

      {onSkip && (
        <button onClick={onSkip} className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Continue →
        </button>
      )}
    </div>
  )
}
