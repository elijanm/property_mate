import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Database, Users, ImageIcon, FileText, Hash, Trash2, Mail, ChevronDown, ChevronRight, Copy, Check, X, GripVertical, ToggleLeft, ToggleRight, Eye, EyeOff, ShieldCheck, Globe, Lock, GitFork, Link2, BarChart2, MapPin, TrendingUp, Award, Video, Film, Share2, ExternalLink, UserMinus, RefreshCw, ThumbsUp, ThumbsDown, Phone, Loader2, Download } from 'lucide-react'
import type { DatasetOverview } from '@/types/dataset'
import clsx from 'clsx'
import { datasetsApi } from '@/api/datasets'
import { modelsApi } from '@/api/models'
import { annotatorApi } from '@/api/annotator'
import { walletApi } from '@/api/wallet'
import type { ModelDeployment } from '@/types/trainer'
import type { DatasetProfile, DatasetCollector, DatasetField, DatasetEntry, DatasetEntryListResponse, SimilarDatasetEntry, DatasetCreatePayload, FieldType, CaptureMode, DescriptionMode } from '@/types/dataset'

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
  field: DatasetField
  idx: number
  onChange: (f: DatasetField) => void
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

const BLANK_FIELD = (): DatasetField => ({
  id: '',   // empty = new field, backend assigns UUID on create
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
  const [fields, setFields] = useState<DatasetField[]>(
    initial?.fields ?? [BLANK_FIELD()]
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
  const [requireConsent, setRequireConsent] = useState(initial?.require_consent ?? false)
  const [consentType, setConsentType] = useState<'individual' | 'group'>(
    (initial?.consent_type as 'individual' | 'group') ?? 'individual'
  )
  const [consentTemplateId, setConsentTemplateId] = useState(initial?.consent_template_id ?? '')
  const [consentTemplates, setConsentTemplates] = useState<import('@/types/consent').ConsentTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [platformRate, setPlatformRate] = useState<{ point_value_usd: number; rate_label: string; min_org_balance_usd?: number } | null>(null)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)

  useEffect(() => {
    modelsApi.list({ include_all: true }).then(setDeployments).catch(() => {})
    annotatorApi.getRewardRate().then(r => setPlatformRate(r as any)).catch(() => {})
    walletApi.get().then(w => setWalletBalance(w.balance)).catch(() => {})
    import('@/api/consent').then(m => m.consentApi.listTemplates().then(setConsentTemplates).catch(() => {}))
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
        require_consent: requireConsent,
        consent_type: consentType,
        ...(consentTemplateId.trim() ? { consent_template_id: consentTemplateId.trim() } : {}),
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

          {/* Consent */}
          <div className="border border-gray-700/50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Require Photo Consent</p>
                <p className="text-xs text-gray-400 mt-0.5">Collect signed consent from photo subjects before capturing images</p>
              </div>
              <button onClick={() => setRequireConsent(v => !v)} className="text-gray-400 hover:text-white transition-colors">
                {requireConsent ? <ToggleRight size={28} className="text-indigo-400" /> : <ToggleLeft size={28} />}
              </button>
            </div>
            {requireConsent && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(['individual', 'group'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setConsentType(t)}
                      className={clsx('py-2 px-3 rounded-xl border text-sm capitalize transition-colors',
                        consentType === t ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300' : 'bg-gray-800/50 border-gray-700/50 text-gray-400')}>
                      {t}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5 block">
                    Consent Template <span className="text-gray-600 normal-case font-normal">(optional — uses default if blank)</span>
                  </label>
                  <select value={consentTemplateId} onChange={e => setConsentTemplateId(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="">Use default template</option>
                    {consentTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.type}){t.is_global ? ' — Global' : ''}</option>
                    ))}
                  </select>
                </div>
              </>
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
  const [tab, setTab] = useState<'manual' | 'email'>('manual')
  // Manual add
  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [mPhone, setMPhone] = useState('')
  // Email invite
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState(() => buildDefaultMessage(dataset))

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string>('')
  const [err, setErr] = useState('')

  const addManual = async () => {
    if (!mName.trim() && !mEmail.trim() && !mPhone.trim()) { setErr('Enter at least a name, email, or phone'); return }
    setBusy(true); setErr('')
    try {
      await datasetsApi.addCollector(dataset.id, mName.trim(), mEmail.trim() || undefined, mPhone.trim() || undefined)
      setDone(mName.trim() || mEmail.trim() || mPhone.trim())
    } catch (e: any) {
      setErr(e?.message || 'Failed to add contributor')
    } finally { setBusy(false) }
  }

  const sendInvite = async () => {
    if (!email.trim()) { setErr('Email required'); return }
    setBusy(true); setErr('')
    try {
      await datasetsApi.invite(dataset.id, email.trim(), name.trim(), message.trim())
      setDone(email.trim())
    } catch (e: any) {
      setErr(e?.message || 'Failed to send invite')
    } finally { setBusy(false) }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Add Contributor</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <Check size={32} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-white font-semibold">
              {tab === 'email' ? 'Invite sent!' : 'Contributor added!'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {tab === 'email' ? `Collection link emailed to ${done}` : `${done} can now access their collection link.`}
            </p>
            <div className="flex gap-2 mt-4 justify-center">
              <button onClick={() => { setDone(''); setMName(''); setMEmail(''); setMPhone(''); setEmail(''); setName('') }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg">Add another</button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg">Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Tab switcher */}
            <div className="flex gap-1 bg-gray-800/60 p-1 rounded-xl mb-4">
              <button onClick={() => { setTab('manual'); setErr('') }}
                className={clsx('flex-1 py-2 text-xs font-semibold rounded-lg transition-colors', tab === 'manual' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
                Add Manually
              </button>
              <button onClick={() => { setTab('email'); setErr('') }}
                className={clsx('flex-1 py-2 text-xs font-semibold rounded-lg transition-colors', tab === 'email' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
                <Mail size={11} className="inline mr-1 -mt-0.5" /> Invite via Email
              </button>
            </div>

            {tab === 'manual' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Name</label>
                  <input className={inputCls} placeholder="John Doe" value={mName} onChange={e => setMName(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Email <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                  <input className={inputCls} type="email" placeholder="john@example.com" value={mEmail} onChange={e => setMEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block flex items-center gap-1"><Phone size={10} /> Phone <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                  <input className={inputCls} type="tel" placeholder="+254 700 000 000" value={mPhone} onChange={e => setMPhone(e.target.value)} />
                </div>
                <p className="text-[10px] text-gray-600">A unique collection link is generated — share it from the Contributors panel.</p>
                {err && <p className="text-xs text-red-400">{err}</p>}
                <button onClick={addManual} disabled={busy}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2">
                  {busy ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : <><Users size={14} /> Add Contributor</>}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Email *</label>
                  <input className={inputCls} placeholder="collector@example.com" type="email" value={email}
                    onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendInvite()} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Name <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                  <input className={inputCls} placeholder="John Doe" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Message</label>
                  <textarea rows={6} className={inputCls + ' resize-none'} value={message} onChange={e => setMessage(e.target.value)} />
                  <p className="text-[10px] text-gray-600 mt-0.5">Appears in the email above the contribution link.</p>
                </div>
                {err && <p className="text-xs text-red-400">{err}</p>}
                <button onClick={sendInvite} disabled={busy}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2">
                  {busy ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Mail size={14} /> Send Invite</>}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Contributors panel ────────────────────────────────────────────────────────

function CollectorsPanel({ dataset, onClose, onInvite }: {
  dataset: DatasetProfile
  onClose: () => void
  onInvite: () => void
}) {
  const [collectors, setCollectors] = useState<DatasetCollector[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const collectUrl = (token: string) => `${window.location.origin}/collect/${token}`

  const load = () => {
    setLoading(true)
    datasetsApi.listCollectors(dataset.id).then(setCollectors).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [dataset.id])

  const copy = async (token: string, id: string) => {
    await navigator.clipboard.writeText(collectUrl(token))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const share = async (collector: DatasetCollector) => {
    const url = collectUrl(collector.token)
    if (navigator.share) {
      await navigator.share({
        title: `Contribute to ${dataset.name}`,
        text: `Hi ${collector.name || collector.email}, here's your link to contribute data to "${dataset.name}":`,
        url,
      }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(url)
      setCopiedId(collector.id + '_share')
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  const remove = async (collector: DatasetCollector) => {
    if (!confirm(`Remove ${collector.name || collector.email} from this dataset?`)) return
    setRemovingId(collector.id)
    try {
      await datasetsApi.removeCollector(dataset.id, collector.id)
      setCollectors(cs => cs.filter(c => c.id !== collector.id))
    } finally { setRemovingId(null) }
  }

  const STATUS_BADGE: Record<string, string> = {
    pending:   'bg-amber-900/40 text-amber-400 border-amber-800/40',
    active:    'bg-emerald-900/40 text-emerald-400 border-emerald-800/40',
    completed: 'bg-gray-700/40 text-gray-400 border-gray-600/40',
  }

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Contributors</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[280px]">{dataset.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} title="Refresh" className="text-gray-500 hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
              <RefreshCw size={14} />
            </button>
            <button onClick={onInvite}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors">
              <Mail size={12} /> Invite
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-xs text-gray-500 py-16">Loading…</div>
          ) : collectors.length === 0 ? (
            <div className="text-center py-16 px-6">
              <Users size={36} className="text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-400 font-semibold">No contributors yet</p>
              <p className="text-xs text-gray-600 mt-1">Invite someone to start collecting data.</p>
              <button onClick={onInvite}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg mx-auto transition-colors">
                <Mail size={13} /> Send Invite
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {collectors.map(c => {
                const url = collectUrl(c.token)
                const isCopied = copiedId === c.id
                const isShareCopied = copiedId === c.id + '_share'
                return (
                  <li key={c.id} className="px-5 py-4 hover:bg-gray-800/30 transition-colors">
                    {/* Name + status */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {c.name || c.email}
                        </p>
                        {c.name && <p className="text-xs text-gray-500 truncate">{c.email}</p>}
                      </div>
                      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide ml-3 shrink-0', STATUS_BADGE[c.status] ?? STATUS_BADGE.pending)}>
                        {c.status}
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-3">
                      <span>{c.entry_count} entr{c.entry_count === 1 ? 'y' : 'ies'}</span>
                      {c.points_earned > 0 && <span className="text-amber-400">🎁 {c.points_earned} pts</span>}
                      {c.last_active_at && (
                        <span>Active {new Date(c.last_active_at).toLocaleDateString()}</span>
                      )}
                    </div>

                    {/* Collect URL */}
                    <div className="flex items-center gap-1.5 bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 mb-3">
                      <ExternalLink size={11} className="text-gray-500 shrink-0" />
                      <span className="text-[11px] text-gray-400 font-mono truncate flex-1 min-w-0">{url}</span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copy(c.token, c.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors flex-1 justify-center">
                        {isCopied ? <><Check size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy URL</>}
                      </button>
                      <button
                        onClick={() => share(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-800/40 text-indigo-400 text-xs rounded-lg transition-colors flex-1 justify-center">
                        {isShareCopied ? <><Check size={12} className="text-emerald-400" /> Copied!</> : <><Share2 size={12} /> Share</>}
                      </button>
                      <button
                        onClick={() => remove(c)}
                        disabled={removingId === c.id}
                        title="Remove contributor"
                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40">
                        <UserMinus size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer summary */}
        {collectors.length > 0 && (
          <div className="shrink-0 px-5 py-3 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-500">
            <span>{collectors.length} contributor{collectors.length !== 1 ? 's' : ''}</span>
            <span>{collectors.filter(c => c.status === 'active').length} active</span>
            <span>{collectors.reduce((s, c) => s + c.entry_count, 0)} total entries</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dataset card ─────────────────────────────────────────────────────────────

function DatasetCard({
  dataset, onEdit, onDelete, onInvite, onView, onOverview, onVisibilityToggle, onContributors,
}: {
  dataset: DatasetProfile
  onEdit: () => void
  onDelete: () => void
  onInvite: () => void
  onView: () => void
  onOverview: () => void
  onVisibilityToggle: (v: 'private' | 'public') => void
  onContributors: () => void
}) {
  const isRef   = dataset.reference_type === 'reference'
  const isClone = dataset.reference_type === 'clone'
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloading) return
    setDownloading(true)
    try {
      await datasetsApi.exportCsv(dataset.id, `${dataset.slug ?? dataset.name}_entries`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative group bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5 hover:border-gray-600/50 transition-colors">
      {/* Download on hover */}
      <button
        onClick={handleDownload}
        disabled={downloading}
        title="Download entries as CSV"
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] bg-gray-700/90 hover:bg-indigo-700 border border-gray-600 hover:border-indigo-600 text-gray-300 hover:text-white rounded-lg transition-all disabled:opacity-40 z-10"
      >
        {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        {downloading ? 'Exporting…' : 'Download'}
      </button>
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
        <button onClick={onContributors}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
          <Users size={11} /> {dataset.collectors?.length ?? 0}
        </button>
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
  dataset, onClone, onReference, onViewEntries, busy,
}: {
  dataset: DatasetProfile
  onClone: () => void
  onReference: () => void
  onViewEntries: () => void
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

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onViewEntries}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 border border-gray-600/50 text-gray-300 text-xs rounded-lg transition-colors">
          <Eye size={11} /> Browse
        </button>
        <button onClick={onClone} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 border border-teal-700/40 text-teal-400 text-xs rounded-lg transition-colors disabled:opacity-50">
          <GitFork size={11} /> Clone
        </button>
        <button onClick={onReference} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-700/40 text-purple-400 text-xs rounded-lg transition-colors disabled:opacity-50">
          <Link2 size={11} /> Reference
        </button>
      </div>
    </div>
  )
}

// ── Read-only entry viewer for public datasets ────────────────────────────────

function PublicDatasetEntriesViewer({
  dataset, onClose,
}: {
  dataset: DatasetProfile
  onClose: () => void
}) {
  const [entries, setEntries]   = useState<DatasetEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [total, setTotal]       = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]         = useState(1)
  const PAGE_SIZE = 48

  const [filterField, setFilterField]       = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo]     = useState('')
  const [lightbox, setLightbox]             = useState<DatasetEntry | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    datasetsApi.getEntries(dataset.id, {
      field_id: filterField || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      page,
      page_size: PAGE_SIZE,
    }).then(r => {
      setEntries(r.items)
      setTotal(r.total)
      setTotalPages(r.total_pages)
    }).finally(() => setLoading(false))
  }, [dataset.id, filterField, filterDateFrom, filterDateTo, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filterField, filterDateFrom, filterDateTo])

  const resolveFileUrl = (url: string | null | undefined): string | null => {
    if (!url) return null
    if (url.startsWith('/api/')) {
      const token = localStorage.getItem('ml_token') ?? ''
      return `${url}?token=${encodeURIComponent(token)}`
    }
    return url
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-4xl bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-gray-800 bg-gray-900">
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 transition-colors">
            <X size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{dataset.name}</h2>
            <p className="text-[11px] text-gray-500">
              {loading ? '…' : `${total} entr${total === 1 ? 'y' : 'ies'}`} · read-only
            </p>
          </div>
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-900/50 border border-sky-800/50 text-sky-400 font-semibold">
            <Globe size={9} /> Public
          </span>
        </div>

        {/* Filters */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 bg-gray-900/50 flex-wrap">
          <select
            value={filterField}
            onChange={e => setFilterField(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500">
            <option value="">All fields</option>
            {dataset.fields.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
            placeholder="From"
          />
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
            placeholder="To"
          />
          {(filterField || filterDateFrom || filterDateTo) && (
            <button
              onClick={() => { setFilterField(''); setFilterDateFrom(''); setFilterDateTo('') }}
              className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
              Clear
            </button>
          )}
          <span className="ml-auto text-[10px] text-gray-600 italic">Browsing only — entries cannot be modified</span>
        </div>

        {/* Entry grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="text-indigo-400 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Database size={32} className="text-gray-700 mb-3" />
              <p className="text-sm text-gray-400 font-medium">No entries{(filterField || filterDateFrom || filterDateTo) ? ' matching filters' : ' yet'}</p>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {entries.map(e => {
                const isImage = e.file_mime?.startsWith('image/')
                const isVideo = e.file_mime?.startsWith('video/')
                const furl = resolveFileUrl(e.file_url)
                return (
                  <div
                    key={e.id}
                    onClick={() => furl && isImage && setLightbox(e)}
                    className={clsx(
                      'relative rounded-xl overflow-hidden border border-transparent hover:border-gray-600 transition-all',
                      furl && isImage ? 'cursor-zoom-in' : 'cursor-default',
                    )}>
                    <div className="aspect-square bg-gray-800">
                      {furl && isImage ? (
                        <img src={furl} alt="" className="w-full h-full object-cover" />
                      ) : furl && isVideo ? (
                        <div className="relative w-full h-full bg-black flex items-center justify-center">
                          <video src={furl} className="w-full h-full object-contain" preload="metadata" muted playsInline />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                              <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 translate-x-0.5"><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          </div>
                        </div>
                      ) : furl ? (
                        <div className="flex flex-col items-center justify-center h-full gap-1">
                          <FileText size={20} className="text-gray-500" />
                          <span className="text-[10px] text-gray-600">{e.file_mime?.split('/')[1]?.toUpperCase() ?? 'File'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full p-2">
                          <p className="text-[10px] text-gray-400 text-center line-clamp-4">{e.text_value ?? '—'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-gray-800 text-xs text-gray-500">
            <span>{total} entries</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors">
                ← Prev
              </button>
              <span>{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors">
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Lightbox */}
        {lightbox && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/90"
            onClick={() => setLightbox(null)}>
            <img
              src={resolveFileUrl(lightbox.file_url) ?? ''}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors">
              <X size={18} />
            </button>
          </div>
        )}
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

// ── Dataset Workspace (full-screen AnnotatePage-style) ────────────────────────

function DatasetWorkspace({ dataset, onClose }: { dataset: DatasetProfile; onClose: () => void }) {
  const [entries, setEntries]             = useState<DatasetEntry[]>([])
  const [collectors, setCollectors]       = useState<DatasetCollector[]>([])
  const [loading, setLoading]             = useState(true)
  const [total, setTotal]                 = useState(0)
  const [page, setPage]                   = useState(1)
  const [totalPages, setTotalPages]       = useState(1)
  const [archivedCount, setArchivedCount] = useState(0)
  const PAGE_SIZE = 48

  const [selectedEntry, setSelectedEntry] = useState<DatasetEntry | null>(null)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())

  const [filterField, setFilterField]         = useState('')
  const [filterCollector, setFilterCollector] = useState('')
  const [filterDateFrom, setFilterDateFrom]   = useState('')
  const [filterDateTo, setFilterDateTo]       = useState('')
  const [filterQuality, setFilterQuality]     = useState('')
  const [filterReview, setFilterReview]       = useState('')
  const [showArchived, setShowArchived]       = useState(false)

  const [actingId, setActingId]   = useState<string | null>(null)
  const [lightbox, setLightbox]   = useState<DatasetEntry | null>(null)
  const [similarPanel, setSimilarPanel] = useState<{
    entry: DatasetEntry; results: SimilarDatasetEntry[]; loading: boolean
  } | null>(null)
  const [exportModal, setExportModal] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [showUploadPicker, setShowUploadPicker] = useState(false)
  const [uploadPickerField, setUploadPickerField] = useState<DatasetField | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const fileFields = dataset.fields.filter(f => ['image', 'video', 'media', 'file'].includes(f.type))

  const openUpload = (field: DatasetField) => {
    setUploadPickerField(field)
    setShowUploadPicker(false)
    // accept based on field type
    const accept = field.type === 'image' ? 'image/*' : field.type === 'video' ? 'video/*' : '*/*'
    if (uploadRef.current) {
      uploadRef.current.accept = accept
      uploadRef.current.value = ''
      uploadRef.current.click()
    }
  }

  const handleBulkUpload = async (files: FileList) => {
    if (!uploadPickerField || files.length === 0) return
    const field = uploadPickerField
    setUploadProgress({ done: 0, total: files.length })
    let done = 0
    for (const file of Array.from(files)) {
      try {
        await datasetsApi.uploadEntryDirect(dataset.id, field.id, file)
      } catch { /* skip failed file, continue */ }
      done++
      setUploadProgress({ done, total: files.length })
    }
    setUploadProgress(null)
    load()
    if (uploadRef.current) uploadRef.current.value = ''
  }

  const load = useCallback(() => {
    setLoading(true)
    datasetsApi.getEntries(dataset.id, {
      field_id: filterField || undefined,
      collector_id: filterCollector || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      quality: filterQuality || undefined,
      review_status: filterReview || undefined,
      include_archived: showArchived,
      page,
      page_size: PAGE_SIZE,
    }).then(r => {
      setEntries(r.items)
      setTotal(r.total)
      setTotalPages(r.total_pages)
      setArchivedCount(r.archived_count)
      // keep selected entry in sync
      setSelectedEntry(prev => prev ? (r.items.find(e => e.id === prev.id) ?? prev) : null)
    }).finally(() => setLoading(false))
  }, [dataset.id, filterField, filterCollector, filterDateFrom, filterDateTo,
      filterQuality, filterReview, showArchived, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filterField, filterCollector, filterDateFrom, filterDateTo, filterQuality, filterReview, showArchived])
  useEffect(() => {
    datasetsApi.listCollectors(dataset.id).then(setCollectors).catch(() => {})
  }, [dataset.id])

  const fieldName  = (id: string) => dataset.fields.find(f => f.id === id)?.label ?? `Field (${id.slice(0, 8)}…)`
  const collectorName = (id: string) => {
    if (id === '__admin__') return 'Admin'
    const c = collectors.find(c => c.id === id)
    return c?.name || c?.email || `Contributor (${id.slice(0, 8)}…)`
  }

  const hasFilter = filterField || filterCollector || filterDateFrom || filterDateTo || filterQuality || filterReview
  const clearFilters = () => {
    setFilterField(''); setFilterCollector(''); setFilterDateFrom(''); setFilterDateTo('')
    setFilterQuality(''); setFilterReview('')
  }


  const resolveFileUrl = (url: string | null | undefined): string | null => {
    if (!url) return null
    if (url.startsWith('/api/')) {
      const token = localStorage.getItem('ml_token') ?? ''
      return `${url}?token=${encodeURIComponent(token)}`
    }
    return url
  }

  const toggleSelect = (id: string) => setSelectedIds(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(entries.map(e => e.id)))
  }

  const doReview = async (entry: DatasetEntry, status: 'approved' | 'rejected') => {
    setActingId(entry.id)
    try {
      const updated = await datasetsApi.reviewEntry(dataset.id, entry.id, status)
      setEntries(es => es.map(x => x.id === entry.id ? updated : x))
      setSelectedEntry(updated)
    } finally { setActingId(null) }
  }

  const doArchive = async (entry: DatasetEntry, archived: boolean) => {
    setActingId(entry.id)
    try {
      const updated = await datasetsApi.archiveEntry(dataset.id, entry.id, archived)
      if (showArchived) {
        setEntries(es => es.map(x => x.id === entry.id ? updated : x))
        setSelectedEntry(updated)
      } else {
        setEntries(es => es.filter(x => x.id !== entry.id))
        setArchivedCount(c => archived ? c + 1 : Math.max(0, c - 1))
        setSelectedEntry(null)
      }
    } finally { setActingId(null) }
  }

  const doDelete = async (entry: DatasetEntry) => {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    setActingId(entry.id)
    try {
      await datasetsApi.deleteEntry(dataset.id, entry.id)
      setEntries(es => es.filter(x => x.id !== entry.id))
      if (selectedEntry?.id === entry.id) setSelectedEntry(null)
    } finally { setActingId(null) }
  }

  const doFindSimilar = async (entry: DatasetEntry) => {
    setSimilarPanel({ entry, results: [], loading: true })
    try {
      const results = await datasetsApi.findSimilarEntries(dataset.id, entry.id)
      setSimilarPanel({ entry, results, loading: false })
    } catch {
      setSimilarPanel({ entry, results: [], loading: false })
    }
  }

  const QUALITY_FILTERS = [
    { value: '', label: 'All quality' },
    { value: 'good', label: 'Good' },
    { value: 'poor', label: 'Poor' },
    { value: 'blurry', label: 'Blurry' },
    { value: 'dark', label: 'Dark' },
    { value: 'overexposed', label: 'Overexposed' },
    { value: 'low_res', label: 'Low res' },
    { value: 'duplicate', label: 'Duplicates' },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
      {/* ── Top bar ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900">
        <button onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors">
          <ChevronRight size={13} className="rotate-180" /> Back
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-white truncate">{dataset.name}</span>
          <span className="ml-3 text-[11px] text-gray-500">
            {loading ? '…' : `${total} entr${total === 1 ? 'y' : 'ies'}`}
            {archivedCount > 0 && ` · ${archivedCount} archived`}
          </span>
        </div>
        <button
          onClick={() => setShowArchived(s => !s)}
          className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
            showArchived
              ? 'bg-amber-900/40 border-amber-700/60 text-amber-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white')}>
          📦 {showArchived ? 'Archived' : `Archive (${archivedCount})`}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={() => setExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
            <ExternalLink size={13} /> Export {selectedIds.size} to Annotation
          </button>
        )}
        {selectedIds.size === 0 && (
          <button onClick={() => setExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium transition-colors">
            <ExternalLink size={13} /> Export All
          </button>
        )}
        <button onClick={() => datasetsApi.exportCsv(dataset.id, dataset.name)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium transition-colors">
          <Download size={13} /> CSV
        </button>
        {fileFields.length > 0 && (
          <>
            <input ref={uploadRef} type="file" multiple className="hidden"
              onChange={e => e.target.files && handleBulkUpload(e.target.files)} />
            <button
              onClick={() => fileFields.length === 1 ? openUpload(fileFields[0]) : setShowUploadPicker(true)}
              disabled={!!uploadProgress}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-60 border border-indigo-600 text-white text-xs font-medium transition-colors">
              {uploadProgress
                ? <><Loader2 size={13} className="animate-spin" /> {uploadProgress.done}/{uploadProgress.total}</>
                : <><Plus size={13} /> Upload</>
              }
            </button>
          </>
        )}
      </div>

      {/* ── Filter row ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/70 flex-wrap">
        <select value={filterField} onChange={e => setFilterField(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
          <option value="">All fields</option>
          {dataset.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <select value={filterCollector} onChange={e => setFilterCollector(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
          <option value="">All collectors</option>
          {collectors.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}
        </select>
        <select value={filterReview} onChange={e => setFilterReview(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filterQuality} onChange={e => setFilterQuality(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500">
          {QUALITY_FILTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
        </select>
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
        <span className="text-gray-600 text-xs">—</span>
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
        {hasFilter && (
          <button onClick={clearFilters}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-white px-2 py-1 rounded transition-colors">
            <X size={10} /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === entries.length}
              onChange={toggleSelectAll}
              className="accent-indigo-500" />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </label>
        </div>
      </div>

      {/* ── Body: left sidebar + center grid ── */}
      <div className="flex-1 flex min-h-0">

        {/* Left sidebar */}
        <div className="w-72 shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col overflow-y-auto">
          {selectedEntry ? (
            <EntryInfoPanel
              entry={selectedEntry}
              dataset={dataset}
              collectors={collectors}
              fieldName={fieldName}
              collectorName={collectorName}
              resolveFileUrl={resolveFileUrl}
              actingId={actingId}
              onReview={doReview}
              onArchive={doArchive}
              onDelete={doDelete}
              onFindSimilar={doFindSimilar}
              onLightbox={() => setLightbox(selectedEntry)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <ImageIcon size={32} className="text-gray-700 mb-3" />
              <p className="text-xs text-gray-500 font-medium">Select an entry</p>
              <p className="text-[11px] text-gray-600 mt-1">Click any thumbnail to view details</p>
            </div>
          )}
        </div>

        {/* Center: entry grid */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={24} className="text-indigo-400 animate-spin" />
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Database size={32} className="text-gray-700 mb-3" />
                <p className="text-sm text-gray-400 font-medium">No entries{hasFilter ? ' matching filters' : ' yet'}</p>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {entries.map(e => {
                  const isImage = e.file_mime?.startsWith('image/')
                  const isVideo = e.file_mime?.startsWith('video/')
                  const furl = resolveFileUrl(e.file_url)
                  const isSel = selectedEntry?.id === e.id
                  const isChecked = selectedIds.has(e.id)

                  return (
                    <div
                      key={e.id}
                      onClick={() => setSelectedEntry(e)}
                      className={clsx(
                        'relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all',
                        isSel ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-transparent hover:border-gray-600',
                        e.archived && 'opacity-60',
                      )}>
                      <div className="aspect-square bg-gray-800">
                        {furl && isImage ? (
                          <img src={furl} alt="" className="w-full h-full object-cover" />
                        ) : furl && isVideo ? (
                          <div className="relative w-full h-full bg-black flex items-center justify-center">
                            <video src={furl} className="w-full h-full object-contain" preload="metadata" muted playsInline />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4 translate-x-0.5"><path d="M8 5v14l11-7z"/></svg>
                              </div>
                            </div>
                          </div>
                        ) : furl ? (
                          <div className="flex flex-col items-center justify-center h-full gap-1">
                            <FileText size={24} className="text-gray-500" />
                            <span className="text-[10px] text-gray-600">{e.file_mime?.split('/')[1]?.toUpperCase() ?? 'File'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full p-2">
                            <p className="text-[10px] text-gray-400 text-center line-clamp-4">{e.text_value ?? '—'}</p>
                          </div>
                        )}
                      </div>

                      {/* Checkbox */}
                      <div className="absolute top-1.5 left-1.5 pointer-events-none">
                        <div className={clsx(
                          'w-4 h-4 rounded border flex items-center justify-center',
                          isChecked ? 'bg-indigo-500 border-indigo-500' : 'bg-black/50 border-white/40'
                        )}>
                          {isChecked && <Check size={10} className="text-white" />}
                        </div>
                      </div>
                      <div className="absolute top-0 left-0 w-6 h-6 cursor-pointer z-10"
                        onClick={ev => { ev.stopPropagation(); toggleSelect(e.id) }} />

                      {/* Review badge */}
                      {e.review_status !== 'pending' && (
                        <div className={clsx(
                          'absolute top-1.5 right-1.5 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded shadow',
                          e.review_status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                        )}>{e.review_status === 'approved' ? '✓' : '✗'}</div>
                      )}

                      {/* Quality badge */}
                      {e.quality_score != null && (
                        <div className={clsx(
                          'absolute bottom-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded shadow',
                          e.quality_score >= 70 ? 'bg-emerald-700/90 text-emerald-100'
                          : e.quality_score >= 40 ? 'bg-amber-700/90 text-amber-100'
                          : 'bg-red-700/90 text-red-100'
                        )}>Q{e.quality_score}</div>
                      )}

                      {filterQuality === 'duplicate' && (
                        <div className="absolute bottom-1.5 left-1.5 text-[9px] bg-purple-700/90 text-purple-100 px-1.5 py-0.5 rounded shadow font-bold">DUP</div>
                      )}

                      {e.archived && (
                        <div className="absolute bottom-1.5 left-1.5 text-[9px] bg-amber-700/90 text-amber-100 px-1.5 py-0.5 rounded shadow">📦</div>
                      )}

                      <div className="px-2 py-1.5 bg-gray-900/80">
                        <p className="text-[10px] text-indigo-400 font-medium truncate">{fieldName(e.field_id)}</p>
                        <p className="text-[9px] text-gray-500 truncate">{collectorName(e.collector_id)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-center gap-1 py-3 border-t border-gray-800 bg-gray-900/50">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                const pg = start + i
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={clsx('w-7 h-7 rounded text-xs font-medium transition-colors',
                      pg === page ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800')}>
                    {pg}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30 transition-colors">»</button>
              <span className="ml-2 text-[11px] text-gray-600">
                Page {page} of {totalPages} · {total} total
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Upload field picker ── */}
      {showUploadPicker && (
        <div className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center bg-black/60"
          onClick={() => setShowUploadPicker(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 mb-4 sm:mb-0"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-white">Choose Field to Upload Into</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Select which field your files belong to</p>
              </div>
              <button onClick={() => setShowUploadPicker(false)}
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={15} /></button>
            </div>
            <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
              {fileFields.map(f => (
                <button key={f.id} onClick={() => openUpload(f)}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-800/60 hover:bg-indigo-900/40 border border-gray-700/50 hover:border-indigo-600/60 text-left transition-all group">
                  <div className={clsx('mt-0.5 p-1.5 rounded-lg shrink-0',
                    f.type === 'image' ? 'bg-sky-900/50' : f.type === 'video' ? 'bg-rose-900/50' : 'bg-purple-900/50')}>
                    {f.type === 'image' ? <ImageIcon size={13} className="text-sky-400" />
                    : f.type === 'video' ? <Video size={13} className="text-rose-400" />
                    : <FileText size={13} className="text-purple-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-white font-medium group-hover:text-indigo-300 transition-colors">{f.label}</span>
                      <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{f.type}</span>
                      {f.required && <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-red-900/50 text-red-400">required</span>}
                    </div>
                    {f.instruction && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{f.instruction}</p>}
                    {f.capture_mode !== 'both' && (
                      <p className="text-[10px] text-amber-500 mt-0.5">
                        {f.capture_mode === 'camera_only' ? '📷 Camera only' : '⬆️ Upload only'}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-gray-600 group-hover:text-indigo-400 shrink-0 mt-1 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Similar entries slide-over ── */}
      {similarPanel && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1" onClick={() => setSimilarPanel(null)} />
          <div className="w-full max-w-sm bg-gray-900 border-l border-gray-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-white">Similar Images</h3>
                <p className="text-xs text-gray-500 mt-0.5">Perceptual hash similarity (dHash)</p>
              </div>
              <button onClick={() => setSimilarPanel(null)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {similarPanel.loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="text-indigo-400 animate-spin mr-2" />
                  <span className="text-xs text-gray-500">Scanning…</span>
                </div>
              ) : similarPanel.results.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-xs text-gray-500">No similar images found</p>
                </div>
              ) : (
                similarPanel.results.map(s => {
                  const furl = resolveFileUrl(s.file_url)
                  return (
                    <div key={s.id}
                      className="flex items-center gap-3 p-2 rounded-xl bg-gray-800/60 border border-gray-700/50 cursor-pointer hover:border-indigo-500/50 transition-colors"
                      onClick={() => { setSelectedEntry(s); setSimilarPanel(null) }}>
                      {furl && s.file_mime?.startsWith('image/') ? (
                        <img src={furl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-gray-700 flex items-center justify-center shrink-0">
                          <FileText size={18} className="text-gray-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-white font-medium">{fieldName(s.field_id)}</p>
                        <p className="text-[10px] text-gray-400 truncate">{collectorName(s.collector_id)}</p>
                        <p className={clsx('text-[10px] font-semibold mt-0.5',
                          s.similarity_pct >= 90 ? 'text-red-400' : s.similarity_pct >= 70 ? 'text-amber-400' : 'text-emerald-400')}>
                          {s.similarity_pct}% similar
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button onClick={ev => { ev.stopPropagation(); doArchive(s, true) }}
                          className="text-[10px] px-2 py-1 rounded bg-amber-900/40 text-amber-300 hover:bg-amber-900/60 transition-colors">
                          Archive
                        </button>
                        <button onClick={ev => { ev.stopPropagation(); doDelete(s) }}
                          className="text-[10px] px-2 py-1 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors">
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" onClick={() => setLightbox(null)}>
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/10" onClick={e => e.stopPropagation()}>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{fieldName(lightbox.field_id)}</p>
              <p className="text-xs text-gray-400 truncate">{collectorName(lightbox.collector_id)} · {new Date(lightbox.captured_at).toLocaleString()}</p>
            </div>
            <button onClick={() => setLightbox(null)} className="text-gray-400 hover:text-white transition-colors ml-4"><X size={18} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0" onClick={e => e.stopPropagation()}>
            {lightbox.file_mime?.startsWith('video/') ? (
              <video src={resolveFileUrl(lightbox.file_url) ?? undefined} controls autoPlay playsInline
                className="max-w-full max-h-full rounded-lg" style={{ maxHeight: 'calc(100vh - 140px)' }} />
            ) : (
              <img src={resolveFileUrl(lightbox.file_url) ?? undefined} alt=""
                className="max-w-full max-h-full rounded-lg object-contain" style={{ maxHeight: 'calc(100vh - 140px)' }} />
            )}
          </div>
        </div>
      )}

      {exportModal && (
        <ExportToAnnotationModal
          dataset={dataset}
          entryIds={selectedIds.size > 0 ? Array.from(selectedIds) : undefined}
          onClose={() => setExportModal(false)}
        />
      )}
    </div>
  )
}

// ── Entry info panel (left sidebar) ───────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const visible = local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`
}

function EntryInfoPanel({
  entry, dataset, collectors, fieldName, collectorName, resolveFileUrl,
  actingId, onReview, onArchive, onDelete, onFindSimilar, onLightbox,
}: {
  entry: DatasetEntry
  dataset: DatasetProfile
  collectors: DatasetCollector[]
  fieldName: (id: string) => string
  collectorName: (id: string) => string
  resolveFileUrl: (url?: string | null) => string | null
  actingId: string | null
  onReview: (entry: DatasetEntry, status: 'approved' | 'rejected') => void
  onArchive: (entry: DatasetEntry, archived: boolean) => void
  onDelete: (entry: DatasetEntry) => void
  onFindSimilar: (entry: DatasetEntry) => void
  onLightbox: () => void
}) {
  const [tab, setTab] = useState<'details' | 'quality'>('details')
  const busy = actingId === entry.id
  const furl = resolveFileUrl(entry.file_url)
  const isImage = entry.file_mime?.startsWith('image/')
  const isVideo = entry.file_mime?.startsWith('video/')
  const collector = collectors.find(c => c.id === entry.collector_id)
  const hasQuality = entry.quality_score != null || entry.blur_score != null || entry.brightness != null || entry.quality_issues.length > 0 || !!entry.phash

  return (
    <div className="flex flex-col h-full">
      {/* Thumbnail */}
      <div className="shrink-0 relative bg-black cursor-pointer" onClick={onLightbox}>
        {furl && isImage ? (
          <img src={furl} alt="" className="w-full h-44 object-cover" />
        ) : furl && isVideo ? (
          <div className="relative h-44 bg-black flex items-center justify-center">
            <video src={furl} className="w-full h-full object-contain" preload="metadata" muted playsInline />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 translate-x-0.5"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-44 bg-gray-800 flex flex-col items-center justify-center gap-2">
            <FileText size={28} className="text-gray-500" />
            {entry.text_value && <p className="text-xs text-gray-400 px-4 text-center line-clamp-4">{entry.text_value}</p>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex gap-1.5 px-3 py-2.5 border-b border-gray-800 flex-wrap">
        <button onClick={() => onReview(entry, 'approved')}
          disabled={busy || entry.review_status === 'approved'}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-800/50 hover:bg-emerald-700/60 text-emerald-300 text-[11px] font-medium disabled:opacity-40 transition-colors">
          <ThumbsUp size={11} /> Approve
        </button>
        <button onClick={() => onReview(entry, 'rejected')}
          disabled={busy || entry.review_status === 'rejected'}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/50 text-red-400 text-[11px] font-medium disabled:opacity-40 transition-colors">
          <ThumbsDown size={11} /> Reject
        </button>
        <button onClick={() => onFindSimilar(entry)}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-900/40 hover:bg-sky-800/50 text-sky-300 text-[11px] font-medium transition-colors">
          🔍 Similar
        </button>
        <button onClick={() => onArchive(entry, !entry.archived)}
          disabled={busy}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 text-amber-300 text-[11px] font-medium disabled:opacity-40 transition-colors">
          {entry.archived ? '📤 Unarchive' : '📦 Archive'}
        </button>
        <button onClick={() => onDelete(entry)}
          disabled={busy}
          className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-400 hover:text-red-400 text-[11px] font-medium disabled:opacity-40 transition-colors">
          <Trash2 size={11} />
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-gray-800">
        {(['details', 'quality'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('flex-1 py-2 text-[11px] font-medium transition-colors',
              tab === t
                ? 'text-indigo-400 border-b-2 border-indigo-500 -mb-px'
                : 'text-gray-500 hover:text-gray-300')}>
            {t === 'details' ? 'Details' : 'Quality'}
            {t === 'quality' && hasQuality && entry.quality_score != null && (
              <span className={clsx('ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded',
                entry.quality_score >= 70 ? 'bg-emerald-900/60 text-emerald-400'
                : entry.quality_score >= 40 ? 'bg-amber-900/60 text-amber-400'
                : 'bg-red-900/60 text-red-400')}>
                {entry.quality_score}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[11px]">
        {tab === 'details' ? (
          <>
            <div>
              <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Field</p>
              <p className="text-indigo-400 font-medium">{fieldName(entry.field_id)}</p>
            </div>

            <div>
              <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Review Status</p>
              <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                entry.review_status === 'approved' ? 'bg-emerald-900/50 text-emerald-400'
                : entry.review_status === 'rejected' ? 'bg-red-900/50 text-red-400'
                : 'bg-gray-800 text-gray-400')}>
                {entry.review_status}
              </span>
              {entry.review_note && <p className="text-gray-400 mt-1 text-[10px]">{entry.review_note}</p>}
            </div>

            <div>
              <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-1">Collector</p>
              <p className="text-white font-medium">{collectorName(entry.collector_id)}</p>
              {collector?.email && <p className="text-gray-500 mt-0.5 font-mono">{maskEmail(collector.email)}</p>}
              {collector?.phone && <p className="text-gray-500">{'*'.repeat(6) + collector.phone.slice(-3)}</p>}
              {collector && (
                <div className="flex gap-2 mt-1">
                  <span className={clsx('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                    collector.status === 'active' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500')}>
                    {collector.status}
                  </span>
                  <span className="text-gray-600">{collector.entry_count} entries</span>
                  {collector.points_earned > 0 && <span className="text-amber-500">+{collector.points_earned} pts</span>}
                </div>
              )}
            </div>

            <div>
              <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Captured At</p>
              <p className="text-gray-300">{new Date(entry.captured_at).toLocaleString()}</p>
            </div>

            {entry.description && (
              <div>
                <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Description</p>
                <p className="text-gray-300">{entry.description}</p>
              </div>
            )}

            {entry.points_awarded > 0 && (
              <div>
                <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Points</p>
                <p className="text-amber-400 font-semibold">+{entry.points_awarded} pts</p>
              </div>
            )}

            {(entry.file_mime || entry.file_size_bytes != null) && (
              <div>
                <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-0.5">File</p>
                {entry.file_mime && <p className="text-gray-400">{entry.file_mime}</p>}
                {entry.file_size_bytes != null && (
                  <p className="text-gray-500">{(entry.file_size_bytes / 1024).toFixed(1)} KB</p>
                )}
              </div>
            )}

            {entry.location && (entry.location.lat != null || entry.location.country) && (
              <div>
                <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
                  <MapPin size={9} /> Location
                  <span className="normal-case text-gray-600 font-normal ml-1">({entry.location.source})</span>
                </p>
                {entry.location.lat != null && (
                  <p className="text-gray-400 font-mono text-[10px]">{entry.location.lat.toFixed(5)}, {entry.location.lng?.toFixed(5)}</p>
                )}
                {entry.location.accuracy != null && (
                  <p className="text-gray-500">±{entry.location.accuracy.toFixed(0)}m</p>
                )}
                {entry.location.country_name && (
                  <p className="text-gray-300">{entry.location.city ? `${entry.location.city}, ` : ''}{entry.location.country_name}</p>
                )}
                {entry.location.timezone && <p className="text-gray-500">{entry.location.timezone}</p>}
                {entry.location.isp && <p className="text-gray-600 truncate">{entry.location.isp}</p>}
              </div>
            )}
          </>
        ) : (
          <>
            {hasQuality ? (
              <>
                {/* Grade + score */}
                {entry.quality_score != null && (() => {
                  const score = entry.quality_score
                  const issues = entry.quality_issues
                  // Derive a human label — prefer the specific issue if any, else score-based
                  const grade =
                    issues.includes('blurry') ? { label: 'Blurry', cls: 'bg-orange-900/60 text-orange-300 border-orange-700/60' }
                    : issues.includes('dark') ? { label: 'Too Dark', cls: 'bg-blue-900/60 text-blue-300 border-blue-700/60' }
                    : issues.includes('overexposed') ? { label: 'Overexposed', cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/60' }
                    : issues.includes('low_res') ? { label: 'Low Res', cls: 'bg-purple-900/60 text-purple-300 border-purple-700/60' }
                    : score >= 70 ? { label: 'Good', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60' }
                    : score >= 40 ? { label: 'Fair', cls: 'bg-amber-900/60 text-amber-300 border-amber-700/60' }
                    : { label: 'Poor', cls: 'bg-red-900/60 text-red-300 border-red-700/60' }
                  return (
                    <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider">Overall Quality</span>
                        <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full border', grade.cls)}>
                          {grade.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2.5 bg-gray-700 rounded-full overflow-hidden">
                          <div className={clsx('h-full rounded-full transition-all',
                            score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'
                          )} style={{ width: `${score}%` }} />
                        </div>
                        <span className={clsx('text-sm font-bold tabular-nums',
                          score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400')}>
                          {score}<span className="text-[10px] font-normal text-gray-600">/100</span>
                        </span>
                      </div>
                    </div>
                  )
                })()}

                {/* Issues */}
                {(() => {
                  const ALL_ISSUES: { key: string; label: string; icon: string; hint: string }[] = [
                    { key: 'blurry',      label: 'Blurry',      icon: '🌫️', hint: 'Edge variance < 40 — image lacks sharpness' },
                    { key: 'dark',        label: 'Too Dark',    icon: '🌑', hint: 'Mean brightness < 40 / 255' },
                    { key: 'overexposed', label: 'Overexposed', icon: '☀️', hint: 'Mean brightness > 220 / 255' },
                    { key: 'low_res',     label: 'Low Res',     icon: '🔲', hint: 'Width or height < 200 px' },
                  ]
                  return (
                    <div>
                      <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Issue Checks</p>
                      <div className="space-y-1">
                        {ALL_ISSUES.map(({ key, label, icon, hint }) => {
                          const flagged = entry.quality_issues.includes(key as typeof entry.quality_issues[number])
                          return (
                            <div key={key} className={clsx(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px]',
                              flagged ? 'bg-red-900/30 border border-red-800/40' : 'bg-gray-800/50 border border-gray-700/30'
                            )} title={hint}>
                              <span>{icon}</span>
                              <span className={flagged ? 'text-red-300 font-medium' : 'text-gray-500'}>{label}</span>
                              <span className={clsx('ml-auto text-[9px] font-bold',
                                flagged ? 'text-red-400' : 'text-emerald-600')}>
                                {flagged ? '✗ FLAGGED' : '✓ OK'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* Raw metrics */}
                {(entry.blur_score != null || entry.brightness != null) && (
                  <div>
                    <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Raw Metrics</p>
                    <div className="space-y-2.5">
                      {entry.blur_score != null && (
                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-[10px] text-gray-500">Sharpness <span className="text-gray-700">(edge variance)</span></span>
                            <span className={clsx('text-[10px] font-mono font-semibold',
                              entry.blur_score >= 100 ? 'text-emerald-400'
                              : entry.blur_score >= 40 ? 'text-amber-400'
                              : 'text-red-400')}>
                              {entry.blur_score.toFixed(1)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className={clsx('h-full rounded-full',
                              entry.blur_score >= 100 ? 'bg-emerald-500'
                              : entry.blur_score >= 40 ? 'bg-amber-500' : 'bg-red-500'
                            )} style={{ width: `${Math.min(100, entry.blur_score / 5)}%` }} />
                          </div>
                          <div className="flex justify-between mt-0.5">
                            <span className="text-[9px] text-gray-700">0 blurry</span>
                            <span className="text-[9px] text-gray-700">40 OK</span>
                            <span className="text-[9px] text-gray-700">500 sharp</span>
                          </div>
                        </div>
                      )}

                      {entry.brightness != null && (
                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-[10px] text-gray-500">Brightness <span className="text-gray-700">(mean pixel)</span></span>
                            <span className={clsx('text-[10px] font-mono font-semibold',
                              entry.brightness < 40 || entry.brightness > 220 ? 'text-red-400'
                              : entry.brightness >= 80 && entry.brightness <= 180 ? 'text-emerald-400'
                              : 'text-amber-400')}>
                              {entry.brightness.toFixed(1)}
                            </span>
                          </div>
                          <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            {/* ideal range shading */}
                            <div className="absolute inset-y-0 bg-emerald-900/40 rounded-full"
                              style={{ left: `${80/255*100}%`, width: `${(180-80)/255*100}%` }} />
                            {/* cursor */}
                            <div className="absolute top-0 bottom-0 w-1 rounded-full bg-white/80"
                              style={{ left: `calc(${entry.brightness/255*100}% - 2px)` }} />
                          </div>
                          <div className="flex justify-between mt-0.5">
                            <span className="text-[9px] text-gray-700">0 black</span>
                            <span className="text-[9px] text-emerald-700">80–180 ideal</span>
                            <span className="text-[9px] text-gray-700">255 white</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Perceptual hash */}
                {entry.phash && (
                  <div>
                    <p className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider mb-1">Perceptual Hash <span className="normal-case font-normal text-gray-700">(dHash 64-bit)</span></p>
                    <p className="text-gray-600 font-mono text-[9px] break-all bg-gray-800/50 rounded px-2 py-1.5">{entry.phash}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-xs text-gray-600">No quality metrics</p>
                <p className="text-[10px] text-gray-700 mt-1">Only available for image entries</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Export to Annotation modal ─────────────────────────────────────────────────

function ExportToAnnotationModal({
  dataset, entryIds, onClose,
}: {
  dataset: DatasetProfile
  entryIds?: string[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; project_id: string } | null>(null)

  // New project form
  const [newName, setNewName] = useState(dataset.name)
  const [newClasses, setNewClasses] = useState('')
  const [newType, setNewType] = useState('classification')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  useEffect(() => {
    import('@/api/annotate').then(({ annotateApi }) =>
      annotateApi.listProjects().then(ps => {
        setProjects(ps)
        if (ps.length) { setProjectId(ps[0].id) } else { setMode('new') }
      }).catch(() => {}).finally(() => setLoading(false))
    )
  }, [])

  const doExport = async (pid: string) => {
    setBusy(true)
    try {
      const r = await datasetsApi.exportToAnnotation(dataset.id, pid, entryIds)
      setResult(r)
    } finally { setBusy(false) }
  }

  const doCreateAndExport = async () => {
    const name = newName.trim()
    if (!name) { setCreateErr('Project name is required'); return }
    const classes = newClasses.split(',').map(s => s.trim()).filter(Boolean)
    setCreateErr('')
    setCreating(true)
    try {
      const { annotateApi } = await import('@/api/annotate')
      const proj = await annotateApi.createProject({ name, classes, annotation_type: newType })
      setProjects(ps => [...ps, proj])
      await doExport(proj.id)
    } catch (e: any) {
      setCreateErr(e?.response?.data?.detail || e?.message || 'Failed to create project')
    } finally { setCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-sm font-semibold text-white">Export to Annotation Project</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {entryIds ? `${entryIds.length} selected entries` : 'All non-archived entries'} — no file duplication
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {result ? (
            <div className="text-center py-4 space-y-3">
              <div className="text-4xl">✅</div>
              <p className="text-white font-semibold">Export complete</p>
              <div className="flex justify-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-400">{result.added}</p>
                  <p className="text-gray-500 text-xs">Added</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-400">{result.skipped}</p>
                  <p className="text-gray-500 text-xs">Skipped (duplicates)</p>
                </div>
              </div>
              <button onClick={onClose}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-xl transition-colors">
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Mode tabs */}
              <div className="flex rounded-lg bg-gray-800 p-1 gap-1">
                {(['existing', 'new'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={clsx('flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
                      mode === m ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white')}>
                    {m === 'existing' ? 'Existing Project' : '+ New Project'}
                  </button>
                ))}
              </div>

              {mode === 'existing' ? (
                <>
                  <div>
                    <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5 block">
                      Target Annotation Project
                    </label>
                    {loading ? (
                      <p className="text-xs text-gray-500">Loading projects…</p>
                    ) : projects.length === 0 ? (
                      <p className="text-xs text-amber-400">No projects yet — switch to "New Project" to create one.</p>
                    ) : (
                      <select value={projectId} onChange={e => setProjectId(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="bg-sky-900/20 border border-sky-800/30 rounded-xl p-3 text-[11px] text-sky-300">
                    Images are linked to the same S3 object — no storage is duplicated. Entries already in the target project are skipped.
                  </div>
                  <div className="flex gap-2">
                    <button onClick={onClose}
                      className="flex-1 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => doExport(projectId)} disabled={busy || !projectId || loading}
                      className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                      {busy ? 'Exporting…' : 'Export'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Project Name *</label>
                      <input value={newName} onChange={e => setNewName(e.target.value)}
                        placeholder="e.g. Cow Disease Detection"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                        Classes <span className="normal-case font-normal text-gray-600">(comma-separated)</span>
                      </label>
                      <input value={newClasses} onChange={e => setNewClasses(e.target.value)}
                        placeholder="e.g. healthy, sick, unknown"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Annotation Type</label>
                      <select value={newType} onChange={e => setNewType(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                        <option value="classification">Classification</option>
                        <option value="detection">Detection (bounding boxes)</option>
                        <option value="segmentation">Segmentation</option>
                      </select>
                    </div>
                    {createErr && <p className="text-xs text-red-400">{createErr}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={onClose}
                      className="flex-1 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
                      Cancel
                    </button>
                    <button onClick={doCreateAndExport} disabled={busy || creating || !newName.trim()}
                      className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                      {creating || busy ? <><Loader2 size={13} className="animate-spin inline mr-1" />{creating ? 'Creating…' : 'Exporting…'}</> : 'Create & Export'}
                    </button>
                  </div>
                </>
              )}
            </>
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
  const [contributorsTarget, setContributorsTarget] = useState<DatasetProfile | null>(null)
  const [busyId, setBusyId]         = useState<string | null>(null)
  const [publicViewTarget, setPublicViewTarget] = useState<DatasetProfile | null>(null)

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

  // When viewing a dataset's entries, render the workspace filling the content pane
  if (viewTarget) {
    return (
      <>
        <DatasetWorkspace dataset={viewTarget} onClose={() => setViewTarget(null)} />
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
      </>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 min-h-0">
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
                onContributors={() => setContributorsTarget(d)}
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
                  onViewEntries={() => setPublicViewTarget(d)}
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
      {overviewTarget && <OverviewPanel dataset={overviewTarget} onClose={() => setOverviewTarget(null)} />}
      {publicViewTarget && (
        <PublicDatasetEntriesViewer dataset={publicViewTarget} onClose={() => setPublicViewTarget(null)} />
      )}
      {contributorsTarget && (
        <CollectorsPanel
          dataset={contributorsTarget}
          onClose={() => setContributorsTarget(null)}
          onInvite={() => { setInviteTarget(contributorsTarget); setContributorsTarget(null) }}
        />
      )}
    </div>
  )
}
