import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { reportsApi } from '@/api/reports'

export default function DiscountImpactPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    reportsApi.discountImpact(propertyId).then(setData).finally(() => setLoading(false))
  }, [propertyId])

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Discount Impact Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">Total rent discounts given and their financial impact</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Discounts', value: data.active_discounts, color: 'text-blue-700' },
          { label: 'Monthly Saving', value: `KES ${data.monthly_saving?.toLocaleString()}`, color: 'text-orange-700' },
          { label: 'Total Given (Historical)', value: `KES ${data.historical_total_saving?.toLocaleString()}`, color: 'text-red-700' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Label', 'Type', 'Monthly Saving', 'Status', 'Period', 'Total Given'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.breakdown?.map((d: any, i: number) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{d.label}</td>
                <td className="px-4 py-3 text-gray-600">
                  {d.type === 'fixed' ? `KES ${d.value}` : `${d.value}%`}
                </td>
                <td className="px-4 py-3 text-orange-700 font-medium">
                  KES {d.monthly_saving?.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      d.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {d.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {d.effective_from}{d.effective_to ? ` → ${d.effective_to}` : ' → ongoing'}
                </td>
                <td className="px-4 py-3 text-red-600 font-medium">
                  KES {d.total_given?.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
