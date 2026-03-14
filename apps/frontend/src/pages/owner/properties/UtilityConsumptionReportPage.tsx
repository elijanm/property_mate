import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/reports'
import type { UtilityConsumptionData, UtilityConsumptionRow, UtilityPeriodReading, MeterPricingTier } from '@/types/reports'
import { extractApiError } from '@/utils/apiError'

// ── helpers ───────────────────────────────────────────────────────────────────

const UTILITY_META: Record<string, { label: string; icon: string; unit: string; color: string; bg: string; bar: string }> = {
  water:       { label: 'Water',       icon: '💧', unit: 'm³',  color: 'text-blue-600',   bg: 'bg-blue-50',   bar: 'bg-blue-500'   },
  electricity: { label: 'Electricity', icon: '⚡', unit: 'kWh', color: 'text-amber-600',  bg: 'bg-amber-50',  bar: 'bg-amber-500'  },
  gas:         { label: 'Gas',         icon: '🔥', unit: 'm³',  color: 'text-orange-600', bg: 'bg-orange-50', bar: 'bg-orange-500' },
  internet:    { label: 'Internet',    icon: '🌐', unit: 'GB',  color: 'text-purple-600', bg: 'bg-purple-50', bar: 'bg-purple-500' },
}

function meta(key: string) {
  return UTILITY_META[key] ?? { label: key, icon: '🔌', unit: 'units', color: 'text-slate-600', bg: 'bg-slate-50', bar: 'bg-slate-500' }
}

