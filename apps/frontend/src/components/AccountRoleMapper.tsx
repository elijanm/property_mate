import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AccountEntry, AccountType } from '@/types/org'

/* ─── System event definitions ─────────────────────────────────────────── */

interface SystemRole {
  key: string
  label: string
  category: Category
  description: string
}

type Category = 'Income' | 'Liability' | 'Asset' | 'Expense'

const SYSTEM_ROLES: SystemRole[] = [
  // Income
  { key: 'rental_income',         label: 'Rent Invoice Generated',      category: 'Income',    description: 'Monthly rent charged to tenant' },
  { key: 'late_fee',              label: 'Late Fee Applied',             category: 'Income',    description: 'Penalty for overdue payment' },
  { key: 'utility_income',        label: 'Utility Billed',               category: 'Income',    description: 'Water / electricity invoiced to tenant' },
  { key: 'service_charge',        label: 'Service Charge',               category: 'Income',    description: 'Common-area levy' },
  { key: 'admin_fee',             label: 'Move-in / Admin Fee',          category: 'Income',    description: 'One-off fee at lease signing' },
  { key: 'other_income',          label: 'Other Income',                 category: 'Income',    description: 'Parking, storage, miscellaneous' },
  { key: 'commission_income',     label: 'Commission Charged',           category: 'Income',    description: 'Agent commission on new lease' },
  { key: 'forfeited_deposit',     label: 'Deposit Forfeited',            category: 'Income',    description: 'Security deposit applied to damages' },
  // Liability
  { key: 'deposit',               label: 'Security Deposit Collected',   category: 'Liability', description: 'Refundable deposit held for tenant' },
  { key: 'tax_payable',           label: 'VAT / Tax Collected',          category: 'Liability', description: 'Tax owed to revenue authority' },
  { key: 'advance_rent',          label: 'Advance Rent Received',        category: 'Liability', description: 'Rent paid ahead of billing period' },
  { key: 'accounts_payable',      label: 'Vendor Invoice Created',       category: 'Liability', description: 'Unpaid contractor invoice' },
  { key: 'withholding_tax',       label: 'WHT Withheld',                 category: 'Liability', description: 'Withholding tax on fees / commissions' },
  { key: 'agent_receivable',      label: 'Commission Due to Agent',      category: 'Liability', description: 'Agent commission pending settlement' },
  { key: 'utility_deposit',       label: 'Utility Deposit Held',         category: 'Liability', description: 'Utility deposit held for tenant' },
  // Asset
  { key: 'rent_receivable',       label: 'Rent Receivable',              category: 'Asset',     description: 'Outstanding rent owed by tenant' },
  { key: 'utility_deposit_asset', label: 'Utility Deposit (Asset)',      category: 'Asset',     description: 'Asset side of utility deposit held' },
  { key: 'prepaid',               label: 'Prepaid Expense',              category: 'Asset',     description: 'Cost paid in advance' },
  { key: 'inventory',             label: 'Inventory Purchased',          category: 'Asset',     description: 'Stock and supplies acquired' },
  // Expense
  { key: 'expense',               label: 'Operating Expense',            category: 'Expense',   description: 'Day-to-day operating cost' },
  { key: 'maintenance',           label: 'Maintenance Work Order',       category: 'Expense',   description: 'Vendor maintenance cost' },
  { key: 'utility_expense',       label: 'Common Area Utility',          category: 'Expense',   description: 'Landlord-paid utility cost' },
  { key: 'management_fee',        label: 'Management Fee',               category: 'Expense',   description: 'Property management fee' },
  { key: 'agent_commission',      label: 'Agent Commission Paid',        category: 'Expense',   description: 'Commission paid out to agent' },
  { key: 'insurance',             label: 'Insurance Premium',            category: 'Expense',   description: 'Property and liability insurance' },
  { key: 'legal',                 label: 'Legal / Professional Fee',     category: 'Expense',   description: 'Legal and compliance costs' },
  { key: 'bad_debt',              label: 'Debt Write-off',               category: 'Expense',   description: 'Uncollectable rent written off' },
  { key: 'bank_charges',          label: 'Bank / Mpesa Charges',         category: 'Expense',   description: 'Transaction fees' },
]

const CAT_STYLE: Record<Category, { stroke: string; badgeCls: string }> = {
  Income:    { stroke: '#16a34a', badgeCls: 'bg-green-100 text-green-700 border-green-200' },
  Expense:   { stroke: '#dc2626', badgeCls: 'bg-red-100 text-red-700 border-red-200' },
  Asset:     { stroke: '#2563eb', badgeCls: 'bg-blue-100 text-blue-700 border-blue-200' },
  Liability: { stroke: '#7c3aed', badgeCls: 'bg-purple-100 text-purple-700 border-purple-200' },
}

