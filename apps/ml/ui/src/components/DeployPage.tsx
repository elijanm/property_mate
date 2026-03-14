import { useState, useRef, forwardRef } from 'react'
import { modelsApi, type DeployUriPayload } from '@/api/models'
import { Upload, Link, Package, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  onJobCreated?: (jobId: string) => void
}

type DeployMode = 'zip' | 'file' | 'uri'

export default function DeployPage({ onJobCreated }: Props) {
  const [mode, setMode] = useState<DeployMode>('zip')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ jobId: string; modelName?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleResult = (data: { job_id: string; model_name?: string }) => {
    setResult({ jobId: data.job_id, modelName: data.model_name })
    onJobCreated?.(data.job_id)
  }

  const MODES = [
    { id: 'zip' as DeployMode, label: 'ZIP Archive', icon: <Package size={14} />, desc: 'Structured ZIP with manifest.json — recommended' },
    { id: 'file' as DeployMode, label: 'Model File', icon: <Upload size={14} />, desc: '.pkl .onnx .pt .h5 + optional inference script' },
    { id: 'uri' as DeployMode, label: 'Remote URI', icon: <Link size={14} />, desc: 'HuggingFace, S3, URL, or MLflow registry URI' },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-3">
        {MODES.map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); setResult(null); setError(null) }}
            className={clsx('rounded-2xl p-4 border text-left transition-all', m.id === mode
              ? 'bg-brand-900/30 border-brand-700 text-brand-300'
              : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'
            )}>
            <div className="flex items-center gap-2 mb-1">{m.icon}<span className="font-semibold text-sm">{m.label}</span></div>
            <p className="text-[11px] opacity-70">{m.desc}</p>
          </button>
        ))}
      </div>

      {/* Forms */}
      {mode === 'zip' && (
        <ZipForm loading={loading} setLoading={setLoading} setError={setError} onResult={handleResult} />
      )}
      {mode === 'file' && (
        <FileForm loading={loading} setLoading={setLoading} setError={setError} onResult={handleResult} />
      )}
      {mode === 'uri' && (
        <UriForm loading={loading} setLoading={setLoading} setError={setError} onResult={handleResult} />
      )}

      {/* Result / Error */}
      {result && (
        <div className="bg-emerald-950/40 border border-emerald-800 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">Deploy job queued!</p>
            {result.modelName && <p className="text-xs text-emerald-600 mt-0.5">Model: {result.modelName}</p>}
            <p className="text-xs text-gray-500 mt-1 font-mono">Job ID: {result.jobId}</p>
            <p className="text-xs text-gray-600 mt-1">Track progress in the <strong className="text-gray-400">Jobs</strong> page.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  )
}

// ── ZIP form ────────────────────────────────────────────────────────────────

interface ConflictInfo {
  model_name: string
  new_version: string
  existing_version: string
  existing_mlflow_version: string
}

function ZipForm({ loading, setLoading, setError, onResult }: FormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const submit = async (action?: 'upgrade' | 'replace') => {
    if (!file) return
    setLoading(true); setError(null); setConflict(null)
    try {
      const result = await modelsApi.deployFromZip(file, action)
      if (result.conflict) {
        setConflict(result as ConflictInfo)
      } else {
        onResult(result)
      }
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-xs text-gray-500 space-y-1">
        <p className="text-gray-300 font-semibold text-sm mb-2">Expected ZIP structure</p>
        <pre className="font-mono">{`my-model.zip
├── manifest.json   ← required (name, version, model_file, entry_point)
├── inference.py    ← PythonModel subclass
├── model.pt        ← weights file
└── artifacts/      ← optional extras`}</pre>
      </div>
      <DropZone file={file} setFile={setFile} ref={ref} accept=".zip" label="Drop ZIP or click to browse" />

      {/* Conflict dialog */}
      {conflict && (
        <div className="bg-yellow-950/40 border border-yellow-700 rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-300">Model already exists</p>
              <p className="text-xs text-yellow-600 mt-0.5">
                <strong className="text-yellow-400">{conflict.model_name}</strong> is already deployed
                (v{conflict.existing_version}, MLflow v{conflict.existing_mlflow_version}).
                How would you like to proceed?
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => submit('upgrade')} disabled={loading}
              className="flex-1 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 rounded-xl text-xs font-semibold text-white transition-colors">
              {loading ? <Loader2 size={13} className="animate-spin mx-auto" /> : '↑ Upgrade — add new version'}
            </button>
            <button onClick={() => submit('replace')} disabled={loading}
              className="flex-1 py-2 bg-red-900/60 hover:bg-red-900 border border-red-800 disabled:opacity-40 rounded-xl text-xs font-semibold text-red-300 transition-colors">
              {loading ? <Loader2 size={13} className="animate-spin mx-auto" /> : '⟳ Replace — archive & redeploy'}
            </button>
          </div>
        </div>
      )}

      {!conflict && (
        <SubmitButton loading={loading} disabled={!file} onClick={() => submit()} label="Deploy ZIP" />
      )}
    </div>
  )
}

// ── File form ───────────────────────────────────────────────────────────────

