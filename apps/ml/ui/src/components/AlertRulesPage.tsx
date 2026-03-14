import { useState, useEffect } from 'react'
import { alertRulesApi, type AlertRule, type AlertFire } from '../api/alertRules'
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Flame } from 'lucide-react'
import clsx from 'clsx'

const METRICS = ['error_rate', 'latency_p99', 'drift_score', 'request_volume']
const OPS = [{ v: 'gt', l: '>' }, { v: 'lt', l: '<' }, { v: 'gte', l: '>=' }, { v: 'lte', l: '<=' }]

export default function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [fires, setFires] = useState<AlertFire[]>([])
  const [tab, setTab] = useState<'rules' | 'fires'>('rules')
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    name: '',
    metric: 'error_rate',
    trainer_name: '',
    operator: 'gt',
    threshold: 0.05,
    window_minutes: 15,
    cooldown_minutes: 60,
    webhook_url: '',
  })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [r, f] = await Promise.all([alertRulesApi.list(), alertRulesApi.listFires()])
      setRules(r)
      setFires(f)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    setSaving(true)
    try {
      await alertRulesApi.create({
        name: form.name,
        metric: form.metric,
        trainer_name: form.trainer_name || null,
        operator: form.operator,
        threshold: form.threshold,
        window_minutes: form.window_minutes,
        cooldown_minutes: form.cooldown_minutes,
        channels: form.webhook_url ? [{ type: 'webhook', url: form.webhook_url }] : [],
        enabled: true,
      })
      setShowCreate(false)
      await load()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const toggleEnabled = async (rule: AlertRule) => {
    await alertRulesApi.update(rule.id, { enabled: !rule.enabled })
    await load()
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this alert rule?')) return
    await alertRulesApi.delete(id)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">Alert Rules</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {(['rules', 'fires'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={clsx('px-3 py-1.5 text-xs capitalize transition-colors', tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300')}>
                {t} {t === 'fires' && fires.length > 0 && <span className="ml-1 text-red-400">({fires.length})</span>}
              </button>
            ))}
          </div>
          {tab === 'rules' && (
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors">
              <Plus size={12} /> New rule
            </button>
          )}
        </div>
      </div>

      {tab === 'rules' && (
        <>
          {showCreate && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-medium text-white">New alert rule</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Rule name</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="High error rate" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Trainer (leave blank = all)</label>
                  <input value={form.trainer_name} onChange={e => setForm(p => ({ ...p, trainer_name: e.target.value }))}
                    placeholder="e.g. water_meter_ocr" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Metric</label>
                  <select value={form.metric} onChange={e => setForm(p => ({ ...p, metric: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                    {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="space-y-1 w-24">
                    <label className="text-xs text-gray-500">Operator</label>
                    <select value={form.operator} onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                      {OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1 flex-1">
                    <label className="text-xs text-gray-500">Threshold</label>
                    <input type="number" step="any" value={form.threshold} onChange={e => setForm(p => ({ ...p, threshold: +e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Window (minutes)</label>
                  <input type="number" value={form.window_minutes} onChange={e => setForm(p => ({ ...p, window_minutes: +e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Cooldown (minutes)</label>
                  <input type="number" value={form.cooldown_minutes} onChange={e => setForm(p => ({ ...p, cooldown_minutes: +e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-gray-500">Webhook URL (optional)</label>
                  <input value={form.webhook_url} onChange={e => setForm(p => ({ ...p, webhook_url: e.target.value }))}
                    placeholder="https://hooks.example.com/…" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg disabled:opacity-50">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create
                </button>
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-xs text-gray-400 bg-gray-800 rounded-lg">Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center h-24 items-center"><Loader2 size={18} className="animate-spin text-gray-600" /></div>
          ) : rules.length === 0 ? (
            <div className="text-center py-12 text-gray-600 text-sm">No alert rules configured</div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className={clsx('flex items-center gap-4 bg-gray-900 border rounded-xl px-4 py-3', rule.enabled ? 'border-gray-800' : 'border-gray-800/50 opacity-60')}>
                  <button onClick={() => toggleEnabled(rule)} className="text-gray-500 hover:text-gray-300">
                    {rule.enabled ? <ToggleRight size={16} className="text-brand-400" /> : <ToggleLeft size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{rule.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="text-gray-300">{rule.metric}</span>
                      {' '}<span className="text-gray-500">{rule.operator}</span>
                      {' '}<span className="text-yellow-400">{rule.threshold}</span>
                      {' '}over <span className="text-gray-300">{rule.window_minutes}min</span>
                      {rule.trainer_name && <> · trainer: <span className="text-gray-300">{rule.trainer_name}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    {rule.channels.length > 0 && <span className="text-brand-500">&#9889; {rule.channels.map(c => c.type).join(', ')}</span>}
                    <span>cooldown {rule.cooldown_minutes}min</span>
                  </div>
                  <button onClick={() => deleteRule(rule.id)} className="p-1 text-gray-700 hover:text-red-400 rounded transition-colors"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'fires' && (
        <div className="space-y-2">
          {fires.length === 0 ? (
            <div className="text-center py-12 text-gray-600 text-sm">No alert fires recorded</div>
          ) : fires.map(fire => (
            <div key={fire.id} className="flex items-center gap-3 bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
              <Flame size={14} className="text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{fire.rule_name}</div>
                <div className="text-xs text-red-400/80 mt-0.5">{fire.message}</div>
              </div>
              <span className="text-[10px] text-gray-600">{new Date(fire.fired_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
