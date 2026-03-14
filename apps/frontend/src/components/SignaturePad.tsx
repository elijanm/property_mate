import { useRef } from 'react'

interface Props {
  onSign: (dataUrl: string) => void
  onClear: () => void
  isEmpty: boolean
  /** Existing signature URL — displayed as a preview image behind the canvas */
  initialUrl?: string
}

export default function SignaturePad({ onSign, onClear, isEmpty, initialUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = true
    lastPos.current = getPos(e)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    const pos = getPos(e)
    if (!pos || !lastPos.current) return
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
    onSign(canvas!.toDataURL('image/png'))
  }

  function stopDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    drawing.current = false
    lastPos.current = null
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onClear()
  }

  return (
    <div>
      <div
        className="relative border-2 border-gray-300 rounded-xl overflow-hidden bg-white touch-none"
        style={{ userSelect: 'none' }}
      >
        {/* Existing signature shown as background — plain <img> avoids canvas CORS tainting */}
        {initialUrl && isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <img
              src={initialUrl}
              alt="Current signature"
              className="max-h-full max-w-full object-contain opacity-40"
            />
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full block cursor-crosshair relative"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />

        {/* Placeholder hint */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-gray-300 text-xs select-none mt-16">
              {initialUrl ? 'Draw to replace' : 'Draw your signature here'}
            </p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Clear signature
      </button>
    </div>
  )
}
