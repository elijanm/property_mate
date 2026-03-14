import { useEffect, useRef, useState } from 'react'
import { storesApi } from '@/api/stores'
import type { StoreLocation } from '@/types/store'

interface StoreLocationPickerProps {
  propertyId: string
  value?: string
  onChange: (locationId: string, locationPath: string) => void
  placeholder?: string
  className?: string
}

interface TreeRow {
  loc: StoreLocation
  prefix: string   // e.g. "│   ├ " — everything before the node name
  isRoot: boolean
}

/** Build a sorted flat list with ASCII tree-line prefixes from a flat location array. */
function buildTreeRows(locations: StoreLocation[]): TreeRow[] {
  // children map: parentId → sorted children
  const childrenOf = new Map<string, StoreLocation[]>()
  const roots: StoreLocation[] = []

  for (const loc of locations) {
    if (!loc.parent_id) {
      roots.push(loc)
    } else {
      if (!childrenOf.has(loc.parent_id)) childrenOf.set(loc.parent_id, [])
      childrenOf.get(loc.parent_id)!.push(loc)
    }
  }

  // Sort all groups by sort_order
  const sortBy = (arr: StoreLocation[]) => [...arr].sort((a, b) => a.sort_order - b.sort_order)

  const rows: TreeRow[] = []

  function recurse(locs: StoreLocation[], linePrefix: string, depth: number) {
    const sorted = sortBy(locs)
    sorted.forEach((loc, i) => {
      const isLast = i === sorted.length - 1
      const connector = isLast ? '└ ' : '├ '
      rows.push({ loc, prefix: linePrefix + connector, isRoot: false })
      const kids = childrenOf.get(loc.id) ?? []
      const childPrefix = linePrefix + (isLast ? '    ' : '│   ')
      if (kids.length) {
        recurse(kids, childPrefix, depth + 1)
      }
      // Visual gap after non-last depth-0 items that have children
      if (!isLast && depth === 0 && kids.length) {
        rows.push({ loc: { id: '__grp__' + loc.id } as StoreLocation, prefix: linePrefix + '│', isRoot: false })
      }
    })
  }

  sortBy(roots).forEach((root, i) => {
    // Root stores shown as headings — no connector
    rows.push({ loc: root, prefix: '', isRoot: true })
    const kids = childrenOf.get(root.id) ?? []
    // First-level children start with a leading space so branches align under the warehouse name
    if (kids.length) recurse(kids, ' ', 0)
    // Visual gap between separate warehouses
    if (i < roots.length - 1) {
      rows.push({ loc: { id: '__sep__' + i } as StoreLocation, prefix: '', isRoot: false })
    }
  })

  return rows
}

function occupancyColor(pct: number) {
  if (pct >= 90) return 'text-red-600 bg-red-50'
  if (pct >= 70) return 'text-amber-600 bg-amber-50'
  return 'text-green-700 bg-green-50'
}

