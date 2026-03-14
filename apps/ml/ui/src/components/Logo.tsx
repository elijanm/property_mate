import clsx from 'clsx'

interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Show ".io" TLD after the wordmark */
  tld?: boolean
  className?: string
}

const SIZES = {
  xs: { icon: 'w-6 h-6 rounded-lg',      ml: 'text-[9px]',  word: 'text-sm',  tld: 'text-xs'  },
  sm: { icon: 'w-7 h-7 rounded-[9px]',   ml: 'text-[10px]', word: 'text-[15px]', tld: 'text-xs' },
  md: { icon: 'w-8 h-8 rounded-xl',      ml: 'text-[11px]', word: 'text-base', tld: 'text-sm' },
  lg: { icon: 'w-11 h-11 rounded-2xl',   ml: 'text-[14px]', word: 'text-xl',  tld: 'text-base' },
}

export default function Logo({ size = 'md', tld = true, className }: Props) {
  const s = SIZES[size]

  return (
    <div className={clsx('flex items-center gap-2.5 select-none', className)}>
      {/* Icon mark — layered dock shape */}
      <div className={clsx(
        s.icon,
        'flex-shrink-0 flex items-center justify-center',
        'bg-gradient-to-br from-brand-500 to-brand-700',
        'shadow-md shadow-brand-900/50 ring-1 ring-white/10',
      )}>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className="w-[65%] h-[65%]"
          aria-hidden
        >
          {/* Top bar */}
          <rect x="2" y="3" width="16" height="3.5" rx="1.5" fill="white" />
          {/* Middle bar — slightly narrower */}
          <rect x="2" y="8.5" width="16" height="3" rx="1.5" fill="white" fillOpacity="0.75" />
          {/* Bottom bar — narrowest */}
          <rect x="2" y="13.5" width="12" height="3" rx="1.5" fill="white" fillOpacity="0.45" />
        </svg>
      </div>

      {/* Wordmark */}
      <div className="flex items-baseline gap-0 leading-none font-logo">
        <span className={clsx(
          s.word,
          'font-bold text-white tracking-[-0.03em] leading-none',
          'font-logo',
        )}>
          MLDock
        </span>
        {tld && (
          <span className={clsx(
            s.tld,
            'font-semibold text-brand-400 leading-none tracking-tight',
            'font-logo',
          )}>
            .io
          </span>
        )}
      </div>
    </div>
  )
}
