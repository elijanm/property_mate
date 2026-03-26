import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props {
  provider: 'google' | 'github'
}

export default function OAuthCallbackPage({ provider }: Props) {
  const { loginWithTokens } = useAuth()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const ran = useRef(false)  // guard against React StrictMode double-invoke

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')
    const errorDesc = params.get('error_description')

    if (errorParam) {
      if (errorParam === 'access_denied') {
        setError('Access was denied. Please try again and click "Authorize" on GitHub.')
      } else if (errorParam === 'redirect_uri_mismatch') {
        setError(
          `Redirect URI mismatch. Register this URL in your GitHub OAuth App: ` +
          `${window.location.origin}/oauth/callback/${provider}`
        )
      } else {
        setError(errorDesc || `GitHub error: ${errorParam}`)
      }
      return
    }

    if (!code) {
      // No code, no error — stale callback URL (e.g. browser back). Go home.
      window.location.href = '/'
      return
    }

    const redirectUri = `${window.location.origin}/oauth/callback/${provider}`

    authApi.oauthExchange(provider, code, redirectUri)
      .then(data => {
        loginWithTokens(data)
        setDone(true)
        // Hard navigate so the app re-initialises with the stored token
        setTimeout(() => { window.location.href = '/' }, 800)
      })
      .catch(err => {
        const msg = err?.response?.data?.detail || err?.message || 'OAuth login failed'
        setError(msg)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center gap-4 p-6">
        <Logo size="md" />
        <div className="flex items-start gap-2.5 text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-5 py-4 max-w-md text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
        <button
          onClick={() => { window.location.href = '/' }}
          className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
        >
          ← Back to sign in
        </button>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center gap-4">
        <Logo size="md" />
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <CheckCircle2 size={16} />
          Signed in — redirecting…
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center gap-4">
      <Logo size="md" />
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 size={16} className="animate-spin" />
        Completing sign-in…
      </div>
    </div>
  )
}
