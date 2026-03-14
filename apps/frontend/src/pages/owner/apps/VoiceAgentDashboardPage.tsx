import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { appsApi } from '@/api/apps'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import type {
  ApiCallRecord,
  CallMetrics,
  CallSession,
  InstalledApp,
  LLMProvider,
  TTSProvider,
  VoiceAgentConfig,
  VoiceAgentMetrics,
  VoiceOption,
} from '@/types/apps'

type Tab = 'overview' | 'live' | 'history' | 'config' | 'sandbox'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(sec: number | null | undefined): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  transferred: 'bg-violet-100 text-violet-700',
  failed:      'bg-red-100 text-red-700',
  abandoned:   'bg-gray-100 text-gray-500',
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'text-green-600',
  neutral:  'text-gray-500',
  negative: 'text-red-600',
}

const SENTIMENT_ICONS: Record<string, string> = {
  positive: '😊',
  neutral:  '😐',
  negative: '😠',
}

function QualityBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null
  const color = score >= 80 ? 'bg-green-100 text-green-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>Q:{score}</span>
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Metrics Panel ─────────────────────────────────────────────────────────────

function MetricsPanel({ metrics }: { metrics: CallMetrics }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Cost & Usage</p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <p className="text-xs text-gray-400">LLM Tokens</p>
          <p className="text-sm font-bold text-gray-900">{metrics.total_tokens.toLocaleString()}</p>
          <p className="text-xs text-gray-400">{metrics.prompt_tokens}in / {metrics.completion_tokens}out</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400">TTS Chars</p>
          <p className="text-sm font-bold text-gray-900">{metrics.tts_characters.toLocaleString()}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400">STT Minutes</p>
          <p className="text-sm font-bold text-gray-900">{metrics.stt_minutes}</p>
        </div>
      </div>
      <div className="border-t border-gray-200 pt-2 flex items-center justify-between text-xs text-gray-500">
        <span>LLM ${metrics.llm_cost_usd.toFixed(4)}</span>
        <span>TTS ${metrics.tts_cost_usd.toFixed(4)}</span>
        <span>STT ${metrics.stt_cost_usd.toFixed(4)}</span>
        <span className="font-semibold text-gray-800">Total ${metrics.total_cost_usd.toFixed(4)}</span>
      </div>
    </div>
  )
}

// ── Recording Player ───────────────────────────────────────────────────────────

function RecordingPlayer({ sessionId }: { sessionId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    appsApi.getRecordingUrl(sessionId)
      .then((r) => setUrl(r.url))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) return <div className="text-xs text-gray-400 py-2">Loading recording…</div>
  if (error || !url) return null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Call Recording</p>
      <audio
        controls
        src={url}
        className="w-full h-10 rounded-lg"
        style={{ accentColor: '#7c3aed' }}
      />
    </div>
  )
}

// ── Call Detail Slide-Over ────────────────────────────────────────────────────

