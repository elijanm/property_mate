import { useState, useEffect } from 'react'
import { annotatorApi } from '@/api/annotator'
import type {
  AnnotatorProfile,
  AnnotatorStats,
  AnnotatorTask,
  RewardSummary,
  RewardRedemption,
  PlatformRewardRate,
} from '@/types/annotator'
import {
  LayoutDashboard, ListTodo, Gift, User,
  Star, CheckCircle, AlertCircle, Copy, Share2,
  ChevronRight, Loader2, LogOut,
  Upload, ShieldCheck, ShieldAlert, ShieldX, Camera,
  MapPin, Layers, Heart,
} from 'lucide-react'
import clsx from 'clsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  agriculture: '🌾',
  livestock: '🐄',
  wildlife: '🦁',
  medical: '🏥',
  document: '📄',
  traffic: '🚗',
  retail: '🛍️',
  construction: '🏗️',
  default: '📊',
}

function categoryEmoji(cat: string) {
  return CATEGORY_EMOJI[cat?.toLowerCase()] ?? CATEGORY_EMOJI.default
}

const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'UG', name: 'Uganda' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GH', name: 'Ghana' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'EG', name: 'Egypt' },
  { code: 'MA', name: 'Morocco' },
]

function fmt(n: number) { return n.toLocaleString() }

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'sent'
      ? 'bg-green-900/40 text-green-400 border-green-800/40'
      : status === 'failed'
      ? 'bg-red-900/40 text-red-400 border-red-800/40'
      : 'bg-amber-900/40 text-amber-400 border-amber-800/40'
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${cls}`}>
      {status}
    </span>
  )
}

// ── KYC Upload Form ────────────────────────────────────────────────────────────
function KycUploadForm({ profileEmail: _, onSubmitted }: { profileEmail: string; onSubmitted: (p: AnnotatorProfile) => void }) {
  const [avatar, setAvatar] = useState<File | null>(null)
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idBack, setIdBack] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const handleSubmit = async () => {
    if (!avatar || !idFront || !idBack) { setErr('Please upload all 3 documents'); return }
    setSubmitting(true)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('avatar', avatar)
      fd.append('id_front', idFront)
      fd.append('id_back', idBack)
      await annotatorApi.submitKyc(fd)
      const updated = await annotatorApi.getProfile()
      onSubmitted(updated)
    } catch (e: unknown) {
      const anyErr = e as { response?: { data?: { detail?: string } } }
      setErr(anyErr?.response?.data?.detail ?? 'Upload failed. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      {[
        { label: 'Selfie / Avatar', file: avatar, setter: setAvatar },
        { label: 'ID Front', file: idFront, setter: setIdFront },
        { label: 'ID Back', file: idBack, setter: setIdBack },
      ].map(({ label, file, setter }) => (
        <div key={label}>
          <label className="text-xs text-gray-400 block mb-1">{label}</label>
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
            file ? 'border-indigo-600/50 bg-indigo-900/20 text-indigo-300' : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600'
          }`}>
            <Camera size={14} />
            {file ? file.name : 'Tap to upload image'}
            <input type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && setter(e.target.files[0])} />
          </label>
        </div>
      ))}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
      >
        {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <><Upload size={14} /> Submit for Verification</>}
      </button>
    </div>
  )
}

