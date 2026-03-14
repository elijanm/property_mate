import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { mfaApi } from '@/api/mfa'
import { extractApiError } from '@/utils/apiError'

interface Props {
  onEnrolled: () => void
  onClose: () => void
}

export default function MfaSetupModal({ onEnrolled, onClose }: Props) {
  const [step, setStep] = useState<'loading' | 'qr' | 'confirm' | 'done'>('loading')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [secret, setSecret] = useState<string>('')
  const [showSecret, setShowSecret] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mfaApi.setup()
      .then(async (res) => {
        setSecret(res.secret)
        const url = await QRCode.toDataURL(res.qr_uri, { width: 200, margin: 2 })
        setQrDataUrl(url)
        setStep('qr')
      })
      .catch((err) => {
        setError(extractApiError(err).message)
        setStep('qr')
      })
  }, [])

  async function handleConfirm() {
    if (code.length !== 6) return
    setConfirming(true)
    setError(null)
    try {
      await mfaApi.confirm(code)
      setStep('done')
      setTimeout(() => { onEnrolled(); onClose() }, 1500)
    } catch (err) {
      setError(extractApiError(err).message)
      setCode('')
      inputRef.current?.focus()
    } finally {
      setConfirming(false)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/50" style={{ zIndex: 9998 }} onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-gray-900">Set Up Authenticator</h2>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">✕</button>
          </div>

          {step === 'loading' && (
            <div className="py-12 text-center text-sm text-gray-400">Generating secret…</div>
          )}

          {(step === 'qr' || step === 'confirm') && (
            <div className="space-y-5">
              <div className="text-sm text-gray-600 space-y-1">
                <p className="font-medium text-gray-800">1. Install an authenticator app</p>
                <p className="text-xs text-gray-500">Google Authenticator, Authy, or any TOTP app works.</p>
              </div>

              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-800 mb-3">2. Scan the QR code</p>
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <div className="border-2 border-gray-200 rounded-xl p-3 inline-block bg-white">
                      <img src={qrDataUrl} alt="MFA QR code" className="w-40 h-40" />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setShowSecret((s) => !s)}
                  className="text-xs text-blue-600 underline underline-offset-2"
                >
                  {showSecret ? 'Hide' : 'Show'} manual entry key
                </button>
                {showSecret && (
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Secret key (manual entry)</p>
                    <p className="font-mono text-sm text-gray-800 break-all select-all">{secret}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">3. Enter the 6-digit code from the app</p>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={code.length !== 6 || confirming}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
                >
                  {confirming ? 'Confirming…' : 'Activate MFA'}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="py-10 text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-base font-semibold text-gray-900">MFA enabled!</p>
              <p className="text-sm text-gray-500 mt-1">Your account is now protected.</p>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
