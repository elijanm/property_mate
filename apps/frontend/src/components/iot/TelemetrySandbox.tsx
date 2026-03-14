/**
 * TelemetrySandbox — animated demo charts using simulated telemetry.
 * Mirrors the data structure from the device simulator shell script:
 *   { ts, temperature, humidity, battery, uptime, water_level, water_usage }
 */
import { useEffect, useRef, useState } from 'react'

interface TelemetryPoint {
  ts: number
  temperature: number
  humidity: number
  battery: number
  uptime: number
  water_level: number
  water_usage: number
}

const MAX_POINTS = 30

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function generateNext(prev?: TelemetryPoint): TelemetryPoint {
  const now = Date.now()
  const temp  = prev ? Math.max(18, Math.min(38, prev.temperature + rand(-0.8, 0.8))) : rand(22, 28)
  const hum   = prev ? Math.max(30, Math.min(95, prev.humidity    + rand(-1.5, 1.5))) : rand(50, 70)
  const bat   = prev ? Math.max(10, Math.min(100, prev.battery    + rand(-0.3, 0.1))) : rand(72, 98)
  const wl    = prev ? Math.max(5,  Math.min(100, prev.water_level + rand(-1.2, 1.2))) : rand(40, 80)
  const wu    = prev ? prev.water_usage + rand(0, 2.5) : rand(0, 20)
  const up    = prev ? prev.uptime + 5 : rand(100, 3600)
  return { ts: now, temperature: temp, humidity: hum, battery: bat, uptime: up, water_level: wl, water_usage: wu }
}

// ── Sparkline SVG ──────────────────────────────────────────────────────────────
function Sparkline({ values, color, min, max, fill }: {
  values: number[]; color: string; min: number; max: number; fill?: string
}) {
  if (values.length < 2) return null
  const W = 200; const H = 52
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - min) / range) * (H - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const polyline = pts.join(' ')
  const areaPath = `M${pts[0]} ${pts.slice(1).map(p => `L${p}`).join(' ')} L${W},${H} L0,${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      {fill && <path d={areaPath} fill={fill} opacity="0.15" />}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      {/* last point dot */}
      {values.length > 0 && (() => {
        const last = pts[pts.length - 1].split(',')
        return <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
      })()}
    </svg>
  )
}

// ── Arc gauge (tank / battery) ─────────────────────────────────────────────────
function ArcGauge({ pct, color, label, sublabel }: {
  pct: number; color: string; label: string; sublabel?: string
}) {
  const r = 36; const cx = 50; const cy = 52
  const startAngle = -210
  const totalArc   = 240          // degrees
  const circumference = (totalArc / 360) * 2 * Math.PI * r
  const offset = circumference - (pct / 100) * circumference
  const toRad = (deg: number) => (deg * Math.PI) / 180
  // arc endpoints
  const sx = cx + r * Math.cos(toRad(startAngle))
  const sy = cy + r * Math.sin(toRad(startAngle))
  const ex = cx + r * Math.cos(toRad(startAngle + totalArc))
  const ey = cy + r * Math.sin(toRad(startAngle + totalArc))
  const arcPath = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`
  return (
    <svg viewBox="0 0 100 80" className="w-20 h-16">
      <path d={arcPath} fill="none" stroke="#e5e7eb" strokeWidth="7" strokeLinecap="round" />
      <path d={arcPath} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="#111827">
        {label}
      </text>
      {sublabel && (
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#6b7280">{sublabel}</text>
      )}
    </svg>
  )
}

// ── Mini bar chart (water usage) ───────────────────────────────────────────────
function MiniBarChart({ data }: { data: { ts: number; value: number }[] }) {
  if (data.length < 2) return null
  const W = 200; const H = 48
  const max = Math.max(...data.map(d => d.value), 1)
  const barW = W / data.length - 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      {data.map((d, i) => {
        const barH = (d.value / max) * (H - 4)
        const x = i * (barW + 2)
        return (
          <rect key={i} x={x} y={H - barH - 2} width={barW} height={barH}
            rx="1" fill="#3b82f6" opacity={0.4 + (i / data.length) * 0.6}
            style={{ transition: 'height 0.5s ease, y 0.5s ease' }}
          />
        )
      })}
    </svg>
  )
}

