import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import clsx from 'clsx'
import {
  Play, Upload, Plus, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, FileCode, RefreshCw, Database,
  Trash2, Save, AlertCircle, Loader2, PackageCheck,
  Terminal, Cpu, Wallet, Clock, Sparkles,
} from 'lucide-react'
import { editorApi, type FileNode, type EditorDataset } from '@/api/editor'
import { walletApi } from '@/api/wallet'
import { datasetsApi } from '@/api/datasets'
import { trainersApi } from '@/api/trainers'
import { useAuth } from '@/context/AuthContext'
import type { Wallet as WalletData } from '@/types/wallet'
import type { DatasetProfile } from '@/types/dataset'
import DatasetUploadModal from '@/components/DatasetUploadModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpenTab {
  path: string
  name: string
  content: string
  dirty: boolean   // unsaved changes
}

interface LogLine {
  id: number
  text: string
  type: 'info' | 'error' | 'done' | 'connected'
}

// ── File Explorer ─────────────────────────────────────────────────────────────

function _shouldHide(name: string): boolean {
  return (name.startsWith('__') && name.endsWith('__')) || name.startsWith('.')
}

function FileTree({
  nodes,
  openPaths,
  activePath,
  onToggleDir,
  onOpenFile,
  onDelete,
}: {
  nodes: FileNode[]
  openPaths: Set<string>
  activePath: string | null
  onToggleDir: (path: string) => void
  onOpenFile: (node: FileNode) => void
  onDelete: (node: FileNode) => void
}) {
  return (
    <div className="space-y-0.5">
      {nodes.filter(n => !_shouldHide(n.name)).map(node => (
        <FileTreeNode
          key={node.path}
          node={node}
          openPaths={openPaths}
          activePath={activePath}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
          onDelete={onDelete}
          depth={0}
        />
      ))}
    </div>
  )
}

