import { useEffect, useState } from 'react'
import { leasesApi } from '@/api/leases'
import { paymentsApi } from '@/api/payments'
import { invoicesApi } from '@/api/invoices'
import { inspectionsApi } from '@/api/inspections'
import { deductionsApi } from '@/api/deductions'
import { ticketsApi } from '@/api/tickets'
import { onboardingsApi } from '@/api/onboardings'
import { extractApiError } from '@/utils/apiError'
import RecordPaymentModal from './RecordPaymentModal'
import RefundDepositModal from './RefundDepositModal'
import ApplyDiscountModal from './ApplyDiscountModal'
import type { Lease } from '@/types/lease'
import type { PaymentSummary, LedgerEntry } from '@/types/payment'
import type { InspectionReport } from '@/types/inspection'
import type { DeductionSummary } from '@/types/deduction'
import type { MaintenanceTicket } from '@/types/ticket'

type Tab = 'overview' | 'payments' | 'inspections' | 'financials' | 'tenancy'

// Sub-tab types per parent tab
type InspectionSubTab = 'pre_inspection' | 'utility' | 'move_out'
type TenancySubTab = 'escalations' | 'renewal' | 'co_tenants' | 'notes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'payments', label: 'Payments' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'financials', label: 'Financials' },
  { id: 'tenancy', label: 'Tenancy' },
]

const INSPECTION_SUBTABS: { id: InspectionSubTab; label: string }[] = [
  { id: 'pre_inspection', label: 'Pre-Move-In' },
  { id: 'utility', label: 'Utility Readings' },
  { id: 'move_out', label: 'Move-Out' },
]


const TENANCY_SUBTABS: { id: TenancySubTab; label: string }[] = [
  { id: 'escalations', label: 'Escalations' },
  { id: 'renewal', label: 'Renewal' },
  { id: 'co_tenants', label: 'Co-Tenants' },
  { id: 'notes', label: 'Notes & Rating' },
]

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_payment: 'bg-yellow-100 text-yellow-800',
  pending_signature: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  expired: 'bg-orange-100 text-orange-700',
  terminated: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_payment: 'Pending Payment',
  pending_signature: 'Awaiting Signature',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
}

