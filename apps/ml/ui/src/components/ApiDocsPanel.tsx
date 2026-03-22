import type { ModelDeployment } from '@/types/trainer'
import { BookOpen, Lock, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'

interface Props {
  deployment: ModelDeployment
  /** full inference alias, e.g. "acme/my_model" — uses trainer_name if not provided */
  alias?: string
  /** org slug prefix for display (first segment of alias when org-owned) */
  orgSlug?: string
}

function apiBase() {
  return `${window.location.origin}/api/v1`
}

function buildExampleInputs(schema: Record<string, unknown>): Record<string, unknown> {
  const ex: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(schema)) {
    const field = f as Record<string, unknown>
    if (field.type === 'image' || field.type === 'file') continue
    if (field.example != null) ex[k] = field.example
    else if (field.default != null) ex[k] = field.default
    else if (field.type === 'number') ex[k] = field.min ?? 0
    else if (field.type === 'boolean') ex[k] = false
    else if (field.enum) ex[k] = (field.enum as string[])[0]
    else ex[k] = `<${k}>`
  }
  return ex
}

function buildExampleOutputs(schema: Record<string, unknown>): Record<string, unknown> {
  const ex: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(schema)) {
    const field = f as Record<string, unknown>
    if (field.example != null) ex[k] = field.example
    else if (field.type === 'number') ex[k] = 0.95
    else if (field.type === 'boolean') ex[k] = true
    else ex[k] = `<${String(field.label ?? k)}>`
  }
  return ex
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-[10px] text-gray-600 font-mono uppercase">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed">{code}</pre>
    </div>
  )
}

type Tab = 'overview' | 'request' | 'response' | 'examples'