// ── Tab types ─────────────────────────────────────────────────────────────────
type Tab = 'dashboard' | 'tasks' | 'rewards' | 'profile'

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ profile, stats, rate }: { profile: AnnotatorProfile; stats: AnnotatorStats | null; rate: PlatformRewardRate | null }) {
  const name = profile.full_name || profile.email.split('@')[0]

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="bg-gradient-to-br from-indigo-950 to-gray-900 border border-indigo-800/40 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {name[0].toUpperCase()}
          </div>
          <div>
            <div className="text-white font-bold text-lg">Hello, {name}! 👋</div>
            <div className="text-indigo-300 text-xs">Keep contributing and earning rewards!</div>
          </div>
        </div>
        {rate && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="inline-flex items-center gap-1.5 bg-amber-900/30 border border-amber-800/40 rounded-full px-3 py-1 text-xs font-semibold text-amber-300">
              <Star size={10} fill="currentColor" />
              1 pt = {rate.one_point_value}
            </span>
            <span className="text-[10px] text-indigo-400/60">
              ${rate.point_value_usd} USD × {(rate.exchange_rates[rate.currency] ?? 1).toFixed(0)} = {rate.currency}
            </span>
          </div>
        )}
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Entries', value: fmt(stats.total_entries), color: 'text-sky-400' },
            { label: 'Total Points', value: fmt(stats.total_points), color: 'text-indigo-400' },
            { label: 'Active Tasks', value: fmt(stats.total_tasks), color: 'text-emerald-400' },
            { label: 'Local Value', value: stats.local_formatted ?? `KES ${stats.kes_value.toFixed(2)}`, color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Rank */}
      {stats?.rank && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="text-2xl">🏆</div>
          <div>
            <div className="text-white font-semibold text-sm">You're ranked #{stats.rank} on the platform</div>
            <div className="text-xs text-gray-500 mt-0.5">Keep submitting to climb higher!</div>
          </div>
        </div>
      )}

      {/* Redeemable summary */}
      {stats && stats.redeemable_points > 0 && (
        <div className="bg-green-950/30 border border-green-800/30 rounded-xl p-4">
          <div className="text-green-400 font-bold text-lg">{fmt(stats.redeemable_points)} pts</div>
          <div className="text-xs text-green-300/70">= {stats.local_formatted ?? `KES ${stats.kes_value.toFixed(2)}`} redeemable</div>
        </div>
      )}
    </div>
  )
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onJoin,
  joining,
  onCollect,
  rate,
}: {
  task: AnnotatorTask
  onJoin?: () => void
  joining?: boolean
  onCollect?: () => void
  rate?: PlatformRewardRate | null
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="text-2xl flex-shrink-0">{categoryEmoji(task.category)}</div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold text-sm leading-tight">{task.name}</div>
          {task.description && (
            <div className="text-gray-500 text-xs mt-0.5 line-clamp-2">{task.description}</div>
          )}
        </div>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {task.points_enabled && task.points_per_entry > 0 ? (
          <span className="flex items-center gap-1 text-xs bg-amber-900/30 text-amber-400 border border-amber-800/40 rounded-full px-2 py-0.5 font-semibold">
            🏆 {task.points_per_entry} pts/entry
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs bg-indigo-900/30 text-indigo-400 border border-indigo-800/40 rounded-full px-2 py-0.5 font-semibold">
            <Heart size={10} /> Community
          </span>
        )}
        {task.points_enabled && task.points_per_entry > 0 && rate && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-500 bg-emerald-900/20 border border-emerald-900/30 rounded-full px-2 py-0.5 font-semibold">
            ≈ {rate.currency} {(task.points_per_entry * (rate.exchange_rates[rate.currency] ?? 1) * rate.point_value_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })} /entry
          </span>
        )}
        {task.field_count !== undefined && task.field_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-800 border border-gray-700 rounded-full px-2 py-0.5">
            <Layers size={9} /> {task.field_count} field{task.field_count !== 1 ? 's' : ''}
          </span>
        )}
        {task.require_location && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-900/20 border border-amber-900/30 rounded-full px-2 py-0.5">
            <MapPin size={9} /> Location required
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>{task.entry_count > 0 ? `${fmt(task.entry_count)} my entries` : 'No entries yet'}</span>
        <span>{fmt(task.total_entries)} total contributions</span>
      </div>

      {/* Progress bar for non-repeatable tasks */}
      {task.joined && task.required_fields_count !== undefined && task.required_fields_count > 0 && !task.is_repeatable && (
        <div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${task.is_done ? 'bg-emerald-500' : 'bg-indigo-500'}`}
              style={{ width: `${Math.min(100, (task.entry_count / task.required_fields_count) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-gray-600 mt-1">{task.entry_count} / {task.required_fields_count} required</div>
        </div>
      )}

      {/* Status badge */}
      {task.joined && task.is_done !== undefined && (
        <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full w-fit ${
          task.is_done
            ? 'bg-emerald-900/30 border border-emerald-800/40 text-emerald-400'
            : 'bg-indigo-900/30 border border-indigo-800/40 text-indigo-400'
        }`}>
          {task.is_done ? <><CheckCircle size={11} /> Completed</> : <><Star size={11} /> In progress</>}
        </div>
      )}

      {/* CTA */}
      {task.joined ? (
        task.is_done && !task.is_repeatable ? (
          <div className="w-full py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 text-sm font-semibold text-center flex items-center justify-center gap-2">
            <CheckCircle size={14} className="text-emerald-500" /> Task Completed
          </div>
        ) : (
          <button
            onClick={onCollect}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {task.is_repeatable || task.entry_count > 0 ? 'Add More Data' : 'Start Contributing'} <ChevronRight size={14} />
          </button>
        )
      ) : (
        <button
          onClick={onJoin}
          disabled={joining}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {joining ? <Loader2 size={14} className="animate-spin" /> : null}
          {joining ? 'Joining…' : 'Join & Start'}
        </button>
      )}
    </div>
  )
}

function TasksTab({ onCollect }: { onCollect: (token: string) => void }) {
  const [subTab, setSubTab] = useState<'available' | 'mine'>('available')
  const [available, setAvailable] = useState<AnnotatorTask[]>([])
  const [mine, setMine] = useState<AnnotatorTask[]>([])
  const [loading, setLoading] = useState(true)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [rate, setRate] = useState<PlatformRewardRate | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    Promise.all([annotatorApi.getTasks(), annotatorApi.getMyTasks(), annotatorApi.getRewardRate()])
      .then(([avail, myTasks, r]) => {
        setAvailable(avail.items)
        setMine(myTasks.items)
        setRate(r as unknown as PlatformRewardRate)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleJoin = async (task: AnnotatorTask) => {
    setJoiningId(task.dataset_id)
    try {
      const res = await annotatorApi.joinTask(task.dataset_id)
      showToast(`Joined "${task.name}" — start contributing!`)
      const joined = { ...task, joined: true, token: res.token, entry_count: 0, is_done: false }
      setAvailable(prev => prev.map(t => t.dataset_id === task.dataset_id ? joined : t))
      setMine(prev => prev.find(t => t.dataset_id === task.dataset_id) ? prev : [joined, ...prev])
      // Auto-navigate to collect if there's a token
      if (res.token) onCollect(res.token)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showToast(msg ?? 'Failed to join task')
    } finally {
      setJoiningId(null)
    }
  }

  const tasks = subTab === 'available' ? available : mine

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1">
        {(['available', 'mine'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={clsx(
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors capitalize',
              subTab === t ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {t === 'available' ? 'Available' : 'My Tasks'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 size={20} className="animate-spin text-gray-600 mx-auto" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <ListTodo size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">
            {subTab === 'available' ? 'No tasks available right now.' : "You haven't joined any tasks yet."}
          </p>
          {subTab === 'mine' && (
            <p className="text-xs text-gray-600">
              Browse the <button onClick={() => setSubTab('available')} className="text-indigo-400 underline">Available</button> tab to find tasks and start contributing.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <TaskCard
              key={task.dataset_id}
              task={task}
              joining={joiningId === task.dataset_id}
              onJoin={() => handleJoin(task)}
              onCollect={() => task.token && onCollect(task.token)}
              rate={rate}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-4 right-4 z-50 bg-gray-800 border border-gray-700 text-white text-sm text-center py-3 px-4 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Rewards Tab ───────────────────────────────────────────────────────────────
function RewardsTab({ profile, onNavigateProfile }: { profile: AnnotatorProfile; onNavigateProfile: () => void }) {
  const [rewards, setRewards] = useState<RewardSummary | null>(null)
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const [rewardRate, setRewardRate] = useState<PlatformRewardRate | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRedeem, setShowRedeem] = useState(false)
  const [phone, setPhone] = useState(profile.phone_number ?? '')
  const [redeemPts, setRedeemPts] = useState(100)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    Promise.allSettled([annotatorApi.getRewards(), annotatorApi.getRedemptions(), annotatorApi.getRewardRate()])
      .then(([rRes, histRes, rateRes]) => {
        if (rRes.status === 'fulfilled') {
          setRewards(rRes.value)
          if (rRes.value.redeemable >= rRes.value.min_redemption_points) {
            setRedeemPts(rRes.value.min_redemption_points)
          }
        }
        if (histRes.status === 'fulfilled') setRedemptions(histRes.value.items)
        if (rateRes.status === 'fulfilled') setRewardRate(rateRes.value)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleRedeem = async () => {
    if (!phone) { setRedeemMsg({ text: 'Enter your phone number', ok: false }); return }
    setRedeeming(true)
    setRedeemMsg(null)
    try {
      await annotatorApi.redeemRewards(redeemPts, phone)
      setRedeemMsg({ text: 'Redeemed! Check your phone for airtime 🎉', ok: true })
      setShowRedeem(false)
      const [r, hist] = await Promise.all([annotatorApi.getRewards(), annotatorApi.getRedemptions()])
      setRewards(r)
      setRedemptions(hist.items)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRedeemMsg({ text: msg ?? 'Redemption failed', ok: false })
    } finally {
      setRedeeming(false)
    }
  }

  if (loading) return <div className="py-12 text-center"><Loader2 size={20} className="animate-spin text-gray-600 mx-auto" /></div>
  if (!rewards) return (
    <div className="py-16 text-center space-y-3">
      <Gift size={36} className="text-gray-700 mx-auto" />
      <p className="text-white font-semibold">No rewards yet</p>
      <p className="text-sm text-gray-500">Complete tasks to earn points you can redeem for airtime.</p>
    </div>
  )

  const localValueForPts = rewardRate
    ? Math.round(redeemPts * (rewardRate.exchange_rates[rewards.local_currency] ?? 1) * rewardRate.point_value_usd)
    : redeemPts * 0.1

  return (
    <div className="space-y-5">
      {/* Rate explainer — always visible at top */}
      <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Star size={14} className="text-amber-400" fill="currentColor" />
          <span className="text-sm font-semibold text-white">How points work</span>
        </div>
        {rewardRate ? (
          <>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-3xl font-extrabold text-amber-400">1 pt</span>
              <span className="text-xl text-gray-400">=</span>
              <span className="text-3xl font-extrabold text-emerald-400">{rewardRate.one_point_value}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Based on <span className="text-gray-400">${rewardRate.point_value_usd} USD</span> × {rewardRate.exchange_rates[rewardRate.currency]?.toFixed(0) ?? '–'} {rewardRate.currency}/USD exchange rate
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-900/60 rounded-lg px-3 py-2">
                <div className="text-gray-500">100 points</div>
                <div className="text-white font-semibold mt-0.5">{rewardRate.hundred_points_value}</div>
              </div>
              <div className="bg-gray-900/60 rounded-lg px-3 py-2">
                <div className="text-gray-500">Min redemption</div>
                <div className="text-white font-semibold mt-0.5">{fmt(rewardRate.min_redemption_points)} pts</div>
              </div>
            </div>
            {!rewards.local_currency || rewards.local_currency === 'USD' ? (
              <p className="text-[11px] text-gray-600 mt-2.5">
                Set your country in Profile to see your local currency value.
              </p>
            ) : (
              <p className="text-[11px] text-indigo-400/70 mt-2.5">
                Currency auto-detected from your country ({rewardRate.currency})
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-600">Loading rate…</p>
        )}
      </div>

      {/* Summary card */}
      <div className="bg-gradient-to-br from-amber-950/40 to-gray-900 border border-amber-800/30 rounded-2xl p-5 space-y-4">
        <div className="text-center">
          <div className="text-3xl font-extrabold text-amber-400">{fmt(rewards.total_earned)} pts</div>
          <div className="text-xs text-gray-500 mt-1">Total earned</div>
          {rewardRate && rewards.total_earned > 0 && (
            <div className="text-xs text-amber-300/60 mt-0.5">
              ≈ {rewardRate.currency} {(rewards.total_earned * (rewardRate.exchange_rates[rewardRate.currency] ?? 1) * rewardRate.point_value_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-900/60 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-emerald-400">{fmt(rewards.redeemable)}</div>
            <div className="text-xs text-gray-500">Redeemable pts</div>
            <div className="text-xs text-emerald-300/70 mt-0.5">= {rewards.local_formatted ?? `KES ${rewards.kes_value.toFixed(2)}`}</div>
          </div>
          <div className="bg-gray-900/60 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-gray-400">{fmt(rewards.total_redeemed)}</div>
            <div className="text-xs text-gray-500">Redeemed pts</div>
          </div>
        </div>
      </div>

      {/* KYC prompt */}
      {rewards.kyc_required && rewards.kyc_status !== 'approved' && (
        <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={16} className="text-amber-400" />
            <span className="text-amber-300 text-sm font-semibold">Identity Verification Required</span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            You need to verify your identity to withdraw this amount.
            {rewards.kyc_status === 'pending' && ' Your documents are under review.'}
            {rewards.kyc_status === 'rejected' && ' Your previous submission was rejected. Please resubmit.'}
          </p>
          {rewards.kyc_status !== 'pending' && (
            <button onClick={onNavigateProfile} className="text-xs text-amber-400 underline">
              Upload ID documents →
            </button>
          )}
        </div>
      )}

      {/* Redeem section */}
      {rewards.can_redeem ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
          <button
            onClick={() => setShowRedeem(!showRedeem)}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors"
          >
            🎁 Redeem for Airtime
          </button>

          {showRedeem && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Phone Number (receive airtime)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+254700000000"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">
                  Points to redeem (min {rewards.min_redemption_points}, max {rewards.redeemable})
                </label>
                <input
                  type="range"
                  min={rewards.min_redemption_points}
                  max={rewards.redeemable}
                  step={rewards.min_redemption_points}
                  value={redeemPts}
                  onChange={e => setRedeemPts(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{fmt(redeemPts)} pts</span>
                  <span className="text-emerald-400 font-semibold">
                    = {rewards.local_currency} {localValueForPts.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              {redeemMsg && (
                <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${redeemMsg.ok ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                  {redeemMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                  {redeemMsg.text}
                </div>
              )}
              <button
                onClick={handleRedeem}
                disabled={redeeming}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {redeeming && <Loader2 size={14} className="animate-spin" />}
                Redeem {fmt(redeemPts)} pts for {rewards.local_currency} {localValueForPts.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
          <div className="text-gray-500 text-sm">
            Minimum {rewards.min_redemption_points} points to redeem
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (rewards.redeemable / rewards.min_redemption_points) * 100)}%` }}
            />
          </div>
          <div className="text-xs text-gray-600 mt-1.5">{rewards.redeemable} / {rewards.min_redemption_points} pts</div>
        </div>
      )}

      {/* History */}
      {redemptions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Redemption History</div>
          <div className="space-y-2">
            {redemptions.map(r => (
              <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm text-white font-semibold">{fmt(r.points_redeemed)} pts → KES {r.kes_value.toFixed(2)}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.phone_number} · {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ profile, onUpdated, onLogout }: { profile: AnnotatorProfile; onUpdated: (p: AnnotatorProfile) => void; onLogout: () => void }) {

  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone_number ?? '')
  const [country, setCountry] = useState(profile.country)
  const [county, setCounty] = useState(profile.county ?? '')
  const [bio, setBio] = useState(profile.bio)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copyDone, setCopyDone] = useState(false)

  const frontendBase = (typeof window !== 'undefined' && (window as unknown as { VITE_FRONTEND_BASE_URL?: string }).VITE_FRONTEND_BASE_URL)
    ? (window as unknown as { VITE_FRONTEND_BASE_URL?: string }).VITE_FRONTEND_BASE_URL
    : window.location.origin
  const referralLink = `${frontendBase}/register?ref=${profile.referral_code}`
  const shareMsg = `I've earned ${fmt(profile.total_points_earned)} points on MLDock.io by contributing data! Join me: ${referralLink}`

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const updated = await annotatorApi.updateProfile({ full_name: fullName, phone_number: phone || null, country, county, bio })
      onUpdated(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const copyRef = () => {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    })
  }

  const nativeShare = () => {
    if (navigator.share) {
      navigator.share({ title: 'Join MLDock.io', text: shareMsg, url: referralLink }).catch(() => {})
    }
  }

  return (
    <div className="space-y-5">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white font-extrabold text-3xl">
          {(profile.full_name || profile.email)[0].toUpperCase()}
        </div>
        <div className="text-white font-semibold">{profile.full_name || profile.email.split('@')[0]}</div>
        <div className="text-gray-500 text-xs">{profile.email}</div>
      </div>

      {/* Edit fields */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Edit Profile</div>
        {[
          { label: 'Full Name', val: fullName, set: setFullName, type: 'text', placeholder: 'Your name' },
          { label: 'Phone Number', val: phone, set: setPhone, type: 'tel', placeholder: '+254700000000' },
        ].map(({ label, val, set, type, placeholder }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1.5">{label}</label>
            <input
              type={type}
              value={val}
              onChange={e => set(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
        ))}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Country</label>
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">County / State</label>
          <input
            type="text"
            value={county}
            onChange={e => setCounty(e.target.value)}
            placeholder="e.g. Nairobi, Mombasa"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Bio</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Tell us about yourself…"
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* KYC Section */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          {profile.kyc_status === 'approved'
            ? <ShieldCheck size={16} className="text-emerald-400" />
            : profile.kyc_status === 'pending'
            ? <ShieldAlert size={16} className="text-amber-400" />
            : profile.kyc_status === 'rejected'
            ? <ShieldX size={16} className="text-red-400" />
            : <ShieldAlert size={16} className="text-gray-500" />
          }
          <span className="text-sm font-semibold text-white">Identity Verification (KYC)</span>
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
            profile.kyc_status === 'approved' ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40'
            : profile.kyc_status === 'pending' ? 'bg-amber-900/40 text-amber-400 border border-amber-800/40'
            : profile.kyc_status === 'rejected' ? 'bg-red-900/40 text-red-400 border border-red-800/40'
            : 'bg-gray-800 text-gray-500 border border-gray-700'
          }`}>{profile.kyc_status === 'none' ? 'Not submitted' : profile.kyc_status}</span>
        </div>

        {profile.kyc_status === 'approved' ? (
          <p className="text-xs text-emerald-300/70">Your identity is verified. No withdrawal limits apply.</p>
        ) : (
          <>
            <p className="text-xs text-gray-400 leading-relaxed">
              {profile.kyc_status === 'rejected'
                ? `Rejected: ${profile.kyc_rejection_reason ?? 'Please resubmit clear copies.'}`
                : profile.kyc_status === 'pending'
                ? 'Documents received. Review takes 24–48 hours.'
                : 'Required to withdraw above the platform threshold. Upload a selfie + front and back of your ID.'}
            </p>
            {profile.kyc_status !== 'pending' && (
              <KycUploadForm profileEmail={profile.email} onSubmitted={onUpdated} />
            )}
          </>
        )}
      </div>

      {/* Referral section */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
        <div>
          <div className="text-sm font-semibold text-white mb-0.5">Invite a friend</div>
          <div className="text-xs text-gray-500">Earn bonus points when friends join using your link</div>
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={referralLink}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-400 font-mono truncate"
          />
          <button
            onClick={copyRef}
            className="p-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-colors flex-shrink-0"
            title="Copy"
          >
            {copyDone ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="flex gap-2">
          {typeof navigator.share === 'function' ? (
            <button
              onClick={nativeShare}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Share2 size={14} /> Share
            </button>
          ) : (
            <>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareMsg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl bg-green-700 hover:bg-green-600 text-white text-sm font-semibold transition-colors text-center"
              >
                WhatsApp
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMsg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-sm font-semibold transition-colors text-center"
              >
                X / Twitter
              </a>
            </>
          )}
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={onLogout}
        className="w-full py-3 rounded-xl border border-red-900/40 text-red-400 hover:bg-red-900/20 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={15} /> Sign Out
      </button>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AnnotatorPortalPage({ onLogout }: { onLogout?: () => void }) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [profile, setProfile] = useState<AnnotatorProfile | null>(null)
  const [stats, setStats] = useState<AnnotatorStats | null>(null)
  const [dashRate, setDashRate] = useState<PlatformRewardRate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([annotatorApi.getProfile(), annotatorApi.getStats(), annotatorApi.getRewardRate()])
      .then(([p, s, r]) => { setProfile(p); setStats(s); setDashRate(r as unknown as PlatformRewardRate) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleCollect = (token: string) => {
    window.location.href = `/collect/${token}`
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Home', icon: <LayoutDashboard size={20} /> },
    { id: 'tasks', label: 'Tasks', icon: <ListTodo size={20} /> },
    { id: 'rewards', label: 'Rewards', icon: <Gift size={20} /> },
    { id: 'profile', label: 'Profile', icon: <User size={20} /> },
  ]

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-indigo-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-w-lg mx-auto">
      {/* Top header */}
      <header className="px-4 pt-safe-top pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">🧠</div>
            <span className="font-bold text-white text-sm">MLDock</span>
            <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-900/40 border border-indigo-800/40 rounded-full px-1.5 py-0.5">Contributor</span>
          </div>
          {stats && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-full px-2.5 py-1">
              <Star size={12} fill="currentColor" />
              {fmt(stats.total_points)} pts
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pb-24">
        {tab === 'dashboard' && profile && (
          <DashboardTab profile={profile} stats={stats} rate={dashRate} />
        )}
        {tab === 'tasks' && (
          <TasksTab onCollect={handleCollect} />
        )}
        {tab === 'rewards' && profile && (
          <RewardsTab profile={profile} onNavigateProfile={() => setTab('profile')} />
        )}
        {tab === 'profile' && profile && (
          <ProfileTab profile={profile} onUpdated={setProfile} onLogout={onLogout ?? (() => window.location.reload())} />
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-gray-900/95 backdrop-blur border-t border-gray-800 pb-safe-bottom z-20">
        <div className="flex">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'flex-1 flex flex-col items-center gap-1 py-3 transition-colors text-center',
                tab === t.id ? 'text-indigo-400' : 'text-gray-600 hover:text-gray-400'
              )}
            >
              {t.icon}
              <span className="text-[10px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
