import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import clsx from 'clsx'
import {
  Play, Upload, Plus, X, ChevronRight, ChevronDown,
  FolderOpen, Folder, FileCode, RefreshCw, Database,
  Trash2, Save, AlertCircle, Loader2, PackageCheck,
  Terminal, Cpu, Wallet, Clock, Sparkles,
  ArrowLeft, Send, Paperclip, Wand2, CheckCircle2, BarChart2,
  MessageSquare, ShieldAlert, RotateCcw, AlertTriangle, XCircle, Copy, Globe,
} from 'lucide-react'
import { editorApi, type FileNode, type EditorDataset } from '@/api/editor'
import { configApi } from '@/api/config'
import { walletApi } from '@/api/wallet'
import { datasetsApi } from '@/api/datasets'
import { trainersApi } from '@/api/trainers'
import { trainerSubmissionsApi } from '@/api/trainerSubmissions'
import { useAuth } from '@/context/AuthContext'
import type { Wallet as WalletData } from '@/types/wallet'
import type { DatasetProfile } from '@/types/dataset'
import type { TrainerSubmission } from '@/types/trainerSubmission'
import DatasetUploadModal from '@/components/DatasetUploadModal'
import TrainerAnomalyModal from '@/components/TrainerAnomalyModal'

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

interface SavedAiSession {
  id: string
  title: string          // first user message (truncated)
  messages: AiChatMsg[]
  session: AiSession
  generatedCode: string
  generatedFilename: string
  savedAt: number
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

function _flattenTree(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.type === 'file') out.push(n)
    else if (n.children) out.push(..._flattenTree(n.children))
  }
  return out
}

// ── Library Section (public trainers) ────────────────────────────────────────

