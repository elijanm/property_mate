import { useState, useEffect, useCallback } from 'react'
import { walletApi } from '@/api/wallet'
import type { Wallet, WalletTransaction, LocalQuota } from '@/types/wallet'
import { Loader2, TrendingUp, TrendingDown, Clock, RotateCcw, AlertCircle, Wallet as WalletIcon, Monitor, ShoppingCart } from 'lucide-react'
import clsx from 'clsx'

const TYPE_STYLES: Record<WalletTransaction['type'], { label: string; classes: string; sign: string }> = {
  credit:  { label: 'Credit',  classes: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/40', sign: '+' },
  debit:   { label: 'Debit',   classes: 'bg-red-900/40 text-red-400 border-red-800/40',             sign: '-' },
  reserve: { label: 'Reserve', classes: 'bg-amber-900/40 text-amber-400 border-amber-800/40',       sign: '-' },
  release: { label: 'Release', classes: 'bg-blue-900/40 text-blue-400 border-blue-800/40',          sign: '+' },
}

const TYPE_ICONS: Record<WalletTransaction['type'], React.ReactNode> = {
  credit:  <TrendingUp size={12} />,
  debit:   <TrendingDown size={12} />,
  reserve: <Clock size={12} />,
  release: <RotateCcw size={12} />,
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const LOCAL_HOUR_PRICE_USD = 0.50

function formatResetDate(iso: string | null): string {
  if (!iso) return 'next month'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null): number {
  if (!iso) return 30
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86_400_000))
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [quota, setQuota] = useState<LocalQuota | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [txLoading, setTxLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Top-up modal state
  const [topupOpen, setTopupOpen] = useState(false)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupError, setTopupError] = useState<string | null>(null)

  // Buy hours modal state
  const [buyHoursOpen, setBuyHoursOpen] = useState(false)
  const [buyHoursAmount, setBuyHoursAmount] = useState('5')
  const [buyHoursLoading, setBuyHoursLoading] = useState(false)
  const [buyHoursError, setBuyHoursError] = useState<string | null>(null)
  const [buyHoursSuccess, setBuyHoursSuccess] = useState<number | null>(null)

  // Paystack callback verification
  const [verifySuccess, setVerifySuccess] = useState<{ kes: number; usd: number } | null>(null)

  const loadWallet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [w, q] = await Promise.all([walletApi.get(), walletApi.getLocalQuota()])
      setWallet(w)
      setQuota(q)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTransactions = useCallback(async (p: number) => {
    setTxLoading(true)
    try {
      const data = await walletApi.transactions(p)
      setTransactions(data.items)
      setTxTotal(data.total)
    } catch {}
    finally { setTxLoading(false) }
  }, [])

  useEffect(() => { loadWallet() }, [loadWallet])
  useEffect(() => { loadTransactions(page) }, [loadTransactions, page])

  const handleBuyHours = async () => {
    const hours = parseFloat(buyHoursAmount)
    if (!hours || hours <= 0) { setBuyHoursError('Enter a valid number of hours'); return }
    setBuyHoursLoading(true)
    setBuyHoursError(null)
    try {
      const w = await walletApi.purchaseLocalHours(hours)
      setWallet(w)
      const q = await walletApi.getLocalQuota()
      setQuota(q)
      setBuyHoursSuccess(hours)
      setBuyHoursOpen(false)
      setBuyHoursAmount('5')
    } catch (e: unknown) {
      setBuyHoursError(e instanceof Error ? e.message : 'Purchase failed')
    } finally {
      setBuyHoursLoading(false)
    }
  }

  // Auto-verify when Paystack redirects back with ?reference=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') ?? params.get('trxref')
    if (!ref) return
    // Clean the URL
    window.history.replaceState({}, '', window.location.pathname)
    walletApi.verifyTopup(ref).then(w => {
      setWallet(prev => {
        const creditedUsd = w.balance - (prev?.balance ?? 0)
        if (creditedUsd > 0) {
          setVerifySuccess({ kes: creditedUsd * 130, usd: creditedUsd })
        }
        return w
      })
      loadTransactions(1)
    }).catch(() => {})
  }, [loadTransactions])

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount)
    if (!amount || amount <= 0) {
      setTopupError('Enter a valid amount greater than 0')
      return
    }
    setTopupLoading(true)
    setTopupError(null)
    try {
      const result = await walletApi.initializeTopup(amount, window.location.href)
      window.open(result.authorization_url, '_blank', 'noopener,noreferrer')
      setTopupOpen(false)
      setTopupAmount('')
    } catch (e: unknown) {
      setTopupError(e instanceof Error ? e.message : 'Failed to initialize payment')
    } finally {
      setTopupLoading(false)
    }
  }

  const pageSize = 20
  const totalPages = Math.ceil(txTotal / pageSize)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 size={24} className="animate-spin text-gray-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-xl p-4">
        <AlertCircle size={16} /> {error}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Balance card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-widest mb-3">
              <WalletIcon size={13} /> Wallet Balance
            </div>
            <div className="text-4xl font-bold text-white tabular-nums">
              <span className="text-gray-400 text-2xl mr-1">$</span>
              <span className="text-emerald-400">{(wallet?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="text-gray-600 text-base ml-2">USD</span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
              <span>
                Reserved:{' '}
                <span className="text-amber-400 font-medium">
                  ${(wallet?.reserved ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>
              </span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-600 text-[11px]">{wallet?.user_email}</span>
            </div>
          </div>

          <button
            onClick={() => { setTopupOpen(true); setTopupError(null); setTopupAmount('') }}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <TrendingUp size={14} /> Top Up
          </button>
        </div>
      </div>

      {/* Local Training Quota */}
      {quota && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-400 text-sm font-semibold">
              <Monitor size={15} className="text-brand-400" />
              Local Training Quota
            </div>
            <button
              onClick={() => { setBuyHoursOpen(true); setBuyHoursError(null); setBuyHoursAmount('5') }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl transition-colors"
            >
              <ShoppingCart size={12} /> Buy more hours
            </button>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>
                <span className={clsx('font-semibold', quota.exhausted ? 'text-red-400' : 'text-white')}>
                  {quota.used_hours.toFixed(1)} hrs
                </span>
                {' '}used of{' '}
                <span className="text-gray-300 font-medium">{quota.quota_hours.toFixed(0)} hrs</span>
              </span>
              <span className={clsx('font-medium', quota.exhausted ? 'text-red-400' : 'text-emerald-400')}>
                {quota.exhausted ? 'Quota exhausted' : `${quota.remaining_hours.toFixed(1)} hrs remaining`}
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={clsx(
                  'h-2.5 rounded-full transition-all',
                  quota.exhausted ? 'bg-red-500' : quota.used_hours / quota.quota_hours > 0.8 ? 'bg-amber-500' : 'bg-emerald-500',
                )}
                style={{ width: `${Math.min(100, (quota.used_hours / quota.quota_hours) * 100).toFixed(1)}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <RotateCcw size={11} />
            Resets on{' '}
            <span className="text-gray-400 font-medium">{formatResetDate(quota.reset_at)}</span>
            <span className="text-gray-700">·</span>
            <span>{daysUntil(quota.reset_at)} days away</span>
          </div>

          {quota.exhausted && (
            <div className="bg-red-950/30 border border-red-800/40 rounded-xl px-4 py-3 text-xs text-red-400">
              Monthly local quota exhausted. Purchase more hours ($0.50/hr) to continue local training,
              or use Cloud GPU.
            </div>
          )}
        </div>
      )}

      {/* Buy hours success banner */}
      {buyHoursSuccess && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-emerald-400 font-semibold text-sm">Hours purchased!</div>
            <div className="text-emerald-300 text-xs mt-0.5">
              <span className="font-medium">{buyHoursSuccess} hours</span> added to your local training quota
            </div>
          </div>
          <button onClick={() => setBuyHoursSuccess(null)} className="text-emerald-700 hover:text-emerald-400 transition-colors text-lg leading-none">×</button>
        </div>
      )}

      {/* Buy hours modal */}
      {buyHoursOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-base font-bold text-white mb-1">Buy Local Training Hours</h2>
            <p className="text-xs text-gray-500 mb-4">$0.50 USD per hour · deducted from your wallet balance</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Hours to purchase</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  value={buyHoursAmount}
                  onChange={e => setBuyHoursAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
                />
                {buyHoursAmount && parseFloat(buyHoursAmount) > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    Cost:{' '}
                    <span className="text-white font-medium">
                      ${(parseFloat(buyHoursAmount) * LOCAL_HOUR_PRICE_USD).toFixed(2)} USD
                    </span>
                    {' '}· Wallet:{' '}
                    <span className={clsx(
                      'font-medium',
                      wallet && wallet.balance >= parseFloat(buyHoursAmount) * LOCAL_HOUR_PRICE_USD ? 'text-emerald-400' : 'text-red-400',
                    )}>
                      ${wallet?.balance.toFixed(2)} USD available
                    </span>
                  </p>
                )}
              </div>
              {buyHoursError && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg p-2.5">
                  <AlertCircle size={13} /> {buyHoursError}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleBuyHours}
                  disabled={buyHoursLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {buyHoursLoading ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
                  {buyHoursLoading ? 'Processing…' : 'Purchase'}
                </button>
                <button
                  onClick={() => setBuyHoursOpen(false)}
                  className="px-4 py-2.5 text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment success banner */}
      {verifySuccess && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-emerald-400 font-semibold text-sm">Payment received!</div>
            <div className="text-emerald-300 text-xs mt-0.5">
              <span className="font-medium">${verifySuccess.usd.toFixed(2)} USD</span> credited to your wallet
              <span className="text-emerald-700 ml-2">(KES {verifySuccess.kes.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid)</span>
            </div>
          </div>
          <button onClick={() => setVerifySuccess(null)} className="text-emerald-700 hover:text-emerald-400 transition-colors text-lg leading-none">×</button>
        </div>
      )}

      {/* Top-up modal */}
      {topupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-base font-bold text-white mb-4">Top Up Wallet</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Amount (KES)</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={topupAmount}
                  onChange={e => setTopupAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
                />
                {topupAmount && parseFloat(topupAmount) > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    ≈ <span className="text-emerald-400 font-medium">${(parseFloat(topupAmount) / 130).toFixed(2)} USD</span> will be credited to your wallet
                  </p>
                )}
              </div>
              {topupError && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg p-2.5">
                  <AlertCircle size={13} /> {topupError}
                </div>
              )}
              <p className="text-xs text-gray-600">
                You'll be redirected to Paystack's secure payment page in a new tab.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleTopup}
                  disabled={topupLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {topupLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                  {topupLoading ? 'Redirecting…' : 'Proceed to Payment'}
                </button>
                <button
                  onClick={() => setTopupOpen(false)}
                  className="px-4 py-2.5 text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest mb-4">Transaction History</h2>

        {txLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 size={20} className="animate-spin text-gray-600" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-12">
            No transactions yet. Top up your wallet to get started.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Balance After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {transactions.map(tx => {
                  const style = TYPE_STYLES[tx.type]
                  return (
                    <tr key={tx.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {formatDate(tx.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
                          style.classes,
                        )}>
                          {TYPE_ICONS[tx.type]} {style.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 text-xs max-w-[200px] truncate" title={tx.description}>
                        {tx.description}
                      </td>
                      <td className={clsx(
                        'px-4 py-3 text-right font-mono font-semibold text-sm tabular-nums',
                        tx.type === 'credit' || tx.type === 'release' ? 'text-emerald-400' : 'text-red-400',
                      )}>
                        {style.sign}{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs tabular-nums">
                        {tx.balance_after.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
                <span>{txTotal} transactions</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ‹ Prev
                  </button>
                  <span className="px-2.5 py-1 text-gray-400">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
