export interface ProratedRent {
  prorated: number
  days: number
  daysInMonth: number
}

interface LeaseLike {
  start_date?: string
  rent_amount: number
}

export function calcProratedRent(lease: LeaseLike): ProratedRent {
  try {
    if (!lease.start_date) return { prorated: lease.rent_amount, days: 0, daysInMonth: 0 }
    // Parse YYYY-MM-DD directly to avoid timezone-shift from new Date("YYYY-MM-DD")
    const [year, month, day] = lease.start_date.split('-').map(Number)
    // new Date(year, month, 0) → day 0 of (month+1) = last day of month (1-indexed)
    const daysInMonth = new Date(year, month, 0).getDate()
    const days = daysInMonth - day + 1
    const prorated = Math.round((days / daysInMonth) * lease.rent_amount * 100) / 100
    return { prorated, days, daysInMonth }
  } catch {
    return { prorated: lease.rent_amount, days: 0, daysInMonth: 0 }
  }
}
