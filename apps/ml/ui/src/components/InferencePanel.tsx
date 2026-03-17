import { useState, useRef, useEffect } from 'react'
import type { ModelDeployment, SchemaField, OutputSchemaField } from '@/types/trainer'
import type { InferenceResult } from '@/types/inference'
import { inferenceApi } from '@/api/inference'
import { Upload, Send, Loader2, Info, RefreshCw, Sparkles, ChevronRight, ChevronDown, ImageIcon, X, GitBranch } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  deployment: ModelDeployment
  allDeployments?: ModelDeployment[]
  onResult: (result: InferenceResult, inputs?: unknown) => void
  onDeploymentChange?: (d: ModelDeployment) => void
}

// Build initial field values — use schema default, fall back to type zero-value
// image/file fields are excluded (handled by ImageInput inline component)
function defaultFields(schema: Record<string, SchemaField>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, f] of Object.entries(schema)) {
    if (f.type === 'image' || f.type === 'file') continue
    if (f.default != null) out[k] = String(f.default)
    else if (f.type === 'number') out[k] = '0'
    else if (f.type === 'boolean') out[k] = 'false'
    else out[k] = ''
  }
  return out
}

// Build JSON object from schema — default value or type zero-value
// image/file fields are excluded (binary data doesn't belong in JSON mode)
function defaultJson(schema: Record<string, SchemaField>): string {
  const out: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(schema)) {
    if (f.type === 'image' || f.type === 'file') continue
    if (f.default != null) out[k] = f.type === 'number' ? Number(f.default) : f.default
    else if (f.type === 'number') out[k] = 0
    else if (f.type === 'boolean') out[k] = false
    else out[k] = ''
  }
  return JSON.stringify(out, null, 2)
}

// Describe an output field type in plain English
function outputTypeHint(f: OutputSchemaField): string {
  if (f.format === 'percent') return 'percentage (0–100%)'
  switch (f.type) {
    case 'text': return 'text'
    case 'number': return 'number'
    case 'image_url': return 'image'
    case 'detections': return 'list of detected objects'
    case 'json': return 'structured data (JSON)'
    default: return f.type
  }
}

