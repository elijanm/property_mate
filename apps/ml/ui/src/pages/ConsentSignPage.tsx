/**
 * ConsentSignPage — public page for subjects to sign a consent agreement via email link.
 * Accessed at /consent-sign/:emailToken
 */
import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react'
import { consentApi } from '@/api/consent'
import type { ConsentRecord } from '@/types/consent'
import SignaturePad from '@/components/SignaturePad'

export default function ConsentSignPage({ emailToken }: { emailToken: string }) {
  const [record, setRecord] = useState<ConsentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'read' | 'sign' | 'done'>('read')
  const [signatureData, setSignatureData] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')

  useEffect(() => {
    consentApi.getForEmailSigning(emailToken)
      .then(r => {
        setRecord(r)
        setSignerName(r.subject_name || '')
      })
      .catch(e => setError(e?.message || 'Unable to load consent agreement.'))
      .finally(() => setLoading(false))
  }, [emailToken])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-indigo-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Unable to load</p>
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!record) return null

  if (record.status === 'void') {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle size={40} className="text-amber-400 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Consent voided</p>
          <p className="text-sm text-gray-400">This consent agreement has been voided and is no longer active.</p>
        </div>
      </div>
    )
  }

  if (record.subject_signature || step === 'done') {
    return (
      <div className="min-h-screen bg-[#060810] flex items-center justify-center px-4">
        <div className="text-center max-w-sm w-full">
          <div className="w-20 h-20 rounded-full bg-emerald-900/40 border-2 border-emerald-700/50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Consent Signed</h2>
          <p className="text-sm text-gray-400 mb-1">
            Your consent has been recorded successfully.
          </p>
          <p className="text-xs text-gray-600">You may close this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-indigo-900/60 flex items-center justify-center mx-auto">
            <FileText size={22} className="text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Photography Consent</h1>
          <p className="text-sm text-gray-400">Please review and sign the agreement below.</p>
        </div>

        {/* Step: Read */}
        {step === 'read' && (
          <>
            <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 space-y-3">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Subject</p>
              <p className="text-sm font-semibold text-white">{record.subject_name}</p>
            </div>

            <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-3">Agreement</p>
              <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{record.rendered_body}</pre>
            </div>

            <button
              onClick={() => setStep('sign')}
              className="w-full py-4 rounded-2xl bg-indigo-600 active:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 [touch-action:manipulation]"
            >
              <CheckCircle2 size={16} /> I have read this agreement
            </button>
          </>
        )}

        {/* Step: Sign */}
        {step === 'sign' && (
          <>
            <div className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 space-y-4">
              <p className="text-sm font-semibold text-white">Sign Below</p>
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Your Name *</label>
                <input
                  type="text"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-[16px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  placeholder="Your full name"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                />
              </div>
              <SignaturePad
                onSignature={setSignatureData}
                height={180}
                label="Draw your signature"
              />
            </div>

            {signError && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle size={12} /> {signError}
              </div>
            )}

            <button
              onClick={async () => {
                if (!signerName.trim()) { setSignError('Please enter your name'); return }
                if (!signatureData) { setSignError('Please draw your signature'); return }
                setSignError('')
                setSigning(true)
                try {
                  await consentApi.signByEmail(emailToken, {
                    signature_data: signatureData,
                    signer_name: signerName.trim(),
                  })
                  setStep('done')
                } catch (e: any) {
                  setSignError(e?.message || 'Failed to save signature. Please try again.')
                } finally {
                  setSigning(false)
                }
              }}
              disabled={signing || !signatureData || !signerName.trim()}
              className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 [touch-action:manipulation]"
            >
              {signing
                ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                : <><CheckCircle2 size={16} /> Sign Agreement</>
              }
            </button>
          </>
        )}

        <div className="text-center">
          <p className="text-[10px] text-gray-700">Powered by MLDock.io · Photography Consent System</p>
        </div>
      </div>
    </div>
  )
}
