import { useEffect, useState } from 'react'
import DashboardLayout from '@/layouts/DashboardLayout'
import { leasesApi } from '@/api/leases'
import { paymentsApi } from '@/api/payments'
import { inspectionsApi } from '@/api/inspections'
import { extractApiError } from '@/utils/apiError'
import { calcProratedRent } from '@/utils/leaseCalculations'
import type { Lease } from '@/types/lease'
import type { PaymentSummary } from '@/types/payment'
import type { InspectionReport } from '@/types/inspection'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_payment: 'bg-yellow-100 text-yellow-800',
  pending_signature: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-700',
  terminated: 'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<string, string> = {
  draft: 'Lease Created',
  pending_payment: 'Payment Pending',
  pending_signature: 'Ready to Sign',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
}

// ── Inspection status helpers ─────────────────────────────────────────────────

function inspectionDaysLeft(report: InspectionReport): number | null {
  if (!report.expires_at) return null
  const diff = new Date(report.expires_at).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{children}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TenantDashboard() {
  const [lease, setLease] = useState<Lease | null>(null)
  const [summary, setSummary] = useState<PaymentSummary | null>(null)
  const [inspection, setInspection] = useState<InspectionReport | null>(null)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    leasesApi
      .myLeases()
      .then(async (res) => {
        const activeLease = res.items.find(
          (l) => !['expired', 'terminated'].includes(l.status)
        ) ?? res.items[0] ?? null
        setLease(activeLease)

        if (activeLease) {
          // Fetch payment summary and inspection in parallel
          const [paySum, inspections] = await Promise.allSettled([
            paymentsApi.list(activeLease.id),
            inspectionsApi.list(activeLease.id),
          ])
          if (paySum.status === 'fulfilled') setSummary(paySum.value)
          if (inspections.status === 'fulfilled') {
            const preMove = inspections.value.find((i) => i.type === 'pre_move_in') ?? null
            setInspection(preMove)
          }
        }
      })
      .catch((err) => setError(extractApiError(err).message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSignLease() {
    if (!lease) return
    setSigning(true)
    setSignError(null)
    try {
      const updated = await leasesApi.sign(lease.id)
      setLease(updated)
    } catch (err) {
      setSignError(extractApiError(err).message)
    } finally {
      setSigning(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <p className="text-red-600">{error}</p>
        </div>
      </DashboardLayout>
    )
  }

  if (!lease) {
    return (
      <DashboardLayout>
        <div className="p-8 max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">My Dashboard</h1>
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <div className="text-4xl mb-3">🏠</div>
            <h2 className="font-semibold text-gray-800 mb-1">No active lease</h2>
            <p className="text-gray-500 text-sm">
              Your lease details will appear here once your landlord creates and assigns a lease to you.
            </p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const { prorated, days, daysInMonth } = calcProratedRent(lease)
  const totalUtilDeposit = (lease.utility_deposit ?? 0) + (lease.unit_utility_deposits ?? 0)
  const totalRequired = (summary?.deposit_required) ?? (lease.deposit_amount + totalUtilDeposit + prorated)
  const totalPaid = summary?.total_paid ?? 0
  const remaining = Math.max(0, totalRequired - totalPaid)
  const fullyPaid = remaining <= 0

  const daysLeft = inspection ? inspectionDaysLeft(inspection) : null
  const inspExpired = daysLeft !== null && daysLeft <= 0

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Track your lease, payments, and inspection.</p>
        </div>

        {/* ── Lease Overview ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">My Lease</h2>
              {lease.reference_no && (
                <span className="text-xs text-blue-600 font-mono">{lease.reference_no}</span>
              )}
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[lease.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {STATUS_LABELS[lease.status] ?? lease.status}
            </span>
          </div>
          <div className="px-5 py-3 divide-y divide-gray-50">
            {lease.unit_code && <InfoRow label="Unit">{lease.unit_code}</InfoRow>}
            <InfoRow label="Start Date">{new Date(lease.start_date).toLocaleDateString()}</InfoRow>
            {lease.end_date && (
              <InfoRow label="End Date">{new Date(lease.end_date).toLocaleDateString()}</InfoRow>
            )}
            <InfoRow label="Monthly Rent">{fmt(lease.rent_amount)}</InfoRow>
            <InfoRow label="Security Deposit">{fmt(lease.deposit_amount)}</InfoRow>
            {totalUtilDeposit > 0 && (
              <InfoRow label="Utility Deposit">{fmt(totalUtilDeposit)}</InfoRow>
            )}
          </div>

          {/* Action buttons */}
          {(lease.status === 'pending_signature' || (!lease.signed_at && lease.status !== 'active')) && (
            <div className="px-5 py-4 bg-blue-50 border-t border-blue-100">
              <p className="text-sm text-blue-800 font-medium mb-3">
                {lease.status === 'pending_signature'
                  ? '✅ Payment received! Your lease is ready to sign.'
                  : 'Your lease is awaiting your signature.'}
              </p>
              <button
                onClick={handleSignLease}
                disabled={signing}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {signing ? 'Signing…' : 'Sign Lease →'}
              </button>
              {signError && <p className="text-red-600 text-xs mt-2">{signError}</p>}
            </div>
          )}
        </div>

        {/* ── Payment Status ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Move-In Payment</h2>
          </div>
          <div className="px-5 py-3 divide-y divide-gray-50">
            <div className="flex justify-between items-center py-2 text-sm">
              <span className="text-gray-500">
                Security Deposit
              </span>
              <span className="font-medium text-gray-900">{fmt(lease.deposit_amount)}</span>
            </div>
            {totalUtilDeposit > 0 && (
              <div className="flex justify-between items-center py-2 text-sm">
                <span className="text-gray-500">Utility Deposit</span>
                <span className="font-medium text-gray-900">{fmt(totalUtilDeposit)}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-2 text-sm">
              <span className="text-gray-500">
                Pro-rated Rent
                {days > 0 && <span className="text-gray-400 ml-1 text-xs">({days}/{daysInMonth} days)</span>}
              </span>
              <span className="font-medium text-gray-900">{fmt(prorated)}</span>
            </div>
            <div className="flex justify-between items-center py-3 text-sm">
              <span className="font-semibold text-gray-700">Total Required</span>
              <span className="font-bold text-gray-900">{fmt(totalRequired)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-sm">
              <span className="text-gray-500">Total Paid</span>
              <span className={`font-semibold ${totalPaid > 0 ? 'text-green-700' : 'text-gray-900'}`}>{fmt(totalPaid)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-sm">
              <span className="font-semibold text-gray-700">Remaining</span>
              <span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {remaining > 0 ? fmt(remaining) : '✓ Fully Paid'}
              </span>
            </div>
          </div>
          {!fullyPaid && (
            <div className="px-5 py-3 bg-yellow-50 border-t border-yellow-100 text-xs text-yellow-800">
              Contact your property manager to arrange payment.
            </div>
          )}
        </div>

        {/* ── Inspection ── */}
        {inspection && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Pre-Move-In Inspection</h2>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                inspection.status === 'submitted' ? 'bg-green-100 text-green-800' :
                inspExpired ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'
              }`}>
                {inspection.status === 'submitted' ? 'Submitted' : inspExpired ? 'Expired' : 'Pending'}
              </span>
            </div>
            <div className="px-5 py-4 space-y-3">
              {inspection.status !== 'submitted' && !inspExpired && daysLeft !== null && (
                <div className={`rounded-lg px-4 py-3 text-sm ${daysLeft <= 3 ? 'bg-yellow-50 border border-yellow-200' : 'bg-blue-50 border border-blue-200'}`}>
                  <p className={`font-semibold ${daysLeft <= 3 ? 'text-yellow-800' : 'text-blue-800'}`}>
                    {daysLeft === 0 ? 'Last day!' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`}
                  </p>
                  <p className={`text-xs mt-0.5 ${daysLeft <= 3 ? 'text-yellow-700' : 'text-blue-700'}`}>
                    Document any pre-existing issues before your window closes.
                  </p>
                </div>
              )}
              {inspExpired && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm">
                  <p className="text-red-800 font-semibold">Inspection window has closed</p>
                  <p className="text-red-600 text-xs mt-0.5">
                    The inspection period has expired. Your logged items are recorded below.
                  </p>
                </div>
              )}

              {inspection.status === 'submitted' && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm">
                  <p className="text-green-800 font-semibold">✓ Inspection submitted</p>
                  <p className="text-green-600 text-xs mt-0.5">
                    Your property manager will review your report.
                  </p>
                </div>
              )}

              {/* Open inspection link */}
              {inspection.token && inspection.status !== 'submitted' && !inspExpired && (
                <a
                  href={`/inspection/${inspection.token}`}
                  className="block w-full text-center py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Complete Inspection →
                </a>
              )}

              {/* Logged defects */}
              {(inspection.defects?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Logged Defects ({inspection.defects.length})
                  </p>
                  {inspection.defects.map((d) => (
                    <div key={d.id} className="bg-gray-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-gray-800">{d.location}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{d.description}</p>
                      {d.photo_urls.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {d.photo_urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt={`defect-${i}`} className="w-12 h-12 object-cover rounded" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-gray-400">
                    These defects are documented and protect you from being charged for pre-existing issues.
                  </p>
                </div>
              )}

              {inspection.status === 'submitted' && (inspection.defects?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400 text-center">No defects were logged.</p>
              )}
            </div>
          </div>
        )}

        {/* ── No inspection yet (lease is active but no inspection created yet) ── */}
        {!inspection && lease.status === 'active' && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
            <div className="text-3xl mb-2">📋</div>
            <h3 className="font-semibold text-gray-800 mb-1">Move-In Inspection</h3>
            <p className="text-gray-500 text-sm">
              Your property manager will send you an inspection link once your unit is activated.
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
