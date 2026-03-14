import { useState, FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Loader2 } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props { onGoLogin: () => void }

export default function RegisterPage({ onGoLogin }: Props) {
  const { register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')
    setLoading(true)
    try {
      await register(email, password, fullName)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
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

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h1 className="text-base font-semibold text-white">Create account</h1>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</div>
          )}

          {([
            { label: 'Full name', value: fullName, setter: setFullName, type: 'text', placeholder: 'Jane Smith', required: false },
            { label: 'Email', value: email, setter: setEmail, type: 'email', placeholder: 'you@example.com', required: true },
            { label: 'Password', value: password, setter: setPassword, type: 'password', placeholder: '••••••••', required: true },
            { label: 'Confirm password', value: confirm, setter: setConfirm, type: 'password', placeholder: '••••••••', required: true },
          ] as const).map(f => (
            <div key={f.label} className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">{f.label}</label>
              <input type={f.type} value={f.value} onChange={e => f.setter(e.target.value)} required={f.required}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
                placeholder={f.placeholder} />
            </div>
          ))}

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : 'Create account'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-4">
          Already have an account?{' '}
          <button onClick={onGoLogin} className="text-brand-400 hover:text-brand-300 transition-colors">Sign in</button>
        </p>
      </div>
    </div>
  )
}
