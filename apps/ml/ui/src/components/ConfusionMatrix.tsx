import type { ConfusionMatrix as CM, OcrMetrics } from '@/types/feedback'
import OcrMetricsPanel from './OcrMetricsPanel'

interface Props { data: CM }

export default function ConfusionMatrix({ data }: Props) {
  // High-cardinality / OCR model — render specialised metrics panel
  if (data.mode === 'ocr') {
    const ocr: OcrMetrics = {
      total: data.total,
      exact_match: data.exact_match ?? 0,
      exact_match_rate: data.exact_match_rate ?? 0,
      char_error_rate: data.char_error_rate ?? 0,
      digit_accuracy: data.digit_accuracy ?? 0,
      off_by: data.off_by ?? { exact: 0, '1': 0, '2_to_10': 0, '11_to_100': 0, over_100: 0 },
      common_errors: data.common_errors ?? [],
    }
    return <OcrMetricsPanel data={ocr} />
  }

  if (!data.labels.length) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No labeled feedback yet — submit predictions with actual labels to build the matrix.
      </div>
    )
  }

  const max = Math.max(...data.matrix.flat(), 1)

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Accuracy" value={`${(data.accuracy * 100).toFixed(1)}%`} color="emerald" />
        <Stat label="Correct" value={data.correct.toString()} color="blue" />
        <Stat label="Total Feedback" value={data.total.toString()} color="purple" />
      </div>

      {/* Matrix */}
      <div>
        <p className="text-xs text-gray-500 mb-3">Rows = Actual · Columns = Predicted</p>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="w-20 text-gray-500 text-right pr-2 pb-1">actual ↓ / pred →</th>
                {data.labels.map(l => (
                  <th key={l} className="w-14 text-center pb-1 text-gray-400 font-medium">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((row, ri) => (
                <tr key={ri}>
                  <td className="text-right pr-2 py-0.5 text-gray-400 font-medium">{data.labels[ri]}</td>
                  {row.map((val, ci) => {
                    const intensity = val / max
                    const isDiag = ri === ci
                    return (
                      <td key={ci} className="w-14 h-10 text-center align-middle"
                        style={{ background: isDiag
                          ? `rgba(16,185,129,${0.15 + intensity * 0.6})`
                          : val > 0 ? `rgba(239,68,68,${0.1 + intensity * 0.5})` : 'transparent'
                        }}
                      >
                        <span className={isDiag ? 'text-emerald-300 font-bold' : val > 0 ? 'text-red-300' : 'text-gray-600'}>
                          {val}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-label metrics */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Per-Label Metrics</h4>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-1 pr-4">Label</th>
              <th className="text-right py-1 pr-4">Precision</th>
              <th className="text-right py-1 pr-4">Recall</th>
              <th className="text-right py-1 pr-4">F1</th>
              <th className="text-right py-1">Support</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.per_label).map(([label, m]) => (
              <tr key={label} className="border-b border-gray-900 hover:bg-gray-900/50">
                <td className="py-1.5 pr-4 font-medium text-gray-300">{label}</td>
                <td className="text-right pr-4 text-blue-400">{(m.precision * 100).toFixed(1)}%</td>
                <td className="text-right pr-4 text-purple-400">{(m.recall * 100).toFixed(1)}%</td>
                <td className="text-right pr-4 text-emerald-400">{(m.f1 * 100).toFixed(1)}%</td>
                <td className="text-right text-gray-400">{m.support}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  }
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
