import type { OutputSchemaField } from '@/types/trainer'
import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import clsx from 'clsx'

interface Detection {
  bbox: [number, number, number, number]
  class_name: string
  score: number
}

interface Props {
  outputSchema: Record<string, OutputSchemaField>
  output: unknown
  correctedOutput?: unknown
  onCorrect?: (corrected: Record<string, unknown>) => void
}

export default function OutputRenderer({ outputSchema, output, correctedOutput, onCorrect }: Props) {
  const data = (typeof output === 'object' && output !== null ? output : {}) as Record<string, unknown>
  const corrected = (typeof correctedOutput === 'object' && correctedOutput !== null ? correctedOutput : {}) as Record<string, unknown>
  const hasSchema = Object.keys(outputSchema).length > 0

  if (!hasSchema) {
    // Fallback: render raw JSON with image URLs detected automatically
    return <RawOutput data={data} corrected={corrected} onCorrect={onCorrect} />
  }

  return (
    <div className="space-y-4">
      {/* Images first */}
      <div className="flex flex-wrap gap-4">
        {Object.entries(outputSchema)
          .filter(([, f]) => f.type === 'image_url')
          .map(([key, field]) => {
            const url = data[key] as string | undefined
            if (!url) return null
            return (
              <div key={key}>
                <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">{field.label}</p>
                <img src={url} alt={field.label} className="max-h-56 rounded-xl border border-gray-700 object-contain" />
              </div>
            )
          })}
      </div>

      {/* Scalar fields */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Object.entries(outputSchema)
          .filter(([, f]) => f.type !== 'image_url' && f.type !== 'detections' && f.type !== 'json')
          .map(([key, field]) => {
            const raw = data[key]
            const override = corrected[key]
            const display = override !== undefined ? override : raw
            return (
              <ScalarField
                key={key}
                fieldKey={key}
                field={field}
                value={display}
                isOverridden={override !== undefined}
                onCorrect={onCorrect ? (v) => {
                  const next = { ...corrected, [key]: v }
                  onCorrect(next)
                } : undefined}
              />
            )
          })}
      </div>

      {/* Detections table */}
      {Object.entries(outputSchema)
        .filter(([, f]) => f.type === 'detections')
        .map(([key, field]) => {
          const dets = data[key] as Detection[] | undefined
          if (!dets?.length) return null
          return (
            <div key={key}>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">{field.label}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1 pr-3">#</th>
                    <th className="text-left py-1 pr-3">Label</th>
                    <th className="text-right py-1 pr-3">Confidence</th>
                    <th className="text-right py-1">BBox</th>
                  </tr>
                </thead>
                <tbody>
                  {dets.map((d, i) => (
                    <tr key={i} className="border-b border-gray-900">
                      <td className="py-1 pr-3 text-gray-600">{i + 1}</td>
                      <td className="py-1 pr-3 font-mono text-brand-400 font-bold">{d.class_name}</td>
                      <td className="py-1 pr-3 text-right text-gray-300">{(d.score * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right text-gray-600 font-mono text-[10px]">{d.bbox.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

      {/* JSON fields */}
      {Object.entries(outputSchema)
        .filter(([, f]) => f.type === 'json')
        .map(([key, field]) => {
          const val = data[key]
          if (val === undefined) return null
          return (
            <div key={key}>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">{field.label}</p>
              <pre className="bg-gray-900 rounded-xl p-3 text-xs text-gray-300 font-mono overflow-auto max-h-48">
                {JSON.stringify(val, null, 2)}
              </pre>
            </div>
          )
        })}
    </div>
  )
}

function ScalarField({
  fieldKey, field, value, isOverridden, onCorrect,
}: {
  fieldKey: string
  field: OutputSchemaField
  value: unknown
  isOverridden: boolean
  onCorrect?: (v: unknown) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))

  const formatted = () => {
    if (value === null || value === undefined) return '—'
    if (field.format === 'percent' && typeof value === 'number') return `${(value * 100).toFixed(1)}%`
    return String(value)
  }

  return (
    <div className={clsx('bg-gray-900 rounded-xl p-3 border', isOverridden ? 'border-amber-700/50' : 'border-gray-800')}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{field.label}</p>
        <div className="flex items-center gap-1">
          {isOverridden && <span className="text-[9px] text-amber-400 uppercase">edited</span>}
          {field.editable && onCorrect && !editing && (
            <button onClick={() => { setDraft(String(value ?? '')); setEditing(true) }}
              className="text-gray-600 hover:text-gray-400">
              <Pencil size={10} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-1 mt-1">
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            className="flex-1 bg-gray-800 border border-brand-600 rounded px-2 py-0.5 text-sm text-white font-mono focus:outline-none"
          />
          <button onClick={() => { onCorrect?.(draft); setEditing(false) }}
            className="text-emerald-400 hover:text-emerald-300"><Check size={12} /></button>
          <button onClick={() => setEditing(false)}
            className="text-gray-500 hover:text-gray-300"><X size={12} /></button>
        </div>
      ) : (
        <p className={clsx('text-lg font-bold font-mono', isOverridden ? 'text-amber-300' : 'text-white')}>
          {formatted()}
        </p>
      )}
      {field.description && <p className="text-[10px] text-gray-600 mt-1">{field.description}</p>}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RawOutput({ data, corrected, onCorrect }: {
  data: Record<string, unknown>
  corrected: Record<string, unknown>
  onCorrect?: (c: Record<string, unknown>) => void
}) {
  // Auto-detect image URLs
  const imageKeys = Object.entries(data)
    .filter(([, v]) => typeof v === 'string' && (v as string).startsWith('http'))
    .map(([k]) => k)

  return (
    <div className="space-y-4">
      {imageKeys.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {imageKeys.map(k => (
            <div key={k}>
              <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">{k}</p>
              <img src={data[k] as string} alt={k} className="max-h-56 rounded-xl border border-gray-700 object-contain" />
            </div>
          ))}
        </div>
      )}
      <pre className="bg-gray-900 rounded-xl p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-auto max-h-64">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