export default function StoreLocationPicker({
  propertyId,
  value,
  onChange,
  placeholder = 'Select store location',
  className = '',
}: StoreLocationPickerProps) {
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!propertyId) return
    storesApi.listAllLocations(propertyId).then(setLocations).catch(() => {})
  }, [propertyId])

  // Sync display text when value or locations change
  useEffect(() => {
    if (!value) { setQuery(''); return }
    const found = locations.find((l) => l.id === value)
    if (found) setQuery(found.path || found.name)
  }, [value, locations])

  const isSearching = query.length > 0 && !value

  // Flat filtered list for search mode
  const flatFiltered = isSearching
    ? locations.filter((l) => {
        const q = query.toLowerCase()
        return (
          l.name.toLowerCase().includes(q) ||
          l.code.toLowerCase().includes(q) ||
          (l.path || '').toLowerCase().includes(q)
        )
      })
    : []

  // Tree rows for browse mode
  const treeRows = !isSearching ? buildTreeRows(locations) : []

  const selectedLoc = locations.find((l) => l.id === value)

  function select(loc: StoreLocation) {
    const path = loc.path || loc.name
    onChange(loc.id, path)
    setQuery(path)
    setOpen(false)
  }

  function handleClear() {
    onChange('', '')
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

  const noLocations = locations.length === 0

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Selected chip */}
      {selectedLoc ? (
        <div className="flex items-start gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{selectedLoc.name}</p>
            {selectedLoc.path && selectedLoc.path !== selectedLoc.name && (
              <p className="text-[11px] text-gray-400 font-mono truncate">{selectedLoc.path}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
              {selectedLoc.location_type}
            </span>
            {selectedLoc.capacity_value != null && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${occupancyColor(selectedLoc.occupancy_pct)}`}>
                {selectedLoc.occupancy_pct.toFixed(0)}%
              </span>
            )}
            <button type="button" onClick={handleClear} className="text-gray-400 hover:text-gray-600 text-xs ml-1">
              ✕
            </button>
          </div>
        </div>
      ) : (
        <input
          className="input w-full text-sm"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={noLocations ? 'No store locations configured' : placeholder}
          autoComplete="off"
          disabled={noLocations}
        />
      )}

      {/* Dropdown */}
      {open && !selectedLoc && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto">
          {/* Search mode — flat results */}
          {isSearching && (
            flatFiltered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">No locations match "{query}"</p>
            ) : (
              flatFiltered.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => select(loc)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-gray-50 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{loc.name}</p>
                    {loc.path && loc.path !== loc.name && (
                      <p className="text-[11px] text-gray-400 font-mono truncate">{loc.path}</p>
                    )}
                  </div>
                  {loc.capacity_value != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${occupancyColor(loc.occupancy_pct)}`}>
                      {loc.occupancy_pct.toFixed(0)}%
                    </span>
                  )}
                </button>
              ))
            )
          )}

          {/* Browse mode — tree view */}
          {!isSearching && (
            treeRows.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">No store locations configured</p>
            ) : (
              treeRows.map((row, idx) => {
                // Separator / group-gap row
                if (row.loc.id.startsWith('__sep__') || row.loc.id.startsWith('__grp__')) {
                  return (
                    <div key={'sep' + idx} className="px-3 py-0.5 text-[11px] font-mono text-gray-300 select-none">
                      {row.prefix}
                    </div>
                  )
                }

                const loc = row.loc

                if (row.isRoot) {
                  // Warehouse header — not directly selectable; clicking selects the store
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => select(loc)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-100"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base shrink-0">🏭</span>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Warehouse: </span>
                          <span className="text-sm font-bold text-gray-900">{loc.name}</span>
                          {loc.code && <span className="text-xs text-gray-400 ml-1">({loc.code})</span>}
                        </div>
                      </div>
                      {loc.capacity_value != null && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${occupancyColor(loc.occupancy_pct)}`}>
                          {loc.occupancy_pct.toFixed(0)}%
                        </span>
                      )}
                    </button>
                  )
                }

                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => select(loc)}
                    className="w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center justify-between gap-1 group"
                  >
                    <div className="flex items-baseline gap-0 min-w-0">
                      {/* Tree prefix in monospace */}
                      <span className="font-mono text-[12px] text-gray-300 whitespace-pre shrink-0 select-none group-hover:text-blue-200">
                        {row.prefix}
                      </span>
                      {/* Node name */}
                      <span className="text-sm text-gray-800 truncate">
                        {loc.name}
                        {loc.code && loc.code !== loc.name && (
                          <span className="text-[11px] text-gray-400 ml-1 font-mono">({loc.code})</span>
                        )}
                      </span>
                    </div>
                    {/* Right badges */}
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-gray-400">{loc.location_type}</span>
                      {loc.capacity_value != null && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${occupancyColor(loc.occupancy_pct)}`}>
                          {loc.occupancy_pct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )
          )}
        </div>
      )}
    </div>
  )
}
