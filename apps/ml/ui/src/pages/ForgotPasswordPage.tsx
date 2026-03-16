import { useState, FormEvent } from 'react'
import { authApi } from '../api/auth'
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { onBack: () => void }

export default function ForgotPasswordPage({ onBack }: Props) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
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

        {sent ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-green-900/30 border border-green-700/40 flex items-center justify-center mx-auto">
              <CheckCircle2 size={22} className="text-green-400" />
            </div>
            <div>
              <div className="text-white font-semibold">Check your inbox</div>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                If <span className="text-gray-300">{email}</span> is registered, we've sent a reset link. It expires in 1 hour.
              </p>
            </div>
            <button onClick={onBack}
              className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors">
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <button type="button" onClick={onBack} className="text-gray-600 hover:text-gray-400 transition-colors">
                <ArrowLeft size={16} />
              </button>
              <h1 className="text-base font-semibold text-white">Reset password</h1>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
              Enter your account email and we'll send you a link to reset your password.
            </p>

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Email</label>
              <div className="relative">
                <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
