import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getContractView, signContract } from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type { VendorContractView } from '@/types/vendor'

export default function VendorContractPage() {
  const { token } = useParams<{ token: string }>()
  const [contract, setContract] = useState<VendorContractView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)

  // Canvas signature
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    if (!token) return
    getContractView(token)
      .then((c) => {
        setContract(c)
        if (c.vendor_signature) setSigned(true)
      })
      .catch((err) => setLoadError(extractApiError(err).message))
  }, [token])

  function startDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    drawing.current = true
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#1d4ed8'
    ctx.lineCap = 'round'
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }

  function stopDraw() {
    drawing.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function handleSign() {
    if (!token || !contract) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]

    setSubmitting(true)
    setError(null)
    try {
      await signContract(token, { signature_base64: base64, signer_name: signerName })
      setSigned(true)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 mb-2">Contract Not Found</p>
          <p className="text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!contract) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>
  }

  if (signed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Contract Signed!</h2>
          <p className="text-gray-500">
            Thank you for signing the contract. Check your email for your account setup link.
          </p>
          {contract.vendor_signature && (
            <div className="mt-4 text-left bg-gray-50 rounded-xl p-4 text-sm">
              <p className="text-gray-500 mb-1">Signed by: <strong>{contract.vendor_signature.signed_by_name}</strong></p>
              <p className="text-gray-500">Date: {new Date(contract.vendor_signature.signed_at).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Contract header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{contract.title}</h1>
              <p className="text-sm text-gray-500">{contract.company_name}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              contract.status === 'sent' ? 'bg-yellow-100 text-yellow-700' :
              contract.status === 'vendor_signed' ? 'bg-green-100 text-green-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {contract.status.replace('_', ' ')}
            </span>
          </div>
          <div className="flex gap-4 text-sm text-gray-500">
            <span>Start: {new Date(contract.start_date).toLocaleDateString('en-KE')}</span>
            <span>End: {new Date(contract.end_date).toLocaleDateString('en-KE')}</span>
          </div>
        </div>

        {/* Contract content */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Contract Terms</h2>
          <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
            {contract.content}
          </div>
        </div>

        {/* Signature section */}
        {contract.status === 'sent' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Your Signature</h2>

            {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg mb-4">{error}</div>}

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Sign with your full legal name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700">Draw Signature</label>
                <button type="button" onClick={clearCanvas} className="text-xs text-gray-400 hover:text-gray-600">
                  Clear
                </button>
              </div>
              <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={150}
                  className="w-full bg-white cursor-crosshair touch-none"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Draw your signature above</p>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              By signing, you agree to the terms and conditions outlined in this contract.
            </p>

            <button
              onClick={handleSign}
              disabled={submitting || !signerName.trim()}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Signing…' : 'Sign Contract'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
