import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicListing, applyToListing } from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'

export default function VendorApplyPage() {
  const { listingId } = useParams<{ listingId: string }>()
  const [listing, setListing] = useState<any>(null)
  const [loadingListing, setLoadingListing] = useState(true)
  const [listingError, setListingError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    registration_number: '',
    tax_pin: '',
    service_categories: '',
    cover_letter: '',
  })

  useEffect(() => {
    if (!listingId) return
    getPublicListing(listingId)
      .then(setListing)
      .catch((err) => setListingError(extractApiError(err).message))
      .finally(() => setLoadingListing(false))
  }, [listingId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!listingId) return
    setSubmitting(true)
    setError(null)
    try {
      await applyToListing(listingId, {
        ...form,
        service_categories: form.service_categories
          ? form.service_categories.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      })
      setSubmitted(true)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingListing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    )
  }

  if (listingError || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 mb-2">Not Available</p>
          <p className="text-gray-500">{listingError || 'This listing is not available for applications.'}</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
          <p className="text-gray-500">
            Thank you for applying. We'll review your application and get back to you via email.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Listing info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Open</span>
          <h1 className="text-2xl font-bold text-gray-900 mt-3 mb-2">{listing.title}</h1>
          <p className="text-gray-600 mb-4">{listing.description}</p>
          <div className="flex flex-wrap gap-3 text-sm text-gray-500">
            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{listing.service_category}</span>
            {listing.application_fee > 0 && (
              <span>Application Fee: KES {listing.application_fee.toLocaleString()}</span>
            )}
            {listing.deadline && (
              <span>Deadline: {new Date(listing.deadline).toLocaleDateString('en-KE')}</span>
            )}
          </div>
          {listing.requirements && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Requirements</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{listing.requirements}</p>
            </div>
          )}
        </div>

        {/* Application form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Apply Now</h2>

          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg mb-4">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company Name *</label>
                <input
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.company_name}
                  onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name *</label>
                <input
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.contact_name}
                  onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
                <input
                  required
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.contact_email}
                  onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.contact_phone}
                  onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Registration No.</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.registration_number}
                  onChange={(e) => setForm((f) => ({ ...f, registration_number: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">KRA PIN</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.tax_pin}
                  onChange={(e) => setForm((f) => ({ ...f, tax_pin: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Service Categories (comma-separated)</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="plumbing, electrical, cleaning"
                value={form.service_categories}
                onChange={(e) => setForm((f) => ({ ...f, service_categories: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Cover Letter / Statement of Intent</label>
              <textarea
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Tell us about your company and why you're a good fit…"
                value={form.cover_letter}
                onChange={(e) => setForm((f) => ({ ...f, cover_letter: e.target.value }))}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Application'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
