import { useEffect, useRef, useState } from 'react'
import { orgApi } from '@/api/org'
import type { OrgUserSummary } from '@/types/org'

interface UserPickerProps {
  /** Currently selected user id */
  value: string
  /** Called with (userId, fullName) when a user is selected */
  onChange: (userId: string, fullName: string) => void
  placeholder?: string
  className?: string
}

/**
 * Searchable dropdown that lists org staff (owner + agent roles) from GET /org/users.
 * Emits both user id and display name on selection.
 */
export default function UserPicker({
  value,
  onChange,
  placeholder = 'Select officer',
  className = '',
}: UserPickerProps) {
  const [users, setUsers] = useState<OrgUserSummary[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    orgApi.listUsers().then(setUsers).catch(() => {})
  }, [])

  // When value (userId) changes from parent, update the display query
  useEffect(() => {
    if (!value) { setQuery(''); return }
    const found = users.find((u) => u.id === value)
    if (found) setQuery(`${found.first_name} ${found.last_name}`.trim() || found.email)
  }, [value, users])

  const filtered = users.filter((u) => {
    const name = `${u.first_name} ${u.last_name}`.toLowerCase()
    const q = query.toLowerCase()
    return !q || name.includes(q) || u.email.toLowerCase().includes(q)
  })

  function select(u: OrgUserSummary) {
    const name = `${u.first_name} ${u.last_name}`.trim() || u.email
    setQuery(name)
    onChange(u.id, name)
    setOpen(false)
  }

  function handleClear() {
    setQuery('')
    onChange('', '')
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

  const selectedUser = users.find((u) => u.id === value)

  return (
    <div ref={ref} className={`relative ${className}`}>
      {selectedUser ? (
        /* Show selected user chip */
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
              {(selectedUser.first_name?.[0] || selectedUser.email[0]).toUpperCase()}
            </div>
            <span className="text-sm text-gray-900 truncate">
              {`${selectedUser.first_name} ${selectedUser.last_name}`.trim() || selectedUser.email}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">
              {selectedUser.role}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="text-gray-400 hover:text-gray-600 text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          className="input w-full text-sm"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
        />
      )}

      {open && !selectedUser && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">No staff users found</p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => select(u)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {(u.first_name?.[0] || u.email[0]).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {`${u.first_name} ${u.last_name}`.trim() || u.email}
                  </p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">
                  {u.role}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