function ApiAuditPanel({ calls }: { calls: ApiCallRecord[] }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  if (calls.length === 0) {
    return <p className="text-xs text-gray-400 italic">No API calls recorded for this session.</p>
  }
  return (
    <div className="space-y-2">
      {calls.map((c, i) => {
        const isExpanded = expanded === i
        const statusColor = c.status_code == null
          ? 'text-gray-400'
          : c.status_code < 300 ? 'text-green-600' : 'text-red-600'
        return (
          <div key={i} className="bg-gray-50 rounded-lg border border-gray-100 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : i)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 transition-colors"
            >
              <span className="text-xs font-mono font-bold text-gray-500 w-12 shrink-0">{c.method}</span>
              <span className={`text-xs font-mono font-semibold ${statusColor} w-10 shrink-0`}>
                {c.status_code ?? '—'}
              </span>
              <span className="text-xs font-mono text-gray-700 flex-1 truncate">{c.url}</span>
              <span className="text-xs text-gray-400 shrink-0">{c.duration_ms != null ? `${c.duration_ms}ms` : ''}</span>
              <span className="text-gray-400 ml-1">{isExpanded ? '▲' : '▼'}</span>
            </button>
            {isExpanded && (
              <div className="border-t border-gray-100 px-3 py-2 space-y-2 text-xs font-mono bg-white">
                {c.payload != null && (
                  <div>
                    <p className="text-gray-400 font-sans mb-1">Request payload</p>
                    <pre className="whitespace-pre-wrap break-all text-gray-700 bg-gray-50 rounded p-2 max-h-40 overflow-y-auto">
                      {JSON.stringify(c.payload, null, 2)}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="text-gray-400 font-sans mb-1">Response</p>
                  <pre className="whitespace-pre-wrap break-all text-gray-700 bg-gray-50 rounded p-2 max-h-40 overflow-y-auto">
                    {JSON.stringify(c.response, null, 2)}
                  </pre>
                </div>
                <p className="text-gray-400 font-sans">{c.timestamp}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type DetailTab = 'overview' | 'tool-calls' | 'api-audit'

function CallDetailSlideOver({ session, onClose, showAudit }: { session: CallSession; onClose: () => void; showAudit: boolean }) {
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tool-calls', label: 'Tool Calls', count: session.tool_calls.length },
    ...(showAudit ? [{ id: 'api-audit' as DetailTab, label: 'API Audit', count: (session.api_calls ?? []).length }] : []),
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{session.caller_number}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {session.tenant_name ?? 'Unknown caller'} · {fmtDuration(session.duration_seconds)} · {fmtTime(session.started_at)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 px-6 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setDetailTab(t.id)}
              className={[
                'flex items-center gap-1.5 px-1 py-3 mr-6 text-sm font-medium border-b-2 transition-colors',
                detailTab === t.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${detailTab === t.id ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Overview ─────────────────────────────────────────────────── */}
          {detailTab === 'overview' && (
            <>
              {/* Summary + sentiment */}
              {session.summary && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Summary</p>
                    {session.sentiment && (
                      <span className={`text-sm ${SENTIMENT_COLORS[session.sentiment] ?? ''}`}>
                        {SENTIMENT_ICONS[session.sentiment] ?? ''} {session.sentiment}
                      </span>
                    )}
                    <QualityBadge score={session.quality_score} />
                  </div>
                  <p className="text-sm text-gray-700">{session.summary}</p>
                </div>
              )}

              {/* Cost metrics */}
              {session.metrics && <MetricsPanel metrics={session.metrics} />}

              {/* Call recording */}
              {session.recording_key && <RecordingPlayer sessionId={session.id} />}

              {/* Keyword alerts */}
              {(session.keyword_alerts ?? []).length > 0 && (
                <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">⚠ Keyword Alerts</p>
                  <div className="space-y-1">
                    {(session.keyword_alerts ?? []).map((alert, i) => (
                      <div key={i} className="text-xs text-red-700">
                        <span className="font-semibold">{alert.keyword}</span> — <span className="text-red-500">{alert.context.slice(0, 100)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions taken */}
              {session.actions_taken.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Actions Taken</p>
                  <div className="space-y-1">
                    {session.actions_taken.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="text-green-500">✓</span> {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transcript */}
              {session.transcript.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Transcript</p>
                  <div className="space-y-3">
                    {session.transcript.map((turn) => (
                      <div
                        key={turn.id}
                        className={`flex ${turn.role === 'user' ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={[
                            'max-w-[80%] rounded-xl px-4 py-2.5 text-sm',
                            turn.role === 'user'
                              ? 'bg-gray-100 text-gray-900'
                              : turn.role === 'assistant'
                              ? 'bg-violet-600 text-white'
                              : 'bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono',
                          ].join(' ')}
                        >
                          {turn.role === 'tool' && <span className="font-semibold">🔧 Tool: </span>}
                          {turn.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!session.summary && !session.metrics && session.transcript.length === 0 && (
                <p className="text-sm text-gray-400 italic">No data available yet — call may still be active.</p>
              )}
            </>
          )}

          {/* ── Tool Calls ───────────────────────────────────────────────── */}
          {detailTab === 'tool-calls' && (
            <>
              {session.tool_calls.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No tool calls recorded for this session.</p>
              ) : (
                <div className="space-y-3">
                  {session.tool_calls.map((tc) => (
                    <div key={tc.id} className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-100">
                        <span className="text-base">🔧</span>
                        <span className="text-sm font-semibold text-gray-800">{tc.name}()</span>
                        {tc.error && <span className="ml-auto text-xs text-red-600 font-medium">error</span>}
                        <span className="ml-auto text-xs text-gray-400">{fmtTime(tc.timestamp)}</span>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Arguments</p>
                            <pre className="text-xs font-mono text-gray-700 bg-white rounded p-2 border border-gray-100 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                              {JSON.stringify(tc.arguments, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Result</p>
                          <pre className="text-xs font-mono text-gray-700 bg-white rounded p-2 border border-gray-100 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {JSON.stringify(tc.result, null, 2)}
                          </pre>
                        </div>
                        {tc.error && (
                          <p className="text-xs text-red-600 bg-red-50 rounded p-2">{tc.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── API Audit ────────────────────────────────────────────────── */}
          {detailTab === 'api-audit' && showAudit && (
            <ApiAuditPanel calls={session.api_calls ?? []} />
          )}

        </div>
      </div>
    </>
  )
}

// ── Config Form ───────────────────────────────────────────────────────────────

const OPENAI_VOICES: VoiceOption[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
]

const DEEPGRAM_VOICES: VoiceOption[] = [
  { id: 'aura-asteria-en', name: 'Asteria (EN)' },
  { id: 'aura-luna-en', name: 'Luna (EN)' },
  { id: 'aura-stella-en', name: 'Stella (EN)' },
  { id: 'aura-athena-en', name: 'Athena (EN)' },
  { id: 'aura-hera-en', name: 'Hera (EN)' },
  { id: 'aura-orion-en', name: 'Orion (EN)' },
  { id: 'aura-arcas-en', name: 'Arcas (EN)' },
  { id: 'aura-orpheus-en', name: 'Orpheus (EN)' },
  { id: 'aura-zeus-en', name: 'Zeus (EN)' },
]

function ConfigTab({ app, onSaved }: { app: InstalledApp; onSaved: (updated: InstalledApp) => void }) {
  const cfg = app.config as VoiceAgentConfig
  const [form, setForm] = useState<VoiceAgentConfig>({ ...cfg })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)

  const set = (key: keyof VoiceAgentConfig, value: unknown) =>
    setForm((p) => ({ ...p, [key]: value }))

  // Load voice list whenever tts_provider or elevenlabs_api_key changes
  useEffect(() => {
    const provider = form.tts_provider
    if (provider === 'openai') { setVoices(OPENAI_VOICES); return }
    if (provider === 'deepgram') { setVoices(DEEPGRAM_VOICES); return }
    // elevenlabs — fetch from API (needs saved key)
    setVoices([])
    if (!form.elevenlabs_api_key) return
    let cancelled = false
    setLoadingVoices(true)
    appsApi.listVoices('elevenlabs')
      .then((r) => { if (!cancelled) setVoices(r.voices) })
      .catch(() => { /* ignore — user can type voice id manually */ })
      .finally(() => { if (!cancelled) setLoadingVoices(false) })
    return () => { cancelled = true }
  }, [form.tts_provider, form.elevenlabs_api_key])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await appsApi.updateConfig('voice-agent', form)
      onSaved(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900'
  const sel = inp + ' bg-white'

  return (
    <div className="max-w-2xl space-y-6">
      {/* Identity */}
      {([
        { label: 'Company Name', key: 'company_name' as const, ph: 'Acme Properties' },
        { label: 'Agent Name', key: 'agent_name' as const, ph: 'Alex' },
        { label: 'Phone Number (Telnyx DID)', key: 'phone_number' as const, ph: '+254722000000' },
      ] as { label: string; key: keyof VoiceAgentConfig; ph: string }[]).map(({ label, key, ph }) => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
          <input
            type="text"
            className={inp}
            value={String(form[key] ?? '')}
            onChange={(e) => set(key, e.target.value)}
            placeholder={ph}
          />
        </div>
      ))}

      {/* ── LLM ── */}
      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Language Model</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LLM Provider</label>
            <select
              className={sel}
              value={form.llm_provider || 'openai'}
              onChange={(e) => set('llm_provider', e.target.value as LLMProvider)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai_compatible">OpenAI-Compatible (Ollama, Groq…)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
            <input
              type="text"
              className={inp}
              value={String(form.llm_model ?? '')}
              onChange={(e) => set('llm_model', e.target.value)}
              placeholder={form.llm_provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o'}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LLM API Key</label>
            <input
              type="password"
              className={inp}
              value={String(form.llm_api_key ?? '')}
              onChange={(e) => set('llm_api_key', e.target.value)}
              placeholder="••••"
            />
          </div>
          {form.llm_provider === 'openai_compatible' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
              <input
                type="text"
                className={inp}
                value={String(form.llm_base_url ?? '')}
                onChange={(e) => set('llm_base_url', e.target.value)}
                placeholder="http://ollama:11434/v1"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── TTS ── */}
      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Text-to-Speech</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TTS Provider</label>
            <select
              className={sel}
              value={form.tts_provider || 'openai'}
              onChange={(e) => {
                const p = e.target.value as TTSProvider
                set('tts_provider', p)
                set('tts_voice', '')  // reset voice when provider changes
              }}
            >
              <option value="openai">OpenAI TTS</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="deepgram">Deepgram Aura</option>
            </select>
          </div>

          {/* Voice selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Voice
              {loadingVoices && <span className="ml-2 text-xs text-gray-400">Loading…</span>}
            </label>
            {voices.length > 0 ? (
              <select
                className={sel}
                value={form.tts_voice || ''}
                onChange={(e) => set('tts_voice', e.target.value)}
              >
                <option value="">— Select voice —</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className={inp}
                value={String(form.tts_voice ?? '')}
                onChange={(e) => set('tts_voice', e.target.value)}
                placeholder={
                  form.tts_provider === 'elevenlabs'
                    ? 'Save ElevenLabs API key first to load voices'
                    : form.tts_provider === 'deepgram'
                    ? 'aura-asteria-en'
                    : 'alloy'
                }
              />
            )}
          </div>

          {/* ElevenLabs API key */}
          {form.tts_provider === 'elevenlabs' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ElevenLabs API Key</label>
              <input
                type="password"
                className={inp}
                value={String(form.elevenlabs_api_key ?? '')}
                onChange={(e) => set('elevenlabs_api_key', e.target.value)}
                placeholder="••••"
              />
            </div>
          )}

          {/* Deepgram API key (used for both STT and TTS when deepgram provider) */}
          {form.tts_provider === 'deepgram' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deepgram API Key (STT + TTS)</label>
              <input
                type="password"
                className={inp}
                value={String(form.deepgram_api_key ?? '')}
                onChange={(e) => set('deepgram_api_key', e.target.value)}
                placeholder="••••"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── STT ── */}
      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Speech Recognition (STT)</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Deepgram API Key</label>
          <input
            type="password"
            className={inp}
            value={String(form.deepgram_api_key ?? '')}
            onChange={(e) => set('deepgram_api_key', e.target.value)}
            placeholder="••••"
          />
          <p className="text-xs text-gray-400 mt-1">Deepgram is used for speech-to-text on all calls.</p>
        </div>
      </div>

      {/* ── Behaviour ── */}
      <div className="border-t border-gray-100 pt-5 flex items-center gap-8">
        {([
          { key: 'auto_mode' as const, label: 'Auto mode (AI answers)' },
          { key: 'recording_enabled' as const, label: 'Call recording' },
          { key: 'sandbox_enabled' as const, label: 'Sandbox enabled' },
        ] as { key: keyof VoiceAgentConfig; label: string }[]).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!form[key]}
              onChange={(e) => set(key, e.target.checked)}
              className="w-4 h-4 accent-gray-900"
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="px-6 py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Configuration'}
      </button>
    </div>
  )
}

// ── Sandbox Tab ───────────────────────────────────────────────────────────────

// AudioWorklet processor code — runs off the main thread
const MIC_WORKLET = `
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = []
    this._len = 0
    this._target = 1280 // 80 ms at 16 kHz
  }
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    this._buf.push(new Float32Array(ch))
    this._len += ch.length
    if (this._len >= this._target) {
      const out = new Float32Array(this._len)
      let off = 0
      for (const b of this._buf) { out.set(b, off); off += b.length }
      this._buf = []
      this._len = 0
      const i16 = new Int16Array(out.length)
      for (let i = 0; i < out.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, out[i] * 32767 | 0))
      this.port.postMessage(i16.buffer, [i16.buffer])
    }
    return true
  }
}
registerProcessor('mic-processor', MicProcessor)
`

function SandboxTab() {
  const voiceAgentUrl = (import.meta.env.VITE_VOICE_AGENT_URL as string) || 'ws://localhost:8010'
  const [phone, setPhone] = useState('')
  const [orgId, setOrgId] = useState('')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'ended'>('idle')

  // Pre-fill phone and org_id from the logged-in user's profile
  useEffect(() => {
    import('@/api/auth').then(({ authApi }) =>
      authApi.me().then((me) => {
        if (me.phone && !phone) setPhone(me.phone)
        if (me.org_id) setOrgId(me.org_id)
      }).catch(() => { /* ignore — phone stays empty */ })
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [tenantName, setTenantName] = useState<string | null>(null)
  const [balanceDue, setBalanceDue] = useState<number | null>(null)
  const [callControlId, setCallControlId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const playbackTimeRef = useRef(0)
  const mutedRef = useRef(false)

  const SAMPLE_RATE = 16000

  function cleanup() {
    workletRef.current?.disconnect()
    workletRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    playbackTimeRef.current = 0
  }

  async function startCall() {
    setError(null)
    setTenantName(null)
    setBalanceDue(null)
    setCallControlId(null)
    setMuted(false)
    mutedRef.current = false
    setStatus('connecting')

    let stream: MediaStream
    try {
      // Echo cancellation prevents the microphone from picking up the AI's voice
      // through the speakers, which would cause the VAD to constantly interrupt the AI.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch {
      setError('Microphone access denied. Please allow microphone in browser settings.')
      setStatus('idle')
      return
    }
    streamRef.current = stream

    const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
    audioCtxRef.current = audioCtx
    playbackTimeRef.current = audioCtx.currentTime

    // Load AudioWorklet
    try {
      const blob = new Blob([MIC_WORKLET], { type: 'application/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      await audioCtx.audioWorklet.addModule(blobUrl)
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      setError('AudioWorklet not supported in this browser.')
      setStatus('idle')
      stream.getTracks().forEach((t) => t.stop())
      audioCtx.close()
      return
    }

    const wsUrl = `${voiceAgentUrl}/ws/browser-call?phone=${encodeURIComponent(phone)}${orgId ? `&org_id=${encodeURIComponent(orgId)}` : ''}`
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      setError(`Cannot connect to voice agent at ${voiceAgentUrl}. Check VITE_VOICE_AGENT_URL.`)
      setStatus('idle')
      stream.getTracks().forEach((t) => t.stop())
      audioCtx.close()
      return
    }
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')

      const source = audioCtx.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(audioCtx, 'mic-processor')
      workletRef.current = worklet

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState === WebSocket.OPEN && !mutedRef.current) {
          ws.send(e.data)
        }
      }

      source.connect(worklet)
      worklet.connect(audioCtx.destination)
    }

    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) {
        try {
          const msg = JSON.parse(e.data as string)
          if (msg.call_control_id) setCallControlId(msg.call_control_id)
          if (msg.tenant_name) setTenantName(msg.tenant_name)
          if (msg.balance_due != null) setBalanceDue(msg.balance_due)
        } catch { /* ignore */ }
        return
      }
      // Binary PCM from TTS — queue for gapless playback
      const int16 = new Int16Array(e.data)
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
      const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE)
      buffer.copyToChannel(float32, 0)
      const src = audioCtx.createBufferSource()
      src.buffer = buffer
      src.connect(audioCtx.destination)
      const startAt = Math.max(playbackTimeRef.current, audioCtx.currentTime)
      src.start(startAt)
      playbackTimeRef.current = startAt + buffer.duration
    }

    ws.onclose = (e) => {
      const reason = e.reason ? ` — ${e.reason}` : e.code !== 1000 ? ` (code ${e.code})` : ''
      if (e.code !== 1000 && e.code !== 1005) {
        setError(`Call disconnected${reason}. Check voice agent logs.`)
      }
      setStatus('ended')
      cleanup()
    }

    ws.onerror = () => {
      setError(`Cannot reach voice agent at ${voiceAgentUrl}. Make sure the service is running and VITE_VOICE_AGENT_URL is set correctly.`)
      setStatus('idle')
      cleanup()
    }
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
  }

  function endCall() {
    // Call hangup API first so the server-side pipeline stops via EndFrame
    // (more reliable than waiting for the server to detect the WS close).
    const ccid = callControlId
    if (ccid) {
      appsApi.hangupCall(ccid).catch(() => { /* server may already be done */ })
    }
    wsRef.current?.close(1000, 'User ended call')
    cleanup()
    setStatus('ended')
  }

  const cleanupRef = useRef(cleanup)
  cleanupRef.current = cleanup
  useEffect(() => () => cleanupRef.current(), [])

  return (
    <div className="max-w-xl space-y-5">
      <div className="rounded-xl bg-violet-50 border border-violet-200 p-4 text-sm text-violet-800">
        <p className="font-semibold mb-1">📞 Browser Call Sandbox</p>
        <p>Speak directly to your AI agent from the browser. Enter a tenant's phone number to test the full agent experience — the agent will greet them by name and have their account context.</p>
      </div>

      {status === 'idle' || status === 'ended' ? (
        <div className="space-y-4">
          {status === 'ended' && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600">
              Call ended.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Caller Phone Number
            </label>
            <input
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254722000000"
            />
            <p className="text-xs text-gray-500 mt-1">
              Enter a phone number registered to a tenant to hear the agent greet them by name.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={startCall}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
            </svg>
            Start Call
          </button>
        </div>
      ) : status === 'connecting' ? (
        <div className="flex items-center gap-3 py-8">
          <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600">Connecting to voice agent…</span>
        </div>
      ) : (
        /* Connected — live call UI */
        <div className="space-y-4">
          <div className="rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-6 text-center shadow-lg">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </div>
            <p className="font-bold text-lg">Live Call</p>
            {tenantName ? (
              <div className="mt-1 space-y-0.5">
                <p className="text-white/90 text-sm font-medium">{tenantName}</p>
                {balanceDue != null && (
                  <p className={`text-xs font-semibold ${balanceDue > 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {balanceDue > 0 ? `KSh ${balanceDue.toLocaleString()} outstanding` : 'Account clear'}
                  </p>
                )}
              </div>
            ) : phone ? (
              <p className="text-white/70 text-sm mt-1">{phone} · Unknown caller</p>
            ) : null}
            <div className="flex justify-center gap-1 mt-3">
              {[1,2,3].map((i) => (
                <div
                  key={i}
                  className="w-1.5 bg-white/60 rounded-full animate-pulse"
                  style={{ height: `${8 + i * 4}px`, animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={toggleMute}
              className={[
                'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
                muted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
              title={muted ? 'Unmute' : 'Mute'}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                {muted
                  ? <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                  : <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28C16.28 17.23 19 14.41 19 11h-1.7z"/>
                }
              </svg>
            </button>

            <button
              onClick={endCall}
              className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors"
              title="End call"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Live Calls Monitor ────────────────────────────────────────────────────────

function LiveCallsTab({ onSelect }: { onSelect: (session: CallSession) => void }) {
  const [activeCalls, setActiveCalls] = useState<CallSession[]>([])
  const [loading, setLoading] = useState(true)
  const [hangingUp, setHangingUp] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const data = await appsApi.listCalls({ status: 'active', page_size: 50 })
      setActiveCalls(data.items)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh])

  async function handleHangup(e: React.MouseEvent, c: CallSession) {
    e.stopPropagation()
    if (hangingUp.has(c.call_control_id)) return
    setHangingUp((prev) => new Set(prev).add(c.call_control_id))
    try {
      await appsApi.hangupCall(c.call_control_id)
      // Remove from list optimistically; will be confirmed on next refresh
      setActiveCalls((prev) => prev.filter((x) => x.id !== c.id))
    } catch { /* ignore — call may have already ended */ }
    finally {
      setHangingUp((prev) => { const s = new Set(prev); s.delete(c.call_control_id); return s })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-gray-400">
        <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
        Loading active calls…
      </div>
    )
  }

  if (activeCalls.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-3">📵</p>
        <p className="text-sm text-gray-500">No active calls right now.</p>
        <p className="text-xs text-gray-400 mt-1">This page refreshes every 5 seconds.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-700">{activeCalls.length} active call{activeCalls.length > 1 ? 's' : ''}</p>
        <button onClick={refresh} className="text-xs text-violet-600 hover:underline">↻ Refresh</button>
      </div>
      {activeCalls.map((c) => (
        <div
          key={c.id}
          className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4 hover:shadow-sm transition-shadow cursor-pointer"
          onClick={() => onSelect(c)}
        >
          {/* Pulsing dot */}
          <div className="mt-1 relative flex-shrink-0">
            <span className="block w-3 h-3 bg-red-500 rounded-full" />
            <span className="block w-3 h-3 bg-red-400 rounded-full absolute inset-0 animate-ping" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">{c.tenant_name ?? c.caller_number}</p>
              {c.tenant_name && <p className="text-xs text-gray-400 font-mono">{c.caller_number}</p>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Started {fmtTime(c.started_at)}</p>
            {c.actions_taken.length > 0 && (
              <p className="text-xs text-violet-600 mt-1">✓ {c.actions_taken[c.actions_taken.length - 1]}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">live</span>
              {c.auto_mode && <span className="text-xs text-gray-400">🤖 AI</span>}
            </div>
            <button
              onClick={(e) => handleHangup(e, c)}
              disabled={hangingUp.has(c.call_control_id)}
              title="End call"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
            >
              {hangingUp.has(c.call_control_id) ? (
                <span className="w-3 h-3 border border-red-500 border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                </svg>
              )}
              End
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VoiceAgentDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgProfile } = useOrgProfile()
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'overview'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [app, setApp] = useState<InstalledApp | null>(null)
  const [metrics, setMetrics] = useState<VoiceAgentMetrics | null>(null)
  const [calls, setCalls] = useState<CallSession[]>([])
  const [callsTotal, setCallsTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedCall, setSelectedCall] = useState<CallSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [appData, metricsData, callsData] = await Promise.all([
        appsApi.get('voice-agent'),
        appsApi.getMetrics(),
        appsApi.listCalls({ page, page_size: 20 }),
      ])
      setApp(appData)
      setMetrics(metricsData)
      setCalls(callsData.items)
      setCallsTotal(callsData.total)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  const cfg = app?.config as VoiceAgentConfig | undefined

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-600 underline">
          ← Back
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md">
              <span className="text-2xl">🤖</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Customer Agent</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  app?.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {app?.status ?? 'unknown'}
                </span>
                {cfg?.phone_number && (
                  <span className="text-xs text-gray-500 font-mono">{cfg.phone_number}</span>
                )}
                {cfg?.auto_mode !== undefined && (
                  <span className="text-xs text-gray-400">
                    · {cfg.auto_mode ? '🤖 Auto mode' : '💬 Manual mode'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            ← Back
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {(['overview', 'live', 'history', 'config', 'sandbox'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-5 py-3 text-sm font-medium capitalize border-b-2 transition-colors',
                tab === t
                  ? 'border-violet-600 text-violet-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {t === 'overview' ? '📊 Overview' : t === 'live' ? '🔴 Live Calls' : t === 'history' ? '📞 Call History' : t === 'config' ? '⚙ Configuration' : '🧪 Sandbox'}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {tab === 'overview' && metrics && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              <StatCard label="Total Calls" value={metrics.total_calls} icon="📞" />
              <StatCard label="Answered" value={metrics.answered_calls} sub={`${metrics.total_calls > 0 ? Math.round((metrics.answered_calls / metrics.total_calls) * 100) : 0}% answer rate`} icon="✅" />
              <StatCard label="Avg Duration" value={fmtDuration(metrics.avg_duration_seconds)} icon="⏱" />
              <StatCard label="Unique Callers" value={metrics.unique_callers} icon="👤" />
              <StatCard label="Transferred" value={metrics.transferred_calls} sub="to human agent" icon="↗" />
              <StatCard label="Tickets Created" value={metrics.tickets_created} icon="🎫" />
              <StatCard label="Payment Links" value={metrics.payment_links_sent} sub="sent via email" icon="💳" />
              <StatCard label="Success Rate" value={`${metrics.total_calls > 0 ? Math.round(((metrics.total_calls - metrics.transferred_calls) / metrics.total_calls) * 100) : 0}%`} sub="resolved without transfer" icon="🎯" />
            </div>

            {/* Calls by day chart (simple bar) */}
            {metrics.calls_by_day.length > 0 && (() => {
              const max = Math.max(...metrics.calls_by_day.map((d) => d.count), 1)
              const BAR_MAX_PX = 72  // leave ~24px for labels within the h-24 (96px) container
              return (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm font-semibold text-gray-700 mb-1">Calls per Day</p>
                  <div className="flex items-end gap-[3px] h-24 mt-2">
                    {metrics.calls_by_day.map(({ date, count }) => {
                      const barPx = Math.max(4, Math.round((count / max) * BAR_MAX_PX))
                      return (
                        <div key={date} className="flex-1 flex flex-col items-center gap-1 group">
                          <div
                            className="w-full bg-violet-300 group-hover:bg-violet-500 rounded-t transition-colors cursor-default"
                            style={{ height: barPx }}
                            title={`${date}: ${count} call${count !== 1 ? 's' : ''}`}
                          />
                          <p className="text-[8px] text-gray-400 rotate-45 origin-left w-5 truncate leading-none">{date.slice(5)}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Recent calls */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Recent Calls</p>
                <button onClick={() => setTab('history')} className="text-xs text-violet-600 hover:underline">View all →</button>
              </div>
              <div className="divide-y divide-gray-100">
                {calls.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCall(c)}
                    className="w-full px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.caller_number}</p>
                      <p className="text-xs text-gray-500 truncate">{c.tenant_name ?? 'Unknown'} · {fmtTime(c.started_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.status}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{fmtDuration(c.duration_seconds)}</span>
                  </button>
                ))}
                {calls.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-8">No calls yet. Make a test call to your Telnyx number.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── History ── */}
        {tab === 'history' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3">Caller</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Quality</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCall(c)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{c.caller_number}</td>
                    <td className="px-4 py-3 text-gray-600">{c.tenant_name ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtTime(c.started_at)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <QualityBadge score={c.quality_score} />
                        {c.sentiment && (
                          <span className={`text-sm ${SENTIMENT_COLORS[c.sentiment] ?? ''}`} title={c.sentiment}>
                            {SENTIMENT_ICONS[c.sentiment] ?? ''}
                          </span>
                        )}
                        {(c.keyword_alerts ?? []).length > 0 && (
                          <span title={`${(c.keyword_alerts ?? []).length} keyword alert(s)`} className="text-xs text-red-500">⚠</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {c.actions_taken.length > 0 ? c.actions_taken[0] : '—'}
                    </td>
                  </tr>
                ))}
                {calls.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-sm text-gray-400 py-12">No call history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {callsTotal > 20 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span>Page {page} of {Math.ceil(callsTotal / 20)}</span>
                <div className="flex gap-2">
                  <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">←</button>
                  <button disabled={page * 20 >= callsTotal} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">→</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Live ── */}
        {tab === 'live' && (
          <LiveCallsTab onSelect={setSelectedCall} />
        )}

        {/* ── Config ── */}
        {tab === 'config' && app && (
          <ConfigTab app={app} onSaved={setApp} />
        )}

        {/* ── Sandbox ── */}
        {tab === 'sandbox' && <SandboxTab />}
      </div>

      {selectedCall && (
        <CallDetailSlideOver
          session={selectedCall}
          onClose={() => setSelectedCall(null)}
          showAudit={
            (user?.role === 'owner' || user?.role === 'superadmin') &&
            (orgProfile?.voice_api_audit_enabled ?? true)
          }
        />
      )}
    </>
  )
}
