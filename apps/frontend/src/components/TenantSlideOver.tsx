import { useEffect, useState } from 'react'
import { tenantsApi } from '@/api/tenants'
import { paymentsApi } from '@/api/payments'
import { onboardingsApi } from '@/api/onboardings'
import { generalTicketsApi } from '@/api/tickets'
import { extractApiError } from '@/utils/apiError'
import { useAuth } from '@/hooks/useAuth'
import { useMfaSession } from '@/hooks/useMfaSession'
import { maskEmail, maskPhone } from '@/utils/maskPii'
import MfaPinModal from '@/components/MfaPinModal'
import TicketStatusBadge from '@/components/TicketStatusBadge'
import TicketDetailSlideOver from '@/components/TicketDetailSlideOver'
import type { Tenant } from '@/types/tenant'
import type { Lease } from '@/types/lease'
import type { PaymentSummary, LedgerEntry } from '@/types/payment'
import type { OnboardingDocuments } from '@/types/mfa'
import type { Ticket } from '@/types/ticket'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.round(diff / 86_400_000)
}

function expiryLabel(days: number | null): { text: string; cls: string } {
  if (days === null) return { text: 'Rolling / No end date', cls: 'text-gray-400' }
  if (days < 0) return { text: `Expired ${Math.abs(days)} days ago`, cls: 'text-red-600 font-semibold' }
  if (days === 0) return { text: 'Expires today', cls: 'text-red-600 font-semibold' }
  if (days === 1) return { text: 'Expires tomorrow', cls: 'text-orange-500 font-semibold' }
  if (days <= 14) return { text: `${days} days remaining`, cls: 'text-orange-500 font-medium' }
  if (days <= 60) return { text: `${days} days remaining`, cls: 'text-yellow-600' }
  return { text: `${days} days remaining`, cls: 'text-green-600' }
}

// Arrears = sum of unpaid invoice balances (from backend; lease start guard included)
function calcRentArrears(_lease: Lease, summary: PaymentSummary): number {
  return summary.outstanding_balance ?? 0
}

// Credit = direct deposit overpayment (prepayment_credit from backend)
function calcCredit(_lease: Lease, summary: PaymentSummary): number {
  return summary.prepayment_credit ?? 0
}

// ── Sub-components ─────────────────────────────────────────────────────────

type Tab = 'profile' | 'payments' | 'tickets' | 'documents'

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 shrink-0 w-36">{label}</span>
      <span className="text-sm text-gray-900 text-right">{value}</span>
    </div>
  )
}

function MiniCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string
  accent?: 'red' | 'green' | 'orange' | 'default'
}) {
  const valueColor = accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-green-600' : accent === 'orange' ? 'text-orange-600' : 'text-gray-900'
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <p className={`text-base font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Lock screen ────────────────────────────────────────────────────────────

function LockScreen({ onUnlock, label }: { onUnlock: () => void; label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-700 mb-1">{label ?? 'Protected Data'}</p>
      <p className="text-xs text-gray-400 mb-5 max-w-xs">
        Verify with your authenticator app to view sensitive information.
      </p>
      <button
        onClick={onUnlock}
        className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
      >
        Unlock with Authenticator
      </button>
    </div>
  )
}

// ── Profile Tab ────────────────────────────────────────────────────────────

function ProfileTab({ tenant, lease, isUnlocked, onUnlock, onUpdated }: {
  tenant: Tenant
  lease: Lease
  isUnlocked: boolean
  onUnlock: () => void
  onUpdated: (t: Tenant) => void
}) {
  const { user } = useAuth()
  const canEdit = user?.role === 'owner' || user?.role === 'superadmin'

  const [firstName, setFirstName] = useState(tenant.first_name)
  const [lastName, setLastName] = useState(tenant.last_name)
  const [phone, setPhone] = useState(tenant.phone ?? '')
  const [isActive, setIsActive] = useState(tenant.is_active)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const days = daysUntil(lease.end_date)
  const expiry = expiryLabel(days)

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const updated = await tenantsApi.update(tenant.id, {
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
        is_active: isActive,
      })
      onUpdated(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const displayEmail = isUnlocked ? tenant.email : maskEmail(tenant.email)
  const displayPhone = isUnlocked ? (tenant.phone ?? '—') : (tenant.phone ? maskPhone(tenant.phone) : '—')

  return (
    <div className="p-6 space-y-6">
      {/* Lease context */}
      <section className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3">Current Lease</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Unit</p>
            <p className="font-semibold text-blue-900">{lease.unit_code ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Status</p>
            <p className="font-semibold text-blue-900 capitalize">{lease.status}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Start Date</p>
            <p className="font-medium text-blue-900">{fmtDate(lease.start_date)}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Expiry</p>
            <p className={`font-medium ${expiry.cls}`}>{expiry.text}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Monthly Rent</p>
            <p className="font-semibold text-blue-900">KES {fmt(lease.rent_amount)}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Deposit</p>
            <p className="font-semibold text-blue-900">KES {fmt(lease.deposit_amount)}</p>
          </div>
          <div>
            <p className="text-[10px] text-blue-500 uppercase tracking-wide mb-0.5">Ref No.</p>
            <p className="font-mono text-xs text-blue-700">{lease.reference_no}</p>
          </div>
        </div>
      </section>

      {/* Contact info */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
          {!isUnlocked && (
            <button onClick={onUnlock} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Unlock PII
            </button>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4">
          <InfoRow
            label="Email"
            value={
              <span className={`font-mono text-xs ${!isUnlocked ? 'text-gray-400 blur-[3px] select-none' : ''}`}>
                {displayEmail}
              </span>
            }
          />
          {canEdit ? (
            <>
              <div className="py-3 border-b border-gray-100">
                <p className="text-sm text-gray-500 mb-1.5">First Name</p>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="py-3 border-b border-gray-100">
                <p className="text-sm text-gray-500 mb-1.5">Last Name</p>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div className="py-3 border-b border-gray-100">
                <p className="text-sm text-gray-500 mb-1.5">Phone</p>
                <div className="relative">
                  <input
                    className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isUnlocked ? 'blur-[3px]' : ''}`}
                    value={isUnlocked ? phone : (phone ? maskPhone(phone) : '')}
                    onChange={(e) => isUnlocked && setPhone(e.target.value)}
                    readOnly={!isUnlocked}
                    placeholder="+254…"
                  />
                  {!isUnlocked && phone && (
                    <button onClick={onUnlock} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 font-medium">
                      Unlock
                    </button>
                  )}
                </div>
              </div>
              <div className="py-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Account active</span>
                </label>
              </div>
            </>
          ) : (
            <>
              <InfoRow label="First Name" value={tenant.first_name} />
              <InfoRow label="Last Name" value={tenant.last_name} />
              <InfoRow
                label="Phone"
                value={
                  <span className={!isUnlocked && tenant.phone ? 'blur-[3px] select-none' : ''}>
                    {displayPhone}
                  </span>
                }
              />
            </>
          )}
        </div>
      </section>

      {/* Account meta */}
      <section>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Account</p>
        <div className="bg-white rounded-xl border border-gray-200 px-4">
          <InfoRow label="Status" value={
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tenant.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {tenant.is_active ? 'Active' : 'Inactive'}
            </span>
          } />
          <InfoRow label="Member since" value={fmtDate(tenant.created_at)} />
          <InfoRow label="Last updated" value={fmtDate(tenant.updated_at)} />
        </div>
      </section>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saved && <p className="text-sm text-green-600">Saved!</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Payments Tab ───────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent', deposit: 'Deposit', utility_deposit: 'Utility Deposit',
  utility: 'Utility', late_fee: 'Late Fee', termination_fee: 'Termination Fee', refund: 'Refund',
}

const METHOD_LABELS: Record<string, string> = {
  manual: 'Manual', cash: 'Cash', bank_transfer: 'Bank Transfer',
  mpesa_stk: 'M-Pesa STK', mpesa_b2c: 'M-Pesa B2C',
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending:   'bg-yellow-100 text-yellow-700',
  failed:    'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
}