function LibrarySection({
  trainers,
  cloningTrainer,
  onClone,
}: {
  trainers: import('@/types/trainer').TrainerRegistration[]
  cloningTrainer: string | null
  onClone: (trainer: import('@/types/trainer').TrainerRegistration) => void
}) {
  const [collapsed, setCollapsed] = useState(true)
  if (trainers.length === 0) return null

  // Group by base_name; pick latest by plugin_version
  const groups: Map<string, import('@/types/trainer').TrainerRegistration[]> = new Map()
  for (const t of trainers) {
    const key = t.base_name ?? t.name
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }
  const entries = [...groups.entries()].map(([base, vers]) => {
    const sorted = [...vers].sort((a, b) => (b.plugin_version ?? 0) - (a.plugin_version ?? 0))
    return { base, latest: sorted[0] }
  })

  return (
    <div className="border-t border-gray-800 flex-shrink-0">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-gray-500 uppercase tracking-wider font-medium hover:text-gray-300 transition-colors"
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        <Globe size={10} />
        Public Library
        <span className="ml-auto text-[9px] text-gray-700">{entries.length}</span>
      </button>
      {!collapsed && (
        <div className="pb-2 space-y-0.5 px-1">
          {entries.map(({ latest }) => {
            const isCloning = cloningTrainer === latest.name
            const label = (latest.base_name ?? latest.name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            return (
              <div
                key={latest.name}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800/60 transition-colors"
              >
                <Globe size={11} className="text-sky-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-gray-300 truncate leading-tight">{label}</div>
                  {latest.description && (
                    <div className="text-[10px] text-gray-600 truncate mt-0.5">{latest.description}</div>
                  )}
                </div>
                <button
                  onClick={() => onClone(latest)}
                  disabled={!!cloningTrainer}
                  title="Clone to your workspace"
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors disabled:opacity-50"
                >
                  {isCloning ? <Loader2 size={8} className="animate-spin" /> : <Copy size={8} />}
                  {isCloning ? '…' : 'Clone'}
                </button>
              </div>
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

// ── Data inspection pipeline (browser-side, no LLM) ─────────────────────────

interface ColumnProfile {
  name: string
  type: 'numeric' | 'categorical' | 'datetime' | 'id' | 'text'
  total: number
  missing: number
  missingPct: number
  unique: number
  sample: string[]
  min?: number; max?: number; mean?: number; std?: number; outliers?: number
}

interface DataInspection {
  filename: string
  rowCount: number
  colCount: number
  duplicateRows: number
  columns: ColumnProfile[]
  suggestions: CleaningSuggestion[]
  rawColumns: string[]
  rawRows: string[][]
}

type SuggestionActionType =
  | 'drop_column' | 'drop_duplicates'
  | 'impute_median' | 'impute_mean' | 'impute_mode' | 'impute_unknown'
  | 'drop_missing_rows' | 'flag_outliers'

interface SuggestionAlternative {
  type: SuggestionActionType
  label: string
}

interface CleaningSuggestion {
  id: string
  type: SuggestionActionType      // recommended default action
  column?: string
  problem: string                 // what is wrong
  recommendation: string          // what we suggest and why
  severity: 'high' | 'medium' | 'low'
  autoFixable: boolean
  alternatives: SuggestionAlternative[]
}

const MISSING_VALUES = new Set(['', 'null', 'none', 'na', 'n/a', 'nan', 'undefined', '-', '--', '?'])

function isMissing(v: string) { return MISSING_VALUES.has(v.toLowerCase().trim()) }

function detectType(col: string, values: string[]): ColumnProfile['type'] {
  const nonNull = values.filter(v => !isMissing(v))
  if (nonNull.length === 0) return 'categorical'
  const isNumeric = nonNull.every(v => !isNaN(Number(v)) && v.trim() !== '')
  if (isNumeric) {
    // Likely an ID if all unique integers with no decimals
    const nums = nonNull.map(Number)
    if (nums.every(n => Number.isInteger(n)) && new Set(nonNull).size === nonNull.length && nonNull.length > 10) {
      const colLower = col.toLowerCase()
      if (colLower.includes('id') || colLower.includes('key') || colLower.includes('code')) return 'id'
    }
    return 'numeric'
  }
  const datePatterns = [/^\d{4}-\d{2}-\d{2}/, /^\d{2}\/\d{2}\/\d{4}/, /^\d{2}-\d{2}-\d{4}/]
  if (datePatterns.some(p => nonNull.slice(0, 5).every(v => p.test(v.trim())))) return 'datetime'
  const colLower = col.toLowerCase()
  if (colLower.includes('id') || colLower.includes('key') || colLower.includes('code')) return 'id'
  const uniqueRatio = new Set(nonNull).size / nonNull.length
  return uniqueRatio > 0.5 && nonNull[0]?.length > 20 ? 'text' : 'categorical'
}

function profileColumn(name: string, values: string[]): ColumnProfile {
  const total = values.length
  const missing = values.filter(isMissing).length
  const nonNull = values.filter(v => !isMissing(v))
  const unique = new Set(nonNull).size
  const type = detectType(name, values)
  const sample = [...new Set(nonNull)].slice(0, 4)

  let min, max, mean, std, outliers
  if (type === 'numeric') {
    const nums = nonNull.map(Number).filter(n => !isNaN(n))
    if (nums.length) {
      min = Math.min(...nums); max = Math.max(...nums)
      mean = nums.reduce((a, b) => a + b, 0) / nums.length
      const variance = nums.reduce((a, b) => a + (b - mean!) ** 2, 0) / nums.length
      std = Math.sqrt(variance)
      const q1 = nums.sort((a, b) => a - b)[Math.floor(nums.length * 0.25)]
      const q3 = nums[Math.floor(nums.length * 0.75)]
      const iqr = q3 - q1
      outliers = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length
    }
  }

  return { name, type, total, missing, missingPct: total ? missing / total : 0, unique, sample, min, max, mean, std, outliers }
}

function buildSuggestions(columns: ColumnProfile[], duplicateRows: number, totalRows: number): CleaningSuggestion[] {
  const suggestions: CleaningSuggestion[] = []

  if (duplicateRows > 0) {
    const pct = ((duplicateRows / totalRows) * 100).toFixed(1)
    suggestions.push({
      id: 'drop_duplicates',
      type: 'drop_duplicates',
      problem: `${duplicateRows} exact duplicate rows (${pct}% of data)`,
      recommendation: 'Remove duplicates to prevent the model from overfitting to repeated examples and producing biased metrics.',
      severity: duplicateRows / totalRows > 0.05 ? 'high' : 'medium',
      autoFixable: true,
      alternatives: [
        { type: 'drop_duplicates', label: 'Remove duplicates — keep first occurrence (recommended)' },
      ],
    })
  }

  for (const col of columns) {
    const missingPct = (col.missingPct * 100).toFixed(1)

    // Columns that are >50% empty — drop the whole column
    if (col.missingPct > 0.5) {
      suggestions.push({
        id: `drop_col_${col.name}`,
        type: 'drop_column',
        column: col.name,
        problem: `"${col.name}" is ${(col.missingPct * 100).toFixed(0)}% empty`,
        recommendation: `A column that is more than 50% missing provides almost no signal and can destabilise training. Dropping it is the safest choice.`,
        severity: 'high',
        autoFixable: true,
        alternatives: [
          { type: 'drop_column', label: 'Drop column (recommended — too sparse to be useful)' },
          { type: 'drop_missing_rows', label: 'Drop rows where this column is missing instead' },
        ],
      })
      continue
    }

    // ID / key columns — imputation makes no sense
    if (col.type === 'id' && col.missingPct > 0) {
      suggestions.push({
        id: `missing_id_${col.name}`,
        type: 'drop_missing_rows',
        column: col.name,
        problem: `"${col.name}" is an identifier column with ${missingPct}% missing values`,
        recommendation: `Imputing an ID or key column is meaningless — a synthetic ID creates false links between records. Rows without a valid "${col.name}" should be dropped or investigated at the source.`,
        severity: col.missingPct > 0.05 ? 'high' : 'medium',
        autoFixable: true,
        alternatives: [
          { type: 'drop_missing_rows', label: 'Drop rows with missing ID (recommended)' },
          { type: 'drop_column', label: 'Drop this ID column (if not used as a join key)' },
        ],
      })
      continue
    }

    // Numeric (non-ID) with significant missing values
    if (col.type === 'numeric' && col.missingPct > 0.05) {
      suggestions.push({
        id: `missing_${col.name}`,
        type: 'impute_median',
        column: col.name,
        problem: `"${col.name}" has ${missingPct}% missing numeric values`,
        recommendation: `Median imputation is robust to outliers and skewed distributions. If "${col.name}" is roughly symmetric, mean imputation is equally valid. If missingness itself is informative (e.g. "no purchase"), consider adding an is_missing flag instead.`,
        severity: col.missingPct > 0.2 ? 'high' : 'medium',
        autoFixable: true,
        alternatives: [
          { type: 'impute_median', label: 'Impute with median (recommended — robust to outliers)' },
          { type: 'impute_mean', label: 'Impute with mean (better for symmetric distributions)' },
          { type: 'drop_missing_rows', label: 'Drop rows with missing values' },
        ],
      })
    } else if (col.type === 'numeric' && col.missingPct > 0) {
      suggestions.push({
        id: `missing_${col.name}`,
        type: 'drop_missing_rows',
        column: col.name,
        problem: `"${col.name}" has ${col.missing} missing values (${missingPct}%)`,
        recommendation: `Only ${col.missing} rows are affected. Dropping them is the cleanest option and avoids introducing any bias.`,
        severity: 'low',
        autoFixable: true,
        alternatives: [
          { type: 'drop_missing_rows', label: 'Drop rows with missing values (recommended — few rows)' },
          { type: 'impute_median', label: 'Impute with median' },
          { type: 'impute_mean', label: 'Impute with mean' },
        ],
      })
    }

    // Categorical / text with missing values
    if ((col.type === 'categorical' || col.type === 'text') && col.missingPct > 0.05) {
      suggestions.push({
        id: `missing_${col.name}`,
        type: 'impute_mode',
        column: col.name,
        problem: `"${col.name}" has ${missingPct}% missing values`,
        recommendation: `Mode imputation (most frequent value) is the standard default. If missing values represent "none selected" or "not applicable", use "Unknown" instead — it avoids inflating the most common category artificially.`,
        severity: col.missingPct > 0.2 ? 'high' : 'medium',
        autoFixable: true,
        alternatives: [
          { type: 'impute_mode', label: 'Fill with most frequent value (mode)' },
          { type: 'impute_unknown', label: 'Fill with "Unknown" (when missing is meaningful)' },
          { type: 'drop_missing_rows', label: 'Drop rows with missing values' },
        ],
      })
    } else if ((col.type === 'categorical' || col.type === 'text') && col.missingPct > 0) {
      suggestions.push({
        id: `missing_${col.name}`,
        type: 'drop_missing_rows',
        column: col.name,
        problem: `"${col.name}" has ${col.missing} missing values (${missingPct}%)`,
        recommendation: `Only ${col.missing} rows are affected. Dropping is cleanest. Alternatively, fill with "Unknown" if you want to preserve all rows.`,
        severity: 'low',
        autoFixable: true,
        alternatives: [
          { type: 'drop_missing_rows', label: 'Drop rows with missing values (recommended)' },
          { type: 'impute_unknown', label: 'Fill with "Unknown"' },
        ],
      })
    }

    // Outliers (informational — not auto-fixable; skip ID/key/code columns)
    const colLowerOut = col.name.toLowerCase()
    const isIdLike = col.type === 'id' ||
      colLowerOut.includes('id') || colLowerOut.includes('key') ||
      colLowerOut.includes('code') || colLowerOut.includes('number') ||
      colLowerOut.includes('ref') || colLowerOut.includes('no.')
    if (col.type === 'numeric' && !isIdLike && col.outliers && col.outliers > 0) {
      const outPct = ((col.outliers / col.total) * 100).toFixed(1)
      suggestions.push({
        id: `outliers_${col.name}`,
        type: 'flag_outliers',
        column: col.name,
        problem: `"${col.name}" has ${col.outliers} outlier values (${outPct}% of rows, IQR method)`,
        recommendation: `Range: ${col.min?.toFixed(2)} – ${col.max?.toFixed(2)}, mean: ${col.mean?.toFixed(2)}, std: ${col.std?.toFixed(2)}. Review whether these are data errors (cap/remove) or genuine extremes (keep and use a robust algorithm like tree-based models).`,
        severity: Number(outPct) > 5 ? 'medium' : 'low',
        autoFixable: false,
        alternatives: [],
      })
    }
  }

  return suggestions
}

function inspectData(filename: string, columns: string[], rows: string[][]): DataInspection {
  const profiles = columns.map((col, i) => profileColumn(col, rows.map(r => r[i] ?? '')))

  // Detect duplicate rows
  const rowKeys = rows.map(r => r.join('\x00'))
  const seen = new Set<string>()
  let duplicateRows = 0
  for (const key of rowKeys) { if (seen.has(key)) duplicateRows++; else seen.add(key) }

  const suggestions = buildSuggestions(profiles, duplicateRows, rows.length)

  return { filename, rowCount: rows.length, colCount: columns.length, duplicateRows, columns: profiles, suggestions, rawColumns: columns, rawRows: rows }
}

function applyCleaning(
  inspection: DataInspection,
  // Map of suggestion.id → chosen action type (overrides suggestion.type)
  selectedActions: Record<string, SuggestionActionType> = {},
  // If provided, only apply these suggestion IDs (else apply all autoFixable)
  applyIds?: string[],
): { columns: string[]; rows: string[][]; log: string[] } {
  let { rawColumns: columns, rawRows: rows } = inspection
  const log: string[] = []

  const toApply = inspection.suggestions.filter(s =>
    s.autoFixable && (applyIds ? applyIds.includes(s.id) : true)
  )

  for (const s of toApply) {
    const actionType = selectedActions[s.id] ?? s.type

    if (actionType === 'drop_duplicates') {
      const before = rows.length
      const seen = new Set<string>()
      rows = rows.filter(r => { const k = r.join('\x00'); if (seen.has(k)) return false; seen.add(k); return true })
      log.push(`Removed ${before - rows.length} duplicate rows`)
    }

    if (actionType === 'drop_column' && s.column) {
      const idx = columns.indexOf(s.column)
      if (idx >= 0) {
        columns = columns.filter((_, i) => i !== idx)
        rows = rows.map(r => r.filter((_, i) => i !== idx))
        log.push(`Dropped column "${s.column}" (${(s.column)} was >50% missing or is an unused ID)`)
      }
    }

    if ((actionType === 'impute_median' || actionType === 'impute_mean') && s.column) {
      const idx = columns.indexOf(s.column)
      if (idx >= 0) {
        const vals = rows.map(r => r[idx]).filter(v => !isMissing(v))
        const nums = vals.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
        let fill: string
        if (actionType === 'impute_median') {
          fill = String(nums[Math.floor(nums.length / 2)] ?? 0)
        } else {
          fill = String(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
        }
        const filled = rows.filter(r => isMissing(r[idx])).length
        rows = rows.map(r => { if (isMissing(r[idx])) { const nr = [...r]; nr[idx] = fill; return nr } return r })
        log.push(`Imputed ${filled} missing values in "${s.column}" with ${actionType === 'impute_median' ? 'median' : 'mean'} (${Number(fill).toFixed(4)})`)
      }
    }

    if (actionType === 'impute_mode' && s.column) {
      const idx = columns.indexOf(s.column)
      if (idx >= 0) {
        const vals = rows.map(r => r[idx]).filter(v => !isMissing(v))
        const freq: Record<string, number> = {}
        vals.forEach(v => { freq[v] = (freq[v] ?? 0) + 1 })
        const fill = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
        const filled = rows.filter(r => isMissing(r[idx])).length
        rows = rows.map(r => { if (isMissing(r[idx])) { const nr = [...r]; nr[idx] = fill; return nr } return r })
        log.push(`Imputed ${filled} missing values in "${s.column}" with mode ("${fill}")`)
      }
    }

    if (actionType === 'impute_unknown' && s.column) {
      const idx = columns.indexOf(s.column)
      if (idx >= 0) {
        const filled = rows.filter(r => isMissing(r[idx])).length
        rows = rows.map(r => { if (isMissing(r[idx])) { const nr = [...r]; nr[idx] = 'Unknown'; return nr } return r })
        log.push(`Filled ${filled} missing values in "${s.column}" with "Unknown"`)
      }
    }

    if (actionType === 'drop_missing_rows' && s.column) {
      const idx = columns.indexOf(s.column)
      if (idx >= 0) {
        const before = rows.length
        rows = rows.filter(r => !isMissing(r[idx]))
        log.push(`Dropped ${before - rows.length} rows where "${s.column}" was missing`)
      }
    }
  }

  return { columns, rows, log }
}

function downloadCsv(columns: string[], rows: string[][], filename: string) {
  const escape = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
  const content = [columns, ...rows].map(r => r.map(escape).join(',')).join('\n')
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── DataInspectionCard component ──────────────────────────────────────────────

function DataInspectionCard({
  inspection,
  onApplyAndContinue,
  onSkip,
}: {
  inspection: DataInspection
  onApplyAndContinue: (cleaned: { columns: string[]; rows: string[][] }, log: string[]) => void
  onSkip: () => void
}) {
  const [colsExpanded, setColsExpanded] = useState(false)
  // Per-suggestion: which alternative action is selected
  const [selectedActions, setSelectedActions] = useState<Record<string, SuggestionActionType>>({})
  // IDs of suggestions already individually applied
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  // Working copy of data (updated as user applies individual fixes)
  const [workingData, setWorkingData] = useState<{ columns: string[]; rows: string[][] }>({
    columns: inspection.rawColumns,
    rows: inspection.rawRows,
  })
  const [workingLog, setWorkingLog] = useState<string[]>([])

  const high    = inspection.suggestions.filter(s => s.severity === 'high').length
  const fixable = inspection.suggestions.filter(s => s.autoFixable)
  const pending = fixable.filter(s => !appliedIds.has(s.id))

  const severityBorder = (s: CleaningSuggestion['severity']) =>
    s === 'high' ? 'border-red-800/50 bg-red-950/20' :
    s === 'medium' ? 'border-amber-800/50 bg-amber-950/10' :
    'border-gray-700/50 bg-gray-800/20'

  const severityIcon = (s: CleaningSuggestion['severity']) =>
    s === 'high' ? '⛔' : s === 'medium' ? '⚠️' : 'ℹ️'

  const typeIcon = (t: ColumnProfile['type']) =>
    t === 'numeric' ? '#' : t === 'datetime' ? '📅' : t === 'id' ? '🔑' : t === 'text' ? '📝' : '🏷'

  const applyOne = (s: CleaningSuggestion) => {
    // Build a temporary inspection from current working data so we apply on top of prior fixes
    const tmpInspection: DataInspection = { ...inspection, rawColumns: workingData.columns, rawRows: workingData.rows }
    const result = applyCleaning(tmpInspection, selectedActions, [s.id])
    setWorkingData({ columns: result.columns, rows: result.rows })
    setWorkingLog(prev => [...prev, ...result.log])
    setAppliedIds(prev => new Set([...prev, s.id]))
  }

  const applyAll = () => {
    const tmpInspection: DataInspection = { ...inspection, rawColumns: workingData.columns, rawRows: workingData.rows }
    const remainingIds = pending.map(s => s.id)
    const result = applyCleaning(tmpInspection, selectedActions, remainingIds)
    const finalLog = [...workingLog, ...result.log]
    onApplyAndContinue({ columns: result.columns, rows: result.rows }, finalLog)
  }

  const continueWithCurrent = () => {
    onApplyAndContinue({ columns: workingData.columns, rows: workingData.rows }, workingLog)
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden text-xs w-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <Database size={13} className="text-emerald-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{inspection.filename}</p>
          <p className="text-gray-500 text-[10px]">{inspection.rowCount.toLocaleString()} rows · {inspection.colCount} columns</p>
        </div>
        {inspection.duplicateRows > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] text-amber-400 bg-amber-900/20 border border-amber-800/40 flex-shrink-0">
            {inspection.duplicateRows} dupes
          </span>
        )}
        {high > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 flex-shrink-0">{high} critical</span>}
      </div>

      {/* Column table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="px-3 py-2 text-left text-gray-500 font-medium">Column</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">Type</th>
              <th className="px-3 py-2 text-right text-gray-500 font-medium">Missing</th>
              <th className="px-3 py-2 text-right text-gray-500 font-medium">Unique</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium hidden sm:table-cell">Sample</th>
            </tr>
          </thead>
          <tbody>
            {(colsExpanded ? inspection.columns : inspection.columns.slice(0, 8)).map(col => (
              <tr key={col.name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-3 py-1.5 font-mono text-gray-200 max-w-[120px] truncate">{col.name}</td>
                <td className="px-3 py-1.5 text-gray-500">
                  <span className="mr-1">{typeIcon(col.type)}</span>{col.type}
                </td>
                <td className={clsx('px-3 py-1.5 text-right font-mono',
                  col.missingPct > 0.2 ? 'text-red-400' : col.missingPct > 0 ? 'text-amber-400' : 'text-gray-600')}>
                  {col.missingPct > 0 ? `${(col.missingPct * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{col.unique.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-gray-500 hidden sm:table-cell max-w-[160px] truncate">
                  {col.sample.slice(0, 3).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {inspection.columns.length > 8 && (
          <button onClick={() => setColsExpanded(e => !e)} className="w-full py-1.5 text-[10px] text-gray-600 hover:text-gray-400 transition-colors border-t border-gray-800">
            {colsExpanded ? 'Show less ↑' : `Show ${inspection.columns.length - 8} more columns ↓`}
          </button>
        )}
      </div>

      {/* Per-suggestion cards */}
      {inspection.suggestions.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-3 space-y-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Data Quality Issues — {inspection.suggestions.length} found
          </p>
          {inspection.suggestions.map(s => {
            const isApplied = appliedIds.has(s.id)
            const chosenType = selectedActions[s.id] ?? s.type
            return (
              <div key={s.id} className={clsx('rounded-xl border overflow-hidden', severityBorder(s.severity), isApplied && 'opacity-60')}>
                {/* Problem row */}
                <div className="px-3 py-2 flex items-start gap-2">
                  <span className="flex-shrink-0 text-[11px] mt-px">{severityIcon(s.severity)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-200 leading-snug">{s.problem}</p>
                    <p className="text-gray-500 mt-0.5 leading-relaxed">{s.recommendation}</p>
                  </div>
                  {isApplied && (
                    <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-900/20 border border-emerald-700/40 rounded-full px-2 py-0.5">
                      <CheckCircle2 size={9} /> Applied
                    </span>
                  )}
                </div>

                {/* Alternative actions */}
                {s.autoFixable && !isApplied && s.alternatives.length > 1 && (
                  <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                    {s.alternatives.map(alt => (
                      <button
                        key={alt.type}
                        onClick={() => setSelectedActions(prev => ({ ...prev, [s.id]: alt.type }))}
                        className={clsx(
                          'px-2.5 py-1 text-[10px] rounded-full border transition-colors leading-tight',
                          chosenType === alt.type
                            ? 'bg-violet-800/50 border-violet-600/60 text-violet-200'
                            : 'bg-gray-800/60 border-gray-700/60 text-gray-400 hover:border-gray-500 hover:text-gray-200',
                        )}
                      >
                        {alt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Apply this fix */}
                {s.autoFixable && !isApplied && (
                  <div className="px-3 pb-2.5">
                    <button
                      onClick={() => applyOne(s)}
                      className="px-3 py-1 text-[11px] font-medium bg-emerald-800/50 hover:bg-emerald-700/60 border border-emerald-700/50 text-emerald-300 rounded-lg transition-colors"
                    >
                      ✓ Apply this fix
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Applied log */}
      {workingLog.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-2 space-y-0.5">
          {workingLog.map((l, i) => (
            <p key={i} className="text-[10px] text-emerald-500">✓ {l}</p>
          ))}
        </div>
      )}

      {/* Bottom actions */}
      <div className="border-t border-gray-800 px-4 py-3 flex items-center gap-2 flex-wrap">
        {inspection.suggestions.length === 0 ? (
          <>
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={11} /> Data looks clean
            </span>
            <button
              onClick={onSkip}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white rounded-lg transition-colors"
            >
              Continue to model design →
            </button>
          </>
        ) : (
          <>
            {pending.length > 0 && (
              <button
                onClick={applyAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition-colors"
              >
                ✓ Apply all {pending.length} remaining fix{pending.length > 1 ? 'es' : ''} &amp; continue
              </button>
            )}
            {appliedIds.size > 0 && pending.length === 0 && (
              <button
                onClick={continueWithCurrent}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition-colors"
              >
                <CheckCircle2 size={11} /> Continue with cleaned data
              </button>
            )}
            {appliedIds.size > 0 && pending.length > 0 && (
              <button
                onClick={continueWithCurrent}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
              >
                Continue with {appliedIds.size} fix{appliedIds.size > 1 ? 'es' : ''} applied
              </button>
            )}
            <button
              onClick={() => { downloadCsv(inspection.rawColumns, inspection.rawRows, `original_${inspection.filename}`) }}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
            >
              ↓ Raw CSV
            </button>
            <button onClick={onSkip} className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Skip cleaning →
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── AI Workshop ───────────────────────────────────────────────────────────────

const DS_TYPES = [
  { value: 'dataset',     label: 'MLDock Dataset',        hint: 'Auto-creates a dataset with upload fields' },
  { value: 'upload',      label: 'File Upload (per run)', hint: 'User uploads a file each time they run' },
  { value: 's3',          label: 'S3 / MinIO',            hint: 'Read from a bucket path' },
  { value: 'url',         label: 'HTTP URL',              hint: 'Download from a public URL' },
  { value: 'mongodb',     label: 'MongoDB',               hint: 'Query a collection' },
  { value: 'huggingface', label: 'Hugging Face Hub',      hint: 'HF Hub dataset' },
  { value: 'memory',      label: 'In-Memory / Built-in',  hint: 'Fetch or generate data inside preprocess()' },
]
const FW_TYPES = [
  { value: 'auto',       label: 'Auto (AI decides)' },
  { value: 'sklearn',    label: 'scikit-learn' },
  { value: 'pytorch',    label: 'PyTorch' },
  { value: 'tensorflow', label: 'TensorFlow / Keras' },
  { value: 'custom',     label: 'Custom / Other' },
]

interface AttachedFile {
  name: string
  size: number
  mime: string
  localUrl?: string   // object URL for image preview (freed on unmount)
}

interface AiChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  code?: string | null
  filename?: string | null
  suggestions?: string[]
  csvPreview?: { columns: string[]; rows: string[][] }
  dataInspection?: DataInspection
  attachedFile?: AttachedFile
  debug?: { tokens: { input: number; output: number; total: number }; cost_usd: number; model: string }
}

interface AiSession {
  prompt: string
  dsType: string
  framework: string
  className: string
  csvSchema: { columns: string[]; sample_rows: string[][] } | null
  existingCode?: string   // pre-loaded code for "refine existing trainer"
  existingFilename?: string
  datasetId?: string
  datasetSlug?: string
  datasetOriginalFieldId?: string
  datasetCleanFieldId?: string
  datasetCodeFieldId?: string
  initialUserMessage?: string  // auto-sent as first message (used by "Fix with AI")
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

function ChatBubble({
  msg, onSuggestion, onInspectionApply, onInspectionSkip, showCostDebug = false,
}: {
  msg: AiChatMsg
  onSuggestion: (text: string) => void
  onInspectionApply?: (inspection: DataInspection, cleaned: { columns: string[]; rows: string[][] }, log: string[]) => void
  onInspectionSkip?: (inspection: DataInspection) => void
  showCostDebug?: boolean
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('flex items-start gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-violet-900/60 border border-violet-700/40 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles size={10} className="text-violet-400" />
        </div>
      )}

      <div className={clsx('flex flex-col gap-2', isUser ? 'items-end' : 'items-start', 'max-w-[92%]')}>
        {/* Data inspection card */}
        {msg.dataInspection && (
          <DataInspectionCard
            inspection={msg.dataInspection}
            onApplyAndContinue={(cleaned, log) => onInspectionApply?.(msg.dataInspection!, cleaned, log)}
            onSkip={() => onInspectionSkip?.(msg.dataInspection!)}
          />
        )}

        {/* CSV preview card */}
        {msg.csvPreview && (
          <div className="bg-gray-800/80 border border-gray-700 rounded-xl p-3 text-xs w-full max-w-sm">
            <div className="flex items-center gap-1.5 mb-2 text-emerald-400">
              <Database size={10} />
              <span className="font-medium text-[10px] uppercase tracking-wide">CSV Preview</span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-[10px] border-collapse">
                <thead>
                  <tr>
                    {msg.csvPreview.columns.slice(0, 6).map(col => (
                      <th key={col} className="px-2 py-1 text-left text-gray-400 border border-gray-700 bg-gray-900 font-medium whitespace-nowrap">{col}</th>
                    ))}
                    {msg.csvPreview.columns.length > 6 && (
                      <th className="px-2 py-1 text-gray-600 border border-gray-700 bg-gray-900">+{msg.csvPreview.columns.length - 6}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {msg.csvPreview.rows.slice(0, 3).map((row, i) => (
                    <tr key={i}>
                      {row.slice(0, 6).map((cell, j) => (
                        <td key={j} className="px-2 py-1 text-gray-300 border border-gray-700 max-w-[80px] truncate">{cell}</td>
                      ))}
                      {row.length > 6 && <td className="px-2 py-1 text-gray-600 border border-gray-700">…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">{msg.csvPreview.columns.length} columns · {msg.csvPreview.rows.length}+ rows detected</p>
          </div>
        )}

        {/* Attached file card */}
        {msg.attachedFile && (
          <div className="flex items-center gap-2.5 bg-gray-800/80 border border-gray-700 rounded-xl px-3 py-2 max-w-xs">
            {msg.attachedFile.mime.startsWith('image/') && msg.attachedFile.localUrl ? (
              <img
                src={msg.attachedFile.localUrl}
                alt={msg.attachedFile.name}
                className="w-14 h-14 object-cover rounded-lg flex-shrink-0 border border-gray-700"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
                <FileCode size={16} className="text-gray-400" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-200 truncate font-medium">{msg.attachedFile.name}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {msg.attachedFile.mime || 'file'} · {(msg.attachedFile.size / 1024).toFixed(0)} KB
              </p>
              <p className="text-[10px] text-emerald-500 mt-0.5">✓ saved to dataset</p>
            </div>
          </div>
        )}

        {/* Message bubble */}
        {msg.content && (
          <div className={clsx(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words',
            isUser
              ? 'bg-violet-800/50 text-violet-100 rounded-tr-sm border border-violet-700/30'
              : 'bg-gray-800/80 text-gray-200 rounded-tl-sm border border-gray-700/50',
          )}>
            {msg.content}
          </div>
        )}

        {/* Code generated badge */}
        {msg.code && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 border border-emerald-700/40 rounded-lg text-[11px] text-emerald-400">
            <CheckCircle2 size={11} />
            Code ready — <span className="font-mono">{msg.filename}</span>
          </div>
        )}

        {/* Suggestion chips */}
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {msg.suggestions.map(s => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="px-2.5 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-500/60 text-gray-400 hover:text-violet-300 rounded-full transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Token / cost debug badge */}
        {showCostDebug && msg.debug && msg.role === 'assistant' && (
          <div className="flex items-center gap-2 mt-1.5 px-2 py-1 bg-gray-900/60 border border-gray-700/50 rounded-lg w-fit">
            <span className="text-[10px] text-gray-500 font-mono">
              ↑{msg.debug.tokens.input.toLocaleString()} ↓{msg.debug.tokens.output.toLocaleString()} tok
            </span>
            <span className="text-gray-700">·</span>
            <span className="text-[10px] text-gray-500 font-mono">${msg.debug.cost_usd.toFixed(5)}</span>
            <span className="text-gray-700">·</span>
            <span className="text-[10px] text-gray-600">{msg.debug.model}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Trainer overview (right panel "Plan" tab) ─────────────────────────────────

function TrainerOverview({ code, session }: { code: string; session: AiSession }) {
  if (!code) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-gray-600 p-8">
        <BarChart2 size={28} className="opacity-20" />
        <div>
          <p className="text-sm text-gray-500">No code yet</p>
          <p className="text-xs mt-1">Generate the trainer to see a structured overview</p>
        </div>
      </div>
    )
  }

  const nameMatch      = code.match(/name\s*=\s*["']([^"']+)["']/)
  const versionMatch   = code.match(/version\s*=\s*["']([^"']+)["']/)
  const descMatch      = code.match(/description\s*=\s*["']([^"']+)["']/)
  const frameworkMatch = code.match(/framework\s*=\s*["']([^"']+)["']/)
  const categoryMatch  = code.match(/category\s*=\s*\{[^}]*"key"\s*:\s*["']([^"']+)["']/)
  const inputMatch     = code.match(/input_schema\s*=\s*(\{[\s\S]*?\n\s*\})/)
  const outputMatch    = code.match(/output_schema\s*=\s*(\{[\s\S]*?\n\s*\})/)

  return (
    <div className="space-y-3 p-4">
      {/* Identity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {nameMatch && (
            <code className="text-violet-300 text-xs font-mono bg-violet-900/20 px-2 py-0.5 rounded">{nameMatch[1]}</code>
          )}
          {versionMatch && <span className="text-[10px] text-gray-600">v{versionMatch[1]}</span>}
          {frameworkMatch && (
            <span className="px-2 py-0.5 text-[10px] bg-sky-900/30 text-sky-400 border border-sky-800/30 rounded-full">{frameworkMatch[1]}</span>
          )}
          {categoryMatch && (
            <span className="px-2 py-0.5 text-[10px] bg-gray-800 text-gray-500 rounded-full">{categoryMatch[1]}</span>
          )}
        </div>
        {descMatch && <p className="text-xs text-gray-400 leading-relaxed">{descMatch[1]}</p>}
      </div>

      {/* Data source */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Data Source</div>
        <div className="text-xs text-gray-300">{DS_TYPES.find(t => t.value === session.dsType)?.label ?? session.dsType}</div>
        {session.csvSchema && (
          <div>
            <p className="text-[10px] text-gray-500 mb-1.5">CSV columns ({session.csvSchema.columns.length}):</p>
            <div className="flex flex-wrap gap-1">
              {session.csvSchema.columns.slice(0, 16).map(col => (
                <span key={col} className="px-1.5 py-0.5 text-[10px] bg-gray-800 text-gray-400 rounded font-mono">{col}</span>
              ))}
              {session.csvSchema.columns.length > 16 && (
                <span className="text-[10px] text-gray-600">+{session.csvSchema.columns.length - 16} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Schemas */}
      {inputMatch && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1.5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Input Schema</div>
          <pre className="text-[10px] text-gray-400 overflow-x-auto leading-relaxed">{inputMatch[1]}</pre>
        </div>
      )}
      {outputMatch && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1.5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Output Schema + Derived Metrics</div>
          <pre className="text-[10px] text-gray-400 overflow-x-auto leading-relaxed">{outputMatch[1]}</pre>
        </div>
      )}
    </div>
  )
}

// ── AI Workshop (full-page mode) ──────────────────────────────────────────────

function AiWorkshop({
  session: initialSession,
  datasets,
  onBack,
  onUseCode,
  savedSessions = [],
  onSaveSession,
  onRestoreSession,
  onDeleteSession,
  restoreSession,
  showCostDebug = false,
}: {
  session: AiSession
  datasets: EditorDataset[]
  onBack: () => void
  onUseCode: (code: string, filename: string, sessionSnapshot: SavedAiSession) => void
  savedSessions?: SavedAiSession[]
  onSaveSession?: (s: SavedAiSession) => void
  onRestoreSession?: (s: SavedAiSession | undefined) => void
  onDeleteSession?: (id: string) => void
  restoreSession?: SavedAiSession
  showCostDebug?: boolean
}) {
  const [session, setSession] = useState<AiSession>(restoreSession?.session ?? initialSession)
  const [messages, setMessages] = useState<AiChatMsg[]>(restoreSession?.messages ?? [])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activePanel, setActivePanel] = useState<'code' | 'plan'>('code')
  const [generatedCode, setGeneratedCode] = useState(restoreSession?.generatedCode ?? initialSession.existingCode ?? '')
  const [generatedFilename, setGeneratedFilename] = useState(restoreSession?.generatedFilename ?? initialSession.existingFilename ?? 'ai_trainer.py')
  const [currentSessionId] = useState(() => restoreSession?.id ?? crypto.randomUUID())
  const [setupDone, setSetupDone] = useState(!!(restoreSession || initialSession.existingCode))

  const chatBottomRef = useRef<HTMLDivElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Auto-save session whenever messages or code change so history persists
  useEffect(() => {
    if (messages.length === 0) return
    const snap: SavedAiSession = {
      id: currentSessionId,
      title: messages.find(m => m.role === 'user')?.content.slice(0, 60) ?? 'Session',
      messages,
      session,
      generatedCode,
      generatedFilename,
      savedAt: Date.now(),
    }
    onSaveSession?.(snap)
  }, [messages, generatedCode]) // eslint-disable-line

  // Auto-send initial message (e.g. error from "Fix with AI")
  const autoSentRef = useRef(false)
  useEffect(() => {
    if (!autoSentRef.current && setupDone && initialSession.initialUserMessage && messages.length === 0) {
      autoSentRef.current = true
      // Small delay so the component is fully rendered before the API call
      setTimeout(() => sendMessage(initialSession.initialUserMessage!), 100)
    }
  }, [setupDone]) // eslint-disable-line

  const sendMessage = async (text: string, sessionOverride?: AiSession, generateNow = false) => {
    const activeSession = sessionOverride ?? session
    if (!text.trim() && !generateNow) return
    if (sending) return

    const userMsg: AiChatMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
    }
    const newMessages = text.trim() ? [...messages, userMsg] : messages
    if (text.trim()) setMessages(newMessages)
    setInput('')
    setSending(true)

    try {
      // When refining existing code, prepend the code as context in the first user message
      let history = newMessages.map(m => ({ role: m.role, content: m.content }))
      if (activeSession.existingCode && history.filter(m => m.role === 'user').length === 1) {
        const codeCtx = `Here is my existing trainer code:\n\`\`\`python\n${activeSession.existingCode}\n\`\`\`\n\n`
        history = history.map((m, i) => (i === history.findIndex(x => x.role === 'user') ? { ...m, content: codeCtx + m.content } : m))
      }
      // Always provide a dataset slug so the backend injects the correct field-label
      // constraint even when no CSV has been uploaded yet in this session.
      // Fall back to the most recent saved session's slug if the current one is absent.
      const effectiveSlug = activeSession.datasetSlug
        ?? savedSessions?.find(s => s.session?.datasetSlug)?.session?.datasetSlug
        ?? null
      const effectiveDatasetId = activeSession.datasetId
        ?? savedSessions?.find(s => s.session?.datasetId)?.session?.datasetId
        ?? null

      const result = await editorApi.aiChat({
        messages: history,
        data_source_type: activeSession.dsType,
        framework: activeSession.framework,
        class_name: activeSession.className || undefined,
        csv_schema: activeSession.csvSchema,
        available_datasets: datasets.map(d => ({ id: d.id, name: d.name, fields: d.fields })),
        generate_now: generateNow,
        uploaded_dataset_slug: effectiveSlug,
        uploaded_dataset_id: effectiveDatasetId,
      })

      const aiMsg: AiChatMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message,
        code: result.code,
        filename: result.filename,
        suggestions: result.suggestions,
        debug: result.debug,
      }
      setMessages(prev => [...prev, aiMsg])

      if (result.code) {
        setGeneratedCode(result.code)
        setGeneratedFilename(result.filename ?? 'ai_trainer.py')
        setActivePanel('code')

        // Upload generated trainer code as a .py file to the Cleaning Code field (best-effort)
        const snap = session  // capture current session state
        if (snap.datasetId && snap.datasetCodeFieldId) {
          const fname = (result.filename ?? 'ai_trainer.py').replace(/\.py$/i, '') + '.py'
          const pyFile = new File([result.code], fname, { type: 'text/x-python' })
          editorApi.uploadDatasetField(snap.datasetId, snap.datasetCodeFieldId, pyFile).catch(() => {})
        }
      }
    } catch (e: any) {
      const status = e?.response?.status
      const detail = e?.response?.data?.detail ?? ''
      const isConfig = status === 503 || detail.toLowerCase().includes('not configured')
      const isBalance = status === 402
      const errMsg: AiChatMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: isConfig
          ? `⚠ AI is not configured yet.\n\nAsk your admin to set these environment variables on the backend:\n  LLM_PROVIDER=openai | ollama | openai_compatible\n  LLM_API_KEY=...\n  LLM_MODEL=...\n  LLM_BASE_URL=...  (required for ollama / openai_compatible)\n\nYou can still write trainers manually — go back to Files and create a new file.`
          : isBalance
          ? `⚠ ${detail}\n\nAI features are billed per token. Top up your wallet to continue.`
          : `⚠ ${detail || 'Failed to reach AI. Try again or check the connection.'}`,
        suggestions: isConfig ? ['Back to Files'] : isBalance ? ['Top up wallet', 'Back to Files'] : ['Try again', 'Generate Now'],
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }

  // When refining existing code — greet user with the file already loaded
  useEffect(() => {
    if (initialSession.existingCode && messages.length === 0) {
      const name = initialSession.existingFilename ?? 'trainer'
      const intro = `I've loaded your existing trainer **${name}**. What would you like to improve?\n\nFor example: refine the algorithm, add new output fields, change the data source, improve preprocessing, or add derived metrics.`
      setMessages([{
        id: crypto.randomUUID(),
        role: 'assistant',
        content: intro,
        suggestions: ['Improve the algorithm', 'Add derived metrics', 'Change data source', 'Add more output fields'],
      }])
    }
  }, []) // eslint-disable-line

  const handleStartWorkshop = () => {
    if (!session.prompt.trim()) return
    setSetupDone(true)
    sendMessage(session.prompt, session)
  }

  // ── ensure the session dataset exists, returns { datasetId, originalFieldId }
  const ensureSessionDataset = async (): Promise<{ datasetId: string; originalFieldId: string; cleanFieldId: string; codeFieldId: string } | null> => {
    const snap = session
    if (snap.datasetId && snap.datasetOriginalFieldId) {
      return { datasetId: snap.datasetId, originalFieldId: snap.datasetOriginalFieldId, cleanFieldId: snap.datasetCleanFieldId ?? '', codeFieldId: snap.datasetCodeFieldId ?? '' }
    }
    // Create with a minimal placeholder CSV (header only) to get the field IDs
    const placeholderB64 = btoa(Array.from(new TextEncoder().encode('file\n'), b => String.fromCharCode(b)).join(''))
    const dsResult = await editorApi.createDatasetFromCsv({
      name: 'AI Workshop Dataset',
      description: 'Auto-created from AI Workshop session',
      filename: 'placeholder.csv',
      csv_b64: placeholderB64,
      content_type: 'text/csv',
      session_id: currentSessionId,
    })
    setSession(prev => ({
      ...prev,
      dsType: 'dataset',
      datasetId: dsResult.dataset_id,
      datasetSlug: dsResult.dataset_slug,
      datasetOriginalFieldId: dsResult.original_field_id,
      datasetCleanFieldId: dsResult.clean_field_id,
      datasetCodeFieldId: dsResult.code_field_id,
    }))
    return { datasetId: dsResult.dataset_id, originalFieldId: dsResult.original_field_id, cleanFieldId: dsResult.clean_field_id, codeFieldId: dsResult.code_field_id }
  }

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const isCsvOrExcel = ['csv', 'xlsx', 'xls'].includes(ext)

    // ── Non-CSV/Excel: upload as dataset entry directly ──────────────────────
    if (!isCsvOrExcel) {
      const isImage = file.type.startsWith('image/')
      const localUrl = isImage ? URL.createObjectURL(file) : undefined

      const userMsgId = crypto.randomUUID()
      const userMsg: AiChatMsg = {
        id: userMsgId,
        role: 'user',
        content: '',
        attachedFile: { name: file.name, size: file.size, mime: file.type || ext, localUrl },
      }
      const uploadingId = crypto.randomUUID()
      const uploadingMsg: AiChatMsg = {
        id: uploadingId,
        role: 'assistant',
        content: `Uploading "${file.name}" to the session dataset…`,
      }
      setMessages(prev => [...prev, userMsg, uploadingMsg])

      try {
        const ds = await ensureSessionDataset()
        if (ds) {
          await editorApi.uploadDatasetField(ds.datasetId, ds.originalFieldId, file)
        }
        const ackMsg: AiChatMsg = {
          id: uploadingId,
          role: 'assistant',
          content: `File **${file.name}** (${file.type || ext}, ${(file.size / 1024).toFixed(0)} KB) has been saved to the session dataset.\n\nThe trainer's \`preprocess(raw)\` can access it via the \`file_url\` entry where \`field_label == "Original Upload"\`. What would you like to do with this file?`,
          suggestions: isImage ? ['Use as training image', 'Describe image classification task', 'What format does the model expect?'] : ['Describe how to use this file', 'Show me how to load this in the trainer'],
        }
        setMessages(prev => prev.map(m => m.id === uploadingId ? ackMsg : m))
      } catch (err: any) {
        setMessages(prev => prev.map(m => m.id === uploadingId ? {
          ...m,
          content: `Failed to upload "${file.name}": ${err?.message ?? 'unknown error'}. You can describe the file in text and I'll help design the model.`,
        } : m))
      }
      return
    }

    // ── CSV / Excel → existing inspection flow ────────────────────────────────
    const fileMB = (file.size / 1024 / 1024).toFixed(2)

    // User upload message + immediate "received" acknowledgement
    const uploadMsg: AiChatMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `📎 ${file.name} · ${fileMB} MB`,
    }
    const analyzingId = crypto.randomUUID()
    const analyzingMsg: AiChatMsg = {
      id: analyzingId,
      role: 'assistant',
      content: `Got it — received "${file.name}" (${fileMB} MB). Sampling and inspecting your data now…`,
    }
    setMessages(prev => [...prev, uploadMsg, analyzingMsg])

    // Yield to the browser so the "analyzing" message renders before we block
    await new Promise(resolve => setTimeout(resolve, 0))

    try {
      let columns: string[] = []
      let rows: string[][] = []
      let sampledRows = 0    // 0 = no sampling needed
      const MAX_SAMPLE_ROWS = 2000
      const MAX_CSV_BYTES   = 4 * 1024 * 1024  // 4 MB slice cap for huge CSVs

      if (ext === 'csv') {
        // For very large CSVs, read only the first MAX_CSV_BYTES to avoid loading GBs
        const blob = file.size > MAX_CSV_BYTES ? file.slice(0, MAX_CSV_BYTES) : file
        const text = await blob.text()
        const lines = text.split(/\r?\n/).filter(Boolean)
        if (lines.length < 2) throw new Error('File appears empty or has no data rows')
        columns = lines[0].split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'))
        const allDataLines = lines.slice(1).filter(Boolean)
        if (allDataLines.length > MAX_SAMPLE_ROWS) sampledRows = allDataLines.length
        rows = allDataLines.slice(0, MAX_SAMPLE_ROWS).map(l =>
          l.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'))
        )
      } else {
        // Excel: sheetRows limits how many rows the parser reads — prevents stack overflow
        // on large workbooks without needing to stream.
        const XLSX = await import('xlsx')
        const buffer = await file.arrayBuffer()
        const wb = XLSX.read(buffer, {
          type: 'array',
          sheetRows: MAX_SAMPLE_ROWS + 1,   // header + data rows only
          cellText: false,
          cellDates: false,
        })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]
        if (data.length < 2) throw new Error('Spreadsheet appears empty or has no data rows')
        columns = (data[0] ?? []).map(v => String(v))
        const dataRows = data.slice(1)
        // If we hit the cap there are likely more rows in the original file
        if (dataRows.length >= MAX_SAMPLE_ROWS) sampledRows = MAX_SAMPLE_ROWS
        rows = dataRows.map(row =>
          columns.map((_, i) => String((row as unknown[])[i] ?? ''))
        )
      }

      const inspection = inspectData(file.name, columns, rows)
      // Annotate if we sampled
      if (sampledRows) {
        inspection.filename = `${file.name} (sampled: first ${rows.length.toLocaleString()} rows)`
      }

      setSession(prev => ({ ...prev, csvSchema: { columns, sample_rows: rows.slice(0, 5) } }))

      // Replace the "analyzing" placeholder with the inspection card
      const inspMsg: AiChatMsg = {
        id: analyzingId,   // reuse same ID so the bubble replaces in-place
        role: 'assistant',
        content: sampledRows
          ? `Large dataset detected — sampled the first ${rows.length.toLocaleString()} rows for inspection. Statistical profiles below represent this sample.`
          : '',
        dataInspection: inspection,
      }
      setMessages(prev => prev.map(m => m.id === analyzingId ? inspMsg : m))

      // Sync upload to the session's dataset (get-or-create by session_id slug)
      try {
        const csvLines = [columns, ...rows.slice(0, 5000)].map(r =>
          r.map(v => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v)).join(',')
        )
        const csvText = csvLines.join('\n')
        // btoa only handles Latin-1; encode to UTF-8 bytes first
        const b64 = btoa(
          Array.from(new TextEncoder().encode(csvText), b => String.fromCharCode(b)).join('')
        )

        // If we already have a dataset for this session, upload directly to it
        const currentSession = session  // capture before async setState
        const csvFilename = file.name.replace(/\.xlsx?$/i, '.csv')

        let datasetId = currentSession.datasetId
        let originalFieldId = currentSession.datasetOriginalFieldId
        let cleanFieldId = currentSession.datasetCleanFieldId
        let codeFieldId = currentSession.datasetCodeFieldId

        if (datasetId && originalFieldId) {
          const csvBlob = new Blob([csvText], { type: 'text/csv' })
          const csvFile = new File([csvBlob], csvFilename, { type: 'text/csv' })
          await editorApi.uploadDatasetField(datasetId, originalFieldId, csvFile)
        } else {
          // First upload in this session — create dataset keyed to session ID
          const dsName = file.name.replace(/\.(csv|xlsx|xls)$/i, '').replace(/[_\-]/g, ' ')
          const dsResult = await editorApi.createDatasetFromCsv({
            name: dsName || 'AI Workshop Dataset',
            description: `Auto-created from AI Workshop upload (${rows.length.toLocaleString()} rows × ${columns.length} columns)`,
            filename: csvFilename,
            csv_b64: b64,
            content_type: 'text/csv',
            session_id: currentSessionId,
          })
          datasetId = dsResult.dataset_id
          originalFieldId = dsResult.original_field_id
          cleanFieldId = dsResult.clean_field_id
          codeFieldId = dsResult.code_field_id
          setSession(prev => ({
            ...prev,
            dsType: 'dataset',
            datasetId,
            datasetSlug: dsResult.dataset_slug,
            datasetOriginalFieldId: originalFieldId,
            datasetCleanFieldId: cleanFieldId,
            datasetCodeFieldId: codeFieldId,
          }))
        }

        // Seed "Clean Copy" with the same file so all 3 fields are populated from the start.
        // It will be overwritten with the cleaned version if the user applies the inspection card.
        if (datasetId && cleanFieldId) {
          const csvBlob2 = new Blob([csvText], { type: 'text/csv' })
          const csvFile2 = new File([csvBlob2], csvFilename, { type: 'text/csv' })
          editorApi.uploadDatasetField(datasetId, cleanFieldId, csvFile2).catch(() => {})
        }
      } catch {
        // non-fatal — trainer will fall back to auto_create_spec
      }

    } catch (err: any) {
      const errMsg: AiChatMsg = {
        id: analyzingId,
        role: 'assistant',
        content: `I ran into a problem reading "${file.name}".\n\nIf this is a large file the most likely causes are:\n• Corrupted or non-standard Excel formatting — try re-saving as .csv first\n• Password-protected workbook — please remove the password before uploading\n• Very complex formulas/pivot tables — export to a plain CSV instead\n\nError detail: ${err?.message ?? 'Unknown parsing error'}`,
        suggestions: ['Describe my data instead', 'Try uploading as CSV'],
      }
      setMessages(prev => prev.map(m => m.id === analyzingId ? errMsg : m))
    }
  }

  const handleInspectionApply = (inspection: DataInspection, cleaned: { columns: string[]; rows: string[][] }, log: string[]) => {
    downloadCsv(cleaned.columns, cleaned.rows, `cleaned_${inspection.filename}`)
    const sampleSchema = { columns: cleaned.columns, sample_rows: cleaned.rows.slice(0, 5) }
    const updatedSession = { ...session, csvSchema: sampleSchema }
    setSession(updatedSession)

    // Upload cleaned CSV to clean_copy field + cleaning code to code_used field (best-effort, background)
    if (session.datasetId) {
      const csvText = [cleaned.columns, ...cleaned.rows].map(r =>
        r.map(v => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v)).join(',')
      ).join('\n')
      const cleanedBlob = new Blob([csvText], { type: 'text/csv' })
      const rawFilename = inspection.filename.split('/').pop() ?? inspection.filename
      const cleanedFile = new File([cleanedBlob], `cleaned_${rawFilename.replace(/\s*\(sampled.*\)/, '')}`, { type: 'text/csv' })
      if (session.datasetCleanFieldId) {
        editorApi.uploadDatasetField(session.datasetId, session.datasetCleanFieldId, cleanedFile).catch(() => {})
      }
      if (session.datasetCodeFieldId && log.length > 0) {
        const rawBase = (inspection.filename.split('/').pop() ?? 'data').replace(/\.(csv|xlsx?|tsv)$/i, '').replace(/\s+/g, '_')
        const pyContent = `# Data Cleaning Log — ${inspection.filename}\n# Generated by AI Workshop on ${new Date().toISOString()}\n\n${log.map(l => `# ${l}`).join('\n')}\n\n# Columns retained: ${cleaned.columns.join(', ')}\n# Rows after cleaning: ${cleaned.rows.length}\n`
        const pyFile = new File([pyContent], `cleaning_${rawBase}.py`, { type: 'text/x-python' })
        editorApi.uploadDatasetField(session.datasetId, session.datasetCodeFieldId, pyFile).catch(() => {})
      }
    }

    const cleaningLog = log.length > 0
      ? `\n\nCleaning applied:\n${log.map(l => `• ${l}`).join('\n')}`
      : '\n\nNo auto-fixes applied (data was already clean).'
    const warnings = inspection.suggestions.filter(s => !s.autoFixable)
    const warningText = warnings.length > 0
      ? `\n\nManual review needed:\n${warnings.map(s => `⚠ ${s.problem}`).join('\n')}`
      : ''

    const summaryPrompt =
      `Data inspection complete for "${inspection.filename}".\n` +
      `Original: ${inspection.rowCount.toLocaleString()} rows × ${inspection.colCount} columns.` +
      cleaningLog +
      `\nCleaned dataset: ${cleaned.rows.length.toLocaleString()} rows × ${cleaned.columns.length} columns.` +
      warningText +
      `\n\nColumns available: ${cleaned.columns.join(', ')}.\n\n` +
      `Based on this cleaned dataset, evaluate whether a useful ML model can be built here. Identify: ` +
      `the most likely target variable, feature columns, recommended algorithm, and what output fields the trainer should produce per inference request.`

    sendMessage(summaryPrompt, updatedSession)
  }

  const handleInspectionSkip = (inspection: DataInspection) => {
    const skipPrompt =
      `Dataset uploaded: "${inspection.filename}" — ${inspection.rowCount.toLocaleString()} rows × ${inspection.colCount} columns (raw, cleaning skipped by user).\n` +
      `Columns: ${inspection.rawColumns.join(', ')}.\n\n` +
      `Based on this data, evaluate whether a useful ML model can be built here. Identify: ` +
      `likely target variable, feature columns, recommended algorithm, and expected output fields per inference request.`
    sendMessage(skipPrompt)
  }

  const dsLabel = DS_TYPES.find(t => t.value === session.dsType)?.label ?? session.dsType

  // ── Setup screen ────────────────────────────────────────────────────────────
  if (!setupDone) {
    const SAMPLE_PROMPTS: { label: string; icon: string; dsType: string; framework: string; prompt: string }[] = [
      {
        label: 'Customer Segmentation',
        icon: '👥',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Build a customer segmentation model from transaction history CSV. Allow uploading transaction data and customer profile data, merge them on customer_id. Automatically suggest which fields to use as features. Group customers into segments like High Value, At Risk, New Customer, and Dormant. Output segment label, confidence score, avg_transaction_value, and purchase_frequency.',
      },
      {
        label: 'Churn Prediction',
        icon: '📉',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Predict customer churn from a CSV of subscription and usage data. Merge on account_id if multiple files are uploaded. Suggest which behavioral and demographic fields are most predictive. Output: churn_probability (0–1), risk_level (Low/Medium/High), top_3_risk_factors.',
      },
      {
        label: 'Fraud Detection',
        icon: '🔍',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Build a real-time fraud detection model on transaction data. Accept a CSV with transaction fields. Identify the amount, timestamp, merchant_category, and location fields automatically. Use anomaly detection + classification. Output: is_fraud (bool), fraud_score (0–1), anomaly_reason.',
      },
      {
        label: 'Sales Forecasting',
        icon: '📈',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Forecast monthly sales from historical sales CSV data. Auto-detect date, product_id, quantity, and revenue columns. Support merging product catalog data on product_id. Output: predicted_revenue, confidence_interval_low, confidence_interval_high, trend (up/flat/down).',
      },
      {
        label: 'Image Classifier',
        icon: '🖼️',
        dsType: 'dataset',
        framework: 'pytorch',
        prompt: 'Build an image classification trainer using a pre-trained ResNet50 with transfer learning. Dataset: labeled images uploaded via the platform. Support up to 20 classes. Output: predicted_class, confidence, top_3_classes with scores.',
      },
      {
        label: 'Sentiment Analysis',
        icon: '💬',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Train a text sentiment classifier on a CSV with a text column and a label column (positive/negative/neutral). Auto-detect the text and label columns. Use TF-IDF + logistic regression. Output: sentiment (string), confidence (float), sentiment_scores (dict with all class probabilities).',
      },
      {
        label: 'Product Recommender',
        icon: '🛍️',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Build a product recommendation model from purchase history CSV. Merge on customer_id and product_id. Use collaborative filtering. Output: recommended_product_ids (list), scores (list), recommendation_reason (string).',
      },
      {
        label: 'Anomaly Detection',
        icon: '⚠️',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Detect anomalies in time-series sensor or metric data from CSV. Auto-detect timestamp and value columns. Support multiple metric columns. Use Isolation Forest. Output: is_anomaly (bool), anomaly_score (float), severity (low/medium/high), affected_metrics (list).',
      },
      {
        label: 'Price Optimization',
        icon: '💰',
        dsType: 'upload',
        framework: 'sklearn',
        prompt: 'Build a price optimization / elasticity model from historical pricing and sales CSV data. Auto-detect price, quantity_sold, product_id, and date columns. Output: optimal_price, expected_revenue, price_elasticity, demand_forecast.',
      },
      {
        label: 'Document Classifier',
        icon: '📄',
        dsType: 'dataset',
        framework: 'sklearn',
        prompt: 'Classify documents or support tickets into categories from a labeled text CSV. Auto-detect the document text column and category label. Use TF-IDF vectorization. Output: category (string), confidence (float), alternative_categories (list of top 3).',
      },
    ]

    return (
      <div className="flex flex-col h-full bg-gray-950">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={13} /> Back
          </button>
          <div className="w-px h-4 bg-gray-700" />
          <Sparkles size={13} className="text-violet-400" />
          <span className="text-sm font-semibold text-white">AI Trainer Workshop</span>
        </div>

        {/* Setup: history sidebar + form + samples */}
        <div className="flex flex-1 min-h-0">

          {/* ── Session history sidebar ──────────────────────────────────── */}
          <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-950/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 text-[10px] text-gray-500 uppercase tracking-wider font-medium flex items-center justify-between">
              <span className="flex items-center gap-1"><Clock size={10} /> History</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {savedSessions.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-gray-600 italic">No sessions yet</div>
              ) : savedSessions.map(s => (
                <div key={s.id} className={clsx('group flex items-start hover:bg-gray-800 transition-colors', s.id === currentSessionId && 'bg-gray-800/50 border-l-2 border-violet-500')}>
                  <button
                    onClick={() => onRestoreSession?.(s)}
                    className="flex-1 text-left px-3 py-2 text-[11px] min-w-0"
                  >
                    <div className="truncate font-medium text-gray-300">{s.title || 'Session'}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">{new Date(s.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteSession?.(s.id) }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 mt-1.5 mr-1 text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
                    title="Delete session"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Main form ─────────────────────────────────────────────────── */}
          <div className="flex-1 flex items-center justify-center px-8 py-10 min-w-0">
            <div className="w-full max-w-lg space-y-5">
              <div>
                <h2 className="text-base font-semibold text-white">What do you want to build?</h2>
                <p className="text-xs text-gray-500 mt-0.5">Describe your idea — the AI will guide you through the rest</p>
              </div>

              <textarea
                autoFocus
                rows={5}
                value={session.prompt}
                onChange={e => setSession(s => ({ ...s, prompt: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleStartWorkshop() }}
                placeholder="e.g. Generate a customer segmentation model based on transaction history. Allow CSV upload. Merge on customer_id. Suggest which fields to group by."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none leading-relaxed"
              />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1.5">Data Source</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  value={session.dsType}
                  onChange={e => setSession(s => ({ ...s, dsType: e.target.value }))}
                >
                  {DS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <p className="text-[10px] text-gray-600 mt-1">{DS_TYPES.find(t => t.value === session.dsType)?.hint}</p>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1.5">Framework</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  value={session.framework}
                  onChange={e => setSession(s => ({ ...s, framework: e.target.value }))}
                >
                  {FW_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1.5">
                Class Name <span className="text-gray-600 normal-case font-normal">(optional)</span>
              </label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                placeholder="CustomerSegmentationTrainer"
                value={session.className}
                onChange={e => setSession(s => ({ ...s, className: e.target.value }))}
              />
            </div>

              <button
                onClick={handleStartWorkshop}
                disabled={!session.prompt.trim()}
                className="w-full py-2.5 text-sm font-semibold bg-violet-700 hover:bg-violet-600 text-white rounded-xl transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <MessageSquare size={14} /> Start AI Workshop →
              </button>
              <p className="text-[11px] text-gray-600">Ctrl+Enter to start · Upload a CSV in the chat for schema analysis</p>
            </div>
          </div>

          {/* ── Samples sidebar ───────────────────────────────────────────── */}
          <div className="w-64 flex-shrink-0 border-l border-gray-800 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Templates</p>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {SAMPLE_PROMPTS.map(s => (
                <button
                  key={s.label}
                  onClick={() => setSession(prev => ({ ...prev, prompt: s.prompt, dsType: s.dsType, framework: s.framework }))}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors',
                    session.prompt === s.prompt
                      ? 'bg-violet-900/30 text-violet-200'
                      : 'text-gray-400 hover:bg-gray-800/60 hover:text-white',
                  )}
                >
                  <span className="text-base flex-shrink-0">{s.icon}</span>
                  <span className="text-xs font-medium leading-tight">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    )
  }

  // ── Chat screen ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors flex-shrink-0">
          <ArrowLeft size={13} /> Back to Files
        </button>
        <div className="w-px h-4 bg-gray-700 flex-shrink-0" />
        <Sparkles size={12} className="text-violet-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-white flex-shrink-0">AI Trainer Workshop</span>
        <div className="flex items-center gap-1.5 ml-1 min-w-0">
          <span className="px-2 py-0.5 text-[10px] bg-gray-800 text-gray-400 rounded-full flex-shrink-0">{dsLabel}</span>
          {session.framework !== 'auto' && (
            <span className="px-2 py-0.5 text-[10px] bg-gray-800 text-gray-400 rounded-full flex-shrink-0">{session.framework}</span>
          )}
          <span className="text-[10px] text-gray-600 truncate min-w-0 ml-1 hidden md:block">
            {session.prompt.slice(0, 60)}{session.prompt.length > 60 ? '…' : ''}
          </span>
        </div>
        {generatedCode && (
          <button
            onClick={() => {
              const snap: SavedAiSession = { id: currentSessionId, title: messages.find(m => m.role === 'user')?.content.slice(0, 60) ?? 'Session', messages, session, generatedCode, generatedFilename, savedAt: Date.now() }
              onSaveSession?.(snap)
              onUseCode(generatedCode, generatedFilename, snap)
            }}
            className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white rounded-lg transition-colors"
          >
            <Wand2 size={11} /> Open in Editor
          </button>
        )}
      </div>

      {/* Body: history sidebar + chat + code panel */}
      <div className="flex flex-1 min-h-0">

        {/* ── Session history sidebar ─────────────────────────────────────── */}
        <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-950/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800 text-[10px] text-gray-500 uppercase tracking-wider font-medium flex items-center gap-1">
            <Clock size={10} /> History
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {savedSessions.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-gray-600 italic">No sessions yet</div>
            ) : savedSessions.map(s => (
              <div key={s.id} className={clsx('group flex items-start hover:bg-gray-800 transition-colors', s.id === currentSessionId && 'bg-gray-800/50 border-l-2 border-violet-500')}>
                <button
                  onClick={() => onRestoreSession?.(s)}
                  className="flex-1 text-left px-3 py-2 text-[11px] min-w-0"
                >
                  <div className="truncate font-medium text-gray-300">{s.title || 'Session'}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{new Date(s.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteSession?.(s.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 mt-1.5 mr-1 text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
                  title="Delete session"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 p-2">
            <button
              onClick={() => onRestoreSession?.(undefined as any)}
              className="w-full text-[11px] text-gray-500 hover:text-violet-300 py-1.5 text-center hover:bg-gray-800/50 rounded-lg transition-colors"
            >
              + New session
            </button>
          </div>
        </div>

        {/* ── Chat panel ────────────────────────────────────────────────────── */}
        <div className="flex flex-col w-[52%] min-w-0 border-r border-gray-800">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <ChatBubble
                key={msg.id}
                msg={msg}
                showCostDebug={showCostDebug}
                onSuggestion={t => {
                  if (t === 'Back to Files') { onBack(); return }
                  if (t === 'Top up wallet') { onBack(); window.dispatchEvent(new CustomEvent('navigate', { detail: 'wallet' })); return }
                  if (t === 'Try again') { sendMessage(messages[messages.length - 2]?.content ?? '', undefined, false); return }
                  if (t === 'Generate Now') { sendMessage('', undefined, true); return }
                  sendMessage(t)
                }}
                onInspectionApply={handleInspectionApply}
                onInspectionSkip={handleInspectionSkip}
              />
            ))}

            {/* Typing indicator */}
            {sending && (
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-violet-900/60 border border-violet-700/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles size={10} className="text-violet-400" />
                </div>
                <div className="bg-gray-800/80 border border-gray-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex items-center gap-1">
                    {[0, 150, 300].map(delay => (
                      <div key={delay} className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input bar */}
          <div className="border-t border-gray-800 p-3 space-y-2 flex-shrink-0 bg-gray-950">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="Ask a question, provide more details, or describe a change… (Shift+Enter for new line)"
              className="w-full bg-gray-800/80 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-600/70 resize-none"
              disabled={sending}
            />
            <div className="flex items-center gap-2">
              <input ref={csvInputRef} type="file" accept="*" className="hidden" onChange={handleFileAttach} />
              <button
                onClick={() => csvInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors flex-shrink-0"
                title="Attach any file — CSV/Excel inspected inline, images/PDFs saved to dataset"
              >
                <Paperclip size={11} /> Attach file
              </button>
              <button
                onClick={() => sendMessage(input || 'Generate the trainer now based on everything we discussed.', undefined, true)}
                disabled={sending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-violet-400 hover:text-violet-200 bg-violet-900/30 hover:bg-violet-800/40 border border-violet-700/40 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0"
                title="Generate trainer code now"
              >
                <Wand2 size={11} /> Generate Now
              </button>
              <div className="flex-1" />
              <button
                onClick={() => sendMessage(input)}
                disabled={sending || !input.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-violet-700 hover:bg-violet-600 text-white rounded-lg transition-colors disabled:opacity-40 flex-shrink-0"
              >
                {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                Send
              </button>
            </div>
          </div>
        </div>

        {/* ── Code / plan panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Panel tabs */}
          <div className="flex items-center border-b border-gray-800 px-1 flex-shrink-0" style={{ minHeight: '36px' }}>
            <button
              onClick={() => setActivePanel('code')}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors',
                activePanel === 'code' ? 'border-violet-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300',
              )}
            >
              <FileCode size={11} /> Code
            </button>
            <button
              onClick={() => setActivePanel('plan')}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors',
                activePanel === 'plan' ? 'border-violet-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300',
              )}
            >
              <BarChart2 size={11} /> Overview
            </button>
            {generatedCode && (
              <div className="ml-auto pr-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-[10px] text-emerald-400">{generatedFilename}</span>
              </div>
            )}
          </div>

          {/* Panel body */}
          {activePanel === 'code' ? (
            <div className="flex-1 min-h-0">
              {generatedCode ? (
                <Editor
                  language="python"
                  theme="vs-dark"
                  value={generatedCode}
                  onChange={val => setGeneratedCode(val ?? '')}
                  options={{
                    fontSize: 12,
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'off',
                    tabSize: 4,
                    automaticLayout: true,
                    padding: { top: 8 },
                    bracketPairColorization: { enabled: true },
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 text-gray-600 p-8">
                  <Wand2 size={32} className="opacity-20" />
                  <div>
                    <p className="text-sm text-gray-500">Code will appear here</p>
                    <p className="text-xs mt-1 text-gray-600">
                      Chat to refine your requirements, then click{' '}
                      <span className="text-violet-500 font-medium">Generate Now</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <TrainerOverview code={generatedCode} session={session} />
            </div>
          )}

          {/* Open in editor footer */}
          {generatedCode && (
            <div className="border-t border-gray-800 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 bg-gray-950">
              <span className="text-[11px] text-gray-500 flex-1 truncate font-mono">{generatedFilename}</span>
              <button
                onClick={() => setGeneratedCode(generatedCode)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
                title="Keep editing code here"
              >
                <Save size={11} /> Keep editing
              </button>
              <button
                onClick={() => {
                  const snap: SavedAiSession = { id: currentSessionId, title: messages.find(m => m.role === 'user')?.content.slice(0, 60) ?? 'Session', messages, session, generatedCode, generatedFilename, savedAt: Date.now() }
                  onSaveSession?.(snap)
                  onUseCode(generatedCode, generatedFilename, snap)
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold bg-violet-700 hover:bg-violet-600 text-white rounded-lg transition-colors"
              >
                <Wand2 size={11} /> Open in Editor →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CodeEditorPage() {
  const { user } = useAuth()
  const isViewer = user?.role === 'viewer'

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

  // AI Workshop
  const AI_SESSIONS_KEY = `ml_ai_sessions_${user?.org_id ?? 'default'}_v1`
  const [aiMode, setAiMode] = useState(false)
  const [aiSession, setAiSession] = useState<AiSession>({
    prompt: '', dsType: 'dataset', framework: 'auto', className: '', csvSchema: null,
  })
  const [savedAiSessions, setSavedAiSessions] = useState<SavedAiSession[]>(() => {
    try { return JSON.parse(localStorage.getItem(`ml_ai_sessions_${user?.org_id ?? 'default'}_v1`) ?? '[]') }
    catch { return [] }
  })
  const [lastAiSession, setLastAiSession] = useState<SavedAiSession | null>(null)
  const [restoreAiSession, setRestoreAiSession] = useState<SavedAiSession | undefined>(undefined)
  const [aiWorkshopKey, setAiWorkshopKey] = useState(0)
  const [showCostDebug, setShowCostDebug] = useState(false)

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
  const [errorsExpanded, setErrorsExpanded] = useState(false)
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

  // Install / security-scan status
  const [installing, setInstalling] = useState(false)
  const [installStatus, setInstallStatus] = useState<'idle' | 'scanning' | 'pending_admin' | 'rejected' | 'ok' | 'error'>('idle')
  const [scanSubmission, setScanSubmission] = useState<TrainerSubmission | null>(null)
  const [anomalyModalOpen, setAnomalyModalOpen] = useState(false)
  const [rejectionModalSub, setRejectionModalSub] = useState<TrainerSubmission | null>(null)

  // Sidebar: files | pending | library
  const [sidebarView, setSidebarView] = useState<'files' | 'pending' | 'library'>('files')
  const [pendingSubmissions, setPendingSubmissions] = useState<TrainerSubmission[]>([])
  const [pendingRegistrations, setPendingRegistrations] = useState<import('@/types/trainer').TrainerRegistration[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [resubmitting, setResubmitting] = useState<string | null>(null)

  // Active/running trainers (approved + is_active) — hidden from file tree
  const [activeTrainers, setActiveTrainers] = useState<import('@/types/trainer').TrainerRegistration[]>([])
  const [activeTrainerNames, setActiveTrainerNames] = useState<Set<string>>(new Set())
  const [upgradeConfirm, setUpgradeConfirm] = useState<{ baseName: string; nextVersion: string } | null>(null)

  // Public library trainers
  const [publicTrainers, setPublicTrainers] = useState<import('@/types/trainer').TrainerRegistration[]>([])
  const [publicTrainersLoading, setPublicTrainersLoading] = useState(false)
  const [cloningTrainer, setCloningTrainer] = useState<string | null>(null)

  const activeTabData = tabs.find(t => t.path === activeTab) ?? null

  // When switching to a different Python file, check if its trainer is already approved or under review
  useEffect(() => {
    if (!activeTabData || !activeTabData.name.endsWith('.py')) {
      setInstallStatus('idle')
      return
    }
    const trainerName = activeTabData.name.replace(/\.py$/, '')
    // Check pending list first (fast, local)
    const latestSub = pendingSubmissions
      .filter(s => s.trainer_name === trainerName)
      .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())[0]
    if (latestSub?.status === 'pending_admin' || latestSub?.status === 'flagged') {
      setInstallStatus('pending_admin')
      return
    }
    if (latestSub?.status === 'rejected') {
      setInstallStatus('rejected')
      return
    }
    trainersApi.get(trainerName)
      .then(reg => setInstallStatus((reg as any)?.status === 'active' ? 'ok' : 'idle'))
      .catch(() => setInstallStatus('idle'))
  }, [activeTab, pendingSubmissions]) // eslint-disable-line react-hooks/exhaustive-deps

  // When an approved or under-review trainer file gets edited, reset to idle so user can resubmit
  useEffect(() => {
    if (activeTabData?.dirty && (installStatus === 'ok' || installStatus === 'pending_admin')) {
      setInstallStatus('idle')
    }
  }, [activeTabData?.dirty, installStatus])

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

  const loadPendingSubmissions = useCallback(async () => {
    setPendingLoading(true)
    try {
      const [{ items }, regs] = await Promise.all([
        trainerSubmissionsApi.list(),
        trainersApi.listPending(),
      ])
      // Keep all non-terminal submissions (scanning / pending_admin / flagged)
      setPendingSubmissions(items.filter(s => s.status !== 'approved' && s.status !== 'rejected'))
      // All registration-level pending trainers (may or may not have a submission)
      setPendingRegistrations(regs)
    } catch {}
    finally { setPendingLoading(false) }
  }, [])

  const loadActiveTrainers = useCallback(async () => {
    try {
      const items = await trainersApi.list()
      const active = items.filter(t => t.is_active)
      setActiveTrainers(active)
      setActiveTrainerNames(new Set(active.map(t => t.name)))
    } catch {}
  }, [])

  const loadPublicTrainers = useCallback(async () => {
    setPublicTrainersLoading(true)
    try { setPublicTrainers(await trainersApi.listPublic()) } catch {}
    finally { setPublicTrainersLoading(false) }
  }, [])

  useEffect(() => {
    loadTree()
    loadDatasets()
    loadWallet()
    loadPendingSubmissions()
    loadActiveTrainers()
    loadPublicTrainers()
    configApi.getUiConfig().then(c => setShowCostDebug(c.show_cost_debug)).catch(() => {})
  }, [loadTree, loadDatasets, loadWallet, loadPendingSubmissions, loadPublicTrainers])

  // Persist AI sessions to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem(AI_SESSIONS_KEY, JSON.stringify(savedAiSessions.slice(0, 20))) }
    catch {}
  }, [savedAiSessions]) // eslint-disable-line

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
    if (isViewer) {
      // Viewers: open the template read-only, don't try to save a copy
      await openFile(node)
      return
    }
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

    // Capture path now so the SSE closure always has the right file
    const runFilePath = activeTabData.path

    // Save first
    if (activeTabData.dirty) await handleSave()

    setInsufficientBalance(null)
    setRunning(true)
    setLogOpen(true)
    setLogs([])
    setErrorsExpanded(false)

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

      // Pre-extract dataset slug from trainer code so we can use it on "not accessible" error
      const codeSlugMatch = activeTabData.content.match(/DatasetDataSource\(\s*["']([^"']+)["']/)
      const codeDatasetSlug = codeSlugMatch?.[1] ?? null

      // Stateful traceback buffer: collect all lines of a Python traceback, then decide
      // whether to suppress (dataset error → show upload modal) or flush (real error → show in log).
      let tracebackBuf: string[] = []
      let inTraceback = false

      const _isDatasetTraceback = (lines: string[]) =>
        lines.some(l =>
          l.includes('Dataset not accessible') ||
          l.includes('data_source.py') ||
          (l.includes('ValueError') && l.includes('Dataset')) ||
          l.includes('Dataset') && l.includes('is empty')
        )

      const _flushTraceback = () => {
        if (tracebackBuf.length > 0) {
          tracebackBuf.forEach(l => addLog(l, 'error'))
          tracebackBuf = []
        }
        inTraceback = false
      }

      sse.addEventListener('log', e => {
        const data = JSON.parse((e as MessageEvent).data)
        const line = data.line as string

        // Detect start of a Python traceback
        if (line.trim() === 'Traceback (most recent call last):') {
          inTraceback = true
          tracebackBuf = [line]
          return
        }

        if (inTraceback) {
          tracebackBuf.push(line)
          // Traceback ends when a non-indented, non-blank error line appears (e.g. "ValueError: ...")
          const isErrorLine = /^\w.*Error.*:/.test(line) || /^\w.*Exception.*:/.test(line)
          if (isErrorLine || (!line.startsWith(' ') && !line.startsWith('\t') && line.trim() !== '')) {
            // End of traceback — decide suppress or flush
            if (_isDatasetTraceback(tracebackBuf)) {
              emptyDatasetSlugRef.current = emptyDatasetSlugRef.current ?? codeDatasetSlug
              // Extract slug from "Dataset 'slug' is empty" if present
              const slugLine = tracebackBuf.find(l => l.includes('is empty'))
              const slugMatch = slugLine?.match(/Dataset '(.+?)' is empty/)
              if (slugMatch) emptyDatasetSlugRef.current = slugMatch[1]
            } else {
              _flushTraceback()
            }
            tracebackBuf = []
            inTraceback = false
          }
          return
        }

        // Normal log line — detect empty-dataset slug inline
        const emptyMatch = line.match(/Dataset '(.+?)' is empty/)
        if (emptyMatch) {
          emptyDatasetSlugRef.current = emptyMatch[1]
          return   // suppress the raw error line; upload modal will handle it
        }
        addLog(line, 'info')
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
          loadActiveTrainers()
        } else {
          // If dataset is missing/not accessible, skip the raw error and show upload modal
          const isDatasetError = data.error && (
            data.error.includes('Dataset not accessible') ||
            data.error.includes('is empty') ||
            data.error.includes('dataset')
          )
          if (!isDatasetError || !emptyDatasetSlugRef.current) {
            addLog(`✗ ${data.status}${data.error ? ': ' + data.error : ''}`, 'error')
          }
          // If we detected an empty/inaccessible dataset slug, fetch and show upload modal
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
                discoverable: false,
                contributor_allowlist: [],
                points_enabled: false,
                points_per_entry: 1,
                points_redemption_info: '',
                require_location: false,
                location_purpose: '',
                require_consent: false,
                consent_template_id: null,
                consent_type: 'individual',
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

  /** Strip _vN suffix → base name */
  const _baseName = (name: string) => name.replace(/_v\d+$/, '')

  /** Compute next versioned trainer name. v1 = original (no suffix), v2+ = _vN.
   *  Sources: pendingSubmissions (all statuses) + activeTrainers (running). */
  const _nextVersionedName = (baseName: string): string => {
    const clean = _baseName(baseName)

    // Collect version numbers from pending submissions
    let max = 0
    for (const s of pendingSubmissions) {
      if (_baseName(s.trainer_name) !== clean) continue
      const m = s.trainer_name.match(/_v(\d+)$/)
      max = Math.max(max, m ? parseInt(m[1]) : 1)
    }
    // Also from active/running trainers (covers pruned-submission cases)
    for (const t of activeTrainers) {
      if (_baseName(t.name) !== clean) continue
      const m = t.name.match(/_v(\d+)$/)
      max = Math.max(max, m ? parseInt(m[1]) : 1)
    }

    if (max === 0) return clean          // truly first submission — no suffix
    return `${clean}_v${max + 1}`
  }

  /** Inject or update `# Name:` header so the backend registers the versioned name */
  const _injectName = (content: string, versionedName: string): string => {
    const lines = content.split('\n')
    const idx = lines.findIndex(l => /^#\s*[Nn]ame\s*:/.test(l))
    if (idx !== -1) {
      lines[idx] = `# Name: ${versionedName}`
      return lines.join('\n')
    }
    return `# Name: ${versionedName}\n${content}`
  }

  /** Called by the upgrade-confirm modal "Confirm" button — skips the prompt */
  const handleInstallConfirmed = async () => {
    setUpgradeConfirm(null)
    await handleInstall(true)
  }

  const handleInstall = async (skipConfirm = false) => {
    if (!activeTabData) return

    const baseName = activeTabData.name.replace(/\.py$/, '')
    const versionedName = _nextVersionedName(baseName)
    const isVersioned = versionedName !== baseName

    // Block if any version of this base name is already pending (submission or registration)
    const inFlightSub = pendingSubmissions.find(
      s => _baseName(s.trainer_name) === _baseName(baseName) &&
           (s.status === 'scanning' || s.status === 'pending_admin' || s.status === 'flagged')
    )
    const inFlightReg = pendingRegistrations.find(
      r => (r.base_name || r.name.replace(/_v\d+$/, '')) === _baseName(baseName)
    )
    const inFlight = inFlightSub || inFlightReg
    if (inFlight) {
      const blockerName = inFlightSub ? inFlightSub.trainer_name : (inFlightReg?.name ?? '')
      addLog(
        `⚠ "${blockerName}" is already pending review — resolve it before submitting a new version.`,
        'error'
      )
      setLogOpen(true)
      return
    }

    // If submitting a change to a currently-running trainer, prompt first
    if (!skipConfirm && activeTrainerNames.has(_baseName(baseName))) {
      setUpgradeConfirm({ baseName: _baseName(baseName), nextVersion: versionedName })
      return
    }

    setInstalling(true)
    setInstallStatus('idle')
    setScanSubmission(null)
    setLogOpen(true)
    addLog(
      isVersioned
        ? `● Submitting as ${versionedName} (new version)…`
        : '● Submitting trainer for security scan…',
      'connected'
    )

    try {
      // Save first so the server has the latest content
      if (activeTabData.dirty) await handleSave()

      // Inject versioned name into content so backend registers it correctly
      const submissionContent = _injectName(activeTabData.content, versionedName)

      // Wrap content as a File for multipart upload
      const blob = new Blob([submissionContent], { type: 'text/x-python' })
      const file = new File([blob], `${versionedName}.py`, { type: 'text/x-python' })

      // Submit through the security-scan pipeline (not direct install)
      let submission = await trainerSubmissionsApi.upload(file)
      setScanSubmission(submission)
      addLog(`● Security scan started (id: ${submission.id.slice(0, 8)}…)`, 'connected')
      setInstallStatus('scanning')

      // Poll until scan finishes (max 60 attempts × 2 s = 2 min)
      let attempts = 0
      while (submission.status === 'scanning' && attempts < 60) {
        await new Promise(r => setTimeout(r, 2000))
        submission = await trainerSubmissionsApi.get(submission.id)
        setScanSubmission(submission)
        attempts++
      }

      const scan = submission.llm_scan_result ?? {}

      if (submission.status === 'approved') {
        addLog(`✓ Security scan passed — ${versionedName} is active.`, 'done')
        setInstallStatus('ok')
        loadActiveTrainers()

        // Check if trainer's dataset is empty
        const registeredTrainer = submission.parsed_metadata as Record<string, unknown> | null | undefined
        const dsInfo = (registeredTrainer?.data_source_info as Record<string, unknown>) ?? {}
        const dsType = dsInfo?.type as string | undefined
        if (dsType === 'dataset') {
          const dsSlug = dsInfo?.dataset_slug as string | undefined
          const dsId   = dsInfo?.dataset_id  as string | undefined
          if (dsSlug || dsId) {
            try {
              let dataset: DatasetProfile | null = null
              if (dsSlug) dataset = await datasetsApi.getBySlug(dsSlug)
              else if (dsId) dataset = await datasetsApi.get(dsId)
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
            } catch { /* non-fatal */ }
          }
        }
      } else if (submission.status === 'pending_admin') {
        const severity = scan.severity ?? 'low'
        addLog(`⚠ Security issues detected (severity: ${severity}) — submitted for admin review.`, 'error')
        addLog(`  Admin must approve before this trainer becomes active.`, 'error')
        setInstallStatus('pending_admin')
        setAnomalyModalOpen(true)
        // Refresh pending list and switch sidebar to Pending tab
        loadPendingSubmissions().then(() => setSidebarView('pending'))
      } else if (submission.status === 'flagged') {
        addLog(`✗ Trainer flagged: ${scan.summary ?? 'Security policy violation'}`, 'error')
        setInstallStatus('error')
        setAnomalyModalOpen(true)
        loadPendingSubmissions().then(() => setSidebarView('pending'))
        setTimeout(() => setInstallStatus('idle'), 5000)
      } else if (submission.status === 'rejected') {
        addLog(`✗ Trainer rejected by admin. See the Pending tab for details.`, 'error')
        setInstallStatus('rejected')
        setRejectionModalSub(submission)
        loadPendingSubmissions().then(() => setSidebarView('pending'))
      } else {
        // Still scanning after timeout
        addLog(`⚠ Scan timed out — check Trainers page for status.`, 'error')
        setInstallStatus('pending_admin')
      }
    } catch (err: any) {
      addLog(`✗ Submission failed: ${err?.response?.data?.detail ?? err?.message ?? 'Unknown error'}`, 'error')
      setInstallStatus('error')
      setTimeout(() => setInstallStatus('idle'), 3000)
    } finally {
      setInstalling(false)
    }
  }

  // ── Pending panel actions ─────────────────────────────────────────────────
  const handlePendingCardAction = async (sub: TrainerSubmission) => {
    if (sub.status === 'approved') {
      // Open the trainer source and run it; on success it gets auto-installed to running/
      setResubmitting(sub.id)
      try {
        const allFiles = _flattenTree(tree)
        const match = allFiles.find(f => f.name === `${sub.trainer_name}.py`)

        if (match) {
          await openFile(match as any)
        } else {
          // File not in workspace — fetch source from the submission record
          let content = ''
          try {
            const { source } = await trainerSubmissionsApi.getSource(sub.id)
            content = source
          } catch { /* ignore */ }
          if (!content) content = `# ${sub.trainer_name}.py\n# Edit and run to deploy\n`
          const tabPath = `trainers/${sub.trainer_name}.py`
          setTabs(prev => {
            const exists = prev.find(t => t.path === tabPath)
            return exists
              ? prev.map(t => t.path === tabPath ? { ...t, content, dirty: false } : t)
              : [...prev, { path: tabPath, name: `${sub.trainer_name}.py`, content, dirty: false }]
          })
          setActiveTab(tabPath)
        }
        setSidebarView('files')
        setTimeout(() => handleRun(), 100)
      } finally {
        setResubmitting(null)
      }
    } else if (sub.status === 'rejected') {
      setRejectionModalSub(sub)
    } else {
      // pending_admin / flagged — just open the file so user can see it
      setResubmitting(sub.id)
      const allFiles = _flattenTree(tree)
      const match = allFiles.find(f => f.name === `${sub.trainer_name}.py`)
      if (match) {
        await openFile(match)
        setSidebarView('files')
      }
      setResubmitting(null)
    }
  }

  // Legacy alias kept for any existing call sites
  const handleResubmit = handlePendingCardAction

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-950 h-full">
      {/* Quota / wallet bar */}
      <QuotaBar wallet={wallet} />

      {/* Read-only banner for viewers */}
      {isViewer && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/40 border-b border-amber-800/30 flex-shrink-0">
          <AlertCircle size={12} className="text-amber-400 flex-shrink-0" />
          <p className="text-[11px] text-amber-200/70">
            You have read-only access. Upgrade to Engineer to edit and train.
          </p>
        </div>
      )}

      {/* Action toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950 flex-shrink-0">
        {/* New file */}
        {!isViewer && (
          <button
            onClick={() => setShowNewFile(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            <Plus size={12} /> New File
          </button>
        )}

        {/* AI Workshop — new */}
        {!isViewer && (
          <button
            onClick={() => {
              setAiSession({ prompt: '', dsType: 'dataset', framework: 'auto', className: '', csvSchema: null })
              setRestoreAiSession(undefined)
              setAiWorkshopKey(k => k + 1)
              setAiMode(true)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-900/50 border border-violet-700/60 text-violet-300 hover:bg-violet-800/60 hover:text-white rounded-lg transition-colors"
            title="Generate a new trainer using AI"
          >
            <Sparkles size={12} /> Generate
          </button>
        )}

        {/* Refine in AI Workshop — only when a file is open */}
        {!isViewer && activeTabData && (
          <button
            onClick={() => {
              setAiSession({
                prompt: '',
                dsType: 'dataset',
                framework: 'auto',
                className: '',
                csvSchema: null,
                existingCode: activeTabData.content,
                existingFilename: activeTabData.name,
              })
              setRestoreAiSession(undefined)
              setAiWorkshopKey(k => k + 1)
              setAiMode(true)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-400 hover:bg-violet-900/40 hover:border-violet-700/60 hover:text-violet-300 rounded-lg transition-colors"
            title="Refine this trainer with AI"
          >
            <Wand2 size={12} /> Refine
          </button>
        )}

        {/* Resume last AI session — no remount, workshop is always mounted */}
        {!isViewer && lastAiSession && !aiMode && (
          <button
            onClick={() => setAiMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-950/50 border border-violet-800/50 text-violet-400 hover:bg-violet-900/50 hover:text-violet-200 rounded-lg transition-colors"
            title={`Resume: ${lastAiSession.title}`}
          >
            <MessageSquare size={12} /> Resume AI
          </button>
        )}

        <div className="flex-1" />

        {/* Dataset picker */}
        <DatasetPicker
          datasets={datasets}
          onInsert={handleInsertDataset}
          loading={datasetsLoading}
        />

        {/* Save */}
        {!isViewer && (
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
        )}

        {/* Install / Resubmit */}
        {!isViewer && (
          <button
            onClick={
              installStatus === 'error' && scanSubmission
                ? () => setAnomalyModalOpen(true)
                : () => handleInstall()
            }
            disabled={installing || !activeTabData || installStatus === 'pending_admin' || installStatus === 'ok' || installStatus === 'scanning'}
            title={
              installStatus === 'pending_admin'
                ? 'Under admin review — wait for approval. See the Pending tab on the left.'
                : installStatus === 'ok'
                ? 'Scan already passed'
                : installStatus === 'rejected'
                ? 'Trainer was rejected — fix the issues and resubmit'
                : 'Submit trainer for security scan — admin approval required before activation'
            }
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors disabled:opacity-50 font-medium',
              installStatus === 'ok'
                ? 'bg-green-900/40 border-green-700/60 text-green-400 cursor-default'
                : installStatus === 'scanning'
                ? 'bg-blue-900/40 border-blue-700/60 text-blue-300 cursor-default'
                : installStatus === 'pending_admin'
                ? 'bg-amber-900/40 border-amber-700/60 text-amber-300 cursor-not-allowed'
                : installStatus === 'rejected'
                ? 'bg-orange-900/40 border-orange-700/60 text-orange-300 hover:bg-orange-800/50'
                : installStatus === 'error'
                ? 'bg-red-900/40 border-red-700/60 text-red-400'
                : 'bg-indigo-900/50 border-indigo-700/60 text-indigo-300 hover:bg-indigo-800/60 hover:text-white',
            )}
          >
            {installing || installStatus === 'scanning'
              ? <Loader2 size={12} className="animate-spin" />
              : installStatus === 'pending_admin'
              ? <ShieldAlert size={12} />
              : installStatus === 'rejected'
              ? <RotateCcw size={12} />
              : <PackageCheck size={12} />}
            {installing ? 'Submitting…'
              : installStatus === 'scanning' ? 'Scanning…'
              : installStatus === 'ok' ? 'Scan Passed!'
              : installStatus === 'pending_admin' ? 'Under Review'
              : installStatus === 'rejected' ? 'Resubmit'
              : installStatus === 'error' ? 'Scan Failed'
              : 'Submit & Scan'}
          </button>
        )}

        {/* Run — only available after scan is approved */}
        {!isViewer && (
          <button
            onClick={installStatus === 'rejected'
              ? () => {
                  const name = activeTabData?.name.replace(/\.py$/, '')
                  const sub = pendingSubmissions.find(s => s.trainer_name === name && s.status === 'rejected')
                  if (sub) setRejectionModalSub(sub)
                }
              : handleRun}
            disabled={running || !activeTabData || (installStatus !== 'ok' && installStatus !== 'rejected')}
            title={
              installStatus === 'rejected'
                ? 'Trainer rejected — view rejection reason'
                : installStatus !== 'ok'
                ? 'Submit & scan trainer first — run is blocked until scan passes'
                : 'Run trainer'
            }
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 text-xs border rounded-lg transition-colors disabled:opacity-40 font-medium',
              installStatus === 'rejected'
                ? 'bg-red-900/40 border-red-700/60 text-red-300 hover:bg-red-800/50'
                : 'bg-green-700 hover:bg-green-600 text-white border-green-600',
            )}
          >
            {running
              ? <Loader2 size={12} className="animate-spin" />
              : installStatus === 'rejected'
              ? <XCircle size={12} />
              : <Play size={12} />}
            {running ? 'Running…'
              : installStatus === 'rejected' ? 'Rejected'
              : installStatus !== 'ok' ? 'Run (scan first)'
              : 'Run'}
          </button>
        )}

        {/* Deploy */}
        {!isViewer && (
          <button
            onClick={handleDeploy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-700 hover:bg-brand-600 text-white border border-brand-600 rounded-lg transition-colors font-medium"
          >
            <Upload size={12} /> Deploy
          </button>
        )}

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

      {/* AI Workshop — always mounted to preserve session state across editor↔AI navigation */}
      <div className={aiMode ? 'flex-1 min-h-0' : 'hidden'}>
        <AiWorkshop
            key={aiWorkshopKey}
            session={aiSession}
            datasets={datasets}
            savedSessions={savedAiSessions}
            restoreSession={restoreAiSession}
            showCostDebug={showCostDebug}
            onSaveSession={snap => {
              setLastAiSession(snap)
              setSavedAiSessions(prev => {
                const existing = prev.findIndex(s => s.id === snap.id)
                return existing >= 0
                  ? prev.map(s => s.id === snap.id ? snap : s)
                  : [snap, ...prev].slice(0, 20)
              })
            }}
            onRestoreSession={snap => {
              // undefined = "New session"
              setRestoreAiSession(snap ?? undefined)
              setAiSession({ prompt: '', dsType: 'dataset', framework: 'auto', className: '', csvSchema: null })
              setAiWorkshopKey(k => k + 1)
            }}
            onDeleteSession={id => {
              setSavedAiSessions(prev => prev.filter(s => s.id !== id))
              if (lastAiSession?.id === id) setLastAiSession(null)
            }}
            onBack={() => setAiMode(false)}
            onUseCode={(code, filename, snap) => {
              setLastAiSession(snap)
              setSavedAiSessions(prev => {
                const existing = prev.findIndex(s => s.id === snap.id)
                return existing >= 0
                  ? prev.map(s => s.id === snap.id ? snap : s)
                  : [snap, ...prev].slice(0, 20)
              })
              const path = filename.endsWith('.py') ? filename : `${filename}.py`
              const tab: OpenTab = { path, name: path.split('/').pop()!, content: code, dirty: true }
              setTabs(prev => {
                const exists = prev.find(t => t.path === path)
                return exists
                  ? prev.map(t => t.path === path ? { ...t, content: code, dirty: true } : t)
                  : [...prev, tab]
              })
              setActiveTab(path)
              setAiMode(false)
            }}
          />
      </div>

      {/* Body: sidebar + editor */}
      <div className={clsx('flex flex-1 min-h-0', aiMode && 'hidden')}>

        {/* File explorer sidebar */}
        <aside className="w-52 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-950 overflow-hidden">
          {/* Sidebar tab switcher */}
          <div className="flex border-b border-gray-800 flex-shrink-0">
            <button
              onClick={() => setSidebarView('files')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
                sidebarView === 'files'
                  ? 'text-white border-b-2 border-brand-500 -mb-px'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              <FileCode size={10} /> Files
            </button>
            <button
              onClick={() => { setSidebarView('pending'); loadPendingSubmissions() }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors relative',
                sidebarView === 'pending'
                  ? 'text-amber-400 border-b-2 border-amber-500 -mb-px'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              <ShieldAlert size={10} /> Pending
              {(pendingSubmissions.length + pendingRegistrations.filter(r => !pendingSubmissions.some(s => s.trainer_name === r.name)).length) > 0 && (
                <span className="absolute top-1 right-1.5 w-3 h-3 rounded-full bg-amber-500 text-[7px] text-black font-bold flex items-center justify-center">
                  {pendingSubmissions.length + pendingRegistrations.filter(r => !pendingSubmissions.some(s => s.trainer_name === r.name)).length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setSidebarView('library'); loadPublicTrainers() }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors relative',
                sidebarView === 'library'
                  ? 'text-sky-400 border-b-2 border-sky-500 -mb-px'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              <Globe size={10} /> Library
              {publicTrainers.length > 0 && (
                <span className="absolute top-1 right-1.5 w-3 h-3 rounded-full bg-sky-600 text-[7px] text-white font-bold flex items-center justify-center">
                  {publicTrainers.length}
                </span>
              )}
            </button>
          </div>

          {sidebarView === 'files' ? (
            <>

              <div className="flex-1 overflow-y-auto p-1 min-h-0">
                {treeLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={16} className="animate-spin text-gray-600" />
                  </div>
                ) : tree.length === 0 ? (
                  <p className="px-3 py-6 text-xs text-gray-600 text-center">
                    No files yet.<br />Click <strong>+ New File</strong> to start.
                  </p>
                ) : (
                  <FileTree
                    nodes={tree}
                    openPaths={openDirs}
                    activePath={activeTab}
                    onToggleDir={toggleDir}
                    onOpenFile={openFile}
                    onDelete={setDeleteTarget}
                  />
                )}
              </div>
              {/* Public library — clone trainers into workspace */}
              <LibrarySection
                trainers={publicTrainers}
                cloningTrainer={cloningTrainer}
                onClone={async (trainer) => {
                  setCloningTrainer(trainer.name)
                  try {
                    await trainersApi.clone(trainer.name)
                    loadActiveTrainers()
                    loadPendingSubmissions()
                  } catch { /* ignore */ }
                  finally { setCloningTrainer(null) }
                }}
              />
            </>
          ) : sidebarView === 'pending' ? (
            <div className="flex-1 overflow-y-auto min-h-0">
              {pendingLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-gray-600" />
                </div>
              ) : pendingSubmissions.length === 0 && pendingRegistrations.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <CheckCircle2 size={20} className="text-emerald-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-600">No pending trainers</p>
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {/* Registration-level pending trainers — each version shown separately */}
                  {pendingRegistrations.map(reg => {
                    const statusLabel =
                      reg.approval_status === 'pending_admin' ? 'Under Review' :
                      reg.approval_status === 'flagged' ? 'Flagged' :
                      reg.approval_status === 'rejected' ? 'Rejected' : 'Pending Review'
                    const statusColor =
                      reg.approval_status === 'rejected' ? 'bg-red-900/60 text-red-400' :
                      reg.approval_status === 'flagged'  ? 'bg-orange-900/60 text-orange-400' :
                      'bg-amber-900/60 text-amber-400'
                    // Skip if there's a matching submission already shown
                    const hasSub = pendingSubmissions.some(s => s.trainer_name === reg.name)
                    if (hasSub) return null
                    return (
                      <div key={reg.id} className="border border-amber-800/40 bg-amber-950/10 rounded-lg p-2.5 text-xs">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ShieldAlert size={11} className="text-amber-400 flex-shrink-0" />
                          <span className="font-mono text-gray-200 truncate flex-1 text-[11px]">
                            {reg.name}.py
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className={clsx('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide', statusColor)}>
                            {statusLabel}
                          </span>
                          <span className="text-[9px] text-gray-700 font-mono">
                            {reg.version_full ?? `v${reg.plugin_version ?? 0}`}
                          </span>
                          {reg.org_id && (
                            <span className="text-[9px] text-gray-700 truncate max-w-[80px]" title={reg.org_id}>
                              {reg.org_id.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-gray-700 mb-2">
                          {reg.created_at ? new Date(reg.created_at).toLocaleDateString() : ''}
                        </p>
                        <div className="flex gap-1.5 flex-wrap">
                          <button
                            onClick={async () => {
                              try { await trainersApi.approvePending(reg.name); loadPendingSubmissions() }
                              catch { /* non-fatal */ }
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-emerald-900/40 border border-emerald-700/50 text-emerald-400 rounded hover:bg-emerald-900/60 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={async () => {
                              const reason = prompt('Rejection reason (optional):') ?? ''
                              try { await trainersApi.rejectPending(reg.name, reason); loadPendingSubmissions() }
                              catch { /* non-fatal */ }
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-red-900/30 border border-red-700/40 text-red-400 rounded hover:bg-red-900/50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {/* Submission-based pending trainers */}
                  {pendingSubmissions.map(sub => {
                    const isApproved = sub.status === 'approved'
                    const isRejected = sub.status === 'rejected'
                    const isPending  = sub.status === 'pending_admin' || sub.status === 'flagged'

                    return (
                      <div
                        key={sub.id}
                        className={clsx(
                          'border rounded-lg p-2.5 text-xs',
                          isApproved ? 'bg-green-900/10 border-green-800/40' :
                          isRejected ? 'bg-red-900/10 border-red-800/40' :
                          'bg-gray-900 border-gray-800'
                        )}
                      >
                        {/* Header row */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          {isApproved
                            ? <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                            : isRejected
                            ? <XCircle size={11} className="text-red-400 flex-shrink-0" />
                            : <ShieldAlert size={11} className="text-amber-400 flex-shrink-0" />
                          }
                          <span className="font-mono text-gray-200 truncate flex-1 text-[11px] leading-tight">
                            {sub.trainer_name}.py
                          </span>
                        </div>

                        {/* Status badge */}
                        <div className="mb-1.5">
                          <span className={clsx(
                            'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide',
                            isApproved ? 'bg-emerald-900/60 text-emerald-400' :
                            isRejected ? 'bg-red-900/60 text-red-400' :
                            sub.status === 'flagged' ? 'bg-orange-900/60 text-orange-400' :
                            'bg-amber-900/60 text-amber-400'
                          )}>
                            {isApproved ? 'Approved' : isRejected ? 'Rejected' : sub.status === 'flagged' ? 'Flagged' : 'Under Review'}
                          </span>
                        </div>

                        {/* Rejection reason for rejected */}
                        {isRejected && sub.rejection_reason && (
                          <p className="text-[10px] text-red-300/80 mb-1.5 leading-snug line-clamp-2">
                            {sub.rejection_reason}
                          </p>
                        )}

                        {/* Summary for pending/flagged */}
                        {isPending && sub.llm_scan_result?.summary && (
                          <p className="text-[10px] text-gray-500 mb-1.5 leading-snug line-clamp-2">
                            {sub.llm_scan_result.summary}
                          </p>
                        )}

                        <p className="text-[9px] text-gray-700 mb-2">
                          {new Date(sub.submitted_at).toLocaleDateString()}
                        </p>

                        {/* Action button */}
                        {isApproved ? (
                          <button
                            onClick={() => handlePendingCardAction(sub)}
                            disabled={resubmitting === sub.id}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-green-700 hover:bg-green-600 border border-green-600 rounded text-[11px] font-semibold text-white transition-colors disabled:opacity-40"
                          >
                            {resubmitting === sub.id
                              ? <Loader2 size={10} className="animate-spin" />
                              : <Play size={10} />}
                            {resubmitting === sub.id ? 'Opening…' : 'Run'}
                          </button>
                        ) : isRejected ? (
                          <button
                            onClick={() => setRejectionModalSub(sub)}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 rounded text-[11px] text-red-300 hover:text-white transition-colors"
                          >
                            <AlertTriangle size={10} /> View Rejection & Resubmit
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-900/20 border border-amber-800/30 rounded text-[10px] text-amber-400/70">
                            <Loader2 size={9} className="animate-spin flex-shrink-0" />
                            Awaiting admin review…
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : sidebarView === 'library' ? (
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Public Library</span>
                <button
                  onClick={loadPublicTrainers}
                  className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={11} />
                </button>
              </div>

              {publicTrainersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-gray-600" />
                </div>
              ) : publicTrainers.length === 0 ? (
                <div className="px-3 py-10 text-center space-y-2">
                  <Globe size={20} className="text-gray-700 mx-auto" />
                  <p className="text-xs text-gray-600">No public trainers</p>
                  <p className="text-[10px] text-gray-700">Public trainers from global_sample/ appear here.</p>
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {(() => {
                    // Group by base_name
                    const groups: Map<string, import('@/types/trainer').TrainerRegistration[]> = new Map()
                    for (const t of publicTrainers) {
                      const key = t.base_name ?? t.name
                      if (!groups.has(key)) groups.set(key, [])
                      groups.get(key)!.push(t)
                    }
                    return [...groups.entries()].map(([base, vers]) => {
                      const sorted = [...vers].sort((a, b) => (b.plugin_version ?? 0) - (a.plugin_version ?? 0))
                      const latest = sorted[0]
                      const isCloning = cloningTrainer === latest.name
                      return (
                        <div key={base} className="bg-sky-900/10 border border-sky-800/30 rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Globe size={11} className="text-sky-400 flex-shrink-0" />
                            <span className="font-mono text-[11px] text-sky-200 truncate flex-1 font-semibold">
                              {base}
                            </span>
                            <span className="text-[9px] text-gray-600 flex-shrink-0 font-mono">
                              {latest.version_full ?? `v${latest.plugin_version ?? 0}`}
                            </span>
                          </div>
                          {latest.description && (
                            <p className="text-[10px] text-gray-600 mb-2 line-clamp-2">{latest.description}</p>
                          )}
                          <button
                            onClick={async () => {
                              setCloningTrainer(latest.name)
                              try {
                                await trainersApi.clone(latest.name)
                                loadActiveTrainers()
                                loadPendingSubmissions()
                              } catch { /* ignore */ }
                              finally { setCloningTrainer(null) }
                            }}
                            disabled={!!cloningTrainer}
                            className="w-full flex items-center justify-center gap-1 py-1.5 bg-sky-900/40 border border-sky-700/60 text-sky-300 hover:bg-sky-800/50 rounded text-[10px] font-semibold transition-colors disabled:opacity-40"
                          >
                            {isCloning ? <Loader2 size={9} className="animate-spin" /> : <Copy size={9} />}
                            {isCloning ? 'Cloning…' : 'Clone to My Trainers'}
                          </button>
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          ) : null}
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
                ) : (() => {
                  const errorLines = logs.filter(l => l.type === 'error')
                  const otherLines = logs.filter(l => l.type !== 'error')
                  return (
                    <>
                      {otherLines.map(line => (
                        <div key={line.id} className={clsx(
                          'whitespace-pre-wrap break-all leading-relaxed',
                          line.type === 'done' ? 'text-green-400' :
                          line.type === 'connected' ? 'text-brand-400' :
                          'text-gray-300',
                        )}>
                          {line.text}
                        </div>
                      ))}
                      {errorLines.length > 0 && (
                        <div className="mt-1 border border-red-800/50 rounded-lg overflow-hidden">
                          <button
                            onClick={() => setErrorsExpanded(v => !v)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-red-950/40 hover:bg-red-900/40 text-left transition-colors"
                          >
                            <AlertCircle size={10} className="text-red-400 flex-shrink-0" />
                            <span className="text-red-400 flex-1">{errorLines.length} error{errorLines.length !== 1 ? 's' : ''}</span>
                            <ChevronDown size={10} className={clsx('text-red-500 transition-transform', errorsExpanded && 'rotate-180')} />
                          </button>
                          {errorsExpanded && (
                            <div className="px-2.5 py-2 space-y-0.5 bg-red-950/20">
                              {errorLines.map(line => (
                                <div key={line.id} className="whitespace-pre-wrap break-all leading-relaxed text-red-400">
                                  {line.text}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}
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
                {/* Fix with AI — shown when errors present after run */}
                {!running && logs.some(l => l.type === 'error') && activeTabData && !isViewer && (
                  <div className="mt-2 flex items-center gap-3 px-3 py-2 bg-red-950/30 border border-red-800/40 rounded-lg font-sans">
                    <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                    <span className="text-red-300 text-[11px] flex-1">Errors detected — send to AI for diagnosis</span>
                    <button
                      onClick={() => {
                        const errorText = logs.filter(l => l.type === 'error').map(l => l.text).join('\n')
                        const errMsg = `I ran the trainer and got these errors:\n\`\`\`\n${errorText}\n\`\`\`\nPlease diagnose and fix the issue.`
                        if (lastAiSession) {
                          // Continue the existing session — inject the error as the next user message
                          const patchedSession: SavedAiSession = {
                            ...lastAiSession,
                            session: {
                              ...lastAiSession.session,
                              existingCode: activeTabData?.content ?? lastAiSession.session.existingCode,
                              existingFilename: activeTabData?.name ?? lastAiSession.session.existingFilename,
                              initialUserMessage: errMsg,
                            },
                          }
                          setRestoreAiSession(patchedSession)
                          setAiWorkshopKey(k => k + 1)
                        } else {
                          // No prior session — start fresh with error context
                          setRestoreAiSession(undefined)
                          setAiWorkshopKey(k => k + 1)
                          setAiSession({
                            prompt: '',
                            dsType: 'dataset',
                            framework: 'auto',
                            className: '',
                            csvSchema: null,
                            existingCode: activeTabData?.content,
                            existingFilename: activeTabData?.name,
                            initialUserMessage: errMsg,
                          })
                        }
                        setAiMode(true)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-[11px] font-medium rounded-lg transition-colors flex-shrink-0"
                    >
                      <Sparkles size={11} /> Fix with AI
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
                    {t === 'blank' ? 'Empty file' : 'Default Template'}
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

      {/* Security scan result modal */}
      <TrainerAnomalyModal
        open={anomalyModalOpen}
        onClose={() => setAnomalyModalOpen(false)}
        submission={scanSubmission}
      />

      {/* Upgrade confirmation modal */}
      {upgradeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-800">
              <RotateCcw size={16} className="text-blue-400" />
              <div>
                <div className="text-sm font-bold text-white">Upgrade Running Trainer?</div>
                <div className="text-[11px] text-gray-500 font-mono">{upgradeConfirm.baseName}</div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-300 leading-relaxed">
                <span className="font-semibold text-white">{upgradeConfirm.baseName}</span> is currently running.
                Your changes will be submitted as{' '}
                <span className="font-semibold text-blue-300">{upgradeConfirm.nextVersion}</span> and go through security review.
              </p>
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl px-4 py-3 text-xs text-blue-300">
                The current version keeps running uninterrupted until <strong>{upgradeConfirm.nextVersion}</strong> is approved and activated.
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setUpgradeConfirm(null)}
                className="flex-1 py-2 text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-xl hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInstallConfirmed}
                className="flex-1 py-2 text-xs text-white bg-blue-700 hover:bg-blue-600 border border-blue-600 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} /> Submit as {upgradeConfirm.nextVersion}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection detail modal */}
      {rejectionModalSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <XCircle size={18} className="text-red-400" />
                <div>
                  <div className="text-sm font-bold text-white">Trainer Rejected</div>
                  <div className="text-[11px] text-gray-500 font-mono">{rejectionModalSub.trainer_name}.py</div>
                </div>
              </div>
              <button
                onClick={() => setRejectionModalSub(null)}
                className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Rejection reason */}
              {rejectionModalSub.rejection_reason && (
                <div className="bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
                  <p className="text-[11px] text-red-400 uppercase tracking-widest font-semibold mb-1.5">Rejection Reason</p>
                  <p className="text-sm text-red-200 leading-relaxed">{rejectionModalSub.rejection_reason}</p>
                </div>
              )}

              {/* LLM scan summary */}
              {rejectionModalSub.llm_scan_result?.summary && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold mb-1.5">Scan Summary</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{rejectionModalSub.llm_scan_result.summary}</p>
                </div>
              )}

              {/* Issues */}
              {(rejectionModalSub.llm_scan_result?.issues ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold mb-2">Issues Found</p>
                  <div className="space-y-2">
                    {(rejectionModalSub.llm_scan_result?.issues ?? []).map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
                        <AlertTriangle size={12} className={clsx('flex-shrink-0 mt-0.5', issue.block ? 'text-red-400' : 'text-amber-500')} />
                        <div className="min-w-0">
                          {issue.block && <span className="text-[10px] font-bold text-red-400 mr-1.5">[BLOCK]</span>}
                          {issue.line && <span className="text-[10px] text-gray-600 mr-1.5">line {issue.line}</span>}
                          <span className="text-xs text-gray-300">{issue.detail || issue.message || issue.rule}</span>
                          {issue.fix && <p className="text-[11px] text-emerald-400 mt-1">Fix: {issue.fix}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 text-xs text-gray-400">
                Fix the issues above, update the code in the editor, then click <span className="text-orange-300 font-semibold">Resubmit</span> to go through security review again.
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setRejectionModalSub(null)}
                className="flex-1 py-2 text-xs text-gray-400 bg-gray-800 border border-gray-700 rounded-xl hover:text-gray-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setRejectionModalSub(null)
                  handleInstall()
                }}
                className="flex-1 py-2 text-xs text-white bg-orange-700 hover:bg-orange-600 border border-orange-600 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={12} /> Edit & Resubmit
              </button>
            </div>
          </div>
        </div>
      )}

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
