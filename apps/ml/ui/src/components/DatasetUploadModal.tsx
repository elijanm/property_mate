/**
 * Reusable slide-over modal to add a training entry to a dataset.
 * Used by TrainersPage (Training Data tab) and CodeEditorPage (empty-dataset prompt).
 */
import { useState, useRef } from 'react'
import { Upload, X, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import { datasetsApi } from '@/api/datasets'
import type { DatasetProfile, DatasetField } from '@/types/dataset'

// ── FieldInput ────────────────────────────────────────────────────────────────

export function FieldInput({
  field,
  value,
  onChange,
  onFileRef,
}: {
  field: DatasetField
  value: { file: File | null; text: string }
  onChange: (v: { file: File | null; text: string }) => void
  onFileRef: (el: HTMLInputElement | null) => void
}) {
  const isFileType = field.type === 'image' || field.type === 'file'
  const accept = field.type === 'image' ? 'image/*' : '*/*'
  const localRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-gray-200">
          {field.label}
          {field.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">
          {field.type}
        </span>
      </div>
      {field.instruction && (
        <p className="text-[11px] text-gray-500">{field.instruction}</p>
      )}

      {isFileType ? (
        <div>
          <input
            type="file"
            accept={accept}
            className="hidden"
            ref={el => {
              (localRef as React.MutableRefObject<HTMLInputElement | null>).current = el
              onFileRef(el)
            }}
            onChange={e => onChange({ ...value, file: e.target.files?.[0] ?? null })}
          />
          <button
            type="button"
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs transition-colors',
              value.file
                ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                : 'bg-gray-900 border-gray-700 text-gray-500 hover:border-brand-600 hover:text-gray-300',
            )}
            onClick={() => localRef.current?.click()}
          >
            <Upload size={12} />
            {value.file ? value.file.name : `Choose ${field.type === 'image' ? 'image' : 'file'}…`}
          </button>
          {value.file && (
            <button
              type="button"
              onClick={() => onChange({ ...value, file: null })}
              className="mt-1 text-[10px] text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1"
            >
              <X size={10} /> Remove file
            </button>
          )}
        </div>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value.text}
          onChange={e => onChange({ ...value, text: e.target.value })}
          placeholder={field.instruction || `Enter ${field.type} value…`}
          className="w-full px-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-brand-600"
        />
      )}
    </div>
  )
}

// ── DatasetUploadModal ────────────────────────────────────────────────────────

export default function DatasetUploadModal({
  dataset,
  onClose,
  onUploaded,
  onGoDatasets,
}: {
  dataset: DatasetProfile
  onClose: () => void
  onUploaded: () => void
  onGoDatasets?: () => void
}) {
  const fields = [...dataset.fields].sort((a, b) => a.order - b.order)
  const [values, setValues] = useState<Record<string, { file: File | null; text: string }>>(() =>
    Object.fromEntries(fields.map(f => [f.id, { file: null, text: '' }])),
  )
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      let uploaded = 0
      for (const field of fields) {
        const val = values[field.id]
        const hasFile = val.file !== null
        const hasText = val.text.trim() !== ''
        if (!hasFile && !hasText) {
          if (field.required) {
            setError(`"${field.label}" is required.`)
            setSubmitting(false)
            return
          }
          continue
        }
        await datasetsApi.uploadEntryDirect(dataset.id, field.id, val.file, hasText ? val.text : undefined)
        uploaded++
      }
      if (uploaded === 0) {
        setError('Please provide at least one field value.')
        setSubmitting(false)
        return
      }
      setDone(true)
      onUploaded()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-lg bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-white">Upload Training Data</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Dataset: <span className="text-brand-300 font-medium">{dataset.name}</span>
              {dataset.slug && <span className="ml-2 text-gray-600">#{dataset.slug}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onGoDatasets && (
              <button
                onClick={onGoDatasets}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                title="Open Datasets page"
              >
                <ExternalLink size={12} />
              </button>
            )}
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-white">Entry uploaded!</p>
              <p className="text-xs text-gray-500 mt-1">
                Your training data was added to the dataset. Re-run to train the model.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-sm text-white rounded-xl transition-colors"
            >
              Close &amp; Re-run
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl px-4 py-3 text-xs text-amber-300">
                The dataset is empty — the model needs training data before it can run.
                Fill in the fields below to add an entry. Repeat uploads to add more rows.
              </div>

              {fields.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">
                  This dataset has no fields defined. Open the Datasets page to add fields first.
                </p>
              )}

              {fields.map(field => (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  onChange={v => setValues(prev => ({ ...prev, [field.id]: v }))}
                  onFileRef={el => { fileRefs.current[field.id] = el }}
                />
              ))}

              {error && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-gray-800 px-6 py-4 flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || fields.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-sm font-medium text-white rounded-xl transition-colors"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Save Entry
              </button>
              <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
              <span className="ml-auto text-[10px] text-gray-600">
                Each save adds 1 entry. Upload multiple files separately.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
