import { useState } from 'react'
import { appsApi } from '@/api/apps'
import { extractApiError } from '@/utils/apiError'
import type { InstalledApp, LLMProvider, TTSProvider, VoiceAgentConfig } from '@/types/apps'

interface Props {
  onClose: () => void
  onInstalled: (app: InstalledApp) => void
}

const LLM_MODELS: Record<LLMProvider, string[]> = {
  openai:            ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic:         ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-opus-4-6'],
  openai_compatible: ['llama3.2', 'mistral', 'gemma2', 'phi4', 'custom'],
}

const TTS_VOICES: Record<TTSProvider, Array<{ value: string; label: string }>> = {
  openai:     [
    { value: 'alloy', label: 'Alloy (neutral)' },
    { value: 'echo', label: 'Echo (male)' },
    { value: 'fable', label: 'Fable (british)' },
    { value: 'onyx', label: 'Onyx (deep male)' },
    { value: 'nova', label: 'Nova (female)' },
    { value: 'shimmer', label: 'Shimmer (soft female)' },
  ],
  elevenlabs: [
    { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (female)' },
    { value: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi (young female)' },
    { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (female)' },
    { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni (male)' },
  ],
  deepgram:   [
    { value: 'aura-asteria-en', label: 'Asteria (female)' },
    { value: 'aura-luna-en', label: 'Luna (female)' },
    { value: 'aura-stella-en', label: 'Stella (female)' },
    { value: 'aura-orion-en', label: 'Orion (male)' },
  ],
}

const STEP_LABELS = ['Basic Setup', 'AI & Voice', 'Review & Install']

const DEFAULT_CONFIG: VoiceAgentConfig = {
  phone_number: '',
  agent_name: 'Alex',
  company_name: '',
  llm_provider: 'openai',
  llm_model: 'gpt-4o',
  llm_api_key: '',
  llm_base_url: '',
  tts_provider: 'openai',
  tts_voice: 'alloy',
  elevenlabs_api_key: '',
  deepgram_api_key: '',
  auto_mode: false,
  recording_enabled: true,
  greeting_message: '',
  sandbox_enabled: true,
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={[
              'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
              i < current
                ? 'bg-green-500 text-white'
                : i === current
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-400',
            ].join(' ')}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <span className={`text-xs font-medium ${i === current ? 'text-gray-900' : 'text-gray-400'}`}>
            {STEP_LABELS[i]}
          </span>
          {i < total - 1 && <div className="w-8 h-px bg-gray-200 mx-1" />}
        </div>
      ))}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900'

export default function InstallAppModal({ onClose, onInstalled }: Props) {
  const [step, setStep] = useState(0)
  const [cfg, setCfg] = useState<VoiceAgentConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof VoiceAgentConfig, value: unknown) =>
    setCfg((prev) => ({ ...prev, [key]: value }))

  async function handleInstall() {
    setSaving(true)
    setError(null)
    try {
      const app = await appsApi.install('voice-agent', 'Customer Agent', cfg)
      onInstalled(app)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <span className="text-xl">🤖</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Install Customer Agent</h2>
              <p className="text-xs text-gray-500">AI voice agent powered by Pipecat + Telnyx</p>
            </div>
          </div>
          <StepIndicator current={step} total={3} />
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* ── Step 0: Basic Setup ── */}
          {step === 0 && (
            <>
              <Field label="Company Name" hint="Used in the greeting: 'Thank you for calling __'">
                <input
                  className={inputCls}
                  value={cfg.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                  placeholder="Acme Properties"
                />
              </Field>

              <Field label="Agent Name" hint="The name your AI agent introduces itself as">
                <input
                  className={inputCls}
                  value={cfg.agent_name}
                  onChange={(e) => set('agent_name', e.target.value)}
                  placeholder="Alex"
                />
              </Field>

              <Field label="Telnyx Phone Number" hint="Your purchased Telnyx DID in E.164 format">
                <input
                  className={inputCls}
                  value={cfg.phone_number}
                  onChange={(e) => set('phone_number', e.target.value)}
                  placeholder="+254722000000"
                />
              </Field>

              <Field label="Operation Mode">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      key: false,
                      title: 'Manual',
                      icon: '💬',
                      desc: 'Popup on dashboard when a call comes in — your team answers informed',
                    },
                    {
                      key: true,
                      title: 'Auto',
                      icon: '🤖',
                      desc: 'AI answers every call automatically. Staff can monitor live transcript',
                    },
                  ].map((opt) => (
                    <button
                      key={String(opt.key)}
                      onClick={() => set('auto_mode', opt.key)}
                      className={[
                        'text-left p-4 rounded-xl border-2 transition-all',
                        cfg.auto_mode === opt.key
                          ? 'border-violet-500 bg-violet-50'
                          : 'border-gray-200 hover:border-gray-300',
                      ].join(' ')}
                    >
                      <p className="text-base mb-1">{opt.icon}</p>
                      <p className="text-sm font-semibold text-gray-900">{opt.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </Field>

              <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 border border-gray-200">
                <input
                  type="checkbox"
                  id="rec"
                  checked={cfg.recording_enabled}
                  onChange={(e) => set('recording_enabled', e.target.checked)}
                  className="w-4 h-4 accent-gray-900"
                />
                <div>
                  <label htmlFor="rec" className="text-sm font-medium text-gray-900 cursor-pointer">
                    Enable call recording
                  </label>
                  <p className="text-xs text-gray-500">WAV files saved to S3. Caller is notified at start of call.</p>
                </div>
              </div>
            </>
          )}

          {/* ── Step 1: AI & Voice ── */}
          {step === 1 && (
            <>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Language Model (LLM)</p>
                <div className="space-y-3">
                  <Field label="Provider">
                    <div className="flex gap-2">
                      {(['openai', 'anthropic', 'openai_compatible'] as LLMProvider[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            set('llm_provider', p)
                            set('llm_model', LLM_MODELS[p][0])
                          }}
                          className={[
                            'flex-1 py-2 px-3 text-xs font-semibold rounded-lg border-2 transition-all',
                            cfg.llm_provider === p
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 text-gray-600 hover:border-gray-400',
                          ].join(' ')}
                        >
                          {p === 'openai_compatible' ? 'Custom / Ollama' : p === 'openai' ? 'OpenAI' : 'Anthropic'}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Model">
                    <select
                      className={inputCls}
                      value={cfg.llm_model}
                      onChange={(e) => set('llm_model', e.target.value)}
                    >
                      {LLM_MODELS[cfg.llm_provider].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="API Key">
                    <input
                      type="password"
                      className={inputCls}
                      value={cfg.llm_api_key}
                      onChange={(e) => set('llm_api_key', e.target.value)}
                      placeholder={cfg.llm_provider === 'openai_compatible' ? 'ollama (or leave blank)' : 'sk-...'}
                    />
                  </Field>

                  {cfg.llm_provider === 'openai_compatible' && (
                    <Field label="Base URL" hint="e.g. http://ollama:11434/v1 or Groq/Together API URL">
                      <input
                        className={inputCls}
                        value={cfg.llm_base_url}
                        onChange={(e) => set('llm_base_url', e.target.value)}
                        placeholder="http://ollama:11434/v1"
                      />
                    </Field>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <p className="text-sm font-semibold text-gray-700 mb-3">Text-to-Speech (TTS)</p>
                <div className="space-y-3">
                  <Field label="Provider">
                    <div className="flex gap-2">
                      {(['openai', 'elevenlabs', 'deepgram'] as TTSProvider[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            set('tts_provider', p)
                            set('tts_voice', TTS_VOICES[p][0].value)
                          }}
                          className={[
                            'flex-1 py-2 px-3 text-xs font-semibold rounded-lg border-2 transition-all capitalize',
                            cfg.tts_provider === p
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 text-gray-600 hover:border-gray-400',
                          ].join(' ')}
                        >
                          {p === 'elevenlabs' ? 'ElevenLabs' : p.charAt(0).toUpperCase() + p.slice(1)}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Voice">
                    <select
                      className={inputCls}
                      value={cfg.tts_voice}
                      onChange={(e) => set('tts_voice', e.target.value)}
                    >
                      {TTS_VOICES[cfg.tts_provider].map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                  </Field>

                  {cfg.tts_provider === 'elevenlabs' && (
                    <Field label="ElevenLabs API Key">
                      <input
                        type="password"
                        className={inputCls}
                        value={cfg.elevenlabs_api_key}
                        onChange={(e) => set('elevenlabs_api_key', e.target.value)}
                        placeholder="Your ElevenLabs API key"
                      />
                    </Field>
                  )}

                  {cfg.tts_provider === 'deepgram' && (
                    <Field label="Deepgram API Key" hint="Required for Deepgram Aura TTS">
                      <input
                        type="password"
                        className={inputCls}
                        value={cfg.deepgram_api_key}
                        onChange={(e) => set('deepgram_api_key', e.target.value)}
                        placeholder="Your Deepgram API key"
                      />
                    </Field>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Step 2: Review ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Review your configuration before installing.</p>

              {[
                { label: 'Phone Number', value: cfg.phone_number || '—' },
                { label: 'Agent Name', value: cfg.agent_name },
                { label: 'Company Name', value: cfg.company_name || '—' },
                { label: 'Operation Mode', value: cfg.auto_mode ? 'Auto (AI answers)' : 'Manual (popup for staff)' },
                { label: 'LLM', value: `${cfg.llm_provider} / ${cfg.llm_model}` },
                { label: 'TTS', value: `${cfg.tts_provider} / ${cfg.tts_voice}` },
                { label: 'Recording', value: cfg.recording_enabled ? 'Enabled' : 'Disabled' },
                { label: 'LLM Key', value: cfg.llm_api_key ? '••••' + cfg.llm_api_key.slice(-4) : 'Not set' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-gray-100 text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-900 text-right">{value}</span>
                </div>
              ))}

              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800">
                <p className="font-semibold mb-1">⚠️ Before calls work:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Configure your Telnyx webhook URL to <code className="bg-amber-100 px-1 rounded">POST /webhook/telnyx</code> on the voice-agent service</li>
                  <li>Ensure the voice-agent Docker service is running and publicly reachable</li>
                  <li>Update <code className="bg-amber-100 px-1 rounded">PUBLIC_BASE_URL</code> in voice-agent env to your public URL</li>
                </ol>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between">
          <button
            onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          {step < 2 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-5 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-700"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleInstall}
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Installing…' : '🚀 Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
