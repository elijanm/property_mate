import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Trash2, Upload, ChevronLeft, ChevronRight, Check, X,
  Download, Play, ZoomIn, ZoomOut, RotateCcw, Square, Pentagon,
  Minus, Tag, Layers, BarChart2, AlertCircle, Loader2, FolderOpen,
  RefreshCw, CheckCheck
} from 'lucide-react'
import { annotateApi } from '@/api/annotate'
import type { AnnotationProject, AnnotationImage, AnnotationShape, AnnotationType } from '@/types/annotate'

// ── colour palette per class ──────────────────────────────────────────────────
const CLASS_COLOURS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
]
function classColour(classes: string[], label: string) {
  const idx = classes.indexOf(label)
  return CLASS_COLOURS[idx % CLASS_COLOURS.length] ?? '#94a3b8'
}

// ── status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    unannotated: 'bg-zinc-700 text-zinc-300',
    annotating:  'bg-blue-900 text-blue-300',
    annotated:   'bg-green-900 text-green-300',
    predicted:   'bg-amber-900 text-amber-300',
    approved:    'bg-emerald-900 text-emerald-300',
    training:    'bg-purple-900 text-purple-300',
    collecting:  'bg-zinc-700 text-zinc-300',
    predicting:  'bg-amber-900 text-amber-300',
    done:        'bg-green-900 text-green-300',
    ready:       'bg-green-900 text-green-300',
    failed:      'bg-red-900 text-red-300',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'bg-zinc-700 text-zinc-300'}`}>
      {status}
    </span>
  )
}

// ── project list view ─────────────────────────────────────────────────────────
function ProjectList({
  projects, loading, onCreate, onOpen, onDelete,
}: {
  projects: AnnotationProject[]
  loading: boolean
  onCreate: () => void
  onOpen: (p: AnnotationProject) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Annotation Projects</h2>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus size={13} /> New Project
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-zinc-400 text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="text-center py-16 text-zinc-500">
          <Layers size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No annotation projects yet.</p>
          <p className="text-xs mt-1">Create one to start auto-annotating images.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {projects.map(p => {
          const pct = p.image_count ? Math.round((p.annotated_count / p.image_count) * 100) : 0
          const latestModel = p.model_versions[p.model_versions.length - 1]
          return (
            <div
              key={p.id}
              className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 hover:border-zinc-600 transition-colors cursor-pointer"
              onClick={() => onOpen(p)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-zinc-100 truncate">{p.name}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.description && (
                    <p className="text-xs text-zinc-500 truncate mb-2">{p.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {p.classes.map(c => (
                      <span key={c} className="text-[10px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">{c}</span>
                    ))}
                  </div>
                  {/* progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-zinc-500">
                      <span>{p.annotated_count}/{p.image_count} annotated</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {latestModel && (
                    <div className="mt-2 text-[10px] text-zinc-500">
                      Model v{latestModel.version} — <StatusBadge status={latestModel.status} />
                      {latestModel.map50 != null && (
                        <span className="ml-2 text-green-400">mAP50: {(latestModel.map50 * 100).toFixed(1)}%</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(p.id) }}
                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── create project modal ───────────────────────────────────────────────────────
function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (data: { name: string; description: string; classes: string[]; annotation_type: string }) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [classInput, setClassInput] = useState('object')
  const [annotationType, setAnnotationType] = useState('box')

  const classes = classInput.split(',').map(c => c.trim()).filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4">New Annotation Project</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Project name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Kenyan Plate Detection"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detect and recognise Kenyan license plates"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Classes (comma-separated)</label>
            <input
              value={classInput}
              onChange={e => setClassInput(e.target.value)}
              placeholder="license_plate, car"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {classes.map((c, i) => (
                <span key={i} style={{ background: CLASS_COLOURS[i % CLASS_COLOURS.length] + '33', color: CLASS_COLOURS[i % CLASS_COLOURS.length] }}
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Annotation type</label>
            <div className="flex gap-2">
              {(['box', 'polygon', 'line'] as const).map(t => (
                <button key={t} onClick={() => setAnnotationType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${annotationType === t ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>
                  {t === 'box' ? '⬜ Box' : t === 'polygon' ? '⬡ Polygon' : '— Line'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs text-zinc-400 border border-zinc-700 hover:border-zinc-600 transition-colors">
            Cancel
          </button>
          <button
            disabled={!name || classes.length === 0}
            onClick={() => onCreate({ name, description, classes, annotation_type: annotationType })}
            className="flex-1 py-2 rounded-lg text-xs bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-40"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  )
}

// ── canvas annotation editor ──────────────────────────────────────────────────
type DrawState = { startX: number; startY: number; points: [number, number][] }

function AnnotationCanvas({
  image, classes, annotationType, onChange,
}: {
  image: AnnotationImage
  classes: string[]
  annotationType: AnnotationType
  onChange: (annotations: AnnotationShape[]) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [annotations, setAnnotations] = useState<AnnotationShape[]>(image.annotations)
  const [selectedLabel, setSelectedLabel] = useState(classes[0] ?? 'object')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [drawState, setDrawState] = useState<DrawState | null>(null)
  // local tool override (box/polygon switchable in toolbar regardless of project default)
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType>(annotationType)
  const forceAnnotationType = (t: AnnotationType) => setActiveAnnotationType(t)
  // drag-move state
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState<[number, number]>([0, 0])
  // resize state: which handle corner (tl/tr/bl/br)
  const [resizeId, setResizeId] = useState<string | null>(null)
  const [resizeHandle, setResizeHandle] = useState<string>('')
  // rotation state
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string>('crosshair')

  // ── rotation helpers (all pixel-space) ──────────────────────────────────────
  /** Rotate a pixel-space vector by angle */
  const rotPx = (lx: number, ly: number, a: number): [number, number] => [
    lx * Math.cos(a) - ly * Math.sin(a),
    lx * Math.sin(a) + ly * Math.cos(a),
  ]
  /** Transform canvas-pixel mouse pos to local box pixel space */
  const toLocal = (mx: number, my: number, cxP: number, cyP: number, a: number): [number, number] => {
    const dx = mx - cxP, dy = my - cyP
    return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)]
  }
  /** Rotation handle position in canvas pixels (above top-center of box) */
  const rotHandlePx = (cxP: number, cyP: number, bhP: number, a: number): [number, number] => {
    const dist = bhP / 2 + 22
    const [rx, ry] = rotPx(0, -dist, a)
    return [cxP + rx, cyP + ry]
  }
  /** Extract [cx,cy,bw,bh,angle] from coords (angle defaults 0) */
  const unpackBox = (coords: number[] | number[][]): [number, number, number, number, number] => {
    const c = coords as number[]
    return [c[0], c[1], c[2], c[3], c[4] ?? 0]
  }
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  // baseSize = fit-to-container size at zoom=1; canvasSize = baseSize * zoom
  const [baseSize, setBaseSize] = useState({ w: 640, h: 480 })
  const [zoom, setZoom] = useState(1)
  const canvasSize = { w: Math.round(baseSize.w * zoom), h: Math.round(baseSize.h * zoom) }

  const ZOOM_STEP = 0.25
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 4

  const zoomIn  = () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX))
  const zoomOut = () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN))
  const zoomFit = () => setZoom(1)

  /** Recalculate base canvas size to fit container while preserving image aspect ratio */
  const recalcSize = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    const maxW = container.clientWidth
    const maxH = Math.max(container.clientHeight, 300)
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    setBaseSize({ w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) })
  }, [])

  // Reset when image changes
  useEffect(() => {
    setAnnotations(image.annotations)
    setSelectedId(null)
    setDrawing(false)
    setDrawState(null)
    setImgLoaded(false)
    setZoom(1)
  }, [image.id])

  // Load image
  useEffect(() => {
    if (!image.url) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      recalcSize()
      setImgLoaded(true)
    }
    img.src = image.url
  }, [image.url, recalcSize])

  // Recalc on container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recalcSize())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recalcSize])

  /** Full redraw — call whenever annotations, drawState, or size changes */
  const redraw = useCallback((
    anns: AnnotationShape[],
    ds: DrawState | null,
    liveEnd?: [number, number],
  ) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const { w, h } = canvasSize
    if (w === 0 || h === 0) return
    const ctx = canvas.getContext('2d')!
    // Clear by reassigning size (resets context)
    canvas.width = w
    canvas.height = h
    ctx.drawImage(img, 0, 0, w, h)

    // Draw saved annotations
    anns.forEach(ann => {
      const col = classColour(classes, ann.label)
      ctx.strokeStyle = ann.source === 'model' && !ann.approved ? col + '99' : col
      ctx.lineWidth = ann.id === selectedId ? 2.5 : 1.5
      ctx.setLineDash(ann.source === 'model' && !ann.approved ? [5, 4] : [])

      if (ann.type === 'box' && Array.isArray(ann.coords) && (ann.coords as number[]).length >= 4) {
        const [cx, cy, bw, bh, angle] = unpackBox(ann.coords)
        const cxP = cx * w, cyP = cy * h, bwP = bw * w, bhP = bh * h
        // Draw rotated box
        ctx.save()
        ctx.translate(cxP, cyP)
        ctx.rotate(angle)
        ctx.strokeRect(-bwP / 2, -bhP / 2, bwP, bhP)
        // Label at top-left corner (rotated)
        ctx.fillStyle = col
        ctx.font = 'bold 11px monospace'
        const txt = ann.confidence != null ? `${ann.label} ${(ann.confidence * 100).toFixed(0)}%` : ann.label
        const tw = ctx.measureText(txt).width
        ctx.fillRect(-bwP / 2, -bhP / 2 - 16, tw + 8, 16)
        ctx.fillStyle = '#000'
        ctx.fillText(txt, -bwP / 2 + 4, -bhP / 2 - 4)
        ctx.restore()
        // Draw handles on selected box
        if (ann.id === selectedId) {
          ctx.setLineDash([])
          // Corner resize handles
          const localCorners: [number, number][] = [[-bwP/2, -bhP/2], [bwP/2, -bhP/2], [-bwP/2, bhP/2], [bwP/2, bhP/2]]
          localCorners.forEach(([lx, ly]) => {
            const [rx, ry] = rotPx(lx, ly, angle)
            ctx.beginPath()
            ctx.arc(cxP + rx, cyP + ry, 5, 0, Math.PI * 2)
            ctx.fillStyle = '#fff'
            ctx.fill()
            ctx.strokeStyle = col
            ctx.lineWidth = 1.5
            ctx.stroke()
          })
          // Rotation handle (above top-center)
          const [hx, hy] = rotHandlePx(cxP, cyP, bhP, angle)
          // Line from top-center to handle
          const [tcRx, tcRy] = rotPx(0, -bhP / 2, angle)
          ctx.beginPath()
          ctx.moveTo(cxP + tcRx, cyP + tcRy)
          ctx.lineTo(hx, hy)
          ctx.strokeStyle = col
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.arc(hx, hy, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#7c3aed'
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.5
          ctx.stroke()
          // Angle label
          if (Math.abs(angle) > 0.01) {
            ctx.fillStyle = '#7c3aed'
            ctx.font = '10px monospace'
            ctx.fillText(`${Math.round(angle * 180 / Math.PI)}°`, hx + 8, hy)
          }
        }
      } else if (ann.type === 'polygon' && Array.isArray(ann.coords) && (ann.coords as number[][]).length > 0) {
        const pts = ann.coords as number[][]
        ctx.beginPath()
        pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px * w, py * h) : ctx.lineTo(px * w, py * h))
        ctx.closePath()
        ctx.stroke()
      }
    })

    ctx.setLineDash([])

    // In-progress draw state
    if (ds) {
      const col = classColour(classes, selectedLabel)
      ctx.strokeStyle = col
      ctx.lineWidth = 1.5

      if (activeAnnotationType === 'box' && liveEnd) {
        ctx.strokeRect(
          ds.startX * w, ds.startY * h,
          (liveEnd[0] - ds.startX) * w, (liveEnd[1] - ds.startY) * h,
        )
      } else if (activeAnnotationType === 'polygon' && ds.points.length > 0) {
        ctx.beginPath()
        ds.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px * w, py * h) : ctx.lineTo(px * w, py * h))
        if (liveEnd) ctx.lineTo(liveEnd[0] * w, liveEnd[1] * h)
        ctx.stroke()
        ds.points.forEach(([px, py]) => {
          ctx.beginPath()
          ctx.arc(px * w, py * h, 3, 0, Math.PI * 2)
          ctx.fillStyle = col
          ctx.fill()
        })
      }
    }
  }, [canvasSize, classes, selectedId, selectedLabel, activeAnnotationType])

  // Redraw whenever stable state changes (not during live drag)
  useEffect(() => {
    if (!imgLoaded) return
    redraw(annotations, drawState)
  }, [annotations, imgLoaded, canvasSize, selectedId, drawState, redraw])

  const normalise = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ]
  }

  /** Return which resize handle (tl/tr/bl/br) the cursor is near, or null — rotation-aware */
  const hitHandle = (ann: AnnotationShape, nx: number, ny: number): string | null => {
    if (ann.type !== 'box' || (ann.coords as number[]).length < 4) return null
    const { w, h } = canvasSize
    const [cx, cy, bw, bh, angle] = unpackBox(ann.coords)
    const cxP = cx * w, cyP = cy * h, bwP = bw * w, bhP = bh * h
    const mxP = nx * w, myP = ny * h
    const T = 9 // hit tolerance in pixels
    const localCorners: [number, number, string][] = [[-bwP/2, -bhP/2, 'tl'], [bwP/2, -bhP/2, 'tr'], [-bwP/2, bhP/2, 'bl'], [bwP/2, bhP/2, 'br']]
    for (const [lx, ly, name] of localCorners) {
      const [rx, ry] = rotPx(lx, ly, angle)
      if (Math.hypot(mxP - (cxP + rx), myP - (cyP + ry)) < T) return name
    }
    return null
  }

  /** Return true if cursor is near the rotation handle of ann */
  const hitRotHandle = (ann: AnnotationShape, nx: number, ny: number): boolean => {
    if (ann.type !== 'box' || (ann.coords as number[]).length < 4) return false
    const { w, h } = canvasSize
    const [cx, cy, bw, bh, angle] = unpackBox(ann.coords)
    const [hx, hy] = rotHandlePx(cx * w, cy * h, bh * h, angle)
    return Math.hypot(nx * w - hx, ny * h - hy) < 10
  }

  /** Return annotation id if cursor is inside its (rotated) box */
  const hitBox = (nx: number, ny: number): string | null => {
    const { w, h } = canvasSize
    const mxP = nx * w, myP = ny * h
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i]
      if (ann.type !== 'box' || (ann.coords as number[]).length < 4) continue
      const [cx, cy, bw, bh, angle] = unpackBox(ann.coords)
      // Transform mouse to local box space
      const [lx, ly] = toLocal(mxP, myP, cx * w, cy * h, angle)
      if (Math.abs(lx) <= bw * w / 2 && Math.abs(ly) <= bh * h / 2) return ann.id
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const [nx, ny] = normalise(e)

    // Check rotation handle first (only on selected box)
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId)
      if (ann && hitRotHandle(ann, nx, ny)) {
        setRotatingId(selectedId)
        return
      }
    }

    // Check resize handles (only on selected box)
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId)
      if (ann) {
        const handle = hitHandle(ann, nx, ny)
        if (handle) {
          setResizeId(selectedId)
          setResizeHandle(handle)
          return
        }
      }
    }

    // Check if clicking inside an existing box → drag
    const hit = hitBox(nx, ny)
    if (hit) {
      const ann = annotations.find(a => a.id === hit)!
      const [cx, cy] = unpackBox(ann.coords)
      setDragId(hit)
      setDragOffset([nx - cx, ny - cy])
      setSelectedId(hit)
      return
    }

    // Otherwise draw
    if (activeAnnotationType === 'box') {
      setDrawing(true)
      setSelectedId(null)
      setDrawState({ startX: nx, startY: ny, points: [[nx, ny]] })
    } else if (activeAnnotationType === 'polygon') {
      if (drawState && drawState.points.length >= 3) {
        const [fx, fy] = drawState.points[0]
        if (Math.hypot(nx - fx, ny - fy) < 0.02) { finishPolygon(); return }
      }
      setSelectedId(null)
      setDrawState(prev => ({
        startX: nx, startY: ny,
        points: prev ? [...prev.points, [nx, ny]] : [[nx, ny]],
      }))
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const [nx, ny] = normalise(e)

    // Rotation
    if (rotatingId) {
      const ann = annotations.find(a => a.id === rotatingId)
      if (!ann) return
      const [cx, cy] = unpackBox(ann.coords)
      const { w, h } = canvasSize
      const angle = Math.atan2(nx * w - cx * w, cy * h - ny * h)
      const updated = annotations.map(a => {
        if (a.id !== rotatingId) return a
        const [acx, acy, bw, bh] = unpackBox(a.coords)
        return { ...a, coords: [acx, acy, bw, bh, angle] }
      })
      setAnnotations(updated)
      redraw(updated, drawState)
      return
    }

    // Resize (rotation-aware)
    if (resizeId) {
      const ann = annotations.find(a => a.id === resizeId)
      if (!ann || ann.type !== 'box') return
      const { w, h } = canvasSize
      const [cx, cy, bw, bh, angle] = unpackBox(ann.coords)
      // Transform mouse to local box pixel space
      const [lx, ly] = toLocal(nx * w, ny * h, cx * w, cy * h, angle)
      // Fixed corner stays put; dragged corner is at local mouse pos
      let newBwP = bw * w, newBhP = bh * h
      let offsetX = 0, offsetY = 0
      if (resizeHandle === 'tl') { newBwP = bw * w / 2 - lx; newBhP = bh * h / 2 - ly; offsetX = (bw * w / 2 + lx) / 2; offsetY = (bh * h / 2 + ly) / 2 }
      else if (resizeHandle === 'tr') { newBwP = bw * w / 2 + lx; newBhP = bh * h / 2 - ly; offsetX = -(bw * w / 2 - lx) / 2; offsetY = (bh * h / 2 + ly) / 2 }
      else if (resizeHandle === 'bl') { newBwP = bw * w / 2 - lx; newBhP = bh * h / 2 + ly; offsetX = (bw * w / 2 + lx) / 2; offsetY = -(bh * h / 2 - ly) / 2 }
      else if (resizeHandle === 'br') { newBwP = bw * w / 2 + lx; newBhP = bh * h / 2 + ly; offsetX = -(bw * w / 2 - lx) / 2; offsetY = -(bh * h / 2 - ly) / 2 }
      if (Math.abs(newBwP) < 5 || Math.abs(newBhP) < 5) return
      // Shift center by half the size change (in rotated space)
      const [dcx, dcy] = rotPx(offsetX, offsetY, angle)
      const updated = annotations.map(a =>
        a.id === resizeId ? { ...a, coords: [cx + dcx / w, cy + dcy / h, Math.abs(newBwP) / w, Math.abs(newBhP) / h, angle] } : a
      )
      setAnnotations(updated)
      redraw(updated, drawState)
      return
    }

    // Drag
    if (dragId) {
      const [ox, oy] = dragOffset
      const updated = annotations.map(a => {
        if (a.id !== dragId || a.type !== 'box') return a
        const [, , bw, bh, angle] = unpackBox(a.coords)
        const ncx = Math.max(bw / 2, Math.min(1 - bw / 2, nx - ox))
        const ncy = Math.max(bh / 2, Math.min(1 - bh / 2, ny - oy))
        return { ...a, coords: [ncx, ncy, bw, bh, angle] }
      })
      setAnnotations(updated)
      redraw(updated, drawState)
      return
    }

    // Live draw
    if (drawState) {
      redraw(annotations, drawState, [nx, ny])
      return
    }

    // Update cursor based on hover
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId)
      if (ann) {
        if (hitRotHandle(ann, nx, ny)) { setCursor('grab'); return }
        const handle = hitHandle(ann, nx, ny)
        if (handle === 'tl' || handle === 'br') { setCursor('nwse-resize'); return }
        if (handle === 'tr' || handle === 'bl') { setCursor('nesw-resize'); return }
      }
    }
    const hit = hitBox(nx, ny)
    setCursor(hit ? 'move' : 'crosshair')
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Finish rotation
    if (rotatingId) {
      onChange(annotations)
      setRotatingId(null)
      return
    }
    // Finish resize
    if (resizeId) {
      onChange(annotations)
      setResizeId(null)
      setResizeHandle('')
      return
    }
    // Finish drag
    if (dragId) {
      onChange(annotations)
      setDragId(null)
      return
    }
    // Finish draw
    if (!drawing || activeAnnotationType !== 'box' || !drawState) return
    setDrawing(false)
    const [nx, ny] = normalise(e)
    const x1 = Math.min(drawState.startX, nx)
    const y1 = Math.min(drawState.startY, ny)
    const x2 = Math.max(drawState.startX, nx)
    const y2 = Math.max(drawState.startY, ny)
    const bw = x2 - x1, bh = y2 - y1
    if (bw < 0.01 || bh < 0.01) { setDrawState(null); return }
    const id = crypto.randomUUID()
    const ann: AnnotationShape = {
      id, type: 'box', label: selectedLabel,
      coords: [x1 + bw / 2, y1 + bh / 2, bw, bh],
      approved: true, source: 'manual',
    }
    const next = [...annotations, ann]
    setAnnotations(next)
    setSelectedId(id)
    onChange(next)
    setDrawState(null)
  }

  const finishPolygon = () => {
    if (!drawState || drawState.points.length < 3) return
    const id = crypto.randomUUID()
    const ann: AnnotationShape = {
      id, type: 'polygon', label: selectedLabel,
      coords: drawState.points,
      approved: true, source: 'manual',
    }
    const next = [...annotations, ann]
    setAnnotations(next)
    onChange(next)
    setDrawState(null)
  }

  const handleDoubleClick = () => {
    if (activeAnnotationType === 'polygon') finishPolygon()
  }

  const removeAnnotation = (id: string) => {
    const next = annotations.filter(a => a.id !== id)
    setAnnotations(next)
    onChange(next)
    setSelectedId(null)
  }

  const approveAll = () => {
    const next = annotations.map(a => ({ ...a, approved: true }))
    setAnnotations(next)
    onChange(next)
  }

  return (
    <div className="flex gap-3 h-full">
      {/* Canvas */}
      <div ref={containerRef} className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Shape type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
            {(['box', 'polygon'] as const).map(t => (
              <button key={t}
                onClick={() => { setDrawState(null); setDrawing(false); onChange(annotations.map(a => ({ ...a }))) /* keep annotations, just switch tool */; forceAnnotationType(t) }}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${activeAnnotationType === t ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t === 'box' ? '⬜ Box' : '⬡ Poly'}
              </button>
            ))}
          </div>
          {/* Class labels */}
          {classes.map((c, i) => (
            <button key={c} onClick={() => setSelectedLabel(c)}
              style={{ borderColor: CLASS_COLOURS[i % CLASS_COLOURS.length], color: selectedLabel === c ? '#fff' : CLASS_COLOURS[i % CLASS_COLOURS.length], background: selectedLabel === c ? CLASS_COLOURS[i % CLASS_COLOURS.length] + '33' : 'transparent' }}
              className="px-2 py-0.5 rounded border text-[11px] font-medium transition-colors">
              {c}
            </button>
          ))}
          <span className="ml-auto text-zinc-500 text-[10px]">
            {activeAnnotationType === 'box' ? 'Drag to draw · click box to move/resize' : 'Click points · dbl-click to close'}
          </span>
          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 border border-zinc-700 rounded-lg overflow-hidden flex-shrink-0">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN}
              className="px-1.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 hover:text-zinc-200 transition-colors">
              <ZoomOut size={12} />
            </button>
            <button onClick={zoomFit}
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] font-mono transition-colors min-w-[38px] text-center">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX}
              className="px-1.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 hover:text-zinc-200 transition-colors">
              <ZoomIn size={12} />
            </button>
          </div>
          {annotations.some(a => a.source === 'model' && !a.approved) && (
            <button onClick={approveAll} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors">
              <CheckCheck size={12} /> Approve all
            </button>
          )}
        </div>
        {/* Scrollable canvas wrapper — allows panning when zoomed in */}
        <div className="flex-1 overflow-auto rounded-lg">
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="rounded-lg border border-zinc-700 block"
            style={{ width: canvasSize.w, height: canvasSize.h, cursor }}
            onWheel={e => {
              if (!e.ctrlKey && !e.metaKey) return
              e.preventDefault()
              if (e.deltaY < 0) zoomIn(); else zoomOut()
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { if (dragId || resizeId || rotatingId) { onChange(annotations); setDragId(null); setResizeId(null); setRotatingId(null) } }}
            onDoubleClick={handleDoubleClick}
          />
          {!imgLoaded && (
            <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading image…
            </div>
          )}
        </div>
      </div>

      {/* Annotation list */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-2">
        <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">
          Annotations ({annotations.length})
        </p>
        <div className="flex-1 overflow-y-auto space-y-1">
          {annotations.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-6">No annotations yet</p>
          )}
          {annotations.map(ann => {
            const col = classColour(classes, ann.label)
            return (
              <div key={ann.id}
                onClick={() => setSelectedId(ann.id === selectedId ? null : ann.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer border transition-colors ${selectedId === ann.id ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-700/50 bg-zinc-800/40 hover:border-zinc-600'}`}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-zinc-300 truncate">{ann.label}</p>
                  <p className="text-[10px] text-zinc-600">
                    {ann.source === 'model' ? (ann.approved ? '✓ approved' : `pred ${((ann.confidence ?? 0) * 100).toFixed(0)}%`) : 'manual'}
                  </p>
                </div>
                <button onClick={e => { e.stopPropagation(); removeAnnotation(ann.id) }}
                  className="text-zinc-600 hover:text-red-400 transition-colors">
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── annotation workspace ───────────────────────────────────────────────────────
function AnnotationWorkspace({ project, onBack, onProjectUpdate }: {
  project: AnnotationProject
  onBack: () => void
  onProjectUpdate: (p: AnnotationProject) => void
}) {
  const [images, setImages] = useState<AnnotationImage[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingAnns, setPendingAnns] = useState<AnnotationShape[] | null>(null)
  const [trainingVersionId, setTrainingVersionId] = useState<string | null>(null)
  const [trainPoll, setTrainPoll] = useState(false)
  const [exporting, setExporting] = useState(false)
  // predict progress
  const [predictPoll, setPredictPoll] = useState(false)
  const [predictTotal, setPredictTotal] = useState(0)
  const [predictDone, setPredictDone] = useState(0)
  const predictStartCountRef = useRef(0)
  // single-image predict
  const [predictingImageId, setPredictingImageId] = useState<string | null>(null)
  // inline notices (replaces alert)
  type Notice = { id: number; type: 'success' | 'error' | 'info'; message: string }
  const [notices, setNotices] = useState<Notice[]>([])
  const noticeId = useRef(0)
  const addNotice = useCallback((type: Notice['type'], message: string) => {
    const id = ++noticeId.current
    setNotices(prev => [...prev, { id, type, message }])
    setTimeout(() => setNotices(prev => prev.filter(n => n.id !== id)), 4000)
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const imgs = await annotateApi.listImages(project.id)
      setImages(imgs)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => { load() }, [load])

  // Poll training status
  useEffect(() => {
    if (!trainPoll || !trainingVersionId) return
    const interval = setInterval(async () => {
      try {
        const status = await annotateApi.trainingStatus(project.id, trainingVersionId)
        if (status.status === 'ready' || status.status === 'predicting') {
          setTrainPoll(false)
          const refreshedImgs = await annotateApi.listImages(project.id)
          setImages(refreshedImgs)
          const p = await annotateApi.getProject(project.id)
          onProjectUpdate(p)
          const map50Str = status.map50 != null ? ` · mAP50 ${(status.map50 * 100).toFixed(1)}%` : ''
          addNotice('success', `Model v${status.version} trained on ${status.trained_on} images${map50Str}`)
          // If still predicting, kick off the predict progress bar
          if (status.status === 'predicting') {
            const toPredict = refreshedImgs.filter(i => !i.annotations?.some((a: any) => a.source === 'manual'))
            if (toPredict.length > 0) {
              predictStartCountRef.current = refreshedImgs.filter(i => i.status === 'predicted' || i.status === 'approved').length
              setPredictTotal(toPredict.length)
              setPredictDone(0)
              setPredictPoll(true)
            }
          }
        } else if (status.status === 'failed') {
          setTrainPoll(false)
          addNotice('error', `Training failed: ${status.error ?? 'unknown error'}`)
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [trainPoll, trainingVersionId, project.id, load, onProjectUpdate])

  // Poll prediction progress
  useEffect(() => {
    if (!predictPoll) return
    const interval = setInterval(async () => {
      try {
        const imgs = await annotateApi.listImages(project.id)
        const newPredicted = imgs.filter(i => i.status === 'predicted' || i.status === 'approved').length
        const done = newPredicted - predictStartCountRef.current
        setPredictDone(Math.max(0, done))
        setImages(imgs)
        if (done >= predictTotal) {
          setPredictPoll(false)
          addNotice('success', `Auto-predict complete — ${done} image${done !== 1 ? 's' : ''} annotated`)
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [predictPoll, predictTotal, project.id, addNotice])

  const currentImage = images[currentIdx]
  const annotatedCount = images.filter(i => i.annotations?.length > 0).length
  const canTrain = annotatedCount >= project.min_annotations_to_train

  const handleUpload = async (files: FileList) => {
    const arr = Array.from(files)
    if (!arr.length) return
    try {
      const res = await annotateApi.addImages(project.id, arr)
      const wasEmpty = images.length === 0
      setImages(prev => [...prev, ...res.images])
      if (wasEmpty) setCurrentIdx(0)
      // If auto-predict was kicked off, show spinner on each new image
      if (res.auto_predicting) {
        for (const img of res.images) {
          setPredictingImageId(img.id)
          // Poll until status changes from unannotated
          const poll = setInterval(async () => {
            try {
              const updated = await annotateApi.getImage(project.id, img.id)
              if (updated.status !== 'unannotated') {
                setImages(prev => prev.map(i => i.id === img.id ? updated : i))
                setPredictingImageId(id => id === img.id ? null : id)
                clearInterval(poll)
              }
            } catch { clearInterval(poll) }
          }, 2000)
          // Safety timeout after 60s
          setTimeout(() => clearInterval(poll), 60000)
        }
        addNotice('info', `${res.images.length} image${res.images.length > 1 ? 's' : ''} uploaded — auto-predicting with active model…`)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async () => {
    if (!currentImage || pendingAnns === null) return
    setSaving(true)
    try {
      const result = await annotateApi.saveAnnotations(project.id, currentImage.id, pendingAnns)
      setImages(prev => prev.map(i => i.id === currentImage.id ? { ...i, annotations: pendingAnns, status: result.status } : i))
      setPendingAnns(null)
    } finally {
      setSaving(false)
    }
  }

  const handleApproveAll = async () => {
    if (!currentImage) return
    setSaving(true)
    try {
      const updated = await annotateApi.approvePredictions(project.id, currentImage.id)
      setImages(prev => prev.map(i => i.id === currentImage.id ? updated : i))
    } finally {
      setSaving(false)
    }
  }

  const handleTrain = async () => {
    try {
      const res = await annotateApi.triggerTraining(project.id)
      setTrainingVersionId(res.version_id)
      setTrainPoll(true)
    } catch (e: any) {
      addNotice('error', e?.response?.data?.detail ?? 'Training failed')
    }
  }

  const handlePredict = async () => {
    try {
      const res = await annotateApi.runPredictions(project.id)
      const alreadyPredicted = images.filter(i => i.status === 'predicted' || i.status === 'approved').length
      predictStartCountRef.current = alreadyPredicted
      setPredictTotal(res.images_queued)
      setPredictDone(0)
      setPredictPoll(true)
    } catch (e: any) {
      addNotice('error', e?.response?.data?.detail ?? 'Prediction failed')
    }
  }

  const handlePredictSingle = async (imageId: string) => {
    if (!project.active_model_version_id) {
      addNotice('error', 'No trained model yet — train first')
      return
    }
    setPredictingImageId(imageId)
    try {
      await annotateApi.predictImage(project.id, imageId)
      // Poll until this image has a prediction result
      const poll = setInterval(async () => {
        try {
          const img = await annotateApi.getImage(project.id, imageId)
          if (img.status === 'predicted' || img.status === 'annotated' || img.status === 'unannotated') {
            clearInterval(poll)
            setPredictingImageId(null)
            setImages(prev => prev.map(i => i.id === imageId ? img : i))
            const count = img.annotations?.filter(a => a.source === 'model').length ?? 0
            addNotice('success', count > 0 ? `Predicted ${count} object${count !== 1 ? 's' : ''} on this image` : 'No objects detected')
          }
        } catch { clearInterval(poll); setPredictingImageId(null) }
      }, 1500)
    } catch (e: any) {
      setPredictingImageId(null)
      addNotice('error', e?.response?.data?.detail ?? 'Prediction failed')
    }
  }

  const handleExportDataset = async () => {
    setExporting(true)
    try {
      const res = await annotateApi.exportDataset(project.id)
      window.open(res.url, '_blank')
    } finally {
      setExporting(false)
    }
  }

  const handleExportModel = async () => {
    try {
      const res = await annotateApi.exportModel(project.id)
      window.open(res.url, '_blank')
    } catch (e: any) {
      addNotice('error', e?.response?.data?.detail ?? 'No trained model available yet')
    }
  }

  const latestModel = project.model_versions[project.model_versions.length - 1]
  const activeModel = project.model_versions.find(v => v.id === project.active_model_version_id) ?? latestModel

  // ── test-image state (left sidebar) ────────────────────────────────────────
  const [testPreview, setTestPreview] = useState<string | null>(null)
  const [testFile, setTestFile] = useState<File | null>(null)
  const [testPredicting, setTestPredicting] = useState(false)
  const testInputRef = useRef<HTMLInputElement>(null)

  const handleTestFile = (file: File) => {
    setTestFile(file)
    setTestPreview(URL.createObjectURL(file))
  }
  const handleTestPredict = async () => {
    if (!testFile) return
    setTestPredicting(true)
    try {
      const res = await annotateApi.addImages(project.id, [testFile])
      if (res.images.length > 0) {
        const newImg = res.images[0]
        setImages(prev => [...prev, newImg])
        setCurrentIdx(images.length)
        await annotateApi.predictImage(project.id, newImg.id)
        addNotice('info', 'Test image added — prediction queued, select it in the strip')
      }
    } catch (e: any) {
      addNotice('error', e?.response?.data?.detail ?? 'Test failed')
    } finally {
      setTestPredicting(false)
      setTestFile(null)
      setTestPreview(null)
    }
  }

  return (
    <div className="flex flex-col h-full gap-0">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-3 border-b border-zinc-700/40 flex-shrink-0">
        <button onClick={onBack} className="text-zinc-400 hover:text-zinc-200 transition-colors flex-shrink-0">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100 truncate">{project.name}</h2>
          <p className="text-[11px] text-zinc-500">{annotatedCount}/{images.length} annotated</p>
        </div>
        <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
          onChange={e => e.target.files && handleUpload(e.target.files)} />
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-100 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
          <Upload size={13} /> Upload
        </button>
        <button onClick={handleTrain} disabled={!canTrain || trainPoll}
          className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
          {trainPoll ? <><Loader2 size={13} className="animate-spin" /> Training…</> : <><Play size={13} /> Train ({annotatedCount})</>}
        </button>
      </div>

      {/* ── Banners ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 space-y-1.5 pt-2">
        {notices.map(n => (
          <div key={n.id} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${
            n.type === 'success' ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' :
            n.type === 'error'   ? 'bg-red-900/40 border-red-700/50 text-red-300' :
                                   'bg-zinc-800 border-zinc-700 text-zinc-300'
          }`}>
            {n.type === 'success' ? <Check size={12} /> : n.type === 'error' ? <AlertCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
            {n.message}
            <button onClick={() => setNotices(prev => prev.filter(x => x.id !== n.id))} className="ml-auto opacity-50 hover:opacity-100"><X size={11} /></button>
          </div>
        ))}
        {trainPoll && (
          <div className="flex items-center gap-3 text-xs bg-purple-900/40 border border-purple-700/50 rounded-lg px-3 py-2 text-purple-300">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium mb-0.5">Training model v{(latestModel?.version ?? 0) + 1}…</div>
              <div className="h-1 bg-purple-900 rounded-full overflow-hidden">
                <div className="h-full bg-purple-400 rounded-full animate-pulse w-1/2" />
              </div>
            </div>
          </div>
        )}
        {predictPoll && (
          <div className="flex items-center gap-3 text-xs bg-amber-900/40 border border-amber-700/50 rounded-lg px-3 py-2 text-amber-300">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between mb-0.5">
                <span className="font-medium">Auto-predicting…</span>
                <span>{predictDone}/{predictTotal}</span>
              </div>
              <div className="h-1 bg-amber-900 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all"
                  style={{ width: predictTotal > 0 ? `${Math.round((predictDone / predictTotal) * 100)}%` : '0%' }} />
              </div>
            </div>
          </div>
        )}
        {!canTrain && !trainPoll && !predictPoll && images.length > 0 && (
          <div className="flex items-center gap-2 text-xs bg-amber-900/30 border border-amber-700/40 rounded-lg px-3 py-1.5 text-amber-300">
            <AlertCircle size={12} /> Need {project.min_annotations_to_train - annotatedCount} more annotation{project.min_annotations_to_train - annotatedCount !== 1 ? 's' : ''} to train
          </div>
        )}
      </div>

      {/* ── Body: 3-column ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm pt-6">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading images…
        </div>
      ) : images.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
          <FolderOpen size={32} className="opacity-40" />
          <p className="text-sm">No images yet.</p>
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg transition-colors">
            <Upload size={13} /> Upload Images
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-3 pt-3">

          {/* ── LEFT: Model sidebar ─────────────────────────────────────────── */}
          <div className="w-52 flex-shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">

            {/* Model metrics */}
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Model</span>
                {activeModel && <StatusBadge status={activeModel.status} />}
              </div>
              {activeModel ? (
                <>
                  <div className="space-y-1.5">
                    {/* mAP50 */}
                    <div>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-zinc-500">mAP50</span>
                        <span className={activeModel.map50 != null ? 'text-green-400 font-semibold' : 'text-zinc-600'}>
                          {activeModel.map50 != null ? `${(activeModel.map50 * 100).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: activeModel.map50 != null ? `${(activeModel.map50 * 100).toFixed(0)}%` : '0%' }} />
                      </div>
                    </div>
                    {/* mAP50-95 */}
                    <div>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-zinc-500">mAP50-95</span>
                        <span className={activeModel.map50_95 != null ? 'text-blue-400 font-semibold' : 'text-zinc-600'}>
                          {activeModel.map50_95 != null ? `${(activeModel.map50_95 * 100).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: activeModel.map50_95 != null ? `${(activeModel.map50_95 * 100).toFixed(0)}%` : '0%' }} />
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500">v{activeModel.version} · {activeModel.trained_on} images</p>
                </>
              ) : (
                <p className="text-[10px] text-zinc-600">No model trained yet</p>
              )}
            </div>

            {/* Version history */}
            {project.model_versions.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-0.5">History</p>
                {[...project.model_versions].reverse().map(v => {
                  const isActive = v.id === project.active_model_version_id
                  const isRunning = v.status === 'training' || v.status === 'predicting' || v.status === 'queued'
                  return (
                  <div key={v.id}
                    className={`group flex items-center gap-1.5 text-[10px] rounded-lg px-2 py-1.5 border ${isActive ? 'bg-violet-900/30 border-violet-600/50' : 'bg-zinc-800/40 border-zinc-700/30'}`}>
                    <span className={`font-medium w-5 ${isActive ? 'text-violet-300' : 'text-zinc-300'}`}>v{v.version}</span>
                    <StatusBadge status={v.status} />
                    <span className="ml-auto text-zinc-500">{v.trained_on}img</span>
                    {v.map50 != null && <span className="text-green-400 font-medium">{(v.map50 * 100).toFixed(0)}%</span>}
                    {isActive && <span className="text-violet-400" title="Active prediction model">●</span>}
                    {isRunning ? (
                      <button
                        onClick={async () => {
                          if (!confirm(`Cancel model v${v.version} training?`)) return
                          try {
                            const updated = await annotateApi.cancelModelVersion(project.id, v.id)
                            onProjectUpdate(updated)
                            setTrainPoll(false)
                            setPredictPoll(false)
                          } catch (e: any) {
                            addNotice('error', e?.response?.data?.detail ?? 'Cancel failed')
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-amber-500 hover:text-amber-300 transition-all ml-0.5"
                        title="Cancel training"
                      >
                        <X size={10} />
                      </button>
                    ) : v.status === 'ready' && !isActive ? (
                      <button
                        onClick={async () => {
                          try {
                            const updated = await annotateApi.activateModelVersion(project.id, v.id)
                            onProjectUpdate(updated)
                            addNotice('success', `Model v${v.version} set as active`)
                          } catch (e: any) {
                            addNotice('error', e?.response?.data?.detail ?? 'Failed')
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-violet-400 hover:text-violet-200 transition-all ml-0.5"
                        title="Use this model for predictions"
                      >
                        <Play size={10} />
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete model v${v.version}?`)) return
                          try {
                            const updated = await annotateApi.deleteModelVersion(project.id, v.id)
                            onProjectUpdate(updated)
                          } catch (e: any) {
                            addNotice('error', e?.response?.data?.detail ?? 'Delete failed')
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all ml-0.5"
                        title="Delete model version"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                  )
                })}
              </div>
            )}

            {/* Test image */}
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Test Model</p>
              <input ref={testInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && handleTestFile(e.target.files[0])} />
              {testPreview ? (
                <div className="space-y-1.5">
                  <img src={testPreview} className="w-full rounded-lg object-contain max-h-28 bg-zinc-900" />
                  <button onClick={handleTestPredict} disabled={testPredicting || !project.active_model_version_id}
                    className="w-full py-1.5 text-[11px] bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-1">
                    {testPredicting ? <><Loader2 size={11} className="animate-spin" /> Running…</> : <><Play size={11} /> Add & Predict</>}
                  </button>
                  <button onClick={() => { setTestFile(null); setTestPreview(null) }}
                    className="w-full py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">clear</button>
                </div>
              ) : (
                <button onClick={() => testInputRef.current?.click()}
                  className="w-full py-2.5 text-[11px] border border-dashed border-zinc-600 hover:border-violet-500 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors">
                  + Upload test image
                </button>
              )}
              {!project.active_model_version_id && (
                <p className="text-[10px] text-zinc-600 text-center">Train a model first</p>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-0.5">Actions</p>
              {project.active_model_version_id && (
                <button onClick={handlePredict} disabled={trainPoll || predictPoll}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 disabled:opacity-40 text-zinc-300 rounded-lg transition-colors">
                  {predictPoll ? <><Loader2 size={11} className="animate-spin" /> {predictDone}/{predictTotal}</> : <><RefreshCw size={11} /> Auto-Predict All</>}
                </button>
              )}
              <button onClick={handleExportDataset} disabled={exporting}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 rounded-lg transition-colors">
                {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Export Dataset
              </button>
              <button onClick={handleExportModel}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 rounded-lg transition-colors">
                <Download size={11} /> Export Model .pt
              </button>
            </div>
          </div>

          {/* ── MIDDLE: Annotation canvas ───────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {currentImage ? (
              <>
                {/* Image nav + actions bar */}
                <div className="flex items-center gap-2 text-xs text-zinc-500 flex-shrink-0">
                  <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0}
                    className="disabled:opacity-30 hover:text-zinc-300 transition-colors"><ChevronLeft size={14} /></button>
                  <span className="text-zinc-400">{currentIdx + 1}/{images.length}</span>
                  <button onClick={() => setCurrentIdx(i => Math.min(images.length - 1, i + 1))} disabled={currentIdx === images.length - 1}
                    className="disabled:opacity-30 hover:text-zinc-300 transition-colors"><ChevronRight size={14} /></button>
                  <span className="text-zinc-600 truncate">{currentImage.filename}</span>
                  <StatusBadge status={currentImage.status} />
                  <div className="ml-auto flex gap-2">
                    {project.active_model_version_id && (
                      <button onClick={() => handlePredictSingle(currentImage.id)}
                        disabled={predictingImageId === currentImage.id || trainPoll}
                        className="flex items-center gap-1 text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors font-medium">
                        {predictingImageId === currentImage.id
                          ? <><Loader2 size={12} className="animate-spin" /> Predicting…</>
                          : <><Play size={12} /> Predict</>}
                      </button>
                    )}
                    {currentImage.annotations?.some(a => a.source === 'model' && !a.approved) && (
                      <button onClick={handleApproveAll} disabled={saving}
                        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors font-medium">
                        <CheckCheck size={12} /> Approve All
                      </button>
                    )}
                    {pendingAnns !== null && (
                      <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors font-medium">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <AnnotationCanvas
                    key={currentImage.id}
                    image={currentImage}
                    classes={project.classes}
                    annotationType={project.annotation_type as AnnotationType}
                    onChange={anns => setPendingAnns(anns)}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
                Select an image from the strip →
              </div>
            )}
          </div>

          {/* ── RIGHT: Vertical image strip ─────────────────────────────────── */}
          <div className="w-[72px] flex-shrink-0 flex flex-col gap-1.5 overflow-y-auto">
            {images.map((img, idx) => {
              const hasPredictions = img.annotations?.some(a => a.source === 'model' && !a.approved)
              const isAnnotated = img.annotations?.length > 0
              return (
                <button key={img.id}
                  onClick={() => { if (pendingAnns !== null) handleSave(); setCurrentIdx(idx); setPendingAnns(null) }}
                  className={`flex-shrink-0 relative rounded-md overflow-hidden border-2 transition-colors ${idx === currentIdx ? 'border-violet-500' : 'border-zinc-700 hover:border-zinc-500'}`}
                  style={{ width: 64, height: 48 }}>
                  {img.url
                    ? <img src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><Square size={14} className="text-zinc-600" /></div>
                  }
                  <div className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${hasPredictions ? 'bg-amber-400' : isAnnotated ? 'bg-green-400' : 'bg-zinc-600'}`} />
                  {predictingImageId === img.id && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 size={14} className="animate-spin text-amber-400" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>

        </div>
      )}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────────
export default function AnnotatePage() {
  const [projects, setProjects] = useState<AnnotationProject[]>([])
  const [loading, setLoading] = useState(true)
  const [openProject, setOpenProject] = useState<AnnotationProject | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await annotateApi.listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (data: { name: string; description: string; classes: string[]; annotation_type: string }) => {
    const p = await annotateApi.createProject(data)
    setProjects(prev => [p, ...prev])
    setShowCreate(false)
    setOpenProject(p)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this annotation project?')) return
    await annotateApi.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="h-full flex flex-col">
      {openProject ? (
        <AnnotationWorkspace
          project={openProject}
          onBack={() => { setOpenProject(null); load() }}
          onProjectUpdate={p => setOpenProject(p)}
        />
      ) : (
        <ProjectList
          projects={projects}
          loading={loading}
          onCreate={() => setShowCreate(true)}
          onOpen={setOpenProject}
          onDelete={handleDelete}
        />
      )}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
