import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { onboardingsApi, type OnboardingVerifyResponse } from '@/api/onboardings'
import { extractApiError } from '@/utils/apiError'

type Tab = 'code' | 'document'

export default function VerifyPage() {
  const { onboardingId } = useParams<{ onboardingId: string }>()
  const [tab, setTab] = useState<Tab>('code')
  const [code, setCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OnboardingVerifyResponse | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    if (!onboardingId || !code.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await onboardingsApi.verifyByCode(onboardingId, code.trim())
      setResult(res)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyDocument(e: React.FormEvent) {
    e.preventDefault()
    if (!onboardingId || !file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await onboardingsApi.verifyByDocument(onboardingId, file)
      setResult(res)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
    setCode('')
    setFile(null)
  }

  const fmt = (v?: number) =>
    v !== undefined ? `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—'

  const fmtDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verify Document</h1>
          <p className="text-sm text-gray-500 mt-1">Confirm the authenticity of a lease agreement</p>
        </div>

        {result ? (
          <ResultCard result={result} fmt={fmt} fmtDate={fmtDate} onReset={reset} />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              {(['code', 'document'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(null) }}
                  className={[
                    'flex-1 py-3.5 text-sm font-medium transition-colors',
                    tab === t
                      ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                      : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  {t === 'code' ? 'Enter Code' : 'Upload Document'}
                </button>
              ))}
            </div>

            <div className="p-6">
              {tab === 'code' ? (
                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="e.g. A3F7C2D1"
                      maxLength={8}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-xl font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-400 mt-2">
                      Find the 8-character code at the bottom of your signed lease document.
                    </p>
                  </div>
                  {error && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={loading || code.length < 4}
                    className="w-full py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Verifying…' : 'Verify Code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyDocument} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Upload Signed Document
                    </label>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      {file ? (
                        <>
                          <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm font-medium text-gray-700">{file.name}</span>
                          <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span className="text-sm text-gray-500">Click to select PDF</span>
                          <span className="text-xs text-gray-400">Upload the signed lease PDF</span>
                        </>
                      )}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f) }}
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !file}
                    className="w-full py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Verifying…' : 'Verify Document'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultCard({
  result,
  fmt,
  fmtDate,
  onReset,
}: {
  result: OnboardingVerifyResponse
  fmt: (v?: number) => string
  fmtDate: (d?: string) => string
  onReset: () => void
}) {
  const isAuth = result.is_authentic

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${isAuth ? 'border-green-200' : 'border-red-200'}`}>
      {/* Status banner */}
      <div className={`px-6 py-5 ${isAuth ? 'bg-green-50' : 'bg-red-50'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isAuth ? 'bg-green-100' : 'bg-red-100'}`}>
            {isAuth ? (
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div>
            <p className={`text-sm font-bold ${isAuth ? 'text-green-800' : 'text-red-800'}`}>
              {isAuth ? 'Document Authentic' : 'Document Not Verified'}
            </p>
            <p className={`text-xs ${isAuth ? 'text-green-600' : 'text-red-600'}`}>
              {isAuth
                ? 'This lease agreement is genuine and unmodified.'
                : 'This document could not be verified. It may have been altered.'}
            </p>
          </div>
        </div>
      </div>

      {isAuth && (
        <div className="p-6 space-y-3">
          <DetailRow label="Tenant" value={result.tenant_name ?? '—'} />
          <DetailRow label="Property" value={result.property_name ?? '—'} />
          <DetailRow label="Unit" value={result.unit_code ?? '—'} />
          <DetailRow label="Rent" value={fmt(result.rent_amount)} />
          <DetailRow label="Start Date" value={fmtDate(result.start_date)} />
          <DetailRow label="End Date" value={fmtDate(result.end_date)} />
          {result.signed_at && (
            <DetailRow label="Signed By Tenant" value={fmtDate(result.signed_at)} />
          )}
          {result.owner_signed_at && (
            <DetailRow
              label="Countersigned By"
              value={`${result.owner_signed_by ?? 'Owner'} on ${fmtDate(result.owner_signed_at)}`}
            />
          )}
        </div>
      )}

      <div className="px-6 pb-6">
        <button
          onClick={onReset}
          className="w-full py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
        >
          Verify another document
        </button>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}
