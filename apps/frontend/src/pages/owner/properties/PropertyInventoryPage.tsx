import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { inventoryApi } from '@/api/inventory'
import { assetsApi } from '@/api/assets'
import { unitsApi } from '@/api/units'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import { useProperty } from '@/context/PropertyContext'
import VendorPicker from '@/components/VendorPicker'
import StoreLocationPicker from '@/components/StoreLocationPicker'
import type { InventoryConfig } from '@/types/org'
import type { Unit } from '@/types/unit'
import type {
  InventoryCounts, InventoryItem, InventoryStatus, InventoryVariant, InventoryVariantPayload,
  SerialMergePayload, SerialSplitPayload,
  ShipmentCreatePayload, ShipmentItemPayload, StockSerial, StockShipment,
} from '@/types/inventory'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n?: number) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  out_of_stock: 'bg-red-100 text-red-700',
  discontinued: 'bg-gray-100 text-gray-600',
  on_order: 'bg-blue-100 text-blue-700',
}

const HAZARD_COLORS: Record<string, string> = {
  harmful: 'bg-orange-100 text-orange-800',
  poisonous: 'bg-purple-100 text-purple-800',
  flammable: 'bg-red-100 text-red-800',
  explosive: 'bg-red-200 text-red-900',
  corrosive: 'bg-yellow-100 text-yellow-800',
  fragile: 'bg-blue-100 text-blue-700',
  perishable: 'bg-green-100 text-green-700',
  controlled: 'bg-pink-100 text-pink-800',
}

const SHIPMENT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_driver: 'bg-yellow-100 text-yellow-800',
  driver_signed: 'bg-blue-100 text-blue-700',
  pending_receiver: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
}

