import { useState } from 'react'
import { authApi } from '@/api/auth'
import { useAuth } from '@/context/AuthContext'

interface CLILoginPageProps {
  deviceCode: string
}

const PERMISSIONS = [
  {
    icon: '🤖',
    title: 'Read & write trainers',
    desc: 'Generate, upload, edit, and delete ML trainer plugins in your workspace.',
  },
  {
    icon: '🚀',
    title: 'Trigger training jobs',
    desc: 'Start, monitor, and retrieve results of training runs on your datasets.',
  },
  {
    icon: '📦',
    title: 'Access datasets & deployments',
    desc: 'List datasets and deployed models associated with your account.',
  },
  {
    icon: '💬',
    title: 'Use AI code generation',
    desc: 'Call AI chat and generate endpoints — charges apply to your wallet.',
  },
  {
    icon: '🔑',
    title: 'Authenticate as you',
    desc: 'Act on your behalf using a short-lived token. Your password is never stored.',
  },
]

export default function CLILoginPage({ deviceCode }: CLILoginPageProps) {
  const { user, loginWithTokens } = useAuth()

  // step: 'permissions' | 'signin' | 'authorize' | 'done' | 'error'
  const [step, setStep] = useState<'permissions' | 'signin' | 'authorize' | 'done' | 'error'>(
    user ? 'authorize' : 'permissions'
  )
  const [message, setMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signInError, setSignInError] = useState('')

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setSignInError('')
    setAuthLoading(true)
    try {
      const res = await authApi.login(email, password)
      loginWithTokens(res)
      setStep('authorize')
    } catch (err: any) {
      setSignInError(err?.response?.data?.detail || err?.message || 'Sign in failed')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleAuthorize() {
    setAuthLoading(true)
    try {
      const res = await authApi.confirmCliSession(deviceCode)
      setMessage(res.message)
      setStep('done')
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || err?.message || 'Authorization failed')
      setStep('error')
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white text-lg font-bold shrink-0">M</div>
            <div>
              <div className="text-white font-semibold">MLDock CLI</div>
              <div className="text-xs text-gray-500">is requesting access to your account</div>
            </div>
          </div>
        </div>

        <div className="px-8 py-6">

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <span className="text-green-400 text-2xl">✓</span>
              </div>
              <div className="text-white font-semibold text-lg mb-1">CLI Authorized</div>
              <div className="text-sm text-gray-400 mb-2">{message}</div>
              <div className="text-xs text-gray-600">You can close this tab and return to your terminal.</div>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <span className="text-red-400 text-2xl">✕</span>
              </div>
              <div className="text-white font-semibold text-lg mb-1">Authorization Failed</div>
              <div className="text-sm text-red-400 mb-4">{message}</div>
              <button onClick={() => setStep('authorize')} className="text-sm text-brand-400 hover:text-brand-300 transition-colors">
                Try again
              </button>
            </div>
          )}

          {/* ── PERMISSIONS ── */}
          {step === 'permissions' && (
            <>
              <p className="text-sm text-gray-400 mb-5">
                The <span className="text-white font-medium">MLDock CLI</span> (running in your terminal) will be able to:
              </p>
              <ul className="space-y-3 mb-6">
                {PERMISSIONS.map(p => (
                  <li key={p.title} className="flex items-start gap-3">
                    <span className="text-lg mt-0.5 shrink-0">{p.icon}</span>
                    <div>
                      <div className="text-white text-sm font-medium">{p.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-6">
                <p className="text-xs text-yellow-400">
                  Only proceed if you initiated this request from your own terminal. Never authorize on behalf of someone else.
                </p>
              </div>
              <button
                onClick={() => setStep('signin')}
                className="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-xl py-3 transition-colors"
              >
                Continue to sign in
              </button>
            </>
          )}

          {/* ── SIGN IN ── */}
          {step === 'signin' && (
            <>
              <p className="text-sm text-gray-400 mb-5">Sign in to grant CLI access to your account.</p>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-brand-500"
                  />
                </div>
                {signInError && <p className="text-xs text-red-400">{signInError}</p>}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl py-3 transition-colors"
                >
                  {authLoading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <button onClick={() => setStep('permissions')} className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors w-full text-center">
                ← Back
              </button>
            </>
          )}

          {/* ── AUTHORIZE (already logged in) ── */}
          {step === 'authorize' && user && (
            <>
              <p className="text-sm text-gray-400 mb-4">
                The <span className="text-white font-medium">MLDock CLI</span> is requesting full access to your account:
              </p>
              <ul className="space-y-2 mb-5">
                {PERMISSIONS.map(p => (
                  <li key={p.title} className="flex items-center gap-2 text-sm text-gray-300">
                    <span className="text-base shrink-0">{p.icon}</span>
                    <span>{p.title}</span>
                  </li>
                ))}
              </ul>
              <div className="bg-gray-800 rounded-xl p-3 mb-5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {user.email?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{user.email}</div>
                  <div className="text-xs text-gray-500 capitalize">{(user as any).role ?? 'user'}</div>
                </div>
              </div>
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-5">
                <p className="text-xs text-yellow-400">
                  Only authorize if you initiated this request from your own terminal.
                </p>
              </div>
              <button
                onClick={handleAuthorize}
                disabled={authLoading}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl py-3 transition-colors"
              >
                {authLoading ? 'Authorizing…' : 'Authorize CLI Access'}
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
