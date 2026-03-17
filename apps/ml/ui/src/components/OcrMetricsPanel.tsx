import type { OcrMetrics } from '@/types/feedback'

interface Props { data: OcrMetrics }

export default function OcrMetricsPanel({ data }: Props) {
  if (!data.total) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No labeled feedback yet — submit predictions with actual labels to compute OCR metrics.
      </div>
    )
  }

  const offByRows = [
    { label: 'Exact match',   key: 'exact',       color: 'bg-emerald-500' },
    { label: 'Off by 1',      key: '1',            color: 'bg-yellow-500' },
    { label: 'Off by 2–10',   key: '2_to_10',      color: 'bg-orange-500' },
    { label: 'Off by 11–100', key: '11_to_100',    color: 'bg-red-500' },
    { label: 'Off by >100',   key: 'over_100',     color: 'bg-red-800' },
  ] as const

  const maxOffBy = Math.max(...Object.values(data.off_by), 1)

  return (
    <div className="space-y-6">
      {/* Top-level metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Exact Match" value={`${(data.exact_match_rate * 100).toFixed(1)}%`}
          sub={`${data.exact_match} / ${data.total}`} color="emerald" />
        <Stat label="Digit Accuracy" value={`${(data.digit_accuracy * 100).toFixed(1)}%`}
          sub="per-position" color="blue" />
        <Stat label="Char Error Rate" value={`${(data.char_error_rate * 100).toFixed(2)}%`}
          sub="avg edit / length" color="purple" />
        <Stat label="Total Samples" value={data.total.toString()} sub="labeled feedback" color="gray" />
      </div>

      {/* Off-by distribution bar chart */}
      <div className="bg-gray-950 rounded-2xl p-5 border border-gray-800">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
          Numeric Error Distribution
        </h4>
        <div className="space-y-2.5">
          {offByRows.map(({ label, key, color }) => {
            const count = data.off_by[key]
            const pct = data.total > 0 ? count / data.total : 0
            return (
              <div key={key} className="flex items-center gap-3 text-xs">
                <span className="w-28 text-right text-gray-400 shrink-0">{label}</span>
                <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${color}`}
                    style={{ width: `${(count / maxOffBy) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-gray-300 shrink-0">
                  {count} <span className="text-gray-600">({(pct * 100).toFixed(1)}%)</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Common misread patterns */}
      {data.common_errors.length > 0 && (
        <div className="bg-gray-950 rounded-2xl p-5 border border-gray-800">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Most Common Misreads
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1 pr-6">Actual</th>
                <th className="text-left py-1 pr-6">Predicted</th>
                <th className="text-right py-1">Count</th>
              </tr>
            </thead>
            <tbody>
              {data.common_errors.map((e, i) => (
                <tr key={i} className="border-b border-gray-900 hover:bg-gray-900/40">
                  <td className="py-1.5 pr-6 font-mono text-emerald-400">{e.actual}</td>
                  <td className="py-1.5 pr-6 font-mono text-red-400">{e.predicted}</td>
                  <td className="text-right text-gray-400">{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    gray: 'text-gray-200',
  }
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>
    </div>
  )
}
