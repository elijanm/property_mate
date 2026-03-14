import { useEffect, useRef, useState, useCallback } from 'react'
import SignaturePad from '@/components/SignaturePad'
import { orgApi } from '@/api/org'
import { mfaApi } from '@/api/mfa'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import { extractApiError } from '@/utils/apiError'
import DashboardLayout from '@/layouts/DashboardLayout'
import { LogoUpload, AccountsEditor } from '@/components/OrgFormWidgets'
import AccountRoleMapper from '@/components/AccountRoleMapper'
import MfaSetupModal from '@/components/MfaSetupModal'
import type { AccountEntry, BillingConfig, BusinessDetails, DepositInterestSetting, LedgerSettings, SignatureConfig, TaxConfig, TicketCategoryConfig } from '@/types/org'
import { DEFAULT_ACCOUNTS, DEFAULT_LEDGER_SETTINGS, DEFAULT_TAX_CONFIG } from '@/types/org'
import type { MfaStatus, MfaUserStatus } from '@/types/mfa'
import { CALL_SOUND_KEY, NOTIFICATION_SOUND_KEY, WHATSAPP_SOUND_KEY } from '@/constants/storage'
import { useSound } from '@/hooks/useSound'

type Tab = 'business' | 'ledger' | 'tax' | 'billing' | 'deposit_interest' | 'tickets' | 'signatures' | 'notifications' | 'security' | 'voice' | 'ai'
const TABS: { id: Tab; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'tax', label: 'Tax' },
  { id: 'billing', label: 'Billing' },
  { id: 'deposit_interest', label: 'Deposit Interest' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'signatures', label: 'Signatures' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'voice', label: 'Voice Agent' },
  { id: 'ai', label: 'AI / LLM' },
]