function fmtConsumption(v: number, key: string) {
  const u = meta(key).unit
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${u}`
}

function fmtMoney(v: number) {
  return `KSh ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ── Pricing display ───────────────────────────────────────────────────────────

function PricingInline({ isTiered, tiers, unitPrice, effectiveRate, unit }: {
  isTiered: boolean
  tiers: MeterPricingTier[] | null
  unitPrice: number
  effectiveRate: number
  unit: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopupPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX })
    }
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  if (!isTiered || !tiers) {
    return <span className="text-xs text-slate-500">KSh {unitPrice}/{unit}</span>
  }
  return (
    <div>
      <button
        ref={btnRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Tiered
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className="text-[10px] text-slate-400 mt-0.5">eff. KSh {effectiveRate.toFixed(2)}/{unit}</div>
      {open && createPortal(
        <div
          style={{ position: 'absolute', top: popupPos.top, left: popupPos.left, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl p-2 min-w-[180px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tier Schedule</p>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-500">{t.from_units}–{t.to_units !== null ? t.to_units : '∞'} {unit}</span>
              <span className="font-medium text-indigo-700">KSh {t.rate}/{unit}</span>
            </div>
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex justify-between text-xs">
            <span className="text-slate-400">Effective rate</span>
            <span className="font-semibold text-slate-700">KSh {effectiveRate.toFixed(2)}/{unit}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Trend sparkline ───────────────────────────────────────────────────────────

function Sparkline({ periods, ukey }: { periods: { billing_month: string; consumption: number }[]; ukey: string }) {
  if (periods.length < 2) return <span className="text-xs text-slate-300">—</span>
  const vals = periods.map(p => p.consumption)
  const max = Math.max(...vals, 0.001)
  const W = 80, H = 24, pad = 2
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v / max) * (H - pad * 2))
    return `${x},${y}`
  }).join(' ')
  const { bar } = meta(ukey)
  const strokeColor = bar.replace('bg-', '')
    .replace('blue-500', '#3b82f6')
    .replace('amber-500', '#f59e0b')
    .replace('orange-500', '#f97316')
    .replace('purple-500', '#a855f7')
    .replace('slate-500', '#64748b')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline
        points={pts}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last dot */}
      {vals.length > 0 && (() => {
        const last = vals[vals.length - 1]
        const x = W - pad
        const y = H - pad - ((last / max) * (H - pad * 2))
        return <circle cx={x} cy={y} r="2" fill={strokeColor} />
      })()}
    </svg>
  )
}

// ── Heatmap grid ──────────────────────────────────────────────────────────────

function HeatmapGrid({ rows, ukey, periods }: {
  rows: UtilityConsumptionRow[]
  ukey: string
  periods: string[]
}) {
  const unitRows = rows.filter(r => r.utility_key === ukey).slice(0, 30)
  if (unitRows.length === 0 || periods.length === 0) {
    return <p className="text-xs text-slate-400 py-4 text-center">No data for this utility.</p>
  }

  // Build lookup: unit_id → month → consumption
  const lookup: Record<string, Record<string, number>> = {}
  for (const row of unitRows) {
    lookup[row.unit_id] = {}
    for (const p of row.periods) {
      lookup[row.unit_id][p.billing_month] = p.consumption
    }
  }

  // Max consumption for color scale
  const allVals = unitRows.flatMap(r => r.periods.map(p => p.consumption))
  const maxVal = Math.max(...allVals, 0.001)

  const { bar, color } = meta(ukey)
  const barBase = bar.replace('bg-', '')

  function cellOpacity(v: number | undefined) {
    if (v === undefined || v === 0) return 0
    return Math.max(0.1, v / maxVal)
  }

  // Translate bar class to hex
  const hexMap: Record<string, string> = {
    'blue-500': '#3b82f6', 'amber-500': '#f59e0b',
    'orange-500': '#f97316', 'purple-500': '#a855f7', 'slate-500': '#64748b',
  }
  const hex = hexMap[barBase] ?? '#64748b'

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="pr-3 pb-1 text-left font-medium text-slate-500 whitespace-nowrap w-20">Unit</th>
            {periods.map(m => (
              <th key={m} className="pb-1 font-medium text-slate-400 text-center" style={{ minWidth: 36 }}>
                {m.slice(2)}
              </th>
            ))}
            <th className="pl-2 pb-1 text-right font-medium text-slate-500 whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {unitRows.map(row => (
            <tr key={row.unit_id}>
              <td className="pr-3 py-0.5 font-mono text-slate-700 whitespace-nowrap">{row.unit_code}</td>
              {periods.map(m => {
                const v = lookup[row.unit_id]?.[m]
                const opacity = cellOpacity(v)
                return (
                  <td key={m} className="py-0.5 px-0.5" title={v !== undefined ? `${v} ${meta(ukey).unit}` : '—'}>
                    <div
                      className="w-8 h-5 rounded-sm flex items-center justify-center text-[9px] font-medium"
                      style={{ backgroundColor: v ? `${hex}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` : '#f1f5f9', color: opacity > 0.5 ? '#fff' : '#64748b' }}
                    >
                      {v !== undefined ? (v < 100 ? v.toFixed(1) : Math.round(v)) : ''}
                    </div>
                  </td>
                )
              })}
              <td className={`pl-2 py-0.5 text-right font-semibold ${color}`}>
                {row.total_consumption.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewMode = 'overview' | 'heatmap' | 'table'

export default function UtilityConsumptionReportPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<UtilityConsumptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('overview')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true); setError(null)
    try {
      const d = await reportsApi.getUtilityConsumption(propertyId)
      setData(d)
      if (d.utility_keys.length > 0) setActiveKey(d.utility_keys[0])
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const exportReport = async (fmt: 'csv' | 'tsv') => {
    if (!propertyId) return
    setExporting(true)
    try {
      const blob = await reportsApi.exportUtilityConsumption(propertyId, fmt)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `utility_consumption_${propertyId}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading utility data…</div>
  )
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-red-500 text-sm">{error}</p>
      <button onClick={load} className="text-sm text-blue-600 hover:underline">Retry</button>
    </div>
  )
  if (!data) return null

  const { summary, by_utility, by_period, rows, utility_keys } = data
  const periods = by_period.map(p => p.billing_month)

  const tableRows = activeKey ? rows.filter(r => r.utility_key === activeKey) : rows
  const maxConsumption = tableRows.length > 0 ? Math.max(...tableRows.map(r => r.total_consumption), 0.001) : 0.001

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Utility Consumption Report</h1>
              <p className="text-xs text-slate-400">{data.property_name} · Generated {data.generated_at.slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['overview', 'heatmap', 'table'] as ViewMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m === 'overview' ? 'Overview' : m === 'heatmap' ? 'Heatmap' : 'Table'}
                </button>
              ))}
            </div>

            <button onClick={load} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" title="Refresh">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-3.36M20 15a9 9 0 01-14.13 3.36" />
              </svg>
            </button>

            <div className="relative group">
              <button
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              <div className="absolute right-0 top-full mt-1 w-28 bg-white rounded-lg shadow-lg border border-slate-200 py-1 hidden group-hover:block z-10">
                <button onClick={() => exportReport('csv')} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">CSV (Excel)</button>
                <button onClick={() => exportReport('tsv')} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">TSV</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* No metered data state */}
        {utility_keys.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-slate-600 font-medium">No metered utility readings found.</p>
            <p className="text-sm text-slate-400 mt-1">
              Readings appear once invoices with confirmed metered utility line items exist.
            </p>
          </div>
        ) : (
          <>
            {/* Summary cards — one per utility */}
            <div className={`grid gap-4 ${utility_keys.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
              {by_utility.map(bu => {
                const m = meta(bu.utility_key)
                return (
                  <div key={bu.utility_key} className={`rounded-xl border border-slate-200 p-5 ${m.bg}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{m.icon}</span>
                      <span className={`text-xs font-semibold uppercase tracking-wide ${m.color}`}>{m.label}</span>
                    </div>
                    <p className={`text-2xl font-bold ${m.color}`}>
                      {bu.total_consumption.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      <span className="text-sm font-normal ml-1">{m.unit}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{fmtMoney(bu.total_amount)} billed · {bu.unit_count} units</p>
                  </div>
                )
              })}

              {/* Global card */}
              <div className="rounded-xl border border-slate-200 p-5 bg-white">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Readings</p>
                <p className="text-2xl font-bold text-slate-800 mt-1">{summary.total_readings}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {summary.metered_unit_count} units · {summary.period_count} periods
                </p>
              </div>
            </div>

            {/* Utility tab selector (for heatmap + table) */}
            {(view === 'heatmap' || view === 'table') && (
              <div className="flex gap-2 flex-wrap">
                {utility_keys.map(k => {
                  const m = meta(k)
                  const isActive = activeKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setActiveKey(k)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        isActive
                          ? `${m.bar} text-white border-transparent`
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{m.icon}</span> {m.label}
                    </button>
                  )
                })}
                {view === 'table' && (
                  <button
                    onClick={() => setActiveKey(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      activeKey === null ? 'bg-slate-800 text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    All utilities
                  </button>
                )}
              </div>
            )}

            {view === 'overview' && (
              <div className="space-y-6">
                {/* Period trend chart */}
                {periods.length > 1 && (
                  <div className="bg-white rounded-xl border border-slate-200 p-5">
                    <h2 className="text-sm font-semibold text-slate-700 mb-4">Consumption Trend by Period</h2>
                    <PeriodTrendChart by_period={by_period} utility_keys={utility_keys} />
                  </div>
                )}

                {/* Top consumers per utility */}
                {utility_keys.map(k => {
                  const m = meta(k)
                  const keyRows = rows.filter(r => r.utility_key === k)
                    .sort((a, b) => b.total_consumption - a.total_consumption)
                    .slice(0, 10)
                  const maxC = keyRows[0]?.total_consumption ?? 1
                  return (
                    <div key={k} className="bg-white rounded-xl border border-slate-200 p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-lg">{m.icon}</span>
                        <h2 className="text-sm font-semibold text-slate-700">{m.label} — Top Consumers</h2>
                        <span className={`ml-auto text-xs ${m.color}`}>{m.unit}</span>
                      </div>
                      <div className="space-y-2">
                        {keyRows.map(row => (
                          <div key={row.unit_id} className="flex items-center gap-3">
                            <span className="w-16 text-xs font-mono text-slate-600 text-right shrink-0">{row.unit_code}</span>
                            <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${m.bar} rounded-full`}
                                style={{ width: `${(row.total_consumption / maxC) * 100}%` }}
                              />
                            </div>
                            <span className={`w-20 text-xs font-medium text-right ${m.color}`}>
                              {fmtConsumption(row.total_consumption, k)}
                            </span>
                            <span className="w-16 text-xs text-slate-400 text-right">
                              {fmtMoney(row.total_amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {view === 'heatmap' && activeKey && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{meta(activeKey).icon}</span>
                  <h2 className="text-sm font-semibold text-slate-700">{meta(activeKey).label} — Monthly Consumption Heatmap</h2>
                </div>
                <p className="text-xs text-slate-400 mb-4">Darker cells = higher consumption. Values in {meta(activeKey).unit}.</p>
                <HeatmapGrid rows={rows} ukey={activeKey} periods={periods} />
              </div>
            )}

            {view === 'table' && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="px-4 py-3 text-left font-medium">Unit</th>
                        <th className="px-4 py-3 text-left font-medium">Wing / Floor</th>
                        <th className="px-4 py-3 text-left font-medium">Utility</th>
                        <th className="px-4 py-3 text-left font-medium">Consumption</th>
                        <th className="px-4 py-3 text-left font-medium">Avg / Month</th>
                        <th className="px-4 py-3 text-left font-medium">Pricing</th>
                        <th className="px-4 py-3 text-left font-medium">Trend</th>
                        <th className="px-4 py-3 text-right font-medium">Total Billed</th>
                        <th className="px-4 py-3 text-left font-medium">Last Reading</th>
                        <th className="px-4 py-3 text-left font-medium">Periods</th>
                        <th className="px-4 py-3 text-left font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-10 text-center text-slate-400 text-sm">No data for selected utility.</td>
                        </tr>
                      ) : tableRows.map(row => {
                        const m = meta(row.utility_key)
                        const isExpanded = expandedUnit === `${row.unit_id}:${row.utility_key}`
                        const pct = (row.total_consumption / maxConsumption) * 100
                        return (
                          <>
                            <tr
                              key={`${row.unit_id}:${row.utility_key}`}
                              className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => setExpandedUnit(isExpanded ? null : `${row.unit_id}:${row.utility_key}`)}
                            >
                              <td className="px-4 py-3 font-mono font-medium text-slate-800">{row.unit_code}</td>
                              <td className="px-4 py-3 text-slate-500">{row.wing} · F{row.floor}</td>
                              <td className="px-4 py-3">
                                <span className={`flex items-center gap-1 text-xs font-medium ${m.color}`}>
                                  <span>{m.icon}</span> {m.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${m.bar} rounded-full`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className={`text-xs font-medium ${m.color}`}>{fmtConsumption(row.total_consumption, row.utility_key)}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{fmtConsumption(row.avg_monthly_consumption, row.utility_key)}</td>
                              <td className="px-4 py-3">
                                <PricingInline
                                  isTiered={row.is_tiered}
                                  tiers={row.periods.find(p => p.is_tiered && p.tiers)?.tiers ?? null}
                                  unitPrice={row.periods[row.periods.length - 1]?.unit_price ?? 0}
                                  effectiveRate={row.effective_rate}
                                  unit={meta(row.utility_key).unit}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Sparkline periods={row.periods} ukey={row.utility_key} />
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700 font-medium">{fmtMoney(row.total_amount)}</td>
                              <td className="px-4 py-3 text-slate-500 text-xs">
                                {row.last_reading !== null ? `${row.last_reading} ${m.unit}` : '—'}
                              </td>
                              <td className="px-4 py-3 text-slate-400 text-xs">{row.num_periods} mo</td>
                              <td className="px-4 py-3 text-slate-300">
                                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${row.unit_id}:${row.utility_key}:expanded`} className="bg-slate-50 border-b border-slate-100">
                                <td colSpan={10} className="px-8 py-3">
                                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Monthly breakdown</p>
                                  <div className="flex flex-wrap gap-3">
                                    {row.periods.map((p: UtilityPeriodReading) => (
                                      <div key={p.billing_month} className={`rounded-lg border px-3 py-2 ${m.bg} border-transparent`}>
                                        <p className="text-xs text-slate-500 font-medium">{p.billing_month}</p>
                                        <p className={`text-sm font-bold ${m.color}`}>{fmtConsumption(p.consumption, row.utility_key)}</p>
                                        {p.previous_reading !== null && p.current_reading !== null && (
                                          <p className="text-[10px] text-slate-400">{p.previous_reading} → {p.current_reading}</p>
                                        )}
                                        <p className="text-[10px] text-slate-400">
                                          {p.is_tiered
                                            ? `Tiered · eff. KSh ${p.effective_rate.toFixed(2)}/${m.unit}`
                                            : `KSh ${p.unit_price}/${m.unit}`}
                                        </p>
                                        <p className="text-[10px] text-slate-400">{fmtMoney(p.amount)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Period trend chart (SVG polylines) ────────────────────────────────────────

function PeriodTrendChart({ by_period, utility_keys }: {
  by_period: UtilityConsumptionData['by_period']
  utility_keys: string[]
}) {
  const W = 600, H = 180, padL = 50, padR = 20, padT = 10, padB = 30

  const allVals = by_period.flatMap(p =>
    utility_keys.map(k => p.utilities[k]?.consumption ?? 0)
  )
  const maxVal = Math.max(...allVals, 0.001)

  const xScale = (i: number) => padL + (i / Math.max(by_period.length - 1, 1)) * (W - padL - padR)
  const yScale = (v: number) => padT + (1 - v / maxVal) * (H - padT - padB)

  const hexMap: Record<string, string> = {
    water: '#3b82f6', electricity: '#f59e0b', gas: '#f97316', internet: '#a855f7',
  }

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="min-w-full">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = yScale(t * maxVal)
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {(t * maxVal).toFixed(t === 0 ? 0 : 1)}
              </text>
            </g>
          )
        })}

        {/* X labels */}
        {by_period.map((p, i) => (
          <text key={p.billing_month} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {p.billing_month.slice(2)}
          </text>
        ))}

        {/* Lines */}
        {utility_keys.map(k => {
          const color = hexMap[k] ?? '#64748b'
          const pts = by_period.map((p, i) => {
            const v = p.utilities[k]?.consumption ?? 0
            return `${xScale(i)},${yScale(v)}`
          }).join(' ')
          return (
            <g key={k}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {by_period.map((p, i) => {
                const v = p.utilities[k]?.consumption ?? 0
                if (v === 0) return null
                return <circle key={i} cx={xScale(i)} cy={yScale(v)} r="3" fill={color} />
              })}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 flex-wrap">
        {utility_keys.map(k => {
          const m = meta(k)
          const color = hexMap[k] ?? '#64748b'
          return (
            <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-4 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
              {m.icon} {m.label} ({m.unit})
            </span>
          )
        })}
      </div>
    </div>
  )
}
