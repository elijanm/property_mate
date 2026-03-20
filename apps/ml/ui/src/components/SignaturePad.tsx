/**
 * SignaturePad — canvas-based signature capture component.
 * Calls onSignature(dataUrl) with a base64 PNG when the user has drawn.
 */
import { useRef, useState, useEffect, useCallback } from 'react'
import { RotateCcw, Check } from 'lucide-react'
import clsx from 'clsx'

interface SignaturePadProps {
  onSignature: (dataUrl: string) => void
  width?: number
  height?: number
  className?: string
  label?: string
}

export default function SignaturePad({
  onSignature,
  width,
  height = 160,
  className,
  label = 'Draw your signature below',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [drawing, setDrawing] = useState(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // Resize canvas to match displayed size
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      // Preserve existing drawing as image before resizing
      const ctx = canvas.getContext('2d')
      let imgData: ImageData | null = null
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      }
      canvas.width = rect.width
      canvas.height = rect.height
      if (ctx) {
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (imgData) {
          ctx.putImageData(imgData, 0, 0)
        }
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Initial fill
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width || (width ?? 300)
    canvas.height = height
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [height, width])

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top }
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    resizeCanvas()
    setDrawing(true)
    lastPos.current = getPos(e)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!drawing) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !lastPos.current) return
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
    setHasStrokes(true)
  }

  const stopDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    setDrawing(false)
    lastPos.current = null
    if (hasStrokes) {
      const canvas = canvasRef.current
      if (canvas) onSignature(canvas.toDataURL('image/png'))
    }
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onSignature('')
  }

  return (
    <div ref={containerRef} className={clsx('space-y-2', className)}>
      {label && (
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{label}</p>
      )}
      <div className="relative rounded-xl overflow-hidden border border-gray-700/60 bg-[#0f172a]">
        <canvas
          ref={canvasRef}
          className="w-full touch-none cursor-crosshair block"
          style={{ height }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        {!hasStrokes && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-gray-600 select-none">Sign here</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 text-xs transition-colors"
        >
          <RotateCcw size={11} /> Clear
        </button>
        {hasStrokes && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <Check size={11} /> Signature captured
          </span>
        )}
      </div>
    </div>
  )
}
