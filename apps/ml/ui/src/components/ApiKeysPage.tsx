import { useState, useEffect } from 'react'
import { apiKeysApi, type ApiKey } from '../api/apiKeys'
import { useAuth } from '../context/AuthContext'
import { Key, Plus, Trash2, Copy, Check, Loader2 } from 'lucide-react'

const NON_ADMIN_RATE = 10

export default function ApiKeysPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', rate_limit_per_min: isAdmin ? 60 : NON_ADMIN_RATE })
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setKeys(await apiKeysApi.list()) }
    catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.name) return
    setSaving(true)
    try {
      const res = await apiKeysApi.create(form.name, form.rate_limit_per_min)
      setNewKey(res.key)
      setShowCreate(false)
      setForm({ name: '', rate_limit_per_min: 60 })
      await load()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const copyKey = () => {
    if (!newKey) return
    navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const revoke = async (id: string) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    await apiKeysApi.revoke(id)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">API Keys</h2>
          <span className="text-xs text-gray-600">{keys.length} active</span>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors">
          <Plus size={12} /> New key
        </button>
      </div>

      {newKey && (
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 space-y-2">
          <p className="text-xs text-emerald-400 font-medium">Key created — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-900 text-emerald-300 text-xs font-mono px-3 py-2 rounded-lg overflow-x-auto">{newKey}</code>
            <button onClick={copyKey} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-gray-500 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white">New API key</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Key name</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="my-service-key" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Rate limit (req/min)</label>
              {isAdmin ? (
                <input type="number" value={form.rate_limit_per_min} onChange={e => setForm(p => ({ ...p, rate_limit_per_min: +e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
              ) : (
                <div className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-500">
                  {NON_ADMIN_RATE}/min <span className="text-gray-700">(admin-controlled)</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Generate
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-xs text-gray-400 bg-gray-800 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center h-24 items-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12 text-gray-600 text-sm">No API keys — create one to enable programmatic access</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-800">
                {['Name', 'Prefix', 'Rate limit', 'Usage', 'Last used', 'Created', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {keys.map(k => (
                <tr key={k.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-400">{k.prefix}…</td>
                  <td className="px-4 py-3 text-gray-400">{k.rate_limit_per_min}/min</td>
                  <td className="px-4 py-3 text-gray-400">{k.usage_count.toLocaleString()} calls</td>
                  <td className="px-4 py-3 text-gray-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => revoke(k.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
