import { useState, useEffect } from 'react'
import { adminApi, type Coupon } from '@/api/admin'
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp, CheckCircle2, XCircle, Tag } from 'lucide-react'

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<Coupon | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try { setCoupons(await adminApi.listCoupons()) } catch { setError('Failed to load coupons') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(code: string) {
    if (!confirm(`Delete coupon ${code}? This cannot be undone.`)) return
    await adminApi.deleteCoupon(code)
    load()
  }

  async function handleToggle(coupon: Coupon) {
    await adminApi.updateCoupon(coupon.code, { is_active: !coupon.is_active })
    load()
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Tag size={18} className="text-sky-400" /> Coupon Codes
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Credit users' wallets automatically on signup</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowCreate(true) }}
          className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
        >
          <Plus size={14} /> New coupon
        </button>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg px-4 py-2">{error}</div>}

      {showCreate && (
        <CouponForm
          initial={editTarget}
          onSave={async (data) => {
            if (editTarget) {
              await adminApi.updateCoupon(editTarget.code, data)
            } else {
              await adminApi.createCoupon(data as Parameters<typeof adminApi.createCoupon>[0])
            }
            setShowCreate(false)
            setEditTarget(null)
            load()
          }}
          onCancel={() => { setShowCreate(false); setEditTarget(null) }}
        />
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Tag size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No coupons yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map(c => (
            <div key={c.code} className="bg-gray-900/60 border border-white/8 rounded-xl overflow-hidden">
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Code + status */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono text-sm font-bold text-sky-300 bg-sky-900/30 border border-sky-800/40 px-2 py-0.5 rounded">{c.code}</span>
                  {c.is_active
                    ? <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-900/30 border border-emerald-800/30 px-1.5 py-0.5 rounded-full">ACTIVE</span>
                    : <span className="text-[10px] font-semibold text-gray-500 bg-gray-800/40 border border-gray-700/30 px-1.5 py-0.5 rounded-full">INACTIVE</span>
                  }
                  {c.description && <span className="text-xs text-gray-500 truncate">{c.description}</span>}
                </div>

                {/* Stats */}
                <div className="hidden sm:flex items-center gap-6 text-xs text-gray-400 shrink-0">
                  <div className="text-center">
                    <div className="text-white font-semibold">${c.credit_usd}</div>
                    <div className="text-gray-600">credit</div>
                  </div>
                  <div className="text-center">
                    <div className={`font-semibold ${c.credit_type === 'accelerated' ? 'text-violet-400' : 'text-sky-400'}`}>
                      {c.credit_type === 'accelerated' ? '⚡ Accelerated' : '🖥 Standard'}
                    </div>
                    <div className="text-gray-600">compute</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white font-semibold">{c.uses_count}{c.max_uses > 0 ? `/${c.max_uses}` : ''}</div>
                    <div className="text-gray-600">uses</div>
                  </div>
                  {c.expires_at && (
                    <div className="text-center">
                      <div className="text-white font-semibold">{new Date(c.expires_at).toLocaleDateString()}</div>
                      <div className="text-gray-600">expires</div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggle(c)} title={c.is_active ? 'Deactivate' : 'Activate'}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors">
                    {c.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                  <button onClick={() => { setEditTarget(c); setShowCreate(true) }} title="Edit"
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(c.code)} title="Delete"
                    className="p-1.5 rounded-lg hover:bg-white/5 text-red-600 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                  <button onClick={() => setExpanded(expanded === c.code ? null : c.code)}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors">
                    {expanded === c.code ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {/* Redemptions list */}
              {expanded === c.code && (
                <div className="border-t border-white/5 px-5 py-3">
                  {(c.recent_redemptions ?? []).length === 0 ? (
                    <p className="text-xs text-gray-600">No redemptions yet.</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500 mb-2">Recent redemptions:</p>
                      {(c.recent_redemptions ?? []).map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-gray-400">
                          <span>{r.user_email}</span>
                          <span className="text-emerald-400">+${r.credit_usd} · {new Date(r.redeemed_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CouponForm({ initial, onSave, onCancel }: {
  initial: Coupon | null
  onSave: (data: object) => Promise<void>
  onCancel: () => void
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [creditUsd, setCreditUsd] = useState(String(initial?.credit_usd ?? ''))
  const [creditType, setCreditType] = useState<'standard' | 'accelerated'>(initial?.credit_type ?? 'standard')
  const [maxUses, setMaxUses] = useState(String(initial?.max_uses ?? '0'))
  const [expiresAt, setExpiresAt] = useState(initial?.expires_at ? initial.expires_at.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit() {
    if (!initial && !code.trim()) { setErr('Code is required'); return }
    const credit = parseFloat(creditUsd)
    if (isNaN(credit) || credit <= 0) { setErr('Credit must be a positive number'); return }
    setSaving(true)
    try {
      await onSave({
        code: code.trim().toUpperCase(),
        description,
        credit_usd: credit,
        credit_type: creditType,
        max_uses: parseInt(maxUses) || 0,
        expires_at: expiresAt || null,
      })
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-sky-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors"

  return (
    <div className="bg-gray-900/80 border border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">{initial ? `Edit ${initial.code}` : 'New coupon'}</h3>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        {!initial && (
          <div className="col-span-2 sm:col-span-1 space-y-1">
            <label className="text-xs text-gray-400">Code</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" className={inputCls} />
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Credit (USD)</label>
          <input type="number" min="0.01" step="0.01" value={creditUsd} onChange={e => setCreditUsd(e.target.value)} placeholder="5.00" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Compute type</label>
          <div className="flex gap-2">
            {(['standard', 'accelerated'] as const).map(t => (
              <button key={t} type="button" onClick={() => setCreditType(t)}
                className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  creditType === t
                    ? t === 'accelerated'
                      ? 'border-violet-500 bg-violet-900/30 text-violet-300'
                      : 'border-sky-500 bg-sky-900/30 text-sky-300'
                    : 'border-white/10 text-gray-500 hover:border-white/20 hover:text-gray-300'
                }`}>
                {t === 'accelerated' ? '⚡ Accelerated' : '🖥 Standard'}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-600">
            {creditType === 'accelerated' ? 'Credits cloud GPU (general balance)' : 'Credits CPU / local GPU (standard balance)'}
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Max uses <span className="text-gray-600">(0 = unlimited)</span></label>
          <input type="number" min="0" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="0" className={inputCls} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-gray-400">Description <span className="text-gray-600">(internal note)</span></label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Launch promo — Q1 2026" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Expires <span className="text-gray-600">(optional)</span></label>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleSubmit} disabled={saving}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create coupon'}
        </button>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">Cancel</button>
      </div>
    </div>
  )
}