function FileForm({ loading, setLoading, setError, onResult }: FormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [script, setScript] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const scriptRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!file || !name) return
    setLoading(true); setError(null)
    try { onResult(await modelsApi.deployFromFile(file, name, version, description, true, script ?? undefined)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Model Name *" value={name} onChange={setName} placeholder="my-ocr-model" />
        <Field label="Version" value={version} onChange={setVersion} placeholder="1.0.0" />
      </div>
      <Field label="Description" value={description} onChange={setDescription} placeholder="Optional description" />
      <div>
        <p className="text-xs text-gray-400 mb-2">Model File * <span className="text-gray-600">(.pkl .joblib .onnx .pt .pth .h5 .keras)</span></p>
        <DropZone file={file} setFile={setFile} ref={fileRef} accept=".pkl,.joblib,.onnx,.pt,.pth,.h5,.keras" label="Drop model file or click" />
      </div>
      <div>
        <p className="text-xs text-gray-400 mb-1">Inference Script <span className="text-gray-600">(optional .py — needed for custom formats)</span></p>
        <div onClick={() => scriptRef.current?.click()}
          className={clsx('border border-dashed rounded-xl px-4 py-3 text-xs cursor-pointer transition-colors', script ? 'border-brand-700 text-brand-400' : 'border-gray-700 text-gray-600 hover:border-gray-600')}>
          {script ? script.name : 'Click to attach inference.py'}
          <input ref={scriptRef} type="file" accept=".py" className="hidden" onChange={e => setScript(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <SubmitButton loading={loading} disabled={!file || !name} onClick={submit} label="Deploy File" />
    </div>
  )
}

// ── URI form ────────────────────────────────────────────────────────────────

type UriSource = 'huggingface' | 's3' | 'url' | 'mlflow'

function UriForm({ loading, setLoading, setError, onResult }: FormProps) {
  const [source, setSource] = useState<UriSource>('huggingface')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [uri, setUri] = useState('')
  const [hfTask, setHfTask] = useState('')

  const SOURCES: { id: UriSource; label: string; placeholder: string }[] = [
    { id: 'huggingface', label: 'HuggingFace Hub', placeholder: 'distilbert-base-uncased' },
    { id: 's3', label: 'S3 / MinIO', placeholder: 'models/my_model.pkl' },
    { id: 'url', label: 'HTTP URL', placeholder: 'https://example.com/model.pt' },
    { id: 'mlflow', label: 'MLflow URI', placeholder: 'models:/MyModel/1' },
  ]

  const submit = async () => {
    if (!name || !uri) return
    setLoading(true); setError(null)
    const payload: DeployUriPayload = { name, version, set_as_default: true }
    if (source === 'huggingface') { payload.huggingface_model_id = uri; if (hfTask) payload.huggingface_task = hfTask }
    else if (source === 's3') payload.s3_key = uri
    else if (source === 'url') payload.url = uri
    else payload.mlflow_uri = uri
    try { onResult(await modelsApi.deployFromUri(payload)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  const current = SOURCES.find(s => s.id === source)!

  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-gray-900 rounded-xl p-1 w-fit">
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)}
            className={clsx('px-3 py-1.5 text-xs rounded-lg font-medium transition-colors', s.id === source ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-300')}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Model Name *" value={name} onChange={setName} placeholder="my-model" />
        <Field label="Version" value={version} onChange={setVersion} placeholder="1.0.0" />
      </div>
      <Field label={`${current.label} *`} value={uri} onChange={setUri} placeholder={current.placeholder} />
      {source === 'huggingface' && (
        <Field label="Task (optional)" value={hfTask} onChange={setHfTask} placeholder="text-classification" />
      )}
      <SubmitButton loading={loading} disabled={!name || !uri} onClick={submit} label="Deploy from URI" />
    </div>
  )
}

// ── Shared helpers ──────────────────────────────────────────────────────────

interface FormProps {
  loading: boolean
  setLoading: (v: boolean) => void
  setError: (v: string | null) => void
  onResult: (data: { job_id: string; model_name?: string }) => void
}

const DropZone = forwardRef<HTMLInputElement, {
  file: File | null; setFile: (f: File | null) => void; accept: string; label: string
}>(({ file, setFile, accept, label }, ref) => (
  <div onClick={() => (ref as React.RefObject<HTMLInputElement>).current?.click()}
    className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors', file ? 'border-brand-600 bg-brand-900/20' : 'border-gray-700 hover:border-gray-600')}>
    <Upload size={20} className="mx-auto mb-2 text-gray-500" />
    {file ? (
      <p className="text-sm text-brand-400 font-medium">{file.name} <span className="text-gray-600">({(file.size / 1024).toFixed(0)} KB)</span></p>
    ) : (
      <p className="text-sm text-gray-500">{label}</p>
    )}
    <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
  </div>
))

DropZone.displayName = 'DropZone'

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500" />
    </div>
  )
}

function SubmitButton({ loading, disabled, onClick, label }: { loading: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors">
      {loading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
      {loading ? 'Deploying…' : label}
    </button>
  )
}