function Badge({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

function StatCard({ label, value, color, alert }: { label: string; value: number; color: string; alert?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${alert && value > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

// ── Create Item Slide-Over ────────────────────────────────────────────────────

interface CreateItemSlideOverProps {
  propertyId: string
  onClose: () => void
  onCreated: (item: InventoryItem) => void
}

// Step labels
const CREATE_STEPS = ['Details', 'Image', 'Variants'] as const
type CreateStep = typeof CREATE_STEPS[number]

interface DraftVariant {
  id: string
  name: string
  sku: string
  purchase_cost: string
  selling_price: string
  attributes: { k: string; v: string }[]
  imageFile?: File
  imagePreview?: string
}

function CreateItemModal({ propertyId, onClose, onCreated }: CreateItemSlideOverProps) {
  // Step state
  const [step, setStep] = useState<CreateStep>('Details')

  // Details form
  const [form, setForm] = useState({
    name: '',
    category: '',
    subcategory: '',
    description: '',
    sku: '',
    barcode: '',
    unit_of_measure: 'unit',
    vendor_name: '',
    manufacturer: '',
    purchase_cost: '',
    markup_percent: '0',
    min_stock_level: '0',
    reorder_point: '0',
    reorder_quantity: '0',
    storage_location: '',
    notes: '',
    weight_per_unit: '',
    weight_variance_soft_pct: '2',
    weight_variance_hard_pct: '5',
  })
  const [isSerialised, setIsSerialised] = useState(false)
  const [weightTracking, setWeightTracking] = useState(false)
  const [tareTracking, setTareTracking] = useState(false)
  const [hazardClasses, setHazardClasses] = useState<string[]>([])
  const [storeLocationId, setStoreLocationId] = useState('')
  const [storeLocationPath, setStoreLocationPath] = useState('')

  // Image step
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Variants step
  const [variants, setVariants] = useState<DraftVariant[]>([])

  // Submission state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ALL_HAZARDS = ['harmful', 'poisonous', 'flammable', 'explosive', 'corrosive', 'fragile', 'perishable', 'controlled']

  function toggleHazard(h: string) {
    setHazardClasses(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h])
  }

  function handleImagePick(file: File) {
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = e => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function addVariant() {
    setVariants(prev => [...prev, {
      id: Math.random().toString(36).slice(2),
      name: '', sku: '', purchase_cost: '', selling_price: '', attributes: [],
    }])
  }

  function removeVariant(id: string) {
    setVariants(prev => prev.filter(v => v.id !== id))
  }

  function updateVariant(id: string, patch: Partial<DraftVariant>) {
    setVariants(prev => prev.map(v => v.id === id ? { ...v, ...patch } : v))
  }

  function addAttrRow(variantId: string) {
    updateVariant(variantId, {
      attributes: [...(variants.find(v => v.id === variantId)?.attributes ?? []), { k: '', v: '' }],
    })
  }

  function updateAttr(variantId: string, idx: number, field: 'k' | 'v', val: string) {
    const vx = variants.find(v => v.id === variantId)
    if (!vx) return
    const attrs = vx.attributes.map((a, i) => i === idx ? { ...a, [field]: val } : a)
    updateVariant(variantId, { attributes: attrs })
  }

  function removeAttr(variantId: string, idx: number) {
    const vx = variants.find(v => v.id === variantId)
    if (!vx) return
    updateVariant(variantId, { attributes: vx.attributes.filter((_, i) => i !== idx) })
  }

  function handleVariantImagePick(variantId: string, file: File) {
    const reader = new FileReader()
    reader.onload = e => updateVariant(variantId, { imageFile: file, imagePreview: e.target?.result as string })
    reader.readAsDataURL(file)
  }

  function validateDetails(): string | null {
    if (!form.name.trim()) return 'Name is required'
    if (!form.category.trim()) return 'Category is required'
    return null
  }

  function goNext() {
    if (step === 'Details') {
      const err = validateDetails()
      if (err) { setError(err); return }
      setError(null)
      setStep('Image')
    } else if (step === 'Image') {
      setStep('Variants')
    }
  }

  function goBack() {
    if (step === 'Image') setStep('Details')
    else if (step === 'Variants') setStep('Image')
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      // 1. Create the item
      let item = await inventoryApi.create({
        ...form,
        property_id: propertyId,
        store_location_id: storeLocationId || undefined,
        store_location_path: storeLocationPath || undefined,
        hazard_classes: hazardClasses as InventoryItem['hazard_classes'],
        purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : undefined,
        markup_percent: parseFloat(form.markup_percent) || 0,
        min_stock_level: parseFloat(form.min_stock_level) || 0,
        reorder_point: parseFloat(form.reorder_point) || 0,
        reorder_quantity: parseFloat(form.reorder_quantity) || 0,
        is_serialized: isSerialised,
        weight_per_unit: form.weight_per_unit ? parseFloat(form.weight_per_unit) : undefined,
        weight_tracking_enabled: weightTracking,
        tare_tracking_enabled: weightTracking ? tareTracking : false,
        weight_variance_soft_pct: parseFloat(form.weight_variance_soft_pct) || 2,
        weight_variance_hard_pct: parseFloat(form.weight_variance_hard_pct) || 5,
      })

      // 2. Upload product image if provided
      if (imageFile) {
        try { item = await inventoryApi.uploadImage(item.id, imageFile) } catch { /* non-fatal */ }
      }

      // 3. Create variants
      for (const dv of variants) {
        if (!dv.name.trim()) continue
        const attrs: Record<string, string> = {}
        dv.attributes.forEach(a => { if (a.k.trim()) attrs[a.k.trim()] = a.v })
        const payload: InventoryVariantPayload = {
          name: dv.name,
          sku: dv.sku || undefined,
          purchase_cost: dv.purchase_cost ? parseFloat(dv.purchase_cost) : undefined,
          selling_price: dv.selling_price ? parseFloat(dv.selling_price) : undefined,
          attributes: attrs,
        }
        item = await inventoryApi.createVariant(item.id, payload)
        // Upload variant image
        if (dv.imageFile) {
          const created = (item.variants ?? []).find(v => v.name === dv.name)
          if (created) {
            try { item = await inventoryApi.uploadVariantImage(item.id, created.id, dv.imageFile) } catch { /* non-fatal */ }
          }
        }
      }

      onCreated(item)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = CREATE_STEPS.indexOf(step)
  const isLast = step === 'Variants'

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Add Inventory Item</h2>
            <p className="text-xs text-gray-400 mt-0.5">Step {stepIndex + 1} of {CREATE_STEPS.length} — {step}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Step progress */}
        <div className="flex px-6 pt-3 gap-1">
          {CREATE_STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-blue-500' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* ── STEP 1: Details ── */}
          {step === 'Details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700">Name *</label>
                  <input className="input mt-1 w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Cleaning Detergent" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Category *</label>
                  <input className="input mt-1 w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Cleaning Supplies" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Subcategory</label>
                  <input className="input mt-1 w-full" value={form.subcategory} onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">SKU</label>
                  <input className="input mt-1 w-full" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Barcode</label>
                  <input className="input mt-1 w-full" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Unit of Measure</label>
                  <select className="input mt-1 w-full" value={form.unit_of_measure} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))}>
                    {['unit', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'roll', 'pair', 'set', 'bag', 'piece'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Vendor</label>
                  <VendorPicker
                    className="mt-1"
                    value={form.vendor_name}
                    onChange={name => setForm(f => ({ ...f, vendor_name: name }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Purchase Cost (KES)</label>
                  <input type="number" className="input mt-1 w-full" value={form.purchase_cost} onChange={e => setForm(f => ({ ...f, purchase_cost: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Markup %</label>
                  <input type="number" className="input mt-1 w-full" value={form.markup_percent} onChange={e => setForm(f => ({ ...f, markup_percent: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Min Stock</label>
                  <input type="number" className="input mt-1 w-full" value={form.min_stock_level} onChange={e => setForm(f => ({ ...f, min_stock_level: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Reorder Point</label>
                  <input type="number" className="input mt-1 w-full" value={form.reorder_point} onChange={e => setForm(f => ({ ...f, reorder_point: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Reorder Qty</label>
                  <input type="number" className="input mt-1 w-full" value={form.reorder_quantity} onChange={e => setForm(f => ({ ...f, reorder_quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Store Location</label>
                  <StoreLocationPicker
                    propertyId={propertyId}
                    value={storeLocationId}
                    onChange={(id, path) => { setStoreLocationId(id); setStoreLocationPath(path) }}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Weight per Unit (kg)</label>
                  <input type="number" step="0.001" className="input mt-1 w-full" value={form.weight_per_unit} onChange={e => setForm(f => ({ ...f, weight_per_unit: e.target.value }))} placeholder="e.g. 1.5" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                  <div onClick={() => setIsSerialised(v => !v)} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isSerialised ? 'bg-blue-600' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isSerialised ? 'translate-x-5' : ''}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Serialized</p>
                    <p className="text-xs text-gray-500">Each unit gets a unique S/N (e.g. laptops, cylinders, drums)</p>
                  </div>
                </label>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <label className="flex items-center gap-3 cursor-pointer select-none p-3 hover:border-gray-300 transition-colors">
                    <div onClick={() => { setWeightTracking(v => !v); if (weightTracking) setTareTracking(false) }} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${weightTracking ? 'bg-orange-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${weightTracking ? 'translate-x-5' : ''}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">Weight &amp; Fraud Detection</p>
                      <p className="text-xs text-gray-500">{isSerialised ? 'Record net weight per serial at stock-in. At dispatch, entered weight is compared to stock-in value — variance flagged if it exceeds the configured threshold.' : 'Record weight/volume/length at stock-in — added to total available. At dispatch, weight difference is audited and flagged if it exceeds the threshold.'}</p>
                    </div>
                  </label>
                  {weightTracking && (
                    <div className="px-4 pb-3 space-y-3 border-t border-gray-100 pt-3">
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div onClick={() => setTareTracking(v => !v)} className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${tareTracking ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                          <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${tareTracking ? 'translate-x-4' : ''}`} />
                        </div>
                        <span className="text-xs text-gray-600">{isSerialised ? 'Record net weight per serial at stock-in. At dispatch, entered weight is compared to stock-in value — variance flagged if it exceeds the configured threshold.' : 'Record weight/volume/length at stock-in — added to total available. At dispatch, weight difference is audited and flagged if it exceeds the threshold.'}</span>
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-gray-700">Soft variance %</label>
                          <input type="number" step="0.1" min="0" max="100" className="input mt-1 w-full" value={form.weight_variance_soft_pct} onChange={e => setForm(f => ({ ...f, weight_variance_soft_pct: e.target.value }))} />
                          <p className="text-xs text-gray-400 mt-0.5">Flag above this %</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-700">Hard variance %</label>
                          <input type="number" step="0.1" min="0" max="100" className="input mt-1 w-full" value={form.weight_variance_hard_pct} onChange={e => setForm(f => ({ ...f, weight_variance_hard_pct: e.target.value }))} />
                          <p className="text-xs text-gray-400 mt-0.5">Block dispatch above this %</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 block mb-2">Hazard Classification</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_HAZARDS.map(h => (
                    <button key={h} type="button" onClick={() => toggleHazard(h)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${hazardClasses.includes(h) ? `${HAZARD_COLORS[h]} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{h}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700">Notes</label>
                <textarea className="input mt-1 w-full" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          )}

          {/* ── STEP 2: Product Image ── */}
          {step === 'Image' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Upload a primary product image. You can skip this and add it later.</p>

              <label className={`block border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${imagePreview ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}>
                <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleImagePick(e.target.files[0]) }} />
                {imagePreview ? (
                  <div className="p-4 flex flex-col items-center gap-3">
                    <img src={imagePreview} alt="Preview" className="w-48 h-48 object-contain rounded-xl border border-gray-200 bg-white" />
                    <p className="text-xs text-blue-600 font-medium">Click to change image</p>
                    <p className="text-xs text-gray-400">{imageFile?.name}</p>
                  </div>
                ) : (
                  <div className="p-12 flex flex-col items-center gap-3 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gray-200 flex items-center justify-center text-3xl">📷</div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Click to upload product image</p>
                      <p className="text-xs text-gray-400 mt-1">PNG, JPG, WebP — max 10 MB</p>
                    </div>
                  </div>
                )}
              </label>

              {imagePreview && (
                <button type="button" onClick={() => { setImageFile(null); setImagePreview(null) }} className="text-xs text-red-500 hover:text-red-700">Remove image</button>
              )}
            </div>
          )}

          {/* ── STEP 3: Variants ── */}
          {step === 'Variants' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">Product Variants</p>
                  <p className="text-xs text-gray-500 mt-0.5">Add variants if this product comes in different options (e.g. colours, sizes). Optional — skip if not needed.</p>
                </div>
                <button type="button" onClick={addVariant} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shrink-0">+ Add Variant</button>
              </div>

              {variants.length === 0 && (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                  <p className="text-2xl mb-2">🎨</p>
                  <p className="text-sm text-gray-400">No variants yet</p>
                  <p className="text-xs text-gray-400 mt-1">Click "+ Add Variant" to add size/colour variations</p>
                </div>
              )}

              <div className="space-y-4">
                {variants.map((dv, idx) => (
                  <div key={dv.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Variant {idx + 1}</p>
                      <button type="button" onClick={() => removeVariant(dv.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                    </div>

                    {/* Variant image */}
                    <label className="block cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleVariantImagePick(dv.id, e.target.files[0]) }} />
                      {dv.imagePreview ? (
                        <div className="flex items-center gap-3">
                          <img src={dv.imagePreview} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                          <p className="text-xs text-blue-600">Click to change</p>
                        </div>
                      ) : (
                        <div className="w-14 h-14 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center hover:border-gray-400 transition-colors">
                          <span className="text-xs text-gray-400">📷</span>
                        </div>
                      )}
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="text-xs font-medium text-gray-700">Name *</label>
                        <input className="input mt-0.5 w-full text-sm" value={dv.name} onChange={e => updateVariant(dv.id, { name: e.target.value })} placeholder="e.g. Red - Size M" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700">SKU</label>
                        <input className="input mt-0.5 w-full text-sm" value={dv.sku} onChange={e => updateVariant(dv.id, { sku: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700">Purchase Cost</label>
                        <input type="number" step="0.01" className="input mt-0.5 w-full text-sm" value={dv.purchase_cost} onChange={e => updateVariant(dv.id, { purchase_cost: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700">Selling Price</label>
                        <input type="number" step="0.01" className="input mt-0.5 w-full text-sm" value={dv.selling_price} onChange={e => updateVariant(dv.id, { selling_price: e.target.value })} />
                      </div>
                    </div>

                    {/* Attributes */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-700">Attributes</label>
                        <button type="button" onClick={() => addAttrRow(dv.id)} className="text-xs text-blue-600 hover:text-blue-800">+ Add</button>
                      </div>
                      {dv.attributes.map((attr, i) => (
                        <div key={i} className="flex gap-2 mb-1.5">
                          <input className="input flex-1 text-xs" value={attr.k} onChange={e => updateAttr(dv.id, i, 'k', e.target.value)} placeholder="e.g. Color" />
                          <input className="input flex-1 text-xs" value={attr.v} onChange={e => updateAttr(dv.id, i, 'v', e.target.value)} placeholder="e.g. Red" />
                          <button type="button" onClick={() => removeAttr(dv.id, i)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                        </div>
                      ))}
                      {dv.attributes.length === 0 && <p className="text-xs text-gray-400">No attributes yet</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          {step !== 'Details' && (
            <button type="button" onClick={goBack} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">← Back</button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 mr-auto">Cancel</button>
          {isLast ? (
            <button type="button" onClick={handleSubmit} disabled={saving} className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Item'}
            </button>
          ) : (
            <button type="button" onClick={goNext} className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl">
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stock Movement Modal ──────────────────────────────────────────────────────

type MovementMode = 'in' | 'out' | 'adjust'

interface StockMovementModalProps {
  item: InventoryItem
  mode: MovementMode
  propertyId: string
  units: Unit[]
  onClose: () => void
  onUpdated: (item: InventoryItem, movedSerials?: string[]) => void
  inventoryConfig?: InventoryConfig
  storeAppInstalled?: boolean
}

function StockMovementModal({ item, mode, propertyId, units, onClose, onUpdated, inventoryConfig, storeAppInstalled }: StockMovementModalProps) {
  const dp = inventoryConfig?.decimal_places ?? 2
  const showWeightFields = inventoryConfig ? inventoryConfig.show_weight_tracking : true
  const [quantity, setQuantity] = useState('')

  // Asset conversion (stock-out only)
  const [convertToAsset, setConvertToAsset] = useState(false)
  const [outUnitId, setOutUnitId] = useState('')
  const [locationKey, setLocationKey] = useState(
    item.stock_levels[0]?.location_key ?? item.store_location_id ?? 'default'
  )
  const [locationLabel, setLocationLabel] = useState(
    item.stock_levels[0]?.location_label ??
    (item.store_location_path ? item.store_location_path.split(' / ').pop()! : 'Main Store')
  )
  const [storeLocationId, setStoreLocationId] = useState(item.store_location_id ?? '')
  const [storeLocationPath, setStoreLocationPath] = useState(item.store_location_path ?? '')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bulk weight tracking (non-serialized)
  const [bulkNetQty, setBulkNetQty] = useState('')         // recorded qty at stock-in
  const [bulkDispatchQty, setBulkDispatchQty] = useState('') // measured qty at dispatch
  const [bulkForceOverride, setBulkForceOverride] = useState(false)

  // Serialized — stock_in
  const [serials, setSerials] = useState<string[]>([''])
  // serialWeights[sn] = gross (tare mode) or net (direct mode)
  const [serialWeights, setSerialWeights] = useState<Record<string, string>>({})
  const [serialTareWeights, setSerialTareWeights] = useState<Record<string, string>>({})
  const [serialPurchaseCosts, setSerialPurchaseCosts] = useState<Record<string, string>>({})
  const [serialSellingPrices, setSerialSellingPrices] = useState<Record<string, string>>({})
  // variant per serial row (index-keyed)
  const [serialVariantIds, setSerialVariantIds] = useState<Record<number, string>>({})

  // Serialized — stock_out per-serial state
  interface OutSerial { qty: string; dispatchWt: string; forceOverride: boolean }
  const [outSerials, setOutSerials] = useState<Record<string, OutSerial>>({})

  // In stock-out, show in_stock serials selectable + merged/split greyed out
  const dispatchableSerials: StockSerial[] = (item.serials ?? []).filter(
    s => !s.parent_serial_id && ['in_stock', 'merged', 'split'].includes(s.status)
  )

  const titles: Record<MovementMode, string> = { in: 'Stock In', out: 'Stock Out', adjust: 'Adjust Stock' }
  const btnColors: Record<MovementMode, string> = { in: 'bg-green-600 hover:bg-green-700', out: 'bg-red-600 hover:bg-red-700', adjust: 'bg-blue-600 hover:bg-blue-700' }

  function toggleOutSerial(sn: string, serial: StockSerial) {
    setOutSerials(prev => {
      if (sn in prev) {
        const next = { ...prev }; delete next[sn]; return next
      }
      return { ...prev, [sn]: { qty: String(serial.quantity_remaining ?? 1), dispatchWt: '', forceOverride: false } }
    })
  }

  function varPct(sn: string, dispatchWt: string): number | null {
    // Variance = |qty_dispatched − actual_weighed| / qty_dispatched
    // This catches scale discrepancies regardless of whether dispatch is full or partial
    const os = outSerials[sn]
    const intended = parseFloat(os?.qty ?? '')
    const actual = parseFloat(dispatchWt)
    if (isNaN(intended) || isNaN(actual) || intended <= 0) return null
    return Math.abs(intended - actual) / intended * 100
  }

  // Bulk variance: expected = qty × weight_per_unit
  function bulkVarPct(qty: string, dispatch: string): number | null {
    const q = parseFloat(qty)
    const d = parseFloat(dispatch)
    if (!item.weight_per_unit || isNaN(q) || isNaN(d) || q <= 0) return null
    const expected = q * item.weight_per_unit
    return Math.abs(expected - d) / expected * 100
  }

  function anyForceNeeded(): boolean {
    return Object.entries(outSerials).some(([sn, os]) => {
      const pct = varPct(sn, os.dispatchWt)
      return pct !== null && pct > item.weight_variance_hard_pct && !os.forceOverride
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)

    try {
      let updated: InventoryItem
      let movedSerials: string[] | undefined

      if (item.is_serialized && mode !== 'adjust') {
        if (mode === 'in') {
          // Keep original indices so weight/price maps (keyed by idx) stay aligned after filtering
          const validEntries = serials
            .map((sn, idx) => ({ idx, sn: sn.trim() }))
            .filter(e => e.sn)
          if (!validEntries.length) { setError('Add at least one serial number'); setSaving(false); return }
          const validSerials = validEntries.map(e => e.sn)
          const swMap: Record<string, number> = {}
          const stMap: Record<string, number> = {}
          const spcMap: Record<string, number> = {}
          const sspMap: Record<string, number> = {}
          const svidMap: Record<string, string> = {}
          for (const { idx, sn } of validEntries) {
            const w = serialWeights[idx] ? parseFloat(serialWeights[idx]) : undefined
            if (w !== undefined && !isNaN(w)) swMap[sn] = w
            const t = serialTareWeights[idx] ? parseFloat(serialTareWeights[idx]) : undefined
            if (t !== undefined && !isNaN(t)) stMap[sn] = t
            const pc = serialPurchaseCosts[idx] ? parseFloat(serialPurchaseCosts[idx]) : undefined
            if (pc !== undefined && !isNaN(pc) && pc > 0) spcMap[sn] = pc
            const sp = serialSellingPrices[idx] ? parseFloat(serialSellingPrices[idx]) : undefined
            if (sp !== undefined && !isNaN(sp) && sp > 0) sspMap[sn] = sp
            const vid = serialVariantIds[idx]
            if (vid) svidMap[sn] = vid
          }
          updated = await inventoryApi.stockIn(item.id, {
            quantity: validSerials.length,
            location_key: locationKey,
            location_label: locationLabel,
            reference_no: reference || undefined,
            notes: notes || undefined,
            serial_numbers: validSerials,
            serial_weights: Object.keys(swMap).length ? swMap : undefined,
            serial_tare_weights: Object.keys(stMap).length ? stMap : undefined,
            serial_purchase_costs: Object.keys(spcMap).length ? spcMap : undefined,
            serial_selling_prices: Object.keys(sspMap).length ? sspMap : undefined,
            serial_variant_ids: Object.keys(svidMap).length ? svidMap : undefined,
            store_location_id: storeLocationId || undefined,
            store_location_path: storeLocationPath || undefined,
          })
          movedSerials = validSerials
        } else {
          // stock_out
          const selected = Object.keys(outSerials)
          if (!selected.length) { setError('Select at least one serial'); setSaving(false); return }
          if (anyForceNeeded()) { setError('Check "Force override" for serials exceeding hard variance limit'); setSaving(false); return }
          // Weight-tracked: ensure gate weight is entered when weight tracking is on
          if (item.weight_tracking_enabled) {
            for (const sn of selected) {
              const dw = parseFloat(outSerials[sn].dispatchWt)
              if (isNaN(dw) || dw <= 0) { setError(`Enter gate weight for serial ${sn}`); setSaving(false); return }
            }
          }
          const serialQty: Record<string, number> = {}
          const dispatchWts: Record<string, number> = {}
          let needForce = false
          for (const sn of selected) {
            const os = outSerials[sn]
            const q = parseFloat(os.qty)
            if (!isNaN(q) && q > 0) serialQty[sn] = q
            const dw = parseFloat(os.dispatchWt)
            if (!isNaN(dw) && dw > 0) dispatchWts[sn] = dw
            if (os.forceOverride) needForce = true
          }
          movedSerials = selected
          updated = await inventoryApi.stockOut(item.id, {
            quantity: selected.length,
            location_key: locationKey,
            reference_no: reference || undefined,
            notes: notes || undefined,
            serial_quantities: Object.keys(serialQty).length ? serialQty : undefined,
            serial_dispatch_weights: Object.keys(dispatchWts).length ? dispatchWts : undefined,
            force_override: needForce,
            store_location_id: storeLocationId || undefined,
            store_location_path: storeLocationPath || undefined,
          })
        }
      } else {
        const qty = parseFloat(quantity)
        if (!qty || qty <= 0) { setError('Enter a valid quantity'); setSaving(false); return }
        if (mode === 'in') {
          const bvp = bulkVarPct(quantity, bulkNetQty)
          updated = await inventoryApi.stockIn(item.id, {
            quantity: qty,
            location_key: locationKey,
            location_label: locationLabel,
            reference_no: reference || undefined,
            notes: notes || undefined,
            movement_net_qty: item.weight_tracking_enabled && bulkNetQty ? parseFloat(bulkNetQty) || undefined : undefined,
            store_location_id: storeLocationId || undefined,
            store_location_path: storeLocationPath || undefined,
          })
          void bvp // used only in UI preview
        } else if (mode === 'out') {
          const bvp = bulkVarPct(quantity, bulkDispatchQty)
          if (item.weight_tracking_enabled && bvp !== null && bvp > item.weight_variance_hard_pct && !bulkForceOverride) {
            setError(`Variance ${bvp.toFixed(1)}% exceeds hard limit ${item.weight_variance_hard_pct}%. Check "Force override" to proceed.`)
            setSaving(false)
            return
          }
          updated = await inventoryApi.stockOut(item.id, {
            quantity: qty,
            location_key: locationKey,
            reference_no: reference || undefined,
            notes: notes || undefined,
            movement_dispatch_qty: item.weight_tracking_enabled && bulkDispatchQty ? parseFloat(bulkDispatchQty) || undefined : undefined,
            force_override: bulkForceOverride || undefined,
            store_location_id: storeLocationId || undefined,
            store_location_path: storeLocationPath || undefined,
          })
        } else {
          updated = await inventoryApi.adjust(item.id, { quantity: qty, location_key: locationKey, location_label: locationLabel, notes: notes || undefined })
        }
      }

      // Convert dispatched items to assets
      if (mode === 'out' && convertToAsset) {
        const basePayload = {
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          description: item.description,
          property_id: propertyId,
          unit_id: outUnitId || undefined,
          vendor_name: item.vendor_name,
          manufacturer: item.manufacturer,
          model: item.manufacturer_part_number,
          purchase_cost: item.purchase_cost,
          store_location_id: storeLocationId || undefined,
          store_location_path: storeLocationPath || undefined,
          notes: notes || undefined,
        }
        if (item.is_serialized && movedSerials?.length) {
          // One asset per serial
          await Promise.allSettled(
            movedSerials.map(sn => {
              const serial = item.serials?.find(s => s.serial_number === sn)
              return assetsApi.create({
                ...basePayload,
                name: `${item.name} — ${sn}`,
                serial_number: sn,
                purchase_cost: serial?.purchase_cost ?? item.purchase_cost,
              })
            })
          )
        } else {
          await assetsApi.create(basePayload)
        }
      }

      onUpdated(updated, movedSerials)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  const availableAtLocation = item.stock_levels.find(s => s.location_key === locationKey)?.available_quantity ?? 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">{titles[mode]} — {item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Location picker */}
          {item.stock_levels.length > 0 && locationKey !== '__new' ? (
            <div>
              <label className="text-xs font-medium text-gray-700">Location</label>
              <select className="input mt-1 w-full" value={locationKey} onChange={e => {
                if (e.target.value === '__new') { setLocationKey('__new'); setLocationLabel('') }
                else {
                  const sl = item.stock_levels.find(s => s.location_key === e.target.value)
                  if (sl) { setLocationKey(sl.location_key); setLocationLabel(sl.location_label) }
                }
              }}>
                {item.stock_levels.map(s => (
                  <option key={s.location_key} value={s.location_key}>{s.location_label} ({s.available_quantity} available)</option>
                ))}
                {mode === 'in' && <option value="__new">+ New location…</option>}
              </select>
            </div>
          ) : (
            /* No existing locations, OR user picked "new location" — show location label + optional store picker */
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700">
                  {locationKey === '__new' ? 'New Location Name' : 'Location'}
                </label>
                <input
                  className="input mt-1 w-full"
                  value={locationLabel}
                  onChange={e => { setLocationLabel(e.target.value); setLocationKey(e.target.value.toLowerCase().replace(/\s+/g, '_')) }}
                  placeholder="e.g. Main Store"
                />
                {locationKey === '__new' && (
                  <button type="button" onClick={() => setLocationKey(item.stock_levels[0]?.location_key ?? 'default')}
                    className="mt-1 text-xs text-gray-400 hover:text-gray-600">← Back to existing locations</button>
                )}
              </div>

              {/* Store Location picker — shown when app installed and mode is stock-in/out */}
              {storeAppInstalled && mode !== 'adjust' && (
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    Store Location <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <StoreLocationPicker
                    propertyId={propertyId}
                    value={storeLocationId}
                    onChange={(id, path) => {
                      setStoreLocationId(id)
                      setStoreLocationPath(path)
                      // Auto-fill label from path if label is empty
                      if (!locationLabel && path) {
                        const label = path.split(' / ').pop()!
                        setLocationLabel(label)
                        setLocationKey(id || label.toLowerCase().replace(/\s+/g, '_'))
                      }
                    }}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
          )}

          {/* Serialized UI */}
          {item.is_serialized && mode === 'in' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">Serial Numbers</label>
                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{serials.filter(s => s.trim()).length} units</span>
              </div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {serials.map((sn, idx) => {
                  // Use idx as key for all row state — serial number value can change without losing data
                  const gross = serialWeights[idx] ? parseFloat(serialWeights[idx]) : undefined
                  const tare = serialTareWeights[idx] ? parseFloat(serialTareWeights[idx]) : undefined
                  const net = item.tare_tracking_enabled && gross != null && tare != null
                    ? (gross - tare).toFixed(3)
                    : null
                  return (
                    <div key={idx} className="border border-gray-100 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2">
                        <input
                          className="input flex-1 font-mono text-sm"
                          value={sn}
                          placeholder={`Serial ${idx + 1}`}
                          onChange={e => {
                            const v = [...serials]; v[idx] = e.target.value; setSerials(v)
                          }}
                        />
                        {serials.length > 1 && (
                          <button type="button" onClick={() => setSerials(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-lg">✕</button>
                        )}
                      </div>
                      {/* Variant selection — only shown when item has variants */}
                      {(item.variants?.length ?? 0) > 0 && (
                        <div>
                          <label className="text-xs text-gray-500">Variant</label>
                          <select
                            className="input mt-0.5 w-full text-sm"
                            value={serialVariantIds[idx] ?? ''}
                            onChange={e => setSerialVariantIds(p => ({ ...p, [idx]: e.target.value }))}
                          >
                            <option value="">— No variant —</option>
                            {(item.variants ?? []).filter(v => v.status === 'active').map(v => (
                              <option key={v.id} value={v.id}>{v.name}{v.sku ? ` (${v.sku})` : ''}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {item.weight_tracking_enabled && showWeightFields && (
                        <div className="flex gap-2 items-end">
                          {item.tare_tracking_enabled ? (
                            <>
                              <div className="flex-1">
                                <label className="text-xs text-gray-500">Gross ({item.unit_of_measure})</label>
                                <input type="number" step="0.001" className="input mt-0.5 w-full text-sm" placeholder="0.000"
                                  value={serialWeights[idx] ?? ''}
                                  onChange={e => setSerialWeights(p => ({ ...p, [idx]: e.target.value }))} />
                              </div>
                              <div className="flex-1">
                                <label className="text-xs text-gray-500">Tare ({item.unit_of_measure})</label>
                                <input type="number" step="0.001" className="input mt-0.5 w-full text-sm" placeholder="0.000"
                                  value={serialTareWeights[idx] ?? ''}
                                  onChange={e => setSerialTareWeights(p => ({ ...p, [idx]: e.target.value }))} />
                              </div>
                              {net !== null && (
                                <div className="flex-shrink-0 text-right">
                                  <p className="text-xs text-gray-500">Net</p>
                                  <p className="text-sm font-bold text-green-700">{net} {item.unit_of_measure}</p>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="flex-1">
                              <label className="text-xs text-gray-500">Net qty ({item.unit_of_measure})</label>
                              <input type="number" step="0.001" className="input mt-0.5 w-full text-sm" placeholder="e.g. 199.500"
                                value={serialWeights[idx] ?? ''}
                                onChange={e => setSerialWeights(p => ({ ...p, [idx]: e.target.value }))} />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Per-serial pricing */}
                      {(() => {
                        const pc = serialPurchaseCosts[idx] ? parseFloat(serialPurchaseCosts[idx]) : undefined
                        const sp = serialSellingPrices[idx] ? parseFloat(serialSellingPrices[idx]) : undefined
                        const margin = pc && sp && pc > 0 ? ((sp - pc) / pc * 100) : null
                        return (
                          <div className="flex gap-2 items-end pt-1 border-t border-gray-50 mt-1">
                            <div className="flex-1">
                              <label className="text-xs text-gray-500">Purchase Cost (KES)</label>
                              <input type="number" step="0.01" min="0" className="input mt-0.5 w-full text-sm" placeholder={item.purchase_cost ? String(item.purchase_cost) : '0.00'}
                                value={serialPurchaseCosts[idx] ?? ''}
                                onChange={e => setSerialPurchaseCosts(p => ({ ...p, [idx]: e.target.value }))} />
                            </div>
                            <div className="flex-1">
                              <label className="text-xs text-gray-500">Selling Price (KES)</label>
                              <input type="number" step="0.01" min="0" className="input mt-0.5 w-full text-sm" placeholder={item.selling_price ? String(item.selling_price) : '0.00'}
                                value={serialSellingPrices[idx] ?? ''}
                                onChange={e => setSerialSellingPrices(p => ({ ...p, [idx]: e.target.value }))} />
                            </div>
                            <div className="flex-shrink-0 text-right min-w-[52px]">
                              <p className="text-xs text-gray-500">Margin</p>
                              {margin !== null ? (
                                <p className={`text-sm font-bold ${margin >= 0 ? 'text-green-700' : 'text-red-600'}`}>{margin.toFixed(1)}%</p>
                              ) : (
                                <p className="text-sm text-gray-300">—</p>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
              <button type="button" onClick={() => setSerials(prev => [...prev, ''])} className="mt-2 text-xs text-blue-600 hover:underline">+ Add serial</button>
            </div>
          )}

          {item.is_serialized && mode === 'out' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">Select serials to dispatch</label>
                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{Object.keys(outSerials).length} selected</span>
              </div>
              {dispatchableSerials.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No in-stock serials</p>
              ) : (
                <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                  {dispatchableSerials.map(s => {
                    const isMerged = s.status === 'merged'
                    const isSplit = s.status === 'split'
                    const isDisabled = isMerged || isSplit
                    const selected = !isDisabled && s.serial_number in outSerials
                    const os = outSerials[s.serial_number]
                    const pct = selected ? varPct(s.serial_number, os?.dispatchWt ?? '') : null
                    const isSoft = pct !== null && pct > item.weight_variance_soft_pct
                    const isHard = pct !== null && pct > item.weight_variance_hard_pct
                    return (
                      <div
                        key={s.id}
                        className={`border rounded-xl p-3 transition-colors ${isDisabled ? 'opacity-40 cursor-not-allowed bg-gray-50 border-gray-100' : selected ? 'border-red-300 bg-red-50' : 'border-gray-100'}`}
                        title={isMerged ? 'Cannot dispatch — serial has been merged' : isSplit ? 'Cannot dispatch — serial has been split into sub-serials' : undefined}
                      >
                        <div className="flex items-center gap-3">
                          <input type="checkbox" className="rounded" checked={selected} disabled={isDisabled} onChange={() => !isDisabled && toggleOutSerial(s.serial_number, s)} />
                          <span className="font-mono text-sm text-gray-800 flex-1">{s.serial_number}</span>
                          {isDisabled ? (
                            <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 capitalize">{s.status}</span>
                          ) : item.weight_tracking_enabled && s.quantity_remaining != null ? (
                            <span className="text-xs text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">{s.quantity_remaining.toFixed(dp)} {item.unit_of_measure} rem.</span>
                          ) : (
                            <span className="text-xs text-green-700 bg-green-50 rounded-full px-2 py-0.5">In stock</span>
                          )}
                        </div>
                        {selected && (
                          <div className="mt-2 space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-xs text-gray-500">
                                  Qty dispatched ({item.unit_of_measure})
                                </label>
                                <input type="number" step="0.001" min="0.001" className="input mt-0.5 w-full text-sm"
                                  value={os.qty}
                                  onChange={e => setOutSerials(p => ({ ...p, [s.serial_number]: { ...p[s.serial_number], qty: e.target.value } }))}
                                />
                                {item.weight_tracking_enabled && showWeightFields && (
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    How much you're taking (full or partial)
                                  </p>
                                )}
                              </div>
                              {item.weight_tracking_enabled && showWeightFields && (
                                <div className="flex-1">
                                  <label className="text-xs text-gray-500">Weigh at gate ({item.unit_of_measure})</label>
                                  <input type="number" step="0.001" min="0.001" className={`input mt-0.5 w-full text-sm ${isHard ? 'border-red-400' : isSoft ? 'border-amber-400' : ''}`}
                                    placeholder="Scale reading"
                                    value={os.dispatchWt}
                                    onChange={e => setOutSerials(p => ({ ...p, [s.serial_number]: { ...p[s.serial_number], dispatchWt: e.target.value } }))}
                                  />
                                  <p className="text-[10px] text-gray-400 mt-0.5">Actual measured — for audit</p>
                                </div>
                              )}
                              {item.weight_tracking_enabled && !showWeightFields && (
                                <p className="text-[10px] text-amber-600 mt-0.5 self-end">Weight input hidden — flags maintained.</p>
                              )}
                            </div>
                            {pct !== null && (
                              <div className={`rounded-lg px-3 py-2 ${isHard ? 'bg-red-50 border border-red-200' : isSoft ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                                <p className={`text-xs font-semibold ${isHard ? 'text-red-700' : isSoft ? 'text-amber-700' : 'text-green-700'}`}>
                                  {isHard ? '🚨' : isSoft ? '⚠' : '✓'} Variance {pct.toFixed(2)}%
                                  {isHard && ` — exceeds hard limit (${item.weight_variance_hard_pct}%). Serial will be flagged for audit.`}
                                  {isSoft && !isHard && ` — exceeds soft threshold (${item.weight_variance_soft_pct}%). Will be soft-flagged.`}
                                  {!isSoft && ' — within tolerance'}
                                </p>
                              </div>
                            )}
                            {isHard && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="rounded" checked={os.forceOverride}
                                  onChange={e => setOutSerials(p => ({ ...p, [s.serial_number]: { ...p[s.serial_number], forceOverride: e.target.checked } }))} />
                                <span className="text-xs text-red-700 font-medium">Force override — dispatch despite variance</span>
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {Object.keys(outSerials).length > 0 && (
                <p className="text-xs text-gray-500 mt-2 text-right font-medium">
                  Total: {Object.values(outSerials).reduce((s, o) => s + (parseFloat(o.qty) || 0), 0).toFixed(3)} units
                </p>
              )}
            </div>
          )}

          {/* Non-serialized quantity */}
          {(!item.is_serialized || mode === 'adjust') && (
            <>
              {mode === 'out' && (
                <p className="text-xs text-gray-500">Available at selected location: <strong>{availableAtLocation} {item.unit_of_measure}</strong></p>
              )}
              <div>
                <label className="text-xs font-medium text-gray-700">
                  {mode === 'adjust' ? 'New Quantity (absolute)' : 'Quantity'} ({item.unit_of_measure})
                </label>
                <input type="number" className="input mt-1 w-full text-lg font-semibold" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" min={0} step="any" required />
              </div>

              {/* Bulk weight tracking inputs */}
              {item.weight_tracking_enabled && mode === 'in' && showWeightFields && (
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-orange-800">Weight &amp; Fraud Detection</p>
                  <div>
                    <label className="text-xs text-gray-600">
                      {item.tare_tracking_enabled ? 'Net qty recorded at weigh-in' : 'Actual qty / weight measured'} ({item.unit_of_measure})
                    </label>
                    <input type="number" step="0.001" className="input mt-1 w-full"
                      placeholder="e.g. 49.750"
                      value={bulkNetQty}
                      onChange={e => setBulkNetQty(e.target.value)} />
                  </div>
                </div>
              )}

              {item.weight_tracking_enabled && mode === 'out' && !item.is_serialized && (() => {
                const bvp = bulkVarPct(quantity, bulkDispatchQty)
                const isSoft = bvp !== null && bvp > item.weight_variance_soft_pct
                const isHard = bvp !== null && bvp > item.weight_variance_hard_pct
                const expected = item.weight_per_unit && parseFloat(quantity) > 0
                  ? (parseFloat(quantity) * item.weight_per_unit).toFixed(dp) : null
                return (
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-orange-800">Weight &amp; Fraud Detection</p>
                    {expected && <p className="text-xs text-gray-500">Expected: <strong>{expected} {item.unit_of_measure}</strong> ({item.weight_per_unit} × {quantity} units)</p>}
                    {showWeightFields && (
                      <div>
                        <label className="text-xs text-gray-600">Measured qty at dispatch ({item.unit_of_measure})</label>
                        <input type="number" step="0.001" className="input mt-1 w-full" placeholder="Weigh now"
                          value={bulkDispatchQty}
                          onChange={e => { setBulkDispatchQty(e.target.value); setBulkForceOverride(false) }} />
                      </div>
                    )}
                    {!showWeightFields && <p className="text-xs text-amber-700 italic">Weight input hidden by inventory config — flags still recorded.</p>}
                    {bvp !== null && (
                      <p className={`text-xs font-semibold ${isHard ? 'text-red-600' : isSoft ? 'text-amber-600' : 'text-green-700'}`}>
                        Variance: {bvp.toFixed(2)}%
                        {isSoft && !isHard && ' ⚠ soft flag'}
                        {isHard && ' ✕ exceeds hard limit'}
                      </p>
                    )}
                    {isHard && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rounded" checked={bulkForceOverride} onChange={e => setBulkForceOverride(e.target.checked)} />
                        <span className="text-xs text-red-700 font-medium">Force override — dispatch despite variance</span>
                      </label>
                    )}
                  </div>
                )
              })()}
            </>
          )}

          {mode !== 'adjust' && (
            <div>
              <label className="text-xs font-medium text-gray-700">Reference No.</label>
              <input className="input mt-1 w-full" value={reference} onChange={e => setReference(e.target.value)} placeholder="PO / Work Order / Invoice" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Notes</label>
            <input className="input mt-1 w-full" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {/* Convert to Asset — stock-out only */}
          {mode === 'out' && (
            <div className={`rounded-xl border ${convertToAsset ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'} p-3 space-y-3`}>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-blue-600"
                  checked={convertToAsset}
                  onChange={e => setConvertToAsset(e.target.checked)}
                />
                <span className="text-sm font-medium text-gray-800">Convert dispatched item(s) to Asset</span>
              </label>
              {convertToAsset && (
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Assign to Unit</label>
                  <select
                    className="input w-full text-sm"
                    value={outUnitId}
                    onChange={e => setOutUnitId(e.target.value)}
                  >
                    <option value="">— Select unit (optional) —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.unit_code}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    {item.is_serialized
                      ? 'One asset record will be created per dispatched serial number.'
                      : 'One asset record will be created for this dispatch.'}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className={`flex-1 px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50 ${btnColors[mode]}`}>
              {saving ? 'Saving…' : convertToAsset && mode === 'out' ? `${titles[mode]} & Create Asset` : titles[mode]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Create Shipment Modal ─────────────────────────────────────────────────────

interface CreateShipmentModalProps {
  item: InventoryItem
  prefilledSerials?: string[]
  onClose: () => void
  onCreated: (shipment: StockShipment) => void
}

function CreateShipmentModal({ item, prefilledSerials, onClose, onCreated }: CreateShipmentModalProps) {
  const [form, setForm] = useState({
    driver_name: '',
    driver_phone: '',
    driver_email: '',
    vehicle_number: '',
    tracking_number: '',
    destination: '',
    receiver_name: '',
    receiver_phone: '',
    receiver_email: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<StockShipment | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.driver_name.trim() || !form.destination.trim()) {
      setError('Driver name and destination are required')
      return
    }
    setSaving(true); setError(null)
    try {
      const itemPayload: ShipmentItemPayload = {
        item_id: item.id,
        item_name: item.name,
        quantity: prefilledSerials ? prefilledSerials.length : 1,
        unit_of_measure: item.unit_of_measure,
        serial_numbers: prefilledSerials,
        weight_per_unit: item.weight_per_unit,
      }
      const payload: ShipmentCreatePayload = {
        movement_type: 'stock_out',
        items: [itemPayload],
        driver_name: form.driver_name,
        driver_phone: form.driver_phone || undefined,
        driver_email: form.driver_email || undefined,
        vehicle_number: form.vehicle_number || undefined,
        tracking_number: form.tracking_number || undefined,
        destination: form.destination,
        receiver_name: form.receiver_name || undefined,
        receiver_phone: form.receiver_phone || undefined,
        receiver_email: form.receiver_email || undefined,
        notes: form.notes || undefined,
      }
      const result = await inventoryApi.createShipment(payload)
      setCreated(result)
      onCreated(result)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    if (created?.driver_sign_url) {
      navigator.clipboard.writeText(created.driver_sign_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">📦</div>
            <h2 className="text-lg font-bold text-gray-900">Shipment Created</h2>
            <p className="text-sm text-gray-500 mt-1">{created.reference_number}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-medium text-blue-800 mb-2">Driver Sign Link</p>
            <p className="text-xs font-mono text-blue-700 break-all">{created.driver_sign_url}</p>
            <button onClick={copyLink} className={`mt-2 text-xs px-3 py-1 rounded-lg font-semibold transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
              {copied ? '✓ Copied' : 'Copy Link'}
            </button>
          </div>
          {form.driver_email && (
            <p className="text-xs text-center text-gray-500 mb-4">An email was sent to {form.driver_email}</p>
          )}
          <button onClick={onClose} className="w-full px-4 py-2 text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-xl">Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Create Shipment</h2>
            <p className="text-xs text-gray-500 mt-0.5">{item.name}{prefilledSerials?.length ? ` · ${prefilledSerials.length} serial(s)` : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {prefilledSerials && prefilledSerials.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-600 mb-1">Dispatching serials:</p>
              <div className="flex flex-wrap gap-1">
                {prefilledSerials.map(s => (
                  <span key={s} className="font-mono text-xs bg-white border border-gray-200 rounded px-2 py-0.5">{s}</span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Driver Name *</label>
              <input className="input mt-1 w-full" value={form.driver_name} onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))} placeholder="e.g. John Kamau" required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Driver Phone</label>
              <input className="input mt-1 w-full" value={form.driver_phone} onChange={e => setForm(f => ({ ...f, driver_phone: e.target.value }))} placeholder="+254 700 000 000" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Driver Email</label>
              <input type="email" className="input mt-1 w-full" value={form.driver_email} onChange={e => setForm(f => ({ ...f, driver_email: e.target.value }))} placeholder="driver@example.com" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Vehicle Number</label>
              <input className="input mt-1 w-full" value={form.vehicle_number} onChange={e => setForm(f => ({ ...f, vehicle_number: e.target.value }))} placeholder="KAA 123B" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Tracking Number</label>
              <input className="input mt-1 w-full" value={form.tracking_number} onChange={e => setForm(f => ({ ...f, tracking_number: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Destination *</label>
              <input className="input mt-1 w-full" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Westlands, Nairobi" required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Receiver Name</label>
              <input className="input mt-1 w-full" value={form.receiver_name} onChange={e => setForm(f => ({ ...f, receiver_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Receiver Phone</label>
              <input className="input mt-1 w-full" value={form.receiver_phone} onChange={e => setForm(f => ({ ...f, receiver_phone: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Receiver Email (for delivery confirmation)</label>
              <input type="email" className="input mt-1 w-full" value={form.receiver_email} onChange={e => setForm(f => ({ ...f, receiver_email: e.target.value }))} placeholder="receiver@example.com" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Notes</label>
              <textarea className="input mt-1 w-full" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
              {saving ? 'Creating…' : 'Create Shipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Variants Tab ──────────────────────────────────────────────────────────────

function VariantsTab({ item, onUpdated }: { item: InventoryItem; onUpdated: (v: InventoryItem) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<InventoryVariantPayload>({ name: '', sku: '', purchase_cost: undefined, selling_price: undefined, attributes: {} })
  const [attrRows, setAttrRows] = useState<{ k: string; v: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  function openAdd() {
    setEditingId(null)
    setForm({ name: '', sku: '', purchase_cost: undefined, selling_price: undefined, attributes: {} })
    setAttrRows([])
    setError(null)
    setShowForm(true)
  }

  function openEdit(v: InventoryVariant) {
    setEditingId(v.id)
    setForm({ name: v.name, sku: v.sku, purchase_cost: v.purchase_cost, selling_price: v.selling_price, attributes: { ...v.attributes } })
    setAttrRows(Object.entries(v.attributes).map(([k, val]) => ({ k, v: val })))
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const attrs: Record<string, string> = {}
      attrRows.forEach(r => { if (r.k.trim()) attrs[r.k.trim()] = r.v })
      const payload = { ...form, attributes: attrs }
      let updated: InventoryItem
      if (editingId) {
        updated = await inventoryApi.updateVariant(item.id, editingId, payload)
      } else {
        updated = await inventoryApi.createVariant(item.id, payload)
      }
      onUpdated(updated)
      setShowForm(false)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(variantId: string) {
    if (!confirm('Delete this variant?')) return
    try {
      const updated = await inventoryApi.deleteVariant(item.id, variantId)
      onUpdated(updated)
    } catch (err) {
      alert(extractApiError(err).message)
    }
  }

  async function handleImageUpload(variantId: string, file: File) {
    setUploadingId(variantId)
    try {
      const updated = await inventoryApi.uploadVariantImage(item.id, variantId, file)
      onUpdated(updated)
    } catch (err) {
      alert(extractApiError(err).message)
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Variants ({(item.variants ?? []).length})</p>
        <button onClick={openAdd} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Add Variant</button>
      </div>

      {showForm && (
        <div className="border border-blue-100 rounded-xl bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900">{editingId ? 'Edit Variant' : 'New Variant'}</p>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-700">Name *</label>
              <input className="input mt-1 w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Red - Size M" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">SKU</label>
              <input className="input mt-1 w-full" value={form.sku ?? ''} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Purchase Cost</label>
              <input type="number" step="0.01" className="input mt-1 w-full" value={form.purchase_cost ?? ''} onChange={e => setForm(f => ({ ...f, purchase_cost: e.target.value ? parseFloat(e.target.value) : undefined }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Selling Price</label>
              <input type="number" step="0.01" className="input mt-1 w-full" value={form.selling_price ?? ''} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value ? parseFloat(e.target.value) : undefined }))} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Attributes</label>
            <div className="space-y-1 mt-1">
              {attrRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input flex-1 text-xs" value={row.k} onChange={e => setAttrRows(prev => prev.map((r, j) => j === i ? { ...r, k: e.target.value } : r))} placeholder="Key (e.g. Color)" />
                  <input className="input flex-1 text-xs" value={row.v} onChange={e => setAttrRows(prev => prev.map((r, j) => j === i ? { ...r, v: e.target.value } : r))} placeholder="Value (e.g. Red)" />
                  <button type="button" onClick={() => setAttrRows(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setAttrRows(prev => [...prev, { k: '', v: '' }])} className="text-xs text-blue-600 hover:text-blue-800">+ Add attribute</button>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {(item.variants ?? []).length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-6">No variants yet. Add one to track product variations.</p>
      )}

      <div className="space-y-3">
        {(item.variants ?? []).map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              {v.image_url ? (
                <img src={v.image_url} alt={v.name} className="w-12 h-12 rounded-lg object-cover border border-gray-100 flex-shrink-0" />
              ) : (
                <label className={`w-12 h-12 rounded-lg border border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50 flex-shrink-0 ${uploadingId === v.id ? 'opacity-50' : ''}`}>
                  <span className="text-xs text-gray-400">{uploadingId === v.id ? '…' : '📷'}</span>
                  <input type="file" accept="image/*" className="hidden" disabled={!!uploadingId} onChange={e => { if (e.target.files?.[0]) handleImageUpload(v.id, e.target.files[0]) }} />
                </label>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 truncate">{v.name}</p>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(v)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                    <button onClick={() => handleDelete(v.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                  </div>
                </div>
                {v.sku && <p className="text-xs text-gray-400 font-mono mt-0.5">{v.sku}</p>}
                <div className="flex gap-3 mt-1">
                  {v.purchase_cost != null && <span className="text-xs text-gray-600">Cost: {fmtCurrency(v.purchase_cost)}</span>}
                  {v.selling_price != null && <span className="text-xs text-gray-600">Price: {fmtCurrency(v.selling_price)}</span>}
                </div>
                {Object.entries(v.attributes).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(v.attributes).map(([k, val]) => (
                      <span key={k} className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{k}: {val}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Inventory Detail Slide-Over ───────────────────────────────────────────────

interface ItemDetailProps {
  item: InventoryItem
  propertyId: string
  onClose: () => void
  onUpdate: (updated: InventoryItem) => void
  inventoryConfig?: InventoryConfig
  storeAppInstalled?: boolean
}

function InventoryDetailSlideOver({ item, propertyId, onClose, onUpdate, inventoryConfig, storeAppInstalled }: ItemDetailProps) {
  const [tab, setTab] = useState<'details' | 'stock' | 'movements' | 'shipments' | 'variants' | 'audit'>('details')
  const [movementMode, setMovementMode] = useState<MovementMode | null>(null)
  const [lastMovedSerials, setLastMovedSerials] = useState<string[] | undefined>()
  const [showShipment, setShowShipment] = useState(false)
  const [shipments, setShipments] = useState<StockShipment[]>([])
  const [shipmentsLoading, setShipmentsLoading] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<{ item: InventoryItem; serial: StockSerial } | null>(null)
  const [splitSource, setSplitSource] = useState<{ item: InventoryItem; serial: StockSerial } | null>(null)
  const [units, setUnits] = useState<Unit[]>([])

  useEffect(() => {
    unitsApi.list(propertyId, { page_size: 200 }).then(data => {
      setUnits(Array.isArray(data) ? data : (data as any).items ?? [])
    }).catch(() => {})
  }, [propertyId])

  async function loadShipments() {
    setShipmentsLoading(true)
    try {
      const r = await inventoryApi.listShipments()
      setShipments(r.items)
    } catch {
      // ignore
    } finally {
      setShipmentsLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'shipments') loadShipments()
  }, [tab])

  function handleUpdated(updated: InventoryItem, movedSerials?: string[]) {
    onUpdate(updated)
    setMovementMode(null)
    if (movedSerials && movedSerials.length > 0) {
      setLastMovedSerials(movedSerials)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-gray-400">{item.item_id}</span>
                <Badge label={item.status} colorClass={STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-600'} />
                {item.is_serialized && <Badge label="Serialized" colorClass="bg-indigo-100 text-indigo-800" />}
                {item.is_low_stock && <Badge label="Low Stock" colorClass="bg-orange-100 text-orange-800" />}
                {item.has_expired_batches && <Badge label="Expired Batches" colorClass="bg-red-100 text-red-700" />}
                {item.hazard_classes.map(h => (
                  <Badge key={h} label={h} colorClass={HAZARD_COLORS[h] ?? 'bg-gray-100 text-gray-600'} />
                ))}
              </div>
              <h2 className="text-base font-bold text-gray-900">{item.name}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{item.category}{item.subcategory ? ` › ${item.subcategory}` : ''}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4 flex-shrink-0">✕</button>
          </div>

          {/* Quick stock summary */}
          <div className="flex gap-6 mt-3">
            <div>
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-lg font-bold text-gray-900">
                {item.total_quantity} <span className="text-xs font-normal text-gray-400">{item.unit_of_measure}</span>
                {item.is_serialized && item.weight_tracking_enabled && item.total_serial_count > 0 && (
                  <span className="text-xs font-normal text-gray-400 ml-1">· {item.total_serial_count} serial{item.total_serial_count !== 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Available</p>
              <p className={`text-lg font-bold ${item.is_low_stock ? 'text-orange-600' : 'text-green-700'}`}>{item.total_available} <span className="text-xs font-normal text-gray-400">{item.unit_of_measure}</span></p>
            </div>
            {!item.is_serialized && (
              <div>
                <p className="text-xs text-gray-500">Reserved</p>
                <p className="text-lg font-bold text-blue-700">{item.total_reserved} <span className="text-xs font-normal text-gray-400">{item.unit_of_measure}</span></p>
              </div>
            )}
            {item.is_serialized && (
              <div>
                <p className="text-xs text-gray-500">In Stock</p>
                <p className="text-lg font-bold text-indigo-700">{item.total_serial_count} <span className="text-xs font-normal text-gray-400">serial{item.total_serial_count !== 1 ? 's' : ''}</span></p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-3 flex-wrap">
            <button onClick={() => setMovementMode('in')} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700">+ Stock In</button>
            <button onClick={() => setMovementMode('out')} className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700">- Stock Out</button>
            <button onClick={() => setMovementMode('adjust')} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Adjust</button>
            {lastMovedSerials && (
              <button onClick={() => setShowShipment(true)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                🚚 Create Shipment
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 overflow-x-auto">
          {(['details', 'stock', 'movements', 'shipments', 'variants', 'audit'] as const).map((t) => {
            if (t === 'variants' && (item.variants?.length ?? 0) === 0) return null
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'variants' && (item.variants?.length ?? 0) > 0 && (
                  <span className="ml-1 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{(item.variants ?? []).length}</span>
                )}
                {t === 'audit' && (item.audit_trail?.length ?? 0) > 0 && (
                  <span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">{item.audit_trail.length}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'details' && (
            <div className="grid grid-cols-2 gap-4">
              <Info label="SKU" value={item.sku} />
              <Info label="Barcode" value={item.barcode} />
              <Info label="Unit of Measure" value={item.unit_of_measure} />
              <Info label="Units per Package" value={String(item.units_per_package)} />
              <Info label="Purchase Cost" value={fmtCurrency(item.purchase_cost)} />
              <Info label="Selling Price" value={fmtCurrency(item.selling_price)} />
              <Info label="Markup" value={item.markup_percent ? `${item.markup_percent}%` : undefined} />
              <Info label="Vendor" value={item.vendor_name} />
              <Info label="Manufacturer" value={item.manufacturer} />
              <Info label="Weight/Unit (kg)" value={item.weight_per_unit ? `${item.weight_per_unit} kg` : undefined} />
              <Info label="Serialized" value={item.is_serialized ? 'Yes' : 'No'} />
              <Info label="Min Stock Level" value={`${item.min_stock_level} ${item.unit_of_measure}`} />
              <Info label="Reorder Point" value={`${item.reorder_point} ${item.unit_of_measure}`} />
              <Info label="Reorder Quantity" value={`${item.reorder_quantity} ${item.unit_of_measure}`} />
              <Info label="Storage Location" value={item.store_location_path || item.storage_location} />
              <Info label="Batch Tracking" value={item.batch_tracking_enabled ? 'Yes' : 'No'} />
              {item.notes && (
                <div className="col-span-2 bg-gray-50 rounded-lg p-3 text-sm text-gray-700">{item.notes}</div>
              )}
            </div>
          )}

          {tab === 'stock' && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock by Location</p>
              {item.stock_levels.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No stock recorded yet. Use Stock In to add.</p>
              )}
              {item.stock_levels.map((sl) => (
                <div key={sl.location_key} className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-gray-900">{sl.location_label}</p>
                  <div className="flex gap-6 mt-2">
                    <div><p className="text-xs text-gray-500">Quantity</p><p className="text-base font-bold text-gray-900">{sl.quantity}</p></div>
                    <div><p className="text-xs text-gray-500">Reserved</p><p className="text-base font-bold text-blue-700">{sl.reserved_quantity}</p></div>
                    <div><p className="text-xs text-gray-500">Available</p><p className={`text-base font-bold ${sl.available_quantity <= item.reorder_point ? 'text-orange-600' : 'text-green-700'}`}>{sl.available_quantity}</p></div>
                  </div>
                </div>
              ))}

              {item.is_serialized && (item.serials ?? []).length > 0 && (
                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4">Serial Numbers</p>
                  <div className="space-y-1">
                    {(item.serials ?? []).filter(s => !s.parent_serial_id).map(s => {
                      const children = (item.serials ?? []).filter(c => c.parent_serial_id === s.serial_number)
                      const hasProg = item.weight_tracking_enabled && s.net_weight_kg != null && s.quantity_remaining != null
                      const progPct = hasProg
                        ? Math.max(0, Math.min(100, (s.quantity_remaining! / s.net_weight_kg!) * 100))
                        : null
                      // Use serial's own purchase_cost if recorded at stock-in, else fall back to item level
                      const effectiveCost = s.purchase_cost ?? item.purchase_cost
                      const serialValue = item.weight_tracking_enabled && s.quantity_remaining != null && effectiveCost != null
                        ? s.quantity_remaining * effectiveCost
                        : (!item.weight_tracking_enabled && effectiveCost != null)
                          ? effectiveCost  // non-weight: value = cost per unit
                          : null
                      const canMergeSplit = s.status === 'in_stock' && item.weight_tracking_enabled
                      return (
                        <div key={s.id}>
                          <div className="py-2 px-3 bg-white border border-gray-100 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm text-gray-800">{s.serial_number}</span>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                {item.weight_tracking_enabled && s.net_weight_kg != null && (
                                  <span className="text-xs text-gray-500">Net {s.net_weight_kg.toFixed(3)} {item.unit_of_measure}</span>
                                )}
                                {item.weight_tracking_enabled && s.quantity_remaining != null && (
                                  <span className="text-xs font-semibold text-blue-700">{s.quantity_remaining.toFixed(3)} rem.</span>
                                )}
                                {item.weight_tracking_enabled && s.weight_variance_pct != null && (
                                  <span className={`text-xs font-semibold ${s.weight_variance_pct > item.weight_variance_hard_pct ? 'text-red-600' : s.weight_variance_pct > item.weight_variance_soft_pct ? 'text-amber-600' : 'text-gray-400'}`}>
                                    {s.weight_variance_pct.toFixed(1)}% var.
                                  </span>
                                )}
                                {item.weight_tracking_enabled && s.weight_flagged && (
                                  <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium" title={s.weight_flag_reason ?? ''}>⚠ Flagged</span>
                                )}
                                {s.purchase_cost != null && (
                                  <span className="text-xs text-gray-500" title="Purchase cost at stock-in">Cost {fmtCurrency(s.purchase_cost)}</span>
                                )}
                                {s.selling_price != null && (
                                  <span className="text-xs text-emerald-700" title="Selling price at stock-in">Sell {fmtCurrency(s.selling_price)}</span>
                                )}
                                {s.margin_pct != null && (
                                  <span className={`text-xs font-semibold ${s.margin_pct >= 0 ? 'text-emerald-700' : 'text-red-600'}`} title="Margin %">{s.margin_pct.toFixed(1)}% margin</span>
                                )}
                                {serialValue != null && s.purchase_cost == null && (
                                  <span className="text-xs text-gray-500">{fmtCurrency(serialValue)}</span>
                                )}
                                {s.variant_id && (() => {
                                  const v = item.variants?.find(vv => vv.id === s.variant_id)
                                  return v ? <span className="text-xs bg-purple-100 text-purple-800 rounded-full px-2 py-0.5">{v.name}</span> : null
                                })()}
                                {s.store_location_path && (
                                  <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5" title={s.store_location_path}>
                                    📦 {s.store_location_path.split(' / ').pop()}
                                  </span>
                                )}
                                <Badge
                                  label={s.status}
                                  colorClass={
                                    s.status === 'in_stock' ? 'bg-green-100 text-green-800' :
                                    s.status === 'dispatched' ? 'bg-blue-100 text-blue-700' :
                                    s.status === 'returned' ? 'bg-yellow-100 text-yellow-800' :
                                    s.status === 'depleted' ? 'bg-gray-100 text-gray-500' :
                                    s.status === 'merged' ? 'bg-purple-100 text-purple-700' :
                                    s.status === 'split' ? 'bg-orange-100 text-orange-700' :
                                    'bg-red-100 text-red-700'
                                  }
                                />
                                {canMergeSplit && (
                                  <>
                                    <button
                                      onClick={() => setMergeTarget({ item, serial: s })}
                                      className="text-xs px-1.5 py-0.5 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 font-medium"
                                      title="Merge into this serial"
                                    >↗ Merge</button>
                                    <button
                                      onClick={() => setSplitSource({ item, serial: s })}
                                      className="text-xs px-1.5 py-0.5 rounded border border-orange-200 text-orange-700 hover:bg-orange-50 font-medium"
                                      title="Split this serial"
                                    >✂ Split</button>
                                  </>
                                )}
                              </div>
                            </div>
                            {progPct !== null && (
                              <div className="mt-1.5">
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progPct}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Child serials (partial dispatches) */}
                          {children.length > 0 && (
                            <div className="ml-6 mt-0.5 space-y-0.5">
                              {children.map(c => (
                                <div key={c.id} className="py-1.5 px-3 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-between">
                                  <span className="font-mono text-xs text-gray-500">{c.serial_number}</span>
                                  <div className="flex items-center gap-1.5">
                                    {item.weight_tracking_enabled && c.net_weight_kg != null && (
                                      <span className="text-xs text-gray-400">{c.net_weight_kg.toFixed(3)} {item.unit_of_measure}</span>
                                    )}
                                    <Badge
                                      label={c.status}
                                      colorClass={
                                        c.status === 'dispatched' ? 'bg-blue-100 text-blue-700' :
                                        c.status === 'returned' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-500'
                                      }
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {item.batches.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4">Batches / Lots</p>
                  {item.batches.filter(b => b.quantity_remaining > 0).map((b) => (
                    <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Batch {b.batch_number}</p>
                          {b.lot_number && <p className="text-xs text-gray-500">Lot: {b.lot_number}</p>}
                        </div>
                        {b.expiry_date && (
                          <Badge
                            label={new Date(b.expiry_date) < new Date() ? 'Expired' : `Expires ${fmtDate(b.expiry_date)}`}
                            colorClass={new Date(b.expiry_date) < new Date() ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}
                          />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Remaining: <strong>{b.quantity_remaining}</strong> of {b.quantity_received} received</p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {tab === 'movements' && (
            <>
              {item.movements.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No movements recorded yet</p>
              )}
              {item.movements.map((m) => {
                const isIn = ['stock_in', 'transfer_in', 'return'].includes(m.movement_type)
                const isOut = ['stock_out', 'transfer_out', 'issue', 'damaged', 'lost', 'expired', 'write_off'].includes(m.movement_type)
                return (
                  <div key={m.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                    <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isIn ? 'bg-green-100 text-green-700' : isOut ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {isIn ? '+' : isOut ? '−' : '≈'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-medium text-gray-900 capitalize">{m.movement_type.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-gray-400 ml-2 flex-shrink-0">{fmtDate(m.created_at)}</p>
                      </div>
                      <p className={`text-sm font-bold ${isIn ? 'text-green-700' : isOut ? 'text-red-600' : 'text-blue-600'}`}>
                        {isIn ? '+' : isOut ? '−' : ''}{m.quantity} {m.unit_of_measure}
                      </p>
                      <div className="flex gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                        {m.from_location_label && <span>From: {m.from_location_label}</span>}
                        {m.to_location_label && <span>To: {m.to_location_label}</span>}
                        {m.store_location_path && <span className="text-blue-600">📦 {m.store_location_path}</span>}
                        {m.reference_no && <span>Ref: {m.reference_no}</span>}
                        {m.performed_by_name && <span>By: {m.performed_by_name}</span>}
                      </div>
                      {m.serial_count > 0 && (
                        <p className="text-xs text-indigo-600 mt-0.5 font-medium">
                          {m.serial_count} serial{m.serial_count !== 1 ? 's' : ''}
                          {m.quantity > 0 && ` · ${m.quantity} ${m.unit_of_measure}`}
                        </p>
                      )}
                      {m.serial_numbers && m.serial_numbers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.serial_numbers.map(s => (
                            <span key={s} className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{s}</span>
                          ))}
                        </div>
                      )}
                      {m.movement_net_qty != null && (
                        <p className="text-xs text-gray-500 mt-0.5">Recorded: <strong>{m.movement_net_qty} {m.unit_of_measure}</strong></p>
                      )}
                      {m.movement_dispatch_qty != null && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-gray-500">Dispatched: <strong>{m.movement_dispatch_qty} {m.unit_of_measure}</strong></p>
                          {m.movement_variance_pct != null && (
                            <span className={`text-xs font-semibold ${m.movement_weight_flagged ? 'text-amber-600' : 'text-gray-400'}`}>
                              {m.movement_variance_pct.toFixed(1)}% var.{m.movement_weight_flagged ? ' ⚠' : ''}
                            </span>
                          )}
                        </div>
                      )}
                      {m.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{m.notes}</p>}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {tab === 'shipments' && (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Shipments</p>
                <button onClick={() => setShowShipment(true)} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Shipment</button>
              </div>
              {shipmentsLoading && <p className="text-center py-8 text-sm text-gray-400">Loading…</p>}
              {!shipmentsLoading && shipments.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">No shipments yet</p>
              )}
              {shipments.map(s => (
                <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900 font-mono">{s.reference_number}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.driver_name} → {s.destination}</p>
                    </div>
                    <Badge label={s.status} colorClass={SHIPMENT_STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{fmtDate(s.created_at)}</p>
                  {s.driver_sign_url && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(s.driver_sign_url!); }}
                      className="mt-2 text-xs text-blue-600 hover:underline"
                    >
                      Copy driver sign link
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {tab === 'variants' && (
            <VariantsTab item={item} onUpdated={onUpdate} />
          )}

          {tab === 'audit' && (
            <div className="space-y-2">
              {(item.audit_trail?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No audit entries yet.</p>
              ) : (
                (item.audit_trail ?? []).map(entry => (
                  <div key={entry.id} className="flex gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <div className="mt-0.5 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-sm">
                      {entry.action === 'created' ? '✚' :
                       entry.action === 'updated' ? '✎' :
                       entry.action === 'stocked' || entry.action === 'stock_in' ? '▲' :
                       entry.action === 'issued' || entry.action === 'stock_out' ? '▼' :
                       entry.action === 'adjusted' ? '⇅' :
                       entry.action === 'alert_triggered' ? '⚠' :
                       entry.action === 'merge' ? '⇒' :
                       entry.action === 'split' ? '⑂' : '•'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 capitalize">{entry.action.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleString()}</span>
                      </div>
                      {entry.actor_name && <p className="text-xs text-gray-500">by {entry.actor_name}</p>}
                      {entry.description && <p className="text-xs text-gray-600 mt-0.5">{entry.description}</p>}
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(entry.changes).map(([k, v]) => (
                            <span key={k} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {movementMode && propertyId && (
        <StockMovementModal
          item={item}
          mode={movementMode}
          propertyId={propertyId}
          units={units}
          onClose={() => setMovementMode(null)}
          onUpdated={handleUpdated}
          inventoryConfig={inventoryConfig}
          storeAppInstalled={storeAppInstalled}
        />
      )}

      {showShipment && (
        <CreateShipmentModal
          item={item}
          prefilledSerials={lastMovedSerials}
          onClose={() => setShowShipment(false)}
          onCreated={() => setShowShipment(false)}
        />
      )}

      {mergeTarget && (
        <MergeSerialModal
          item={mergeTarget.item}
          triggerSerial={mergeTarget.serial}
          onClose={() => setMergeTarget(null)}
          onUpdated={(updated) => { onUpdate(updated); setMergeTarget(null) }}
        />
      )}

      {splitSource && (
        <SplitSerialModal
          item={splitSource.item}
          sourceSerial={splitSource.serial}
          onClose={() => setSplitSource(null)}
          onUpdated={(updated) => { onUpdate(updated); setSplitSource(null) }}
        />
      )}
    </div>
  )
}

// ── Merge Serial Modal ─────────────────────────────────────────────────────────

interface MergeSerialModalProps {
  item: InventoryItem
  triggerSerial: StockSerial
  onClose: () => void
  onUpdated: (updated: InventoryItem) => void
}

function MergeSerialModal({ item, triggerSerial, onClose, onUpdated }: MergeSerialModalProps) {
  const [mergeMode, setMergeMode] = useState<'keep_target' | 'create_new'>('keep_target')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [newSerialNumber, setNewSerialNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inStockSerials = (item.serials ?? []).filter(s => s.status === 'in_stock' && s.serial_number !== triggerSerial.serial_number)

  function toggleSource(sn: string) {
    setSelectedSources(prev => prev.includes(sn) ? prev.filter(x => x !== sn) : [...prev, sn])
  }

  const sourcesForPreview = mergeMode === 'keep_target'
    ? [...selectedSources.map(sn => (item.serials ?? []).find(s => s.serial_number === sn)!)]
    : [...selectedSources.map(sn => (item.serials ?? []).find(s => s.serial_number === sn)!), triggerSerial]

  const totalQty = sourcesForPreview.reduce((acc, s) => acc + (s?.quantity_remaining ?? 0), 0)
  const targetQty = mergeMode === 'keep_target' ? (triggerSerial.quantity_remaining ?? 0) : 0
  const resultQty = targetQty + totalQty

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mergeMode === 'keep_target' && selectedSources.length === 0) {
      setError('Select at least one source serial')
      return
    }
    if (mergeMode === 'create_new' && selectedSources.length === 0) {
      setError('Select at least one source serial to absorb')
      return
    }
    if (mergeMode === 'create_new' && !newSerialNumber.trim()) {
      setError('New serial number is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: SerialMergePayload = mergeMode === 'keep_target'
        ? { target_serial: triggerSerial.serial_number, source_serials: selectedSources, notes: notes || undefined }
        : { source_serials: [triggerSerial.serial_number, ...selectedSources], new_serial_number: newSerialNumber.trim(), notes: notes || undefined }
      const updated = await inventoryApi.mergeSerials(item.id, payload)
      onUpdated(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">↗ Merge Serials</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Merge Mode</p>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="mergeMode" checked={mergeMode === 'keep_target'} onChange={() => setMergeMode('keep_target')} />
                <span className="text-sm text-gray-700">Keep target S/N ({triggerSerial.serial_number})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="mergeMode" checked={mergeMode === 'create_new'} onChange={() => setMergeMode('create_new')} />
                <span className="text-sm text-gray-700">Create new S/N</span>
              </label>
            </div>
          </div>

          {mergeMode === 'keep_target' ? (
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Source serials to absorb into <span className="font-mono text-purple-700">{triggerSerial.serial_number}</span></p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {inStockSerials.map(s => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer py-1 px-2 rounded hover:bg-gray-50">
                    <input type="checkbox" checked={selectedSources.includes(s.serial_number)} onChange={() => toggleSource(s.serial_number)} />
                    <span className="font-mono text-sm text-gray-800">{s.serial_number}</span>
                    {s.quantity_remaining != null && <span className="text-xs text-gray-500">{s.quantity_remaining.toFixed(3)} {item.unit_of_measure}</span>}
                  </label>
                ))}
                {inStockSerials.length === 0 && <p className="text-sm text-gray-400">No other in-stock serials available</p>}
              </div>
              {selectedSources.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Preview: {(triggerSerial.quantity_remaining ?? 0).toFixed(3)} + {totalQty.toFixed(3)} = <strong>{resultQty.toFixed(3)} {item.unit_of_measure}</strong>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-700 mb-2">Serials to absorb (including trigger: {triggerSerial.serial_number})</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <label className="flex items-center gap-2 py-1 px-2 rounded bg-purple-50">
                    <input type="checkbox" checked disabled />
                    <span className="font-mono text-sm text-purple-700">{triggerSerial.serial_number}</span>
                    {triggerSerial.quantity_remaining != null && <span className="text-xs text-gray-500">{triggerSerial.quantity_remaining.toFixed(3)} {item.unit_of_measure}</span>}
                  </label>
                  {inStockSerials.map(s => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer py-1 px-2 rounded hover:bg-gray-50">
                      <input type="checkbox" checked={selectedSources.includes(s.serial_number)} onChange={() => toggleSource(s.serial_number)} />
                      <span className="font-mono text-sm text-gray-800">{s.serial_number}</span>
                      {s.quantity_remaining != null && <span className="text-xs text-gray-500">{s.quantity_remaining.toFixed(3)} {item.unit_of_measure}</span>}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">New Serial Number *</label>
                <input className="input mt-1 w-full font-mono" value={newSerialNumber} onChange={e => setNewSerialNumber(e.target.value)} placeholder="e.g. DRUM-2024-001" />
              </div>
              {totalQty + (triggerSerial.quantity_remaining ?? 0) > 0 && (
                <p className="text-xs text-gray-500">Total: <strong>{(totalQty + (triggerSerial.quantity_remaining ?? 0)).toFixed(3)} {item.unit_of_measure}</strong></p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Notes</label>
            <input className="input mt-1 w-full" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </form>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit as unknown as React.MouseEventHandler} disabled={saving} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl disabled:opacity-50">
            {saving ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Split Serial Modal ─────────────────────────────────────────────────────────

interface SplitSerialModalProps {
  item: InventoryItem
  sourceSerial: StockSerial
  onClose: () => void
  onUpdated: (updated: InventoryItem) => void
}

function SplitSerialModal({ item, sourceSerial, onClose, onUpdated }: SplitSerialModalProps) {
  const [rows, setRows] = useState([
    { serial_number: '', quantity: '' },
    { serial_number: '', quantity: '' },
  ])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceQty = sourceSerial.quantity_remaining ?? 0
  const allocatedQty = rows.reduce((acc, r) => acc + (parseFloat(r.quantity) || 0), 0)
  const remainderQty = round6(sourceQty - allocatedQty)

  function round6(n: number) { return Math.round(n * 1e6) / 1e6 }

  function addRow() {
    setRows(prev => [...prev, { serial_number: '', quantity: '' }])
  }

  function removeRow(i: number) {
    if (rows.length <= 2) return
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateRow(i: number, field: 'serial_number' | 'quantity', val: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = rows.map(r => ({ serial_number: r.serial_number.trim(), quantity: parseFloat(r.quantity) || 0 }))
    if (parsed.some(r => !r.serial_number)) { setError('All serial numbers are required'); return }
    if (parsed.some(r => r.quantity <= 0)) { setError('All quantities must be greater than 0'); return }
    if (remainderQty < -1e-6) { setError('Total quantities exceed source remaining'); return }
    setSaving(true)
    setError(null)
    try {
      const payload: SerialSplitPayload = { source_serial: sourceSerial.serial_number, new_serials: parsed, notes: notes || undefined }
      const updated = await inventoryApi.splitSerial(item.id, payload)
      onUpdated(updated)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const remainderColor = remainderQty < -1e-6 ? 'text-red-600' : remainderQty > 1e-6 ? 'text-amber-600' : 'text-green-600'

  return (
    <div className="fixed inset-0 z-[10000] flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">✂ Split Serial</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono text-orange-700">{sourceSerial.serial_number}</span>
              {' '}&mdash; {sourceQty.toFixed(3)} {item.unit_of_measure} remaining
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input flex-1 font-mono text-sm"
                  value={r.serial_number}
                  onChange={e => updateRow(i, 'serial_number', e.target.value)}
                  placeholder={`S/N ${i + 1}`}
                />
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  className="input w-28 text-sm"
                  value={r.quantity}
                  onChange={e => updateRow(i, 'quantity', e.target.value)}
                  placeholder={item.unit_of_measure}
                />
                {rows.length > 2 && (
                  <button type="button" onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">✕</button>
                )}
              </div>
            ))}
          </div>

          <button type="button" onClick={addRow} className="text-sm text-blue-600 hover:text-blue-800">+ Add row</button>

          <div className={`text-sm font-medium ${remainderColor}`}>
            {allocatedQty.toFixed(3)} allocated / {sourceQty.toFixed(3)} source
            {Math.abs(remainderQty) > 1e-6 && (
              <span className="ml-2">
                ({remainderQty > 0 ? `${remainderQty.toFixed(3)} remainder` : `${Math.abs(remainderQty).toFixed(3)} over`})
              </span>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">Notes</label>
            <input className="input mt-1 w-full" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
        </form>
        <div className="border-t border-gray-100 px-6 py-4 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit as unknown as React.MouseEventHandler} disabled={saving || remainderQty < -1e-6} className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-xl disabled:opacity-50">
            {saving ? 'Splitting…' : 'Split'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{value ?? '—'}</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PropertyInventoryPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const property = useProperty()
  const inventoryConfig = property?.inventory_config
  const storeAppInstalled = property?.installed_apps?.includes('inventory-assets') ?? false
  const [items, setItems] = useState<InventoryItem[]>([])
  const [counts, setCounts] = useState<InventoryCounts | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<InventoryStatus | ''>('')
  const [filterCategory, setFilterCategory] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [search, setSearch] = useState('')
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    setError(null)
    try {
      const [listRes, countsRes] = await Promise.all([
        inventoryApi.list({
          property_id: propertyId,
          status: filterStatus || undefined,
          category: filterCategory || undefined,
          low_stock_only: lowStockOnly || undefined,
          search: search || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        inventoryApi.getCounts({ property_id: propertyId }),
      ])
      setItems(listRes.items)
      setTotal(listRes.total)
      setCounts(countsRes)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [propertyId, filterStatus, filterCategory, lowStockOnly, search, page])

  useEffect(() => { load() }, [load])

  const selectedItem = items.find(i => i.id === selectedId) ?? null

  function handleUpdated(updated: InventoryItem) {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
  }

  return (
    <div className="p-8">
      <PropertyBreadcrumb page="Inventory" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consumable stock items managed for this property</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
        >
          + Add Item
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard label="Total Items" value={counts.total} color="text-gray-900" />
          <StatCard label="Active" value={counts.active} color="text-green-700" />
          <StatCard label="Low Stock" value={counts.low_stock} color="text-orange-600" alert />
          <StatCard label="Out of Stock" value={counts.out_of_stock} color="text-red-600" alert />
          <StatCard label="Expiring Soon" value={counts.expiring_soon} color="text-yellow-700" alert />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="input text-sm flex-1 min-w-[200px]"
          placeholder="Search name, SKU, barcode…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="input text-sm"
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value as InventoryStatus | ''); setPage(1) }}
        >
          <option value="">All Statuses</option>
          {['active', 'out_of_stock', 'discontinued', 'on_order'].map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          className="input text-sm"
          placeholder="Category filter"
          value={filterCategory}
          onChange={e => { setFilterCategory(e.target.value); setPage(1) }}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={e => { setLowStockOnly(e.target.checked); setPage(1) }}
            className="rounded"
          />
          Low stock only
        </label>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-4">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hazards</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Value</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={7} className="text-center py-10 text-sm text-gray-400">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-14">
                  <span className="text-4xl block mb-2">📦</span>
                  <p className="text-sm text-gray-500">No inventory items yet</p>
                  <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-blue-600 hover:underline">
                    Add your first item
                  </button>
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr
                key={item.id}
                className={`hover:bg-gray-50 cursor-pointer ${item.is_low_stock ? 'bg-orange-50/30' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 truncate max-w-[180px]">{item.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{item.item_id}{item.sku ? ` · ${item.sku}` : ''}</p>
                  {item.is_serialized && <span className="text-xs text-indigo-600">Serialized</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {item.category}{item.subcategory ? <span className="text-gray-400"> › {item.subcategory}</span> : ''}
                </td>
                <td className="px-4 py-3">
                  <p className={`font-semibold ${item.is_low_stock ? 'text-orange-600' : 'text-gray-900'}`}>
                    {item.total_available}
                    <span className="text-xs font-normal text-gray-400 ml-1">{item.unit_of_measure}</span>
                  </p>
                  {item.is_low_stock && <p className="text-xs text-orange-500">Below reorder point ({item.reorder_point})</p>}
                </td>
                <td className="px-4 py-3">
                  <Badge label={item.status} colorClass={STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-600'} />
                  {item.has_expired_batches && <Badge label="Expired" colorClass="bg-red-100 text-red-700 ml-1" />}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {item.hazard_classes.slice(0, 3).map(h => (
                      <Badge key={h} label={h} colorClass={HAZARD_COLORS[h] ?? 'bg-gray-100 text-gray-600'} />
                    ))}
                    {item.hazard_classes.length > 3 && <span className="text-xs text-gray-400">+{item.hazard_classes.length - 3}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-900 font-medium">
                  {item.purchase_cost != null ? fmtCurrency(item.purchase_cost * item.total_quantity) : '—'}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setSelectedId(item.id); }}
                      className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100"
                      title="Stock In"
                    >
                      +In
                    </button>
                    <button
                      onClick={() => { setSelectedId(item.id); }}
                      className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100"
                      title="Stock Out"
                    >
                      −Out
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{total} items total</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        </div>
      )}

      {showCreate && propertyId && (
        <CreateItemModal
          propertyId={propertyId}
          onClose={() => setShowCreate(false)}
          onCreated={(item) => { setItems(prev => [item, ...prev]); setShowCreate(false) }}
        />
      )}

      {selectedItem && propertyId && (
        <InventoryDetailSlideOver
          item={selectedItem}
          propertyId={propertyId}
          onClose={() => setSelectedId(null)}
          onUpdate={handleUpdated}
          inventoryConfig={inventoryConfig}
          storeAppInstalled={storeAppInstalled}
        />
      )}
    </div>
  )
}
