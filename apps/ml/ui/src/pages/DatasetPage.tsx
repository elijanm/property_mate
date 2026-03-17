import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Database, Users, ImageIcon, FileText, Hash, Trash2, Mail, ChevronDown, ChevronRight, Copy, Check, X, GripVertical, ToggleLeft, ToggleRight, Eye, EyeOff, ShieldCheck, Globe, Lock, GitFork, Link2, BarChart2, MapPin, TrendingUp, Award, Video, Film } from 'lucide-react'
import type { DatasetOverview } from '@/types/dataset'
import clsx from 'clsx'
import { datasetsApi } from '@/api/datasets'
import { modelsApi } from '@/api/models'
import { annotatorApi } from '@/api/annotator'
import { walletApi } from '@/api/wallet'
import type { ModelDeployment } from '@/types/trainer'
import type { DatasetProfile, DatasetCollector, DatasetField, DatasetCreatePayload, FieldType, CaptureMode, DescriptionMode } from '@/types/dataset'

const FIELD_TYPE_ICONS: Record<FieldType, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  media: Film,
  file: FileText,
  text: FileText,
  number: Hash,
}

const STATUS_COLOR: Record<string, string> = {
  draft:  'bg-gray-800 text-gray-400 border-gray-700',
  active: 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50',
  closed: 'bg-red-900/50 text-red-400 border-red-800/50',
}

// ── Field editor row ──────────────────────────────────────────────────────────

