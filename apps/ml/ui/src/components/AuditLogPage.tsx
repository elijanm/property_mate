import { useState, useEffect } from 'react'
import { auditApi, type AuditLog } from '../api/audit'
import { ClipboardList, Search, Loader2 } from 'lucide-react'

const ACTION_COLORS: Record<string, string> = {
  deploy_model: 'text-brand-400',
  ban_ip: 'text-red-400',
  unban_ip: 'text-emerald-400',
  delete_api_key: 'text-orange-400',
  create_ab_test: 'text-purple-400',
  create_alert_rule: 'text-yellow-400',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await auditApi.list({ limit: 200, resource_type: resourceFilter || undefined })
      setLogs(res.items)
      setTotal(res.total)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [resourceFilter])

  const filtered = logs.filter(l =>
    !search || l.actor_email.includes(search) || l.action.includes(search) || l.resource_type.includes(search)
  )

  const RESOURCE_TYPES = ['model', 'api_key', 'ab_test', 'alert_rule', 'ip', 'user']

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Audit Trail</h2>
          <span className="text-xs text-gray-600">{total} total entries</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none">
            <option value="">All resources</option>
            {RESOURCE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter…"
              className="bg-gray-900 border border-gray-800 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-400 focus:outline-none w-40" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center h-32 items-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-800">
                {['Time', 'Actor', 'Action', 'Resource', 'ID', 'IP'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map(log => (
                <tr key={log.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono truncate max-w-[140px]">{log.actor_email}</td>
                  <td className="px-4 py-2.5">
                    <span className={ACTION_COLORS[log.action] ?? 'text-gray-400'}>{log.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{log.resource_type}</td>
                  <td className="px-4 py-2.5 text-gray-600 font-mono truncate max-w-[100px]">{log.resource_id ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600 font-mono">{log.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-10 text-gray-600 text-sm">No entries found</div>}
        </div>
      )}
    </div>
  )
}
