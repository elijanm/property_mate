import { useContext, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  listInvitedVendors, inviteVendor, reinviteVendor, removeInvitedVendor, getVendorDocs,
  adminRegenerateBadge, adminUpdateVendorSites, getVendorRatings, submitVendorRating,
} from '@/api/frameworks'
import type { InvitedVendor, InviteVendorPayload, VendorDocs } from '@/api/frameworks'
import type { VendorRatingSummary, SubmitRatingPayload } from '@/types/framework'
import { updateVendorStatus } from '@/api/frameworkPortal'
import { extractApiError } from '@/utils/apiError'
import { FrameworkContext } from './FrameworkWorkspacePage'

const ACCENT = '#D97706'

const STATUS_PILL: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  pending_review: 'bg-yellow-100 text-yellow-700',
  invited: 'bg-gray-100 text-gray-500',
  suspended: 'bg-red-100 text-red-700',
}

export default function FrameworkVendorsPage() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const { framework } = useContext(FrameworkContext)
  const availableSites = framework?.sites ?? []
  const [invited, setInvited] = useState<InvitedVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'approved' | 'invited'>('approved')
  const [showInvite, setShowInvite] = useState(false)
  const [reinvitingId, setReinvitingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [docsVendor, setDocsVendor] = useState<InvitedVendor | null>(null)
  const [docs, setDocs] = useState<VendorDocs | null>(null)
  const [docsLoading, setDocsLoading] = useState(false)
  const [regeneratingBadge, setRegeneratingBadge] = useState(false)
  const [editingSites, setEditingSites] = useState(false)
  const [selectedSites, setSelectedSites] = useState<string[]>([])
  const [savingSites, setSavingSites] = useState(false)
  const [slideTab, setSlideTab] = useState<'docs' | 'ratings'>('docs')
  const [ratingSummary, setRatingSummary] = useState<VendorRatingSummary | null>(null)
  const [ratingsLoading, setRatingsLoading] = useState(false)
  const [showRateForm, setShowRateForm] = useState(false)
  const [ratingForm, setRatingForm] = useState<SubmitRatingPayload>({ overall: 0 })
  const [submittingRating, setSubmittingRating] = useState(false)
  const [ratingError, setRatingError] = useState('')

  const approved = invited.filter(m => m.status === 'active')
  const pending = invited.filter(m => m.status !== 'active')

  useEffect(() => {
    if (!frameworkId) return
    listInvitedVendors(frameworkId).then(d => { setInvited(d); setLoading(false) })
  }, [frameworkId])

  async function handleInvited(payload: InviteVendorPayload) {
    if (!frameworkId) return
    const member = await inviteVendor(frameworkId, payload)
    setInvited(prev => [member, ...prev])
    setTab('invited')
  }

  async function handleReinvite(id: string) {
    if (!frameworkId) return
    setReinvitingId(id)
    try {
      const updated = await reinviteVendor(frameworkId, id)
      setInvited(prev => prev.map(m => m.id === id ? updated : m))
    } finally {
      setTimeout(() => setReinvitingId(null), 1500)
    }
  }

  async function handleRemove(id: string) {
    if (!frameworkId) return
    setRemovingId(id)
    try {
      await removeInvitedVendor(frameworkId, id)
      setInvited(prev => prev.filter(m => m.id !== id))
    } finally {
      setRemovingId(null)
    }
  }

  async function handleApprove(id: string) {
    setApprovingId(id)
    try {
      await updateVendorStatus(id, 'active')
      setInvited(prev => prev.map(m => m.id === id ? { ...m, status: 'active' } : m))
    } finally {
      setTimeout(() => setApprovingId(null), 1500)
    }
  }

  async function openDocs(vendor: InvitedVendor) {
    if (!frameworkId) return
    setDocsVendor(vendor)
    setDocs(null)
    setDocsLoading(true)
    setSlideTab('docs')
    setRatingSummary(null)
    setShowRateForm(false)
    setRatingForm({ overall: 0 })
    setRatingError('')
    try {
      const d = await getVendorDocs(frameworkId, vendor.id)
      setDocs(d)
    } finally {
      setDocsLoading(false)
    }
  }

  async function loadRatings(vendor: InvitedVendor) {
    if (!frameworkId) return
    setRatingsLoading(true)
    try {
      const summary = await getVendorRatings(frameworkId, vendor.id)
      setRatingSummary(summary)
    } finally {
      setRatingsLoading(false)
    }
  }

  async function handleSubmitRating() {
    if (!frameworkId || !docsVendor) return
    if (!ratingForm.overall || ratingForm.overall < 1) {
      setRatingError('Please provide an overall star rating.')
      return
    }
    setSubmittingRating(true)
    setRatingError('')
    try {
      await submitVendorRating(frameworkId, docsVendor.id, ratingForm)
      setShowRateForm(false)
      setRatingForm({ overall: 0 })
      await loadRatings(docsVendor)
    } catch (e) {
      setRatingError(extractApiError(e).message)
    } finally {
      setSubmittingRating(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Service Providers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Approved vendors and technicians for this framework contract</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: ACCENT }}
        >
          + Invite Vendor
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Approved Vendors', value: approved.length, icon: '✅' },
          { label: 'Invited (pending)', value: pending.length, icon: '📨' },
          { label: 'Pending Review', value: invited.filter(m => m.status === 'pending_review').length, icon: '🔍' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-lg mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {([
          { key: 'approved', label: 'Approved Vendors', count: approved.length },
          { key: 'invited', label: 'All Invitations', count: pending.length },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Approved Vendors tab ── */}
      {tab === 'approved' && (
        loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : approved.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
            <div className="text-5xl mb-4">👷</div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No approved vendors yet</h3>
            <p className="text-sm text-gray-500 mb-6">Invite vendors — once you approve them they'll appear here.</p>
            <button onClick={() => setShowInvite(true)} className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
              Invite Vendor
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {approved.map(v => (
              <div key={v.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-amber-300 transition">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-xl shrink-0">👷</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-900">{v.name}</h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
                      </div>
                      <p className="text-xs text-gray-500">{v.contact_name} · {v.mobile || v.phone || '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{v.specialization || 'General'}</p>
                      {v.site_codes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {v.site_codes.map(sc => (
                            <span key={sc} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">{sc}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={() => openDocs(v)}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:border-amber-400 hover:text-amber-700"
                    >
                      View Docs 🪪
                    </button>
                    {v.gps_lat && (
                      <a
                        href={`https://maps.google.com/?q=${v.gps_lat},${v.gps_lng}`}
                        target="_blank" rel="noreferrer"
                        className="text-[10px] text-blue-500"
                      >
                        📍 Location
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── All Invitations tab ── */}
      {tab === 'invited' && (
        loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : invited.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
            <div className="text-5xl mb-4">📨</div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No invitations yet</h3>
            <p className="text-sm text-gray-500 mb-6">Invited vendors will appear here.</p>
            <button onClick={() => setShowInvite(true)} className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
              Invite Vendor
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Invited</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invited.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50 group">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{m.name}</div>
                      {m.specialization && <div className="text-[10px] text-gray-400">{m.specialization}</div>}
                      {m.site_codes.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {m.site_codes.slice(0, 3).map(sc => (
                            <span key={sc} className="text-[9px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded">{sc}</span>
                          ))}
                          {m.site_codes.length > 3 && <span className="text-[9px] text-gray-400">+{m.site_codes.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {m.contact_name}<br />
                      <span className="text-gray-400">{m.mobile || m.phone || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{m.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[m.status] || 'bg-gray-100 text-gray-500'}`}>
                        {m.status?.replace('_', ' ') || 'invited'}
                      </span>
                      {m.activated_at && (
                        <div className="text-[10px] text-green-600 mt-0.5">✓ Activated</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(m.reinvited_at ?? m.invited_at).toLocaleDateString()}
                      {m.reinvited_at && <span className="ml-1 text-amber-500">(re-sent)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {m.status === 'pending_review' && (
                          <button
                            onClick={() => handleApprove(m.id)}
                            disabled={approvingId === m.id}
                            className="px-2 py-1 text-xs font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-60"
                          >
                            {approvingId === m.id ? '✓' : 'Approve'}
                          </button>
                        )}
                        {m.activated_at && (
                          <button
                            onClick={() => openDocs(m)}
                            className="px-2 py-1 text-xs border border-gray-200 text-gray-600 rounded-lg hover:border-amber-400 hover:text-amber-700"
                          >
                            Docs
                          </button>
                        )}
                        <button
                          onClick={() => handleReinvite(m.id)}
                          disabled={reinvitingId === m.id}
                          className={`px-2 py-1 text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                            reinvitingId === m.id ? 'bg-green-100 text-green-700' : 'border border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-700'
                          }`}
                        >
                          {reinvitingId === m.id ? '✓' : 'Re-invite'}
                        </button>
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          className="px-2 py-1 text-xs text-red-400 border border-red-100 rounded-lg hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          {removingId === m.id ? '…' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showInvite && (
        <InviteVendorModal
          onClose={() => setShowInvite(false)}
          onInvited={handleInvited}
        />
      )}

      {/* KYC Docs Slide-Over */}
      {docsVendor && (
        <div className="fixed inset-0 z-50 flex" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="ml-auto w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900">{docsVendor.contact_name}</h2>
                <p className="text-xs text-gray-500">{docsVendor.name}</p>
              </div>
              <button onClick={() => { setDocsVendor(null); setDocs(null); setRatingSummary(null) }} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
            </div>

            {/* Slide-over tabs */}
            <div className="flex border-b border-gray-100 shrink-0 px-6">
              {([
                { key: 'docs', label: 'Documents & Badge' },
                { key: 'ratings', label: 'Ratings' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => {
                    setSlideTab(t.key)
                    if (t.key === 'ratings' && !ratingSummary && docsVendor) loadRatings(docsVendor)
                  }}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    slideTab === t.key ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 p-6 space-y-5 overflow-y-auto">
              {/* ── Ratings Tab ── */}
              {slideTab === 'ratings' && (
                <RatingsPanel
                  summary={ratingSummary}
                  loading={ratingsLoading}
                  showForm={showRateForm}
                  form={ratingForm}
                  submitting={submittingRating}
                  error={ratingError}
                  accent={ACCENT}
                  onOpenForm={() => { setShowRateForm(true); setRatingError('') }}
                  onCancelForm={() => { setShowRateForm(false); setRatingError('') }}
                  onChangeForm={patch => setRatingForm(prev => ({ ...prev, ...patch }))}
                  onSubmit={handleSubmitRating}
                />
              )}

              {/* ── Docs Tab ── */}
              {slideTab === 'docs' && docsLoading ? (
                <div className="text-center py-16 text-gray-400 text-sm">Loading documents…</div>
              ) : slideTab === 'docs' && docs ? (
                <>
                  {/* Status & info */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Status</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[docs.status] || 'bg-gray-100 text-gray-500'}`}>
                        {docs.status.replace('_', ' ')}
                      </span>
                    </div>
                    {docs.mobile && <InfoRow label="Mobile" value={docs.mobile} />}
                    {docs.activated_at && <InfoRow label="Activated" value={new Date(docs.activated_at).toLocaleString()} />}
                    {/* Sites — editable */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-gray-400">Sites Covered</span>
                        {!editingSites ? (
                          <button
                            onClick={() => { setSelectedSites(docs.site_codes); setEditingSites(true) }}
                            className="text-[10px] font-semibold text-amber-700 hover:underline"
                          >
                            ✏️ Edit
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEditingSites(false)}
                              className="text-[10px] text-gray-400 hover:text-gray-600"
                            >
                              Cancel
                            </button>
                            <button
                              disabled={savingSites}
                              onClick={async () => {
                                if (!frameworkId || !docsVendor) return
                                setSavingSites(true)
                                try {
                                  const result = await adminUpdateVendorSites(frameworkId, docsVendor.id, selectedSites)
                                  setDocs(prev => prev ? { ...prev, site_codes: result.site_codes } : null)
                                  setEditingSites(false)
                                } catch (e) {
                                  // error shown inline
                                } finally {
                                  setSavingSites(false)
                                }
                              }}
                              className="text-[10px] font-semibold text-white px-2 py-0.5 rounded"
                              style={{ backgroundColor: ACCENT }}
                            >
                              {savingSites ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )}
                      </div>
                      {editingSites ? (
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {availableSites.length === 0 ? (
                            <p className="text-xs text-gray-400">No sites configured for this contract yet.</p>
                          ) : (
                            availableSites.map(site => {
                              const checked = selectedSites.includes(site.site_code)
                              return (
                                <label key={site.site_code} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-amber-50">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => setSelectedSites(prev =>
                                      checked ? prev.filter(s => s !== site.site_code) : [...prev, site.site_code]
                                    )}
                                    className="accent-amber-600"
                                  />
                                  <span className="text-xs font-medium text-gray-700">{site.site_code}</span>
                                  <span className="text-xs text-gray-400 truncate">{site.site_name}</span>
                                  <span className="text-[10px] text-gray-300 ml-auto">{site.region}</span>
                                </label>
                              )
                            })
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1 min-h-[20px]">
                          {docs.site_codes.length > 0 ? docs.site_codes.map(sc => (
                            <span key={sc} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">{sc}</span>
                          )) : (
                            <span className="text-xs text-gray-400 italic">No sites assigned</span>
                          )}
                        </div>
                      )}
                    </div>
                    {docs.gps_lat && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Location</span>
                        <a href={`https://maps.google.com/?q=${docs.gps_lat},${docs.gps_lng}`} target="_blank" rel="noreferrer" className="text-xs text-blue-500">
                          📍 View on Maps
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Photos */}
                  <DocPhoto label="Selfie Photo" icon="🤳" url={docs.selfie_url} has={docs.has_selfie} />
                  <DocPhoto label="ID — Front" icon="🪪" url={docs.id_front_url} has={docs.has_id_front} />
                  <DocPhoto label="ID — Back" icon="🪪" url={docs.id_back_url} has={docs.has_id_back} />

                  {/* CV */}
                  <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-2xl">📄</span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-800">CV / Resume</div>
                      <div className="text-xs text-gray-500">{docs.has_cv ? 'Uploaded' : 'Not uploaded'}</div>
                    </div>
                    {docs.has_cv && docs.cv_url && (
                      <a href={docs.cv_url} target="_blank" rel="noreferrer"
                        className="px-3 py-1.5 text-xs font-semibold border border-gray-200 text-gray-700 rounded-lg hover:border-amber-400 hover:text-amber-700">
                        View
                      </a>
                    )}
                  </div>

                  {/* Certificates */}
                  {docs.certificate_count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span>🏅</span>
                        <span className="text-xs font-semibold text-gray-700">Certificates</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 ml-auto">
                          {docs.certificate_count} file{docs.certificate_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {docs.certificate_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50">
                            📎 Certificate {i + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Badge */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                    <span className="text-2xl">🪪</span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-amber-800">Contractor Badge</div>
                      <div className="text-xs text-amber-600">
                        {docs.has_badge ? 'Ready for download' : 'Not yet generated'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {docs.has_badge && docs.badge_url && (
                        <a href={docs.badge_url} target="_blank" rel="noreferrer"
                          className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg"
                          style={{ backgroundColor: ACCENT }}>
                          Download
                        </a>
                      )}
                      <button
                        disabled={regeneratingBadge}
                        onClick={async () => {
                          if (!frameworkId || !docsVendor) return
                          setRegeneratingBadge(true)
                          try {
                            const result = await adminRegenerateBadge(frameworkId, docsVendor.id)
                            setDocs(prev => prev ? {
                              ...prev,
                              has_badge: true,
                              badge_url: result.badge_url ?? prev.badge_url,
                            } : null)
                          } finally {
                            setRegeneratingBadge(false)
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold border border-amber-400 text-amber-700 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                      >
                        {regeneratingBadge ? 'Generating…' : docs.has_badge ? '↻ Regenerate' : '⚡ Generate'}
                      </button>
                    </div>
                  </div>

                  {/* Approve / Suspend */}
                  {docs.status === 'pending_review' && (
                    <button
                      onClick={async () => {
                        await handleApprove(docsVendor.id)
                        setDocs(prev => prev ? { ...prev, status: 'active' } : null)
                      }}
                      className="w-full py-2.5 text-sm font-semibold text-white rounded-xl"
                      style={{ backgroundColor: ACCENT }}
                    >
                      ✅ Approve Vendor
                    </button>
                  )}
                  {docs.status === 'active' && (
                    <button
                      onClick={async () => {
                        await updateVendorStatus(docsVendor.id, 'suspended')
                        setInvited(prev => prev.map(m => m.id === docsVendor.id ? { ...m, status: 'suspended' } : m))
                        setDocs(prev => prev ? { ...prev, status: 'suspended' } : null)
                      }}
                      className="w-full py-2.5 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50"
                    >
                      Suspend Vendor
                    </button>
                  )}
                </>
              ) : slideTab === 'docs' ? (
                <div className="text-center py-16 text-gray-400 text-sm">Failed to load documents</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs text-gray-700 font-medium">{value}</span>
    </div>
  )
}

function DocPhoto({ label, icon, url, has }: { label: string; icon: string; url?: string; has: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span>{icon}</span>
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto ${has ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
          {has ? 'Uploaded' : 'Not uploaded'}
        </span>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} className="w-full h-40 object-cover rounded-xl border border-gray-200 hover:opacity-90 transition" />
        </a>
      ) : (
        <div className="w-full h-24 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-sm">
          Not uploaded
        </div>
      )}
    </div>
  )
}

// ── Star Input ────────────────────────────────────────────────────────────────

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={`text-2xl transition-transform hover:scale-110 ${star <= value ? 'text-amber-400' : 'text-gray-200'}`}
        >
          ★
        </button>
      ))}
      {value > 0 && <span className="text-xs text-gray-500 ml-1">{value}/5</span>}
    </div>
  )
}

// ── Dimension Score Slider ────────────────────────────────────────────────────

function DimSlider({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-700">{label}</label>
        <span className="text-xs text-gray-400">{value ? `${value}/5` : 'skip'}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range" min={0} max={5} step={0.5}
          value={value ?? 0}
          onChange={e => {
            const v = parseFloat(e.target.value)
            onChange(v === 0 ? undefined : v)
          }}
          className="flex-1 accent-amber-500"
        />
        {value !== undefined && (
          <button type="button" onClick={() => onChange(undefined)} className="text-[10px] text-gray-400 hover:text-red-400">✕</button>
        )}
      </div>
    </div>
  )
}

// ── Avg Score Bar ─────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value?: number }) {
  if (value === undefined) return null
  const pct = (value / 5) * 100
  const color = value >= 4 ? 'bg-green-500' : value >= 3 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-800">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Ratings Panel ─────────────────────────────────────────────────────────────

function RatingsPanel({
  summary, loading, showForm, form, submitting, error, accent,
  onOpenForm, onCancelForm, onChangeForm, onSubmit,
}: {
  summary: VendorRatingSummary | null
  loading: boolean
  showForm: boolean
  form: SubmitRatingPayload
  submitting: boolean
  error: string
  accent: string
  onOpenForm: () => void
  onCancelForm: () => void
  onChangeForm: (patch: Partial<SubmitRatingPayload>) => void
  onSubmit: () => void
}) {
  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Loading ratings…</div>

  const DIMENSIONS: { key: keyof Omit<SubmitRatingPayload, 'overall' | 'comment' | 'work_order_id'>; label: string }[] = [
    { key: 'responsiveness', label: 'Responsiveness (response time to callouts)' },
    { key: 'work_quality',   label: 'Work Quality (technician notes / feedback)' },
    { key: 'punctuality',    label: 'Punctuality (on-time arrivals)' },
    { key: 'documentation',  label: 'Documentation (reports submitted on time)' },
  ]

  return (
    <div className="space-y-5">
      {/* Summary card */}
      {summary && summary.rating_count > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-amber-800">Overall Rating</span>
            <div className="flex items-center gap-1">
              <span className="text-2xl font-black text-amber-600">{summary.avg_overall?.toFixed(1) ?? '—'}</span>
              <span className="text-amber-400 text-lg">★</span>
              <span className="text-xs text-amber-500 ml-1">({summary.rating_count} review{summary.rating_count !== 1 ? 's' : ''})</span>
            </div>
          </div>
          <div className="space-y-2">
            <ScoreBar label="Responsiveness" value={summary.avg_responsiveness} />
            <ScoreBar label="Work Quality" value={summary.avg_work_quality} />
            <ScoreBar label="Punctuality" value={summary.avg_punctuality} />
            <ScoreBar label="Documentation" value={summary.avg_documentation} />
          </div>
        </div>
      )}

      {!summary || summary.rating_count === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-4xl mb-2">⭐</div>
          <p className="text-sm text-gray-500">No ratings yet</p>
        </div>
      ) : null}

      {/* Rate button */}
      {!showForm && (
        <button
          onClick={onOpenForm}
          className="w-full py-2.5 text-sm font-semibold text-white rounded-xl"
          style={{ backgroundColor: accent }}
        >
          + Submit Rating
        </button>
      )}

      {/* Rating form */}
      {showForm && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-200">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-gray-900">New Rating</h4>
            <button onClick={onCancelForm} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Overall Rating *</label>
            <StarInput value={form.overall} onChange={v => onChangeForm({ overall: v })} />
          </div>

          {DIMENSIONS.map(d => (
            <DimSlider
              key={d.key}
              label={d.label}
              value={form[d.key]}
              onChange={v => onChangeForm({ [d.key]: v })}
            />
          ))}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Comments</label>
            <textarea
              rows={3}
              value={form.comment ?? ''}
              onChange={e => onChangeForm({ comment: e.target.value || undefined })}
              placeholder="Optional feedback…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>

          <button
            onClick={onSubmit}
            disabled={submitting || !form.overall}
            className="w-full py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {submitting ? 'Saving…' : 'Submit Rating'}
          </button>
        </div>
      )}

      {/* Past ratings */}
      {summary && summary.ratings.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">History</h4>
          <div className="space-y-3">
            {summary.ratings.map(r => (
              <div key={r.id} className="bg-white border border-gray-100 rounded-xl p-3">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-1 text-amber-400">
                    {[1,2,3,4,5].map(s => (
                      <span key={s} className={s <= Math.round(r.overall) ? 'text-amber-400' : 'text-gray-200'}>★</span>
                    ))}
                    <span className="text-xs text-gray-500 ml-1">{r.overall.toFixed(1)}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{new Date(r.rated_at).toLocaleDateString()}</span>
                </div>
                {r.comment && <p className="text-xs text-gray-600 mt-1">{r.comment}</p>}
                <div className="flex flex-wrap gap-2 mt-2">
                  {r.responsiveness && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Resp {r.responsiveness.toFixed(1)}</span>}
                  {r.work_quality    && <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">Quality {r.work_quality.toFixed(1)}</span>}
                  {r.punctuality    && <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">Punct {r.punctuality.toFixed(1)}</span>}
                  {r.documentation  && <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">Docs {r.documentation.toFixed(1)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function InviteVendorModal({
  onClose,
  onInvited,
}: {
  onClose: () => void
  onInvited: (p: InviteVendorPayload) => Promise<void>
}) {
  const [form, setForm] = useState<InviteVendorPayload>({ name: '', contact_name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onInvited(form)
      onClose()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Invite Service Provider</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {([
            { label: 'Company Name *', key: 'name' as const, placeholder: 'ABC Generator Services Ltd' },
            { label: 'Contact Person *', key: 'contact_name' as const, placeholder: 'John Kamau' },
            { label: 'Email *', key: 'email' as const, placeholder: 'john@abcgenerators.co.ke', type: 'email' },
            { label: 'Phone', key: 'phone' as const, placeholder: '+254 7XX XXX XXX' },
            { label: 'Specialization', key: 'specialization' as const, placeholder: 'Generator Maintenance, Cummins Certified' },
            { label: 'Coverage Regions', key: 'regions' as const, placeholder: 'Nairobi, Central, Rift Valley' },
          ] as const).map(f => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-gray-700 mb-1">{f.label}</label>
              <input
                type={'type' in f ? f.type : 'text'}
                required={f.label.includes('*')}
                value={form[f.key] ?? ''}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value || undefined }))}
                placeholder={f.placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
              {saving ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