function fmt(n: number) {
  return `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Derive prepayment credit from raw payment data (backend value may be 0 if not yet computed). */
function calcCredit(summary: PaymentSummary, rentAmount: number): number {
  if (summary.prepayment_credit > 0) return summary.prepayment_credit
  const depositCredit = Math.max(0, summary.deposit_paid - summary.deposit_required)
  const rentPaid = summary.payments
    .filter((p) => p.status === 'completed' && p.direction === 'inbound' && p.category === 'rent')
    .reduce((sum, p) => sum + p.amount, 0)
  const rentCredit = Math.max(0, rentPaid - rentAmount)
  return depositCredit + rentCredit
}

interface Props {
  lease: Lease | null
  onClose: () => void
  onboardingId?: string | null
  onLeaseUpdated?: (lease: Lease) => void
}

export default function LeaseDetailSlideOver({ lease, onClose, onboardingId, onLeaseUpdated }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [inspectionSubTab, setInspectionSubTab] = useState<InspectionSubTab>('pre_inspection')
const [tenancySubTab, setTenancySubTab] = useState<TenancySubTab>('escalations')
  const [currentLease, setCurrentLease] = useState<Lease | null>(lease)
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [inspections, setInspections] = useState<InspectionReport[]>([])
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([])
  const [deductionSummary, setDeductionSummary] = useState<DeductionSummary | null>(null)
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [loadingInspections, setLoadingInspections] = useState(false)
  const [loadingDeductions, setLoadingDeductions] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState(false)
  const [showRefund, setShowRefund] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const [addDeductionOpen, setAddDeductionOpen] = useState(false)
  const [deductionForm, setDeductionForm] = useState({ category: 'damage', description: '', amount: '' })
  const [deductionError, setDeductionError] = useState<string | null>(null)
  const [deductionLoading, setDeductionLoading] = useState(false)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [removingDiscountId, setRemovingDiscountId] = useState<string | null>(null)

  // Escalations tab state
  const [escalationForm, setEscalationForm] = useState({ effective_date: '', new_rent_amount: '', note: '' })
  const [escalationSaving, setEscalationSaving] = useState(false)
  const [escalationError, setEscalationError] = useState<string | null>(null)

  // Renewal tab state
  const [renewalForm, setRenewalForm] = useState({ new_rent_amount: '', new_end_date: '', message: '' })
  const [renewalSaving, setRenewalSaving] = useState(false)
  const [renewalError, setRenewalError] = useState<string | null>(null)
  const [etForm, setEtForm] = useState({ penalty_type: 'fixed', penalty_value: '', notice_days: '', note: '' })
  const [etSaving, setEtSaving] = useState(false)
  const [etError, setEtError] = useState<string | null>(null)

  // Co-tenants tab state
  const [coTenantFormOpen, setCoTenantFormOpen] = useState(false)
  const [coTenantForm, setCoTenantForm] = useState({ first_name: '', last_name: '', role: 'co_tenant', email: '', phone: '', id_type: 'national_id', id_number: '' })
  const [coTenantSaving, setCoTenantSaving] = useState(false)
  const [coTenantError, setCoTenantError] = useState<string | null>(null)

  // Notes & Rating tab state
  const [ratingForm, setRatingForm] = useState({ score: '', payment_timeliness: '', property_care: '', communication: '', note: '' })
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const [noteForm, setNoteForm] = useState({ body: '', is_private: false })
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  useEffect(() => { setCurrentLease(lease) }, [lease?.id])

  const isOpen = lease !== null
  const activeLease = currentLease ?? lease
  const canSign = activeLease && !activeLease.signed_at && ['draft', 'pending_payment', 'pending_signature'].includes(activeLease.status)

  function handleLeaseUpdatedFromDiscount(updated: Lease) {
    setCurrentLease(updated)
    onLeaseUpdated?.(updated)
    setShowDiscountModal(false)
  }

  async function handleRemoveDiscount(discountId: string) {
    if (!activeLease) return
    setRemovingDiscountId(discountId)
    try {
      const updated = await leasesApi.removeDiscount(activeLease.id, discountId)
      setCurrentLease(updated)
      onLeaseUpdated?.(updated)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setRemovingDiscountId(null)
    }
  }

  async function handleDownloadPdf() {
    if (!onboardingId) return
    setPdfDownloading(true)
    try {
      const { url } = await onboardingsApi.getLeasePdfUrl(onboardingId)
      const a = document.createElement('a')
      a.href = url
      a.download = `lease-${lease?.reference_no ?? 'agreement'}.pdf`
      a.target = '_blank'
      a.click()
    } catch {
      // PDF not yet generated — silently fail; button won't show if this errors
    } finally {
      setPdfDownloading(false)
    }
  }

  async function handleSignLease() {
    if (!lease) return
    setSigning(true)
    setSignError(null)
    try {
      const updated = await leasesApi.sign(lease.id)
      // Reload payments to reflect new status
      loadPayments()
      // Notify parent to refresh the lease object
      onClose()
      // A full page reload or parent re-fetch would pick up the new status
      // For now surface the new status via alert briefly
      void updated
    } catch (err) {
      setSignError(extractApiError(err).message)
    } finally {
      setSigning(false)
    }
  }

  useEffect(() => {
    if (!lease) return
    setTab('overview')
    loadPayments()
    loadInspections()
    loadDeductions()
    loadTickets()
  }, [lease?.id])

  async function loadPayments() {
    if (!lease) return
    setLoadingPayments(true)
    setPaymentsError(null)
    try {
      const summary = await paymentsApi.list(lease.id)
      console.log('[payments]', { total_paid: summary.total_paid, deposit_paid: summary.deposit_paid, deposit_required: summary.deposit_required, prepayment_credit: summary.prepayment_credit })
      setPaymentSummary(summary)
    } catch (err) {
      const msg = extractApiError(err).message
      setPaymentsError(msg)
      console.error('loadPayments error:', err)
    } finally {
      setLoadingPayments(false)
    }
    try {
      const entries = await paymentsApi.getLedger(lease.id)
      setLedger(entries)
    } catch (err) {
      console.error('getLedger error:', err)
    }
  }

  async function loadInspections() {
    if (!lease) return
    setLoadingInspections(true)
    try {
      const reports = await inspectionsApi.list(lease.id)
      setInspections(reports)
    } catch { /* ignore */ }
    finally { setLoadingInspections(false) }
  }

  async function loadTickets() {
    if (!lease) return
    try {
      const t = await ticketsApi.list(lease.id)
      setTickets(t)
    } catch { /* ignore */ }
  }

  async function loadDeductions() {
    if (!lease) return
    setLoadingDeductions(true)
    try {
      const summary = await deductionsApi.list(lease.id)
      setDeductionSummary(summary)
    } catch { /* ignore */ }
    finally { setLoadingDeductions(false) }
  }

  async function sendInspectionLink(type: 'pre_move_in' | 'move_out') {
    if (!lease) return
    try {
      await inspectionsApi.create(lease.id, { type })
      await loadInspections()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function reviewInspection(reportId: string) {
    try {
      await inspectionsApi.review(reportId)
      await loadInspections()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleResolveTicket(
    ticketId: string,
    reading: number,
    notes: string,
    files: File[],
  ) {
    try {
      await ticketsApi.resolve(ticketId, { resolution_reading: reading, resolution_notes: notes || undefined }, files)
      await loadTickets()
      await loadInspections()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleDeleteDeduction(id: string) {
    if (!confirm('Remove this deduction?')) return
    try {
      await deductionsApi.delete(id)
      await loadDeductions()
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleAddDeduction(e: React.FormEvent) {
    e.preventDefault()
    if (!lease) return
    setDeductionError(null)
    setDeductionLoading(true)
    try {
      await deductionsApi.create(lease.id, {
        category: deductionForm.category as any,
        description: deductionForm.description,
        amount: parseFloat(deductionForm.amount),
      })
      setDeductionForm({ category: 'damage', description: '', amount: '' })
      setAddDeductionOpen(false)
      await loadDeductions()
    } catch (err) {
      setDeductionError(extractApiError(err).message)
    } finally {
      setDeductionLoading(false)
    }
  }

  async function handleAddEscalation(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setEscalationSaving(true)
    setEscalationError(null)
    try {
      const result = await leasesApi.addEscalation(currentLease.id, {
        effective_date: escalationForm.effective_date,
        new_rent_amount: parseFloat(escalationForm.new_rent_amount),
        note: escalationForm.note || undefined,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
      setEscalationForm({ effective_date: '', new_rent_amount: '', note: '' })
    } catch (err) {
      setEscalationError(extractApiError(err).message)
    } finally {
      setEscalationSaving(false)
    }
  }

  async function handleRemoveEscalation(escalationId: string) {
    if (!currentLease) return
    if (!confirm('Remove this escalation?')) return
    try {
      const result = await leasesApi.removeEscalation(currentLease.id, escalationId)
      setCurrentLease(result)
      onLeaseUpdated?.(result)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleSendRenewalOffer(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setRenewalSaving(true)
    setRenewalError(null)
    try {
      const result = await leasesApi.sendRenewalOffer(currentLease.id, {
        new_rent_amount: parseFloat(renewalForm.new_rent_amount),
        new_end_date: renewalForm.new_end_date || undefined,
        message: renewalForm.message || undefined,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
      setRenewalForm({ new_rent_amount: '', new_end_date: '', message: '' })
    } catch (err) {
      setRenewalError(extractApiError(err).message)
    } finally {
      setRenewalSaving(false)
    }
  }

  async function handleRespondRenewal(accepted: boolean) {
    if (!currentLease) return
    try {
      const result = await leasesApi.respondRenewal(currentLease.id, accepted)
      setCurrentLease(result)
      onLeaseUpdated?.(result)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleSetEarlyTermination(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setEtSaving(true)
    setEtError(null)
    try {
      const result = await leasesApi.setEarlyTermination(currentLease.id, {
        penalty_type: etForm.penalty_type as 'months' | 'fixed',
        penalty_value: parseFloat(etForm.penalty_value),
        notice_days: parseInt(etForm.notice_days, 10),
        note: etForm.note || undefined,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
    } catch (err) {
      setEtError(extractApiError(err).message)
    } finally {
      setEtSaving(false)
    }
  }

  async function handleAddCoTenant(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setCoTenantSaving(true)
    setCoTenantError(null)
    try {
      const result = await leasesApi.addCoTenant(currentLease.id, {
        first_name: coTenantForm.first_name,
        last_name: coTenantForm.last_name,
        role: coTenantForm.role as 'co_tenant' | 'guarantor',
        email: coTenantForm.email || undefined,
        phone: coTenantForm.phone || undefined,
        id_type: coTenantForm.id_type || undefined,
        id_number: coTenantForm.id_number || undefined,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
      setCoTenantForm({ first_name: '', last_name: '', role: 'co_tenant', email: '', phone: '', id_type: 'national_id', id_number: '' })
      setCoTenantFormOpen(false)
    } catch (err) {
      setCoTenantError(extractApiError(err).message)
    } finally {
      setCoTenantSaving(false)
    }
  }

  async function handleRemoveCoTenant(coTenantId: string) {
    if (!currentLease) return
    if (!confirm('Remove this co-tenant?')) return
    try {
      const result = await leasesApi.removeCoTenant(currentLease.id, coTenantId)
      setCurrentLease(result)
      onLeaseUpdated?.(result)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleRateTenant(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setRatingSaving(true)
    setRatingError(null)
    try {
      const result = await leasesApi.rateTenant(currentLease.id, {
        score: parseInt(ratingForm.score, 10),
        payment_timeliness: parseInt(ratingForm.payment_timeliness, 10),
        property_care: parseInt(ratingForm.property_care, 10),
        communication: parseInt(ratingForm.communication, 10),
        note: ratingForm.note || undefined,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
    } catch (err) {
      setRatingError(extractApiError(err).message)
    } finally {
      setRatingSaving(false)
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!currentLease) return
    setNoteSaving(true)
    setNoteError(null)
    try {
      const result = await leasesApi.addNote(currentLease.id, {
        body: noteForm.body,
        is_private: noteForm.is_private,
      })
      setCurrentLease(result)
      onLeaseUpdated?.(result)
      setNoteForm({ body: '', is_private: false })
    } catch (err) {
      setNoteError(extractApiError(err).message)
    } finally {
      setNoteSaving(false)
    }
  }

  const preInspection = inspections.find((r) => r.type === 'pre_move_in')
  const moveOutInspection = inspections.find((r) => r.type === 'move_out')

  if (!isOpen || !activeLease) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-4xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold text-gray-900">{activeLease.reference_no}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[activeLease.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABELS[activeLease.status] ?? activeLease.status}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {onboardingId && (
              <button
                onClick={handleDownloadPdf}
                disabled={pdfDownloading}
                title="Download signed lease PDF"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {pdfDownloading ? 'Downloading...' : 'PDF'}
              </button>
            )}
            {canSign && (
              <button
                onClick={handleSignLease}
                disabled={signing}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {signing ? 'Signing...' : 'Sign Lease'}
              </button>
            )}
            {signError && <span className="text-xs text-red-600">{signError}</span>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {/* Primary Tabs */}
        <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-tabs for Inspections */}
        {tab === 'inspections' && (
          <div className="flex gap-1 px-6 pt-3 pb-1 shrink-0 border-b border-gray-50">
            {INSPECTION_SUBTABS.map((s) => (
              <button
                key={s.id}
                onClick={() => setInspectionSubTab(s.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  inspectionSubTab === s.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Sub-tabs for Tenancy */}
        {tab === 'tenancy' && (
          <div className="flex gap-1 px-6 pt-3 pb-1 shrink-0 border-b border-gray-50">
            {TENANCY_SUBTABS.map((s) => (
              <button
                key={s.id}
                onClick={() => setTenancySubTab(s.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  tenancySubTab === s.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' && (
            <OverviewPanel
              lease={activeLease}
              paymentSummary={paymentSummary}
              onAddDiscount={() => setShowDiscountModal(true)}
              onRemoveDiscount={handleRemoveDiscount}
              removingDiscountId={removingDiscountId}
            />
          )}

          {tab === 'payments' && (
            <PaymentsPanel
              lease={activeLease}
              summary={paymentSummary}
              ledger={ledger}
              loading={loadingPayments}
              error={paymentsError}
              onRecordPayment={() => setShowRecordPayment(true)}
              onRefresh={loadPayments}
            />
          )}

          {tab === 'inspections' && inspectionSubTab === 'pre_inspection' && (
            <InspectionPanel
              type="pre_move_in"
              report={preInspection}
              loading={loadingInspections}
              onSendLink={() => sendInspectionLink('pre_move_in')}
              onReview={(id) => reviewInspection(id)}
              tickets={tickets.filter((t) => t.inspection_report_id === preInspection?.id)}
              onResolveTicket={handleResolveTicket}
            />
          )}

          {tab === 'inspections' && inspectionSubTab === 'utility' && (
            <UtilityUsagePanel leaseId={activeLease?.id ?? ''} />
          )}

          {tab === 'inspections' && inspectionSubTab === 'move_out' && (
            <InspectionPanel
              type="move_out"
              report={moveOutInspection}
              loading={loadingInspections}
              onSendLink={() => sendInspectionLink('move_out')}
              onReview={(id) => reviewInspection(id)}
              tickets={tickets.filter((t) => t.inspection_report_id === moveOutInspection?.id)}
              onResolveTicket={handleResolveTicket}
            />
          )}

          {tab === 'financials' && (
            <DeductionsPanel
              lease={activeLease}
              summary={deductionSummary}
              paymentSummary={paymentSummary}
              loading={loadingDeductions}
              addOpen={addDeductionOpen}
              deductionForm={deductionForm}
              deductionError={deductionError}
              deductionLoading={deductionLoading}
              onAddOpen={() => setAddDeductionOpen(true)}
              onFormChange={setDeductionForm}
              onAddSubmit={handleAddDeduction}
              onAddCancel={() => setAddDeductionOpen(false)}
              onDelete={handleDeleteDeduction}
              onRefund={() => setShowRefund(true)}
            />
          )}

          {tab === 'tenancy' && tenancySubTab === 'escalations' && (
            <EscalationsPanel
              lease={currentLease ?? activeLease}
              escalationForm={escalationForm}
              escalationSaving={escalationSaving}
              escalationError={escalationError}
              onFormChange={setEscalationForm}
              onAddSubmit={handleAddEscalation}
              onRemove={handleRemoveEscalation}
            />
          )}

          {tab === 'tenancy' && tenancySubTab === 'renewal' && (
            <RenewalPanel
              lease={currentLease ?? activeLease}
              renewalForm={renewalForm}
              renewalSaving={renewalSaving}
              renewalError={renewalError}
              etForm={etForm}
              etSaving={etSaving}
              etError={etError}
              onRenewalFormChange={setRenewalForm}
              onSendRenewal={handleSendRenewalOffer}
              onRespond={handleRespondRenewal}
              onEtFormChange={setEtForm}
              onSetEt={handleSetEarlyTermination}
            />
          )}

          {tab === 'tenancy' && tenancySubTab === 'co_tenants' && (
            <CoTenantsPanel
              lease={currentLease ?? activeLease}
              formOpen={coTenantFormOpen}
              coTenantForm={coTenantForm}
              coTenantSaving={coTenantSaving}
              coTenantError={coTenantError}
              onFormOpen={() => setCoTenantFormOpen(true)}
              onFormCancel={() => setCoTenantFormOpen(false)}
              onFormChange={setCoTenantForm}
              onAddSubmit={handleAddCoTenant}
              onRemove={handleRemoveCoTenant}
            />
          )}

          {tab === 'tenancy' && tenancySubTab === 'notes' && (
            <NotesRatingPanel
              lease={currentLease ?? activeLease}
              ratingForm={ratingForm}
              ratingSaving={ratingSaving}
              ratingError={ratingError}
              noteForm={noteForm}
              noteSaving={noteSaving}
              noteError={noteError}
              onRatingFormChange={setRatingForm}
              onRateSubmit={handleRateTenant}
              onNoteFormChange={setNoteForm}
              onNoteSubmit={handleAddNote}
            />
          )}
        </div>
      </div>

      {showRecordPayment && activeLease && (
        <RecordPaymentModal
          lease={activeLease}
          onClose={() => setShowRecordPayment(false)}
          onSuccess={() => { setShowRecordPayment(false); loadPayments() }}
        />
      )}

      {showRefund && activeLease && paymentSummary && deductionSummary && (
        <RefundDepositModal
          leaseId={activeLease.id}
          depositHeld={paymentSummary.deposit_paid}
          totalDeductions={deductionSummary.total}
          onClose={() => setShowRefund(false)}
          onSuccess={() => { setShowRefund(false); loadPayments(); loadDeductions() }}
        />
      )}

      {showDiscountModal && activeLease && (
        <ApplyDiscountModal
          lease={activeLease}
          onClose={() => setShowDiscountModal(false)}
          onUpdated={handleLeaseUpdatedFromDiscount}
        />
      )}
    </>
  )
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function OverviewPanel({
  lease,
  paymentSummary,
  onAddDiscount,
  onRemoveDiscount,
  removingDiscountId,
}: {
  lease: Lease
  paymentSummary: PaymentSummary | null
  onAddDiscount: () => void
  onRemoveDiscount: (discountId: string) => void
  removingDiscountId: string | null
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      <section className="grid grid-cols-2 gap-4">
        <InfoRow label="Unit" value={lease.unit_code || lease.unit_id} />
        <InfoRow label="Status" value={STATUS_LABELS[lease.status] ?? lease.status} />
        <InfoRow label="Start Date" value={fmtDate(lease.start_date)} />
        <InfoRow label="End Date" value={lease.end_date ? fmtDate(lease.end_date) : '—'} />
        <div>
          <p className="text-xs text-gray-500">Monthly Rent</p>
          {lease.discount_amount > 0 ? (
            <div>
              <p className="text-xs text-gray-400 line-through mt-0.5">{fmt(lease.rent_amount)}</p>
              <p className="text-sm font-bold text-green-700 mt-0.5">{fmt(lease.effective_rent)}<span className="text-xs font-normal">/mo</span></p>
              <p className="text-xs text-green-600 mt-0.5">Saving {fmt(lease.discount_amount)}/mo</p>
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-900 mt-0.5">{fmt(lease.rent_amount)}</p>
          )}
        </div>
        <InfoRow label="Security Deposit" value={fmt(lease.deposit_amount)} />
        {lease.utility_deposit && (
          <InfoRow label="Utility Deposit" value={fmt(lease.utility_deposit)} />
        )}
        {lease.activated_at && (
          <InfoRow label="Activated" value={fmtDate(lease.activated_at)} />
        )}
      </section>

      {lease.notes && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes</p>
          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{lease.notes}</p>
        </section>
      )}

      {/* Discounts section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Rent Discounts</p>
          {!['terminated', 'expired'].includes(lease.status) && (
            <button
              onClick={onAddDiscount}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Add Discount
            </button>
          )}
        </div>
        {(lease.discounts ?? []).length === 0 ? (
          <p className="text-xs text-gray-400 italic">No discounts applied.</p>
        ) : (
          <div className="space-y-2">
            {(lease.discounts ?? []).map((d) => {
              const today = new Date().toISOString().slice(0, 10)
              const isActive = d.effective_from <= today && (!d.effective_to || d.effective_to >= today)
              return (
                <div key={d.id} className={`flex items-start justify-between rounded-lg p-3 border ${isActive ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{d.label}</span>
                      {isActive && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">Active</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {d.type === 'fixed' ? `KES ${d.value.toLocaleString()} off` : `${d.value}% off`}
                      {' · '}From {d.effective_from}{d.effective_to ? ` to ${d.effective_to}` : ' (ongoing)'}
                    </p>
                    {d.note && <p className="text-xs text-gray-400 mt-0.5 italic">{d.note}</p>}
                  </div>
                  {!['terminated', 'expired'].includes(lease.status) && (
                    <button
                      onClick={() => onRemoveDiscount(d.id)}
                      disabled={removingDiscountId === d.id}
                      className="ml-3 text-xs text-red-500 hover:text-red-700 shrink-0 disabled:opacity-50"
                    >
                      {removingDiscountId === d.id ? '...' : 'Remove'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {paymentSummary && (
        <section>
          {(() => {
            const credit = calcCredit(paymentSummary, lease.rent_amount)
            return (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Payments</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">Total Received</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(paymentSummary.total_paid)}</p>
                  </div>
                  {credit > 0 ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <p className="text-xs text-emerald-600 font-medium">Prepayment Credit</p>
                      <p className="text-sm font-bold text-emerald-700 mt-0.5">{fmt(credit)}</p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Balance</p>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(paymentSummary.balance)}</p>
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Paid: {fmt(paymentSummary.deposit_paid)}</span>
                  <span>Required: {fmt(paymentSummary.deposit_required)}</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1.5">
                  <div
                    className={`h-full rounded-full ${paymentSummary.fully_paid ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, paymentSummary.deposit_required > 0 ? (paymentSummary.deposit_paid / paymentSummary.deposit_required) * 100 : 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-400 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Security deposit</span>
                    <span>{fmt(lease.deposit_amount)}</span>
                  </div>
                  {lease.utility_deposit ? (
                    <div className="flex justify-between">
                      <span>Utility deposit</span>
                      <span>{fmt(lease.utility_deposit)}</span>
                    </div>
                  ) : null}
                  {paymentSummary.prorated_rent != null && (
                    <div className="flex justify-between">
                      <span>Pro-rated rent ({paymentSummary.prorated_days}/{paymentSummary.days_in_month} days)</span>
                      <span>{fmt(paymentSummary.prorated_rent)}</span>
                    </div>
                  )}
                </div>
              </>
            )
          })()}
        </section>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function PaymentsPanel({
  lease, summary, loading, error, onRecordPayment,
}: {
  lease?: Lease
  summary: PaymentSummary | null
  ledger?: LedgerEntry[]
  loading: boolean
  error?: string | null
  onRecordPayment: () => void
  onRefresh?: () => void
}) {
  if (loading) return <Spinner />
  const credit = summary && lease ? calcCredit(summary, lease.rent_amount) : 0
  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Total Received</p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(summary.total_paid)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">Total Refunded</p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(summary.total_refunded)}</p>
            </div>
            {credit > 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <p className="text-xs text-emerald-600 font-medium">Prepayment Credit</p>
                <p className="text-sm font-bold text-emerald-700 mt-0.5">{fmt(credit)}</p>
                <p className="text-[10px] text-emerald-500 mt-0.5">offsets future rent</p>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Balance</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(summary.balance)}</p>
              </div>
            )}
          </div>

          {/* Deposit progress bar */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs font-medium text-gray-500 mb-2">Move-in Required</p>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Paid: {fmt(summary.deposit_paid)}</span>
              <span>Required: {fmt(summary.deposit_required)}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
              {(() => {
                const pct = summary.deposit_required > 0
                  ? Math.min(100, (summary.deposit_paid / summary.deposit_required) * 100) : 100
                return (
                  <div
                    className={`h-full rounded-full transition-all ${summary.fully_paid ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                )
              })()}
            </div>
            <div className="text-[10px] text-gray-400 space-y-0.5">
              {lease && (
                <>
                  <div className="flex justify-between">
                    <span>Security deposit</span>
                    <span>{fmt(lease.deposit_amount)}</span>
                  </div>
                  {lease.utility_deposit ? (
                    <div className="flex justify-between">
                      <span>Utility deposit</span>
                      <span>{fmt(lease.utility_deposit)}</span>
                    </div>
                  ) : null}
                </>
              )}
              {summary.prorated_rent != null && (
                <div className="flex justify-between">
                  <span>Pro-rated rent ({summary.prorated_days}/{summary.days_in_month} days)</span>
                  <span>{fmt(summary.prorated_rent)}</span>
                </div>
              )}
            </div>
            {summary.fully_paid && (
              <p className="text-xs text-green-600 font-medium mt-1.5">Move-in amount fully paid — lease activated</p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Payment History</h3>
        <button
          onClick={onRecordPayment}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          + Record Payment
        </button>
      </div>

      {!summary?.payments.length ? (
        <p className="text-sm text-gray-500">No payments recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs text-gray-500 font-medium pb-2">Date</th>
              <th className="text-left text-xs text-gray-500 font-medium pb-2">Category</th>
              <th className="text-left text-xs text-gray-500 font-medium pb-2">Method</th>
              <th className="text-right text-xs text-gray-500 font-medium pb-2">Amount</th>
              <th className="text-left text-xs text-gray-500 font-medium pb-2 pl-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {summary?.payments.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="py-2 text-gray-600">{fmtDate(p.payment_date)}</td>
                <td className="py-2 text-gray-700 capitalize">{p.category.replace(/_/g, ' ')}</td>
                <td className="py-2 text-gray-600 capitalize">{p.method.replace(/_/g, ' ')}</td>
                <td className={`py-2 text-right font-medium ${p.direction === 'outbound' ? 'text-red-600' : 'text-gray-900'}`}>
                  {p.direction === 'outbound' ? '−' : ''}{fmt(p.amount)}
                </td>
                <td className="py-2 pl-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[p.status]}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function InspectionPanel({
  type, report, loading, onSendLink, onReview, tickets = [], onResolveTicket,
}: {
  type: 'pre_move_in' | 'move_out'
  report: InspectionReport | undefined
  loading: boolean
  onSendLink: () => void
  onReview: (id: string) => void
  tickets?: MaintenanceTicket[]
  onResolveTicket?: (ticketId: string, reading: number, notes: string, files: File[]) => void
}) {
  const label = type === 'pre_move_in' ? 'Pre-Move-In' : 'Move-Out'
  if (loading) return <Spinner />
  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500 mb-4">No {label} inspection report yet.</p>
        <button
          onClick={onSendLink}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Send {label} Inspection Link
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">{label} Inspection</h3>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            report.status === 'reviewed' ? 'bg-green-100 text-green-800' :
            report.status === 'submitted' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-600'
          }`}>
            {report.status}
          </span>
        </div>
        {report.status === 'submitted' && (
          <button
            onClick={() => onReview(report.id)}
            className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            Mark Reviewed
          </button>
        )}
      </div>

      {report.status === 'pending' && (
        <p className="text-sm text-yellow-700 bg-yellow-50 rounded-lg p-3">
          Waiting for tenant to complete the inspection.
        </p>
      )}

      {report.meter_readings.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Meter Readings</p>
          <div className="grid grid-cols-2 gap-3">
            {report.meter_readings.map((mr) => {
              const isDisputed = tickets.some((t) => t.utility_key === mr.utility_key && t.status === 'open')
              const officialMr = report.official_meter_readings?.find((o) => o.utility_key === mr.utility_key)
              return (
                <div key={mr.utility_key} className={`rounded-lg p-3 ${isDisputed ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{mr.utility_label}</p>
                    {isDisputed && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Disputed</span>}
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mt-1">
                    {mr.reading} {mr.unit_label}
                    {isDisputed && <span className="text-xs text-orange-500 ml-1">(submitted)</span>}
                  </p>
                  {officialMr && (
                    <p className="text-xs text-green-700 font-medium mt-0.5">
                      Official: {officialMr.reading} {officialMr.unit_label}
                    </p>
                  )}
                  {mr.photo_url && (
                    <a href={mr.photo_url} target="_blank" rel="noreferrer" className="mt-2 block">
                      <img src={mr.photo_url} alt={mr.utility_label} className="w-full h-20 object-cover rounded" />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tickets.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Meter Discrepancies ({tickets.filter((t) => t.status === 'open').length} open)
          </p>
          <div className="space-y-3">
            {tickets.map((t) => (
              <TicketCard key={t.id} ticket={t} onResolve={onResolveTicket} />
            ))}
          </div>
        </section>
      )}

      {report.defects.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Defects / Remarks</p>
          <div className="space-y-3">
            {report.defects.map((d) => (
              <div key={d.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-700">{d.location}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{d.description}</p>
                  </div>
                </div>
                {d.photo_urls.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {d.photo_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`defect-${i}`} className="w-16 h-16 object-cover rounded" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {report.submitted_at && (
        <p className="text-xs text-gray-400">Submitted {fmtDate(report.submitted_at)}</p>
      )}
    </div>
  )
}

function UtilityUsagePanel({ leaseId }: { leaseId: string }) {
  const [invoices, setInvoices] = useState<import('@/types/invoice').Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    invoicesApi.list({ lease_id: leaseId, page_size: 100 })
      .then(r => setInvoices(r.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [leaseId])

  if (loading) return <Spinner />

  // Collect all metered line items across invoices (only those with readings)
  type ReadingRow = {
    billing_month: string
    utility_name: string
    utility_key: string
    previous_reading: number | undefined
    current_reading: number
    usage: number | undefined
    meter_image_url: string | undefined
  }

  const rows: ReadingRow[] = []
  for (const inv of [...invoices].sort((a, b) => a.billing_month.localeCompare(b.billing_month))) {
    for (const li of inv.line_items ?? []) {
      if ((li.type === 'metered_utility' || li.type === 'subscription_utility') && li.current_reading != null) {
        rows.push({
          billing_month: inv.billing_month,
          utility_name: li.description,
          utility_key: li.utility_key ?? li.description,
          previous_reading: li.previous_reading ?? undefined,
          current_reading: li.current_reading,
          usage: li.previous_reading != null ? li.current_reading - li.previous_reading : undefined,
          meter_image_url: li.meter_image_url ?? undefined,
        })
      }
    }
  }

  // Group by utility
  const byUtility = rows.reduce<Record<string, { name: string; rows: ReadingRow[] }>>((acc, r) => {
    if (!acc[r.utility_key]) acc[r.utility_key] = { name: r.utility_name, rows: [] }
    acc[r.utility_key].rows.push(r)
    return acc
  }, {})

  if (Object.keys(byUtility).length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">No meter readings recorded yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Readings are captured during the billing meter-reading process. Generate an invoice with
          metered utilities and submit readings to see history here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {Object.entries(byUtility).map(([key, { name, rows: uRows }]) => (
        <div key={key}>
          <p className="text-sm font-semibold text-gray-800 mb-2">{name}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-100 rounded-lg overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Month</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-2">Previous</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-2">Current</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-2">Usage</th>
                  <th className="text-center text-xs text-gray-500 font-medium px-3 py-2">Photo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {uRows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.billing_month}</td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {r.previous_reading != null ? r.previous_reading.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      {r.current_reading.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-600">
                      {r.usage != null ? `+${r.usage.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.meter_image_url ? (
                        <a href={r.meter_image_url} target="_blank" rel="noreferrer">
                          <img src={r.meter_image_url} alt="meter" className="w-8 h-8 object-cover rounded mx-auto" />
                        </a>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function DeductionsPanel({
  summary, paymentSummary, loading, addOpen, deductionForm, deductionError,
  deductionLoading, onAddOpen, onFormChange, onAddSubmit, onAddCancel, onDelete, onRefund,
}: {
  lease?: Lease
  summary: DeductionSummary | null
  paymentSummary: PaymentSummary | null
  loading: boolean
  addOpen: boolean
  deductionForm: { category: string; description: string; amount: string }
  deductionError: string | null
  deductionLoading: boolean
  onAddOpen: () => void
  onFormChange: (f: any) => void
  onAddSubmit: (e: React.FormEvent) => void
  onAddCancel: () => void
  onDelete: (id: string) => void
  onRefund: () => void
}) {
  if (loading) return <Spinner />

  const depositHeld = paymentSummary?.deposit_paid ?? 0
  const totalDeductions = summary?.total ?? 0
  const netRefund = Math.max(0, depositHeld - totalDeductions)

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">Deposit Held</p>
          <p className="font-semibold text-gray-900">{fmt(depositHeld)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total Deductions</p>
          <p className="font-semibold text-red-600">{fmt(totalDeductions)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Net Refund</p>
          <p className="font-semibold text-green-700">{fmt(netRefund)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Deductions</h3>
        <div className="flex gap-2">
          <button
            onClick={onAddOpen}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            + Add Deduction
          </button>
          <button
            onClick={onRefund}
            className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            Refund Deposit
          </button>
        </div>
      </div>

      {addOpen && (
        <form onSubmit={onAddSubmit} className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={deductionForm.category}
                onChange={(e) => onFormChange({ ...deductionForm, category: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="damage">Damage</option>
                <option value="cleaning">Cleaning</option>
                <option value="unpaid_rent">Unpaid Rent</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (KES)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={deductionForm.amount}
                onChange={(e) => onFormChange({ ...deductionForm, amount: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              type="text"
              value={deductionForm.description}
              onChange={(e) => onFormChange({ ...deductionForm, description: e.target.value })}
              required
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          {deductionError && <p className="text-xs text-red-600">{deductionError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onAddCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button type="submit" disabled={deductionLoading} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {deductionLoading ? 'Saving…' : 'Add Deduction'}
            </button>
          </div>
        </form>
      )}

      {!summary?.items.length ? (
        <p className="text-sm text-gray-500">No deductions recorded.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs text-gray-500 font-medium pb-2">Category</th>
              <th className="text-left text-xs text-gray-500 font-medium pb-2">Description</th>
              <th className="text-right text-xs text-gray-500 font-medium pb-2">Amount</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {summary.items.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="py-2 capitalize">{d.category.replace(/_/g, ' ')}</td>
                <td className="py-2 text-gray-600">{d.description}</td>
                <td className="py-2 text-right font-medium text-red-600">{fmt(d.amount)}</td>
                <td className="py-2 pl-3">
                  <button
                    onClick={() => onDelete(d.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold">
              <td colSpan={2} className="py-2 text-gray-900">Total</td>
              <td className="py-2 text-right text-red-700">{fmt(summary.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

function TicketCard({
  ticket,
  onResolve,
}: {
  ticket: MaintenanceTicket
  onResolve?: (ticketId: string, reading: number, notes: string, files: File[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [reading, setReading] = useState(String(ticket.reported_reading))
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)

  const isResolved = ticket.status === 'resolved'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await onResolve?.(ticket.id, parseFloat(reading), notes, files)
    setLoading(false)
    setOpen(false)
  }

  return (
    <div className={`rounded-lg border p-3 ${isResolved ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{ticket.title}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">{ticket.description}</p>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            {ticket.system_reading != null && (
              <span>System: <strong>{ticket.system_reading.toLocaleString()}</strong></span>
            )}
            <span>Reported: <strong>{ticket.reported_reading.toLocaleString()}</strong></span>
            {ticket.resolution_reading != null && (
              <span className="text-green-700">Official: <strong>{ticket.resolution_reading.toLocaleString()}</strong></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
            isResolved ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
          }`}>
            {ticket.status}
          </span>
          {!isResolved && onResolve && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Resolve
            </button>
          )}
        </div>
      </div>

      {/* Resolution evidence photos */}
      {isResolved && ticket.evidence_urls.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {ticket.evidence_urls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={`evidence-${i}`} className="w-16 h-16 object-cover rounded border border-green-200" />
            </a>
          ))}
        </div>
      )}
      {isResolved && ticket.resolution_notes && (
        <p className="text-xs text-gray-600 mt-1 italic">{ticket.resolution_notes}</p>
      )}

      {/* Inline resolve form */}
      {open && (
        <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-orange-200 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Official Reading *</label>
              <input
                type="number"
                step="0.01"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Evidence Photos</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="w-full text-xs text-gray-600"
            />
            {files.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">{files.length} file(s) selected</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !reading}
              className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Adopt Reading & Close'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function EscalationsPanel({
  lease,
  escalationForm,
  escalationSaving,
  escalationError,
  onFormChange,
  onAddSubmit,
  onRemove,
}: {
  lease: Lease
  escalationForm: { effective_date: string; new_rent_amount: string; note: string }
  escalationSaving: boolean
  escalationError: string | null
  onFormChange: (f: { effective_date: string; new_rent_amount: string; note: string }) => void
  onAddSubmit: (e: React.FormEvent) => void
  onRemove: (id: string) => void
}) {
  const escalations = lease.escalations ?? []
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Rent Escalations</h3>
        <span className="text-xs text-gray-400">{escalations.length} scheduled</span>
      </div>

      {escalations.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No escalations scheduled.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
          <div className="space-y-4">
            {escalations.map((esc) => (
              <div key={esc.id} className="relative pl-8">
                <div className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 ${esc.applied ? 'bg-green-500 border-green-500' : 'bg-white border-gray-400'}`} />
                <div className={`rounded-lg border p-3 ${esc.applied ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{fmt(esc.new_rent_amount)}/mo</span>
                        {esc.percentage_increase != null && (
                          <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                            +{esc.percentage_increase.toFixed(1)}%
                          </span>
                        )}
                        {esc.applied && (
                          <span className="text-xs text-green-700 bg-green-100 border border-green-200 px-1.5 py-0.5 rounded-full font-medium">
                            Applied
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">Effective {fmtDate(esc.effective_date)}</p>
                      {esc.note && <p className="text-xs text-gray-500 mt-1 italic">{esc.note}</p>}
                    </div>
                    {!esc.applied && (
                      <button
                        onClick={() => onRemove(esc.id)}
                        title="Remove escalation"
                        className="shrink-0 text-gray-400 hover:text-red-600 transition-colors p-1"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Schedule New Escalation</p>
        <form onSubmit={onAddSubmit} className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Effective Date *</label>
              <input
                type="date"
                value={escalationForm.effective_date}
                onChange={(e) => onFormChange({ ...escalationForm, effective_date: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Monthly Rent (KES) *</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={escalationForm.new_rent_amount}
                onChange={(e) => onFormChange({ ...escalationForm, new_rent_amount: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
            <input
              type="text"
              value={escalationForm.note}
              onChange={(e) => onFormChange({ ...escalationForm, note: e.target.value })}
              placeholder="e.g. Annual CPI adjustment"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {escalationError && <p className="text-xs text-red-600">{escalationError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={escalationSaving}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {escalationSaving ? 'Saving…' : 'Add Escalation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RenewalPanel({
  lease,
  renewalForm,
  renewalSaving,
  renewalError,
  etForm,
  etSaving,
  etError,
  onRenewalFormChange,
  onSendRenewal,
  onRespond,
  onEtFormChange,
  onSetEt,
}: {
  lease: Lease
  renewalForm: { new_rent_amount: string; new_end_date: string; message: string }
  renewalSaving: boolean
  renewalError: string | null
  etForm: { penalty_type: string; penalty_value: string; notice_days: string; note: string }
  etSaving: boolean
  etError: string | null
  onRenewalFormChange: (f: { new_rent_amount: string; new_end_date: string; message: string }) => void
  onSendRenewal: (e: React.FormEvent) => void
  onRespond: (accepted: boolean) => void
  onEtFormChange: (f: { penalty_type: string; penalty_value: string; notice_days: string; note: string }) => void
  onSetEt: (e: React.FormEvent) => void
}) {
  const offer = lease.renewal_offer
  const et = lease.early_termination

  const RENEWAL_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    accepted: 'bg-green-100 text-green-800',
    declined: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Renewal Offer */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Renewal Offer</p>
        {offer ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">{fmt(offer.new_rent_amount)}/mo</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RENEWAL_STATUS_COLORS[offer.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
              </span>
            </div>
            {offer.new_end_date && (
              <p className="text-xs text-gray-500">New end date: {fmtDate(offer.new_end_date)}</p>
            )}
            {offer.message && (
              <p className="text-sm text-gray-700 bg-white border border-gray-100 rounded p-2 text-xs italic">{offer.message}</p>
            )}
            <p className="text-xs text-gray-400">Sent {fmtDate(offer.sent_at)}{offer.responded_at ? ` · Responded ${fmtDate(offer.responded_at)}` : ''}</p>
            {offer.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onRespond(true)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700"
                >
                  Accept
                </button>
                <button
                  onClick={() => onRespond(false)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        ) : null}

        {(!offer || offer.status !== 'pending') && (
          <div className={offer ? 'mt-4' : ''}>
            <p className="text-xs font-medium text-gray-600 mb-2">{offer ? 'Send New Renewal Offer' : 'No renewal offer sent yet'}</p>
            <form onSubmit={onSendRenewal} className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New Monthly Rent (KES) *</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={renewalForm.new_rent_amount}
                    onChange={(e) => onRenewalFormChange({ ...renewalForm, new_rent_amount: e.target.value })}
                    required
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New End Date (optional)</label>
                  <input
                    type="date"
                    value={renewalForm.new_end_date}
                    onChange={(e) => onRenewalFormChange({ ...renewalForm, new_end_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message (optional)</label>
                <textarea
                  value={renewalForm.message}
                  onChange={(e) => onRenewalFormChange({ ...renewalForm, message: e.target.value })}
                  rows={3}
                  placeholder="Include a message to the tenant…"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              {renewalError && <p className="text-xs text-red-600">{renewalError}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={renewalSaving}
                  className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {renewalSaving ? 'Sending…' : 'Send Renewal Offer'}
                </button>
              </div>
            </form>
          </div>
        )}
      </section>

      {/* Early Termination */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Early Termination Terms</p>
        {et && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4 space-y-2">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Penalty Type</p>
                <p className="font-medium text-gray-900 capitalize">{et.penalty_type.replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Penalty Value</p>
                <p className="font-medium text-gray-900">{et.penalty_type === 'months' ? `${et.penalty_value} months` : fmt(et.penalty_value)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Notice Required</p>
                <p className="font-medium text-gray-900">{et.notice_days} days</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500">Penalty Amount</p>
              <p className="text-sm font-semibold text-orange-700">{fmt(et.penalty_amount)}</p>
            </div>
            {et.note && <p className="text-xs text-gray-500 italic">{et.note}</p>}
          </div>
        )}
        <form onSubmit={onSetEt} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-gray-600">{et ? 'Update Terms' : 'Set Early Termination Terms'}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Penalty Type *</label>
              <select
                value={etForm.penalty_type}
                onChange={(e) => onEtFormChange({ ...etForm, penalty_type: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="fixed">Fixed</option>
                <option value="months">Months</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Value *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={etForm.penalty_value}
                onChange={(e) => onEtFormChange({ ...etForm, penalty_value: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notice Days *</label>
              <input
                type="number"
                min="1"
                step="1"
                value={etForm.notice_days}
                onChange={(e) => onEtFormChange({ ...etForm, notice_days: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
            <input
              type="text"
              value={etForm.note}
              onChange={(e) => onEtFormChange({ ...etForm, note: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {etError && <p className="text-xs text-red-600">{etError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={etSaving}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 text-white hover:bg-gray-900 disabled:opacity-50"
            >
              {etSaving ? 'Saving…' : et ? 'Update Terms' : 'Set Terms'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CoTenantsPanel({
  lease,
  formOpen,
  coTenantForm,
  coTenantSaving,
  coTenantError,
  onFormOpen,
  onFormCancel,
  onFormChange,
  onAddSubmit,
  onRemove,
}: {
  lease: Lease
  formOpen: boolean
  coTenantForm: { first_name: string; last_name: string; role: string; email: string; phone: string; id_type: string; id_number: string }
  coTenantSaving: boolean
  coTenantError: string | null
  onFormOpen: () => void
  onFormCancel: () => void
  onFormChange: (f: { first_name: string; last_name: string; role: string; email: string; phone: string; id_type: string; id_number: string }) => void
  onAddSubmit: (e: React.FormEvent) => void
  onRemove: (id: string) => void
}) {
  const coTenants = lease.co_tenants ?? []

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Co-Tenants & Guarantors</h3>
        {!formOpen && (
          <button
            onClick={onFormOpen}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            + Add Co-Tenant
          </button>
        )}
      </div>

      {coTenants.length === 0 && !formOpen && (
        <p className="text-sm text-gray-500 italic">No co-tenants or guarantors added.</p>
      )}

      {coTenants.length > 0 && (
        <div className="space-y-3">
          {coTenants.map((ct) => (
            <div key={ct.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{ct.first_name} {ct.last_name}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${ct.role === 'guarantor' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {ct.role === 'guarantor' ? 'Guarantor' : 'Co-Tenant'}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {ct.email && <p className="text-xs text-gray-500">{ct.email}</p>}
                    {ct.phone && <p className="text-xs text-gray-500">{ct.phone}</p>}
                    {ct.id_type && ct.id_number && (
                      <p className="text-xs text-gray-400">{ct.id_type.replace('_', ' ').toUpperCase()}: {ct.id_number}</p>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">Added {fmtDate(ct.added_at)}</p>
                </div>
                <button
                  onClick={() => onRemove(ct.id)}
                  title="Remove co-tenant"
                  className="shrink-0 text-gray-400 hover:text-red-600 transition-colors p-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <form onSubmit={onAddSubmit} className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-gray-700">New Co-Tenant / Guarantor</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
              <input
                type="text"
                value={coTenantForm.first_name}
                onChange={(e) => onFormChange({ ...coTenantForm, first_name: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
              <input
                type="text"
                value={coTenantForm.last_name}
                onChange={(e) => onFormChange({ ...coTenantForm, last_name: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
              <select
                value={coTenantForm.role}
                onChange={(e) => onFormChange({ ...coTenantForm, role: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="co_tenant">Co-Tenant</option>
                <option value="guarantor">Guarantor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={coTenantForm.email}
                onChange={(e) => onFormChange({ ...coTenantForm, email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input
                type="tel"
                value={coTenantForm.phone}
                onChange={(e) => onFormChange({ ...coTenantForm, phone: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ID Type</label>
              <select
                value={coTenantForm.id_type}
                onChange={(e) => onFormChange({ ...coTenantForm, id_type: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="national_id">National ID</option>
                <option value="passport">Passport</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ID Number</label>
            <input
              type="text"
              value={coTenantForm.id_number}
              onChange={(e) => onFormChange({ ...coTenantForm, id_number: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {coTenantError && <p className="text-xs text-red-600">{coTenantError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onFormCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={coTenantSaving}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {coTenantSaving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          className={`w-4 h-4 ${s <= value ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

function NotesRatingPanel({
  lease,
  ratingForm,
  ratingSaving,
  ratingError,
  noteForm,
  noteSaving,
  noteError,
  onRatingFormChange,
  onRateSubmit,
  onNoteFormChange,
  onNoteSubmit,
}: {
  lease: Lease
  ratingForm: { score: string; payment_timeliness: string; property_care: string; communication: string; note: string }
  ratingSaving: boolean
  ratingError: string | null
  noteForm: { body: string; is_private: boolean }
  noteSaving: boolean
  noteError: string | null
  onRatingFormChange: (f: { score: string; payment_timeliness: string; property_care: string; communication: string; note: string }) => void
  onRateSubmit: (e: React.FormEvent) => void
  onNoteFormChange: (f: { body: string; is_private: boolean }) => void
  onNoteSubmit: (e: React.FormEvent) => void
}) {
  const rating = lease.rating
  const notes = lease.notes_internal ?? []

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Rating display */}
      {rating && (
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tenant Rating</p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <StarRating value={rating.score} />
              <span className="text-sm font-semibold text-gray-900">{rating.score}/5 Overall</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Payment</p>
                <StarRating value={rating.payment_timeliness} />
                <p className="text-xs text-gray-400 mt-0.5">{rating.payment_timeliness}/5</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Property Care</p>
                <StarRating value={rating.property_care} />
                <p className="text-xs text-gray-400 mt-0.5">{rating.property_care}/5</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Communication</p>
                <StarRating value={rating.communication} />
                <p className="text-xs text-gray-400 mt-0.5">{rating.communication}/5</p>
              </div>
            </div>
            {rating.note && <p className="text-xs text-gray-600 italic">{rating.note}</p>}
            <p className="text-[10px] text-gray-400">Rated {fmtDate(rating.rated_at)}</p>
          </div>
        </section>
      )}

      {/* Rate tenant form */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {rating ? 'Update Rating' : 'Rate Tenant'}
        </p>
        <form onSubmit={onRateSubmit} className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Overall Score (1–5) *</label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={ratingForm.score}
                onChange={(e) => onRatingFormChange({ ...ratingForm, score: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Timeliness (1–5) *</label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={ratingForm.payment_timeliness}
                onChange={(e) => onRatingFormChange({ ...ratingForm, payment_timeliness: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Property Care (1–5) *</label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={ratingForm.property_care}
                onChange={(e) => onRatingFormChange({ ...ratingForm, property_care: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Communication (1–5) *</label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={ratingForm.communication}
                onChange={(e) => onRatingFormChange({ ...ratingForm, communication: e.target.value })}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
            <textarea
              value={ratingForm.note}
              onChange={(e) => onRatingFormChange({ ...ratingForm, note: e.target.value })}
              rows={2}
              placeholder="Additional comments…"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            />
          </div>
          {ratingError && <p className="text-xs text-red-600">{ratingError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={ratingSaving}
              className="px-3 py-1.5 text-xs rounded-lg bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50"
            >
              {ratingSaving ? 'Saving…' : rating ? 'Update Rating' : 'Submit Rating'}
            </button>
          </div>
        </form>
      </section>

      {/* Internal notes */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Internal Notes ({notes.length})
        </p>

        {notes.length === 0 ? (
          <p className="text-sm text-gray-500 italic mb-4">No notes yet.</p>
        ) : (
          <div className="space-y-3 mb-4">
            {notes.map((n) => (
              <div key={n.id} className={`rounded-lg border p-3 ${n.is_private ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-700 leading-relaxed flex-1">{n.body}</p>
                  {n.is_private && (
                    <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded-full">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Private
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">{fmtDate(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onNoteSubmit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-medium text-gray-600">Add Note</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note *</label>
            <textarea
              value={noteForm.body}
              onChange={(e) => onNoteFormChange({ ...noteForm, body: e.target.value })}
              rows={3}
              required
              placeholder="Write an internal note…"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={noteForm.is_private}
              onChange={(e) => onNoteFormChange({ ...noteForm, is_private: e.target.checked })}
              className="rounded border-gray-300"
            />
            <span className="text-xs text-gray-600">Private (visible to staff only)</span>
          </label>
          {noteError && <p className="text-xs text-red-600">{noteError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={noteSaving}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {noteSaving ? 'Adding…' : 'Add Note'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  )
}
