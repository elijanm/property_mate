import type { Lease } from '@/types/lease'
import type { PaymentSummary } from '@/types/payment'

export interface BehaviourScore {
  score: number
  source: 'rated' | 'estimated' | 'insufficient'
  label: string
  color: string
  bg: string
  border: string
  subs?: { label: string; value: number }[]
}

function grade(s: number): Pick<BehaviourScore, 'label' | 'color' | 'bg' | 'border'> {
  if (s >= 80) return { label: 'Excellent', color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' }
  if (s >= 65) return { label: 'Good',      color: 'text-green-700',   bg: 'bg-green-50',    border: 'border-green-200'   }
  if (s >= 50) return { label: 'Fair',       color: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200'   }
  return            { label: 'At Risk',    color: 'text-red-700',     bg: 'bg-red-50',      border: 'border-red-200'     }
}

export function computeBehaviourScore(lease: Lease, summary: PaymentSummary | null): BehaviourScore {
  if (lease.rating) {
    const s = Math.round(lease.rating.score * 20)
    return {
      score: s,
      source: 'rated',
      ...grade(s),
      subs: [
        { label: 'Payment',  value: lease.rating.payment_timeliness },
        { label: 'Property', value: lease.rating.property_care },
        { label: 'Comms',    value: lease.rating.communication },
      ],
    }
  }

  if (!summary || lease.status === 'draft') {
    return { score: 0, source: 'insufficient', label: 'No data', color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' }
  }

  let s = 100
  const arrearsRatio = lease.rent_amount > 0 ? summary.outstanding_balance / lease.rent_amount : 0
  s -= Math.min(45, Math.round(arrearsRatio * 35))
  if (summary.deposit_required > 0) {
    const shortfall = 1 - Math.min(1, summary.deposit_paid / summary.deposit_required)
    s -= Math.round(shortfall * 20)
  }
  const tenureMonths = Math.max(0, Math.floor((Date.now() - new Date(lease.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30)))
  s += Math.min(10, Math.round((tenureMonths / 24) * 10))

  return { score: Math.max(0, Math.min(100, s)), source: 'estimated', ...grade(Math.max(0, Math.min(100, s))) }
}
