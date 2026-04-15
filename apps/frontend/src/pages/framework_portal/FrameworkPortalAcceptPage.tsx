import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getInviteInfo, activateInvite, uploadInvitePhoto,
} from '@/api/frameworkPortal'
import type { InviteInfo } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'
import { TOKEN_KEY, USER_KEY } from '@/constants/storage'

type Step = 'loading' | 'info' | 'profile' | 'kyc' | 'done' | 'already_active'

const ACCENT = '#D97706'

export default function FrameworkPortalAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('loading')
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState('')

  // Profile step
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mobile, setMobile] = useState('')
  const [specialization, setSpecialization] = useState('')
  const [selectedSites, setSelectedSites] = useState<string[]>([])
  const [homeAddress, setHomeAddress] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // KYC step — after profile saved, portal token stored
  const [, setPortalJwt] = useState('')
  const [, setVendorId] = useState('')
  const [selfie, setSelfie] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState('')
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idFrontPreview, setIdFrontPreview] = useState('')
  const [idBack, setIdBack] = useState<File | null>(null)
  const [idBackPreview, setIdBackPreview] = useState('')
  const [uploadingKyc, setUploadingKyc] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)

  const selfieRef = useRef<HTMLInputElement>(null)
  const idFrontRef = useRef<HTMLInputElement>(null)
  const idBackRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    getInviteInfo(token)
      .then(info => {
        setInvite(info)
        setSpecialization(info.specialization || '')
        if (info.is_activated) {
          setStep('already_active')
        } else {
          setStep('info')
        }
      })
      .catch(() => setError('Invitation not found or has expired.'))
  }, [token])

  function captureGps() {
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsLoading(false)
      },
      () => setGpsLoading(false),
    )
  }

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (f: File) => void,
    preview: (s: string) => void,
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setter(file)
    preview(URL.createObjectURL(file))
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (!mobile.trim()) { setError('Mobile number is required'); return }
    setSaving(true)
    try {
      const result = await activateInvite(token!, {
        password,
        mobile,
        specialization: specialization || undefined,
        site_codes: selectedSites,
        home_address: homeAddress || undefined,
        gps_lat: gps?.lat,
        gps_lng: gps?.lng,
      })
      setPortalJwt(result.token)
      setVendorId(result.vendor_id)
      // Store JWT so portal pages work after upload
      localStorage.setItem(TOKEN_KEY, result.token)
      localStorage.setItem(USER_KEY, JSON.stringify({ role: 'service_provider' }))
      setStep('kyc')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleKycSubmit() {
    if (!selfie || !idFront || !idBack) {
      setError('Please upload your selfie, ID front, and ID back.')
      return
    }
    setError('')
    setUploadingKyc(true)
    try {
      await Promise.all([
        uploadInvitePhoto(token!, 'selfie', selfie),
        uploadInvitePhoto(token!, 'id_front', idFront),
        uploadInvitePhoto(token!, 'id_back', idBack),
      ])
      setStep('done')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setUploadingKyc(false)
    }
  }

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading invitation…</p>
        </div>
      </div>
    )
  }

  if (error && step !== 'info' && step !== 'profile' && step !== 'kyc') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">❌</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Invitation Invalid</h2>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  if (step === 'already_active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Already Activated</h2>
          <p className="text-sm text-gray-500 mb-6">
            Your account is already set up. Log in to access your service provider portal.
          </p>
          <button
            onClick={() => navigate('/framework-portal/login')}
            className="w-full py-3 text-white font-semibold rounded-xl"
            style={{ backgroundColor: ACCENT }}
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Profile Submitted!</h2>
          <p className="text-sm text-gray-500 mb-2">
            Your documents are under review. You'll be notified once approved and your contractor badge is ready.
          </p>
          <p className="text-xs text-amber-600 mb-6 font-medium">This usually takes 1–2 business days.</p>
          <button
            onClick={() => navigate('/framework-portal')}
            className="w-full py-3 text-white font-semibold rounded-xl"
            style={{ backgroundColor: ACCENT }}
          >
            Open My Portal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: ACCENT }}>
          SP
        </div>
        <div>
          <div className="text-sm font-bold text-gray-900">{invite?.org_name}</div>
          <div className="text-xs text-gray-500">Service Provider Portal</div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {(['info', 'profile', 'kyc'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? 'text-white' : (
                  ['info', 'profile', 'kyc'].indexOf(step) > i ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                )
              }`} style={step === s ? { backgroundColor: ACCENT } : {}}>
                {['info', 'profile', 'kyc'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${step === s ? 'text-amber-700' : 'text-gray-400'}`}>
                {s === 'info' ? 'Invitation' : s === 'profile' ? 'Your Details' : 'Verification'}
              </span>
              {i < 2 && <div className="h-px bg-gray-200 flex-1" />}
            </div>
          ))}
        </div>

        {/* ── STEP 1: info ── */}
        {step === 'info' && invite && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">🤝</div>
              <h1 className="text-lg font-bold text-gray-900">You're Invited!</h1>
              <p className="text-sm text-gray-500 mt-1">
                {invite.org_name} has invited <strong>{invite.name}</strong> to work on
              </p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 mb-6 border border-amber-100">
              <div className="text-xs text-amber-600 font-semibold mb-1">FRAMEWORK CONTRACT</div>
              <div className="font-bold text-gray-900">{invite.framework_name}</div>
              <div className="text-sm text-gray-500">Client: {invite.client_name}</div>
            </div>
            <div className="space-y-2 mb-6">
              <InfoRow label="Contact Person" value={invite.contact_name} />
              <InfoRow label="Email" value={invite.email} />
              {invite.specialization && <InfoRow label="Specialization" value={invite.specialization} />}
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>}
            <button
              onClick={() => setStep('profile')}
              className="w-full py-3 text-white font-semibold rounded-xl"
              style={{ backgroundColor: ACCENT }}
            >
              Accept Invitation →
            </button>
          </div>
        )}

        {/* ── STEP 2: profile ── */}
        {step === 'profile' && invite && (
          <form onSubmit={handleProfileSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 mb-1">Set Up Your Profile</h2>
            <p className="text-xs text-gray-500 mb-4">Create your login credentials for the service provider portal.</p>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">
              <span className="font-medium">Email:</span> {invite.email}
            </div>

            <Field label="Mobile Number *" type="tel" value={mobile} onChange={setMobile} placeholder="+254 7XX XXX XXX" />
            <Field label="Specialization" value={specialization} onChange={setSpecialization} placeholder="e.g. Generator Maintenance, Cummins Certified" />
            <Field label="Home Address / Base Location" value={homeAddress} onChange={setHomeAddress} placeholder="e.g. Westlands, Nairobi" />

            {/* Sites multi-select */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Sites You Can Cover
                {invite.available_sites.length > 0 && (
                  <button type="button" onClick={() => setSelectedSites(
                    selectedSites.length === invite!.available_sites.length
                      ? []
                      : invite!.available_sites.map(s => s.site_code)
                  )} className="ml-2 text-amber-600 font-normal">
                    {selectedSites.length === invite!.available_sites.length ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </label>
              {invite.available_sites.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No sites configured for this contract yet.</p>
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 max-h-48 overflow-y-auto">
                  {invite.available_sites.map(site => {
                    const checked = selectedSites.includes(site.site_code)
                    return (
                      <label key={site.site_code} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-amber-50 ${checked ? 'bg-amber-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedSites(prev =>
                            checked ? prev.filter(c => c !== site.site_code) : [...prev, site.site_code]
                          )}
                          className="w-4 h-4 accent-amber-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{site.site_name}</div>
                          <div className="text-[10px] text-gray-400">{site.site_code} · {site.region}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {selectedSites.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">{selectedSites.length} site{selectedSites.length !== 1 ? 's' : ''} selected</p>
              )}
            </div>

            <Field label="Create Password *" type="password" value={password} onChange={setPassword} placeholder="Min 8 characters" />
            <Field label="Confirm Password *" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter password" />

            {/* GPS capture */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Your Location</label>
              {gps ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                  📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                  <button type="button" onClick={() => setGps(null)} className="ml-auto text-xs text-gray-400">clear</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={captureGps}
                  disabled={gpsLoading}
                  className="w-full py-2 text-sm border border-dashed border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50"
                >
                  {gpsLoading ? 'Getting location…' : '📍 Share My Location'}
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? 'Creating account…' : 'Continue to Verification →'}
            </button>
          </form>
        )}

        {/* ── STEP 3: KYC ── */}
        {step === 'kyc' && (
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-gray-900">Identity Verification</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload your documents to receive your contractor badge.
              </p>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <PhotoUpload
              label="Selfie Photo"
              hint="Take a clear photo of your face"
              icon="🤳"
              preview={selfiePreview}
              inputRef={selfieRef}
              accept="image/*"
              capture="user"
              onChange={e => handleFileChange(e, setSelfie, setSelfiePreview)}
            />

            <PhotoUpload
              label="ID / Passport — Front"
              hint="National ID or passport front page"
              icon="🪪"
              preview={idFrontPreview}
              inputRef={idFrontRef}
              accept="image/*"
              capture="environment"
              onChange={e => handleFileChange(e, setIdFront, setIdFrontPreview)}
            />

            <PhotoUpload
              label="ID / Passport — Back"
              hint="National ID back page"
              icon="🪪"
              preview={idBackPreview}
              inputRef={idBackRef}
              accept="image/*"
              capture="environment"
              onChange={e => handleFileChange(e, setIdBack, setIdBackPreview)}
            />

            <button
              onClick={handleKycSubmit}
              disabled={uploadingKyc || !selfie || !idFront || !idBack}
              className="w-full py-3 text-white font-semibold rounded-xl disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {uploadingKyc ? 'Uploading…' : 'Submit for Review →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-400 w-28 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  )
}

function Field({
  label, type = 'text', value, onChange, placeholder,
}: {
  label: string; type?: string; value: string
  onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
    </div>
  )
}

function PhotoUpload({
  label, hint, icon, preview, inputRef, accept, capture, onChange,
}: {
  label: string; hint: string; icon: string; preview: string
  inputRef: React.RefObject<HTMLInputElement>
  accept: string; capture?: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <p className="text-xs text-gray-400 mb-2">{hint}</p>
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="w-full h-36 object-cover rounded-xl border border-gray-200" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-2 right-2 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 shadow"
          >
            Retake
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full h-28 border-2 border-dashed border-amber-200 rounded-xl flex flex-col items-center justify-center gap-1 text-amber-600 hover:bg-amber-50"
        >
          <span className="text-2xl">{icon}</span>
          <span className="text-xs font-medium">Tap to capture</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture as any}
        onChange={onChange}
        className="hidden"
      />
    </div>
  )
}
