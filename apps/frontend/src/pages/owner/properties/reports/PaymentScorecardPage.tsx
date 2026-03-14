import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { reportsApi } from '@/api/reports'

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">No data</span>
  const color =
    score >= 80
      ? 'text-green-700 bg-green-100'
      : score >= 50
      ? 'text-orange-700 bg-orange-100'
      : 'text-red-700 bg-red-100'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {score}%
    </span>
  )
}

function Stars({ score }: { score?: number }) {
  if (!score) return null
  return (
    <span className="text-yellow-500 text-sm">
      {'★'.repeat(score)}{'☆'.repeat(5 - score)}
    </span>
  )
}

export default function PaymentScorecardPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    reportsApi.paymentScorecard(propertyId).then(setData).finally(() => setLoading(false))
  }, [propertyId])

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Tenant Payment Scorecard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Payment timeliness and behaviour</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Tenant', 'Unit', 'On-time %', 'On Time', 'Late', 'Outstanding', 'Rating'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tenants?.map((t: any) => (
              <tr key={t.lease_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-xs">{t.tenant_id.slice(-6).toUpperCase()}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{t.unit_id.slice(-6)}</td>
                <td className="px-4 py-3"><ScoreBadge score={t.on_time_rate} /></td>
                <td className="px-4 py-3 text-green-700">{t.paid_on_time}</td>
                <td className="px-4 py-3 text-orange-600">{t.paid_late}</td>
                <td className="px-4 py-3 text-red-600">{t.outstanding}</td>
                <td className="px-4 py-3"><Stars score={t.rating?.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
