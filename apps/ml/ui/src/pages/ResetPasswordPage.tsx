import { useState, FormEvent } from 'react'
import { authApi } from '../api/auth'
import { Eye, EyeOff, Loader2, CheckCircle2, KeyRound } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { token: string; onDone: () => void }

export default function ResetPasswordPage({ token, onDone }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed — the link may have expired')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size="lg" />
        </div>

        {done ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-green-900/30 border border-green-700/40 flex items-center justify-center mx-auto">
              <CheckCircle2 size={22} className="text-green-400" />
            </div>
            <div>
              <div className="text-white font-semibold">Password updated</div>
              <p className="text-sm text-gray-500 mt-1.5">Your password has been changed. You can now sign in.</p>
            </div>
            <button onClick={onDone}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors">
              Sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-brand-900/40 border border-brand-700/40 flex items-center justify-center">
                <KeyRound size={14} className="text-brand-400" />
              </div>
              <h1 className="text-base font-semibold text-white">Set new password</h1>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">New password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
                  placeholder="Min. 8 characters"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Confirm new password</label>
              <input
                type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
                placeholder="Repeat password"
              />
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Updating…</> : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
