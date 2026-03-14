import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { shipmentSignApi } from '@/api/inventory'
import { extractApiError } from '@/utils/apiError'
import type { ShipmentPublicContext } from '@/types/inventory'

export default function ShipmentSignPage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const role = searchParams.get('role') === 'receiver' ? 'receiver' : 'driver'

  const [context, setContext] = useState<ShipmentPublicContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)
  const [signedStatus, setSignedStatus] = useState('')

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    if (!token) return
    const load = role === 'driver'
      ? shipmentSignApi.getDriverContext(token)
      : shipmentSignApi.getReceiverContext(token)
    load
      .then(setContext)
      .catch((err) => setLoadError(extractApiError(err).message))
  }, [token, role])

  // Touch events for canvas
  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    drawing.current = true
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e, canvas)
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#0f2a5e'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function stopDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function handleSign(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    if (!signerName.trim()) { setError('Please enter your name'); return }
    if (!confirmed) { setError('Please confirm the items listed'); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')

    setSubmitting(true)
    setError(null)
    try {
      const fn = role === 'driver' ? shipmentSignApi.signDriver : shipmentSignApi.signReceiver
      const result = await fn(token, {
        signed_by_name: signerName,
        signature_b64: dataUrl,
      })
      setSigned(true)
      setSignedStatus(result.status)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🔗</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Invalid Link</h2>
          <p className="text-sm text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!context) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading shipment details…</div>
      </div>
    )
  }

  if (signed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">
            {role === 'driver' ? 'Dispatch Confirmed' : 'Delivery Confirmed'}
          </h2>
          <p className="text-sm text-gray-500">
            {signedStatus === 'pending_receiver'
              ? 'The receiver will be notified to confirm delivery.'
              : signedStatus === 'delivered'
              ? 'The waybill PDF has been generated and is available to the organisation.'
              : 'Your signature has been recorded.'}
          </p>
          <p className="text-xs text-gray-400 mt-4">Reference: {context.reference_number}</p>
        </div>
      </div>
    )
  }

  const totalLineWeight = context.items.reduce((sum, i) => sum + (i.line_weight ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Org header */}
      <div className="bg-[#0f2a5e] text-white px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          {context.org_logo_url && (
            <img src={context.org_logo_url} alt="org logo" className="h-10 w-10 rounded-full object-cover" />
          )}
          <div>
            <p className="text-xs opacity-70 uppercase tracking-wide">Waybill / Proof of Dispatch</p>
            <p className="font-bold text-lg">{context.org_name ?? 'PMS'}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Shipment info card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-gray-500">Reference</p>
              <p className="font-mono font-bold text-xl text-gray-900">{context.reference_number}</p>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              context.status === 'delivered' ? 'bg-green-100 text-green-800' :
              context.status === 'pending_driver' ? 'bg-yellow-100 text-yellow-800' :
              'bg-blue-100 text-blue-700'
            }`}>
              {context.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {context.tracking_number && (
              <div><p className="text-xs text-gray-500">Tracking #</p><p className="font-medium text-gray-900">{context.tracking_number}</p></div>
            )}
            {context.vehicle_number && (
              <div><p className="text-xs text-gray-500">Vehicle</p><p className="font-medium text-gray-900">{context.vehicle_number}</p></div>
            )}
            <div><p className="text-xs text-gray-500">Driver</p><p className="font-medium text-gray-900">{context.driver_name}</p></div>
            <div><p className="text-xs text-gray-500">Destination</p><p className="font-medium text-gray-900">{context.destination}</p></div>
            {context.receiver_name && (
              <div><p className="text-xs text-gray-500">Receiver</p><p className="font-medium text-gray-900">{context.receiver_name}</p></div>
            )}
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="font-semibold text-gray-900 text-sm">Items</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Item</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Qty</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Serial Numbers</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Weight (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {context.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.item_name}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{item.quantity} {item.unit_of_measure}</td>
                  <td className="px-3 py-3">
                    {item.serial_numbers && item.serial_numbers.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.serial_numbers.map(s => (
                          <span key={s} className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{s}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {item.line_weight ? `${item.line_weight.toFixed(3)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={3} className="px-4 py-3 text-sm font-bold text-gray-700 text-right">Total Weight</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">{totalLineWeight > 0 ? `${totalLineWeight.toFixed(3)} kg` : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Notes */}
        {context.notes && (
          <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4">
            <p className="text-xs font-semibold text-yellow-800 mb-1">Notes</p>
            <p className="text-sm text-yellow-900">{context.notes}</p>
          </div>
        )}

        {/* Signature form */}
        <form onSubmit={handleSign} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-bold text-gray-900">
            {role === 'driver' ? 'Driver Signature' : 'Receiver Signature'}
          </h2>

          <div>
            <label className="text-xs font-medium text-gray-700">Your Full Name *</label>
            <input
              className="input mt-1 w-full"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder={role === 'driver' ? 'Driver\'s full name' : 'Receiver\'s full name'}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Signature *</label>
              <button type="button" onClick={clearCanvas} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden" style={{ touchAction: 'none' }}>
              <canvas
                ref={canvasRef}
                width={560}
                height={180}
                className="w-full h-36 cursor-crosshair"
                style={{ touchAction: 'none' }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Draw your signature using mouse or touch</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span className="text-sm text-gray-700">
              I confirm that the items listed above are correct and I am{' '}
              {role === 'driver' ? 'taking responsibility for their delivery' : 'acknowledging their receipt'}.
            </span>
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 text-sm font-semibold text-white bg-[#0f2a5e] hover:bg-[#1d4ed8] rounded-xl disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : role === 'driver' ? 'Confirm Dispatch & Sign' : 'Confirm Delivery & Sign'}
          </button>
        </form>
      </div>
    </div>
  )
}
