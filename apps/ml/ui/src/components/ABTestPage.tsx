import { useState, useEffect } from 'react'
import { abTestsApi, type ABTest } from '../api/abTests'
import { trainersApi } from '../api/trainers'
import type { ModelDeployment } from '../types/trainer'
import { FlaskConical, Plus, Pause, Play, Trophy, Trash2, Loader2 } from 'lucide-react'
import clsx from 'clsx'

function MetricCell({ label, value, other }: { label: string; value: number | null; better?: number | null; other?: number | null }) {
  if (value === null) return <td className="px-3 py-2 text-gray-600 text-xs">—</td>
  const isWinning = other !== null && other !== undefined && (
    label === 'Accuracy' ? value > other : value < other
  )
  return (
    <td className={clsx('px-3 py-2 text-xs font-mono', isWinning ? 'text-emerald-400' : 'text-gray-300')}>
      {label === 'Accuracy' ? `${(value * 100).toFixed(1)}%`
        : label === 'Latency' ? `${value.toFixed(0)}ms`
        : label === 'Error rate' ? `${(value * 100).toFixed(2)}%`
        : value.toLocaleString()}
      {isWinning && <span className="ml-1 text-[10px]">▲</span>}
    </td>
  )
}

export default function ABTestPage() {
  const [tests, setTests] = useState<ABTest[]>([])
  const [deployments, setDeployments] = useState<ModelDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', model_a: '', model_b: '', traffic_pct_b: 10 })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [t, d] = await Promise.all([abTestsApi.list(), trainersApi.listDeployments()])
      setTests(t)
      setDeployments(d)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.name || !form.model_a || !form.model_b) return
    setSaving(true)
    try {
      await abTestsApi.create(form)
      setShowCreate(false)
      setForm({ name: '', description: '', model_a: '', model_b: '', traffic_pct_b: 10 })
      await load()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  const toggleStatus = async (test: ABTest) => {
    await abTestsApi.update(test.id, { status: test.status === 'active' ? 'paused' : 'active' })
    await load()
  }

  const conclude = async (test: ABTest, winner: string) => {
    await abTestsApi.update(test.id, { status: 'concluded', winner })
    await load()
  }

  const deleteTest = async (id: string) => {
    if (!confirm('Delete this A/B test?')) return
    await abTestsApi.delete(id)
    await load()
  }

  const trainerNames = [...new Set(deployments.map(d => d.trainer_name))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-white">A/B Tests</h2>
          <span className="text-xs text-gray-600">{tests.length} total</span>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors">
          <Plus size={12} /> New test
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Create A/B test</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Test name', key: 'name', type: 'text', placeholder: 'v2-challenger' },
              { label: 'Description', key: 'description', type: 'text', placeholder: 'Optional' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-gray-500">{f.label}</label>
                <input type={f.type} value={(form as Record<string, unknown>)[f.key] as string}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500" />
              </div>
            ))}
            {[
              { label: 'Model A (control)', key: 'model_a' },
              { label: 'Model B (challenger)', key: 'model_b' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-gray-500">{f.label}</label>
                <select value={(form as Record<string, unknown>)[f.key] as string}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                  <option value="">Select trainer…</option>
                  {trainerNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            ))}
            <div className="space-y-1 col-span-2">
              <label className="text-xs text-gray-500">Traffic to Model B: <span className="text-brand-400 font-semibold">{form.traffic_pct_b}%</span></label>
              <input type="range" min={1} max={99} value={form.traffic_pct_b}
                onChange={e => setForm(p => ({ ...p, traffic_pct_b: +e.target.value }))}
                className="w-full accent-brand-500" />
              <div className="flex justify-between text-[10px] text-gray-600">
                <span>Model A: {100 - form.traffic_pct_b}%</span>
                <span>Model B: {form.traffic_pct_b}%</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-gray-600" /></div>
      ) : tests.length === 0 ? (
        <div className="text-center py-16 text-gray-600 text-sm">No A/B tests yet — create one to start comparing models</div>
      ) : (
        <div className="space-y-4">
          {tests.map(test => (
            <div key={test.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <span className={clsx('w-2 h-2 rounded-full', test.status === 'active' ? 'bg-emerald-400 animate-pulse' : test.status === 'paused' ? 'bg-yellow-400' : 'bg-gray-600')} />
                  <span className="text-sm font-medium text-white">{test.name}</span>
                  {test.description && <span className="text-xs text-gray-500">{test.description}</span>}
                  <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border', test.status === 'active' ? 'text-emerald-400 border-emerald-800 bg-emerald-900/20' : test.status === 'paused' ? 'text-yellow-400 border-yellow-800 bg-yellow-900/20' : 'text-gray-500 border-gray-700')}>{test.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  {test.status !== 'concluded' && (
                    <>
                      <button onClick={() => toggleStatus(test)} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                        {test.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button onClick={() => conclude(test, 'a')} title="Declare A winner" className="px-2 py-1 text-[10px] text-gray-400 hover:text-emerald-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors">A wins</button>
                      <button onClick={() => conclude(test, 'b')} title="Declare B winner" className="px-2 py-1 text-[10px] text-gray-400 hover:text-emerald-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors">B wins</button>
                    </>
                  )}
                  <button onClick={() => deleteTest(test.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>

              {/* Metrics comparison table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/50">
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Variant</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Requests</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Error rate</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Latency</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Accuracy</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">Traffic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: `A · ${test.model_a}`, m: test.metrics_a, pct: 100 - test.traffic_pct_b, winner: test.winner === 'a' },
                      { label: `B · ${test.model_b}`, m: test.metrics_b, pct: test.traffic_pct_b, winner: test.winner === 'b' },
                    ].map(({ label, m, pct, winner }) => (
                      <tr key={label} className="border-t border-gray-800 hover:bg-gray-800/30">
                        <td className="px-3 py-2 font-medium text-gray-300">
                          {label} {winner && <Trophy size={10} className="inline text-yellow-400 ml-1" />}
                        </td>
                        <MetricCell label="Requests" value={m.requests} />
                        <MetricCell label="Error rate" value={m.error_rate} other={label.startsWith('A') ? test.metrics_b.error_rate : test.metrics_a.error_rate} />
                        <MetricCell label="Latency" value={m.avg_latency_ms} other={label.startsWith('A') ? test.metrics_b.avg_latency_ms : test.metrics_a.avg_latency_ms} />
                        <MetricCell label="Accuracy" value={m.accuracy} other={label.startsWith('A') ? test.metrics_b.accuracy : test.metrics_a.accuracy} />
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-gray-500 text-[10px]">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