const DEFAULT_BILLING_CONFIG: BillingConfig = {
  auto_generation_enabled: false,
  preparation_day: 1,
  preparation_hour: 0,
  preparation_minute: 5,
  timezone: 'Africa/Nairobi',
  payment_grace_days: 7,
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={[
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        value ? 'bg-blue-600' : 'bg-gray-200',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function GlobalSettingsPage() {
  const { orgProfile, refresh } = useOrgProfile()
  const [tab, setTab] = useState<Tab>('business')
  const [saving, setSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [business, setBusiness] = useState<BusinessDetails>({ name: '' })
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null)
  const [ledger, setLedger] = useState<LedgerSettings>(DEFAULT_LEDGER_SETTINGS)
  const [tax, setTax] = useState<TaxConfig>(DEFAULT_TAX_CONFIG)
  const [ticketCategories, setTicketCategories] = useState<TicketCategoryConfig[]>([])
  const [billing, setBilling] = useState<BillingConfig>(DEFAULT_BILLING_CONFIG)
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingSaved, setBillingSaved] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  const [voiceAuditEnabled, setVoiceAuditEnabled] = useState(true)
  const [voiceSaving, setVoiceSaving] = useState(false)
  const [voiceSaved, setVoiceSaved] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const [depositInterest, setDepositInterest] = useState<DepositInterestSetting>({
    enabled: false,
    annual_rate_pct: 0,
    compound: false,
    apply_on_refund: true,
  })
  const [depositInterestSaving, setDepositInterestSaving] = useState(false)
  const [depositInterestSaved, setDepositInterestSaved] = useState(false)
  const [depositInterestError, setDepositInterestError] = useState<string | null>(null)

  const [aiProvider, setAiProvider] = useState<'openai' | 'custom'>('custom')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgProfile) return
    setBusiness(orgProfile.business ?? { name: '' })
    setLedger({
      ...orgProfile.ledger_settings,
      accounts: orgProfile.ledger_settings.accounts?.length
        ? orgProfile.ledger_settings.accounts
        : DEFAULT_ACCOUNTS,
    })
    setTax(orgProfile.tax_config)
    setTicketCategories(orgProfile.ticket_categories ?? [])
    if (orgProfile.billing_config) setBilling(orgProfile.billing_config)
    setVoiceAuditEnabled(orgProfile.voice_api_audit_enabled ?? true)
    if (orgProfile.deposit_interest) setDepositInterest(orgProfile.deposit_interest)
    if (orgProfile.ai_config) {
      setAiProvider(orgProfile.ai_config.provider ?? 'custom')
      setAiBaseUrl(orgProfile.ai_config.base_url ?? '')
      setAiModel(orgProfile.ai_config.model ?? '')
    }
  }, [orgProfile])

  function patchBusiness(field: keyof BusinessDetails, value: string) {
    setBusiness((b) => ({ ...b, [field]: value }))
  }

  function patchLedger(field: keyof Omit<LedgerSettings, 'accounts'>, value: string | number) {
    setLedger((l) => ({ ...l, [field]: value }))
  }

  function patchTax(field: keyof TaxConfig, value: boolean | number | string) {
    setTax((t) => ({ ...t, [field]: value }))
  }

  async function handleSaveBilling() {
    setBillingSaving(true)
    setBillingError(null)
    setBillingSaved(false)
    try {
      await orgApi.updateBillingConfig(billing)
      refresh()
      setBillingSaved(true)
      setTimeout(() => setBillingSaved(false), 3000)
    } catch (e) {
      setBillingError(extractApiError(e).message)
    } finally {
      setBillingSaving(false)
    }
  }

  async function handleSaveVoice() {
    setVoiceSaving(true)
    setVoiceError(null)
    setVoiceSaved(false)
    try {
      await orgApi.updateVoiceSettings({ voice_api_audit_enabled: voiceAuditEnabled })
      refresh()
      setVoiceSaved(true)
      setTimeout(() => setVoiceSaved(false), 3000)
    } catch (e) {
      setVoiceError(extractApiError(e).message)
    } finally {
      setVoiceSaving(false)
    }
  }

  async function handleSaveAI() {
    setAiSaving(true)
    setAiError(null)
    setAiSaved(false)
    try {
      const payload: { provider?: 'openai' | 'custom'; base_url?: string; model?: string; api_key?: string } = {
        provider: aiProvider as 'openai' | 'custom',
        model: aiModel || undefined,
      }
      if (aiProvider === 'openai') {
        payload.base_url = undefined
      } else {
        payload.base_url = aiBaseUrl || undefined
      }
      if (aiApiKey) payload.api_key = aiApiKey
      await orgApi.updateAIConfig(payload)
      refresh()
      setAiApiKey('')  // clear — never echoed back
      setAiSaved(true)
      setTimeout(() => setAiSaved(false), 3000)
    } catch (e) {
      setAiError(extractApiError(e).message)
    } finally {
      setAiSaving(false)
    }
  }

  async function handleSaveDepositInterest() {
    setDepositInterestSaving(true)
    setDepositInterestError(null)
    setDepositInterestSaved(false)
    try {
      await orgApi.updateDepositInterest(depositInterest)
      refresh()
      setDepositInterestSaved(true)
      setTimeout(() => setDepositInterestSaved(false), 3000)
    } catch (e) {
      setDepositInterestError(extractApiError(e).message)
    } finally {
      setDepositInterestSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      let logoUrl = business.logo_url
      if (pendingLogoFile) {
        setLogoUploading(true)
        try {
          const updated = await orgApi.uploadLogo(pendingLogoFile)
          logoUrl = updated.business?.logo_url
          setPendingLogoFile(null)
        } finally {
          setLogoUploading(false)
        }
      }
      await orgApi.updateProfile({
        business: { ...business, logo_url: logoUrl },
        ledger_settings: ledger,
        tax_config: tax,
        ticket_categories: ticketCategories,
      })
      refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(extractApiError(e).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Global Settings</h1>
          <p className="text-gray-500 text-sm mt-1">
            Organization-wide defaults. Properties can override these individually.
          </p>
        </div>

        <div className="flex gap-6 items-start">
          {/* Left sidebar menu */}
          <div className="w-44 shrink-0">
            <nav className="space-y-0.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={[
                    'w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                    tab === t.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content panel */}
          <div className="flex-1 min-w-0 max-w-2xl">

        {tab === 'signatures' ? (
          <SignaturesTab orgProfile={orgProfile} onRefresh={refresh} />
        ) : tab === 'notifications' ? (
          <NotificationsTab />
        ) : tab === 'security' ? (
          <SecurityTab />
        ) : tab === 'voice' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">API Call Audit Logging</h3>
                <p className="text-xs text-gray-500 mb-3">
                  When enabled, every PMS and WhatsApp API call made during a voice-agent call is recorded
                  and shown in the call detail view. Only owners and superadmins can see the audit log.
                  Disable to reduce storage and hide internal API details.
                </p>
                <div className="flex items-center gap-3">
                  <Toggle value={voiceAuditEnabled} onChange={setVoiceAuditEnabled} />
                  <span className="text-sm text-gray-700">
                    {voiceAuditEnabled ? 'API audit logging enabled' : 'API audit logging disabled'}
                  </span>
                </div>
              </div>
            </div>
            {voiceError && <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{voiceError}</p>}
            {voiceSaved && <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">Voice agent settings saved.</p>}
            <div className="mt-6 flex justify-end">
              <button onClick={handleSaveVoice} disabled={voiceSaving} className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60">
                {voiceSaving ? 'Saving…' : 'Save Voice Settings'}
              </button>
            </div>
          </>
        ) : tab === 'ai' ? (
          <>
            {/* Current config summary */}
            {orgProfile?.ai_config && (
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3 text-xs text-gray-600">
                <span className="text-base">{orgProfile.ai_config.provider === 'openai' ? '🤖' : '⚙️'}</span>
                <div>
                  <span className="font-semibold text-gray-800">
                    {orgProfile.ai_config.provider === 'openai' ? 'OpenAI' : 'Custom / Ollama'}
                  </span>
                  {orgProfile.ai_config.model && (
                    <span className="ml-2 bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono">
                      {orgProfile.ai_config.model}
                    </span>
                  )}
                  {orgProfile.ai_config.provider === 'custom' && orgProfile.ai_config.base_url && (
                    <span className="ml-2 text-gray-400">{orgProfile.ai_config.base_url}</span>
                  )}
                  <span className={`ml-2 ${orgProfile.ai_config.api_key_set ? 'text-green-600' : 'text-amber-600'}`}>
                    {orgProfile.ai_config.api_key_set ? '✓ API key set' : '⚠ No API key'}
                  </span>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">AI Provider</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Choose which LLM service powers the AI chat assistant for your organisation.
                  These settings override the server defaults.
                </p>
                <div className="flex gap-3 mb-6">
                  {(['openai', 'custom'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setAiProvider(p)}
                      className={[
                        'flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors',
                        aiProvider === p
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {p === 'openai' ? '🤖 OpenAI' : '⚙️ Custom / Ollama'}
                    </button>
                  ))}
                </div>

                {aiProvider === 'openai' ? (
                  <div className="space-y-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                    <p className="text-xs text-blue-700">
                      Uses the official OpenAI API at <code className="bg-blue-100 px-1 rounded">api.openai.com</code>.
                      Your API key is stored and never returned in responses.
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        API Key
                        {orgProfile?.ai_config?.api_key_set && (
                          <span className="ml-2 text-green-600 font-normal">✓ currently set</span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={e => setAiApiKey(e.target.value)}
                        placeholder={orgProfile?.ai_config?.api_key_set ? '••••••• (leave blank to keep)' : 'sk-…'}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                      <select
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- select model --</option>
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4-turbo">gpt-4-turbo</option>
                        <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                        {/* show saved model if not in the preset list */}
                        {aiModel && !['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'].includes(aiModel) && (
                          <option value={aiModel}>{aiModel}</option>
                        )}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-xs text-gray-500">
                      Connect to any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, Groq, etc.
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                      <input
                        value={aiBaseUrl}
                        onChange={e => setAiBaseUrl(e.target.value)}
                        placeholder="https://ollama.example.com/v1"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        API Key
                        {orgProfile?.ai_config?.api_key_set && (
                          <span className="ml-2 text-green-600 font-normal">✓ currently set</span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={e => setAiApiKey(e.target.value)}
                        placeholder={orgProfile?.ai_config?.api_key_set ? '••••••• (leave blank to keep)' : "leave blank if not required"}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                      <input
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        placeholder="e.g. kimi-k2.5:cloud, llama3.1:8b, mistral"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {aiError && <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{aiError}</p>}
            {aiSaved && <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">AI settings saved.</p>}
            <div className="mt-6 flex justify-end">
              <button onClick={handleSaveAI} disabled={aiSaving} className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60">
                {aiSaving ? 'Saving…' : 'Save AI Settings'}
              </button>
            </div>
          </>
        ) : tab === 'billing' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <BillingConfigTab billing={billing} onChange={setBilling} />
            </div>
            {billingError && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{billingError}</p>
            )}
            {billingSaved && (
              <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                Billing settings saved.
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveBilling}
                disabled={billingSaving}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {billingSaving ? 'Saving…' : 'Save Billing Settings'}
              </button>
            </div>
          </>
        ) : tab === 'deposit_interest' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Security Deposit Interest</h3>
                <p className="text-xs text-gray-500">
                  Configure whether interest accrues on security deposits. Interest is computed at
                  refund time based on the deposit amount and lease duration.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  value={depositInterest.enabled}
                  onChange={(v) => setDepositInterest((d) => ({ ...d, enabled: v }))}
                />
                <span className="text-sm text-gray-700">
                  {depositInterest.enabled ? 'Deposit interest enabled' : 'Deposit interest disabled'}
                </span>
              </div>
              {depositInterest.enabled && (
                <>
                  <Field label="Annual Interest Rate (%)">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={depositInterest.annual_rate_pct}
                      onChange={(e) =>
                        setDepositInterest((d) => ({ ...d, annual_rate_pct: parseFloat(e.target.value) || 0 }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Toggle
                      value={depositInterest.compound}
                      onChange={(v) => setDepositInterest((d) => ({ ...d, compound: v }))}
                    />
                    <span className="text-sm text-gray-700">
                      {depositInterest.compound ? 'Compound interest' : 'Simple interest'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Toggle
                      value={depositInterest.apply_on_refund}
                      onChange={(v) => setDepositInterest((d) => ({ ...d, apply_on_refund: v }))}
                    />
                    <span className="text-sm text-gray-700">
                      {depositInterest.apply_on_refund
                        ? 'Add interest to refund amount'
                        : 'Do not add interest to refund'}
                    </span>
                  </div>
                </>
              )}
            </div>
            {depositInterestError && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{depositInterestError}</p>
            )}
            {depositInterestSaved && (
              <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                Deposit interest settings saved.
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveDepositInterest}
                disabled={depositInterestSaving}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {depositInterestSaving ? 'Saving…' : 'Save Deposit Interest Settings'}
              </button>
            </div>
          </>
        ) : tab === 'tickets' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <TicketCategoriesTab
                categories={ticketCategories}
                onChange={setTicketCategories}
              />
            </div>
            {error && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            {saved && (
              <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                Settings saved successfully.
              </p>
            )}
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {tab === 'business' && (
                <BusinessTab
                  business={business}
                  onChange={patchBusiness}
                  onFileSelected={(f) => setPendingLogoFile(f)}
                  logoUploading={logoUploading}
                />
              )}
              {tab === 'ledger' && (
                <LedgerTab
                  ledger={ledger}
                  onChange={patchLedger}
                  onAccountsChange={(accounts) => setLedger((l) => ({ ...l, accounts }))}
                />
              )}
              {tab === 'tax' && (
                <TaxTab tax={tax} onChange={patchTax} />
              )}
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            {saved && (
              <p className="mt-4 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                Settings saved successfully.
              </p>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving || logoUploading}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {saving || logoUploading ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

/* ─── Business Tab ──────────────────────────────────────────────────────── */

function BusinessTab({
  business,
  onChange,
  onFileSelected,
  logoUploading,
}: {
  business: BusinessDetails
  onChange: (field: keyof BusinessDetails, value: string) => void
  onFileSelected: (file: File) => void
  logoUploading: boolean
}) {
  return (
    <div className="space-y-5">
      <Field label="Business Logo">
        <LogoUpload
          currentUrl={business.logo_url}
          onFileSelected={onFileSelected}
          uploading={logoUploading}
        />
      </Field>
      <Field label="Business Name">
        <input
          className="input"
          value={business.name}
          onChange={(e) => onChange('name', e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Registration Number">
          <input className="input" value={business.registration_number ?? ''} onChange={(e) => onChange('registration_number', e.target.value)} />
        </Field>
        <Field label="KRA PIN">
          <input className="input" value={business.kra_pin ?? ''} onChange={(e) => onChange('kra_pin', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input className="input" value={business.phone ?? ''} onChange={(e) => onChange('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={business.email ?? ''} onChange={(e) => onChange('email', e.target.value)} />
        </Field>
      </div>
      <Field label="Website">
        <input className="input" value={business.website ?? ''} onChange={(e) => onChange('website', e.target.value)} />
      </Field>
      <Field label="Address">
        <textarea className="input resize-none" rows={2} value={business.address ?? ''} onChange={(e) => onChange('address', e.target.value)} />
      </Field>
    </div>
  )
}

/* ─── Ledger Tab ────────────────────────────────────────────────────────── */

function LedgerTab({
  ledger,
  onChange,
  onAccountsChange,
}: {
  ledger: LedgerSettings
  onChange: (field: keyof Omit<LedgerSettings, 'accounts'>, value: string | number) => void
  onAccountsChange: (accounts: AccountEntry[]) => void
}) {
  const [coaView, setCoaView] = useState<'flow' | 'table'>('flow')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Currency Code">
          <input className="input" value={ledger.currency} onChange={(e) => onChange('currency', e.target.value)} />
        </Field>
        <Field label="Currency Symbol">
          <input className="input" value={ledger.currency_symbol} onChange={(e) => onChange('currency_symbol', e.target.value)} />
        </Field>
        <Field label="Fiscal Year Start">
          <select className="input" value={ledger.fiscal_year_start_month} onChange={(e) => onChange('fiscal_year_start_month', Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Invoice Prefix">
          <input className="input" value={ledger.invoice_prefix} onChange={(e) => onChange('invoice_prefix', e.target.value)} />
        </Field>
        <Field label="Receipt Prefix">
          <input className="input" value={ledger.receipt_prefix} onChange={(e) => onChange('receipt_prefix', e.target.value)} />
        </Field>
        <Field label="Credit Note Prefix">
          <input className="input" value={ledger.credit_note_prefix} onChange={(e) => onChange('credit_note_prefix', e.target.value)} />
        </Field>
      </div>
      <Field label="Payment Terms (days)">
        <input className="input" type="number" min={0} value={ledger.payment_terms_days} onChange={(e) => onChange('payment_terms_days', Number(e.target.value))} />
      </Field>

      {/* Chart of Accounts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Chart of Accounts
          </p>
          <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setCoaView('flow')}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                coaView === 'flow'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              Flow Map
            </button>
            <button
              type="button"
              onClick={() => setCoaView('table')}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                coaView === 'table'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              Table
            </button>
          </div>
        </div>

        {coaView === 'flow' ? (
          <AccountRoleMapper accounts={ledger.accounts} onChange={onAccountsChange} />
        ) : (
          <AccountsEditor accounts={ledger.accounts} onChange={onAccountsChange} />
        )}
      </div>
    </div>
  )
}

/* ─── Tax Tab ───────────────────────────────────────────────────────────── */

function TaxTab({
  tax,
  onChange,
}: {
  tax: TaxConfig
  onChange: (field: keyof TaxConfig, value: boolean | number | string) => void
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable VAT</p>
            <p className="text-xs text-gray-500">Add VAT to all invoices</p>
          </div>
          <Toggle value={tax.vat_enabled} onChange={(v) => onChange('vat_enabled', v)} />
        </div>
        {tax.vat_enabled && (
          <>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Field label="VAT Rate (%)">
                <input className="input" type="number" step="0.1" min={0} value={tax.vat_rate} onChange={(e) => onChange('vat_rate', Number(e.target.value))} />
              </Field>
              <Field label="VAT Registration Number">
                <input className="input" value={tax.vat_number ?? ''} onChange={(e) => onChange('vat_number', e.target.value)} placeholder="VAT/0000000" />
              </Field>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-sm font-medium text-gray-900">VAT Inclusive Pricing</p>
                <p className="text-xs text-gray-500">Prices shown include VAT</p>
              </div>
              <Toggle value={tax.vat_inclusive} onChange={(v) => onChange('vat_inclusive', v)} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable Withholding Tax</p>
            <p className="text-xs text-gray-500">Deduct withholding tax from payments</p>
          </div>
          <Toggle value={tax.withholding_tax_enabled} onChange={(v) => onChange('withholding_tax_enabled', v)} />
        </div>
        {tax.withholding_tax_enabled && (
          <Field label="Withholding Tax Rate (%)">
            <input className="input" type="number" step="0.1" min={0} value={tax.withholding_tax_rate} onChange={(e) => onChange('withholding_tax_rate', Number(e.target.value))} />
          </Field>
        )}
      </div>
    </div>
  )
}

/* ─── Security Tab ──────────────────────────────────────────────────────── */

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', agent: 'Agent', tenant: 'Tenant',
  superadmin: 'Super Admin', service_provider: 'Service Provider',
}

function SecurityTab() {
  const [myStatus, setMyStatus] = useState<MfaStatus | null>(null)
  const [users, setUsers] = useState<MfaUserStatus[]>([])
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [showSetup, setShowSetup] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  function refreshStatus() {
    mfaApi.getStatus().then(setMyStatus).catch(() => {}).finally(() => setLoadingStatus(false))
  }

  function refreshUsers() {
    mfaApi.listUsers().then(setUsers).catch(() => {}).finally(() => setLoadingUsers(false))
  }

  useEffect(() => {
    refreshStatus()
    refreshUsers()
  }, [])

  async function handleRevoke(userId: string) {
    setRevoking(userId)
    setActionError(null)
    try {
      await mfaApi.revokeUser(userId)
      refreshUsers()
    } catch (err) {
      setActionError(extractApiError(err).message)
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* My MFA */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Authenticator App (TOTP)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Use Google Authenticator, Authy, or any TOTP app to protect sensitive data access.
            </p>
          </div>
          {loadingStatus ? (
            <span className="text-xs text-gray-400">Loading…</span>
          ) : myStatus?.enrolled ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Enabled
              </span>
            </div>
          ) : (
            <button
              onClick={() => setShowSetup(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Set Up Now
            </button>
          )}
        </div>
        {myStatus?.enrolled && myStatus.enrolled_at && (
          <p className="text-xs text-gray-400 mt-3">
            Enrolled on {new Date(myStatus.enrolled_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Users MFA management */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Team MFA Status</p>
          <button onClick={refreshUsers} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
        {actionError && (
          <div className="mb-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loadingUsers ? (
            <div className="text-center py-8 text-sm text-gray-400">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No users found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">MFA</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Used</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 text-sm">{u.first_name} {u.last_name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.enrolled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {u.enrolled ? '✓ Enabled' : 'Not set up'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {u.last_verified_at
                        ? new Date(u.last_verified_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.enrolled && (
                        <button
                          onClick={() => handleRevoke(u.user_id)}
                          disabled={revoking === u.user_id}
                          className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          {revoking === u.user_id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showSetup && (
        <MfaSetupModal
          onEnrolled={() => { refreshStatus(); refreshUsers() }}
          onClose={() => setShowSetup(false)}
        />
      )}
    </div>
  )
}

/* ─── Billing Config Tab ────────────────────────────────────────────────── */

const TIMEZONES = [
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'UTC',
  'Europe/London',
  'America/New_York',
]

function BillingConfigTab({
  billing,
  onChange,
}: {
  billing: BillingConfig
  onChange: (b: BillingConfig) => void
}) {
  function patch<K extends keyof BillingConfig>(field: K, value: BillingConfig[K]) {
    onChange({ ...billing, [field]: value })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Auto Invoice Generation</p>
            <p className="text-xs text-gray-500">
              Automatically generate invoices for all active leases each month.
            </p>
          </div>
          <Toggle
            value={billing.auto_generation_enabled}
            onChange={(v) => patch('auto_generation_enabled', v)}
          />
        </div>
        {billing.auto_generation_enabled && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <Field label="Preparation Day (1–28)">
              <input
                className="input"
                type="number"
                min={1}
                max={28}
                value={billing.preparation_day}
                onChange={(e) => patch('preparation_day', Number(e.target.value))}
              />
            </Field>
            <Field label="Timezone">
              <select
                className="input"
                value={billing.timezone}
                onChange={(e) => patch('timezone', e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-5">
        <Field label="Payment Grace Days">
          <input
            className="input"
            type="number"
            min={0}
            max={60}
            value={billing.payment_grace_days}
            onChange={(e) => patch('payment_grace_days', Number(e.target.value))}
          />
        </Field>
        <p className="text-xs text-gray-400 mt-1.5">
          Number of days after billing month start before invoice is considered overdue.
        </p>
      </div>
    </div>
  )
}

/* ─── Ticket Categories Tab ─────────────────────────────────────────────── */

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

function TicketCategoriesTab({
  categories,
  onChange,
}: {
  categories: TicketCategoryConfig[]
  onChange: (cats: TicketCategoryConfig[]) => void
}) {
  function patch(index: number, field: keyof TicketCategoryConfig, value: unknown) {
    const updated = categories.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    onChange(updated)
  }

  function addCustom() {
    onChange([
      ...categories,
      { key: `custom_${Date.now()}`, label: 'Custom Category', enabled: true, default_priority: 'normal' },
    ])
  }

  function remove(index: number) {
    onChange(categories.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Ticket Categories</p>
        <button
          type="button"
          onClick={addCustom}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5"
        >
          + Add Custom
        </button>
      </div>
      <div className="space-y-2">
        {categories.map((cat, i) => (
          <div
            key={cat.key}
            className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3"
          >
            <button
              type="button"
              onClick={() => patch(i, 'enabled', !cat.enabled)}
              className={[
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                cat.enabled ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                  cat.enabled ? 'translate-x-4' : 'translate-x-0.5',
                ].join(' ')}
              />
            </button>
            <div className="flex-1 grid grid-cols-3 gap-3">
              <input
                className="input text-sm"
                value={cat.label}
                onChange={(e) => patch(i, 'label', e.target.value)}
                placeholder="Label"
              />
              <select
                className="input text-sm"
                value={cat.default_priority}
                onChange={(e) => patch(i, 'default_priority', e.target.value)}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                className="input text-sm"
                type="number"
                min={0}
                value={cat.sla_hours ?? ''}
                onChange={(e) => patch(i, 'sla_hours', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="SLA hours"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-gray-300 hover:text-red-500 text-sm leading-none"
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">
        Toggle categories on/off, set default priority, and configure SLA hours per category.
      </p>
    </div>
  )
}

/* ─── Signatures Tab ────────────────────────────────────────────────────── */

function SignaturesTab({ orgProfile, onRefresh }: { orgProfile: ReturnType<typeof useOrgProfile>['orgProfile']; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'upload' | 'draw'>('upload')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [sigName, setSigName] = useState('')
  const [sigTitle, setSigTitle] = useState('')
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null)
  const [drawEmpty, setDrawEmpty] = useState(true)
  const [drawSaving, setDrawSaving] = useState(false)

  const sigCfg: SignatureConfig = orgProfile?.signature_config ?? {}

  useEffect(() => {
    if (!orgProfile) return
    setSigName(orgProfile.signature_config?.signatory_name ?? '')
    setSigTitle(orgProfile.signature_config?.signatory_title ?? '')
  }, [orgProfile])

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      await orgApi.uploadSignature(file)
      onRefresh()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveDrawn() {
    if (!drawnDataUrl) return
    setDrawSaving(true)
    setError(null)
    try {
      const res = await fetch(drawnDataUrl)
      const blob = await res.blob()
      const file = new File([blob], 'signature.png', { type: 'image/png' })
      await orgApi.uploadSignature(file)
      onRefresh()
      setDrawnDataUrl(null)
      setDrawEmpty(true)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setDrawSaving(false)
    }
  }

  async function handleSaveConfig() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await orgApi.updateSignatureConfig({ signatory_name: sigName, signatory_title: sigTitle })
      onRefresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove the default signature image?')) return
    setDeleting(true)
    setError(null)
    try {
      await orgApi.deleteSignature()
      onRefresh()
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-1">Default Countersignature</p>
          <p className="text-xs text-gray-500">
            Automatically applied when tenants sign a lease. Properties can override this.
          </p>
        </div>

        {/* Current signature preview */}
        {sigCfg.signature_key && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Current signature</p>
            <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 flex items-center justify-center" style={{ minHeight: 80 }}>
              <img src={sigCfg.signature_key} alt="Signature" className="max-h-20 max-w-full object-contain" />
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
            >
              {deleting ? 'Removing…' : 'Remove signature'}
            </button>
          </div>
        )}

        {/* Mode tabs */}
        <div>
          <div className="flex border-b border-gray-200 mb-4">
            {(['upload', 'draw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  mode === m ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {m === 'upload' ? 'Upload Image' : 'Draw Signature'}
              </button>
            ))}
          </div>

          {mode === 'upload' ? (
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm text-gray-500">{uploading ? 'Uploading…' : 'Upload PNG, JPG or SVG'}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <SignaturePad
                onSign={(d) => { setDrawnDataUrl(d); setDrawEmpty(false) }}
                onClear={() => { setDrawnDataUrl(null); setDrawEmpty(true) }}
                isEmpty={drawEmpty}
              />
              <button
                type="button"
                onClick={handleSaveDrawn}
                disabled={drawEmpty || drawSaving}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {drawSaving ? 'Saving…' : 'Save Drawn Signature'}
              </button>
            </div>
          )}
        </div>

        {/* Signatory name/title */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Signatory Name</label>
            <input
              className="input"
              value={sigName}
              onChange={(e) => setSigName(e.target.value)}
              placeholder="e.g. Cecil Homes Management"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Signatory Title</label>
            <input
              className="input"
              value={sigTitle}
              onChange={(e) => setSigTitle(e.target.value)}
              placeholder="e.g. Managing Director"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {saved && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">Saved.</p>}

        <button
          onClick={handleSaveConfig}
          disabled={saving}
          className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Name & Title'}
        </button>
      </div>

      <p className="text-xs text-gray-400">
        The verification code printed on the signed PDF confirms document authenticity at{' '}
        <span className="font-mono">/verify/&#123;id&#125;</span>.
      </p>
    </div>
  )
}

/* ─── Notifications Tab ─────────────────────────────────────────────────── */

function NotificationsTab() {
  const { playNotificationSound, playCallSound, playWhatsAppMessageSound } = useSound()
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem(NOTIFICATION_SOUND_KEY) === 'true',
  )
  const [callSoundEnabled, setCallSoundEnabled] = useState(
    () => localStorage.getItem(CALL_SOUND_KEY) === 'true',
  )
  const [whatsappSoundEnabled, setWhatsappSoundEnabled] = useState(
    () => localStorage.getItem(WHATSAPP_SOUND_KEY) === 'true',
  )

  const handleToggle = useCallback((v: boolean) => {
    setSoundEnabled(v)
    localStorage.setItem(NOTIFICATION_SOUND_KEY, v ? 'true' : 'false')
  }, [])

  const handleCallToggle = useCallback((v: boolean) => {
    setCallSoundEnabled(v)
    localStorage.setItem(CALL_SOUND_KEY, v ? 'true' : 'false')
  }, [])

  const handleWhatsappToggle = useCallback((v: boolean) => {
    setWhatsappSoundEnabled(v)
    localStorage.setItem(WHATSAPP_SOUND_KEY, v ? 'true' : 'false')
  }, [])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-1">In-App Notifications</p>
        <p className="text-xs text-gray-500">
          Real-time alerts appear as toasts and in the notification bell when async jobs complete
          (e.g. billing runs, document generation).
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Play sound on notification</p>
            <p className="text-xs text-gray-500">
              A short tone plays when a new notification arrives.
            </p>
          </div>
          <Toggle value={soundEnabled} onChange={handleToggle} />
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              const prev = localStorage.getItem(NOTIFICATION_SOUND_KEY)
              localStorage.setItem(NOTIFICATION_SOUND_KEY, 'true')
              playNotificationSound()
              if (prev !== 'true') {
                localStorage.setItem(NOTIFICATION_SOUND_KEY, prev ?? 'false')
              }
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Preview sound
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Play sound on incoming calls</p>
            <p className="text-xs text-gray-500">
              A phone ring tone plays when a call arrives via the Customer Agent (Voice AI).
            </p>
          </div>
          <Toggle value={callSoundEnabled} onChange={handleCallToggle} />
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              const prev = localStorage.getItem(CALL_SOUND_KEY)
              localStorage.setItem(CALL_SOUND_KEY, 'true')
              playCallSound()
              if (prev !== 'true') {
                localStorage.setItem(CALL_SOUND_KEY, prev ?? 'false')
              }
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Preview call ring
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Play sound on WhatsApp messages</p>
            <p className="text-xs text-gray-500">
              A chime plays when an incoming WhatsApp message arrives. Only applies if the WhatsApp Notifications app is installed on a property.
            </p>
          </div>
          <Toggle value={whatsappSoundEnabled} onChange={handleWhatsappToggle} />
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              const prev = localStorage.getItem(WHATSAPP_SOUND_KEY)
              localStorage.setItem(WHATSAPP_SOUND_KEY, 'true')
              playWhatsAppMessageSound()
              if (prev !== 'true') {
                localStorage.setItem(WHATSAPP_SOUND_KEY, prev ?? 'false')
              }
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Preview chime
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Sound preferences are stored locally in your browser and only affect your session.
      </p>
    </div>
  )
}
