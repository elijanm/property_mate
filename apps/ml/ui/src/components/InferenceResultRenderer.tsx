/**
 * InferenceResultRenderer — generic display engine for any model output.
 *
 * Two rendering modes:
 *   1. Spec-driven  — trainer declared output_display on the class; renders exactly as specified.
 *   2. Heuristic    — displaySpec is empty; auto-detects field types by key name + value shape.
 *
 * Layout: images first (responsive grid), then scalars (reading/label/confidence), then lists, then raw JSON.
 */
import type { OutputFieldSpec } from '@/types/inference'

interface Props {
  outputs: Record<string, unknown> | null
  displaySpec: OutputFieldSpec[]   // [] = use heuristic auto-detection
  compact?: boolean                // tighter padding for dropdown preview
}

// ── Type detection helpers ────────────────────────────────────────────────────

function isImageValue(val: unknown): boolean {
  if (typeof val !== 'string') return false
  return val.startsWith('data:image') || val.startsWith('http') || val.startsWith('//')
}

function isImageKey(key: string): boolean {
  return /image|img|photo|mask|original|detected|annotated|frame|thumbnail|preview/i.test(key)
}

function isRankedList(val: unknown): boolean {
  return Array.isArray(val) && val.length > 0 &&
    typeof val[0] === 'object' && val[0] !== null &&
    ('label' in val[0] || 'class' in val[0]) &&
    ('confidence' in val[0] || 'score' in val[0] || 'probability' in val[0])
}

function isBboxList(val: unknown): boolean {
  return Array.isArray(val) && val.length > 0 &&
    typeof val[0] === 'object' && val[0] !== null &&
    ('bbox' in val[0] || 'box' in val[0]) &&
    ('label' in val[0] || 'class' in val[0])
}

type FieldType = 'image' | 'reading' | 'label' | 'confidence' | 'ranked_list' | 'bbox_list' | 'text' | 'json'

function detectType(key: string, val: unknown): FieldType {
  if (isImageValue(val) || isImageKey(key)) return 'image'
  if (/confidence|score|probability|certainty/i.test(key) && typeof val === 'number') return 'confidence'
  if (/reading|meter|ocr|number|count/i.test(key)) return 'reading'
  if (/label|class|prediction|category|tag|type/i.test(key) && typeof val === 'string') return 'label'
  if (isRankedList(val)) return 'ranked_list'
  if (isBboxList(val)) return 'bbox_list'
  if (typeof val === 'number') return 'reading'
  if (typeof val === 'string' && val.length > 80) return 'text'
  if (typeof val === 'string') return 'label'
  return 'json'
}

// ── Field renderers ───────────────────────────────────────────────────────────

function ImageField({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== 'string' || !value) return null
  return (
    <div className="flex flex-col gap-1">
      <img src={value} alt={label}
        className="w-full rounded-xl border border-gray-800 object-cover max-h-56 bg-gray-900" />
      <span className="text-[10px] text-gray-500 text-center">{label}</span>
    </div>
  )
}

function ReadingField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex flex-col">
      <span className="text-2xl font-mono font-bold text-brand-400 tracking-widest">
        {String(value ?? '—')}
      </span>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  )
}

function LabelField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex flex-col">
      <span className="text-sm font-semibold text-gray-200">{String(value ?? '—')}</span>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  )
}

function ConfidenceField({ label, value }: { label: string; value: unknown }) {
  const pct = typeof value === 'number' ? Math.round(value * 100) : NaN
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex flex-col gap-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold text-gray-200">{isNaN(pct) ? '—' : `${pct}%`}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full transition-all"
          style={{ width: `${isNaN(pct) ? 0 : pct}%` }} />
      </div>
    </div>
  )
}

