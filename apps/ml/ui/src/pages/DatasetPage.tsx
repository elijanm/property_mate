import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Database, Users, ImageIcon, FileText, Hash, Trash2, Mail, ChevronDown, ChevronRight, Copy, Check, X, GripVertical, ToggleLeft, ToggleRight, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { datasetsApi } from '@/api/datasets'
import { modelsApi } from '@/api/models'
import type { ModelDeployment } from '@/types/trainer'
import type { DatasetProfile, DatasetCollector, DatasetField, DatasetCreatePayload, FieldType, CaptureMode, DescriptionMode } from '@/types/dataset'

const FIELD_TYPE_ICONS: Record<FieldType, typeof ImageIcon> = {
  image: ImageIcon,
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

  const isMedia = field.type === 'image' || field.type === 'file'

  return (
    <div className="border border-gray-700/60 rounded-xl bg-gray-800/40 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <GripVertical size={14} className="text-gray-600 shrink-0" />
        <span className="text-[10px] font-mono text-gray-500 w-5 shrink-0">{idx + 1}</span>
        <div className={clsx('p-1.5 rounded-lg', field.type === 'image' ? 'bg-sky-900/50' : 'bg-purple-900/50')}>
          {field.type === 'image' ? <ImageIcon size={12} className="text-sky-400" /> : <FileText size={12} className="text-purple-400" />}
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
                <option value="file">File</option>
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
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [fields, setFields] = useState<Omit<DatasetField, 'id'>[]>(
    initial?.fields?.map(({ id: _id, ...rest }) => rest) ?? [BLANK_FIELD()]
  )
  const [pointsEnabled, setPointsEnabled] = useState(initial?.points_enabled ?? false)
  const [pointsPer, setPointsPer] = useState(initial?.points_per_entry ?? 1)
  const [pointsInfo, setPointsInfo] = useState(initial?.points_redemption_info ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])

  useEffect(() => {
    modelsApi.list({ include_all: true }).then(setDeployments).catch(() => {})
  }, [])

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr('')
    try {
      const payload: DatasetCreatePayload = {
        name, description: desc, category,
        fields: fields.map((f, i) => ({ ...f, order: i })),
        points_enabled: pointsEnabled, points_per_entry: pointsPer,
        points_redemption_info: pointsInfo,
      }
      const result = initial
        ? await datasetsApi.update(initial.id, payload)
        : await datasetsApi.create(payload)
      onSaved(result)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? 'Failed to save')
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
                placeholder="e.g. Cattle Physique Dataset" value={name} onChange={e => setName(e.target.value)} />
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
            {pointsEnabled && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Points per entry</label>
                  <input type="number" min={1} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    value={pointsPer} onChange={e => setPointsPer(Number(e.target.value))} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Redemption info (shown to collectors)</label>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. 100 points = KES 10 airtime" value={pointsInfo} onChange={e => setPointsInfo(e.target.value)} />
                </div>
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
      setErr(e?.response?.data?.detail ?? 'Failed to send invite')
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
  dataset, onEdit, onDelete, onInvite, onView,
}: {
  dataset: DatasetProfile
  onEdit: () => void
  onDelete: () => void
  onInvite: () => void
  onView: () => void
}) {
  const [copied, setCopied] = useState(false)
  const collectBase = `${window.location.origin}/#collect/`

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${collectBase}${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5 hover:border-gray-600/50 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{dataset.name}</h3>
            <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide', STATUS_COLOR[dataset.status])}>
              {dataset.status}
            </span>
            {dataset.points_enabled && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/50 border border-amber-800/50 text-amber-400 font-semibold">🎁 Points</span>
            )}
          </div>
          {dataset.description && <p className="text-xs text-gray-500 line-clamp-2">{dataset.description}</p>}
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
        <button onClick={onInvite}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-600/30 text-indigo-400 text-xs rounded-lg transition-colors">
          <Mail size={11} /> Invite
        </button>
        <button onClick={onView}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
          <Eye size={11} /> Entries
        </button>
        <button onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
          Edit
        </button>
        <button onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-red-900/30 text-gray-500 hover:text-red-400 text-xs rounded-lg transition-colors ml-auto">
          <Trash2 size={11} />
        </button>
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
  const [datasets, setDatasets] = useState<DatasetProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<DatasetProfile | null>(null)
  const [inviteTarget, setInviteTarget] = useState<DatasetProfile | null>(null)
  const [viewTarget, setViewTarget] = useState<DatasetProfile | null>(null)

  const load = () => {
    setLoading(true)
    datasetsApi.list().then(setDatasets).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dataset? This cannot be undone.')) return
    await datasetsApi.delete(id)
    setDatasets(ds => ds.filter(d => d.id !== id))
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Datasets</h1>
          <p className="text-xs text-gray-500 mt-0.5">Collect labelled data from contributors via unique invite links</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus size={15} /> New Dataset
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center text-xs text-gray-500 py-20">Loading…</div>
      ) : datasets.length === 0 ? (
        <div className="text-center py-20">
          <Database size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-semibold">No datasets yet</p>
          <p className="text-xs text-gray-600 mt-1">Create one to start collecting labelled data from contributors.</p>
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
            />
          ))}
        </div>
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
    </div>
  )
}
