import { useState, useEffect, useCallback } from 'react'
import { adminApi, type AnalyticsData, type BroadcastPayload } from '@/api/admin'
import {
  Users, Cpu, DollarSign, BarChart2, Zap, Activity,
  RefreshCw, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  Server, Brain, Mail, Send, Eye, ChevronDown, ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'

// ── Email templates ────────────────────────────────────────────────────────────
const TEMPLATES: { id: string; name: string; subject: string; html: string; raw?: boolean }[] = [
  {
    id: 'welcome-beta',
    name: '🚀 Welcome to the Beta',
    subject: "You're early — MLDock.io Beta is live",
    html: `<h2 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#ffffff;">You're one of the first.</h2>
<p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.7;">
  MLDock.io is now in <strong style="color:#f59e0b;">open beta</strong> — and you have early access.
  Train ML models on cloud GPUs, deploy REST APIs in seconds, and monitor them in production.
  All from one platform, with local payment support.
</p>
<div style="background:#0f172a;border:1px solid #1e3a5f;border-radius:12px;padding:20px;margin-bottom:24px;">
  <p style="margin:0 0 8px;font-size:12px;color:#38bdf8;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">What you can do right now</p>
  <ul style="margin:0;padding-left:18px;font-size:13px;color:#cbd5e1;line-height:2;">
    <li>Upload a Python trainer plugin</li>
    <li>Run your first training job — free (10 hrs/month)</li>
    <li>Deploy your model as a REST API</li>
    <li>Monitor latency, drift, and A/B tests</li>
  </ul>
</div>
<div style="text-align:center;">
  <a href="https://mldock.io" style="display:inline-block;background:#0ea5e9;color:#ffffff;font-size:14px;font-weight:700;padding:13px 36px;border-radius:10px;text-decoration:none;">
    Go to MLDock.io →
  </a>
</div>`,
  },
  {
    id: 'gpu-promo',
    name: '⚡ Cloud GPU — Try it now',
    subject: 'Your models deserve faster hardware',
    html: `<h2 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#ffffff;">Train faster. Pay only for what you use.</h2>
<p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.7;">
  Local training is great for prototyping — but when you need results fast, cloud GPU changes everything.
  MLDock.io lets you switch from local to GPU with a single click, using the same trainer code.
</p>
<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
  <div style="flex:1;min-width:140px;background:#111;border:1px solid #1e293b;border-radius:10px;padding:16px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#a78bfa;">RTX 3090</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">24 GB VRAM</div>
    <div style="font-size:16px;font-weight:700;color:#ffffff;margin-top:8px;">from $0.28<span style="font-size:11px;color:#6b7280;font-weight:400;">/hr</span></div>
  </div>
  <div style="flex:1;min-width:140px;background:#111;border:1px solid #1e293b;border-radius:10px;padding:16px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#34d399;">A100</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">80 GB VRAM</div>
    <div style="font-size:16px;font-weight:700;color:#ffffff;margin-top:8px;">from $1.89<span style="font-size:11px;color:#6b7280;font-weight:400;">/hr</span></div>
  </div>
</div>
<p style="margin:0 0 24px;font-size:13px;color:#6b7280;line-height:1.6;">
  No subscription. No upfront commitment. Top up your wallet with local payment methods and go.
</p>
<div style="text-align:center;">
  <a href="https://mldock.io" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:700;padding:13px 36px;border-radius:10px;text-decoration:none;">
    Try Cloud GPU →
  </a>
</div>`,
  },
  {
    id: 'africa-pitch',
    name: '🌍 Built for African teams',
    subject: 'ML infrastructure that actually works for Africa',
    html: `<h2 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#ffffff;">Global ML infrastructure.<br>African-friendly payments.</h2>
<p style="margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.7;">
  Most ML platforms require an international credit card and USD billing — locking out the majority of African engineering teams.
  MLDock.io was built specifically to fix that.
</p>
<div style="background:#0f2311;border:1px solid #166534;border-radius:12px;padding:20px;margin-bottom:24px;">
  <p style="margin:0 0 10px;font-size:12px;color:#4ade80;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">What's different about MLDock</p>
  <ul style="margin:0;padding-left:18px;font-size:13px;color:#d1fae5;line-height:2;">
    <li>Local payment methods — no USD card required</li>
    <li>Pre-fund your wallet — no surprise charges</li>
    <li>Same GPUs as any global team</li>
    <li>Your models, your data — 100% ownership</li>
    <li>Free local training tier — 10 hrs/month</li>
  </ul>
</div>
<p style="margin:0 0 24px;font-size:13px;color:#9ca3af;line-height:1.6;">
  We believe African teams should have access to the same ML infrastructure as anyone in Silicon Valley.
  That's why we built MLDock.io — by a Kenyan team, for the continent.
</p>
<div style="text-align:center;">
  <a href="https://mldock.io" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:14px;font-weight:700;padding:13px 36px;border-radius:10px;text-decoration:none;">
    Start for free →
  </a>
</div>`,
  },
  {
    id: 'open-beta-full',
    name: '🎯 Open Beta — Full Template',
    subject: "You're one of the first to access MLDock.io",
    raw: true,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;padding:0;background:#0b1120;font-family:Arial,Helvetica,sans-serif;}
    .wrap{width:100%;background:#0b1120;padding:28px 16px;box-sizing:border-box;}
    .card{max-width:600px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;width:100%;box-sizing:border-box;}
    .hdr{padding:28px 24px 20px;background:linear-gradient(180deg,#0f172a 0%,#111827 100%);border-bottom:1px solid #1f2937;}
    .hdr h1{margin:0 0 12px;font-size:24px;line-height:1.25;color:#fff;font-weight:800;}
    .body{padding:24px 24px 8px;}
    .body h2{margin:0 0 10px;font-size:18px;line-height:1.3;color:#fff;font-weight:800;}
    .highlight{margin:0 24px;background:#0f172a;border:1px solid #1e3a5f;border-radius:12px;padding:16px 18px;}
    .feats{padding:20px 24px 0;}
    .feats h3{margin:0 0 12px;font-size:15px;color:#fff;font-weight:700;}
    .feat{margin:0 0 8px;font-size:14px;line-height:1.7;color:#cbd5e1;}
    .cta{padding:24px 24px 8px;text-align:center;}
    .cta a{display:inline-block;background:#0ea5e9;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:12px;}
    .note{padding:8px 24px 20px;text-align:center;}
    .foot{padding:16px 24px 20px;border-top:1px solid #1f2937;text-align:center;}
    @media only screen and (max-width:480px){
      .wrap{padding:16px 10px;}
      .hdr{padding:20px 16px 16px;}
      .hdr h1{font-size:20px;}
      .body{padding:16px 16px 6px;}
      .highlight{margin:0 16px;}
      .feats,.cta,.note,.foot{padding-left:16px;padding-right:16px;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hdr">
        <p style="margin:0 0 8px;font-size:11px;color:#38bdf8;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Open Beta Access</p>
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#ffffff;font-weight:800;">You're one of the first to access MLDock.io</h1>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#ffffff;">Train on cloud GPUs, deploy production-ready APIs, and monitor models in one place — with local payment support built for African teams.</p>
      </div>
      <div class="body">
        <h2>Still managing ML through notebooks, scripts, and guesswork?</h2>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.8;color:#9ca3af;">If your models are only visible to developers, it's hard to know why predictions fail or which version should be live.</p>
        <p style="margin:0;font-size:14px;line-height:1.8;color:#9ca3af;">MLDock.io gives you visibility across the full lifecycle: compare model versions, run A/B tests, monitor production behavior, and train visual AI workloads like OCR, detection, and segmentation.</p>
      </div>
      <div class="highlight" style="margin-top:20px;">
        <p style="margin:0 0 6px;font-size:11px;color:#f59e0b;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Why teams use MLDock.io</p>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#dbeafe;">One platform to train, deploy, compare, and monitor models — instead of stitching together scripts, servers, and dashboards.</p>
      </div>
      <div class="feats">
        <h3>What you can do right now</h3>
        <p class="feat">&#x2022; Upload a Python trainer plugin</p>
        <p class="feat">&#x2022; Run your first training job free &#x2014; 10 GPU hours per month</p>
        <p class="feat">&#x2022; Deploy your trained model as a REST API</p>
        <p class="feat" style="margin-bottom:0;">&#x2022; Monitor latency, drift, and live A/B tests</p>
      </div>
      <div class="cta">
        <a href="https://mldock.io">Launch MLDock.io &#x2192;</a>
      </div>
      <div class="note">
        <p style="margin:0;font-size:12px;line-height:1.7;color:#64748b;">Open beta is live now. No international credit card required.</p>
      </div>
      <div class="foot">
        <p style="margin:0;font-size:11px;line-height:1.7;color:#64748b;">MLDock.io &#x00B7; Train locally. Deploy globally. &#x00B7; Kreateyou Technologies Ltd, Kenya</p>
      </div>
    </div>
  </div>
</body>
</html>`,
  },
]

// ── Date preset helpers ────────────────────────────────────────────────────────
type Preset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom'

function presetRange(p: Preset): { from: string; to: string } | null {
  if (p === 'all' || p === 'custom') return null
  const now = new Date()
  const from = new Date(now)
  if (p === '24h') from.setHours(now.getHours() - 24)
  else if (p === '7d') from.setDate(now.getDate() - 7)
  else if (p === '30d') from.setDate(now.getDate() - 30)
  else if (p === '90d') from.setDate(now.getDate() - 90)
  return { from: from.toISOString(), to: now.toISOString() }
}

// ── Sub-components ─────────────────────────────────────────────────────────────
interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent?: 'blue' | 'green' | 'amber' | 'red' | 'brand' | 'purple'
}

const ACCENT_MAP = {
  blue:   'text-blue-400 bg-blue-900/20 border-blue-800/30',
  green:  'text-emerald-400 bg-emerald-900/20 border-emerald-800/30',
  amber:  'text-amber-400 bg-amber-900/20 border-amber-800/30',
  red:    'text-red-400 bg-red-900/20 border-red-800/30',
  brand:  'text-brand-400 bg-brand-900/20 border-brand-800/30',
  purple: 'text-violet-400 bg-violet-900/20 border-violet-800/30',
}

function StatCard({ icon, label, value, sub, accent = 'brand' }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={clsx('w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0', ACCENT_MAP[accent])}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold mb-0.5">{label}</div>
        <div className="text-xl font-bold text-white leading-none">{value}</div>
        {sub && <div className="text-[11px] text-gray-600 mt-1">{sub}</div>}
      </div>
    </div>
  )
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400 truncate max-w-[140px]">{label}</span>
        <span className="text-gray-300 font-medium ml-2 flex-shrink-0">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold text-gray-600 uppercase tracking-widest mb-3">{children}</h2>
  )
}

// ── Email Broadcast Panel ─────────────────────────────────────────────────────
function EmailBroadcastPanel() {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id)
  const [subject, setSubject] = useState(TEMPLATES[0].subject)
  const [html, setHtml] = useState(TEMPLATES[0].html)
  const [raw, setRaw] = useState(TEMPLATES[0].raw ?? false)
  const [filter, setFilter] = useState<BroadcastPayload['recipient_filter']>('all')
  const [previewTo, setPreviewTo] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; skipped: number; preview: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find(t => t.id === id)
    if (!t) return
    setTemplateId(id)
    setSubject(t.subject)
    setHtml(t.html)
    setRaw(t.raw ?? false)
    setResult(null)
    setErr('')
  }

  const send = async (preview: boolean) => {
    if (!subject.trim() || !html.trim()) return
    setSending(true); setResult(null); setErr('')
    try {
      const res = await adminApi.broadcast({
        subject, html, recipient_filter: filter, raw,
        preview_to: preview ? (previewTo || undefined) : undefined,
      })
      setResult(res)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Send failed')
    } finally { setSending(false) }
  }

  const FILTERS: { value: BroadcastPayload['recipient_filter']; label: string; desc: string }[] = [
    { value: 'all',       label: 'All users',     desc: 'Everyone with an account' },
    { value: 'verified',  label: 'Verified only',  desc: 'Email-verified accounts' },
    { value: 'engineers', label: 'Engineers + Admins', desc: 'Engineers and admins only' },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Template picker */}
      <div>
        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest block mb-2">Template</label>
        <div className="grid sm:grid-cols-3 gap-2">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t.id)}
              className={clsx(
                'text-left px-3 py-2.5 rounded-xl border text-xs transition-colors',
                templateId === t.id
                  ? 'border-brand-600/70 bg-brand-900/20 text-brand-300'
                  : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              )}>
              <div className="font-semibold mb-0.5">{t.name}</div>
              <div className="text-[10px] opacity-70 truncate">{t.subject}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div>
        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest block mb-2">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500" />
      </div>

      {/* Body HTML */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest">Body HTML</label>
          <button onClick={() => setPreviewOpen(v => !v)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
            <Eye size={11} /> {previewOpen ? 'Hide' : 'Preview'}
            {previewOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
        <textarea value={html} onChange={e => setHtml(e.target.value)} rows={10}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-300 focus:outline-none focus:border-brand-500 resize-y" />
        {previewOpen && (
          <div className="mt-2 border border-gray-700 rounded-xl overflow-hidden bg-[#0a0a0a]">
            <div className="text-[10px] text-gray-600 px-3 py-1.5 border-b border-gray-800">Email preview</div>
            <iframe
              srcDoc={`<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;font-family:sans-serif;padding:24px;">${html}</body></html>`}
              className="w-full h-72 border-0"
              title="Email preview"
            />
          </div>
        )}
      </div>

      {/* Recipient filter */}
      <div>
        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest block mb-2">Recipients</label>
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={clsx(
                'px-3 py-2 rounded-xl border text-xs transition-colors',
                filter === f.value
                  ? 'border-brand-600/70 bg-brand-900/20 text-brand-300'
                  : 'border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-200'
              )}>
              <div className="font-semibold">{f.label}</div>
              <div className="text-[10px] opacity-60">{f.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview + Send */}
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        <div className="flex items-center gap-2 flex-1">
          <input value={previewTo} onChange={e => setPreviewTo(e.target.value)}
            placeholder="preview@example.com"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500" />
          <button onClick={() => send(true)} disabled={sending || !previewTo.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 rounded-xl transition-colors disabled:opacity-40">
            <Eye size={13} /> Preview
          </button>
        </div>
        <button onClick={() => send(false)} disabled={sending}
          className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
          {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
          Send to {filter === 'all' ? 'all users' : filter === 'engineers' ? 'engineers' : 'verified users'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={clsx('flex items-center gap-2 text-sm px-4 py-3 rounded-xl border',
          result.preview
            ? 'bg-blue-900/20 border-blue-800/40 text-blue-300'
            : 'bg-emerald-900/20 border-emerald-800/40 text-emerald-300')}>
          <CheckCircle2 size={14} />
          {result.preview
            ? `Preview sent to ${previewTo}`
            : `Sent to ${result.sent} user${result.sent !== 1 ? 's' : ''}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}`}
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl border bg-red-900/20 border-red-800/40 text-red-400">
          <AlertTriangle size={14} /> {err}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const PRESETS: { id: Preset; label: string }[] = [
  { id: '24h', label: 'Last 24 h' },
  { id: '7d',  label: 'Last 7 d' },
  { id: '30d', label: 'Last 30 d' },
  { id: '90d', label: 'Last 90 d' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

type PageTab = 'analytics' | 'email'

export default function AdminAnalyticsPage() {
  const [pageTab, setPageTab] = useState<PageTab>('analytics')
  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let from: string | undefined
      let to: string | undefined
      if (preset === 'custom') {
        from = customFrom ? new Date(customFrom).toISOString() : undefined
        to = customTo ? new Date(customTo).toISOString() : undefined
      } else {
        const range = presetRange(preset)
        from = range?.from
        to = range?.to
      }
      const result = await adminApi.getAnalytics(from, to)
      setData(result)
    } catch {
      setError('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [preset, customFrom, customTo])

  useEffect(() => {
    if (preset !== 'custom') fetchData()
  }, [preset, fetchData])

  const d = data

  return (
    <div className="space-y-6 max-w-6xl">

      {/* ── Page tabs ── */}
      <div className="flex gap-0.5 border-b border-gray-800">
        {([
          { id: 'analytics' as PageTab, label: 'Analytics', icon: <BarChart2 size={13} /> },
          { id: 'email'     as PageTab, label: 'Email Broadcast', icon: <Mail size={13} /> },
        ]).map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative',
              pageTab === t.id
                ? 'text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500 after:rounded-t'
                : 'text-gray-500 hover:text-gray-300'
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Email tab ── */}
      {pageTab === 'email' && <EmailBroadcastPanel />}

      {/* ── Analytics tab ── */}
      {pageTab === 'analytics' && <>

      {/* ── Header + filters ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Platform Analytics</h1>
          <p className="text-xs text-gray-500 mt-0.5">Aggregated metrics across all organisations</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset pills */}
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-xl p-1 gap-0.5">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => setPreset(p.id)}
                className={clsx(
                  'px-3 py-1 text-xs rounded-lg transition-colors',
                  preset === p.id ? 'bg-brand-600 text-white font-semibold' : 'text-gray-500 hover:text-gray-200'
                )}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500" />
              <span className="text-gray-600 text-xs">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500" />
              <button onClick={fetchData}
                className="px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium transition-colors">
                Apply
              </button>
            </div>
          )}

          <button onClick={fetchData} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !d && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {d && (
        <>
          {/* ── Users ── */}
          <section>
            <SectionTitle>Users</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard icon={<Users size={15} />} label="Total Users" value={d.users.total} accent="brand" />
              <StatCard icon={<CheckCircle2 size={15} />} label="Active" value={d.users.active}
                sub={`${d.users.total > 0 ? Math.round(d.users.active / d.users.total * 100) : 0}% of total`} accent="green" />
              <StatCard icon={<CheckCircle2 size={15} />} label="Verified" value={d.users.verified} accent="blue" />
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2 col-span-2 sm:col-span-1">
                <div className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">By Role</div>
                <MiniBar label="Admin" value={d.users.by_role.admin} max={d.users.total} color="bg-red-500" />
                <MiniBar label="Engineer" value={d.users.by_role.engineer} max={d.users.total} color="bg-brand-500" />
                <MiniBar label="Viewer" value={d.users.by_role.viewer} max={d.users.total} color="bg-gray-500" />
              </div>
            </div>
          </section>

          {/* ── Training ── */}
          <section>
            <SectionTitle>Training Jobs</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard icon={<Brain size={15} />} label="Total Jobs" value={d.training.total_jobs} accent="brand" />
              <StatCard icon={<Zap size={15} />} label="Running Now" value={d.training.running}
                sub={`${d.training.queued} queued`} accent={d.training.running > 0 ? 'green' : 'blue'} />
              <StatCard icon={<CheckCircle2 size={15} />} label="Completed" value={d.training.completed}
                sub={`${d.training.failed} failed`} accent="green" />
              <StatCard icon={<Cpu size={15} />} label="GPU Hours" value={`~${d.training.gpu_hours_estimate.toFixed(1)} h`}
                sub={`${d.training.cloud_jobs} cloud jobs`} accent="purple" />
              <StatCard icon={<Server size={15} />} label="Local Jobs" value={d.training.local_jobs}
                sub={`${d.training.local_hours_purchased.toFixed(1)} hrs purchased`} accent="amber" />
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2 col-span-2 sm:col-span-1">
                <div className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Compute Split</div>
                <MiniBar label="Local" value={d.training.local_jobs} max={d.training.total_jobs} color="bg-amber-500" />
                <MiniBar label="Cloud GPU" value={d.training.cloud_jobs} max={d.training.total_jobs} color="bg-violet-500" />
                <MiniBar label="Failed" value={d.training.failed} max={d.training.total_jobs} color="bg-red-500" />
              </div>
            </div>
          </section>

          {/* ── Revenue ── */}
          <section>
            <SectionTitle>Revenue</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard icon={<DollarSign size={15} />} label="Total Top-ups" value={`$${d.revenue.total_topups_usd.toFixed(2)}`}
                sub="USD deposited" accent="green" />
              <StatCard icon={<TrendingUp size={15} />} label="GPU Revenue" value={`$${d.revenue.gpu_revenue_usd.toFixed(2)}`}
                sub="charged for cloud jobs" accent="brand" />
              <StatCard icon={<DollarSign size={15} />} label="GPU Charges" value={`$${d.revenue.gpu_charges_usd.toFixed(2)}`}
                sub="wallet debits" accent="purple" />
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Revenue Mix</div>
                <MiniBar label="Top-ups" value={d.revenue.total_topups_usd} max={d.revenue.total_topups_usd || 1} color="bg-emerald-500" />
                <MiniBar label="GPU Charges" value={d.revenue.gpu_charges_usd} max={d.revenue.total_topups_usd || 1} color="bg-brand-500" />
              </div>
            </div>
          </section>

          {/* ── Models + Inference ── */}
          <div className="grid sm:grid-cols-2 gap-6">
            <section>
              <SectionTitle>Models</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={<BarChart2 size={15} />} label="Total Deployed" value={d.models.total} accent="brand" />
                <StatCard icon={<CheckCircle2 size={15} />} label="Active" value={d.models.active}
                  sub={`${d.models.total - d.models.active} inactive`} accent="green" />
              </div>
            </section>

            <section>
              <SectionTitle>Inference</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={<Activity size={15} />} label="Total Calls" value={d.inference.total.toLocaleString()} accent="blue" />
                <StatCard icon={<Clock size={15} />} label="Avg Latency" value={`${d.inference.avg_latency_ms.toFixed(0)} ms`}
                  sub={`${d.inference.error_rate_pct}% error rate`} accent={d.inference.error_rate_pct > 5 ? 'red' : 'green'} />
              </div>
            </section>
          </div>

          {/* ── Top Trainers ── */}
          {d.top_trainers.length > 0 && (
            <section>
              <SectionTitle>Top Trainers by Job Count</SectionTitle>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                {d.top_trainers.map(t => (
                  <MiniBar key={t.name} label={t.name} value={t.jobs}
                    max={d.top_trainers[0].jobs} color="bg-brand-500" />
                ))}
              </div>
            </section>
          )}

          {/* ── Period note ── */}
          <p className="text-[11px] text-gray-700">
            {d.period.from
              ? `Period: ${new Date(d.period.from).toLocaleDateString()} – ${d.period.to ? new Date(d.period.to).toLocaleDateString() : 'now'}`
              : 'All-time data'}
            {' · '}GPU hours are estimated from charges at $0.476/hr baseline.
          </p>
        </>
      )}

      </> /* end analytics tab */}
    </div>
  )
}
