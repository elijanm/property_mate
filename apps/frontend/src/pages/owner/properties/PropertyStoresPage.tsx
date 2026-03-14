import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { storesApi } from '@/api/stores'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { usePropertyContext } from '@/context/PropertyContext'
import { useToast } from '@/context/ToastContext'
import UserPicker from '@/components/UserPicker'
import type {
  StoreCapacitySummary,
  StoreConfig,
  StoreConfigUpdatePayload,
  StoreCreatePayload,
  StoreLocation,
  StoreLocationCreatePayload,
  StoreLocationUpdatePayload,
} from '@/types/store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CAPACITY_UNITS = ['units', 'kg', 'pallets', 'boxes', 'litres', 'sqm']

const TYPE_ICONS: Record<string, string> = {
  store: '🏭',
  zone: '🗂️',
  aisle: '🛤️',
  rack: '🪜',
  bay: '📦',
  level: '📋',
  bin: '🗃️',
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  store: 'bg-indigo-100 text-indigo-700',
  zone: 'bg-purple-100 text-purple-700',
  aisle: 'bg-blue-100 text-blue-700',
  rack: 'bg-cyan-100 text-cyan-700',
  bay: 'bg-amber-100 text-amber-700',
  level: 'bg-orange-100 text-orange-700',
  bin: 'bg-emerald-100 text-emerald-700',
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-gray-100 text-gray-500',
  maintenance: 'bg-amber-100 text-amber-700',
}

function OccupancyBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 w-9 text-right">{pct.toFixed(1)}%</span>
    </div>
  )
}

// ─── Create Store Modal ────────────────────────────────────────────────────────

