import clsx from 'clsx'

interface Props {
  status: string
  size?: 'sm' | 'md'
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700',
  inactive: 'bg-gray-800 text-gray-400 border border-gray-700',
  archived: 'bg-yellow-900/40 text-yellow-400 border border-yellow-700',
  running: 'bg-blue-900/50 text-blue-400 border border-blue-700',
  queued: 'bg-purple-900/50 text-purple-400 border border-purple-700',
  completed: 'bg-emerald-900/50 text-emerald-400 border border-emerald-700',
  failed: 'bg-red-900/50 text-red-400 border border-red-700',
  cancelled: 'bg-gray-800 text-gray-500 border border-gray-700',
  default: 'bg-gray-800 text-gray-300 border border-gray-700',
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.default
  return (
    <span className={clsx('rounded-full font-medium uppercase tracking-wide', cls,
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
    )}>
      {status}
    </span>
  )
}
