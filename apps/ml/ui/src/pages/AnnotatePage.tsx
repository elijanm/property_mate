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

const PAGE_SIZE = 12

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
  const [query,    setQuery]    = useState('')
  const [view,     setView]     = useState<'grid' | 'table'>('grid')
  const [page,     setPage]     = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Filter
  const filtered = projects.filter(p => {
    const q = query.toLowerCase()
    const matchesQuery = !q || p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.classes.some(c => c.toLowerCase().includes(q))
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter
    return matchesQuery && matchesStatus
  })

  // Reset page when filter changes
  useEffect(() => { setPage(1) }, [query, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const STATUS_OPTS = ['all', 'collecting', 'training', 'predicting', 'done']

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="flex-1 min-w-0 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
            <BarChart2 size={13} className="rotate-90" />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search projects, classes…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500 transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500 transition-colors cursor-pointer"
        >
          {STATUS_OPTS.map(s => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>

        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
          <button onClick={() => setView('grid')}
            className={`px-2 py-1.5 transition-colors ${view === 'grid' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
            title="Grid view">
            <Layers size={13} />
          </button>
          <button onClick={() => setView('table')}
            className={`px-2 py-1.5 transition-colors ${view === 'table' ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
            title="Table view">
            <Tag size={13} />
          </button>
        </div>

        <button onClick={onCreate}
          className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
          <Plus size={13} /> New Project
        </button>
      </div>

      {/* ── Results summary ───────────────────────────────────────────────────── */}
      {!loading && projects.length > 0 && (
        <p className="text-[11px] text-zinc-600 flex-shrink-0 -mt-2">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
          {query || statusFilter !== 'all' ? ` matching filters` : ''}
          {filtered.length > PAGE_SIZE && ` · page ${page}/${totalPages}`}
        </p>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-2 text-zinc-400 text-sm py-8 justify-center flex-shrink-0">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {/* ── Empty states ──────────────────────────────────────────────────────── */}
      {!loading && projects.length === 0 && (
        <div className="text-center py-16 text-zinc-500 flex-shrink-0">
          <Layers size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No annotation projects yet.</p>
          <p className="text-xs mt-1">Create one to start auto-annotating images.</p>
        </div>
      )}
      {!loading && projects.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-zinc-500 flex-shrink-0">
          <p className="text-sm">No projects match your search.</p>
          <button onClick={() => { setQuery(''); setStatusFilter('all') }}
            className="text-xs text-violet-400 hover:text-violet-300 mt-1 transition-colors">
            Clear filters
          </button>
        </div>
      )}

      {/* ── Grid view ─────────────────────────────────────────────────────────── */}
      {!loading && view === 'grid' && paginated.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-2">
            {paginated.map(p => {
              const pct = p.image_count ? Math.round((p.annotated_count / p.image_count) * 100) : 0
              const latestModel = p.model_versions[p.model_versions.length - 1]
              return (
                <div key={p.id}
                  className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 hover:border-violet-600/50 hover:bg-zinc-800/80 transition-all cursor-pointer group"
                  onClick={() => onOpen(p)}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-100 truncate">{p.name}</p>
                      {p.description && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <StatusBadge status={p.status} />
                      <button onClick={e => { e.stopPropagation(); onDelete(p.id) }}
                        className="text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Classes */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {p.classes.slice(0, 5).map(c => (
                      <span key={c} className="text-[10px] bg-zinc-700/80 text-zinc-300 px-1.5 py-0.5 rounded">{c}</span>
                    ))}
                    {p.classes.length > 5 && (
                      <span className="text-[10px] text-zinc-600">+{p.classes.length - 5}</span>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="space-y-1 mb-2">
                    <div className="flex justify-between text-[10px] text-zinc-500">
                      <span>{p.annotated_count}/{p.image_count} annotated</span>
                      <span className={pct === 100 ? 'text-green-400' : ''}>{pct}%</span>
                    </div>
                    <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-violet-500'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Model info */}
                  {latestModel ? (
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span>v{latestModel.version}</span>
                      <StatusBadge status={latestModel.status} />
                      {latestModel.map50 != null && (
                        <span className="text-green-400 font-medium ml-auto">
                          {(latestModel.map50 * 100).toFixed(1)}% mAP50
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-700">No model yet</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Table view ────────────────────────────────────────────────────────── */}
      {!loading && view === 'table' && paginated.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-zinc-800/90 backdrop-blur text-zinc-400 text-[10px] uppercase tracking-wider">
                <th className="text-left px-3 py-2 font-semibold rounded-tl-lg">Project</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">Classes</th>
                <th className="text-right px-3 py-2 font-semibold">Images</th>
                <th className="text-right px-3 py-2 font-semibold">Annotated</th>
                <th className="text-left px-3 py-2 font-semibold">Progress</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-right px-3 py-2 font-semibold">mAP50</th>
                <th className="px-3 py-2 rounded-tr-lg" />
              </tr>
            </thead>
            <tbody>
              {paginated.map((p, i) => {
                const pct = p.image_count ? Math.round((p.annotated_count / p.image_count) * 100) : 0
                const activeModel = p.model_versions.find(v => v.id === p.active_model_version_id)
                  ?? p.model_versions[p.model_versions.length - 1]
                return (
                  <tr key={p.id}
                    className={`border-b border-zinc-700/40 hover:bg-zinc-800/60 cursor-pointer transition-colors group ${i % 2 === 0 ? 'bg-zinc-900/20' : ''}`}
                    onClick={() => onOpen(p)}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-zinc-100 truncate max-w-[160px]">{p.name}</p>
                      {p.description && <p className="text-[10px] text-zinc-600 truncate max-w-[160px]">{p.description}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-500 capitalize">{p.annotation_type}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1 max-w-[120px]">
                        {p.classes.slice(0, 3).map(c => (
                          <span key={c} className="text-[10px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">{c}</span>
                        ))}
                        {p.classes.length > 3 && <span className="text-[10px] text-zinc-600">+{p.classes.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-zinc-400">{p.image_count}</td>
                    <td className="px-3 py-2.5 text-right text-zinc-400">{p.annotated_count}</td>
                    <td className="px-3 py-2.5 w-28">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-violet-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-zinc-500 w-7 text-right">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={p.status} /></td>
                    <td className="px-3 py-2.5 text-right">
                      {activeModel?.map50 != null
                        ? <span className="text-green-400 font-medium">{(activeModel.map50 * 100).toFixed(1)}%</span>
                        : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={e => { e.stopPropagation(); onDelete(p.id) }}
                        className="text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────────────────────── */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 flex-shrink-0 pt-1 border-t border-zinc-700/40">
          <span className="text-[11px] text-zinc-600">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 rounded transition-colors">
              «
            </button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 rounded transition-colors">
              ‹
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              // Window of 5 pages centered on current
              const half = 2
              let start = Math.max(1, page - half)
              const end = Math.min(totalPages, start + 4)
              start = Math.max(1, end - 4)
              return start + i
            }).filter(n => n >= 1 && n <= totalPages).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors ${n === page ? 'bg-violet-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}>
                {n}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 rounded transition-colors">
              ›
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-400 rounded transition-colors">
              »
            </button>
          </div>
        </div>
      )}
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
  const [activeAnnotationType, setActiveAnnotationType] = useState<AnnotationType>(annotationType)
  const forceAnnotationType = (t: AnnotationType) => setActiveAnnotationType(t)
  // box drag/resize/rotate
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState<[number, number]>([0, 0])
  const [resizeId, setResizeId] = useState<string | null>(null)
  const [resizeHandle, setResizeHandle] = useState<string>('')
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  // polygon vertex editing
  const [polyDragId, setPolyDragId] = useState<string | null>(null)
  const [polyDragVertIdx, setPolyDragVertIdx] = useState<number>(-2) // -1=body, >=0=vertex
  const [polyBodyOffset, setPolyBodyOffset] = useState<[number, number][]>([])
  // freehand polygon
  const [freehand, setFreehand] = useState(false)
  const [freehandDrawing, setFreehandDrawing] = useState(false)
  // undo/redo via refs (avoid stale closures)
  const historyRef = useRef<AnnotationShape[][]>([[...image.annotations]])
  const histIdxRef = useRef(0)
  const [cursor, setCursor] = useState<string>('crosshair')

  // ── history ──────────────────────────────────────────────────────────────────
  const pushHistory = useCallback((anns: AnnotationShape[]) => {
    historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1)
    historyRef.current.push([...anns])
    histIdxRef.current = historyRef.current.length - 1
  }, [])

  const undo = useCallback(() => {
    if (histIdxRef.current <= 0) return
    histIdxRef.current--
    const anns = [...historyRef.current[histIdxRef.current]]
    setAnnotations(anns)
    setSelectedId(null)
    onChange(anns)
  }, [onChange])

  const redo = useCallback(() => {
    if (histIdxRef.current >= historyRef.current.length - 1) return
    histIdxRef.current++
    const anns = [...historyRef.current[histIdxRef.current]]
    setAnnotations(anns)
    onChange(anns)
  }, [onChange])

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

  // ── polygon hit testing (needs canvasSize) ────────────────────────────────────
  /** Ray-casting polygon hit (normalised 0-1 coords). Returns ann id or null. */
  const hitPolygon = useCallback((nx: number, ny: number, anns: AnnotationShape[]): string | null => {
    for (let i = anns.length - 1; i >= 0; i--) {
      const ann = anns[i]
      if (ann.type !== 'polygon') continue
      const pts = ann.coords as number[][]
      if (pts.length < 3) continue
      let inside = false
      for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
        const xi = pts[j][0], yi = pts[j][1], xk = pts[k][0], yk = pts[k][1]
        if (((yi > ny) !== (yk > ny)) && (nx < (xk - xi) * (ny - yi) / (yk - yi) + xi)) inside = !inside
      }
      if (inside) return ann.id
    }
    return null
  }, [])

  /** Which polygon vertex index is within 9px of cursor (-1 = none) */
  const hitPolyVertex = useCallback((ann: AnnotationShape, nx: number, ny: number): number => {
    if (ann.type !== 'polygon') return -1
    const { w, h } = canvasSize
    const pts = ann.coords as number[][]
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] * w - nx * w, pts[i][1] * h - ny * h) < 9) return i
    }
    return -1
  }, [canvasSize])

  /** Which polygon edge midpoint index is within 8px of cursor (-1 = none) */
  const hitPolyEdgeMid = useCallback((ann: AnnotationShape, nx: number, ny: number): number => {
    if (ann.type !== 'polygon') return -1
    const { w, h } = canvasSize
    const pts = ann.coords as number[][]
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length
      const mx = (pts[i][0] + pts[j][0]) / 2 * w
      const my = (pts[i][1] + pts[j][1]) / 2 * h
      if (Math.hypot(mx - nx * w, my - ny * h) < 8) return i
    }
    return -1
  }, [canvasSize])

  /** True if cursor is within 15px of first polygon point (snap-to-close) */
  const nearPolyClose = (nx: number, ny: number, ds: DrawState): boolean => {
    if (ds.points.length < 3) return false
    const { w, h } = canvasSize
    const [fx, fy] = ds.points[0]
    return Math.hypot((nx - fx) * w, (ny - fy) * h) < 15
  }

  const ZOOM_STEP = 0.25
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 4

  const zoomIn  = () => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX))
  const zoomOut = () => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN))
  const zoomFit = () => setZoom(1)

  // ── keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'Escape') {
        setDrawState(null); setDrawing(false); setFreehandDrawing(false); return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setAnnotations(prev => {
          const next = prev.filter(a => a.id !== selectedId)
          onChange(next); pushHistory(next); return next
        })
        setSelectedId(null); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, onChange, pushHistory, undo, redo])

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
    historyRef.current = [[...image.annotations]]
    histIdxRef.current = 0
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
        ctx.setLineDash([])
        ctx.beginPath()
        pts.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px * w, py * h) : ctx.lineTo(px * w, py * h))
        ctx.closePath()
        // Semi-transparent fill
        ctx.fillStyle = col + '22'
        ctx.fill()
        ctx.strokeStyle = ann.source === 'model' && !ann.approved ? col + '99' : col
        ctx.lineWidth = ann.id === selectedId ? 2.5 : 1.5
        ctx.setLineDash(ann.source === 'model' && !ann.approved ? [5, 4] : [])
        ctx.stroke()
        ctx.setLineDash([])
        // Label at centroid
        if (pts.length >= 3) {
          const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length * w
          const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length * h
          ctx.fillStyle = col
          ctx.font = 'bold 10px monospace'
          const txt = ann.confidence != null ? `${ann.label} ${(ann.confidence * 100).toFixed(0)}%` : ann.label
          const tw = ctx.measureText(txt).width
          ctx.fillRect(cx - tw / 2 - 4, cy - 10, tw + 8, 14)
          ctx.fillStyle = '#000'
          ctx.fillText(txt, cx - tw / 2, cy)
        }
        // Vertex & edge-midpoint handles for selected polygon
        if (ann.id === selectedId) {
          // Edge midpoints (diamond)
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length
            const mx = (pts[i][0] + pts[j][0]) / 2 * w
            const my = (pts[i][1] + pts[j][1]) / 2 * h
            ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.PI / 4)
            ctx.strokeStyle = col; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5
            ctx.strokeRect(-4, -4, 8, 8); ctx.fillRect(-3, -3, 6, 6)
            ctx.restore()
          }
          // Vertex dots
          pts.forEach(([px, py]) => {
            ctx.beginPath(); ctx.arc(px * w, py * h, 5, 0, Math.PI * 2)
            ctx.fillStyle = '#fff'; ctx.fill()
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke()
          })
        }
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
        // Fill preview
        if (ds.points.length >= 3 && liveEnd) {
          ctx.beginPath()
          ds.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px * w, py * h) : ctx.lineTo(px * w, py * h))
          ctx.lineTo(liveEnd[0] * w, liveEnd[1] * h)
          ctx.closePath(); ctx.fillStyle = col + '22'; ctx.fill()
        }
        // Path
        ctx.beginPath()
        ds.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px * w, py * h) : ctx.lineTo(px * w, py * h))
        if (liveEnd) ctx.lineTo(liveEnd[0] * w, liveEnd[1] * h)
        ctx.stroke()
        // Vertex dots (first point bigger)
        ds.points.forEach(([px, py], i) => {
          ctx.beginPath(); ctx.arc(px * w, py * h, i === 0 ? 6 : 3, 0, Math.PI * 2)
          ctx.fillStyle = col; ctx.fill()
        })
        // Snap-to-close ring near first point
        if (liveEnd && ds.points.length >= 3) {
          const [fx, fy] = ds.points[0]
          const dist = Math.hypot((liveEnd[0] - fx) * w, (liveEnd[1] - fy) * h)
          if (dist < 15) {
            ctx.beginPath(); ctx.arc(fx * w, fy * h, 11, 0, Math.PI * 2)
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
            ctx.beginPath(); ctx.arc(fx * w, fy * h, 11, 0, Math.PI * 2)
            ctx.fillStyle = col + '44'; ctx.fill()
          }
        }
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

    // ── selected annotation handles ──────────────────────────────────────────
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId)
      if (ann && ann.type === 'box') {
        if (hitRotHandle(ann, nx, ny)) { setRotatingId(selectedId); return }
        const handle = hitHandle(ann, nx, ny)
        if (handle) { setResizeId(selectedId); setResizeHandle(handle); return }
      }
      if (ann && ann.type === 'polygon') {
        const vIdx = hitPolyVertex(ann, nx, ny)
        if (vIdx >= 0) { setPolyDragId(selectedId); setPolyDragVertIdx(vIdx); return }
        const eIdx = hitPolyEdgeMid(ann, nx, ny)
        if (eIdx >= 0) {
          // Insert midpoint vertex then start dragging it
          const pts = [...(ann.coords as number[][])]
          const j = (eIdx + 1) % pts.length
          const newPt: [number, number] = [(pts[eIdx][0] + pts[j][0]) / 2, (pts[eIdx][1] + pts[j][1]) / 2]
          pts.splice(eIdx + 1, 0, newPt)
          const updated = annotations.map(a => a.id === ann.id ? { ...a, coords: pts } : a)
          setAnnotations(updated)
          setPolyDragId(selectedId); setPolyDragVertIdx(eIdx + 1); return
        }
      }
    }

    // ── box drag ─────────────────────────────────────────────────────────────
    const hitB = hitBox(nx, ny)
    if (hitB) {
      const ann = annotations.find(a => a.id === hitB)!
      const [cx, cy] = unpackBox(ann.coords)
      setDragId(hitB); setDragOffset([nx - cx, ny - cy]); setSelectedId(hitB); return
    }

    // ── polygon select + body drag ────────────────────────────────────────────
    const hitP = hitPolygon(nx, ny, annotations)
    if (hitP && !drawState) {
      setSelectedId(hitP)
      const ann = annotations.find(a => a.id === hitP)!
      const pts = ann.coords as number[][]
      setPolyDragId(hitP); setPolyDragVertIdx(-1)
      setPolyBodyOffset(pts.map(([px, py]) => [px - nx, py - ny] as [number, number]))
      return
    }

    // ── draw ──────────────────────────────────────────────────────────────────
    if (activeAnnotationType === 'box') {
      setDrawing(true); setSelectedId(null)
      setDrawState({ startX: nx, startY: ny, points: [[nx, ny]] })
    } else if (activeAnnotationType === 'polygon') {
      if (freehand) {
        setFreehandDrawing(true); setSelectedId(null)
        setDrawState({ startX: nx, startY: ny, points: [[nx, ny]] }); return
      }
      if (drawState) {
        if (nearPolyClose(nx, ny, drawState)) { finishPolygon(); return }
        setDrawState(prev => ({ startX: nx, startY: ny, points: prev ? [...prev.points, [nx, ny] as [number, number]] : [[nx, ny]] }))
      } else {
        setSelectedId(null)
        setDrawState({ startX: nx, startY: ny, points: [[nx, ny]] })
      }
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

    // ── polygon vertex/body drag ─────────────────────────────────────────────
    if (polyDragId) {
      const ann = annotations.find(a => a.id === polyDragId)
      if (!ann || ann.type !== 'polygon') return
      let updated: AnnotationShape[]
      if (polyDragVertIdx === -1) {
        const pts = (ann.coords as number[][]).map((_, i) => [
          Math.max(0, Math.min(1, nx + polyBodyOffset[i][0])),
          Math.max(0, Math.min(1, ny + polyBodyOffset[i][1])),
        ])
        updated = annotations.map(a => a.id === polyDragId ? { ...a, coords: pts } : a)
      } else {
        const pts = (ann.coords as number[][]).map((pt, i) =>
          i === polyDragVertIdx ? [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))] : pt
        )
        updated = annotations.map(a => a.id === polyDragId ? { ...a, coords: pts } : a)
      }
      setAnnotations(updated); redraw(updated, drawState); return
    }

    // ── freehand drawing ─────────────────────────────────────────────────────
    if (freehandDrawing && drawState) {
      const pts = drawState.points
      const last = pts[pts.length - 1]
      const { w, h } = canvasSize
      if (Math.hypot((nx - last[0]) * w, (ny - last[1]) * h) > 3) {
        const newDs = { ...drawState, points: [...pts, [nx, ny] as [number, number]] }
        setDrawState(newDs); redraw(annotations, newDs, [nx, ny])
      }
      return
    }

    // ── live draw preview ────────────────────────────────────────────────────
    if (drawState) {
      redraw(annotations, drawState, [nx, ny])
      // snap-to-close cursor hint
      if (activeAnnotationType === 'polygon' && nearPolyClose(nx, ny, drawState)) {
        setCursor('cell'); return
      }
      setCursor('crosshair'); return
    }

    // ── cursor hints ─────────────────────────────────────────────────────────
    if (selectedId) {
      const ann = annotations.find(a => a.id === selectedId)
      if (ann) {
        if (ann.type === 'box') {
          if (hitRotHandle(ann, nx, ny)) { setCursor('grab'); return }
          const handle = hitHandle(ann, nx, ny)
          if (handle === 'tl' || handle === 'br') { setCursor('nwse-resize'); return }
          if (handle === 'tr' || handle === 'bl') { setCursor('nesw-resize'); return }
        }
        if (ann.type === 'polygon') {
          if (hitPolyVertex(ann, nx, ny) >= 0) { setCursor('grab'); return }
          if (hitPolyEdgeMid(ann, nx, ny) >= 0) { setCursor('copy'); return }
        }
      }
    }
    const hitB = hitBox(nx, ny)
    if (hitB) { setCursor('move'); return }
    const hitP = hitPolygon(nx, ny, annotations)
    setCursor(hitP ? 'move' : 'crosshair')
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (rotatingId) { onChange(annotations); pushHistory(annotations); setRotatingId(null); return }
    if (resizeId) { onChange(annotations); pushHistory(annotations); setResizeId(null); setResizeHandle(''); return }
    if (dragId) { onChange(annotations); pushHistory(annotations); setDragId(null); return }
    if (polyDragId) {
      onChange(annotations); pushHistory(annotations)
      setPolyDragId(null); setPolyDragVertIdx(-2); setPolyBodyOffset([]); return
    }
    if (freehandDrawing) {
      setFreehandDrawing(false)
      if (drawState && drawState.points.length >= 3) finishPolygon()
      else setDrawState(null)
      return
    }
    if (!drawing || activeAnnotationType !== 'box' || !drawState) return
    setDrawing(false)
    const [nx, ny] = normalise(e)
    const x1 = Math.min(drawState.startX, nx), y1 = Math.min(drawState.startY, ny)
    const x2 = Math.max(drawState.startX, nx), y2 = Math.max(drawState.startY, ny)
    const bw = x2 - x1, bh = y2 - y1
    if (bw < 0.01 || bh < 0.01) { setDrawState(null); return }
    const id = crypto.randomUUID()
    const ann: AnnotationShape = {
      id, type: 'box', label: selectedLabel,
      coords: [x1 + bw / 2, y1 + bh / 2, bw, bh],
      approved: true, source: 'manual',
    }
    const next = [...annotations, ann]
    setAnnotations(next); setSelectedId(id); onChange(next); pushHistory(next); setDrawState(null)
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
    setAnnotations(next); setSelectedId(id); onChange(next); pushHistory(next); setDrawState(null)
  }

  const handleDoubleClick = () => {
    if (activeAnnotationType === 'polygon') finishPolygon()
  }

  const removeAnnotation = (id: string) => {
    const next = annotations.filter(a => a.id !== id)
    setAnnotations(next); onChange(next); pushHistory(next); setSelectedId(null)
  }

  /** Right-click on polygon vertex = delete that vertex (or whole shape if <3 left) */
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!selectedId) return
    const ann = annotations.find(a => a.id === selectedId)
    if (!ann || ann.type !== 'polygon') return
    const [nx, ny] = normalise(e)
    const vIdx = hitPolyVertex(ann, nx, ny)
    if (vIdx < 0) return
    const pts = ann.coords as number[][]
    if (pts.length <= 3) { removeAnnotation(selectedId); return }
    const newPts = pts.filter((_, i) => i !== vIdx)
    const updated = annotations.map(a => a.id === selectedId ? { ...a, coords: newPts } : a)
    setAnnotations(updated); onChange(updated); pushHistory(updated)
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
          {/* Freehand toggle (polygon mode only) */}
          {activeAnnotationType === 'polygon' && (
            <button onClick={() => setFreehand(f => !f)} title="Hold and drag to trace outline continuously"
              className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors flex-shrink-0 ${freehand ? 'bg-violet-800 border-violet-500 text-violet-200' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>
              ✏ Freehand
            </button>
          )}
          {/* Class labels */}
          {classes.map((c, i) => (
            <button key={c} onClick={() => setSelectedLabel(c)}
              style={{ borderColor: CLASS_COLOURS[i % CLASS_COLOURS.length], color: selectedLabel === c ? '#fff' : CLASS_COLOURS[i % CLASS_COLOURS.length], background: selectedLabel === c ? CLASS_COLOURS[i % CLASS_COLOURS.length] + '33' : 'transparent' }}
              className="px-2 py-0.5 rounded border text-[11px] font-medium transition-colors">
              {c}
            </button>
          ))}
          <span className="ml-auto text-zinc-500 text-[10px]">
            {activeAnnotationType === 'box'
              ? 'Drag · click to select · Del removes · Ctrl+Z undo'
              : freehand
                ? 'Hold & drag to trace · release to finish · Esc cancel'
                : 'Click points · near ● to close · dbl-click finish · right-click vertex to delete'}
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
            onMouseLeave={() => {
              if (dragId || resizeId || rotatingId) { onChange(annotations); pushHistory(annotations) }
              if (polyDragId) { onChange(annotations); pushHistory(annotations) }
              if (freehandDrawing && drawState && drawState.points.length >= 3) finishPolygon()
              setDragId(null); setResizeId(null); setRotatingId(null)
              setPolyDragId(null); setPolyDragVertIdx(-2); setPolyBodyOffset([])
              if (freehandDrawing) setFreehandDrawing(false)
            }}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
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
                    {ann.type === 'polygon' ? `⬡ ${(ann.coords as number[][]).length}pt · ` : '⬜ · '}
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

// ── video capture overlay ─────────────────────────────────────────────────────
function VideoCapture({
  file,
  projectId,
  onFramesCaptured,
  onClose,
}: {
  file: File
  projectId: string
  onFramesCaptured: (imgs: AnnotationImage[]) => void
  onClose: () => void
}) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const captureRef = useRef<HTMLCanvasElement>(null)

  const [videoSrc,    setVideoSrc]    = useState('')
  const [duration,    setDuration]    = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing,     setPlaying]     = useState(false)
  const [videoSize,   setVideoSize]   = useState({ w: 0, h: 0 })
  const [extractFps,  setExtractFps]  = useState(1)
  const [extracting,  setExtracting]  = useState(false)
  const [extractPct,  setExtractPct]  = useState(0)
  const [capturedCount, setCapturedCount] = useState(0)
  const [notices, setNotices]         = useState<string[]>([])

  // Create blob URL in effect so React StrictMode double-mount doesn't revoke a live URL
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setVideoSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Keyboard shortcuts: Space = play/pause, C = capture, ←→ = step frame
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === ' ') { e.preventDefault(); playing ? videoRef.current?.pause() : videoRef.current?.play() }
      if (e.key === 'c' || e.key === 'C') handleCapture()
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // ── capture helpers ──────────────────────────────────────────────────────────
  const captureFrame = (videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvasEl.width  = videoEl.videoWidth
      canvasEl.height = videoEl.videoHeight
      const ctx = canvasEl.getContext('2d')!
      ctx.drawImage(videoEl, 0, 0)
      canvasEl.toBlob(b => b ? resolve(b) : reject(new Error('capture failed')), 'image/jpeg', 0.92)
    })

  const seekTo = (videoEl: HTMLVideoElement, t: number): Promise<void> =>
    new Promise(resolve => {
      videoEl.currentTime = t
      const h = () => { videoEl.removeEventListener('seeked', h); resolve() }
      videoEl.addEventListener('seeked', h)
    })

  const uploadBlob = async (blob: Blob, name: string): Promise<AnnotationImage[]> => {
    const file = new File([blob], name, { type: 'image/jpeg' })
    const res  = await annotateApi.addImages(projectId, [file])
    return res.images
  }

  // ── single frame capture ─────────────────────────────────────────────────────
  const handleCapture = async () => {
    const vid = videoRef.current, cvs = captureRef.current
    if (!vid || !cvs) return
    try {
      const blob = await captureFrame(vid, cvs)
      const t    = vid.currentTime
      const name = `${file.name.replace(/\.[^.]+$/, '')}_t${t.toFixed(3)}s.jpg`
      const imgs = await uploadBlob(blob, name)
      onFramesCaptured(imgs)
      setCapturedCount(c => c + imgs.length)
      setNotices(n => [`Frame @ ${t.toFixed(2)}s captured`, ...n].slice(0, 4))
    } catch {
      setNotices(n => ['Capture failed', ...n].slice(0, 4))
    }
  }

  // ── auto-extract ─────────────────────────────────────────────────────────────
  const handleExtract = async () => {
    const vid = videoRef.current, cvs = captureRef.current
    if (!vid || !cvs || !duration) return
    setExtracting(true)
    setExtractPct(0)
    const interval = 1 / extractFps
    const times: number[] = []
    for (let t = 0; t < duration; t += interval) times.push(parseFloat(t.toFixed(3)))

    let done = 0
    const BATCH = 5
    for (let i = 0; i < times.length; i++) {
      try {
        await seekTo(vid, times[i])
        const blob = await captureFrame(vid, cvs)
        const name = `${file.name.replace(/\.[^.]+$/, '')}_f${String(i).padStart(5, '0')}.jpg`
        const imgs = await uploadBlob(blob, name)
        onFramesCaptured(imgs)
        setCapturedCount(c => c + imgs.length)
      } catch { /* skip bad frame */ }
      done++
      setExtractPct(Math.round((done / times.length) * 100))
      // Yield to UI every BATCH frames
      if (done % BATCH === 0) await new Promise(r => setTimeout(r, 0))
    }
    setExtracting(false)
    setNotices(n => [`Auto-extract complete — ${done} frames`, ...n].slice(0, 4))
  }

  // ── step one frame using video.requestVideoFrameCallback or ±1/30s fallback ──
  const stepFrame = (dir: 1 | -1) => {
    const vid = videoRef.current
    if (!vid) return
    vid.currentTime = Math.max(0, Math.min(duration, vid.currentTime + dir * (1 / 30)))
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">Video: {file.name}</p>
          <p className="text-[11px] text-zinc-500">
            {videoSize.w > 0 ? `${videoSize.w}×${videoSize.h} · ` : ''}{duration.toFixed(1)}s
            {capturedCount > 0 && <span className="text-violet-400 ml-2">· {capturedCount} frame{capturedCount !== 1 ? 's' : ''} added</span>}
          </p>
        </div>
        <button onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700 transition-colors">
          <Check size={13} /> Done
        </button>
      </div>

      <div className="flex-1 min-h-0 flex gap-0">

        {/* ── Video player ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col bg-black">
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              src={videoSrc || undefined}
              className="max-w-full max-h-full object-contain"
              onLoadedMetadata={e => {
                const v = e.currentTarget
                setDuration(v.duration)
                setVideoSize({ w: v.videoWidth, h: v.videoHeight })
              }}
              onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>

          {/* Custom controls */}
          <div className="flex-shrink-0 bg-zinc-900 border-t border-zinc-800 px-4 py-3 space-y-2.5">
            {/* Scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-500 w-12 text-right flex-shrink-0">
                {currentTime.toFixed(2)}s
              </span>
              <input
                type="range" min={0} max={duration || 1} step={0.001}
                value={currentTime}
                onChange={e => {
                  const t = parseFloat(e.target.value)
                  if (videoRef.current) videoRef.current.currentTime = t
                }}
                className="flex-1 accent-violet-500 h-1.5 cursor-pointer"
              />
              <span className="text-[10px] font-mono text-zinc-500 w-12 flex-shrink-0">
                {duration.toFixed(2)}s
              </span>
            </div>

            {/* Play/step/capture row */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => stepFrame(-1)}
                className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-[11px] transition-colors">
                ← Frame
              </button>
              <button
                onClick={() => playing ? videoRef.current?.pause() : videoRef.current?.play()}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 text-zinc-100 rounded text-[11px] font-medium transition-colors w-16 text-center">
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={() => stepFrame(1)}
                className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-[11px] transition-colors">
                Frame →
              </button>

              <div className="mx-1 w-px h-5 bg-zinc-700 flex-shrink-0" />

              <button onClick={handleCapture}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded text-[11px] font-semibold transition-colors">
                📷 Capture Frame
              </button>

              {/* Keyboard hint */}
              <span className="text-[10px] text-zinc-600 ml-auto">
                Space play/pause · ← → step frame · C capture
              </span>
            </div>
          </div>
        </div>

        {/* ── Right panel: auto-extract + log ──────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-900">
          {/* Auto-extract settings */}
          <div className="p-4 border-b border-zinc-800 space-y-3">
            <p className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">Auto-Extract Frames</p>

            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Extract rate (fps)</label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0.1} max={10} step={0.1}
                  value={extractFps}
                  onChange={e => setExtractFps(parseFloat(e.target.value))}
                  className="flex-1 accent-violet-500"
                  disabled={extracting}
                />
                <span className="text-[11px] font-mono text-zinc-300 w-12 text-right">{extractFps.toFixed(1)} fps</span>
              </div>
              {duration > 0 && (
                <p className="text-[10px] text-zinc-600 mt-1">
                  ≈ {Math.ceil(duration * extractFps)} frame{Math.ceil(duration * extractFps) !== 1 ? 's' : ''} total
                </p>
              )}
            </div>

            {extracting ? (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>Extracting…</span>
                  <span>{extractPct}%</span>
                </div>
                <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${extractPct}%` }} />
                </div>
              </div>
            ) : (
              <button onClick={handleExtract} disabled={!duration}
                className="w-full py-2 text-[11px] bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white rounded-lg font-semibold transition-colors">
                Extract All Frames
              </button>
            )}
          </div>

          {/* Activity log */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Activity</p>
            {notices.length === 0 && (
              <p className="text-[10px] text-zinc-700">Capture frames to start annotating</p>
            )}
            {notices.map((n, i) => (
              <p key={i} className="text-[10px] text-zinc-400 leading-relaxed">{n}</p>
            ))}
            {capturedCount > 0 && (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                <p className="text-[11px] text-violet-300 font-medium">{capturedCount} frame{capturedCount !== 1 ? 's' : ''} added to project</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">Click Done to annotate them</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden capture canvas */}
      <canvas ref={captureRef} className="hidden" />
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
  const [stripFilter, setStripFilter] = useState<'all' | 'unannotated' | 'annotated' | 'predicted'>('all')
  const [qualityFilter, setQualityFilter] = useState<'all' | 'good' | 'poor' | 'blurry' | 'dark' | 'overexposed' | 'low_res'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [archivedCount, setArchivedCount] = useState(project.archived_count ?? 0)
  const [similarPanel, setSimilarPanel] = useState<{ targetId: string; results: import('@/types/annotate').SimilarImage[] } | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [selectedSimilar, setSelectedSimilar] = useState<Set<string>>(new Set())
  const [videoMode, setVideoMode] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingAnns, setPendingAnns] = useState<AnnotationShape[] | null>(null)
  const [trainingVersionId, setTrainingVersionId] = useState<string | null>(null)
  const [trainPoll, setTrainPoll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'yolo-detect' | 'yolo-obb' | 'yolo-seg'>('yolo-detect')
  const [exportSplitMode, setExportSplitMode] = useState<'two' | 'three'>('two')
  const [exportTrain, setExportTrain] = useState(80)
  const [exportVal, setExportVal] = useState(20)
  const [exportTest, setExportTest] = useState(10)
  const [exportJobId, setExportJobId] = useState<string | null>(null)
  const [exportJobStatus, setExportJobStatus] = useState<string>('')
  const [exportJobPct, setExportJobPct] = useState(0)
  const exportPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
      const [imgs, archivedImgs] = await Promise.all([
        annotateApi.listImages(project.id, undefined, undefined, showArchived),
        // Always fetch archived count (only ids needed, but reuse full list)
        showArchived ? Promise.resolve(null) : annotateApi.listImages(project.id, undefined, undefined, true),
      ])
      setImages(imgs)
      if (!showArchived && archivedImgs) setArchivedCount(archivedImgs.length)
    } finally {
      setLoading(false)
    }
  }, [project.id, showArchived])

  useEffect(() => { load() }, [load])

  // ── image actions ──────────────────────────────────────────────────────────
  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Delete this image and all its annotations?')) return
    await annotateApi.deleteImage(project.id, imageId)
    setImages(prev => {
      const next = prev.filter(i => i.id !== imageId)
      setCurrentIdx(idx => Math.min(idx, Math.max(0, next.length - 1)))
      return next
    })
  }

  const handleArchiveImage = async (imageId: string, archived: boolean) => {
    await annotateApi.archiveImage(project.id, imageId, archived)
    setArchivedCount(c => archived ? c + 1 : Math.max(0, c - 1))
    // Remove from current view (since we show either archived or active, not both)
    setImages(prev => {
      const next = prev.filter(i => i.id !== imageId)
      setCurrentIdx(idx => Math.min(idx, Math.max(0, next.length - 1)))
      return next
    })
  }

  const handleFindSimilar = async (imageId: string) => {
    setSimilarLoading(true)
    setSimilarPanel(null)
    setSelectedSimilar(new Set())
    try {
      const results = await annotateApi.findSimilar(project.id, imageId)
      setSimilarPanel({ targetId: imageId, results })
    } finally {
      setSimilarLoading(false)
    }
  }

  const handleBulkDeleteSimilar = async () => {
    if (!similarPanel || selectedSimilar.size === 0) return
    if (!confirm(`Delete ${selectedSimilar.size} selected image(s)?`)) return
    for (const id of selectedSimilar) {
      await annotateApi.deleteImage(project.id, id)
    }
    setImages(prev => prev.filter(i => !selectedSimilar.has(i.id)))
    setSimilarPanel(prev => prev ? { ...prev, results: prev.results.filter(r => !selectedSimilar.has(r.id)) } : null)
    setSelectedSimilar(new Set())
  }

  const handleBulkArchiveSimilar = async () => {
    if (!similarPanel || selectedSimilar.size === 0) return
    const count = selectedSimilar.size
    for (const id of selectedSimilar) {
      await annotateApi.archiveImage(project.id, id, true)
    }
    setImages(prev => prev.filter(i => !selectedSimilar.has(i.id)))
    setArchivedCount(c => c + count)
    setSimilarPanel(prev => prev ? { ...prev, results: prev.results.filter(r => !selectedSimilar.has(r.id)) } : null)
    setSelectedSimilar(new Set())
  }

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

  // Strip filtered view (indices map back to full images array)
  const filteredStrip = images.reduce<{ img: AnnotationImage; realIdx: number }[]>((acc, img, realIdx) => {
    const hasAnns = img.annotations?.length > 0
    const hasPred = img.annotations?.some(a => a.source === 'model' && !a.approved)
    if (stripFilter === 'unannotated' && hasAnns) return acc
    if (stripFilter === 'annotated' && (!hasAnns || hasPred)) return acc
    if (stripFilter === 'predicted' && !hasPred) return acc
    // Quality filters
    if (qualityFilter === 'good' && ((img.quality_score ?? 0) < 70 || (img.quality_issues?.length ?? 0) > 0)) return acc
    if (qualityFilter === 'poor' && (img.quality_score ?? 100) >= 70 && !(img.quality_issues?.length ?? 0)) return acc
    if (qualityFilter === 'blurry' && !img.quality_issues?.includes('blurry')) return acc
    if (qualityFilter === 'dark' && !img.quality_issues?.includes('dark')) return acc
    if (qualityFilter === 'overexposed' && !img.quality_issues?.includes('overexposed')) return acc
    if (qualityFilter === 'low_res' && !img.quality_issues?.includes('low_res')) return acc
    acc.push({ img, realIdx })
    return acc
  }, [])

  // Count of similar-panel results to highlight in strip
  const similarImageIds = new Set(similarPanel?.results.map(r => r.id) ?? [])
  const canTrain = annotatedCount >= project.min_annotations_to_train

  const handleUpload = async (files: FileList) => {
    const arr = Array.from(files)
    if (!arr.length) return

    // Detect video files — show VideoCapture view for the first video found
    const videoFile = arr.find(f => f.type.startsWith('video/'))
    if (videoFile) { setVideoMode(videoFile); return }

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
    const trainR = exportTrain / 100
    const valR   = exportVal / 100
    const testR  = exportSplitMode === 'three' ? exportTest / 100 : 0
    const total  = trainR + valR + testR
    if (Math.abs(total - 1) > 0.01) {
      addNotice('error', `Split ratios must sum to 100% (currently ${Math.round(total * 100)}%)`)
      return
    }
    setExporting(true)
    setShowExportModal(false)
    try {
      const res = await annotateApi.exportDataset(project.id, {
        format: exportFormat, train: trainR, val: valR, test: testR,
      })
      setExportJobId(res.job_id)
      setExportJobStatus('queued')
      setExportJobPct(0)
      addNotice('success', `Export started — ${res.total_images} images queued. You'll be notified by email when ready.`)

      // Poll for progress
      exportPollRef.current = setInterval(async () => {
        try {
          const job = await annotateApi.getExportJob(project.id, res.job_id)
          setExportJobPct(job.progress_pct)
          setExportJobStatus(job.status)
          if (job.status === 'completed') {
            clearInterval(exportPollRef.current!)
            exportPollRef.current = null
            setExporting(false)
            addNotice('success', 'Export complete — downloading now.')
            if (job.download_url) window.open(job.download_url, '_blank')
          } else if (job.status === 'failed') {
            clearInterval(exportPollRef.current!)
            exportPollRef.current = null
            setExporting(false)
            addNotice('error', `Export failed: ${job.error ?? 'unknown error'}`)
          }
        } catch { /* keep polling */ }
      }, 3000)
    } catch (e: any) {
      setExporting(false)
      addNotice('error', e?.response?.data?.detail ?? 'Export failed')
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

  // ── video capture overlay ────────────────────────────────────────────────────
  if (videoMode) {
    return (
      <VideoCapture
        file={videoMode}
        projectId={project.id}
        onFramesCaptured={newImgs => {
          setImages(prev => {
            const wasEmpty = prev.length === 0
            const next = [...prev, ...newImgs]
            if (wasEmpty) setCurrentIdx(0)
            return next
          })
        }}
        onClose={() => { setVideoMode(null); fileInputRef.current && (fileInputRef.current.value = '') }}
      />
    )
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
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden"
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
          <div className="w-52 flex-shrink-0 flex flex-col gap-0 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-3 pb-2">

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
              <button onClick={() => setShowExportModal(true)} disabled={exporting}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 rounded-lg transition-colors disabled:opacity-60">
                {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                {exporting ? 'Exporting…' : 'Export Dataset'}
              </button>
              {exporting && exportJobId && (
                <div className="px-1">
                  <div className="flex justify-between text-[9px] text-zinc-500 mb-0.5">
                    <span className="capitalize">{exportJobStatus}</span>
                    <span>{exportJobPct}%</span>
                  </div>
                  <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${exportJobPct}%` }}
                    />
                  </div>
                </div>
              )}
              <button onClick={handleExportModel}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 rounded-lg transition-colors">
                <Download size={11} /> Export Model .pt
              </button>
            </div>

            {/* Training Config — end of scrollable block */}
          </div>

          {/* Training Config — pinned at bottom, always visible */}
          <div className="flex-shrink-0 pt-1">
            <TrainingConfigPanel project={project} onSaved={onProjectUpdate} />
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
                  {currentImage.quality_score != null && (
                    <span
                      title={currentImage.quality_issues?.length ? `Issues: ${currentImage.quality_issues.join(', ')}` : 'Good quality'}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        currentImage.quality_score >= 70
                          ? 'bg-emerald-900/60 text-emerald-400'
                          : currentImage.quality_score >= 40
                          ? 'bg-amber-900/60 text-amber-400'
                          : 'bg-red-900/60 text-red-400'
                      }`}
                    >
                      Q{currentImage.quality_score}
                    </span>
                  )}
                  {/* ── Image actions ── */}
                  <button
                    onClick={() => handleFindSimilar(currentImage.id)}
                    disabled={similarLoading}
                    title="Find visually similar images"
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors font-medium"
                  >
                    {similarLoading ? <Loader2 size={12} className="animate-spin" /> : '🔍'}
                    Similar
                  </button>
                  <button
                    onClick={() => handleArchiveImage(currentImage.id, !currentImage.archived)}
                    title={currentImage.archived ? 'Unarchive image' : 'Archive image'}
                    className={`flex items-center gap-1 transition-colors font-medium ${currentImage.archived ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {currentImage.archived ? '📤' : '📦'}
                    {currentImage.archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={() => handleDeleteImage(currentImage.id)}
                    title="Delete this image"
                    className="flex items-center gap-1 text-red-500 hover:text-red-400 transition-colors font-medium"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
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
          <div className="w-[80px] flex-shrink-0 flex flex-col gap-1.5">
            {/* Annotation status filter */}
            <div className="flex flex-col gap-0.5">
              {([
                { key: 'all',          label: `All`,   dot: 'bg-zinc-500' },
                { key: 'unannotated',  label: `—`,     dot: 'bg-zinc-600' },
                { key: 'annotated',    label: `✓`,     dot: 'bg-green-500' },
                { key: 'predicted',    label: `⬡`,     dot: 'bg-amber-400' },
              ] as const).map(({ key, label, dot }) => {
                const count = key === 'all' ? images.length
                  : key === 'unannotated' ? images.filter(i => !i.annotations?.length).length
                  : key === 'annotated' ? images.filter(i => i.annotations?.length && !i.annotations.some(a => a.source === 'model' && !a.approved)).length
                  : images.filter(i => i.annotations?.some(a => a.source === 'model' && !a.approved)).length
                return (
                  <button key={key} onClick={() => setStripFilter(key)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${stripFilter === key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    <span className="truncate">{label}</span>
                    <span className="ml-auto text-zinc-600">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Quality filter — only shown when at least one image has quality data */}
            {images.some(i => i.quality_score != null) && (
              <div className="flex flex-col gap-0.5 border-t border-zinc-800 pt-1.5">
                <p className="text-[9px] uppercase tracking-wider text-zinc-600 px-2 pb-0.5">Quality</p>
                {([
                  { key: 'all',         label: 'All',  dot: 'bg-zinc-500' },
                  { key: 'good',        label: '✓ Good',  dot: 'bg-emerald-500' },
                  { key: 'poor',        label: '⚠ Poor',  dot: 'bg-red-500' },
                  { key: 'blurry',      label: 'Blur',    dot: 'bg-orange-400' },
                  { key: 'dark',        label: 'Dark',    dot: 'bg-zinc-500' },
                  { key: 'overexposed', label: 'Bright',  dot: 'bg-yellow-400' },
                  { key: 'low_res',     label: 'Low res', dot: 'bg-purple-400' },
                ] as const).map(({ key, label, dot }) => {
                  const count = key === 'all' ? images.length
                    : key === 'good' ? images.filter(i => (i.quality_score ?? 0) >= 70 && !i.quality_issues?.length).length
                    : key === 'poor' ? images.filter(i => (i.quality_score ?? 100) < 70 || (i.quality_issues?.length ?? 0) > 0).length
                    : images.filter(i => i.quality_issues?.includes(key)).length
                  if (key !== 'all' && key !== 'good' && key !== 'poor' && count === 0) return null
                  return (
                    <button key={key} onClick={() => setQualityFilter(key)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${qualityFilter === key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="truncate">{label}</span>
                      <span className="ml-auto text-zinc-600">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Archived toggle */}
            <button
              onClick={() => { setShowArchived(v => !v); setCurrentIdx(0) }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${showArchived ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-zinc-500" />
              <span className="truncate">Archived</span>
              <span className="ml-auto text-zinc-600">{archivedCount}</span>
            </button>

            {/* Strip thumbnails — click to select; 🔍 bar on hover */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0">
              {filteredStrip.length === 0 && (
                <p className="text-[10px] text-zinc-600 text-center py-4">None</p>
              )}
              {filteredStrip.map(({ img, realIdx }) => {
                const hasPredictions = img.annotations?.some(a => a.source === 'model' && !a.approved)
                const isAnnotated = img.annotations?.length > 0
                const isPoor = img.quality_issues?.length ? true : (img.quality_score != null && img.quality_score < 70)
                const isSimilarTarget = similarPanel?.targetId === img.id
                const isSimilarMatch = similarImageIds.has(img.id)
                return (
                  <div
                    key={img.id}
                    className={`group flex-shrink-0 relative rounded-md overflow-hidden border-2 transition-colors cursor-pointer ${
                      realIdx === currentIdx ? 'border-violet-500'
                      : isSimilarTarget ? 'border-blue-400'
                      : isSimilarMatch ? 'border-blue-600'
                      : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                    style={{ width: 64, height: 48 }}
                    onClick={() => { if (pendingAnns !== null) handleSave(); setCurrentIdx(realIdx); setPendingAnns(null) }}
                  >
                    {img.url
                      ? <img src={img.url} alt={img.filename} className="w-full h-full object-cover pointer-events-none" />
                      : <div className="w-full h-full bg-zinc-800 flex items-center justify-center pointer-events-none"><Square size={14} className="text-zinc-600" /></div>
                    }
                    {/* Status dot */}
                    <div className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full pointer-events-none ${hasPredictions ? 'bg-amber-400' : isAnnotated ? 'bg-green-400' : 'bg-zinc-600'}`} />
                    {/* Quality score badge */}
                    {isPoor && img.quality_score != null && (
                      <div className="absolute top-0.5 left-0.5 bg-red-500/80 text-white text-[8px] font-bold px-0.5 rounded pointer-events-none">
                        {img.quality_score}
                      </div>
                    )}
                    {/* Similarity % badge */}
                    {isSimilarMatch && (() => {
                      const match = similarPanel?.results.find(r => r.id === img.id)
                      return match ? (
                        <div className="absolute bottom-0.5 left-0.5 bg-blue-600/90 text-white text-[8px] font-bold px-0.5 rounded pointer-events-none">
                          {match.similarity_pct}%
                        </div>
                      ) : null
                    })()}
                    {/* 🔍 Find Similar bar — only action in strip; doesn't block main click area */}
                    <button
                      className="absolute inset-x-0 bottom-0 opacity-0 group-hover:opacity-100 bg-black/80 text-blue-300 text-[9px] py-0.5 text-center transition-opacity"
                      onClick={e => { e.stopPropagation(); handleFindSimilar(img.id) }}
                      title="Find similar images"
                    >
                      🔍
                    </button>
                    {predictingImageId === img.id && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
                        <Loader2 size={14} className="animate-spin text-amber-400" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      )}

      {/* ── Similar Images Panel ──────────────────────────────────────────────── */}
      {similarPanel && (
        <div className="fixed inset-0 z-[10000] flex">
          <div className="flex-1 bg-black/50" onClick={() => setSimilarPanel(null)} />
          <div className="w-full max-w-sm bg-zinc-900 border-l border-zinc-700 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div>
                <h2 className="text-sm font-semibold text-white">Similar Images</h2>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {similarPanel.results.length === 0
                    ? 'No visually similar images found'
                    : `${similarPanel.results.length} match${similarPanel.results.length !== 1 ? 'es' : ''} found`}
                </p>
              </div>
              <button onClick={() => setSimilarPanel(null)} className="text-zinc-500 hover:text-zinc-300">
                <X size={16} />
              </button>
            </div>

            {/* Bulk actions */}
            {selectedSimilar.size > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-zinc-800 border-b border-zinc-700">
                <span className="text-[10px] text-zinc-400">{selectedSimilar.size} selected</span>
                <button
                  onClick={handleBulkArchiveSimilar}
                  className="text-[10px] px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                >📦 Archive</button>
                <button
                  onClick={handleBulkDeleteSimilar}
                  className="text-[10px] px-2 py-1 bg-red-900/60 hover:bg-red-800/60 text-red-400 rounded transition-colors"
                >🗑 Delete</button>
                <button
                  onClick={() => setSelectedSimilar(new Set())}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 ml-auto"
                >Clear</button>
              </div>
            )}

            {/* Select all row */}
            {similarPanel.results.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
                <input
                  type="checkbox"
                  checked={selectedSimilar.size === similarPanel.results.length}
                  onChange={e => setSelectedSimilar(e.target.checked ? new Set(similarPanel.results.map(r => r.id)) : new Set())}
                  className="accent-violet-500"
                />
                <span className="text-[10px] text-zinc-500">Select all</span>
                <span className="ml-auto text-[10px] text-zinc-600">Similarity</span>
              </div>
            )}

            {/* Results list */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800">
              {similarPanel.results.length === 0 && (
                <div className="px-4 py-10 text-center text-zinc-600 text-xs">
                  No similar images found within the current threshold.
                </div>
              )}
              {similarPanel.results.map(r => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800 transition-colors ${selectedSimilar.has(r.id) ? 'bg-zinc-800' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSimilar.has(r.id)}
                    onChange={e => setSelectedSimilar(prev => {
                      const next = new Set(prev)
                      e.target.checked ? next.add(r.id) : next.delete(r.id)
                      return next
                    })}
                    className="accent-violet-500 flex-shrink-0"
                  />
                  {/* Thumbnail */}
                  <div
                    className="flex-shrink-0 w-12 h-9 rounded overflow-hidden border border-zinc-700 cursor-pointer"
                    onClick={() => {
                      const idx = images.findIndex(i => i.id === r.id)
                      if (idx >= 0) { setCurrentIdx(idx); setSimilarPanel(null) }
                    }}
                  >
                    {r.url
                      ? <img src={r.url} alt={r.filename} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-zinc-800" />
                    }
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-300 truncate">{r.filename}</p>
                    <p className="text-[9px] text-zinc-600 mt-0.5">{r.status}</p>
                  </div>
                  {/* Similarity score */}
                  <div className="flex-shrink-0 text-right">
                    <div className={`text-[11px] font-bold ${r.similarity_pct >= 90 ? 'text-red-400' : r.similarity_pct >= 75 ? 'text-amber-400' : 'text-zinc-400'}`}>
                      {r.similarity_pct}%
                    </div>
                    <div className="text-[9px] text-zinc-600">{r.similarity_distance}/64 bits</div>
                  </div>
                  {/* Quick actions */}
                  <div className="flex-shrink-0 flex gap-1">
                    <button onClick={() => handleArchiveImage(r.id, true)} title="Archive" className="p-1 hover:text-zinc-300 text-zinc-600 transition-colors text-[11px]">📦</button>
                    <button onClick={() => handleDeleteImage(r.id)} title="Delete" className="p-1 hover:text-red-400 text-zinc-600 transition-colors"><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <div className="px-4 py-2 border-t border-zinc-800 text-[9px] text-zinc-600">
              Similarity via 64-bit perceptual hash (dHash). ≥90% = near-duplicate.
            </div>
          </div>
        </div>
      )}

      {/* ── Export Modal ──────────────────────────────────────────────────────── */}
      {showExportModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <h2 className="text-sm font-semibold text-white">Export Dataset</h2>

            {/* Format */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Format</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['yolo-detect', 'yolo-obb', 'yolo-seg'] as const).map(f => (
                  <button key={f} onClick={() => setExportFormat(f)}
                    className={`px-2 py-1.5 text-[10px] rounded-lg border font-mono transition-colors ${
                      exportFormat === f
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-zinc-600 leading-relaxed">
                {exportFormat === 'yolo-detect' && 'Axis-aligned boxes [cx cy w h]. Polygons converted to bounding box.'}
                {exportFormat === 'yolo-obb'    && 'Oriented boxes [cx cy w h angle°]. Polygons converted to minimum-area rectangle.'}
                {exportFormat === 'yolo-seg'    && 'Polygon masks [x1 y1 x2 y2 …]. Boxes converted to 4-corner polygon.'}
              </p>
            </div>

            {/* Split mode */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Split</label>
              <div className="flex gap-2">
                {(['two', 'three'] as const).map(m => (
                  <button key={m} onClick={() => {
                    setExportSplitMode(m)
                    if (m === 'two') { setExportTrain(80); setExportVal(20) }
                    else             { setExportTrain(70); setExportVal(20); setExportTest(10) }
                  }}
                    className={`flex-1 py-1.5 text-[10px] rounded-lg border transition-colors ${
                      exportSplitMode === m
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}>
                    {m === 'two' ? 'Train / Val' : 'Train / Val / Test'}
                  </button>
                ))}
              </div>
              <div className="space-y-2 pt-1">
                {[
                  { label: 'Train', val: exportTrain, set: setExportTrain },
                  { label: 'Val',   val: exportVal,   set: setExportVal },
                  ...(exportSplitMode === 'three' ? [{ label: 'Test', val: exportTest, set: setExportTest }] : []),
                ].map(({ label, val, set }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-400 w-8">{label}</span>
                    <input type="range" min={5} max={90} value={val}
                      onChange={e => set(Number(e.target.value))}
                      className="flex-1 accent-indigo-500 h-1" />
                    <span className="text-[10px] text-zinc-300 w-7 text-right font-mono">{val}%</span>
                  </div>
                ))}
                {(() => {
                  const sum = exportTrain + exportVal + (exportSplitMode === 'three' ? exportTest : 0)
                  return sum !== 100
                    ? <p className="text-[9px] text-amber-400">Ratios sum to {sum}% — must equal 100%</p>
                    : <p className="text-[9px] text-emerald-600">Ratios sum to 100% ✓</p>
                })()}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowExportModal(false)}
                className="flex-1 py-2 text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleExportDataset}
                className="flex-1 py-2 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition-colors">
                Start Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── training config panel ─────────────────────────────────────────────────────
function TrainingConfigPanel({
  project,
  onSaved,
}: {
  project: AnnotationProject
  onSaved: (p: AnnotationProject) => void
}) {
  const [open, setOpen] = useState(false)
  const [autoFinetune, setAutoFinetune] = useState(project.auto_finetune)
  const [finetuneLr, setFinetuneLr] = useState(String(project.finetune_lr))
  const [baseLr, setBaseLr] = useState(String(project.base_lr))
  const [imgsz, setImgsz] = useState(String(project.train_imgsz))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await annotateApi.updateProject(project.id, {
        auto_finetune: autoFinetune,
        finetune_lr: parseFloat(finetuneLr) || project.finetune_lr,
        base_lr: parseFloat(baseLr) || project.base_lr,
        train_imgsz: parseInt(imgsz) || project.train_imgsz,
      })
      onSaved(updated)
      setOpen(false)
    } catch {
      // keep open
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider hover:text-zinc-200 transition-colors"
      >
        <span>Train Config</span>
        <span className="text-zinc-600">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-zinc-700/50 pt-2.5">
          {/* Auto fine-tune toggle */}
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-[10px] text-zinc-400">Auto fine-tune</span>
            <button
              onClick={() => setAutoFinetune(v => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors ${autoFinetune ? 'bg-violet-600' : 'bg-zinc-600'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoFinetune ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </label>
          <p className="text-[9px] text-zinc-600 -mt-1.5">
            {autoFinetune ? 'Reuses prev weights with lower LR' : 'Always trains from COCO base'}
          </p>

          {/* Fine-tune LR */}
          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Fine-tune LR</label>
            <input
              type="number" step="0.00001" min="0.000001" max="0.01"
              value={finetuneLr}
              onChange={e => setFinetuneLr(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Base LR */}
          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Base LR (fresh)</label>
            <input
              type="number" step="0.001" min="0.0001" max="0.1"
              value={baseLr}
              onChange={e => setBaseLr(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Image size */}
          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Image size (imgsz)</label>
            <select
              value={imgsz}
              onChange={e => setImgsz(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-violet-500"
            >
              {['320', '480', '640', '800', '1024', '1280', '1536'].map(s => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-1.5 text-[10px] bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-1"
          >
            {saving ? <><Loader2 size={10} className="animate-spin" /> Saving…</> : 'Save Config'}
          </button>
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

// ── Export Dataset Modal (used inside AnnotationEditor) ─────────────────────
// (modal JSX is inlined inside AnnotationEditor's return — see showExportModal state)
