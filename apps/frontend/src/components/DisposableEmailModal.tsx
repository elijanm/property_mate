import { useState } from 'react'

interface Props {
  suspectedEmail: string
  attempts: number          // how many disposable emails tried so far
  onUseReal: (email: string) => Promise<{ is_disposable: boolean; attempts: number }>
  onKeep: () => void
  saving?: boolean
}

const POLITE_REMINDERS = [
  'Still looks temporary — want to try another one?',
  "That one's flagged too. Third time's the charm?",
  "We're not judging, but this one's also disposable.",
  "You're persistent! So are we — this email looks temporary too.",
  "Okay, we'll keep asking… because this one's still disposable.",
]

export default function DisposableEmailModal({ suspectedEmail, attempts, onUseReal, onKeep, saving }: Props) {
  const [realEmail, setRealEmail] = useState('')
  const [checking, setChecking] = useState(false)
  const [localAttempts, setLocalAttempts] = useState(attempts)
  const [stillDisposable, setStillDisposable] = useState(false)

  const reminderIndex = Math.min(localAttempts - 1, POLITE_REMINDERS.length - 1)
  const reminder = localAttempts > 0 ? POLITE_REMINDERS[Math.max(0, reminderIndex)] : null

  async function handleSubmit() {
    if (!realEmail.trim()) return
    setChecking(true)
    try {
      const result = await onUseReal(realEmail.trim())
      if (result.is_disposable) {
        setLocalAttempts(result.attempts)
        setStillDisposable(true)
        setRealEmail('')
      }
      // If clean, parent closes the modal
    } finally {
      setChecking(false)
    }
  }

  const busy = checking || saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 space-y-5">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-2xl">
            🤔
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            {stillDisposable ? reminder : 'Hmm, that email looks temporary'}
          </h2>
          {!stillDisposable && (
            <p className="text-sm text-gray-500">No judgment — but we'd love a real one.</p>
          )}
          {stillDisposable && (
            <p className="text-sm text-amber-600 font-medium">
              That's {localAttempts} {localAttempts === 1 ? 'attempt' : 'attempts'} — still flagged as disposable.
            </p>
          )}
        </div>

        {/* Benefits — hide after first failed attempt to keep it concise */}
        {!stillDisposable && (
          <ul className="space-y-3 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-green-500 shrink-0">✓</span>
              <span>We'll <strong>never sell your email or spam you</strong>. Ever.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-green-500 shrink-0">✓</span>
              <span>Your <strong>lease agreements and receipts</strong> go to you, not into the void.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-green-500 shrink-0">✓</span>
              <span><strong>Account recovery</strong> that actually works when you need it.</span>
            </li>
          </ul>
        )}

        {/* Email input + CTA */}
        <div className="space-y-2">
          <input
            type="email"
            autoFocus
            placeholder={stillDisposable ? 'Try a different real email...' : 'your.real@email.com'}
            value={realEmail}
            onChange={(e) => setRealEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
            className={`w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 placeholder:text-gray-400 transition-colors ${
              stillDisposable
                ? 'border-amber-300 focus:ring-amber-400'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <button
            onClick={handleSubmit}
            disabled={!realEmail.trim() || busy}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {busy ? 'Checking...' : "Okay, fine — here's my real email"}
          </button>
        </div>

        {/* Escape hatch */}
        <div className="text-center">
          <button
            onClick={onKeep}
            disabled={busy}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors disabled:opacity-40"
          >
            Keep my temporary email
            <span className="text-gray-300"> (some features will be limited)</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-300">Detected: {suspectedEmail}</p>
      </div>
    </div>
  )
}
