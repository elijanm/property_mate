import { useState, useEffect } from 'react'
import { discoverApi, type DiscoverDataset, type DiscoverEngineer } from '@/api/discover'
import {
  Search, Database, ArrowLeft, ChevronRight, Tag,
  Eye, Image, FileText, Hash, User,
} from 'lucide-react'
import clsx from 'clsx'

interface Props {
  onBack: () => void
  onViewEngineer?: (id: string) => void
}

const FIELD_TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <Image size={11} />,
  video: <span className="text-[10px]">▶</span>,
  text:  <FileText size={11} />,
  number: <Hash size={11} />,
}

const FIELD_TYPE_COLORS: Record<string, string> = {
  image:  'text-violet-400 bg-violet-950/40 border-violet-800/40',
  video:  'text-rose-400 bg-rose-950/40 border-rose-800/40',
  text:   'text-sky-400 bg-sky-950/40 border-sky-800/40',
  number: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
  audio:  'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
}

const CATEGORY_COLORS: Record<string, string> = {
  computer_vision: 'text-violet-400 bg-violet-950/40 border-violet-800/40',
  nlp:             'text-sky-400 bg-sky-950/40 border-sky-800/40',
  tabular:         'text-amber-400 bg-amber-950/40 border-amber-800/40',
  audio:           'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
  multimodal:      'text-rose-400 bg-rose-950/40 border-rose-800/40',
}

