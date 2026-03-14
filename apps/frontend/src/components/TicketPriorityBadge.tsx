import type { TicketPriority } from '@/types/ticket'

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-blue-50 text-blue-600',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export default function TicketPriorityBadge({ priority }: { priority: TicketPriority | string }) {
  const cls = PRIORITY_STYLES[priority] ?? 'bg-gray-100 text-gray-600'
  const label = PRIORITY_LABELS[priority] ?? priority
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}
