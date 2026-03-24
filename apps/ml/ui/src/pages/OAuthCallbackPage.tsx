import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'
import { Loader2, AlertCircle } from 'lucide-react'
import Logo from '@/components/Logo'

interface Props {
  provider: 'google' | 'github'
}

export default function OAuthCallbackPage({ provider }: Props) {
  const { loginWithTokens } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam) {
      setError(`OAuth denied: ${errorParam}`)
      return
    }
    if (!code) {
      setError('No authorization code received.')
      return
    }

    const redirectUri = `${window.location.origin}/oauth/callback/${provider}`

    authApi.oauthExchange(provider, code, redirectUri)
      .then(data => {
        loginWithTokens(data)
        // Clear the ?code= from the URL so refresh doesn't re-exchange
        window.history.replaceState({}, '', '/')
      })
      .catch(err => {
        const msg = err?.response?.data?.detail || err?.message || 'OAuth login failed'
        setError(msg)
      })
  }, [provider, loginWithTokens])

  if (error) {
    return (
      <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center gap-4 p-6">
        <Logo size="md" />
        <div className="flex items-center gap-2 text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-5 py-3 max-w-sm text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
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