// ── Metric card ────────────────────────────────────────────────────────────────
function MetricCard({ title, value, unit, sub, chart, accent = '#3b82f6' }: {
  title: string; value: string; unit?: string; sub?: string
  chart?: React.ReactNode; accent?: string
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{title}</p>
      <div className="flex items-end justify-between mt-1">
        <div>
          <span className="text-2xl font-bold text-gray-900" style={{ color: accent }}>{value}</span>
          {unit && <span className="text-xs text-gray-400 ml-1">{unit}</span>}
          {sub  && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
      {chart && <div className="mt-2 h-12">{chart}</div>}
    </div>
  )
}

function fmtUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(seconds % 60)}s`
}

// ── Main component ─────────────────────────────────────────────────────────────
export function TelemetrySandbox() {
  const [series, setSeries] = useState<TelemetryPoint[]>(() => {
    const seed = generateNext()
    return Array.from({ length: 10 }, (_, i) => generateNext(i === 0 ? seed : undefined))
  })
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setSeries(prev => {
        const next = generateNext(prev[prev.length - 1])
        return [...prev.slice(-MAX_POINTS + 1), next]
      })
    }, 2000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  const latest = series[series.length - 1]
  if (!latest) return null

  const temps  = series.map(s => s.temperature)
  const hums   = series.map(s => s.humidity)
  const bats   = series.map(s => s.battery)
  const wls    = series.map(s => s.water_level)
  const wuData = series.slice(-12).map(s => ({ ts: s.ts, value: s.water_usage }))

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Sandbox Preview</p>
          <p className="text-xs text-gray-400 mt-0.5">Simulated data — mirrors the device test script</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-1 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
          Simulated · 2s tick
        </span>
      </div>

      {/* Timestamp */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100 text-[10px] font-mono text-gray-500">
        <span className="text-gray-400">ts</span>
        <span className="flex-1">{new Date(latest.ts).toLocaleString()}</span>
        <span className="text-gray-300">·</span>
        <span>seq #{series.length}</span>
      </div>

      {/* Temperature + Humidity */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          title="Temperature"
          value={latest.temperature.toFixed(1)}
          unit="°C"
          accent={latest.temperature > 30 ? '#ef4444' : latest.temperature < 20 ? '#3b82f6' : '#f59e0b'}
          chart={<Sparkline values={temps} color={latest.temperature > 30 ? '#ef4444' : '#f59e0b'} fill="#f59e0b" min={15} max={40} />}
        />
        <MetricCard
          title="Humidity"
          value={latest.humidity.toFixed(0)}
          unit="%"
          accent="#06b6d4"
          chart={<Sparkline values={hums} color="#06b6d4" fill="#06b6d4" min={20} max={100} />}
        />
      </div>

      {/* Water Level + Water Usage */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">Water</p>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center flex-shrink-0">
            <ArcGauge
              pct={latest.water_level}
              color={latest.water_level < 20 ? '#ef4444' : latest.water_level < 40 ? '#f59e0b' : '#06b6d4'}
              label={`${latest.water_level.toFixed(0)}%`}
              sublabel="Tank Level"
            />
            <p className="text-[10px] text-gray-400 -mt-1">
              {latest.water_level < 20 ? '⚠ Low' : latest.water_level < 40 ? 'Medium' : 'OK'}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-end justify-between mb-1">
              <span className="text-[10px] text-gray-400 font-medium">Tank trend</span>
              <span className="text-xs font-bold text-cyan-700">{latest.water_usage.toFixed(1)} L used</span>
            </div>
            <div className="h-8">
              <Sparkline values={wls} color="#06b6d4" fill="#06b6d4" min={0} max={100} />
            </div>
            <div className="mt-1 h-8">
              <MiniBarChart data={wuData} />
            </div>
          </div>
        </div>
      </div>

      {/* Battery + Uptime */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Battery</p>
          <div className="flex items-center gap-3">
            <ArcGauge
              pct={latest.battery}
              color={latest.battery < 20 ? '#ef4444' : latest.battery < 40 ? '#f59e0b' : '#22c55e'}
              label={`${latest.battery.toFixed(0)}%`}
            />
          </div>
          <div className="mt-1 h-8">
            <Sparkline values={bats} color={latest.battery < 40 ? '#f59e0b' : '#22c55e'} min={0} max={100} />
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Uptime</p>
          <p className="text-xl font-bold text-gray-900 mt-2">{fmtUptime(latest.uptime)}</p>
          <p className="text-[10px] text-gray-400 mt-1">{latest.uptime.toFixed(0)}s total</p>
          <div className="mt-2 flex gap-0.5">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-full bg-emerald-400"
                style={{ opacity: 0.3 + (i / 10) * 0.7, transition: 'opacity 0.5s' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