function RankedListField({ label, value }: { label: string; value: unknown }) {
  if (!Array.isArray(value)) return null
  const items = value.slice(0, 8) as Record<string, unknown>[]
  const maxScore = Math.max(...items.map(i => Number(i.confidence ?? i.score ?? i.probability ?? 0)), 0.01)
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <p className="text-[10px] text-gray-500 mb-2">{label}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => {
          const lbl = String(item.label ?? item.class ?? `Item ${i + 1}`)
          const score = Number(item.confidence ?? item.score ?? item.probability ?? 0)
          const pct = Math.round(score * 100)
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-24 truncate text-gray-300">{lbl}</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600 rounded-full"
                  style={{ width: `${(score / maxScore) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-gray-500">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BboxListField({ label, value }: { label: string; value: unknown }) {
  if (!Array.isArray(value)) return null
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <p className="text-[10px] text-gray-500 mb-2">{label} — {value.length} detection{value.length !== 1 ? 's' : ''}</p>
      <div className="flex flex-wrap gap-1.5">
        {(value as Record<string, unknown>[]).slice(0, 12).map((item, i) => {
          const lbl = String(item.label ?? item.class ?? `#${i + 1}`)
          const conf = item.confidence ?? item.score
          return (
            <span key={i} className="px-2 py-0.5 bg-gray-800 rounded-full text-[10px] text-gray-300">
              {lbl}{conf != null ? ` ${Math.round(Number(conf) * 100)}%` : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function TextField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <p className="text-[10px] text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-200 leading-relaxed">{String(value)}</p>
    </div>
  )
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <summary className="text-[10px] text-gray-500 cursor-pointer select-none">{label}</summary>
      <pre className="mt-2 text-[10px] font-mono text-gray-400 overflow-auto max-h-32 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

// ── Render one field by type ──────────────────────────────────────────────────

function RenderField({ fieldType, label, value }: { fieldType: FieldType; label: string; value: unknown }) {
  switch (fieldType) {
    case 'image':       return <ImageField label={label} value={value} />
    case 'reading':     return <ReadingField label={label} value={value} />
    case 'label':       return <LabelField label={label} value={value} />
    case 'confidence':  return <ConfidenceField label={label} value={value} />
    case 'ranked_list': return <RankedListField label={label} value={value} />
    case 'bbox_list':   return <BboxListField label={label} value={value} />
    case 'text':        return <TextField label={label} value={value} />
    default:            return <JsonField label={label} value={value} />
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InferenceResultRenderer({ outputs, displaySpec, compact = false }: Props) {
  if (!outputs) return null

  // ── Spec-driven mode ──────────────────────────────────────────────────────
  if (displaySpec.length > 0) {
    const images  = displaySpec.filter(s => s.type === 'image')
    const scalars = displaySpec.filter(s => s.type !== 'image' && s.type !== 'ranked_list' && s.type !== 'bbox_list' && s.type !== 'json')
    const lists   = displaySpec.filter(s => s.type === 'ranked_list' || s.type === 'bbox_list')
    const raws    = displaySpec.filter(s => s.type === 'json')

    return (
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {images.length > 0 && (
          <div className={`grid gap-3 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {images.map(spec => (
              <div key={spec.key} className={spec.span === 2 ? 'col-span-2' : ''}>
                <ImageField label={spec.label} value={outputs[spec.key]} />
              </div>
            ))}
          </div>
        )}
        {scalars.length > 0 && (
          <div className={`grid gap-3 ${scalars.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {scalars.map(spec => (
              <RenderField key={spec.key} fieldType={spec.type} label={spec.label} value={outputs[spec.key]} />
            ))}
          </div>
        )}
        {lists.map(spec => (
          <RenderField key={spec.key} fieldType={spec.type} label={spec.label} value={outputs[spec.key]} />
        ))}
        {raws.map(spec => (
          <RenderField key={spec.key} fieldType={spec.type} label={spec.label} value={outputs[spec.key]} />
        ))}
      </div>
    )
  }

  // ── Heuristic mode ────────────────────────────────────────────────────────
  type Entry = { key: string; type: FieldType; label: string; value: unknown }
  const entries: Entry[] = Object.entries(outputs).map(([key, value]) => ({
    key, value, type: detectType(key, value),
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }))

  const images  = entries.filter(e => e.type === 'image')
  const scalars = entries.filter(e => e.type === 'reading' || e.type === 'label' || e.type === 'confidence')
  const lists   = entries.filter(e => e.type === 'ranked_list' || e.type === 'bbox_list')
  const texts   = entries.filter(e => e.type === 'text')
  const raws    = entries.filter(e => e.type === 'json')

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {images.length > 0 && (
        <div className={`grid gap-3 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {images.map(e => <ImageField key={e.key} label={e.label} value={e.value} />)}
        </div>
      )}
      {scalars.length > 0 && (
        <div className={`grid gap-3 ${scalars.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {scalars.map(e => <RenderField key={e.key} fieldType={e.type} label={e.label} value={e.value} />)}
        </div>
      )}
      {lists.map(e => <RenderField key={e.key} fieldType={e.type} label={e.label} value={e.value} />)}
      {texts.map(e => <TextField key={e.key} label={e.label} value={e.value} />)}
      {raws.map(e => <JsonField key={e.key} label={e.label} value={e.value} />)}
    </div>
  )
}
