import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mfaApi } from '@/api/mfa'
import { extractApiError } from '@/utils/apiError'

interface Props {
  onUnlocked: (token: string, expiresIn: number) => void
  onClose: () => void
}

export default function MfaPinModal({ onUnlocked, onClose }: Props) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  function handleChange(idx: number, val: string) {
    const ch = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[idx] = ch
    setDigits(next)
    setError(null)
    if (ch && idx < 5) {
      inputRefs.current[idx + 1]?.focus()
    }
    if (next.every((d) => d !== '') && idx === 5) {
      submitCode(next.join(''))
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const next = [...digits]
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    if (pasted.length === 6) submitCode(pasted)
    else inputRefs.current[pasted.length]?.focus()
  }

  async function submitCode(code: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await mfaApi.verify(code)
      if (!res.valid || !res.session_token) {
        setError('Invalid code — check your authenticator app and try again.')
        setDigits(['', '', '', '', '', ''])
        inputRefs.current[0]?.focus()
        return
      }
      onUnlocked(res.session_token, res.expires_in ?? 300)
    } catch (err) {
      setError(extractApiError(err).message)
      setDigits(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <>
      {/* Backdrop — rendered at document root, above everything */}
      <div className="fixed inset-0 bg-black/50" style={{ zIndex: 9998 }} onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7">
          {/* Icon */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-3">
              <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900">Verify Identity</h2>
            <p className="text-sm text-gray-500 mt-1">Enter the 6-digit code from your authenticator app to view protected data.</p>
          </div>

          {/* 6-digit input */}
          <div className="flex gap-2 justify-center mb-5" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                autoFocus={i === 0}
                className={[
                  'w-11 h-13 text-center text-xl font-bold border-2 rounded-xl outline-none transition-colors',
                  d ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-900',
                  'focus:border-blue-500',
                ].join(' ')}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 text-center mb-4 bg-red-50 rounded-lg py-2 px-3">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => submitCode(digits.join(''))}
              disabled={loading || digits.some((d) => !d)}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Unlock'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
