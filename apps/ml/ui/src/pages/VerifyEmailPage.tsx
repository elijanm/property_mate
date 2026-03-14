import { useState, FormEvent, useRef, useEffect } from 'react'
import { Mail, Loader2, CheckCircle2, RotateCcw } from 'lucide-react'
import Logo from '@/components/Logo'
import { authApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'

interface Props {
  email: string
  onVerified: () => void
  onBack: () => void
}

export default function VerifyEmailPage({ email, onVerified, onBack }: Props) {
  const { login } = useAuth()
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [resent, setResent] = useState(false)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { refs.current[0]?.focus() }, [])

  const otp = digits.join('')

  const handleDigit = (i: number, val: string) => {
    if (!/^\d*$/.test(val)) return
    const next = [...digits]
    next[i] = val.slice(-1)
    setDigits(next)
    if (val && i < 5) refs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setDigits(text.split(''))
      refs.current[5]?.focus()
    }
    e.preventDefault()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6) { setError('Enter all 6 digits'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.verifyOtp(email, otp)
      setSuccess(true)
      setTimeout(onVerified, 1200)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setResent(false)
    setError('')
    try {
      await authApi.resendVerification(email)
      setResent(true)
      setDigits(['', '', '', '', '', ''])
      refs.current[0]?.focus()
    } catch {}
    finally { setResending(false) }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-green-900/30 border border-green-700/40 flex items-center justify-center mx-auto">
            <CheckCircle2 size={28} className="text-green-400" />
          </div>
          <div className="text-white font-semibold text-lg">Account activated!</div>
          <div className="text-sm text-gray-500">Signing you in…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center gap-4 mb-8">
          <Logo size="lg" />
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">

          {/* Icon + text */}
          <div className="flex flex-col items-center gap-2 pb-1">
            <div className="w-10 h-10 rounded-xl bg-indigo-900/30 border border-indigo-700/30 flex items-center justify-center">
              <Mail size={18} className="text-indigo-400" />
            </div>
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              We sent a 6-digit code to<br />
              <span className="text-white font-medium">{email}</span>
            </p>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-center">
              {error}
            </div>
          )}

          {resent && (
            <div className="text-xs text-green-400 bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 text-center">
              New code sent — check your inbox
            </div>
          )}

          {/* OTP input */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2 justify-center" onPaste={handlePaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={el => { refs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={e => handleDigit(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="w-10 h-12 text-center text-lg font-bold bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-brand-500 transition-colors"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 size={14} className="animate-spin" /> Verifying…</> : 'Verify email'}
            </button>
          </form>

          {/* Resend */}
          <div className="flex items-center justify-between pt-1 border-t border-gray-800">
            <button
              onClick={handleResend}
              disabled={resending}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            >
              {resending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Resend code
            </button>
            <button onClick={onBack} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Back to sign in
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-700 mt-4">
          Code expires in 30 minutes · Link valid for 24 hours
        </p>
      </div>
    </div>
  )
}
