import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { reportsApi } from '@/api/reports'

export default function VacancyLossPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    reportsApi.vacancyLoss(propertyId).then(setData).finally(() => setLoading(false))
  }, [propertyId])

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Vacancy Loss Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">Revenue lost due to vacant units</p>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="text-sm text-red-700">Total estimated loss (6 months)</p>
        <p className="text-2xl font-bold text-red-800">KES {data.total_loss?.toLocaleString()}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Month', 'Total Units', 'Occupied', 'Vacant', 'Occupancy %', 'Est. Loss'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.months?.map((m: any) => (
              <tr key={m.month} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{m.label}</td>
                <td className="px-4 py-3">{m.total_units}</td>
                <td className="px-4 py-3 text-green-700">{m.occupied}</td>
                <td className="px-4 py-3 text-red-600">{m.vacant}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${m.occupancy_pct}%` }} />
                    </div>
                    <span>{m.occupancy_pct}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-red-600 font-medium">KES {m.vacancy_loss?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