function FieldRow({
  field, idx, onChange, onRemove, deployments,
}: {
  field: Omit<DatasetField, 'id'>
  idx: number
  onChange: (f: Omit<DatasetField, 'id'>) => void
  onRemove: () => void
  deployments: ModelDeployment[]
}) {
  const [open, setOpen] = useState(idx === 0)
  const [preset, setPreset] = useState('')
  const [labelInput, setLabelInput] = useState('')

  const isMedia = field.type === 'image' || field.type === 'video' || field.type === 'media' || field.type === 'file'

  return (
    <div className="border border-gray-700/60 rounded-xl bg-gray-800/40 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <GripVertical size={14} className="text-gray-600 shrink-0" />
        <span className="text-[10px] font-mono text-gray-500 w-5 shrink-0">{idx + 1}</span>
        <div className={clsx('p-1.5 rounded-lg',
          field.type === 'image' ? 'bg-sky-900/50'
          : field.type === 'video' ? 'bg-rose-900/50'
          : field.type === 'media' ? 'bg-violet-900/50'
          : 'bg-purple-900/50')}>
          {field.type === 'image' ? <ImageIcon size={12} className="text-sky-400" />
          : field.type === 'video' ? <Video size={12} className="text-rose-400" />
          : field.type === 'media' ? <Film size={12} className="text-violet-400" />
          : <FileText size={12} className="text-purple-400" />}
        </div>
        <span className="flex-1 text-sm text-white truncate">{field.label || <span className="text-gray-500 italic">Untitled field</span>}</span>
        <button onClick={e => { e.stopPropagation(); onRemove() }} className="p-1 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors">
          <Trash2 size={13} />
        </button>
        {open ? <ChevronDown size={13} className="text-gray-500 shrink-0" /> : <ChevronRight size={13} className="text-gray-500 shrink-0" />}
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50 pt-3">
          {/* Label + instruction */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Label *</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Front view of cow"
                value={field.label}
                onChange={e => onChange({ ...field, label: e.target.value })}
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Type</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={field.type}
                onChange={e => onChange({ ...field, type: e.target.value as FieldType })}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="media">Image or Video</option>
                <option value="file">File (any)</option>
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
            </div>
          </div>

          {/* Instruction */}
          <div>
            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Instruction (shown to collector)</label>
            <textarea
              rows={2}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="e.g. Stand 2m away. Ensure the full body is visible."
              value={field.instruction}
              onChange={e => onChange({ ...field, instruction: e.target.value })}
            />
          </div>

          {/* Image/file options */}
          {isMedia && (
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Capture mode</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={field.capture_mode}
                onChange={e => onChange({ ...field, capture_mode: e.target.value as CaptureMode })}
              >
                <option value="both">Camera OR upload allowed</option>
                <option value="camera_only">Camera only (no upload)</option>
                <option value="upload_only">Upload only (no camera)</option>
              </select>
            </div>
          )}

          {/* Description mode */}
          <div>
            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Description from collector</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={field.description_mode}
              onChange={e => onChange({ ...field, description_mode: e.target.value as DescriptionMode })}
            >
              <option value="none">None</option>
              <option value="free_text">Free text</option>
              <option value="preset">Preset options</option>
            </select>
          </div>

          {field.description_mode === 'preset' && (
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Preset options</label>
              <div className="flex gap-2 mb-2">
                <input
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Add option…"
                  value={preset}
                  onChange={e => setPreset(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && preset.trim()) {
                      onChange({ ...field, description_presets: [...field.description_presets, preset.trim()] })
                      setPreset('')
                    }
                  }}
                />
                <button
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg"
                  onClick={() => {
                    if (preset.trim()) {
                      onChange({ ...field, description_presets: [...field.description_presets, preset.trim()] })
                      setPreset('')
                    }
                  }}
                >Add</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {field.description_presets.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-full">
                    {p}
                    <button onClick={() => onChange({ ...field, description_presets: field.description_presets.filter((_, j) => j !== i) })}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Toggles */}
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded border-gray-600 text-indigo-500 bg-gray-900" checked={field.required}
                onChange={e => onChange({ ...field, required: e.target.checked })} />
              <span className="text-xs text-gray-400">Required</span>
            </label>
            {field.description_mode !== 'none' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-gray-600 text-indigo-500 bg-gray-900" checked={field.description_required}
                  onChange={e => onChange({ ...field, description_required: e.target.checked })} />
                <span className="text-xs text-gray-400">Description required</span>
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded border-gray-600 text-indigo-500 bg-gray-900" checked={field.repeatable}
                onChange={e => onChange({ ...field, repeatable: e.target.checked, max_repeats: e.target.checked ? 0 : 0 })} />
              <span className="text-xs text-gray-400">Repeatable</span>
            </label>
          </div>
          {field.repeatable && (
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-gray-400 shrink-0">Max captures</span>
              <input
                type="number" min={0}
                className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="∞"
                value={field.max_repeats === 0 ? '' : field.max_repeats}
                onChange={e => onChange({ ...field, max_repeats: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0) })}
              />
              <span className="text-[10px] text-gray-600">{field.max_repeats === 0 ? 'Unlimited' : `up to ${field.max_repeats}×`}</span>
            </div>
          )}

          {/* Model validation */}
          {isMedia && deployments.length > 0 && (
            <div className="border border-gray-700/50 rounded-xl p-3 space-y-2 bg-gray-800/30">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={13} className="text-indigo-400" />
                <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">Model Validation</span>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Validation model</label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={field.validation_model ?? ''}
                  onChange={e => onChange({ ...field, validation_model: e.target.value || null, validation_labels: [], validation_message: '' })}
                >
                  <option value="">None — no validation</option>
                  {deployments.map(d => (
                    <option key={d.id} value={d.trainer_name}>{d.trainer_name} v{d.version}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-600 mt-0.5">Run every uploaded file through this model before accepting.</p>
              </div>

              {field.validation_model && (
                <>
                  <div>
                    <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                      Accepted labels <span className="text-gray-600 normal-case font-normal">(press Enter to add)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                        placeholder="e.g. maize, crop, corn"
                        value={labelInput}
                        onChange={e => setLabelInput(e.target.value)}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ',') && labelInput.trim()) {
                            e.preventDefault()
                            const l = labelInput.trim().replace(/,$/, '')
                            if (l && !field.validation_labels.includes(l)) {
                              onChange({ ...field, validation_labels: [...field.validation_labels, l] })
                            }
                            setLabelInput('')
                          }
                        }}
                      />
                    </div>
                    {field.validation_labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {field.validation_labels.map(l => (
                          <span key={l} className="flex items-center gap-1 bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 text-[11px] px-2 py-0.5 rounded-full">
                            {l}
                            <button onClick={() => onChange({ ...field, validation_labels: field.validation_labels.filter(x => x !== l) })}
                              className="text-indigo-500 hover:text-white"><X size={10} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {field.validation_labels.length === 0
                        ? 'No labels set — model runs but all predictions are accepted.'
                        : 'Submissions predicted outside these labels will be rejected.'}
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Rejection message (optional)</label>
                    <input
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                      placeholder="e.g. Please capture a crop image only."
                      value={field.validation_message}
                      onChange={e => onChange({ ...field, validation_message: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create / Edit slide-over ─────────────────────────────────────────────────

const BLANK_FIELD = (): Omit<DatasetField, 'id'> => ({
  label: '', instruction: '', type: 'image', capture_mode: 'both',
  required: true, description_mode: 'none', description_presets: [],
  description_required: false, order: 0, repeatable: false, max_repeats: 0,
  validation_model: null, validation_labels: [], validation_message: '',
})

function DatasetSlideOver({
  initial, onClose, onSaved,
}: {
  initial?: DatasetProfile
  onClose: () => void
  onSaved: (d: DatasetProfile) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(!!(initial?.slug))
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [fields, setFields] = useState<Omit<DatasetField, 'id'>[]>(
    initial?.fields?.map(({ id: _id, ...rest }) => rest) ?? [BLANK_FIELD()]
  )
  const [discoverable, setDiscoverable] = useState(initial?.discoverable ?? false)
  const [allowlistMode, setAllowlistMode] = useState((initial?.contributor_allowlist?.length ?? 0) > 0)
  const [allowlist, setAllowlist] = useState<string[]>(initial?.contributor_allowlist ?? [])
  const [allowlistInput, setAllowlistInput] = useState('')
  const [pointsEnabled, setPointsEnabled] = useState(initial?.points_enabled ?? false)
  const [pointsPer, setPointsPer] = useState(initial?.points_per_entry ?? 1)
  const [pointsInfo] = useState(initial?.points_redemption_info ?? '')
  const [requireLocation, setRequireLocation] = useState(initial?.require_location ?? false)
  const [locationPurpose, setLocationPurpose] = useState(initial?.location_purpose ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [platformRate, setPlatformRate] = useState<{ point_value_usd: number; rate_label: string; min_org_balance_usd?: number } | null>(null)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)

  useEffect(() => {
    modelsApi.list({ include_all: true }).then(setDeployments).catch(() => {})
    annotatorApi.getRewardRate().then(r => setPlatformRate(r as any)).catch(() => {})
    walletApi.get().then(w => setWalletBalance(w.balance)).catch(() => {})
  }, [])

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr('')
    try {
      const payload: DatasetCreatePayload = {
        name, ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: desc, category,
        fields: fields.map((f, i) => ({ ...f, order: i })),
        discoverable,
        contributor_allowlist: allowlistMode ? allowlist : [],
        points_enabled: pointsEnabled, points_per_entry: pointsPer,
        points_redemption_info: pointsInfo,
        require_location: requireLocation,
        location_purpose: locationPurpose,
      }
      const result = initial
        ? await datasetsApi.update(initial.id, payload)
        : await datasetsApi.create(payload)
      onSaved(result)
    } catch (e: any) {
      setErr(e?.message || e?.response?.data?.detail || 'Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">{initial ? 'Edit Dataset' : 'New Dataset'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Basic info */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Dataset Name *</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Cattle Physique Dataset" value={name} onChange={e => {
                  const val = e.target.value
                  setName(val)
                  if (!slugEdited) {
                    setSlug(val.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
                  }
                }} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Slug</label>
                {slugEdited ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSlugEdited(false)
                      setSlug(name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
                    }}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    ↺ auto
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-600">auto-generated</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-sm pl-2">#</span>
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="auto" value={slug}
                  onChange={e => {
                    setSlugEdited(true)
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))
                  }} />
              </div>
              <p className="text-[10px] text-gray-600 mt-1">Used in trainer plugins: <code className="text-gray-500">DatasetDataSource(slug="…")</code></p>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Description</label>
              <textarea rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                placeholder="What is being collected and why?" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Category</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Agriculture, Medical, Retail" value={category} onChange={e => setCategory(e.target.value)} />
            </div>
          </div>

          {/* Fields */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Capture Fields ({fields.length})</span>
              <button onClick={() => setFields(f => [...f, BLANK_FIELD()])}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-600/30 text-indigo-400 text-xs rounded-lg transition-colors">
                <Plus size={12} /> Add Field
              </button>
            </div>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <FieldRow key={i} field={f} idx={i}
                  onChange={updated => setFields(fs => fs.map((x, j) => j === i ? updated : x))}
                  onRemove={() => setFields(fs => fs.filter((_, j) => j !== i))}
                  deployments={deployments} />
              ))}
              {fields.length === 0 && (
                <p className="text-center text-xs text-gray-600 py-6">No fields yet — add at least one capture field.</p>
              )}
            </div>
          </div>

          {/* Discoverable + Allowlist */}
          <div className="border border-gray-700/50 rounded-xl overflow-hidden">
            <label className="flex items-start gap-3 bg-gray-800/50 p-4 cursor-pointer hover:bg-gray-800/70 transition-colors">
              <input
                type="checkbox"
                checked={discoverable}
                onChange={e => setDiscoverable(e.target.checked)}
                className="mt-0.5 accent-indigo-500 w-4 h-4 cursor-pointer"
              />
              <div>
                <p className="text-sm font-semibold text-white">Open to contributors</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Annotators can discover this dataset in their task feed and start contributing.
                </p>
              </div>
            </label>

            {discoverable && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-700/50 bg-gray-800/20 space-y-3">
                {/* Audience selector */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setAllowlistMode(false)}
                    className={clsx('flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors',
                      !allowlistMode
                        ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600')}
                  >
                    All contributors
                  </button>
                  <button
                    onClick={() => setAllowlistMode(true)}
                    className={clsx('flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors',
                      allowlistMode
                        ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                        : 'border-gray-700 text-gray-400 hover:border-gray-600')}
                  >
                    Selected only
                  </button>
                </div>

                {allowlistMode && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Allowed contributor emails</p>
                    {/* Email tag input */}
                    <div className="flex gap-2">
                      <input
                        type="email"
                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                        placeholder="annotator@example.com"
                        value={allowlistInput}
                        onChange={e => setAllowlistInput(e.target.value)}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ',') && allowlistInput.trim()) {
                            e.preventDefault()
                            const email = allowlistInput.trim().toLowerCase()
                            if (email && !allowlist.includes(email)) {
                              setAllowlist(prev => [...prev, email])
                            }
                            setAllowlistInput('')
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const email = allowlistInput.trim().toLowerCase()
                          if (email && !allowlist.includes(email)) {
                            setAllowlist(prev => [...prev, email])
                          }
                          setAllowlistInput('')
                        }}
                        className="px-3 py-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-600/40 text-indigo-300 text-sm font-medium transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {/* Tags */}
                    {allowlist.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {allowlist.map(email => (
                          <span key={email} className="flex items-center gap-1.5 bg-indigo-900/30 border border-indigo-800/50 text-indigo-300 rounded-full px-2.5 py-1 text-xs">
                            {email}
                            <button onClick={() => setAllowlist(prev => prev.filter(e => e !== email))} className="text-indigo-400 hover:text-white">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-400/80">No contributors added yet. Type an email above and press Enter.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Points */}
          <div className="border border-gray-700/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Earn Points</p>
                <p className="text-xs text-gray-500 mt-0.5">Collectors earn points redeemable for airtime or rewards</p>
              </div>
              <button onClick={() => setPointsEnabled(v => !v)} className="text-gray-400 hover:text-white transition-colors">
                {pointsEnabled ? <ToggleRight size={28} className="text-emerald-500" /> : <ToggleLeft size={28} />}
              </button>
            </div>
            {pointsEnabled && walletBalance !== null && platformRate?.min_org_balance_usd !== undefined && walletBalance < platformRate.min_org_balance_usd && (
              <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2.5 text-xs text-amber-300">
                <Award size={14} className="shrink-0 mt-0.5" />
                <span>
                  Your wallet balance is <strong>${walletBalance.toFixed(2)}</strong> — a minimum of <strong>${platformRate.min_org_balance_usd.toFixed(2)} USD</strong> is required to enable rewards. <span className="text-amber-400 underline cursor-pointer" onClick={() => window.location.href = '/billing'}>Top up wallet →</span>
                </span>
              </div>
            )}
            {pointsEnabled && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Points per entry</label>
                  <input type="number" min={1} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    value={pointsPer} onChange={e => setPointsPer(Number(e.target.value))} />
                </div>
                {platformRate && (
                  <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2.5 text-xs text-gray-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Platform rate:</span>
                      <span className="text-white font-semibold">{platformRate.rate_label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{pointsPer} pts/entry =</span>
                      <span className="text-amber-400 font-semibold">
                        ~${(pointsPer * platformRate.point_value_usd).toFixed(4)} USD per entry
                      </span>
                    </div>
                    <p className="text-gray-600 pt-0.5">Rate is set by platform admin and shown to collectors automatically.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Location tracking */}
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/40 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white flex items-center gap-1.5"><MapPin size={13} className="text-amber-400" /> Location Tracking</p>
                <p className="text-xs text-gray-500 mt-0.5">Attach GPS or IP location to every submission</p>
              </div>
              <button onClick={() => setRequireLocation(v => !v)} className="text-gray-400 hover:text-white transition-colors">
                {requireLocation ? <ToggleRight size={28} className="text-amber-500" /> : <ToggleLeft size={28} />}
              </button>
            </div>
            {requireLocation && (
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Why location is needed (shown to collector)</label>
                <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500"
                  placeholder="e.g. We verify data is collected in the field, not remotely"
                  value={locationPurpose} onChange={e => setLocationPurpose(e.target.value)} />
              </div>
            )}
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-4">
          <button onClick={save} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Dataset'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Invite modal ─────────────────────────────────────────────────────────────

function buildDefaultMessage(dataset: DatasetProfile): string {
  const fieldLabels = dataset.fields.map(f => `• ${f.label}`).join('\n')
  const parts: string[] = [
    `We're collecting data for "${dataset.name}" and need your help!`,
  ]
  if (dataset.description) parts.push(dataset.description)
  if (fieldLabels) parts.push(`\nWhat we need:\n${fieldLabels}`)
  if (dataset.points_enabled) {
    parts.push(`\nYou'll earn ${dataset.points_per_entry} point(s) per entry${dataset.points_redemption_info ? ` — ${dataset.points_redemption_info}` : ''}.`)
  }
  parts.push('\nClick the link in this email to get started. Thank you!')
  return parts.join('\n')
}

function InviteModal({ dataset, onClose }: { dataset: DatasetProfile; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState(() => buildDefaultMessage(dataset))
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const send = async () => {
    if (!email.trim()) { setErr('Email required'); return }
    setSending(true); setErr('')
    try {
      await datasetsApi.invite(dataset.id, email.trim(), name.trim(), message.trim())
      setDone(true)
    } catch (e: any) {
      setErr(e?.message || 'Failed to send invite')
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Invite Collector</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>
        {done ? (
          <div className="text-center py-4">
            <Check size={32} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-white font-semibold">Invite sent!</p>
            <p className="text-xs text-gray-400 mt-1">A unique collection link has been emailed to {email}</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Email *</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="collector@example.com" type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Name (optional)</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="John Doe" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                Message (pre-filled — edit as needed)
              </label>
              <textarea
                rows={7}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              <p className="text-[10px] text-gray-600 mt-0.5">This message appears in the invite email above the contribution link.</p>
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <button onClick={send} disabled={sending}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
              <Mail size={14} /> {sending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dataset card ─────────────────────────────────────────────────────────────

function DatasetCard({
  dataset, onEdit, onDelete, onInvite, onView, onOverview, onVisibilityToggle,
}: {
  dataset: DatasetProfile
  onEdit: () => void
  onDelete: () => void
  onInvite: () => void
  onView: () => void
  onOverview: () => void
  onVisibilityToggle: (v: 'private' | 'public') => void
}) {
  const isRef   = dataset.reference_type === 'reference'
  const isClone = dataset.reference_type === 'clone'

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5 hover:border-gray-600/50 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{dataset.name}</h3>
            {dataset.slug && (
              <button
                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(dataset.slug!) }}
                title="Click to copy slug"
                className="flex items-center gap-1 text-[10px] font-mono text-indigo-400 bg-indigo-900/30 border border-indigo-800/40 px-1.5 py-0.5 rounded hover:bg-indigo-900/60 transition-colors">
                #{dataset.slug}
              </button>
            )}
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide', STATUS_COLOR[dataset.status])}>
              {dataset.status}
            </span>
            {/* Visibility badge */}
            {dataset.visibility === 'public' ? (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-900/50 border border-sky-800/50 text-sky-400 font-semibold">
                <Globe size={9} /> Public
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-700/50 border border-gray-600/50 text-gray-400 font-semibold">
                <Lock size={9} /> Private
              </span>
            )}
            {/* Derived badges */}
            {isRef && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-900/40 border border-purple-800/40 text-purple-400 font-semibold">
                <Link2 size={9} /> Referenced
              </span>
            )}
            {isClone && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-900/40 border border-teal-800/40 text-teal-400 font-semibold">
                <GitFork size={9} /> Cloned
              </span>
            )}
            {dataset.discoverable && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/40 border border-indigo-800/40 text-indigo-400 font-semibold">
                <Users size={9} />
                {dataset.contributor_allowlist?.length > 0
                  ? `${dataset.contributor_allowlist.length} contributor${dataset.contributor_allowlist.length !== 1 ? 's' : ''}`
                  : 'Open to contributors'}
              </span>
            )}
            {dataset.points_enabled && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/50 border border-amber-800/50 text-amber-400 font-semibold">🎁 Points</span>
            )}
          </div>
          {dataset.description && <p className="text-xs text-gray-500 line-clamp-2">{dataset.description}</p>}
          {isRef && (
            <p className="text-[10px] text-purple-500 mt-1">Read-only reference — entries come from the source dataset. No storage used.</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Database size={11} /> {dataset.fields.length} fields</span>
        <span className="flex items-center gap-1"><Users size={11} /> {dataset.collectors?.length ?? 0} collectors</span>
        {dataset.category && <span className="text-gray-600">#{dataset.category}</span>}
      </div>

      {/* Field badges */}
      {dataset.fields.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {dataset.fields.slice(0, 5).map(f => {
            const Icon = FIELD_TYPE_ICONS[f.type]
            return (
              <span key={f.id} className="flex items-center gap-1 bg-gray-700/50 text-gray-400 text-[10px] px-2 py-0.5 rounded-full">
                <Icon size={9} /> {f.label}
              </span>
            )
          })}
          {dataset.fields.length > 5 && (
            <span className="text-[10px] text-gray-600 px-1">+{dataset.fields.length - 5} more</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isRef && (
          <button onClick={onInvite}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-600/30 text-indigo-400 text-xs rounded-lg transition-colors">
            <Mail size={11} /> Invite
          </button>
        )}
        <button onClick={onView}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
          <Eye size={11} /> Entries
        </button>
        <button onClick={onOverview}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-800/40 text-indigo-400 text-xs rounded-lg transition-colors">
          <BarChart2 size={11} /> Overview
        </button>
        {!isRef && (
          <button onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
            Edit
          </button>
        )}
        {/* Visibility toggle — not available for references */}
        {!isRef && (
          <button
            onClick={() => onVisibilityToggle(dataset.visibility === 'public' ? 'private' : 'public')}
            title={dataset.visibility === 'public' ? 'Make private' : 'Make public'}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors',
              dataset.visibility === 'public'
                ? 'bg-sky-900/30 hover:bg-sky-900/50 text-sky-400 border border-sky-800/40'
                : 'bg-gray-700/30 hover:bg-gray-700/60 text-gray-400 border border-gray-600/30',
            )}>
            {dataset.visibility === 'public' ? <><Lock size={11} /> Make Private</> : <><Globe size={11} /> Make Public</>}
          </button>
        )}
        <button onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-red-900/30 text-gray-500 hover:text-red-400 text-xs rounded-lg transition-colors ml-auto">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Public dataset gallery card ───────────────────────────────────────────────

function PublicDatasetCard({
  dataset, onClone, onReference, busy,
}: {
  dataset: DatasetProfile
  onClone: () => void
  onReference: () => void
  busy: boolean
}) {
  return (
    <div className="bg-gray-800/50 border border-sky-800/30 rounded-2xl p-5 hover:border-sky-700/50 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{dataset.name}</h3>
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-900/50 border border-sky-800/50 text-sky-400 font-semibold">
              <Globe size={9} /> Public
            </span>
            {dataset.category && <span className="text-[10px] text-gray-600">#{dataset.category}</span>}
          </div>
          {dataset.description && <p className="text-xs text-gray-500 line-clamp-2">{dataset.description}</p>}
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Database size={11} /> {dataset.fields.length} fields</span>
        <span className="flex items-center gap-1"><Users size={11} /> {dataset.entry_count_cache ?? 0} entries</span>
      </div>

      {dataset.fields.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {dataset.fields.slice(0, 4).map(f => {
            const Icon = FIELD_TYPE_ICONS[f.type]
            return (
              <span key={f.id} className="flex items-center gap-1 bg-gray-700/50 text-gray-400 text-[10px] px-2 py-0.5 rounded-full">
                <Icon size={9} /> {f.label}
              </span>
            )
          })}
          {dataset.fields.length > 4 && <span className="text-[10px] text-gray-600 px-1">+{dataset.fields.length - 4} more</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={onClone} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 border border-teal-700/40 text-teal-400 text-xs rounded-lg transition-colors disabled:opacity-50">
          <GitFork size={11} /> Clone
        </button>
        <button onClick={onReference} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-700/40 text-purple-400 text-xs rounded-lg transition-colors disabled:opacity-50">
          <Link2 size={11} /> Use as Reference
        </button>
        <div className="ml-auto text-[10px] text-gray-600 text-right">
          <p>Clone = your own copy</p>
          <p>Reference = read-only, no storage</p>
        </div>
      </div>
    </div>
  )
}

// ── Overview panel ────────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  KE: '🇰🇪', TZ: '🇹🇿', UG: '🇺🇬', NG: '🇳🇬', GH: '🇬🇭', ET: '🇪🇹', RW: '🇷🇼',
  US: '🇺🇸', GB: '🇬🇧', IN: '🇮🇳', ZA: '🇿🇦', EG: '🇪🇬', SN: '🇸🇳',
}

function OverviewPanel({ dataset, onClose }: { dataset: DatasetProfile; onClose: () => void }) {
  const [overview, setOverview] = useState<DatasetOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    datasetsApi.getOverview(dataset.id).then(setOverview).finally(() => setLoading(false))
  }, [dataset.id])

  const maxCount = overview ? Math.max(...overview.daily_trend.map(d => d.count), 1) : 1

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-2xl bg-gray-900 shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">{dataset.name} — Overview</h2>
            <p className="text-xs text-gray-500 mt-0.5">Entry stats, location breakdown, and collection trend</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading && <div className="text-center py-20 text-gray-500 text-sm">Loading overview…</div>}

          {overview && <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Total Entries', value: overview.summary.total_entries, icon: <Database size={14} className="text-indigo-400" /> },
                { label: 'Collectors', value: overview.summary.total_collectors, icon: <Users size={14} className="text-sky-400" /> },
                { label: 'Active', value: overview.summary.active_collectors, icon: <TrendingUp size={14} className="text-emerald-400" /> },
                { label: 'Points Awarded', value: overview.summary.total_points_awarded, icon: <Award size={14} className="text-amber-400" /> },
              ].map(c => (
                <div key={c.label} className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
                  <div className="flex items-center gap-1.5 mb-1">{c.icon}<span className="text-[10px] text-gray-400">{c.label}</span></div>
                  <p className="text-xl font-bold text-white">{c.value.toLocaleString()}</p>
                </div>
              ))}
            </div>

            {/* Daily trend */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <TrendingUp size={12} /> Submissions — Last 14 Days
              </h3>
              <div className="flex items-end gap-1 h-20">
                {overview.daily_trend.map(d => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full bg-indigo-600/70 hover:bg-indigo-500 rounded-t transition-all"
                      style={{ height: `${Math.max((d.count / maxCount) * 64, d.count > 0 ? 4 : 2)}px` }}
                    />
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap z-10">
                      {d.date.slice(5)}: {d.count}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>{overview.daily_trend[0]?.date.slice(5)}</span>
                <span>{overview.daily_trend[overview.daily_trend.length - 1]?.date.slice(5)}</span>
              </div>
            </div>

            {/* Location breakdown */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MapPin size={12} /> Location Coverage
              </h3>
              {overview.summary.total_entries === 0 ? (
                <p className="text-xs text-gray-500">No entries yet.</p>
              ) : (
                <>
                  {/* GPS vs IP summary */}
                  <div className="flex gap-3 mb-3">
                    <div className="flex-1 bg-emerald-900/20 border border-emerald-800/30 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-emerald-400">{overview.location.gps_count}</p>
                      <p className="text-[10px] text-emerald-500">GPS ({overview.location.gps_pct}%)</p>
                    </div>
                    <div className="flex-1 bg-sky-900/20 border border-sky-800/30 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-sky-400">{overview.location.ip_count}</p>
                      <p className="text-[10px] text-sky-500">IP-based</p>
                    </div>
                    <div className="flex-1 bg-gray-800/50 border border-gray-700/40 rounded-xl p-3 text-center">
                      <p className="text-lg font-bold text-gray-400">{overview.location.no_location}</p>
                      <p className="text-[10px] text-gray-500">No location</p>
                    </div>
                  </div>

                  {/* Country breakdown */}
                  {overview.location.countries.length > 0 && (
                    <div className="space-y-2">
                      {overview.location.countries.slice(0, 8).map(c => {
                        const total = overview.summary.total_entries
                        const pct = total ? Math.round(c.count / total * 100) : 0
                        return (
                          <div key={c.code} className="flex items-center gap-2">
                            <span className="text-base w-6 text-center">{COUNTRY_FLAGS[c.code] ?? '🌍'}</span>
                            <span className="text-xs text-gray-300 w-16 shrink-0">{c.code}</span>
                            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">{c.count}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Top cities */}
                  {overview.location.cities.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] text-gray-500 mb-2">Top cities</p>
                      <div className="flex flex-wrap gap-1.5">
                        {overview.location.cities.map(city => (
                          <span key={city.name} className="flex items-center gap-1 bg-gray-800/60 border border-gray-700/40 text-gray-300 text-[10px] px-2 py-0.5 rounded-full">
                            <MapPin size={8} /> {city.name} <span className="text-gray-500">·{city.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Field breakdown */}
            {overview.field_breakdown.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Database size={12} /> Entries by Field
                </h3>
                <div className="space-y-2">
                  {overview.field_breakdown.map(f => {
                    const pct = overview.summary.total_entries ? Math.round(f.count / overview.summary.total_entries * 100) : 0
                    return (
                      <div key={f.field_id} className="flex items-center gap-2">
                        <span className="text-xs text-gray-300 flex-1 truncate">{f.label}</span>
                        <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-sky-600 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right">{f.count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Top collectors */}
            {overview.top_collectors.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Award size={12} /> Top Collectors
                </h3>
                <div className="space-y-2">
                  {overview.top_collectors.map((c, i) => (
                    <div key={c.email} className="flex items-center gap-3 bg-gray-800/40 rounded-xl px-3 py-2">
                      <span className="text-xs font-bold text-gray-500 w-4">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-gray-500 truncate">{c.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-white">{c.entries} entries</p>
                        {c.points > 0 && <p className="text-[10px] text-amber-400">{c.points} pts</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  )
}

// ── Entries panel ─────────────────────────────────────────────────────────────

function EntriesPanel({ dataset, onClose }: { dataset: DatasetProfile; onClose: () => void }) {
  const [entries, setEntries] = useState<any[]>([])
  const [collectors, setCollectors] = useState<DatasetCollector[]>([])
  const [loading, setLoading] = useState(true)

  const [showFilters, setShowFilters] = useState(false)
  const [filterField, setFilterField] = useState('')
  const [filterCollector, setFilterCollector] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (filterField) params.field_id = filterField
    if (filterCollector) params.collector_id = filterCollector
    if (filterDateFrom) params.date_from = filterDateFrom
    if (filterDateTo) params.date_to = filterDateTo
    datasetsApi.getEntries(dataset.id, params)
      .then(setEntries).finally(() => setLoading(false))
  }, [dataset.id, filterField, filterCollector, filterDateFrom, filterDateTo])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    datasetsApi.listCollectors(dataset.id).then(setCollectors).catch(() => {})
  }, [dataset.id])

  const fieldName = (id: string) => dataset.fields.find(f => f.id === id)?.label ?? id
  const collectorName = (id: string) => collectors.find(c => c.id === id)?.name || collectors.find(c => c.id === id)?.email || id

  const hasFilter = filterField || filterCollector || filterDateFrom || filterDateTo
  const clearFilters = () => { setFilterField(''); setFilterCollector(''); setFilterDateFrom(''); setFilterDateTo('') }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-2xl bg-gray-900 shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">{dataset.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${hasFilter ? ' (filtered)' : ''}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>

        {/* Filters */}
        <div className="px-6 py-2 border-b border-gray-800/50">
          <button onClick={() => setShowFilters(s => !s)}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white py-1 transition-colors">
            <ChevronRight size={12} className={clsx('transition-transform', showFilters && 'rotate-90')} />
            Filters
            {hasFilter && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />}
          </button>
        </div>
        {showFilters && (
        <div className="px-6 py-3 border-b border-gray-800/50 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {/* Field filter */}
            <div>
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1 block">Field</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                value={filterField} onChange={e => setFilterField(e.target.value)}>
                <option value="">All fields</option>
                {dataset.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>

            {/* Collector filter */}
            <div>
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1 block">Collector</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                value={filterCollector} onChange={e => setFilterCollector(e.target.value)}>
                <option value="">All collectors</option>
                {collectors.map(c => (
                  <option key={c.id} value={c.id}>{c.name || c.email}</option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div>
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1 block">From date</label>
              <input type="date"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
            </div>

            {/* Date to */}
            <div>
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1 block">To date</label>
              <input type="date"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
            </div>
          </div>

          {hasFilter && (
            <button onClick={clearFilters}
              className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 transition-colors">
              <X size={10} /> Clear filters
            </button>
          )}
        </div>
        )}

        {/* Entries grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-center text-xs text-gray-500 py-10">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-center text-xs text-gray-500 py-10">No entries{hasFilter ? ' matching filters' : ' yet'}.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {entries.map(e => (
                <div key={e.id} className="bg-gray-800/60 border border-gray-700/50 rounded-xl overflow-hidden">
                  {e.file_url && e.file_mime?.startsWith('image/') ? (
                    <img src={e.file_url} alt="" className="w-full h-32 object-cover" />
                  ) : e.file_url ? (
                    <a href={e.file_url} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center h-32 bg-gray-700/50 text-gray-400 hover:text-white text-xs gap-1">
                      <FileText size={20} /> View file
                    </a>
                  ) : (
                    <div className="flex items-center justify-center h-20 bg-gray-700/30 text-gray-500 text-xs px-2 text-center">
                      {e.text_value ?? '—'}
                    </div>
                  )}
                  <div className="p-2 space-y-1">
                    <p className="text-[10px] text-indigo-400 font-semibold truncate">{fieldName(e.field_id)}</p>
                    <p className="text-[10px] text-gray-500 truncate">{collectorName(e.collector_id)}</p>
                    {e.description && <p className="text-[10px] text-gray-400 truncate">{e.description}</p>}
                    <p className="text-[10px] text-gray-600">{new Date(e.captured_at).toLocaleDateString()}</p>
                    {e.points_awarded > 0 && <p className="text-[10px] text-amber-500">+{e.points_awarded} pts</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DatasetPage() {
  const [tab, setTab]               = useState<'mine' | 'public'>('mine')
  const [datasets, setDatasets]     = useState<DatasetProfile[]>([])
  const [publicDs, setPublicDs]     = useState<DatasetProfile[]>([])
  const [loading, setLoading]       = useState(true)
  const [publicLoading, setPublicLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<DatasetProfile | null>(null)
  const [inviteTarget, setInviteTarget] = useState<DatasetProfile | null>(null)
  const [viewTarget, setViewTarget] = useState<DatasetProfile | null>(null)
  const [overviewTarget, setOverviewTarget] = useState<DatasetProfile | null>(null)
  const [busyId, setBusyId]         = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    datasetsApi.list().then(setDatasets).finally(() => setLoading(false))
  }

  const loadPublic = () => {
    setPublicLoading(true)
    datasetsApi.listPublic().then(setPublicDs).finally(() => setPublicLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'public') loadPublic() }, [tab])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dataset? This cannot be undone.')) return
    await datasetsApi.delete(id)
    setDatasets(ds => ds.filter(d => d.id !== id))
  }

  const handleVisibilityToggle = async (id: string, visibility: 'private' | 'public') => {
    setBusyId(id)
    try {
      const updated = await datasetsApi.setVisibility(id, visibility)
      setDatasets(ds => ds.map(d => d.id === id ? updated : d))
    } finally { setBusyId(null) }
  }

  const handleClone = async (sourceId: string) => {
    setBusyId(sourceId)
    try {
      const cloned = await datasetsApi.clone(sourceId)
      setDatasets(ds => [cloned, ...ds])
      setTab('mine')
    } finally { setBusyId(null) }
  }

  const handleReference = async (sourceId: string) => {
    setBusyId(sourceId)
    try {
      const ref = await datasetsApi.reference(sourceId)
      setDatasets(ds => [ref, ...ds])
      setTab('mine')
    } finally { setBusyId(null) }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Datasets</h1>
          <p className="text-xs text-gray-500 mt-0.5">Collect labelled data from contributors via unique invite links</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus size={15} /> New Dataset
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-800 pb-0">
        {([['mine', 'My Datasets'], ['public', 'Public Gallery']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === key
                ? 'text-white border-indigo-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}>
            {key === 'public' && <Globe size={12} className="inline mr-1.5 -mt-0.5" />}
            {label}
            {key === 'mine' && datasets.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">{datasets.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── My Datasets tab ── */}
      {tab === 'mine' && (
        loading ? (
          <div className="text-center text-xs text-gray-500 py-20">Loading…</div>
        ) : datasets.length === 0 ? (
          <div className="text-center py-20">
            <Database size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-semibold">No datasets yet</p>
            <p className="text-xs text-gray-600 mt-1">Create one or browse the Public Gallery to clone or reference shared datasets.</p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-xl">
              Create Dataset
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {datasets.map(d => (
              <DatasetCard key={d.id} dataset={d}
                onEdit={() => setEditTarget(d)}
                onDelete={() => handleDelete(d.id)}
                onInvite={() => setInviteTarget(d)}
                onView={() => setViewTarget(d)}
                onOverview={() => setOverviewTarget(d)}
                onVisibilityToggle={v => handleVisibilityToggle(d.id, v)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Public Gallery tab ── */}
      {tab === 'public' && (
        publicLoading ? (
          <div className="text-center text-xs text-gray-500 py-20">Loading public datasets…</div>
        ) : publicDs.length === 0 ? (
          <div className="text-center py-20">
            <Globe size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-semibold">No public datasets yet</p>
            <p className="text-xs text-gray-600 mt-1">
              Publish one of your own datasets to make it discoverable by other users.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 p-3 bg-sky-900/20 border border-sky-800/30 rounded-xl text-xs text-sky-300 space-y-1">
              <p><strong className="text-sky-200">Clone</strong> — copies schema/fields into your workspace. You upload your own data. Counts against your storage.</p>
              <p><strong className="text-sky-200">Use as Reference</strong> — read-only pointer to the source. Entries are always live from the original. Zero extra storage.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {publicDs.map(d => (
                <PublicDatasetCard key={d.id} dataset={d} busy={busyId === d.id}
                  onClone={() => handleClone(d.id)}
                  onReference={() => handleReference(d.id)}
                />
              ))}
            </div>
          </>
        )
      )}

      {/* Modals / slide-overs */}
      {(showCreate || editTarget) && (
        <DatasetSlideOver
          initial={editTarget ?? undefined}
          onClose={() => { setShowCreate(false); setEditTarget(null) }}
          onSaved={saved => {
            setDatasets(ds => editTarget ? ds.map(d => d.id === saved.id ? saved : d) : [saved, ...ds])
            setShowCreate(false); setEditTarget(null)
          }}
        />
      )}
      {inviteTarget && <InviteModal dataset={inviteTarget} onClose={() => setInviteTarget(null)} />}
      {viewTarget && <EntriesPanel dataset={viewTarget} onClose={() => setViewTarget(null)} />}
      {overviewTarget && <OverviewPanel dataset={overviewTarget} onClose={() => setOverviewTarget(null)} />}
    </div>
  )
}