function FileTreeNode({
  node,
  openPaths,
  activePath,
  onToggleDir,
  onOpenFile,
  onDelete,
  depth,
}: {
  node: FileNode
  openPaths: Set<string>
  activePath: string | null
  onToggleDir: (path: string) => void
  onOpenFile: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  depth: number
}) {
  const isOpen = openPaths.has(node.path)
  const isActive = node.path === activePath
  const [hovered, setHovered] = useState(false)

  if (node.type === 'dir') {
    return (
      <div>
        <button
          onClick={() => onToggleDir(node.path)}
          className={clsx(
            'w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors text-left',
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {isOpen ? <FolderOpen size={12} className="text-yellow-500 flex-shrink-0" /> : <Folder size={12} className="text-yellow-600 flex-shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.filter(c => !_shouldHide(c.name)).map(child => (
              <FileTreeNode
                key={child.path}
                node={child}
                openPaths={openPaths}
                activePath={activePath}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onDelete={onDelete}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => onOpenFile(node)}
        className={clsx(
          'w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors text-left',
          isActive
            ? 'bg-brand-900/60 text-brand-300 border border-brand-700/40'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
        )}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
      >
        <FileCode size={12} className={clsx('flex-shrink-0', isActive ? 'text-brand-400' : 'text-blue-500')} />
        <span className="truncate flex-1">{node.name}</span>
        {node.size !== undefined && (
          <span className="text-[10px] text-gray-600 flex-shrink-0">{formatBytes(node.size)}</span>
        )}
      </button>
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(node) }}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-gray-600 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`
  return `${(b / 1024 / 1024).toFixed(1)}M`
}

// ── Dataset Picker ────────────────────────────────────────────────────────────

function DatasetPicker({
  datasets,
  onInsert,
  loading,
}: {
  datasets: EditorDataset[]
  onInsert: (datasetId: string) => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors disabled:opacity-50"
        title="Insert dataset datasource"
      >
        <Database size={12} />
        Dataset
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-[11px] text-gray-400">Insert DatasetDataSource into editor</p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {datasets.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-500 text-center">No datasets yet</p>
            ) : (
              datasets.map(ds => (
                <button
                  key={ds.id}
                  onClick={() => { onInsert(ds.id); setOpen(false) }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-gray-800 transition-colors text-left"
                >
                  <Database size={13} className="text-sky-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs text-white font-medium truncate">{ds.name}</div>
                    <div className="text-[11px] text-gray-500 truncate mt-0.5">
                      {ds.fields.length} fields · {ds.status}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Templates sidebar section ─────────────────────────────────────────────────

const SAMPLE_META: Record<string, { label: string; description: string; icon: string }> = {
  'sample_image_classifier':        { label: 'Image Classifier',         description: 'ResNet-18 transfer learning',             icon: '🖼️' },
  'sample_object_detector':         { label: 'Object Detector',          description: 'YOLOv8 bounding boxes',                   icon: '🔍' },
  'sample_image_segmentation':      { label: 'Segmentation',             description: 'YOLOv8-seg pixel masks',                  icon: '✂️' },
  'sample_image_similarity':        { label: 'Image Similarity',         description: 'CLIP embeddings & text search',           icon: '🔗' },
  'sample_kenyan_plate_detector':   { label: 'Kenyan Plate Detector',    description: 'YOLOv8 detection + EasyOCR — KAA 000A',   icon: '🚗' },
}

function _flattenTree(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.type === 'file') out.push(n)
    else if (n.children) out.push(..._flattenTree(n.children))
  }
  return out
}

function TemplatesSection({
  tree,
  activePath,
  onFork,
}: {
  tree: FileNode[]
  activePath: string | null
  onFork: (node: FileNode) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const samples = _flattenTree(tree).filter(n => n.name.startsWith('sample_') && n.name.endsWith('.py'))
  if (samples.length === 0) return null

  return (
    <div className="border-t border-gray-800 flex-shrink-0">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-gray-500 uppercase tracking-wider font-medium hover:text-gray-300 transition-colors"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        Templates
      </button>
      {!collapsed && (
        <div className="pb-2 space-y-0.5 px-1">
          {samples.map(node => {
            const stem    = node.name.replace(/\.py$/, '')
            const meta    = SAMPLE_META[stem]
            const label   = meta?.label ?? stem.replace(/^sample_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            const desc    = meta?.description ?? ''
            const icon    = meta?.icon ?? '📄'
            const copyName = node.name.replace(/^sample_/, '')
            const isActive = activePath === copyName
            return (
              <button
                key={node.path}
                onClick={() => onFork(node)}
                title={`Open a copy as ${copyName}`}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors',
                  isActive
                    ? 'bg-brand-900/60 text-brand-300 border border-brand-700/40'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
                )}
              >
                <span className="text-sm flex-shrink-0 leading-none">{icon}</span>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium truncate leading-tight">{label}</div>
                  <div className="text-[10px] text-gray-600 truncate mt-0.5">{desc || 'Opens a personal copy'}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Quota Bar ─────────────────────────────────────────────────────────────────

function QuotaBar({ wallet }: { wallet: WalletData | null }) {
  if (!wallet) return null
  const usedHrs = wallet.local_used_seconds / 3600
  const totalHrs = wallet.local_quota_seconds / 3600
  const pct = totalHrs > 0 ? Math.min(100, (usedHrs / totalHrs) * 100) : 0
  const resetDate = wallet.local_quota_reset_at
    ? new Date(wallet.local_quota_reset_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-900/60 border-b border-gray-800 text-[11px] text-gray-400">
      {/* Wallet balance */}
      <div className="flex items-center gap-1.5">
        <Wallet size={11} className="text-brand-400" />
        <span className="text-white font-medium">${wallet.balance.toFixed(2)}</span>
        <span>USD</span>
        {wallet.reserved > 0 && (
          <span className="text-amber-500">· ${wallet.reserved.toFixed(2)} held</span>
        )}
      </div>

      <span className="text-gray-700">|</span>

      {/* Local quota */}
      <div className="flex items-center gap-2">
        <Clock size={11} className="text-gray-500" />
        <span>Local:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-green-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={clsx(pct > 80 ? 'text-red-400' : 'text-gray-300')}>
            {usedHrs.toFixed(1)}h / {totalHrs.toFixed(0)}h
          </span>
        </div>
        {resetDate && <span className="text-gray-600">resets {resetDate}</span>}
      </div>

      {/* GPU indicator */}
      <span className="text-gray-700">|</span>
      <div className="flex items-center gap-1.5">
        <Cpu size={11} className="text-gray-500" />
        <span>Runs on local CPU</span>
      </div>
    </div>
  )
}

// ── AI Generate Modal ─────────────────────────────────────────────────────────

const DS_TYPES = [
  { value: 'dataset',    label: 'MLDock Dataset',        hint: 'Auto-creates a dataset with upload fields' },
  { value: 'upload',     label: 'File Upload (per run)', hint: 'User uploads a file each time they run' },
  { value: 's3',         label: 'S3 / MinIO',            hint: 'Read from a bucket path' },
  { value: 'url',        label: 'HTTP URL',              hint: 'Download from a public URL' },
  { value: 'mongodb',    label: 'MongoDB',               hint: 'Query a collection' },
  { value: 'huggingface','label': 'Hugging Face Hub',    hint: 'HF Hub dataset' },
  { value: 'memory',     label: 'In-Memory / Built-in',  hint: 'Fetch or generate data inside preprocess()' },
]
const FW_TYPES = [
  { value: 'auto',        label: 'Auto (LLM decides)' },
  { value: 'sklearn',     label: 'scikit-learn' },
  { value: 'pytorch',     label: 'PyTorch' },
  { value: 'tensorflow',  label: 'TensorFlow / Keras' },
  { value: 'custom',      label: 'Custom / Other' },
]

function AiGenerateModal({ onClose, onInsert }: { onClose: () => void; onInsert: (code: string) => void }) {
  const [description, setDescription]       = useState('')
  const [dsType, setDsType]                 = useState('dataset')
  const [framework, setFramework]           = useState('auto')
  const [className, setClassName]           = useState('')
  const [extraNotes, setExtraNotes]         = useState('')
  const [generating, setGenerating]         = useState(false)
  const [error, setError]                   = useState('')
  const [preview, setPreview]               = useState('')

  const generate = async () => {
    if (!description.trim()) { setError('Describe what the trainer should do'); return }
    setGenerating(true); setError(''); setPreview('')
    try {
      const result = await editorApi.generateTrainer({
        description: description.trim(),
        data_source_type: dsType,
        framework,
        class_name: className.trim() || undefined,
        extra_notes: extraNotes.trim() || undefined,
      })
      setPreview(result.code)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Generation failed. Check that the LLM is configured.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-gray-900 border border-violet-800/40 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Generate Trainer with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Description */}
          <div>
            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
              What should the trainer do? *
            </label>
            <textarea
              rows={4}
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
              placeholder="e.g. Classify cattle body condition scores (1–5) from photos. Use a pre-trained ResNet50 with transfer learning. Dataset: labeled images uploaded as a ZIP."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Data source */}
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Data Source</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                value={dsType}
                onChange={e => setDsType(e.target.value)}
              >
                {DS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p className="text-[10px] text-gray-600 mt-0.5">
                {DS_TYPES.find(t => t.value === dsType)?.hint}
              </p>
            </div>

            {/* Framework */}
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Framework</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                value={framework}
                onChange={e => setFramework(e.target.value)}
              >
                {FW_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Class name */}
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                Class Name <span className="text-gray-600 normal-case font-normal">(optional)</span>
              </label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                placeholder="CattleBCSClassifier"
                value={className}
                onChange={e => setClassName(e.target.value)}
              />
            </div>

            {/* Extra notes */}
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">
                Extra Notes <span className="text-gray-600 normal-case font-normal">(optional)</span>
              </label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                placeholder="Use float16, output class + confidence"
                value={extraNotes}
                onChange={e => setExtraNotes(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* Preview */}
          {preview && (
            <div>
              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 block">Generated Code — review before inserting</label>
              <pre className="bg-gray-950 border border-gray-700 rounded-lg p-4 text-[11px] text-gray-300 overflow-x-auto max-h-56 leading-5">
                {preview}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-4 flex gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors">
            Cancel
          </button>
          {preview ? (
            <>
              <button onClick={generate} disabled={generating}
                className="px-4 py-2 text-xs text-violet-300 bg-violet-900/40 hover:bg-violet-800/50 border border-violet-700/40 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                Regenerate
              </button>
              <button onClick={() => onInsert(preview)}
                className="flex-1 py-2 text-xs text-white bg-violet-700 hover:bg-violet-600 rounded-lg transition-colors font-semibold">
                Insert into Editor →
              </button>
            </>
          ) : (
            <button onClick={generate} disabled={generating || !description.trim()}
              className="flex-1 py-2 text-xs text-white bg-violet-700 hover:bg-violet-600 rounded-lg transition-colors font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              {generating ? <><Loader2 size={12} className="animate-spin" /> Generating…</> : <><Sparkles size={12} /> Generate Trainer</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CodeEditorPage() {
  const { user } = useAuth()

  // File tree
  const [tree, setTree] = useState<FileNode[]>([])
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [treeLoading, setTreeLoading] = useState(true)

  // Editor tabs
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)

  // New file dialog
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileTemplate, setNewFileTemplate] = useState<'blank' | 'trainer'>('trainer')
  const [newFileError, setNewFileError] = useState('')

  // AI Generate
  const [showAiGenerate, setShowAiGenerate] = useState(false)

  // Datasets
  const [datasets, setDatasets] = useState<EditorDataset[]>([])
  const [datasetsLoading, setDatasetsLoading] = useState(false)

  // Save status
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Run / logs
  const [running, setRunning] = useState(false)
  const [insufficientBalance, setInsufficientBalance] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const logIdRef = useRef(0)
  const logBottomRef = useRef<HTMLDivElement>(null)
  const sseRef = useRef<EventSource | null>(null)

  // Wallet
  const [wallet, setWallet] = useState<WalletData | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null)

  // Empty-dataset upload prompt (shown after "Dataset is empty" error or after install)
  const [emptyDataset, setEmptyDataset] = useState<DatasetProfile | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const emptyDatasetSlugRef = useRef<string | null>(null)

  // Install status
  const [installing, setInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const activeTabData = tabs.find(t => t.path === activeTab) ?? null

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    try {
      const data = await editorApi.listFiles()
      setTree(data.tree)
    } catch {}
    finally { setTreeLoading(false) }
  }, [])

  const loadDatasets = useCallback(async () => {
    setDatasetsLoading(true)
    try { setDatasets(await editorApi.listDatasets()) } catch {}
    finally { setDatasetsLoading(false) }
  }, [])

  const loadWallet = useCallback(async () => {
    try { setWallet(await walletApi.get()) } catch {}
  }, [])

  useEffect(() => {
    loadTree()
    loadDatasets()
    loadWallet()
  }, [loadTree, loadDatasets, loadWallet])

  // Auto-scroll logs
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeTabData) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTabData]) // eslint-disable-line

  // ── File tree actions ─────────────────────────────────────────────────────

  const toggleDir = (path: string) => {
    setOpenDirs(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const openFile = async (node: FileNode) => {
    if (node.type === 'dir') return
    // Already open?
    const existing = tabs.find(t => t.path === node.path)
    if (existing) { setActiveTab(node.path); return }
    try {
      const { content } = await editorApi.getFileContent(node.path)
      const tab: OpenTab = { path: node.path, name: node.name, content, dirty: false }
      setTabs(prev => [...prev, tab])
      setActiveTab(node.path)
    } catch {}
  }

  // Open a sample/template file as a personal copy — never edit the original
  const forkSampleFile = async (node: FileNode) => {
    if (node.type === 'dir') return
    const copyName = node.name.replace(/^sample_/, '')
    const copyPath = copyName

    // If the copy is already open in a tab, just switch to it
    const openCopy = tabs.find(t => t.path === copyPath)
    if (openCopy) { setActiveTab(copyPath); return }

    // If the copy already exists on disk, open it directly
    const allFiles = _flattenTree(tree)
    const existsOnDisk = allFiles.find(f => f.path === copyPath)
    if (existsOnDisk) {
      await openFile(existsOnDisk)
      return
    }

    // Otherwise create the copy from the template content
    try {
      const { content } = await editorApi.getFileContent(node.path)
      await editorApi.saveFile(copyPath, content)
      await loadTree()
      const tab: OpenTab = { path: copyPath, name: copyName, content, dirty: false }
      setTabs(prev => prev.find(t => t.path === copyPath) ? prev : [...prev, tab])
      setActiveTab(copyPath)
    } catch {}
  }

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const idx = tabs.findIndex(t => t.path === path)
    const newTabs = tabs.filter(t => t.path !== path)
    setTabs(newTabs)
    if (activeTab === path) {
      setActiveTab(newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null)
    }
  }

  const updateTabContent = (path: string, content: string) => {
    setTabs(prev => prev.map(t => t.path === path ? { ...t, content, dirty: true } : t))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!activeTabData) return
    setSaving(true)
    try {
      await editorApi.saveFile(activeTabData.path, activeTabData.content)
      setTabs(prev => prev.map(t => t.path === activeTabData.path ? { ...t, dirty: false } : t))
      setSaveStatus('saved')
      await loadTree()
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }

  // ── New file ──────────────────────────────────────────────────────────────

  const handleNewFile = async () => {
    const name = newFileName.trim()
    if (!name) { setNewFileError('File name is required'); return }
    const path = name.endsWith('.py') ? name : `${name}.py`
    try {
      const result = await editorApi.newFile(path, newFileTemplate)
      await loadTree()
      const tab: OpenTab = { path: result.path, name: path.split('/').pop()!, content: result.content, dirty: false }
      setTabs(prev => [...prev, tab])
      setActiveTab(result.path)
      setShowNewFile(false)
      setNewFileName('')
      setNewFileError('')
    } catch (err: any) {
      setNewFileError(err?.response?.data?.detail ?? 'Failed to create file')
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await editorApi.deleteFile(deleteTarget.path)
      setTabs(prev => prev.filter(t => t.path !== deleteTarget.path))
      if (activeTab === deleteTarget.path) setActiveTab(null)
      await loadTree()
    } catch {}
    setDeleteTarget(null)
  }

  // ── Dataset autofill ──────────────────────────────────────────────────────

  const handleInsertDataset = async (datasetId: string) => {
    try {
      const result = await editorApi.getDatasetAutofill(datasetId)
      // Open as a new tab (or if already open, prompt)
      const existing = tabs.find(t => t.path === result.filename)
      if (existing) {
        setActiveTab(result.filename)
        return
      }
      const tab: OpenTab = { path: result.filename, name: result.filename, content: result.code, dirty: true }
      setTabs(prev => [...prev, tab])
      setActiveTab(result.filename)
    } catch {}
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  const addLog = (text: string, type: LogLine['type'] = 'info') => {
    setLogs(prev => [...prev, { id: ++logIdRef.current, text, type }])
  }

  const handleRun = async () => {
    if (!activeTabData) return

    // Save first
    if (activeTabData.dirty) await handleSave()

    setInsufficientBalance(null)
    setRunning(true)
    setLogOpen(true)
    setLogs([])

    // Validate: check syntax + detect trainer name from `name = "..."` attribute
    addLog('● Validating file…', 'connected')
    let trainerName: string
    try {
      const check = await editorApi.validateFile(activeTabData.path, activeTabData.content)
      if (!check.valid) {
        addLog(`✗ ${check.error}`, 'error')
        setRunning(false)
        return
      }
      if (check.trainers.length === 0) {
        addLog('✗ No BaseTrainer subclass found — make sure your class has name = "..." and data_source = ...', 'error')
        setRunning(false)
        return
      }
      trainerName = check.trainers[0]
      addLog(`✓ Trainer detected: ${trainerName}`, 'info')
    } catch {
      // Fallback to filename stem
      trainerName = activeTabData.name.replace(/\.py$/, '')
      addLog(`⚠ Validation skipped, using filename: ${trainerName}`, 'info')
    }

    addLog(`▶ Starting run: ${trainerName}`, 'connected')
    emptyDatasetSlugRef.current = null
    setEmptyDataset(null)
    setShowUploadModal(false)

    try {
      const { job_id } = await editorApi.runTrainer(trainerName, activeTabData.content, activeTabData.path)
      setActiveJobId(job_id)
      addLog(`✓ Job queued: ${job_id}`, 'info')
      await loadWallet()

      // SSE log streaming
      const token = localStorage.getItem('ml_token') || ''
      const url = editorApi.logStreamUrl(job_id, token)
      const sse = new EventSource(url)
      sseRef.current = sse

      sse.addEventListener('log', e => {
        const data = JSON.parse((e as MessageEvent).data)
        addLog(data.line, 'info')
        // Detect empty-dataset error in log output
        const emptyMatch = (data.line as string).match(/Dataset '(.+?)' is empty/)
        if (emptyMatch) {
          emptyDatasetSlugRef.current = emptyMatch[1]
        }
      })
      sse.addEventListener('billing', e => {
        const data = JSON.parse((e as MessageEvent).data)
        if (!data.is_free && data.charged > 0) {
          addLog(`💰 Charged $${data.charged.toFixed(6)} USD · ${data.elapsed_seconds.toFixed(1)}s @ $${data.price_per_hour.toFixed(4)}/hr`, 'info')
          loadWallet()
        } else if (data.is_free) {
          addLog(`✓ Free compute (standard tier)`, 'info')
        }
      })
      sse.addEventListener('done', e => {
        const data = JSON.parse((e as MessageEvent).data)
        if (data.status === 'completed') {
          addLog(`✓ Training completed. Metrics: ${JSON.stringify(data.metrics)}`, 'done')
        } else {
          addLog(`✗ ${data.status}${data.error ? ': ' + data.error : ''}`, 'error')
          // If we detected an empty dataset slug, fetch and show upload modal
          if (emptyDatasetSlugRef.current) {
            const slug = emptyDatasetSlugRef.current
            datasetsApi.getBySlug(slug).then(ds => {
              setEmptyDataset(ds)
              setShowUploadModal(true)
            }).catch(() => {
              // Dataset not accessible via API — create a minimal stub so user can still upload
              const stub: DatasetProfile = {
                id: '',
                org_id: '',
                name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                slug,
                description: '',
                category: 'training',
                fields: [],
                status: 'active',
                visibility: 'private',
                source_dataset_id: null,
                reference_type: null,
                entry_count_cache: 0,
                points_enabled: false,
                points_per_entry: 1,
                points_redemption_info: '',
                created_by: 'system',
                created_at: '',
                updated_at: '',
              }
              setEmptyDataset(stub)
              setShowUploadModal(true)
            })
          }
        }
        setRunning(false)
        sse.close()
        loadWallet()
      })
      sse.addEventListener('error', e => {
        const data = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : {}
        addLog(`✗ Error: ${data.msg ?? 'connection lost'}`, 'error')
        setRunning(false)
        sse.close()
      })
      sse.onerror = () => {
        if (sse.readyState === EventSource.CLOSED) {
          setRunning(false)
        }
      }
    } catch (err: any) {
      if (err?.response?.status === 402) {
        setInsufficientBalance(err?.response?.data?.detail ?? 'Insufficient balance for compute. Top up your wallet to run.')
      } else {
        addLog(`✗ ${err?.response?.data?.detail ?? 'Failed to start run'}`, 'error')
      }
      setRunning(false)
    }
  }

  const handleDeploy = () => {
    // Navigate to deploy page — done by parent App
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'deploy' }))
  }

  // ── Install ───────────────────────────────────────────────────────────────
  // Uploads the current file as a trainer plugin (same as TrainersPage "Upload Plugin")
  // then checks if the trainer's dataset is empty and prompts to fill it.

  const handleInstall = async () => {
    if (!activeTabData) return
    setInstalling(true)
    setInstallStatus('idle')
    setLogOpen(true)
    addLog('● Installing trainer plugin…', 'connected')

    try {
      // Save first so the server sees the latest content
      if (activeTabData.dirty) await handleSave()

      // Wrap content as a File object for multipart upload
      const blob = new Blob([activeTabData.content], { type: 'text/x-python' })
      const file = new File([blob], activeTabData.name.endsWith('.py') ? activeTabData.name : `${activeTabData.name}.py`, { type: 'text/x-python' })

      const result = await trainersApi.upload(file)
      const registeredTrainer = result.trainer as Record<string, unknown> | null | undefined
      const trainerDisplayName = (registeredTrainer?.name as string) ?? activeTabData.name
      addLog(`✓ Installed: ${trainerDisplayName}`, 'done')
      setInstallStatus('ok')
      setTimeout(() => setInstallStatus('idle'), 3000)

      // Check if trainer has a dataset datasource and whether it's empty
      const dsInfo = (registeredTrainer?.data_source_info as Record<string, unknown>) ?? {}
      const dsType = dsInfo?.type as string | undefined
      if (dsType === 'dataset') {
        const dsSlug = dsInfo?.dataset_slug as string | undefined
        const dsId   = dsInfo?.dataset_id  as string | undefined
        if (dsSlug || dsId) {
          try {
            let dataset = null
            if (dsSlug) {
              dataset = await datasetsApi.getBySlug(dsSlug)
            } else if (dsId) {
              dataset = await datasetsApi.get(dsId)
            }
            if (dataset) {
              const { count } = await datasetsApi.getEntryCount(dataset.id)
              if (count === 0) {
                addLog(`⚠ Dataset "${dataset.name}" is empty — add training data to run.`, 'error')
                setEmptyDataset(dataset)
                setShowUploadModal(true)
              } else {
                addLog(`✓ Dataset "${dataset.name}" has ${count} entries — ready to run.`, 'info')
              }
            }
          } catch {
            // Non-fatal — dataset check failed but install succeeded
          }
        }
      }
    } catch (err: any) {
      addLog(`✗ Install failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`, 'error')
      setInstallStatus('error')
      setTimeout(() => setInstallStatus('idle'), 3000)
    } finally {
      setInstalling(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-950 h-full">
      {/* Quota / wallet bar */}
      <QuotaBar wallet={wallet} />

      {/* Action toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 flex-shrink-0">
        {/* New file */}
        <button
          onClick={() => setShowNewFile(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
        >
          <Plus size={12} /> New File
        </button>

        {/* AI Generate */}
        <button
          onClick={() => setShowAiGenerate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-900/50 border border-violet-700/60 text-violet-300 hover:bg-violet-800/60 hover:text-white rounded-lg transition-colors"
          title="Generate a trainer using AI"
        >
          <Sparkles size={12} /> Generate
        </button>

        <div className="flex-1" />

        {/* Dataset picker */}
        <DatasetPicker
          datasets={datasets}
          onInsert={handleInsertDataset}
          loading={datasetsLoading}
        />

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !activeTabData}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors disabled:opacity-40',
            saveStatus === 'saved'
              ? 'bg-green-900/40 border-green-700/60 text-green-400'
              : saveStatus === 'error'
              ? 'bg-red-900/40 border-red-700/60 text-red-400'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white',
          )}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
        </button>

        {/* Install */}
        <button
          onClick={handleInstall}
          disabled={installing || !activeTabData}
          title="Upload file as trainer plugin (same as TrainersPage → Upload Plugin)"
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors disabled:opacity-40 font-medium',
            installStatus === 'ok'
              ? 'bg-green-900/40 border-green-700/60 text-green-400'
              : installStatus === 'error'
              ? 'bg-red-900/40 border-red-700/60 text-red-400'
              : 'bg-indigo-900/50 border-indigo-700/60 text-indigo-300 hover:bg-indigo-800/60 hover:text-white',
          )}
        >
          {installing ? <Loader2 size={12} className="animate-spin" /> : <PackageCheck size={12} />}
          {installStatus === 'ok' ? 'Installed!' : installStatus === 'error' ? 'Failed' : installing ? 'Installing…' : 'Install'}
        </button>

        {/* Run */}
        <button
          onClick={handleRun}
          disabled={running || !activeTabData}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white border border-green-600 rounded-lg transition-colors disabled:opacity-40 font-medium"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? 'Running…' : 'Run'}
        </button>

        {/* Deploy */}
        <button
          onClick={handleDeploy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-700 hover:bg-brand-600 text-white border border-brand-600 rounded-lg transition-colors font-medium"
        >
          <Upload size={12} /> Deploy
        </button>

        {/* Refresh tree */}
        <button
          onClick={loadTree}
          disabled={treeLoading}
          className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh file tree"
        >
          <RefreshCw size={13} className={treeLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body: sidebar + editor */}
      <div className="flex flex-1 min-h-0">

        {/* File explorer sidebar */}
        <aside className="w-52 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-950 overflow-hidden">
          {/* My Files section */}
          <div className="px-3 py-2 border-b border-gray-800 text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            My Files
          </div>
          <div className="flex-1 overflow-y-auto p-1 min-h-0">
            {treeLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin text-gray-600" />
              </div>
            ) : _flattenTree(tree).filter(n => !n.name.startsWith('sample_')).length === 0 && tree.filter(n => n.type === 'dir' || !n.name.startsWith('sample_')).length === 0 ? (
              <p className="px-3 py-6 text-xs text-gray-600 text-center">
                No files yet.<br />Click <strong>+ New File</strong> to start.
              </p>
            ) : (
              <FileTree
                nodes={tree.filter(n => n.type === 'dir' || !n.name.startsWith('sample_'))}
                openPaths={openDirs}
                activePath={activeTab}
                onToggleDir={toggleDir}
                onOpenFile={openFile}
                onDelete={setDeleteTarget}
              />
            )}
          </div>

          {/* Templates section */}
          <TemplatesSection
            tree={tree}
            activePath={activeTab}
            onFork={forkSampleFile}
          />
        </aside>

        {/* Editor + logs column */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">

          {/* Tabs bar */}
          <div className="flex items-center border-b border-gray-800 bg-gray-950 overflow-x-auto flex-shrink-0" style={{ minHeight: '36px' }}>
            {tabs.map(tab => (
              <button
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 text-xs border-r border-gray-800 whitespace-nowrap transition-colors flex-shrink-0',
                  activeTab === tab.path
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300',
                )}
              >
                <FileCode size={11} className="text-blue-500 flex-shrink-0" />
                <span>{tab.name}</span>
                {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />}
                <span
                  onClick={e => closeTab(tab.path, e)}
                  className="ml-0.5 text-gray-600 hover:text-red-400 transition-colors cursor-pointer"
                >
                  <X size={11} />
                </span>
              </button>
            ))}
            {tabs.length === 0 && (
              <span className="px-4 text-xs text-gray-600 py-2">Open a file from the explorer</span>
            )}
          </div>

          {/* Monaco editor */}
          <div className="flex-1 min-h-0">
            {activeTabData ? (
              <Editor
                language="python"
                theme="vs-dark"
                value={activeTabData.content}
                onChange={(val: string | undefined) => updateTabContent(activeTabData.path, val ?? '')}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                  tabSize: 4,
                  insertSpaces: true,
                  automaticLayout: true,
                  renderWhitespace: 'selection',
                  bracketPairColorization: { enabled: true },
                  padding: { top: 8 },
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-4 text-gray-600">
                <FileCode size={40} className="opacity-20" />
                <div>
                  <p className="text-sm font-medium text-gray-500">No file open</p>
                  <p className="text-xs mt-1">Select a file from the explorer or create a new one</p>
                </div>
                <button
                  onClick={() => setShowNewFile(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-700 hover:bg-brand-600 text-white rounded-lg transition-colors"
                >
                  <Plus size={14} /> New Trainer File
                </button>
              </div>
            )}
          </div>

          {/* Insufficient balance banner */}
          {insufficientBalance && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-950/60 border-t border-amber-800/50 flex-shrink-0">
              <div className="flex items-center gap-2 text-[11px] text-amber-300 min-w-0">
                <Wallet size={12} className="text-amber-400 flex-shrink-0" />
                <span className="truncate">{insufficientBalance}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'wallet' }))}
                  className="px-3 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
                >
                  Top Up
                </button>
                <button
                  onClick={() => setInsufficientBalance(null)}
                  className="text-amber-600 hover:text-amber-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          {/* Log panel */}
          <div
            className={clsx(
              'border-t border-gray-800 flex flex-col bg-gray-950 transition-all flex-shrink-0',
              logOpen ? 'h-52' : 'h-8',
            )}
          >
            {/* Log header */}
            <button
              onClick={() => setLogOpen(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 border-b border-gray-800 w-full text-left flex-shrink-0"
            >
              <Terminal size={12} />
              <span className="font-medium">Output</span>
              {running && <Loader2 size={11} className="animate-spin text-green-400 ml-1" />}
              {activeJobId && <span className="text-gray-600">job: {activeJobId.slice(0, 8)}…</span>}
              {logs.length > 0 && (
                <span className="ml-auto text-gray-600">{logs.length} lines</span>
              )}
              <ChevronDown size={11} className={clsx('transition-transform ml-1', !logOpen && '-rotate-90')} />
            </button>

            {/* Log content */}
            {logOpen && (
              <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] space-y-0.5">
                {logs.length === 0 ? (
                  <span className="text-gray-600">Run a trainer to see output here.</span>
                ) : (
                  logs.map(line => (
                    <div
                      key={line.id}
                      className={clsx(
                        'whitespace-pre-wrap break-all leading-relaxed',
                        line.type === 'error' ? 'text-red-400' :
                        line.type === 'done' ? 'text-green-400' :
                        line.type === 'connected' ? 'text-brand-400' :
                        'text-gray-300',
                      )}
                    >
                      {line.text}
                    </div>
                  ))
                )}
                {/* Empty dataset prompt */}
                {emptyDatasetSlugRef.current && !running && !emptyDataset && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-950/40 border border-amber-800/50 rounded-lg font-sans">
                    <Loader2 size={11} className="animate-spin text-amber-400 flex-shrink-0" />
                    <span className="text-amber-300 text-[11px]">Loading dataset…</span>
                  </div>
                )}
                {emptyDataset && !running && (
                  <div className="mt-2 flex items-center gap-3 px-3 py-2.5 bg-amber-950/40 border border-amber-800/50 rounded-lg font-sans">
                    <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-amber-200 text-[11px] font-medium">Dataset is empty — training needs data</p>
                      <p className="text-amber-400/70 text-[10px] mt-0.5">Upload a CSV/Excel file to <span className="font-medium">{emptyDataset.name}</span> then re-run.</p>
                    </div>
                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-medium rounded-lg transition-colors flex-shrink-0"
                    >
                      <Upload size={11} /> Upload Data
                    </button>
                  </div>
                )}
                <div ref={logBottomRef} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New file dialog */}
      {showNewFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white">New Trainer File</h2>

            <div className="space-y-1">
              <label className="text-[11px] text-gray-400">File name</label>
              <input
                autoFocus
                value={newFileName}
                onChange={e => { setNewFileName(e.target.value); setNewFileError('') }}
                onKeyDown={e => e.key === 'Enter' && handleNewFile()}
                placeholder="my_trainer.py"
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-brand-600"
              />
              {newFileError && <p className="text-[11px] text-red-400">{newFileError}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-gray-400">Template</label>
              <div className="flex gap-2">
                {(['blank', 'trainer'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setNewFileTemplate(t)}
                    className={clsx(
                      'flex-1 py-2 text-xs rounded-lg border transition-colors',
                      newFileTemplate === t
                        ? 'bg-brand-900/50 border-brand-600 text-brand-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600',
                    )}
                  >
                    {t === 'blank' ? 'Empty' : 'BaseTrainer template'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowNewFile(false); setNewFileName(''); setNewFileError('') }}
                className="flex-1 py-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 border border-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNewFile}
                className="flex-1 py-2 text-xs text-white bg-brand-700 hover:bg-brand-600 rounded-lg transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dataset upload modal (triggered by empty-dataset run error) */}
      {showUploadModal && emptyDataset && (
        <DatasetUploadModal
          dataset={emptyDataset}
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => {
            setShowUploadModal(false)
            // Offer to re-run after upload
            setTimeout(() => handleRun(), 300)
          }}
        />
      )}

      {/* AI Generate modal */}
      {showAiGenerate && (
        <AiGenerateModal
          onClose={() => setShowAiGenerate(false)}
          onInsert={code => {
            // Open in a new tab named ai_generated.py
            const path = 'ai_generated.py'
            const tab: OpenTab = { path, name: path, content: code, dirty: true }
            setTabs(prev => {
              const exists = prev.find(t => t.path === path)
              return exists ? prev.map(t => t.path === path ? { ...t, content: code, dirty: true } : t) : [...prev, tab]
            })
            setActiveTab(path)
            setShowAiGenerate(false)
          }}
        />
      )}

      {/* Delete confirm dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-white">Delete {deleteTarget.type === 'dir' ? 'folder' : 'file'}?</h2>
                <p className="text-xs text-gray-500 mt-0.5">{deleteTarget.path}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-lg hover:text-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-2 text-xs text-white bg-red-700 hover:bg-red-600 rounded-lg transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
