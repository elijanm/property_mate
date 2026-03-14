import { useState, useMemo, useEffect } from 'react'
import { communicationsApi } from '@/api/communications'
import { extractApiError } from '@/utils/apiError'
import { computeBehaviourScore } from '@/utils/behaviourScore'
import type { CommChannel, CommIntent, BulkSendResult } from '@/types/communication'
import type { Tenant } from '@/types/tenant'
import type { Lease } from '@/types/lease'
import type { PaymentSummary } from '@/types/payment'

// ── Types ──────────────────────────────────────────────────────────────────

interface TenantRow {
  lease: Lease
  tenant: Tenant | null
  summary: PaymentSummary | null
}

interface Props {
  propertyId: string
  rows: TenantRow[]
  onClose: () => void
}

// ── Variable substitution ──────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function tenureMonths(lease: Lease): number {
  return Math.max(0, Math.floor((Date.now() - new Date(lease.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30)))
}

function substituteVars(template: string, row: TenantRow): string {
  const { lease, tenant, summary } = row
  return template
    .replace(/\{\{name\}\}/g,      tenant?.first_name ?? 'Tenant')
    .replace(/\{\{full_name\}\}/g, tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Tenant')
    .replace(/\{\{unit\}\}/g,      lease.unit_code ?? lease.unit_id)
    .replace(/\{\{rent\}\}/g,      `KES ${fmt(lease.effective_rent ?? lease.rent_amount)}`)
    .replace(/\{\{arrears\}\}/g,   summary ? `KES ${fmt(summary.outstanding_balance)}` : 'KES 0')
    .replace(/\{\{credit\}\}/g,    summary ? `KES ${fmt(summary.prepayment_credit)}` : 'KES 0')
    .replace(/\{\{score\}\}/g,     String(computeBehaviourScore(lease, summary).score))
    .replace(/\{\{tenure\}\}/g,    `${tenureMonths(lease)} month${tenureMonths(lease) !== 1 ? 's' : ''}`)
    .replace(/\{\{end_date\}\}/g,  lease.end_date ? new Date(lease.end_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'open-ended')
}

// ── AI message generation ──────────────────────────────────────────────────

interface AiResult { message: string; note: string }

function aiGenerate(intent: CommIntent, row: TenantRow, userTemplate: string): AiResult {
  const { lease, summary } = row
  const bs = computeBehaviourScore(lease, summary)
  const arrears = summary?.outstanding_balance ?? 0

  if (intent === 'arrears') {
    let tpl: string
    let note: string
    if (bs.score < 50) {
      tpl = `Dear {{name}}, your account for unit {{unit}} has an outstanding balance of {{arrears}}. Immediate payment is required to avoid further action. Please contact us within 48 hours to settle this amount. Management.`
      note = `Firm & urgent — score ${bs.score}/100 (${bs.label}). Urgent language, short deadline.`
    } else if (bs.score < 65) {
      tpl = `Hi {{name}}, we'd like to bring to your attention an outstanding balance of {{arrears}} for unit {{unit}}. Please arrange payment at your earliest convenience. If you need a payment plan, we're happy to discuss options. Thank you.`
      note = `Direct but open — score ${bs.score}/100 (${bs.label}). Mentions payment plan.`
    } else if (bs.score < 80) {
      tpl = `Hi {{name}}, hope you're well! Just a quick reminder about an outstanding balance of {{arrears}} for unit {{unit}}. No rush, but please arrange payment when convenient. Let us know if anything's come up. Thanks! 😊`
      note = `Friendly reminder — score ${bs.score}/100 (${bs.label}). Light, no pressure.`
    } else {
      tpl = `Hi {{name}}, we noticed a balance of {{arrears}} on your account for unit {{unit}}. This seems unlike you — is everything okay? Please let us know if there's anything we can help with, otherwise please settle when you can. We appreciate you! 🏠`
      note = `Empathetic — score ${bs.score}/100 (${bs.label}). Checks on the tenant personally.`
    }
    const base = userTemplate.trim() || tpl
    return { message: substituteVars(base, row), note }
  }

  if (intent === 'promotion') {
    let tpl: string
    let note: string
    if (bs.score >= 75) {
      tpl = `Hi {{name}}! As one of our most valued residents ({{tenure}} with us!), we'd like to extend a special offer exclusively for you. 🎉 [ADD PROMOTION DETAILS HERE]. Your loyalty means everything to us — thank you for making unit {{unit}} your home.`
      note = `VIP loyalty tone — score ${bs.score}/100 (${bs.label}). Highlights tenure, exclusivity.`
    } else if (arrears > 0) {
      tpl = `Hi {{name}}, we have an exciting offer for residents of unit {{unit}}! [ADD PROMOTION DETAILS]. Also, as a reminder — clearing your outstanding balance of {{arrears}} first will ensure you can take full advantage. Speak to us anytime! 😊`
      note = `Dual purpose — score ${bs.score}/100 (${bs.label}). Promo + gentle arrears nudge.`
    } else {
      tpl = `Hi {{name}}, we're excited to share a special offer with you as a resident of unit {{unit}}. [ADD PROMOTION DETAILS HERE]. We value having you as part of our community — hope to hear from you soon! 🏡`
      note = `Standard promo — score ${bs.score}/100 (${bs.label}). Warm community tone.`
    }
    const base = userTemplate.trim() || tpl
    return { message: substituteVars(base, row), note }
  }

  // Free form — substitute vars and add note about tone
  const base = userTemplate.trim() || `Hi {{name}}, hope you're doing well at unit {{unit}}. [Your message here]`
  return {
    message: substituteVars(base, row),
    note: `Tone adjusted for score ${bs.score}/100 (${bs.label}).`,
  }
}

// ── VARIABLES ──────────────────────────────────────────────────────────────

const VARS: { label: string; token: string; hint: string }[] = [
  { label: '{{name}}',      token: '{{name}}',      hint: 'First name' },
  { label: '{{full_name}}', token: '{{full_name}}',  hint: 'Full name' },
  { label: '{{unit}}',      token: '{{unit}}',       hint: 'Unit code' },
  { label: '{{rent}}',      token: '{{rent}}',       hint: 'Monthly rent' },
  { label: '{{arrears}}',   token: '{{arrears}}',    hint: 'Outstanding balance' },
  { label: '{{credit}}',    token: '{{credit}}',     hint: 'Prepayment credit' },
  { label: '{{tenure}}',    token: '{{tenure}}',     hint: 'Months as tenant' },
  { label: '{{end_date}}',  token: '{{end_date}}',   hint: 'Lease end date' },
]

// ── Default templates ──────────────────────────────────────────────────────

const DEFAULT_TEMPLATES: Record<CommIntent, string> = {
  free:      '',
  arrears:   'Hi {{name}}, this is a friendly reminder that your rent payment of {{arrears}} for unit {{unit}} is currently outstanding. Please arrange payment at your earliest convenience. Thank you.',
  promotion: 'Hi {{name}}, we have an exciting offer for you as a resident of unit {{unit}}. [ADD PROMOTION DETAILS HERE]. We look forward to hearing from you!',
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BulkMessageSlideOver({ propertyId, rows, onClose }: Props) {
  const [channel, setChannel]         = useState<CommChannel>('email')
  const [intent, setIntent]           = useState<CommIntent>('free')
  const [template, setTemplate]       = useState('')
  const [subject, setSubject]         = useState('')
  const [aiAssist, setAiAssist]       = useState(false)
  const [previewIdx, setPreviewIdx]   = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(rows.map(r => r.lease.id)))
  const [sending, setSending]         = useState(false)
  const [result, setResult]           = useState<BulkSendResult | null>(null)
  const [error, setError]             = useState<string | null>(null)

  // Keep preview index in bounds when selection changes
  const selectedRows = useMemo(() => rows.filter(r => selectedIds.has(r.lease.id)), [rows, selectedIds])
  useEffect(() => { setPreviewIdx(0) }, [selectedIds])

  // Load default template when intent changes
  useEffect(() => {
    setTemplate(DEFAULT_TEMPLATES[intent])
  }, [intent])

  const previewRow = selectedRows[previewIdx] ?? null

  const previewContent = useMemo(() => {
    if (!previewRow) return { message: '', note: undefined }
    if (aiAssist) return aiGenerate(intent, previewRow, template)
    return { message: substituteVars(template, previewRow), note: undefined }
  }, [previewRow, template, aiAssist, intent])

  function toggleAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map(r => r.lease.id)))
    }
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function insertVar(token: string) {
    setTemplate(t => t + token)
  }

  async function handleSend() {
    if (!selectedRows.length) return
    setSending(true)
    setError(null)
    try {
      const recipients = selectedRows.map(row => {
        const { message } = aiAssist
          ? aiGenerate(intent, row, template)
          : { message: substituteVars(template, row) }
        return {
          tenant_id: row.lease.tenant_id,
          lease_id:  row.lease.id,
          message,
          subject:   subject || undefined,
          phone:     row.tenant?.phone,
          email:     row.tenant?.email,
        }
      })
      const res = await communicationsApi.bulkSend(propertyId, { channel, recipients })
      setResult(res)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSending(false)
    }
  }

  const canSend = selectedRows.length > 0 && (template.trim().length > 0 || aiAssist)

  // ── Sent result screen ──────────────────────────────────────────────────
  if (result) {
    return (
      <div className="fixed inset-0 z-[10000] flex">
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Messages Sent</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">✓</div>
            <div>
              <p className="text-xl font-bold text-gray-900">{result.sent} message{result.sent !== 1 ? 's' : ''} sent</p>
              {result.failed > 0 && (
                <p className="text-sm text-red-600 mt-1">{result.failed} failed</p>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="w-full max-w-sm bg-red-50 border border-red-200 rounded-lg p-3 text-left space-y-1">
                {result.errors.map(e => (
                  <p key={e.tenant_id} className="text-xs text-red-700">{e.tenant_id}: {e.error}</p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main UI ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Bulk Communication</h2>
            <p className="text-xs text-gray-500">{selectedRows.length} recipient{selectedRows.length !== 1 ? 's' : ''} selected</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Body — two columns */}
        <div className="flex-1 flex overflow-hidden">

          {/* LEFT: Recipients */}
          <div className="w-56 shrink-0 border-r border-gray-100 flex flex-col overflow-hidden">
            <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Recipients</span>
              <button
                onClick={toggleAll}
                className="text-[10px] text-blue-600 hover:underline"
              >
                {selectedIds.size === rows.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {rows.map(({ lease, tenant, summary }) => {
                const bs  = computeBehaviourScore(lease, summary)
                const sel = selectedIds.has(lease.id)
                const arr = summary?.outstanding_balance ?? 0
                return (
                  <label
                    key={lease.id}
                    className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-50 transition-colors ${sel ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleRow(lease.id)}
                      className="mt-0.5 accent-blue-600 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">
                        {tenant ? `${tenant.first_name} ${tenant.last_name}` : '—'}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate">{lease.unit_code}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${bs.bg} ${bs.color} border ${bs.border}`}>
                          {bs.score > 0 ? `${bs.score}` : '—'} {bs.label}
                        </span>
                        {arr > 0 && (
                          <span className="text-[9px] text-red-600 bg-red-50 border border-red-200 px-1 py-0.5 rounded">
                            {fmt(arr)} due
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          {/* RIGHT: Compose + Preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Channel */}
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Channel</p>
                <div className="flex gap-1.5">
                  {(['email', 'whatsapp', 'sms'] as CommChannel[]).map(ch => (
                    <button
                      key={ch}
                      onClick={() => setChannel(ch)}
                      className={[
                        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        channel === ch
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
                      ].join(' ')}
                    >
                      {ch === 'email' ? '📧 Email' : ch === 'whatsapp' ? '💬 WhatsApp' : '📱 SMS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intent */}
              <div>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Intent</p>
                <div className="flex gap-1.5 flex-wrap">
                  {([
                    { key: 'free',      label: 'Free Form',         icon: '✏️' },
                    { key: 'arrears',   label: 'Arrears Follow-up', icon: '🔔' },
                    { key: 'promotion', label: 'Promotion',          icon: '🎁' },
                  ] as { key: CommIntent; label: string; icon: string }[]).map(item => (
                    <button
                      key={item.key}
                      onClick={() => setIntent(item.key)}
                      className={[
                        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1',
                        intent === item.key
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300',
                      ].join(' ')}
                    >
                      <span>{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject (email only) */}
              {channel === 'email' && (
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Subject</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Rent reminder for {{unit}}"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                  />
                </div>
              )}

              {/* Template */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Message template</label>
                  {channel === 'sms' && (
                    <span className={`text-[10px] ${template.length > 160 ? 'text-red-500' : 'text-gray-400'}`}>
                      {template.length} / 160 chars
                    </span>
                  )}
                </div>
                <textarea
                  rows={5}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder={aiAssist ? 'Leave blank to let AI write from scratch, or provide a starting point…' : 'Type your message. Use variables below to personalise.'}
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                />
                {/* Variable chips */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {VARS.map(v => (
                    <button
                      key={v.token}
                      title={v.hint}
                      onClick={() => insertVar(v.token)}
                      className="px-1.5 py-0.5 text-[10px] bg-gray-100 hover:bg-blue-100 hover:text-blue-700 rounded font-mono border border-gray-200 transition-colors"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Assist toggle */}
              <div className={`rounded-xl border p-3.5 transition-colors ${aiAssist ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🤖</span>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">AI Assist</p>
                      <p className="text-[10px] text-gray-500">Personalises each message based on tenant behaviour score</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAiAssist(a => !a)}
                    className={[
                      'relative inline-flex w-10 h-5 rounded-full transition-colors shrink-0',
                      aiAssist ? 'bg-violet-500' : 'bg-gray-300',
                    ].join(' ')}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${aiAssist ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {aiAssist && (
                  <p className="mt-2 text-[10px] text-violet-700 leading-relaxed">
                    <strong>Arrears follow-up:</strong> Firm for At Risk (score &lt;50) → Friendly for Good (≥65) → Empathetic for Excellent (≥80).<br />
                    <strong>Promotion:</strong> VIP tone for high scorers · Combined promo + arrears nudge for tenants with balances.<br />
                    <strong>Free form:</strong> Tone-matches your template to each tenant's profile.
                  </p>
                )}
              </div>

              {/* Live Preview */}
              {previewRow && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 bg-blue-50 border-b border-blue-100">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Live Preview</span>
                      <span className="text-[10px] text-blue-500">
                        — {previewRow.tenant?.first_name ?? 'Tenant'} ({previewRow.lease.unit_code})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPreviewIdx(i => Math.max(0, i - 1))}
                        disabled={previewIdx === 0}
                        className="w-5 h-5 flex items-center justify-center rounded text-blue-600 hover:bg-blue-100 disabled:opacity-30 text-xs"
                      >‹</button>
                      <span className="text-[10px] text-blue-500 min-w-[36px] text-center">
                        {previewIdx + 1} / {selectedRows.length}
                      </span>
                      <button
                        onClick={() => setPreviewIdx(i => Math.min(selectedRows.length - 1, i + 1))}
                        disabled={previewIdx >= selectedRows.length - 1}
                        className="w-5 h-5 flex items-center justify-center rounded text-blue-600 hover:bg-blue-100 disabled:opacity-30 text-xs"
                      >›</button>
                    </div>
                  </div>

                  {/* Score badge for preview tenant */}
                  {(() => {
                    const bs = computeBehaviourScore(previewRow.lease, previewRow.summary)
                    const arr = previewRow.summary?.outstanding_balance ?? 0
                    return (
                      <div className="flex items-center gap-2 px-3.5 pt-2.5">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${bs.bg} ${bs.color} ${bs.border}`}>
                          {bs.score} · {bs.label}
                        </span>
                        {arr > 0 && (
                          <span className="text-[9px] text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                            KES {fmt(arr)} outstanding
                          </span>
                        )}
                        {(previewRow.summary?.prepayment_credit ?? 0) > 0 && (
                          <span className="text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            KES {fmt(previewRow.summary!.prepayment_credit)} credit
                          </span>
                        )}
                      </div>
                    )
                  })()}

                  {channel === 'email' && subject && (
                    <div className="px-3.5 pt-2">
                      <p className="text-[10px] text-gray-400 font-medium">Subject:</p>
                      <p className="text-xs text-gray-700 font-medium">{substituteVars(subject, previewRow)}</p>
                    </div>
                  )}

                  <div className="px-3.5 py-2.5">
                    <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                      {previewContent.message || <span className="text-gray-400 italic">No message — type above or enable AI Assist.</span>}
                    </p>
                  </div>

                  {aiAssist && previewContent.note && (
                    <div className="px-3.5 pb-2.5">
                      <p className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1.5">
                        🤖 {previewContent.note}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <p className="text-xs text-gray-400">
                {selectedRows.length} message{selectedRows.length !== 1 ? 's' : ''} via{' '}
                <span className="font-medium text-gray-600">{channel}</span>
                {aiAssist && <span className="text-violet-600"> · AI personalised</span>}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={!canSend || sending}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40 flex items-center gap-2"
                >
                  {sending
                    ? <><span className="animate-spin">⏳</span> Sending…</>
                    : <>Send to {selectedRows.length} tenant{selectedRows.length !== 1 ? 's' : ''} →</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
