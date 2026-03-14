import { useEffect, useRef, useState } from 'react'
import { listVendors } from '@/api/vendors'
import type { VendorProfile } from '@/types/vendor'

interface VendorPickerProps {
  value: string
  onChange: (name: string) => void
  placeholder?: string
  className?: string
}

export default function VendorPicker({
  value,
  onChange,
  placeholder = 'Select vendor',
  className = '',
}: VendorPickerProps) {
  const [vendors, setVendors] = useState<VendorProfile[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listVendors({ status: 'approved', page_size: 200 })
      .then((r) => setVendors(r.items ?? []))
      .catch(() => {})
  }, [])

  const filtered = query
    ? vendors.filter((v) =>
        v.company_name.toLowerCase().includes(query.toLowerCase()) ||
        (v.trading_name ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : vendors

  function select(vendor: VendorProfile) {
    onChange(vendor.trading_name || vendor.company_name)
    setQuery('')
    setOpen(false)
  }

  function useCustom() {
    if (!query.trim()) return
    onChange(query.trim())
    setQuery('')
    setOpen(false)
  }

  function handleClear() {
    onChange('')
    setQuery('')
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      {value ? (
        /* Selected chip */
        <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer" onClick={() => setOpen(true)}>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleClear() }}
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xs"
          >
            ✕
          </button>
        </div>
      ) : (
        /* Closed trigger button */
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white hover:border-gray-400 text-left transition-colors"
        >
          <span className="text-sm text-gray-400">{placeholder}</span>
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search box */}
          <div className="px-3 pt-3 pb-2">
            <input
              autoFocus
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
              placeholder="Search vendors…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* List */}
          <div className="max-h-52 overflow-y-auto pb-2">
            {filtered.length === 0 && !query && (
              <p className="px-4 py-3 text-xs text-gray-400">No approved vendors — type a name to add manually</p>
            )}
            {filtered.slice(0, 50).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => select(v)}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <p className="text-sm font-medium text-gray-900">{v.company_name}</p>
                {v.trading_name && v.trading_name !== v.company_name && (
                  <p className="text-[11px] text-gray-400">{v.trading_name}</p>
                )}
              </button>
            ))}
            {/* Free-text fallback: use typed name if not matched */}
            {query.trim() && !vendors.some(v =>
              (v.trading_name || v.company_name).toLowerCase() === query.trim().toLowerCase()
            ) && (
              <button
                type="button"
                onClick={useCustom}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-t border-gray-100 mt-1"
              >
                <p className="text-xs text-gray-500">Use <span className="font-medium text-gray-800">"{query.trim()}"</span> as supplier name</p>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