const ACC_TYPE_CAT: Record<AccountType, Category> = {
  income: 'Income',
  expense: 'Expense',
  asset: 'Asset',
  liability: 'Liability',
}

/* ─── Component ─────────────────────────────────────────────────────────── */

interface ConnPath {
  roleKey: string
  d: string
  stroke: string
  category: Category
}

interface Props {
  accounts: AccountEntry[]
  onChange: (accounts: AccountEntry[]) => void
}

export default function AccountRoleMapper({ accounts, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const roleDotRefs = useRef<Map<string, HTMLSpanElement | null>>(new Map())
  const accDotRefs  = useRef<Map<string, HTMLSpanElement | null>>(new Map())
  const [paths, setPaths]   = useState<ConnPath[]>([])
  const [selected, setSelected] = useState<string | null>(null) // selected role key

  // role key → account.id
  const mapping = new Map<string, string>()
  for (const acc of accounts) {
    if (acc.role) mapping.set(acc.role, acc.id)
  }

  const computePaths = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()

    const newPaths: ConnPath[] = []
    for (const [roleKey, accountId] of mapping) {
      const roleEl = roleDotRefs.current.get(roleKey)
      const accEl  = accDotRefs.current.get(accountId)
      if (!roleEl || !accEl) continue

      const rr = roleEl.getBoundingClientRect()
      const ar = accEl.getBoundingClientRect()

      // container-relative coords (works even when the page scrolls)
      const x1 = rr.right  - cr.left
      const y1 = rr.top    - cr.top + rr.height / 2
      const x2 = ar.left   - cr.left
      const y2 = ar.top    - cr.top + ar.height / 2

      const bend = Math.max(60, Math.abs(x2 - x1) * 0.45)
      const d = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`

      const role = SYSTEM_ROLES.find(r => r.key === roleKey)!
      newPaths.push({ roleKey, d, stroke: CAT_STYLE[role.category].stroke, category: role.category })
    }
    setPaths(newPaths)
  }, [accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute ONLY when accounts change (not every render) to prevent infinite loop.
  // setPaths triggers a re-render, but computePaths is stable between account changes,
  // so useLayoutEffect([computePaths]) will not fire again.
  useLayoutEffect(() => { computePaths() }, [computePaths])

  // Also recompute on window resize (layout shift)
  useEffect(() => {
    window.addEventListener('resize', computePaths)
    return () => window.removeEventListener('resize', computePaths)
  }, [computePaths])

  /* ── Interaction ──────────────────────────────────────────────────────── */

  function handleRoleClick(roleKey: string) {
    setSelected(prev => (prev === roleKey ? null : roleKey))
  }

  function handleAccountClick(accountId: string) {
    if (!selected) return
    const roleKey = selected
    const clickedAcc = accounts.find(a => a.id === accountId)
    const isToggleOff = clickedAcc?.role === roleKey

    const updated = accounts.map(acc => {
      if (acc.id === accountId) return { ...acc, role: isToggleOff ? undefined : roleKey }
      if (acc.role === roleKey)  return { ...acc, role: undefined }
      return acc
    })
    onChange(updated)
    setSelected(null)
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  const accByType: Record<AccountType, AccountEntry[]> = {
    income:    accounts.filter(a => a.account_type === 'income'),
    expense:   accounts.filter(a => a.account_type === 'expense'),
    asset:     accounts.filter(a => a.account_type === 'asset'),
    liability: accounts.filter(a => a.account_type === 'liability'),
  }

  const categories: Category[] = ['Income', 'Liability', 'Asset', 'Expense']
  const accTypeOrder: AccountType[] = ['income', 'liability', 'asset', 'expense']

  return (
    <div>
      {/* Instruction banner */}
      <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
        <span className="text-base leading-none mt-0.5">💡</span>
        <span>
          Click a <strong>system event</strong> on the left to select it, then click an{' '}
          <strong>account</strong> on the right to connect them. Click a connected event
          to deselect. Click a connected account while the same event is selected to unmap.
        </span>
      </div>

      {/* Stats row */}
      <div className="mb-4 flex items-center gap-3 text-xs text-gray-500">
        <span>{mapping.size} / {SYSTEM_ROLES.length} events mapped</span>
        <span>·</span>
        <span>{SYSTEM_ROLES.length - mapping.size} unmapped</span>
        {selected && (
          <>
            <span>·</span>
            <span className="text-blue-600 font-medium animate-pulse">
              Select an account to map "{SYSTEM_ROLES.find(r => r.key === selected)?.label}"
            </span>
          </>
        )}
      </div>

      <div ref={containerRef} className="relative">
        <div className="grid" style={{ gridTemplateColumns: '1fr 120px 1fr' }}>

          {/* ── Left: System Events ──────────────────────────────────── */}
          <div className="pr-2 space-y-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">
              System Events
            </p>
            {categories.map(cat => {
              const style = CAT_STYLE[cat]
              const catRoles = SYSTEM_ROLES.filter(r => r.category === cat)
              return (
                <div key={cat}>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider mb-2 ${style.badgeCls}`}>
                    {cat}
                  </span>
                  <div className="space-y-1">
                    {catRoles.map(role => {
                      const isMapped   = mapping.has(role.key)
                      const isSelected = selected === role.key
                      return (
                        <div
                          key={role.key}
                          onClick={() => handleRoleClick(role.key)}
                          className={[
                            'flex items-center justify-between px-3 py-2 rounded-xl border cursor-pointer select-none transition-all duration-150',
                            isSelected
                              ? 'border-blue-500 bg-blue-50 shadow ring-1 ring-blue-300'
                              : isMapped
                                ? 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                                : 'border-dashed border-gray-300 bg-gray-50/80 hover:bg-white hover:border-gray-400',
                          ].join(' ')}
                        >
                          <div className="flex-1 min-w-0 pr-2">
                            <p className="text-xs font-semibold text-gray-800 leading-tight truncate">
                              {role.label}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5 leading-tight truncate">
                              {role.description}
                            </p>
                          </div>
                          {/* Connector dot */}
                          <span
                            ref={el => roleDotRefs.current.set(role.key, el)}
                            className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 transition-all"
                            style={{
                              borderColor: isMapped
                                ? style.stroke
                                : isSelected ? '#3b82f6' : '#d1d5db',
                              backgroundColor: isMapped
                                ? style.stroke
                                : isSelected ? '#bfdbfe' : 'white',
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Center: visual gap for bezier curves ──────────────── */}
          <div className="flex items-start justify-center pt-12">
            {selected && (
              <div className="sticky top-6 text-center">
                <div className="text-[9px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 leading-snug whitespace-nowrap">
                  ← pick account →
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Chart of Accounts ─────────────────────────── */}
          <div className="pl-2 space-y-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">
              Chart of Accounts
            </p>
            {accTypeOrder.map(type => {
              const accs = accByType[type]
              if (!accs.length) return null
              const cat   = ACC_TYPE_CAT[type]
              const style = CAT_STYLE[cat]
              return (
                <div key={type}>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider mb-2 ${style.badgeCls}`}>
                    {type}
                  </span>
                  <div className="space-y-1">
                    {accs.map(acc => {
                      const isConnected  = [...mapping.values()].includes(acc.id)
                      const isClickable  = !!selected
                      return (
                        <div
                          key={acc.id}
                          onClick={() => handleAccountClick(acc.id)}
                          className={[
                            'flex items-center px-3 py-2 rounded-xl border transition-all duration-150 select-none',
                            isClickable ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm' : 'cursor-default',
                            isConnected
                              ? 'border-gray-200 bg-white'
                              : 'border-dashed border-gray-300 bg-gray-50/80',
                          ].join(' ')}
                        >
                          {/* Connector dot */}
                          <span
                            ref={el => accDotRefs.current.set(acc.id, el)}
                            className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 mr-2.5 transition-all"
                            style={{
                              borderColor: isConnected ? style.stroke : '#d1d5db',
                              backgroundColor: isConnected ? style.stroke : 'white',
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">
                                {acc.code}
                              </span>
                              <span className="text-xs font-semibold text-gray-800 truncate">
                                {acc.name}
                              </span>
                            </div>
                            {acc.description && (
                              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight truncate">
                                {acc.description}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── SVG connector overlay ─────────────────────────────────── */}
        {/* overflow="visible" lets curves paint beyond the SVG bounds when the
            page scrolls and the container is taller than the viewport. */}
        <svg
          className="absolute inset-0 pointer-events-none"
          overflow="visible"
          style={{ top: 0, left: 0, width: '100%', height: '100%' }}
        >
          <defs>
            {Object.entries(CAT_STYLE).map(([cat, s]) => (
              <marker
                key={cat}
                id={`arm-${cat}`}
                markerWidth="5"
                markerHeight="5"
                refX="2.5"
                refY="2.5"
                orient="auto"
              >
                <circle cx="2.5" cy="2.5" r="2" fill={s.stroke} />
              </marker>
            ))}
          </defs>
          {paths.map(p => (
            <path
              key={p.roleKey}
              d={p.d}
              fill="none"
              stroke={p.stroke}
              strokeWidth={selected === p.roleKey ? 2.5 : 1.5}
              strokeOpacity={selected && selected !== p.roleKey ? 0.12 : 0.65}
              markerEnd={`url(#arm-${p.category})`}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}
