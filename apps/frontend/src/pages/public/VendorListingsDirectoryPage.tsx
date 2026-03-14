import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getPublicListingsDirectory } from '@/api/vendors'
import type { VendorListing } from '@/types/vendor'

interface OrgBranding {
  org_id: string
  name: string
  logo_url?: string
  email?: string
  phone?: string
  website?: string
  address?: string
}

export default function VendorListingsDirectoryPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const orgId = searchParams.get('org_id') ?? ''

  const [org, setOrg] = useState<OrgBranding | null>(null)
  const [listings, setListings] = useState<VendorListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!orgId) {
      setError('Missing organisation ID.')
      setLoading(false)
      return
    }
    getPublicListingsDirectory(orgId)
      .then(data => {
        setOrg(data.org)
        setListings(data.listings)
      })
      .catch(() => setError('Organisation not found or has no open tenders.'))
      .finally(() => setLoading(false))
  }, [orgId])

  const filtered = listings.filter(l =>
    !search ||
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.service_category.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading tenders…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-gray-500 text-sm mt-1">Check the link you were given.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-4">
            {org?.logo_url && (
              <img src={org.logo_url} alt={org?.name} className="h-14 w-14 rounded-lg object-cover border border-gray-200" />
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{org?.name}</h1>
              <p className="text-gray-500 text-sm mt-0.5">Open Tenders &amp; Service Provider Opportunities</p>
            </div>
          </div>
          {(org?.email || org?.phone || org?.address) && (
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
              {org.email && <span>✉ {org.email}</span>}
              {org.phone && <span>📞 {org.phone}</span>}
              {org.address && <span>📍 {org.address}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search tenders by title or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg">No open tenders at the moment.</p>
            <p className="text-gray-400 text-sm mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{filtered.length} open tender{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onApply={() => navigate(`/apply/${listing.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ListingCard({ listing, onApply }: { listing: VendorListing; onApply: () => void }) {
  const deadline = listing.deadline ? new Date(listing.deadline) : null
  const isUrgent = deadline && (deadline.getTime() - Date.now()) < 7 * 24 * 60 * 60 * 1000

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
              {listing.service_category}
            </span>
            {isUrgent && (
              <span className="text-xs font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                Closing soon
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{listing.title}</h3>
          <p className="text-gray-600 text-sm mt-1 line-clamp-2">{listing.description}</p>

          <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
            {listing.application_fee > 0 && (
              <span>Application fee: <strong className="text-gray-700">KES {listing.application_fee.toLocaleString()}</strong></span>
            )}
            {listing.contract_duration_months && (
              <span>Contract: <strong className="text-gray-700">{listing.contract_duration_months} months</strong></span>
            )}
            {listing.contract_value && (
              <span>Value: <strong className="text-gray-700">KES {listing.contract_value.toLocaleString()}</strong></span>
            )}
            {deadline && (
              <span>Deadline: <strong className={isUrgent ? 'text-amber-600' : 'text-gray-700'}>{deadline.toLocaleDateString()}</strong></span>
            )}
            {listing.max_vendors && (
              <span>Slots: <strong className="text-gray-700">{listing.max_vendors}</strong></span>
            )}
          </div>

          {listing.requirements && (
            <details className="mt-3">
              <summary className="text-sm text-blue-600 cursor-pointer">View requirements</summary>
              <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{listing.requirements}</p>
            </details>
          )}
        </div>

        <button
          onClick={onApply}
          className="shrink-0 bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Apply Now
        </button>
      </div>
    </div>
  )
}
