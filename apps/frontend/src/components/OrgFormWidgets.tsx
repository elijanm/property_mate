/**
 * Shared widgets used in BusinessSetupPage and GlobalSettingsPage.
 * LogoUpload  — drag-or-click logo upload with preview
 * AccountsEditor — dynamic chart-of-accounts list (add / edit / remove)
 */

import { useRef, useState } from 'react'
import type { AccountEntry, AccountType } from '@/types/org'

/* ─── LogoUpload ────────────────────────────────────────────────────────── */

interface LogoUploadProps {
  currentUrl?: string
  /** Called with the selected File; parent handles the actual upload. */
  onFileSelected: (file: File) => void
  uploading?: boolean
}

export function LogoUpload({ currentUrl, onFileSelected, uploading }: LogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  function handleFile(file: File) {
    setPreview(URL.createObjectURL(file))
    onFileSelected(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) handleFile(file)
  }

  const displayed = preview ?? currentUrl

  return (
    <div className="flex items-center gap-5">
      {/* Preview */}
      <div
        className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 shrink-0 cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {displayed ? (
          <img src={displayed} alt="Logo" className="w-full h-full object-contain" />
        ) : (
          <span className="text-2xl text-gray-300">🏢</span>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : currentUrl ? 'Change Logo' : 'Upload Logo'}
        </button>
        <p className="text-xs text-gray-400 mt-1.5">PNG, JPG, SVG · max 2 MB</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}

/* ─── AccountsEditor ────────────────────────────────────────────────────── */

const TYPE_LABELS: Record<AccountType, string> = {
  income: 'Income',
  expense: 'Expense',
  asset: 'Asset',
  liability: 'Liability',
}

const TYPE_COLORS: Record<AccountType, string> = {
  income:    'bg-green-50 text-green-700',
  expense:   'bg-red-50 text-red-700',
  asset:     'bg-blue-50 text-blue-700',
  liability: 'bg-amber-50 text-amber-700',
}

const SYSTEM_ROLES = [
  { value: 'rental_income',    label: 'Rental Income' },
  { value: 'utility_income',    label: 'Utility Income' },
  { value: 'deposit',          label: 'Security Deposit' },
  { value: 'expense',          label: 'Operating Expense' },
  { value: 'late_fee',         label: 'Late Fee' },
  { value: 'tax_payable',      label: 'Tax Payable' },
  { value: 'agent_receivable', label: 'Agent Receivable' },
  { value: 'commission',       label: 'Commission' },
  { value: 'maintenance',      label: 'Maintenance' },
]

interface AccountsEditorProps {
  accounts: AccountEntry[]
  onChange: (accounts: AccountEntry[]) => void
}

export function AccountsEditor({ accounts, onChange }: AccountsEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)

  function add() {
    const newEntry: AccountEntry = {
      id: crypto.randomUUID(),
      code: '',
      name: '',
      account_type: 'income',
    }
    onChange([...accounts, newEntry])
    setEditingId(newEntry.id)
  }

  function remove(id: string) {
    onChange(accounts.filter((a) => a.id !== id))
    if (editingId === id) setEditingId(null)
  }

  function patch(id: string, field: keyof AccountEntry, value: string) {
    onChange(accounts.map((a) => (a.id === id ? { ...a, [field]: value } : a)))
  }

  return (
    <div>
      <div className="space-y-2">
        {accounts.map((account) => {
          const isEditing = editingId === account.id
          return (
            <div
              key={account.id}
              className="border border-gray-200 rounded-xl overflow-hidden"
            >
              {/* Row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setEditingId(isEditing ? null : account.id)}
              >
                <span
                  className={[
                    'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
                    TYPE_COLORS[account.account_type],
                  ].join(' ')}
                >
                  {TYPE_LABELS[account.account_type]}
                </span>
                <span className="text-sm font-mono text-gray-500 w-14 shrink-0">{account.code || '—'}</span>
                <span className="text-sm font-medium text-gray-900 flex-1 truncate">
                  {account.name || <span className="text-gray-400 italic">Untitled</span>}
                </span>
                {account.role && (
                  <span className="text-xs text-gray-400 shrink-0">
                    {SYSTEM_ROLES.find((r) => r.value === account.role)?.label ?? account.role}
                  </span>
                )}
                <span className="text-gray-400 text-xs ml-1">{isEditing ? '▲' : '▼'}</span>
              </div>

              {/* Expanded editor */}
              {isEditing && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
                      <input
                        className="input text-sm"
                        value={account.code}
                        onChange={(e) => patch(account.id, 'code', e.target.value)}
                        placeholder="4000"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Name</label>
                      <input
                        className="input text-sm"
                        value={account.name}
                        onChange={(e) => patch(account.id, 'name', e.target.value)}
                        placeholder="e.g. Rental Income"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                      <select
                        className="input text-sm"
                        value={account.account_type}
                        onChange={(e) => patch(account.id, 'account_type', e.target.value)}
                      >
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                        <option value="asset">Asset</option>
                        <option value="liability">Liability</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">System Role (optional)</label>
                      <select
                        className="input text-sm"
                        value={account.role ?? ''}
                        onChange={(e) => patch(account.id, 'role', e.target.value)}
                      >
                        <option value="">— Custom / none —</option>
                        {SYSTEM_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
                    <input
                      className="input text-sm"
                      value={account.description ?? ''}
                      onChange={(e) => patch(account.id, 'description', e.target.value)}
                      placeholder="Short note about this account"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => remove(account.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove account
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 text-sm text-blue-600 font-medium hover:underline flex items-center gap-1"
      >
        <span>+</span> Add Account
      </button>
    </div>
  )
}