function avatarHue(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function formatCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

export default function PublicDatasetsPage({ onBack, onViewEngineer }: Props) {
  const [datasets, setDatasets] = useState<DiscoverDataset[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [fieldTypeFilter, setFieldTypeFilter] = useState('')
  const [sort, setSort] = useState<'size' | 'alpha' | 'newest'>('size')
  const [selected, setSelected] = useState<DiscoverDataset | null>(null)
  const [publisher, setPublisher] = useState<DiscoverEngineer | null>(null)

  useEffect(() => {
    discoverApi.listDatasets({ search, field_type: fieldTypeFilter })
      .then(setDatasets)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [search, fieldTypeFilter])

  // Reload publisher on dataset select
  useEffect(() => {
    if (!selected?.publisher_id) { setPublisher(null); return }
    discoverApi.getEngineer(selected.publisher_id)
      .then(e => setPublisher({ ...e }))
      .catch(() => setPublisher(null))
  }, [selected?.publisher_id])

  const sorted = [...datasets].sort((a, b) => {
    if (sort === 'size')   return b.entry_count_cache - a.entry_count_cache
    if (sort === 'newest') return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    return a.name.localeCompare(b.name)
  })

  // Collect all field types for filter pills
  const allFieldTypes = Array.from(new Set(datasets.flatMap(d => d.field_types)))

  if (selected) {
    return (
      <DatasetDetail
        dataset={selected}
        publisher={publisher}
        onBack={() => setSelected(null)}
        onViewPublisher={onViewEngineer}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#060810]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-4">
          <button onClick={onBack} className="text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">Public Datasets</h1>
            <p className="text-xs text-gray-500">Explore and use datasets published by the community</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, category or description…"
              className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-sky-700"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as typeof sort)}
            className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-sky-700"
          >
            <option value="size">Sort: Largest first</option>
            <option value="newest">Sort: Newest first</option>
            <option value="alpha">Sort: A → Z</option>
          </select>
        </div>

        {/* Field-type filter pills */}
        {allFieldTypes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFieldTypeFilter('')}
              className={clsx('px-3 py-1 rounded-full text-xs border transition-colors',
                fieldTypeFilter === ''
                  ? 'bg-sky-900/40 border-sky-700 text-sky-300'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600'
              )}
            >
              All types
            </button>
            {allFieldTypes.map(ft => (
              <button
                key={ft}
                onClick={() => setFieldTypeFilter(ft === fieldTypeFilter ? '' : ft)}
                className={clsx('flex items-center gap-1 px-3 py-1 rounded-full text-xs border transition-colors',
                  ft === fieldTypeFilter
                    ? (FIELD_TYPE_COLORS[ft] ?? 'text-sky-300 bg-sky-900/40 border-sky-700')
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600'
                )}
              >
                {FIELD_TYPE_ICONS[ft] ?? <Tag size={10} />}
                {ft}
              </button>
            ))}
          </div>
        )}

        {/* Stats bar */}
        <p className="text-xs text-gray-600">{sorted.length} dataset{sorted.length !== 1 ? 's' : ''} found</p>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-gray-900/40 rounded-2xl p-5 border border-white/5 animate-pulse h-44" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-24 flex flex-col items-center gap-3 text-gray-600">
            <Database size={32} />
            <p className="text-sm">No datasets found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map(ds => (
              <DatasetCard key={ds.id} dataset={ds} onClick={() => setSelected(ds)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DatasetCard({ dataset: ds, onClick }: { dataset: DiscoverDataset; onClick: () => void }) {
  const catColor = CATEGORY_COLORS[ds.category] ?? 'text-gray-400 bg-gray-800/60 border-gray-700/40'
  const publisherInitial = ds.publisher_name ? ds.publisher_name[0].toUpperCase() : '?'
  const hue = avatarHue(ds.publisher_name ?? '')

  return (
    <button
      onClick={onClick}
      className="text-left bg-gray-900/40 hover:bg-gray-900/80 border border-white/5 hover:border-sky-800/40 rounded-2xl p-5 transition-all group space-y-3"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-950/60 border border-sky-800/30 flex items-center justify-center flex-shrink-0">
          <Database size={18} className="text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate group-hover:text-sky-300 transition-colors">
            {ds.name}
          </h3>
          {ds.slug && <p className="text-[11px] text-gray-600 font-mono truncate">{ds.slug}</p>}
        </div>
        <ChevronRight size={14} className="text-gray-700 group-hover:text-sky-500 transition-colors flex-shrink-0 mt-0.5" />
      </div>

      {/* Description */}
      {ds.description && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{ds.description}</p>
      )}

      {/* Field types */}
      {ds.field_types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ds.field_types.slice(0, 4).map(ft => (
            <span key={ft}
              className={clsx('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border',
                FIELD_TYPE_COLORS[ft] ?? 'text-gray-400 bg-gray-800/60 border-gray-700/40'
              )}>
              {FIELD_TYPE_ICONS[ft] ?? <Tag size={9} />} {ft}
            </span>
          ))}
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Publisher avatar */}
          {ds.publisher_name && (
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: `hsl(${hue},55%,32%)` }}
            >
              {publisherInitial}
            </div>
          )}
          <span className={clsx('px-2 py-0.5 rounded-full text-[10px] border', catColor)}>
            {ds.category}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Eye size={11} className="text-gray-600" />
          <span className="font-semibold text-white">{formatCount(ds.entry_count_cache)}</span>
          <span className="text-gray-600">entries</span>
        </div>
      </div>
    </button>
  )
}

function DatasetDetail({
  dataset: ds,
  publisher,
  onBack,
  onViewPublisher,
}: {
  dataset: DiscoverDataset
  publisher: DiscoverEngineer | null
  onBack: () => void
  onViewPublisher?: (id: string) => void
}) {
  const catColor = CATEGORY_COLORS[ds.category] ?? 'text-gray-400 bg-gray-800/60 border-gray-700/40'
  const hue = avatarHue(ds.publisher_name ?? '')
  const publisherInitial = ds.publisher_name ? ds.publisher_name[0].toUpperCase() : '?'

  return (
    <div className="min-h-screen bg-[#060810] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#060810]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-white transition-colors flex items-center gap-1.5 text-sm">
            <ArrowLeft size={15} /> Back
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 space-y-8">
        {/* Title block */}
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-sky-950/60 border border-sky-800/30 flex items-center justify-center flex-shrink-0">
            <Database size={28} className="text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{ds.name}</h1>
            {ds.slug && <p className="text-sm text-gray-500 font-mono mt-0.5">{ds.slug}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={clsx('px-2.5 py-1 rounded-full text-xs border', catColor)}>{ds.category}</span>
              <span className={clsx('px-2.5 py-1 rounded-full text-xs border',
                ds.status === 'active' ? 'text-emerald-400 bg-emerald-950/30 border-emerald-800/40'
                  : 'text-gray-400 bg-gray-800/60 border-gray-700/40'
              )}>{ds.status}</span>
              {ds.visibility === 'public' && (
                <span className="px-2.5 py-1 rounded-full text-xs border text-sky-400 bg-sky-950/30 border-sky-800/40">Public</span>
              )}
              {ds.points_enabled && (
                <span className="px-2.5 py-1 rounded-full text-xs border text-amber-400 bg-amber-950/30 border-amber-800/40">Points enabled</span>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {ds.description && (
          <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-5">
            <p className="text-sm text-gray-300 leading-relaxed">{ds.description}</p>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Stats */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Stats</h3>
              <div className="space-y-2">
                <StatRow label="Entries" value={formatCount(ds.entry_count_cache)} highlight />
                <StatRow label="Fields" value={String(ds.field_count)} />
                <StatRow label="Category" value={ds.category} />
                {ds.created_at && (
                  <StatRow label="Created" value={new Date(ds.created_at).toLocaleDateString()} />
                )}
              </div>
            </div>

            {/* Publisher */}
            {ds.publisher_name && (
              <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Publisher</h3>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: `hsl(${hue},55%,32%)` }}
                  >
                    {publisherInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{ds.publisher_name}</p>
                    {publisher && (
                      <p className="text-xs text-gray-500">{publisher.model_count} models · {publisher.dataset_count} datasets</p>
                    )}
                  </div>
                  {ds.publisher_id && onViewPublisher && (
                    <button
                      onClick={() => onViewPublisher(ds.publisher_id!)}
                      className="text-xs text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
                    >
                      Profile <ChevronRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Fields */}
          <div className="lg:col-span-2 space-y-4">
            {/* Field types summary */}
            {ds.field_types.length > 0 && (
              <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Field Types</h3>
                <div className="flex flex-wrap gap-2">
                  {ds.field_types.map(ft => (
                    <span key={ft}
                      className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border',
                        FIELD_TYPE_COLORS[ft] ?? 'text-gray-400 bg-gray-800/60 border-gray-700/40'
                      )}>
                      {FIELD_TYPE_ICONS[ft] ?? <Tag size={10} />} {ft}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Field list */}
            {ds.fields.length > 0 && (
              <div className="bg-gray-900/60 border border-white/5 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Schema <span className="text-gray-600 font-normal ml-1">({ds.fields.length} fields)</span>
                </h3>
                <div className="space-y-1.5">
                  {ds.fields.map(f => (
                    <div key={f.id} className="flex items-center gap-3 py-2 px-3 bg-gray-800/40 rounded-lg">
                      <span className={clsx('flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border flex-shrink-0',
                        FIELD_TYPE_COLORS[f.type] ?? 'text-gray-400 bg-gray-700/60 border-gray-600/40'
                      )}>
                        {FIELD_TYPE_ICONS[f.type] ?? <Tag size={9} />} {f.type}
                      </span>
                      <span className="text-sm text-gray-300">{f.label}</span>
                      <span className="text-[10px] text-gray-600 font-mono ml-auto">{f.id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={clsx('text-sm font-semibold', highlight ? 'text-white' : 'text-gray-300')}>{value}</span>
    </div>
  )
}