function PaymentsTab({ lease, summary: initialSummary }: { lease: Lease; summary: PaymentSummary | null }) {
  const [summary, setSummary] = useState<PaymentSummary | null>(initialSummary)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [view, setView] = useState<'payments' | 'ledger'>('payments')

  useEffect(() => {
    paymentsApi.getLedger(lease.id)
      .then(setLedger)
      .catch(() => {})
      .finally(() => setLedgerLoading(false))
  }, [lease.id])

  useEffect(() => {
    paymentsApi.list(lease.id).then(setSummary).catch(() => {})
  }, [lease.id])

  const arrears = summary ? calcRentArrears(lease, summary) : 0
  const credit  = summary ? calcCredit(lease, summary) : 0
  const depositPct = summary && summary.deposit_required > 0
    ? Math.min(100, (summary.deposit_paid / summary.deposit_required) * 100)
    : 100

  return (
    <div className="p-6 space-y-5">
      {summary ? (
        <div className="grid grid-cols-2 gap-3">
          <MiniCard label="Total Received" value={`KES ${fmt(summary.total_paid)}`} />
          <MiniCard
            label={arrears > 0 ? 'Rent Arrears' : 'Prepayment Credit'}
            value={`KES ${fmt(arrears > 0 ? arrears : credit)}`}
            accent={arrears > 0 ? 'red' : credit > 0 ? 'green' : 'default'}
            sub={arrears > 0 ? 'Overdue rent' : credit > 0 ? 'Available credit' : 'No balance'}
          />
          <div className="col-span-2 bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <span className="font-medium">Deposit</span>
              <span>KES {fmt(summary.deposit_paid)} / {fmt(summary.deposit_required)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${depositPct >= 100 ? 'bg-green-500' : 'bg-orange-400'}`}
                style={{ width: `${depositPct}%` }}
              />
            </div>
            <p className={`text-xs mt-1.5 ${depositPct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>
              {depositPct >= 100 ? 'Fully settled' : `KES ${fmt(summary.deposit_required - summary.deposit_paid)} outstanding`}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center text-sm text-gray-400 py-4">No payment data</div>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['payments', 'ledger'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={[
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {v === 'payments' ? 'Payments' : 'Ledger'}
          </button>
        ))}
      </div>

      {view === 'payments' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {!summary || summary.payments.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">No payments recorded</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Method</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{fmtDate(p.payment_date)}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                    <td className="px-4 py-3 text-gray-500">{METHOD_LABELS[p.method] ?? p.method}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.direction === 'outbound' ? 'text-red-600' : 'text-gray-900'}`}>
                      {p.direction === 'outbound' ? '−' : ''}KES {fmt(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PAYMENT_STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'ledger' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {ledgerLoading ? (
            <div className="text-center py-10 text-sm text-gray-400">Loading ledger…</div>
          ) : ledger.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">No ledger entries</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="px-4 py-3 text-gray-700">{e.description}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${e.type === 'debit' ? 'text-red-600' : 'text-green-700'}`}>
                      {e.type === 'debit' ? '−' : '+'}KES {fmt(e.amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium tabular-nums">
                      KES {fmt(e.running_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tickets Tab ────────────────────────────────────────────────────────────

function TicketsTab({ tenant }: { tenant: Tenant }) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    generalTicketsApi
      .list({ tenant_id: tenant.id, page_size: 50 })
      .then((res) => setTickets(res.items))
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [tenant.id])

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('en-KE', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  }

  return (
    <div className="p-6">
      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <span className="text-3xl block mb-3">🎫</span>
          <p className="text-sm font-medium text-gray-700 mb-1">No tickets yet</p>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Tickets submitted by <span className="font-medium">{tenant.first_name}</span> will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{t.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">
                    {t.category.replace(/_/g, ' ')} · {fmtDate(t.created_at)}
                  </p>
                </div>
                <TicketStatusBadge status={t.status} />
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <TicketDetailSlideOver
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => {
            generalTicketsApi
              .list({ tenant_id: tenant.id, page_size: 50 })
              .then((res) => setTickets(res.items))
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}

// ── Documents Tab ──────────────────────────────────────────────────────────

const ID_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID',
  passport: 'Passport',
  drivers_license: "Driver's Licence",
}

function DocumentsTab({ tenantId, leaseId, isUnlocked, mfaToken, onUnlock }: {
  tenantId: string
  leaseId: string
  isUnlocked: boolean
  mfaToken: string | null
  onUnlock: () => void
}) {
  const [onboardingId, setOnboardingId] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [docs, setDocs] = useState<OnboardingDocuments | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Find onboarding — try lease_id first (most reliable), fallback to tenant_id
  useEffect(() => {
    setOnboardingId(null)
    setNotFound(false)
    onboardingsApi.list({ lease_id: leaseId })
      .then((res) => {
        if (res.items?.length) {
          setOnboardingId(res.items[0].id)
          return
        }
        // Fallback: search by tenant_id
        return onboardingsApi.list({ tenant_id: tenantId })
          .then((res2) => {
            const latest = res2.items?.[0] ?? null
            if (latest) setOnboardingId(latest.id)
            else setNotFound(true)
          })
      })
      .catch(() => setNotFound(true))
  }, [leaseId, tenantId])

  // Fetch documents when unlocked + onboardingId is known
  useEffect(() => {
    if (!isUnlocked || !mfaToken || !onboardingId) return
    setLoading(true)
    setError(null)
    onboardingsApi.getDocuments(onboardingId, mfaToken)
      .then(setDocs)
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [isUnlocked, mfaToken, onboardingId])

  if (!isUnlocked) {
    return <LockScreen onUnlock={onUnlock} label="ID Documents & KYC" />
  }

  if (notFound) {
    return (
      <div className="p-6 text-center py-16">
        <p className="text-sm text-gray-400">No onboarding record found for this tenant.</p>
      </div>
    )
  }

  if (!onboardingId) {
    return <div className="p-6 text-center py-16 text-sm text-gray-400">Searching…</div>
  }

  if (loading) {
    return <div className="p-6 text-center py-16 text-sm text-gray-400">Loading documents…</div>
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Status badge */}
      {docs && (
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
            docs.status === 'signed' || docs.status === 'activated' ? 'bg-green-100 text-green-700' :
            docs.status === 'kyc_submitted' ? 'bg-blue-100 text-blue-700' :
            docs.status ? 'bg-gray-100 text-gray-600' : 'hidden'
          }`}>
            {(docs.status ?? '').replace(/_/g, ' ')}
          </span>
          {docs.signed_at && (
            <span className="text-xs text-gray-400">
              Signed {fmtDate(docs.signed_at)}
            </span>
          )}
        </div>
      )}

      {/* ID info */}
      {docs && (docs.id_type || docs.id_number || docs.first_name || docs.date_of_birth || docs.phone) && (
        <section className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Identity Details</p>
          <div className="grid grid-cols-2 gap-3">
            {docs.id_type && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">ID Type</p>
                <p className="text-sm font-medium text-gray-900">{ID_TYPE_LABELS[docs.id_type] ?? docs.id_type}</p>
              </div>
            )}
            {docs.id_number && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">ID Number</p>
                <p className="text-sm font-mono text-gray-900">{docs.id_number}</p>
              </div>
            )}
            {docs.first_name && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Name on ID</p>
                <p className="text-sm font-medium text-gray-900">{docs.first_name} {docs.last_name}</p>
              </div>
            )}
            {docs.date_of_birth && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Date of Birth</p>
                <p className="text-sm text-gray-900">{docs.date_of_birth}</p>
              </div>
            )}
            {docs.phone && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Phone</p>
                <p className="text-sm text-gray-900">{docs.phone}</p>
              </div>
            )}
            {docs.emergency_contact_name && (
              <div className="col-span-2">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Emergency Contact</p>
                <p className="text-sm text-gray-900">{docs.emergency_contact_name} {docs.emergency_contact_phone ? `· ${docs.emergency_contact_phone}` : ''}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Document photos */}
      <section className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ID Documents</p>
        {(!docs?.id_front_url && !docs?.id_back_url && !docs?.selfie_url) ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-400">No ID documents uploaded yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {docs?.id_front_url && <DocCard label="ID Front" url={docs.id_front_url} />}
            {docs?.id_back_url && <DocCard label="ID Back" url={docs.id_back_url} />}
            {docs?.selfie_url && <DocCard label="Selfie" url={docs.selfie_url} className="col-span-2" />}
          </div>
        )}
      </section>

      {/* Signature */}
      {docs?.signature_url && (
        <section className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tenant Signature</p>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Lease Signature</span>
              <a href={docs.signature_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline">
                Open ↗
              </a>
            </div>
            <div className="bg-gray-50 flex items-center justify-center p-4 min-h-[120px]">
              <img
                src={docs.signature_url}
                alt="Tenant signature"
                className="max-h-28 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            {docs.signed_at && (
              <div className="px-3 py-2 text-[10px] text-gray-400 text-right border-t border-gray-100">
                Signed {fmtDate(docs.signed_at)}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function DocCard({ label, url, className }: { label: string; url: string; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${className ?? ''}`}>
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-600 hover:underline"
        >
          Open ↗
        </a>
      </div>
      <img
        src={url}
        alt={label}
        className="w-full object-cover max-h-48"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export interface TenantSlideOverRow {
  lease: Lease
  tenant: Tenant | null
  summary: PaymentSummary | null
}

interface Props {
  row: TenantSlideOverRow | null
  onClose: () => void
  onTenantUpdated?: (t: Tenant) => void
}

export default function TenantSlideOver({ row, onClose, onTenantUpdated }: Props) {
  const { user } = useAuth()
  const canSeePii = user?.role === 'owner' || user?.role === 'superadmin'

  const [tab, setTab] = useState<Tab>('profile')
  const [tenant, setTenant] = useState<Tenant | null>(row?.tenant ?? null)
  const [showPinModal, setShowPinModal] = useState(false)

  const { isUnlocked, token: mfaToken, unlock } = useMfaSession()

  // Sync tenant state when row changes
  useEffect(() => {
    setTenant(row?.tenant ?? null)
    setTab('profile')
  }, [row?.lease.id])

  // Fetch tenant if missing
  useEffect(() => {
    if (!row || row.tenant || !row.lease.tenant_id) return
    tenantsApi.get(row.lease.tenant_id).then(setTenant).catch(() => {})
  }, [row?.lease.tenant_id])

  if (!row) return null

  const { lease, summary } = row

  function handleUpdated(t: Tenant) {
    setTenant(t)
    onTenantUpdated?.(t)
  }

  function handleUnlock() {
    if (canSeePii) setShowPinModal(true)
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-4 px-6 py-5 border-b border-gray-100 shrink-0">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-blue-700">
              {tenant?.first_name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">
              {tenant ? `${tenant.first_name} ${tenant.last_name}` : 'Loading…'}
            </h2>
            <p className={`text-sm truncate ${!isUnlocked ? 'text-gray-400' : 'text-gray-500'}`}>
              {tenant ? (isUnlocked ? tenant.email : maskEmail(tenant.email)) : '—'}
            </p>
            {tenant?.phone && (
              <p className={`text-xs mt-0.5 ${!isUnlocked ? 'text-gray-300' : 'text-gray-400'}`}>
                {isUnlocked ? tenant.phone : maskPhone(tenant.phone)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isUnlocked ? (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                Unlocked
              </span>
            ) : (
              canSeePii && (
                <button
                  onClick={handleUnlock}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Unlock PII
                </button>
              )
            )}
            {tenant && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${tenant.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {tenant.is_active ? 'Active' : 'Inactive'}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 shrink-0 overflow-x-auto">
          <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')}>Profile</TabBtn>
          <TabBtn active={tab === 'payments'} onClick={() => setTab('payments')}>Payments &amp; Ledger</TabBtn>
          <TabBtn active={tab === 'tickets'} onClick={() => setTab('tickets')}>Tickets</TabBtn>
          {canSeePii && (
            <TabBtn active={tab === 'documents'} onClick={() => setTab('documents')}>
              <span className="flex items-center gap-1.5">
                Documents
                {!isUnlocked && (
                  <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </span>
            </TabBtn>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'profile' && tenant && (
            <ProfileTab
              tenant={tenant}
              lease={lease}
              isUnlocked={isUnlocked}
              onUnlock={handleUnlock}
              onUpdated={handleUpdated}
            />
          )}
          {tab === 'profile' && !tenant && (
            <div className="p-6 text-sm text-gray-400 text-center py-16">Loading tenant…</div>
          )}
          {tab === 'payments' && (
            <PaymentsTab lease={lease} summary={summary} />
          )}
          {tab === 'tickets' && tenant && (
            <TicketsTab tenant={tenant} />
          )}
          {tab === 'documents' && tenant && (
            <DocumentsTab
              tenantId={tenant.id}
              leaseId={lease.id}
              isUnlocked={isUnlocked}
              mfaToken={mfaToken}
              onUnlock={handleUnlock}
            />
          )}
        </div>
      </div>

      {/* MFA PIN modal */}
      {showPinModal && (
        <MfaPinModal
          onUnlocked={(token, expiresIn) => {
            unlock(token, expiresIn)
            setShowPinModal(false)
          }}
          onClose={() => setShowPinModal(false)}
        />
      )}
    </>
  )
}