function formatExample(val: unknown, f: OutputSchemaField): string {
  if (val == null) return ''
  if (f.format === 'percent' && typeof val === 'number') return `${(val * 100).toFixed(0)}%`
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

export default function InferencePanel({ deployment, allDeployments, onResult, onDeploymentChange }: Props) {
  const schema = deployment.input_schema ?? {}
  const outputSchema = deployment.output_schema ?? {}
  const hasSchema = Object.keys(schema).length > 0
  const hasOutputSchema = Object.keys(outputSchema).length > 0

  const [fields, setFields] = useState<Record<string, string>>(() => defaultFields(schema))
  // imageFields stores base64 strings keyed by schema field name
  const [imageFields, setImageFields] = useState<Record<string, string>>({})
  const [rawJson, setRawJson] = useState(() => defaultJson(schema))
  const [mode, setMode] = useState<'schema' | 'json' | 'file'>(hasSchema ? 'schema' : 'json')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOutputPreview, setShowOutputPreview] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  // Re-initialise when deployment changes or schema loads asynchronously
  useEffect(() => {
    if (!hasSchema) return
    setFields(defaultFields(schema))
    setImageFields({})
    setRawJson(defaultJson(schema))
    setError(null)
  }, [deployment.id, hasSchema])

  const fillDefaults = () => { setFields(defaultFields(schema)); setRawJson(defaultJson(schema)) }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      let result: InferenceResult
      let submittedInputs: unknown
      if (mode === 'file' && file) {
        const extra = Object.keys(fields).length ? fields : undefined
        result = await inferenceApi.predictFile(deployment.trainer_name, file, extra, deployment.mlflow_model_version)
        submittedInputs = { file: file.name, ...extra }
      } else {
        let inputs: Record<string, unknown>
        if (mode === 'schema') {
          inputs = {}
          for (const [k, v] of Object.entries(fields)) {
            const ftype = schema[k]?.type
            inputs[k] = ftype === 'number' ? Number(v) : ftype === 'boolean' ? v === 'true' : v
          }
          // Merge inline image fields as base64 strings
          for (const [k, b64] of Object.entries(imageFields)) {
            inputs[k] = b64
          }
        } else {
          inputs = JSON.parse(rawJson)
        }
        submittedInputs = inputs
        result = await inferenceApi.predict(deployment.trainer_name, inputs, deployment.mlflow_model_version)
      }
      onResult(result, submittedInputs)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // image/file required fields must have a value in imageFields
  const allFilled = Object.entries(schema)
    .filter(([, f]) => f.required)
    .every(([k, f]) =>
      (f.type === 'image' || f.type === 'file')
        ? !!imageFields[k]
        : (fields[k] ?? '').trim() !== ''
    )

  const sortedDeploys = allDeployments
    ? [...allDeployments].sort((a, b) => parseInt(b.mlflow_model_version || '0') - parseInt(a.mlflow_model_version || '0'))
    : null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* Left: input form */}
      <div className="xl:col-span-3 space-y-5">
        {/* Version selector — shown only when multiple deployments exist */}
        {sortedDeploys && sortedDeploys.length > 1 && (
          <div className="flex items-center gap-2">
            <GitBranch size={13} className="text-gray-500 shrink-0" />
            <span className="text-xs text-gray-500">Run against:</span>
            <div className="relative flex-1">
              <select
                value={deployment.id}
                onChange={e => {
                  const d = sortedDeploys.find(d => d.id === e.target.value)
                  if (d && onDeploymentChange) onDeploymentChange(d)
                }}
                className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 pr-7 text-xs text-gray-200 focus:outline-none focus:border-brand-500"
              >
                {sortedDeploys.map(d => (
                  <option key={d.id} value={d.id}>
                    v{d.mlflow_model_version}{d.is_default ? ' ★ default' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
            {hasSchema && (
              <ModeTab id="schema" active={mode === 'schema'} label="Form" onClick={() => setMode('schema')} />
            )}
            <ModeTab id="json" active={mode === 'json'} label="JSON" onClick={() => setMode('json')} />
            <ModeTab id="file" active={mode === 'file'} label="File" onClick={() => setMode('file')} />
          </div>

          {mode === 'schema' && hasSchema && (
            <button
              onClick={fillDefaults}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors"
            >
              <RefreshCw size={11} /> Reset to defaults
            </button>
          )}
        </div>

        {/* Schema form */}
        {mode === 'schema' && (
          <div className="space-y-4">
            {hasSchema ? (
              <>
                <p className="text-xs text-gray-600">
                  Fields are pre-filled with example values. Adjust as needed and click Run.
                </p>
                {Object.entries(schema).map(([key, field]) =>
                  field.type === 'image' || field.type === 'file' ? (
                    <ImageInput
                      key={key}
                      fieldKey={key}
                      field={field}
                      value={imageFields[key] ?? null}
                      onChange={b64 => setImageFields(p => ({ ...p, [key]: b64 }))}
                      onClear={() => setImageFields(p => { const n = { ...p }; delete n[key]; return n })}
                    />
                  ) : (
                    <SchemaInput
                      key={key}
                      fieldKey={key}
                      field={field}
                      value={fields[key] ?? ''}
                      onChange={v => setFields(p => ({ ...p, [key]: v }))}
                    />
                  )
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">
                No input schema defined for this model. Use JSON or File mode.
              </p>
            )}
          </div>
        )}

        {/* JSON mode */}
        {mode === 'json' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-600">
              Send raw JSON. Keys must match the model's expected input fields.
            </p>
            <textarea
              className="w-full h-52 bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none"
              value={rawJson}
              onChange={e => setRawJson(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        {/* File upload */}
        {mode === 'file' && (
          <div className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                file ? 'border-brand-600 bg-brand-900/20' : 'border-gray-700 hover:border-gray-600'
              )}
            >
              <Upload size={22} className="mx-auto mb-2 text-gray-500" />
              {file ? (
                <p className="text-sm text-brand-400 font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-gray-400">Drop a file or click to browse</p>
                  <p className="text-xs text-gray-600 mt-1">Image, CSV, JSON, or any model input</p>
                </>
              )}
              <input ref={fileRef} type="file" className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
            {hasSchema && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Additional Parameters</p>
                {Object.entries(schema)
                  .filter(([, f]) => f.type !== 'file' && f.type !== 'image')
                  .map(([key, field]) => (
                    <SchemaInput key={key} fieldKey={key} field={field}
                      value={fields[key] ?? ''}
                      onChange={v => setFields(p => ({ ...p, [key]: v }))}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-xl p-3 text-sm text-red-400">{error}</div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || (mode === 'schema' && !allFilled) || (mode === 'file' && !file)}
          className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {loading ? 'Running inference…' : 'Run Inference'}
        </button>
      </div>

      {/* Right: what to expect */}
      <div className="xl:col-span-2 space-y-4">
        {/* Output preview */}
        {hasOutputSchema && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowOutputPreview(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-widest hover:text-gray-200 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Sparkles size={12} className="text-brand-500" />
                Expected Output
              </span>
              <ChevronRight size={13} className={clsx('transition-transform', showOutputPreview && 'rotate-90')} />
            </button>
            {showOutputPreview && (
              <div className="border-t border-gray-800 divide-y divide-gray-800">
                {Object.entries(outputSchema).map(([key, f]) => (
                  <div key={key} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-200">{f.label}</span>
                      <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">
                        {outputTypeHint(f)}
                      </span>
                    </div>
                    {f.description && (
                      <p className="text-[11px] text-gray-500 mb-1.5">{f.description}</p>
                    )}
                    {f.example != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-700">e.g.</span>
                        <code className="text-[11px] text-brand-400 bg-brand-900/30 px-1.5 py-0.5 rounded font-mono">
                          {formatExample(f.example, f)}
                        </code>
                      </div>
                    )}
                    {f.editable && (
                      <span className="inline-block mt-1.5 text-[10px] text-amber-500 bg-amber-900/20 px-1.5 py-0.5 rounded">
                        ✎ editable — you can correct this after inference
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input field reference card */}
        {hasSchema && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Info size={12} className="text-gray-600" />
                Input Reference
              </span>
            </div>
            <div className="divide-y divide-gray-800">
              {Object.entries(schema).map(([key, f]) => (
                <div key={key} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-300">{f.label ?? key}</span>
                    {f.unit && <span className="text-[10px] text-gray-600">({f.unit})</span>}
                    {f.required && <span className="text-[10px] text-red-500">required</span>}
                  </div>
                  {f.min != null && f.max != null && (
                    <div className="text-[10px] text-gray-600 mb-0.5">
                      Range: {f.min} – {f.max}{f.unit ? ` ${f.unit}` : ''}
                    </div>
                  )}
                  {f.example != null && (
                    <p className="text-[11px] text-gray-500 italic">{String(f.example)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ModeTab({ id, active, label, onClick }: { id: string; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      key={id}
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
        active ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200'
      )}
    >
      {label}
    </button>
  )
}

function SchemaInput({
  fieldKey, field, value, onChange,
}: { fieldKey: string; field: SchemaField; value: string; onChange: (v: string) => void }) {
  const label = field.label ?? fieldKey
  const isEmpty = value === ''

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-gray-200">
          {label}
          {field.unit && <span className="text-xs text-gray-500 ml-1">({field.unit})</span>}
          {field.required && <span className="text-red-400 ml-1 text-xs">*</span>}
        </label>
        {field.min != null && field.max != null && (
          <span className="text-[10px] text-gray-600 shrink-0">
            {field.min} – {field.max}
          </span>
        )}
      </div>

      {/* Description */}
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}

      {/* Input */}
      {field.type === 'boolean' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        >
          <option value="">— select —</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : field.enum ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        >
          <option value="">— select —</option>
          {field.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : field.type === 'number' ? (
        <div className="relative">
          <input
            type="number"
            value={value}
            onChange={e => onChange(e.target.value)}
            min={field.min}
            max={field.max}
            step={field.step ?? 'any'}
            className={clsx(
              'w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500 transition-colors',
              isEmpty ? 'border-gray-600' : 'border-gray-700'
            )}
            placeholder={field.default != null ? String(field.default) : ''}
          />
          {field.unit && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600 pointer-events-none">
              {field.unit}
            </span>
          )}
        </div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.default != null ? String(field.default) : ''}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        />
      )}

      {/* Example hint */}
      {field.example != null && (
        <p className="text-[11px] text-gray-600 italic">{String(field.example)}</p>
      )}
    </div>
  )
}

function ImageInput({
  fieldKey, field, value, onChange, onClear,
}: { fieldKey: string; field: SchemaField; value: string | null; onChange: (b64: string) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const label = field.label ?? fieldKey
  const accept = field.type === 'image' ? 'image/*' : '*/*'

  const handleFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const result = e.target?.result as string
      // Strip data URI prefix — send raw base64 so backend can decode cleanly
      const b64 = result.includes(',') ? result.split(',')[1] : result
      onChange(b64)
    }
    reader.readAsDataURL(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // Reconstruct a data URL for preview
  const previewSrc = value ? `data:image/*;base64,${value}` : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-gray-200">
          {label}
          {field.required && <span className="text-red-400 ml-1 text-xs">*</span>}
        </label>
      </div>
      {field.description && (
        <p className="text-xs text-gray-500">{field.description}</p>
      )}

      {value ? (
        /* Preview state */
        <div className="relative rounded-xl overflow-hidden border border-brand-700 bg-gray-900">
          {field.type === 'image' ? (
            <img src={previewSrc!} alt={label} className="w-full max-h-48 object-contain" />
          ) : (
            <div className="flex items-center gap-3 px-4 py-3">
              <ImageIcon size={18} className="text-brand-400" />
              <span className="text-sm text-gray-300 truncate">File loaded</span>
            </div>
          )}
          <button
            onClick={onClear}
            className="absolute top-2 right-2 p-1 rounded-lg bg-gray-900/80 text-gray-400 hover:text-red-400 transition-colors"
          >
            <X size={14} />
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-2 right-2 text-[11px] bg-gray-900/80 text-brand-400 hover:text-brand-300 px-2 py-1 rounded-lg transition-colors"
          >
            Change
          </button>
        </div>
      ) : (
        /* Drop zone */
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-gray-700 hover:border-brand-600 rounded-xl p-6 text-center cursor-pointer transition-colors group"
        >
          <div className="w-10 h-10 rounded-xl bg-gray-800 group-hover:bg-brand-900/30 flex items-center justify-center mx-auto mb-2 transition-colors">
            <ImageIcon size={20} className="text-gray-500 group-hover:text-brand-400 transition-colors" />
          </div>
          <p className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors font-medium">
            Upload {label}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            {field.type === 'image' ? 'PNG, JPG, WEBP' : 'Any file'} · click or drag & drop
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
    </div>
  )
}