function CreateStoreModal({
  propertyId,
  storeConfig,
  onCreated,
  onClose,
}: {
  propertyId: string
  storeConfig: StoreConfig
  onCreated: (store: StoreLocation) => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [officerId, setOfficerId] = useState('')
  const [form, setForm] = useState<StoreCreatePayload>({
    name: '',
    code: undefined,
    label: '',
    description: '',
    capacity_value: undefined,
    capacity_unit: storeConfig.default_capacity_unit || 'units',
    assigned_officer_id: undefined,
    assigned_officer_name: '',
    sort_order: 0,
  })

  const set = (k: keyof StoreCreatePayload, v: unknown) =>
    setForm((p) => ({ ...p, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const store = await storesApi.create(propertyId, {
        ...form,
        code: form.code?.trim() || undefined,
        label: form.label || undefined,
        description: form.description || undefined,
        capacity_value: form.capacity_value ?? undefined,
        assigned_officer_id: officerId || undefined,
        assigned_officer_name: form.assigned_officer_name || undefined,
      })
      onCreated(store)
      showToast('Store created', 'success')
    } catch {
      showToast('Failed to create store', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Create Store</h2>
            <p className="text-xs text-gray-500">Add a new storage location to this property</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input className="input text-sm" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Main Warehouse" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Code <span className="text-gray-400 font-normal">(auto)</span></label>
              <input className="input text-sm" value={form.code ?? ''} onChange={e => set('code', e.target.value || undefined)} placeholder="WH-1" />
            </div>
          </div>
          {storeConfig.allow_labelling && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input className="input text-sm" value={form.label} onChange={e => set('label', e.target.value)} placeholder="Optional display label" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input text-sm resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Capacity</label>
              <input type="number" step="0.01" min="0" className="input text-sm" value={form.capacity_value ?? ''} onChange={e => set('capacity_value', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="e.g. 500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
              <select className="input text-sm" value={form.capacity_unit} onChange={e => set('capacity_unit', e.target.value)}>
                {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {storeConfig.allow_owner_assignment && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Officer</label>
              <UserPicker
                value={officerId}
                onChange={(id, name) => { setOfficerId(id); set('assigned_officer_name', name) }}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
            <input type="number" className="input text-sm w-24" value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} />
          </div>
        </form>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={handleSubmit as never} disabled={saving || !form.name.trim()} className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {saving ? 'Creating…' : 'Create Store'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Location Modal ────────────────────────────────────────────────────────

function AddLocationModal({
  propertyId,
  storeId,
  parentLocation,
  storeConfig,
  onCreated,
  onClose,
}: {
  propertyId: string
  storeId: string
  parentLocation: StoreLocation
  storeConfig: StoreConfig
  onCreated: () => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  type ChildLocationType = 'zone' | 'aisle' | 'rack' | 'bay' | 'level' | 'bin'
  const childTypeOptions = (): ChildLocationType[] => {
    if (parentLocation.location_type === 'store') return ['zone']
    if (parentLocation.location_type === 'zone') return ['aisle']
    if (parentLocation.location_type === 'aisle') return ['rack']
    if (parentLocation.location_type === 'rack') return ['bay']
    if (parentLocation.location_type === 'bay') return ['level']
    if (parentLocation.location_type === 'level') return ['bin']
    return []
  }
  const options = childTypeOptions()
  const defaultType: ChildLocationType = options[0] || 'zone'

  const [officerId, setOfficerId] = useState('')
  const [form, setForm] = useState<StoreLocationCreatePayload>({
    name: '',
    code: undefined,
    label: '',
    description: '',
    location_type: defaultType,
    parent_id: parentLocation.id,
    capacity_value: undefined,
    capacity_unit: storeConfig.default_capacity_unit || 'units',
    assigned_officer_id: undefined,
    assigned_officer_name: '',
    sort_order: 0,
  })
  const set = (k: keyof StoreLocationCreatePayload, v: unknown) =>
    setForm((p) => ({ ...p, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      await storesApi.createLocation(propertyId, storeId, {
        ...form,
        code: form.code?.trim() || undefined,
        label: form.label || undefined,
        description: form.description || undefined,
        capacity_value: form.capacity_value ?? undefined,
        assigned_officer_id: officerId || undefined,
        assigned_officer_name: form.assigned_officer_name || undefined,
      })
      onCreated()
      showToast('Location added', 'success')
    } catch {
      showToast('Failed to add location', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (options.length === 0) return null

  const typeLabel = { zone: 'Zone', aisle: 'Aisle', rack: 'Rack', bay: 'Bay', level: 'Level', bin: 'Bin' }[defaultType]

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add {typeLabel}</h2>
            <p className="text-xs text-gray-500">Under: {parentLocation.path}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input className="input text-sm" value={form.name} onChange={e => set('name', e.target.value)} placeholder={`${typeLabel} 1`} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Code <span className="text-gray-400 font-normal">(auto)</span></label>
              <input className="input text-sm" value={form.code ?? ''} onChange={e => set('code', e.target.value || undefined)} placeholder="Auto-generated" />
            </div>
          </div>
          {storeConfig.allow_labelling && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input className="input text-sm" value={form.label} onChange={e => set('label', e.target.value)} placeholder="Optional label" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Capacity</label>
              <input type="number" step="0.01" min="0" className="input text-sm" value={form.capacity_value ?? ''} onChange={e => set('capacity_value', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="e.g. 100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
              <select className="input text-sm" value={form.capacity_unit} onChange={e => set('capacity_unit', e.target.value)}>
                {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {storeConfig.allow_owner_assignment && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Officer</label>
              <UserPicker
                value={officerId}
                onChange={(id, name) => { setOfficerId(id); set('assigned_officer_name', name) }}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
            <input type="number" className="input text-sm w-24" value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} />
          </div>
        </form>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={handleSubmit as never} disabled={saving || !form.name.trim()} className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {saving ? 'Adding…' : `Add ${typeLabel}`}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Location Slide-Over ──────────────────────────────────────────────────

function EditLocationModal({
  propertyId,
  location,
  storeConfig,
  onSaved,
  onClose,
}: {
  propertyId: string
  location: StoreLocation
  storeConfig: StoreConfig
  onSaved: () => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [officerId, setOfficerId] = useState(location.assigned_officer_id || '')
  const [form, setForm] = useState<StoreLocationUpdatePayload>({
    name: location.name,
    code: location.code,
    label: location.label || '',
    description: location.description || '',
    capacity_value: location.capacity_value,
    capacity_unit: location.capacity_unit,
    assigned_officer_id: location.assigned_officer_id || undefined,
    assigned_officer_name: location.assigned_officer_name || '',
    sort_order: location.sort_order,
    status: location.status,
  })
  const set = (k: keyof StoreLocationUpdatePayload, v: unknown) =>
    setForm((p) => ({ ...p, [k]: v }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await storesApi.updateLocation(propertyId, location.id, {
        ...form,
        label: form.label || undefined,
        description: form.description || undefined,
        assigned_officer_id: officerId || undefined,
        assigned_officer_name: form.assigned_officer_name || undefined,
      })
      onSaved()
      showToast('Location updated', 'success')
    } catch {
      showToast('Failed to update location', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit Location</h2>
            <p className="text-xs text-gray-500">{location.path}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
              <input className="input text-sm" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
              <input className="input text-sm" value={form.code} onChange={e => set('code', e.target.value)} />
            </div>
          </div>
          {storeConfig.allow_labelling && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input className="input text-sm" value={form.label} onChange={e => set('label', e.target.value)} />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input text-sm resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Capacity</label>
              <input type="number" step="0.01" min="0" className="input text-sm" value={form.capacity_value ?? ''} onChange={e => set('capacity_value', e.target.value ? parseFloat(e.target.value) : undefined)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
              <select className="input text-sm" value={form.capacity_unit} onChange={e => set('capacity_unit', e.target.value)}>
                {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {storeConfig.allow_owner_assignment && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Officer</label>
              <UserPicker
                value={officerId}
                onChange={(id, name) => { setOfficerId(id); set('assigned_officer_name', name) }}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
              <input type="number" className="input text-sm" value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select className="input text-sm" value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
        </form>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={handleSave as never} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Store Config Panel ────────────────────────────────────────────────────────

function StoreConfigurePanel({
  propertyId,
  initial,
  onClose,
  onSaved,
}: {
  propertyId: string
  initial: StoreConfig
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [cfg, setCfg] = useState<StoreConfigUpdatePayload>({
    allow_segmentation: initial.allow_segmentation,
    allow_labelling: initial.allow_labelling,
    allow_owner_assignment: initial.allow_owner_assignment,
    default_capacity_unit: initial.default_capacity_unit,
  })

  async function handleSave() {
    setSaving(true)
    try {
      await storesApi.updateConfig(propertyId, cfg)
      await onSaved()
      showToast('Store configuration saved', 'success')
      onClose()
    } catch {
      showToast('Failed to save configuration', 'error')
    } finally {
      setSaving(false)
    }
  }

  function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        <div
          onClick={() => onChange(!value)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors ${value ? 'bg-blue-600' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏭</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Store Configuration</h2>
              <p className="text-xs text-gray-500">Configure store management settings for this property</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <Toggle
            label="Allow Segmentation"
            desc="Enable zone → aisle → rack → bay → level → bin hierarchy for stores in this property."
            value={cfg.allow_segmentation!}
            onChange={v => setCfg(p => ({ ...p, allow_segmentation: v }))}
          />
          <Toggle
            label="Allow Labelling"
            desc="Allow custom labels and planogram codes per zone."
            value={cfg.allow_labelling!}
            onChange={v => setCfg(p => ({ ...p, allow_labelling: v }))}
          />
          <Toggle
            label="Owner / Officer Assignment"
            desc="Allow assigning a responsible officer to each store or zone."
            value={cfg.allow_owner_assignment!}
            onChange={v => setCfg(p => ({ ...p, allow_owner_assignment: v }))}
          />
          <div>
            <p className="text-sm font-medium text-gray-800 mb-1">Default Capacity Unit</p>
            <p className="text-xs text-gray-500 mb-2">Default unit applied when creating new stores and zones.</p>
            <select
              className="input text-sm"
              value={cfg.default_capacity_unit}
              onChange={e => setCfg(p => ({ ...p, default_capacity_unit: e.target.value }))}
            >
              {CAPACITY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Location Tree Node ────────────────────────────────────────────────────────

function LocationNode({
  loc,
  propertyId,
  storeId,
  storeConfig,
  onRefresh,
}: {
  loc: StoreLocation
  propertyId: string
  storeId: string
  storeConfig: StoreConfig
  onRefresh: () => void
}) {
  const { showToast } = useToast()
  const [expanded, setExpanded] = useState(true)
  const [showAddChild, setShowAddChild] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canAddChild = storeConfig.allow_segmentation && loc.depth < 6 && loc.location_type !== 'bin'

  async function handleDelete() {
    if (!confirm(`Delete "${loc.name}"? This will also delete all child locations.`)) return
    setDeleting(true)
    try {
      await storesApi.deleteLocation(propertyId, loc.id)
      onRefresh()
      showToast('Location deleted', 'success')
    } catch {
      showToast('Failed to delete location', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const hasChildren = loc.children && loc.children.length > 0
  const indentClass = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20', 'pl-24'][loc.depth] || 'pl-0'

  return (
    <div className={indentClass}>
      <div className="group flex items-center gap-2 py-2 px-3 rounded-xl hover:bg-gray-50 transition-colors">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className={`w-5 h-5 flex items-center justify-center text-gray-400 transition-transform ${hasChildren ? '' : 'opacity-0 pointer-events-none'} ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </button>

        {/* Icon */}
        <span className="text-base">{TYPE_ICONS[loc.location_type] || '📦'}</span>

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{loc.name}</span>
            <span className="text-[10px] font-mono text-gray-400">{loc.code}</span>
            {loc.label && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{loc.label}</span>}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_BADGE_COLORS[loc.location_type]}`}>{loc.location_type}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[loc.status] || STATUS_BADGE.inactive}`}>{loc.status}</span>
          </div>
          {loc.capacity_value != null && (
            <div className="mt-1 max-w-xs">
              <OccupancyBar pct={loc.occupancy_pct} />
              <p className="text-[10px] text-gray-400 mt-0.5">
                {loc.current_occupancy} / {loc.capacity_value} {loc.capacity_unit}
              </p>
            </div>
          )}
          {loc.assigned_officer_name && (
            <p className="text-[10px] text-gray-400 mt-0.5">👤 {loc.assigned_officer_name}</p>
          )}
        </div>

        {/* Actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          {canAddChild && (
            <button
              onClick={() => setShowAddChild(true)}
              className="px-2 py-1 text-[10px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              + {(['zone', 'aisle', 'rack', 'bay', 'level', 'bin'] as const)[loc.depth] || 'child'}
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="px-2 py-1 text-[10px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Edit
          </button>
          {loc.location_type !== 'store' && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-2 py-1 text-[10px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? '…' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {loc.children.map(child => (
            <LocationNode
              key={child.id}
              loc={child}
              propertyId={propertyId}
              storeId={storeId}
              storeConfig={storeConfig}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      {showAddChild && (
        <AddLocationModal
          propertyId={propertyId}
          storeId={storeId}
          parentLocation={loc}
          storeConfig={storeConfig}
          onCreated={() => { setShowAddChild(false); onRefresh() }}
          onClose={() => setShowAddChild(false)}
        />
      )}
      {showEdit && (
        <EditLocationModal
          propertyId={propertyId}
          location={loc}
          storeConfig={storeConfig}
          onSaved={() => { setShowEdit(false); onRefresh() }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  )
}

// ─── Store Card ────────────────────────────────────────────────────────────────

function StoreCard({
  store,
  propertyId,
  storeConfig,
  onRefresh,
  onDelete,
}: {
  store: StoreLocation
  propertyId: string
  storeConfig: StoreConfig
  onRefresh: () => void
  onDelete: () => void
}) {
  const { showToast } = useToast()
  const [view, setView] = useState<'tree' | 'capacity'>('tree')
  const [treeData, setTreeData] = useState<StoreLocation | null>(null)
  const [capacity, setCapacity] = useState<StoreCapacitySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddAisle, setShowAddAisle] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadTree = useCallback(async () => {
    setLoading(true)
    try {
      const tree = await storesApi.getTree(propertyId, store.id)
      setTreeData(tree)
    } catch {
      showToast('Failed to load store tree', 'error')
    } finally {
      setLoading(false)
    }
  }, [propertyId, store.id, showToast])

  const loadCapacity = useCallback(async () => {
    try {
      const cap = await storesApi.getCapacity(propertyId, store.id)
      setCapacity(cap)
    } catch { /* silent */ }
  }, [propertyId, store.id])

  useEffect(() => {
    loadTree()
    loadCapacity()
  }, [loadTree, loadCapacity])

  async function handleDeleteStore() {
    if (!confirm(`Delete store "${store.name}" and all its zones?`)) return
    setDeleting(true)
    try {
      await storesApi.deleteLocation(propertyId, store.id)
      onDelete()
      showToast('Store deleted', 'success')
    } catch {
      showToast('Failed to delete store', 'error')
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Store header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{TYPE_ICONS.store}</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{store.name}</h3>
              <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{store.code}</span>
              {store.label && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">{store.label}</span>}
            </div>
            {store.description && <p className="text-xs text-gray-500 mt-0.5">{store.description}</p>}
            {store.assigned_officer_name && (
              <p className="text-[10px] text-gray-400 mt-0.5">👤 {store.assigned_officer_name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {storeConfig.allow_segmentation && (
            <button
              onClick={() => setShowAddAisle(true)}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              + Zone
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Edit
          </button>
          <button
            onClick={handleDeleteStore}
            disabled={deleting}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Capacity bar for store */}
      {store.capacity_value != null && (
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Overall Capacity</span>
            <span>{store.current_occupancy} / {store.capacity_value} {store.capacity_unit}</span>
          </div>
          <OccupancyBar pct={store.occupancy_pct} />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-100">
        {(['tree', 'capacity'] as const).map(t => (
          <button
            key={t}
            onClick={() => setView(t)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${view === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'tree' ? '🗂 Layout' : '📊 Capacity'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-4">
        {view === 'tree' && (
          loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : treeData ? (
            <div>
              {/* Root store row */}
              <LocationNode
                loc={treeData}
                propertyId={propertyId}
                storeId={store.id}
                storeConfig={storeConfig}
                onRefresh={() => { loadTree(); loadCapacity() }}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-6">Could not load layout</p>
          )
        )}

        {view === 'capacity' && (
          capacity.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">No capacity data — set capacity values on locations to see utilisation.</p>
          ) : (
            <div className="space-y-3">
              {capacity.map(c => (
                <div key={c.location_id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-gray-800 truncate">{c.location_name}</span>
                      <span className="text-[10px] text-gray-400 truncate">{c.path}</span>
                    </div>
                    <OccupancyBar pct={c.occupancy_pct} />
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {c.current_occupancy} / {c.capacity_value} {c.capacity_unit}
                    </p>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_BADGE[c.status] || STATUS_BADGE.inactive}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {showAddAisle && (
        <AddLocationModal
          propertyId={propertyId}
          storeId={store.id}
          parentLocation={{ ...store, depth: 0, location_type: 'store' as const, children: [] }}
          storeConfig={storeConfig}
          onCreated={() => { setShowAddAisle(false); loadTree(); loadCapacity() }}
          onClose={() => setShowAddAisle(false)}
        />
      )}
      {showEdit && (
        <EditLocationModal
          propertyId={propertyId}
          location={store}
          storeConfig={storeConfig}
          onSaved={() => { setShowEdit(false); onRefresh() }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PropertyStoresPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { property, refreshProperty } = usePropertyContext()
  const { showToast } = useToast()

  const [stores, setStores] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const storeConfig: StoreConfig = property?.store_config ?? {
    allow_segmentation: true,
    allow_labelling: true,
    allow_owner_assignment: true,
    default_capacity_unit: 'units',
  }

  const loadStores = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const res = await storesApi.list(propertyId)
      setStores(res.stores)
    } catch {
      showToast('Failed to load stores', 'error')
    } finally {
      setLoading(false)
    }
  }, [propertyId, showToast])

  useEffect(() => {
    loadStores()
  }, [loadStores])

  function handleStoreCreated(store: StoreLocation) {
    setStores(prev => [...prev, store])
    setShowCreate(false)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PropertyBreadcrumb page="Stores" />
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Store Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage warehouses, zones, aisles, racks, bays, levels, and bins for this property.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfig(true)}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors"
          >
            ⚙ Configure
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
          >
            + New Store
          </button>
        </div>
      </div>

      {/* Config badges */}
      <div className="flex flex-wrap gap-2 mb-6">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${storeConfig.allow_segmentation ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {storeConfig.allow_segmentation ? '✓ Segmentation' : '✗ No segmentation'}
        </span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${storeConfig.allow_labelling ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {storeConfig.allow_labelling ? '✓ Labelling' : '✗ No labelling'}
        </span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${storeConfig.allow_owner_assignment ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {storeConfig.allow_owner_assignment ? '✓ Officer assignment' : '✗ No officer assignment'}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-100 text-blue-700">
          Unit: {storeConfig.default_capacity_unit}
        </span>
      </div>

      {/* Stores */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : stores.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-gray-200">
          <p className="text-4xl mb-4">🏭</p>
          <h3 className="text-base font-semibold text-gray-700 mb-1">No stores yet</h3>
          <p className="text-sm text-gray-500 mb-5">Create your first storage location to start tracking inventory placement.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
          >
            + Create First Store
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {stores.map(store => (
            <StoreCard
              key={store.id}
              store={store}
              propertyId={propertyId!}
              storeConfig={storeConfig}
              onRefresh={loadStores}
              onDelete={() => setStores(prev => prev.filter(s => s.id !== store.id))}
            />
          ))}
        </div>
      )}

      {showCreate && propertyId && (
        <CreateStoreModal
          propertyId={propertyId}
          storeConfig={storeConfig}
          onCreated={handleStoreCreated}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showConfig && propertyId && (
        <StoreConfigurePanel
          propertyId={propertyId}
          initial={storeConfig}
          onClose={() => setShowConfig(false)}
          onSaved={refreshProperty}
        />
      )}
    </div>
  )
}