export default function ApiDocsPanel({ deployment, alias, orgSlug }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const base = apiBase()
  const name = alias || deployment.trainer_name
  const inputSchema = (deployment.input_schema as Record<string, unknown>) ?? {}
  const outputSchema = (deployment.output_schema as Record<string, unknown>) ?? {}
  const hasFileField = Object.values(inputSchema).some((f: unknown) => {
    const t = (f as Record<string, unknown>)?.type
    return t === 'image' || t === 'file'
  })
  const exInputs = buildExampleInputs(inputSchema)
  const exOutputs = buildExampleOutputs(outputSchema)

  const curlExample = hasFileField
    ? `curl -X POST "${base}/inference/${name}/upload" \\\n  -H "X-Api-Key: <YOUR_API_KEY>" \\\n  -F "file=@/path/to/input.jpg"`
    : `curl -X POST "${base}/inference/${name}" \\\n  -H "X-Api-Key: <YOUR_API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ inputs: exInputs }, null, 2)}'`

  const pythonExample = hasFileField
    ? `import requests\n\nAPI_KEY = "<YOUR_API_KEY>"\n\nwith open("input.jpg", "rb") as f:\n    r = requests.post(\n        "${base}/inference/${name}/upload",\n        headers={"X-Api-Key": API_KEY},\n        files={"file": f},\n    )\nprint(r.json())`
    : `import requests\n\nAPI_KEY = "<YOUR_API_KEY>"\n\nr = requests.post(\n    "${base}/inference/${name}",\n    headers={\n        "X-Api-Key": API_KEY,\n        "Content-Type": "application/json",\n    },\n    json=${JSON.stringify({ inputs: exInputs }, null, 4)},\n)\nprint(r.json())`

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'request',  label: 'Request' },
    { id: 'response', label: 'Response' },
    { id: 'examples', label: 'Examples' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-gray-800">
        <BookOpen size={15} className="text-brand-400" />
        <h3 className="text-sm font-semibold text-white">API Reference</h3>
        <span className="text-xs text-gray-500">—</span>
        {orgSlug && (
          <span className="text-xs font-mono text-indigo-400">{orgSlug}/</span>
        )}
        <span className="text-xs font-mono text-brand-400">{deployment.trainer_name}</span>
        {orgSlug && (
          <span className="px-1.5 py-0.5 text-[10px] bg-indigo-900/40 border border-indigo-700/40 rounded text-indigo-300 font-mono">
            org: {orgSlug}
          </span>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
              tab === t.id ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {[
              { method: 'POST', path: `/inference/${name}`, desc: 'Run inference with JSON inputs', auth: true },
              ...(hasFileField ? [{ method: 'POST', path: `/inference/${name}/upload`, desc: 'Run inference by uploading a file', auth: true }] : []),
              { method: 'POST', path: `/inference/${name}/all-versions`, desc: 'Run inputs against ALL deployed versions — returns array of results', auth: true },
              { method: 'GET',  path: `/inference/${name}/schema`, desc: 'Get input & output schema for this model', auth: true },
            ].map(ep => (
              <div key={ep.path} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
                <span className={clsx('text-[10px] font-bold px-2 py-1 rounded font-mono shrink-0',
                  ep.method === 'POST' ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-blue-900/40 text-blue-400 border border-blue-800')}>
                  {ep.method}
                </span>
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-brand-400 font-mono">{base}{ep.path}</code>
                  <p className="text-xs text-gray-500 mt-1">{ep.desc}</p>
                </div>
                {ep.auth && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 shrink-0">
                    <Lock size={10} /> Auth required
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
              <Lock size={12} className="text-amber-400" /> Authentication
            </h4>
            <p className="text-xs text-gray-500 mb-2">Pass your API key in the <code className="text-amber-300">X-Api-Key</code> header:</p>
            <CodeBlock code={`X-Api-Key: <YOUR_API_KEY>`} lang="http" />
            <p className="text-[11px] text-gray-600 mt-2">Get your API key from <strong className="text-gray-400">Settings → API Keys</strong>.</p>
          </div>
        </div>
      )}

      {tab === 'request' && (
        <div className="space-y-4">
          {hasFileField ? (
            <div className="bg-brand-900/20 border border-brand-800/40 rounded-xl p-3 text-xs text-brand-300">
              This model accepts file uploads. Use <code>multipart/form-data</code> with <code>file</code> field for images/files, or JSON body for URL-based inputs.
            </div>
          ) : null}
          <div>
            <h4 className="text-xs font-semibold text-gray-300 mb-3">
              Request body — <code className="text-brand-400">POST {base}/inference/{name}</code>
            </h4>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/50 border-b border-gray-800">
                    {['Field', 'Type', 'Required', 'Description'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  <tr>
                    <td className="px-4 py-2.5 font-mono text-brand-400">inputs</td>
                    <td className="px-4 py-2.5 text-gray-400">object</td>
                    <td className="px-4 py-2.5 text-red-400">required</td>
                    <td className="px-4 py-2.5 text-gray-500">Key-value pairs matching the input schema below</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-mono text-gray-400">model_version</td>
                    <td className="px-4 py-2.5 text-gray-400">string</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500">Target by MLflow version string (default: latest active)</td>
                  </tr>
                  <tr className="bg-indigo-950/10">
                    <td className="px-4 py-2.5 font-mono text-indigo-300">plugin_version</td>
                    <td className="px-4 py-2.5 text-gray-400">integer</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500">Target a specific plugin file generation (0 = base, 1 = _v1 …)</td>
                  </tr>
                  <tr className="bg-indigo-950/10">
                    <td className="px-4 py-2.5 font-mono text-indigo-300">training_patch</td>
                    <td className="px-4 py-2.5 text-gray-400">integer</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500">Target a specific retraining ordinal (0 = first run, 3 = fourth run …)</td>
                  </tr>
                  <tr className="bg-violet-950/10">
                    <td className="px-4 py-2.5 font-mono text-violet-300">best_metric</td>
                    <td className="px-4 py-2.5 text-gray-400">string</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500">Metric key to rank by — routes to the best-scoring deployment. Overrides other selectors. E.g. <code className="text-violet-400">"accuracy"</code>, <code className="text-violet-400">"f1"</code>, <code className="text-violet-400">"loss"</code></td>
                  </tr>
                  <tr className="bg-violet-950/10">
                    <td className="px-4 py-2.5 font-mono text-violet-300">best_metric_mode</td>
                    <td className="px-4 py-2.5 text-gray-400">string</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500"><code className="text-violet-400">"max"</code> (higher = better, default) or <code className="text-violet-400">"min"</code> (lower = better, use for loss)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-mono text-gray-400">session_id</td>
                    <td className="px-4 py-2.5 text-gray-400">string</td>
                    <td className="px-4 py-2.5 text-gray-600">optional</td>
                    <td className="px-4 py-2.5 text-gray-500">Group related inferences for session-level analytics</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {Object.keys(inputSchema).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-300 mb-3">Input fields — <code className="text-brand-400">inputs</code> object</h4>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/50 border-b border-gray-800">
                      {['Field', 'Type', 'Required', 'Unit', 'Description'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {Object.entries(inputSchema).map(([k, f]) => {
                      const field = f as Record<string, unknown>
                      return (
                        <tr key={k}>
                          <td className="px-4 py-2.5 font-mono text-brand-400">{k}</td>
                          <td className="px-4 py-2.5 text-gray-400 font-mono">{String(field.type ?? 'string')}</td>
                          <td className="px-4 py-2.5">{field.required ? <span className="text-red-400">required</span> : <span className="text-gray-600">optional</span>}</td>
                          <td className="px-4 py-2.5 text-gray-500">{field.unit ? String(field.unit) : '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500">{String(field.description ?? field.label ?? '')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'response' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800/50 border-b border-gray-800">
                  {['Field', 'Type', 'Description'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {[
                  { k: 'trainer_name', t: 'string', d: 'The trainer that served this request' },
                  { k: 'prediction',   t: 'object', d: 'Prediction result containing output fields' },
                  { k: 'log_id',       t: 'string', d: 'ID of the inference log record (use for feedback)' },
                ].map(r => (
                  <tr key={r.k}>
                    <td className="px-4 py-2.5 font-mono text-brand-400">{r.k}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono">{r.t}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.keys(outputSchema).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-300 mb-3">Output fields — inside <code className="text-brand-400">prediction</code></h4>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/50 border-b border-gray-800">
                      {['Field', 'Type', 'Format', 'Description'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {Object.entries(outputSchema).map(([k, f]) => {
                      const field = f as Record<string, unknown>
                      return (
                        <tr key={k}>
                          <td className="px-4 py-2.5 font-mono text-brand-400">{k}</td>
                          <td className="px-4 py-2.5 text-gray-400 font-mono">{String(field.type ?? 'string')}</td>
                          <td className="px-4 py-2.5 text-gray-400">{field.format ? String(field.format) : '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500">{String(field.description ?? field.label ?? '')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold text-gray-300 mb-2">Example response</h4>
            <CodeBlock
              lang="json"
              code={JSON.stringify({
                trainer_name: name,
                prediction: Object.keys(exOutputs).length ? exOutputs : { result: '<value>' },
                log_id: 'abc123def456',
              }, null, 2)}
            />
          </div>
        </div>
      )}

      {tab === 'examples' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-gray-300 mb-2">cURL — standard</h4>
            <CodeBlock code={curlExample} lang="bash" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-gray-300 mb-2">Python — standard</h4>
            <CodeBlock code={pythonExample} lang="python" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-indigo-300 mb-2">Version pinning — target plugin_version + training_patch</h4>
            <CodeBlock lang="python" code={`import requests\n\nAPI_KEY = "<YOUR_API_KEY>"\n\n# Pin to plugin version 1, retraining run 3  (v1.0.0.3)\nr = requests.post(\n    "${base}/inference/${name}",\n    headers={"X-Api-Key": API_KEY},\n    json={\n        "inputs": ${JSON.stringify(Object.keys(exInputs).length ? exInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},\n        "plugin_version": 1,\n        "training_patch": 3,\n    },\n)\nprint(r.json())`} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-violet-300 mb-2">Best metric — route to highest-accuracy deployment</h4>
            <CodeBlock lang="python" code={`import requests\n\nAPI_KEY = "<YOUR_API_KEY>"\n\n# Always route to the deployment with the best accuracy score\nr = requests.post(\n    "${base}/inference/${name}",\n    headers={"X-Api-Key": API_KEY},\n    json={\n        "inputs": ${JSON.stringify(Object.keys(exInputs).length ? exInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},\n        "best_metric": "accuracy",   # "max" mode (default)\n        # "best_metric": "loss",\n        # "best_metric_mode": "min",  # lower loss is better\n    },\n)\nprint(r.json())`} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-emerald-300 mb-2">All versions — fan-out across every deployed version</h4>
            <CodeBlock lang="python" code={`import requests\n\nAPI_KEY = "<YOUR_API_KEY>"\n\n# Run inputs against ALL active deployments and compare\nr = requests.post(\n    "${base}/inference/${name}/all-versions",\n    headers={"X-Api-Key": API_KEY},\n    json={\n        "inputs": ${JSON.stringify(Object.keys(exInputs).length ? exInputs : { value: 42 }, null, 8).replace(/\n/g, '\n        ')},\n    },\n)\ndata = r.json()\nprint(f"Total versions: {data['total']}")\nfor v in data["results"]:\n    status = "ERROR" if v["error"] else "OK"\n    print(f"  {v['version_full'] or 'v?'}  default={v['is_default']}  [{status}]  {v['prediction']}")`} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-gray-300 mb-2">JavaScript (fetch)</h4>
            <CodeBlock
              lang="javascript"
              code={hasFileField
                ? `const API_KEY = "<YOUR_API_KEY>";\n\nasync function runInference(file) {\n  const form = new FormData();\n  form.append("file", file);\n  const r = await fetch("${base}/inference/${name}/upload", {\n    method: "POST",\n    headers: { "X-Api-Key": API_KEY },\n    body: form,\n  });\n  return r.json();\n}`
                : `const API_KEY = "<YOUR_API_KEY>";\n\nconst r = await fetch("${base}/inference/${name}", {\n  method: "POST",\n  headers: {\n    "X-Api-Key": API_KEY,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({ inputs: ${JSON.stringify(exInputs)} }),\n});\nconst result = await r.json();\nconsole.log(result);`
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
