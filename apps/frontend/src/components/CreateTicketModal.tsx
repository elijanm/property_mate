import { createPortal } from 'react-dom'
import { useState } from 'react'
import { generalTicketsApi } from '@/api/tickets'
import { extractApiError } from '@/utils/apiError'
import type { TicketCategoryConfig } from '@/types/org'
import type { Ticket } from '@/types/ticket'

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

interface Props {
  propertyId: string
  categories: TicketCategoryConfig[]
  onCreated: (ticket: Ticket) => void
  onClose: () => void
}

export default function CreateTicketModal({ propertyId, categories, onCreated, onClose }: Props) {
  const enabledCategories = categories.filter((c) => c.enabled)
  const [category, setCategory] = useState(enabledCategories[0]?.key ?? 'maintenance')
  const [priority, setPriority] = useState('normal')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const ticket = await generalTicketsApi.create({
        property_id: propertyId,
        category,
        priority,
        title: title.trim(),
        description: description.trim() || undefined,
      })
      onCreated(ticket)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New Ticket</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              className="input w-full"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                const cat = enabledCategories.find((c) => c.key === e.target.value)
                if (cat) setPriority(cat.default_priority)
              }}
            >
              {enabledCategories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.icon ? `${c.icon} ` : ''}{c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
            <select
              className="input w-full"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
            <input
              className="input w-full"
              placeholder="Brief description of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="input w-full resize-none"
              rows={3}
              placeholder="Additional details…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
