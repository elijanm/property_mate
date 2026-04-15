import { useEffect, useRef, useState } from 'react'
import type { PartsCatalogItem } from '@/types/framework'

interface Props {
  catalog: PartsCatalogItem[]
  value: string
  /** Which field drives the input value. Defaults to 'part_name'. */
  valueField?: 'part_name' | 'part_number'
  onChange: (part_name: string, part_number?: string, unit?: string) => void
  placeholder?: string
  className?: string
}

/**
 * Input with dropdown autocomplete from the parts catalog.
 * Works on both part_name and part_number fields.
 * On selection always fires onChange(name, part_number, unit) so all three get filled.
 */
export default function PartAutocomplete({
  catalog, value, valueField = 'part_name', onChange,
  placeholder, className = '',
}: Props) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const matches = query.length >= 1
    ? catalog.filter(p => {
        const q = query.toLowerCase()
        return p.part_name.toLowerCase().includes(q) ||
               (p.part_number && p.part_number.toLowerCase().includes(q))
      }).slice(0, 12)
    : []

  function select(item: PartsCatalogItem) {
    setQuery(valueField === 'part_number' ? (item.part_number ?? '') : item.part_name)
    setOpen(false)
    onChange(item.part_name, item.part_number, item.unit)
  }

  function handleChange(val: string) {
    setQuery(val)
    setOpen(true)
    // propagate raw typed value — caller decides which field to update
    if (valueField === 'part_number') {
      onChange('', val)   // name unknown yet; caller keeps existing name
    } else {
      onChange(val)
    }
  }

  const defaultPlaceholder = valueField === 'part_number' ? 'P/N' : 'Part name'

  return (
    <div ref={ref} className="relative w-full">
      <input
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? defaultPlaceholder}
        className={`w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300 ${valueField === 'part_number' ? 'font-mono' : ''} ${className}`}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto min-w-[260px]">
          {matches.map(item => (
            <button
              key={item.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); select(item) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
            >
              <div className="flex-1 min-w-0">
                {item.part_number && (
                  <span className="font-mono text-[10px] font-semibold text-amber-700 mr-2">{item.part_number}</span>
                )}
                <span className="font-medium text-gray-900">{item.part_name}</span>
                {item.category && <span className="ml-2 text-[10px] text-gray-400">{item.category}</span>}
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{item.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
