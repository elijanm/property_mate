import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getMyProfile, updateMyProfile, uploadMyPhoto, regenerateBadge } from '@/api/frameworkPortal'
import type { VendorProfile } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'
import { TOKEN_KEY, USER_KEY } from '@/constants/storage'

const ACCENT = '#D97706'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  invited: { label: 'Invited', color: 'bg-gray-100 text-gray-600' },
  pending_review: { label: 'Under Review', color: 'bg-yellow-100 text-yellow-700' },
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-700' },
}

export default function FrameworkPortalProfilePage() {
  const { setVendor } = useOutletContext<{ vendor: VendorProfile | null; setVendor: (v: VendorProfile) => void }>()
  const [profile, setProfile] = useState<VendorProfile | null>(null)
  const [editing, setEditing] = useState(false)
  const [mobile, setMobile] = useState('')
  const [specialization, setSpecialization] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [selectedSites, setSelectedSites] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const selfieRef = useRef<HTMLInputElement>(null)
  const idFrontRef = useRef<HTMLInputElement>(null)
  const idBackRef = useRef<HTMLInputElement>(null)
  const cvRef = useRef<HTMLInputElement>(null)
  const certRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    getMyProfile().then(p => {
      setProfile(p)
      setMobile(p.mobile || '')
      setSpecialization(p.specialization || '')
      setHomeAddress(p.home_address || '')
      setSelectedSites(p.site_codes)
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const updated = await updateMyProfile({
        mobile: mobile || undefined,
        specialization: specialization || undefined,
        site_codes: selectedSites,
        home_address: homeAddress || undefined,
      })
      setProfile(updated)
      setVendor(updated)
      setEditing(false)
      setSuccess('Profile updated successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoUpload(type: 'selfie' | 'id_front' | 'id_back' | 'cv' | 'certificate', file: File) {
    setUploading(type)
    setError('')
    try {
      await uploadMyPhoto(type, file)
      const updated = await getMyProfile()
      setProfile(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setUploading(null)
    }
  }

  async function captureGps() {
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          const updated = await updateMyProfile({
            gps_lat: pos.coords.latitude,
            gps_lng: pos.coords.longitude,
          })
          setProfile(updated)
          setVendor(updated)
        } catch {}
        setGpsLoading(false)
      },
      () => setGpsLoading(false),
    )
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.location.href = '/framework-portal/login'
  }

  if (!profile) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const statusMeta = STATUS_LABELS[profile.status] || { label: profile.status, color: 'bg-gray-100 text-gray-600' }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center text-3xl shrink-0">
          {profile.has_selfie && profile.selfie_url ? (
            <img src={profile.selfie_url} alt="Selfie" className="w-full h-full object-cover rounded-2xl" />
          ) : '👷'}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{profile.contact_name}</h1>
          <p className="text-sm text-gray-500 truncate">{profile.name}</p>
          <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full mt-1 ${statusMeta.color}`}>
            {statusMeta.label}
          </span>
        </div>
      </div>

      {success && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">{success}</p>}
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      {/* Contractor Badge */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🪪</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-amber-800">Contractor Badge</div>
            <div className="text-xs text-amber-600">
              {profile.has_badge ? 'CR80 card size — ready to print' : 'Complete KYC to generate'}
            </div>
          </div>
          {profile.has_badge && profile.badge_url && (
            <a
              href={profile.badge_url}
              target="_blank" rel="noreferrer"
              className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg"
              style={{ backgroundColor: ACCENT }}
            >
              Download
            </a>
          )}
          {profile.has_selfie && profile.has_id_front && profile.has_id_back && (
            <button
              onClick={async () => {
                setRegenerating(true)
                setError('')
                try {
                  const res = await regenerateBadge()
                  const updated = await getMyProfile()
                  setProfile(updated)
                  if (res.badge_url) window.open(res.badge_url, '_blank')
                  setSuccess('Badge regenerated!')
                  setTimeout(() => setSuccess(''), 3000)
                } catch (err) {
                  setError(extractApiError(err).message)
                } finally {
                  setRegenerating(false)
                }
              }}
              disabled={regenerating}
              className="px-3 py-1.5 text-xs font-semibold border border-amber-300 text-amber-700 rounded-lg disabled:opacity-50"
            >
              {regenerating ? '…' : profile.has_badge ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {/* Profile details */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Profile Details</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-xs text-amber-600 font-medium border border-amber-300 px-2 py-1 rounded-lg">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="text-xs font-semibold text-white px-3 py-1 rounded-lg disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Mobile</label>
              <input value={mobile} onChange={e => setMobile(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Specialization</label>
              <input value={specialization} onChange={e => setSpecialization(e.target.value)}
                placeholder="e.g. Generator Maintenance"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Home / Base Address</label>
              <input value={homeAddress} onChange={e => setHomeAddress(e.target.value)}
                placeholder="e.g. Westlands, Nairobi"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-700">Sites You Cover</label>
                <span className="text-xs text-amber-600">{selectedSites.length} selected</span>
              </div>
              {profile.site_codes.length === 0 && selectedSites.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No sites available — contact the framework manager.</p>
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-50 max-h-40 overflow-y-auto">
                  {/* Show currently selected sites as checkboxes; owner can add via re-invite */}
                  {profile.site_codes.map(sc => {
                    const checked = selectedSites.includes(sc)
                    return (
                      <label key={sc} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-amber-50 ${checked ? 'bg-amber-50' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setSelectedSites(prev => checked ? prev.filter(c => c !== sc) : [...prev, sc])
                        } className="w-4 h-4 accent-amber-500 shrink-0" />
                        <span className="text-sm text-gray-800">{sc}</span>
                      </label>
                    )
                  })}
                  {selectedSites.filter(sc => !profile.site_codes.includes(sc)).map(sc => (
                    <label key={sc} className="flex items-center gap-3 px-3 py-2 bg-amber-50 cursor-pointer">
                      <input type="checkbox" checked onChange={() =>
                        setSelectedSites(prev => prev.filter(c => c !== sc))
                      } className="w-4 h-4 accent-amber-500 shrink-0" />
                      <span className="text-sm text-gray-800">{sc}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ProfileRow label="Email" value={profile.email} />
            <ProfileRow label="Mobile" value={profile.mobile || '—'} />
            <ProfileRow label="Phone" value={profile.phone || '—'} />
            <ProfileRow label="Specialization" value={profile.specialization || '—'} />
            <ProfileRow label="Home Address" value={profile.home_address || '—'} />
            <ProfileRow label="Regions" value={profile.regions || '—'} />
            {profile.site_codes.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="text-xs text-gray-400 w-24 shrink-0 mt-1">Sites</span>
                <div className="flex flex-wrap gap-1">
                  {profile.site_codes.map(sc => (
                    <span key={sc} className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">{sc}</span>
                  ))}
                </div>
              </div>
            )}
            {profile.gps_lat && (
              <ProfileRow label="GPS" value={`${profile.gps_lat.toFixed(5)}, ${profile.gps_lng?.toFixed(5)}`} />
            )}
          </div>
        )}
      </div>

      {/* GPS update */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Location</h2>
        {profile.gps_lat ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">📍</span>
            <div className="flex-1">
              <div className="text-sm text-gray-700">{profile.gps_lat.toFixed(5)}, {profile.gps_lng?.toFixed(5)}</div>
              <a
                href={`https://maps.google.com/?q=${profile.gps_lat},${profile.gps_lng}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-500"
              >
                Open in Maps
              </a>
            </div>
            <button onClick={captureGps} disabled={gpsLoading} className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg">
              Update
            </button>
          </div>
        ) : (
          <button
            onClick={captureGps}
            disabled={gpsLoading}
            className="w-full py-2.5 border-2 border-dashed border-amber-200 text-amber-700 text-sm font-medium rounded-xl hover:bg-amber-50 disabled:opacity-50"
          >
            {gpsLoading ? 'Getting location…' : '📍 Share My Location'}
          </button>
        )}
      </div>

      {/* KYC documents */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Verification Documents</h2>
        <div className="space-y-3">
          <PhotoItem
            label="Selfie Photo"
            icon="🤳"
            done={profile.has_selfie}
            previewUrl={profile.selfie_url}
            uploading={uploading === 'selfie'}
            inputRef={selfieRef}
            capture="user"
            onUpload={file => handlePhotoUpload('selfie', file)}
          />
          <PhotoItem
            label="ID / Passport — Front"
            icon="🪪"
            done={profile.has_id_front}
            previewUrl={profile.id_front_url}
            uploading={uploading === 'id_front'}
            inputRef={idFrontRef}
            capture="environment"
            onUpload={file => handlePhotoUpload('id_front', file)}
          />
          <PhotoItem
            label="ID / Passport — Back"
            icon="🪪"
            done={profile.has_id_back}
            previewUrl={profile.id_back_url}
            uploading={uploading === 'id_back'}
            inputRef={idBackRef}
            capture="environment"
            onUpload={file => handlePhotoUpload('id_back', file)}
          />
        </div>
      </div>

      {/* CV & Certificates */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">CV & Certificates</h2>
        <div className="space-y-3">
          {/* CV */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${profile.has_cv ? 'bg-green-50' : 'bg-gray-50'}`}>
              {profile.has_cv ? '✅' : '📄'}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800">CV / Resume</div>
              <div className={`text-xs ${profile.has_cv ? 'text-green-600' : 'text-gray-400'}`}>
                {profile.has_cv ? 'Uploaded' : 'PDF or document'}
              </div>
            </div>
            {profile.has_cv && profile.cv_url && (
              <a href={profile.cv_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 border border-blue-100 px-2 py-1 rounded-lg">View</a>
            )}
            <button
              onClick={() => cvRef.current?.click()}
              disabled={uploading === 'cv'}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50 ${
                profile.has_cv ? 'border-gray-200 text-gray-600' : 'border-amber-300 text-amber-700'
              }`}
            >
              {uploading === 'cv' ? '…' : profile.has_cv ? 'Replace' : 'Upload'}
            </button>
            <input ref={cvRef} type="file" accept=".pdf,.doc,.docx,image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload('cv', f) }} />
          </div>

          {/* Certificates */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-lg">🏅</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-800">Certificates</div>
                <div className="text-xs text-gray-400">
                  {profile.certificate_count > 0 ? `${profile.certificate_count} uploaded` : 'None uploaded'}
                </div>
              </div>
              <button
                onClick={() => certRef.current?.click()}
                disabled={uploading === 'certificate'}
                className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 font-medium disabled:opacity-50"
              >
                {uploading === 'certificate' ? '…' : '+ Add'}
              </button>
              <input ref={certRef} type="file" accept=".pdf,.doc,.docx,image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload('certificate', f) }} />
            </div>
            {profile.certificate_count > 0 && profile.certificate_urls && (
              <div className="pl-13 space-y-1.5 ml-13" style={{ marginLeft: '3.25rem' }}>
                {profile.certificate_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs text-blue-600 hover:bg-blue-50">
                    📎 Certificate {i + 1}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-3 text-sm font-semibold text-red-600 border border-red-200 rounded-2xl hover:bg-red-50"
      >
        Sign Out
      </button>
    </div>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-400 w-24 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  )
}

function PhotoItem({
  label, icon, done, previewUrl, uploading, inputRef, capture, onUpload,
}: {
  label: string; icon: string; done: boolean; previewUrl?: string
  uploading: boolean; inputRef: React.RefObject<HTMLInputElement>
  capture: string; onUpload: (f: File) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${done ? 'bg-green-50' : 'bg-gray-50'}`}>
        {done ? '✅' : icon}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className={`text-xs ${done ? 'text-green-600' : 'text-gray-400'}`}>
          {done ? 'Uploaded' : 'Not uploaded'}
        </div>
      </div>
      {previewUrl && (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 border border-blue-100 px-2 py-1 rounded-lg">View</a>
      )}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={`text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50 ${
          done ? 'border-gray-200 text-gray-600' : 'border-amber-300 text-amber-700'
        }`}
      >
        {uploading ? '…' : done ? 'Retake' : 'Upload'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture as any}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
        }}
      />
    </div>
  )
}
