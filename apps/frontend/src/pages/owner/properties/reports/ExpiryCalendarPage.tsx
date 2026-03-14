import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { reportsApi } from '@/api/reports'

const URGENCY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  warning: 'bg-orange-100 text-orange-700 border-orange-200',
  notice: 'bg-yellow-100 text-yellow-700 border-yellow-200',
}

export default function ExpiryCalendarPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    reportsApi.expiryCalendar(propertyId).then(setData).finally(() => setLoading(false))
  }, [propertyId])

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Lease Expiry Calendar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Leases expiring in the next 90 days</p>
      </div>
      {data.items?.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No leases expiring in the next 90 days</div>
      ) : (
        <div className="space-y-3">
          {data.items?.map((item: any) => (
            <div
              key={item.lease_id}
              className={`flex items-center justify-between p-4 rounded-xl border ${URGENCY_COLORS[item.urgency] ?? ''}`}
            >
              <div>
                <p className="font-medium text-sm">Lease {item.lease_id.slice(-6).toUpperCase()}</p>
                <p className="text-xs mt-0.5 opacity-75">Unit {item.unit_id.slice(-6)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{item.end_date}</p>
                <p className="text-xs mt-0.5">{item.days_until_expiry} days left</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">KES {item.rent_amount?.toLocaleString()}/mo</p>
                {item.renewal_offer_status && (
                  <span className="text-xs bg-white/50 px-2 py-0.5 rounded-full">
                    Renewal: {item.renewal_offer_status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
