import { useEffect, useState, useContext, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  listSparePartsPricing, upsertSparePartPricing,
  listPartsKits, createPartsKit, updatePartsKit, deletePartsKit,
  listRateSchedules, upsertRateSchedule,
  updateRegionsSites, updateSchedule4,
} from '@/api/frameworks'
import type { Schedule4EntryPayload } from '@/api/frameworks'
import {
  listPartsCatalog, createPartsCatalogItem, updatePartsCatalogItem,
  deletePartsCatalogItem, bulkImportParts, uploadPartsCatalogCsv,
} from '@/api/partsCatalog'
import type { SparePartsPricing, SparePartsKit, RateSchedule, PartsCatalogItem } from '@/types/framework'
import { KVA_RANGES } from '@/types/framework'
import { FrameworkContext } from './FrameworkWorkspacePage'
import { extractApiError } from '@/utils/apiError'
import PartAutocomplete from '@/components/PartAutocomplete'

const ACCENT = '#D97706'

const TABS = [
  'Regions & Sites',
  'Schedule of Rates',
  'Parts Catalog',
  'Other Charges',
  'Parts Kits',
  'KVA Pricing Matrix',
  'SLA Thresholds',
  'Contract Info',
]

// Shared catalog context — loaded once, used across tabs
function useCatalog() {
  const [catalog, setCatalog] = useState<PartsCatalogItem[]>([])
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    listPartsCatalog().then(setCatalog)
  }, [])
  return { catalog, setCatalog }
}

export default function FrameworkSettingsPage() {
  const [activeTab, setActiveTab] = useState(TABS[0])
  const { catalog, setCatalog } = useCatalog()

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure parts catalog, rate schedules, pricing matrices, and contract details</p>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Regions & Sites' && <RegionsSitesTab />}
      {activeTab === 'Schedule of Rates' && <Schedule4Tab />}
      {activeTab === 'Parts Catalog' && <PartsCatalogTab catalog={catalog} onCatalogChange={setCatalog} />}
      {activeTab === 'Other Charges' && <RateScheduleTab />}
      {activeTab === 'Parts Kits' && <PartsKitsTab catalog={catalog} />}
      {activeTab === 'KVA Pricing Matrix' && <KvaPricingTab catalog={catalog} />}
      {activeTab === 'SLA Thresholds' && <SlaThresholdsTab />}
      {activeTab === 'Contract Info' && <ContractInfoTab />}
    </div>
  )
}

// ── Paste Table Helper ────────────────────────────────────────────────────────

function parsePastedTable(text: string): string[][] {
  const lines = text.trim().split('\n').filter(r => r.trim())
  if (!lines.length) return []
  // Auto-detect delimiter: prefer tab if present, otherwise comma
  const delim = lines[0].includes('\t') ? '\t' : ','
  return lines.map(row => {
    if (delim === ',') {
      // Simple CSV parse: handles trailing commas, strips quotes
      return row.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    }
    return row.split('\t').map(c => c.trim())
  })
}

function PasteZone({ onPaste, hint }: { onPaste: (rows: string[][]) => void; hint: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  function apply() {
    const rows = parsePastedTable(text)
    if (rows.length) onPaste(rows)
    setText('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-amber-400 hover:text-amber-700 transition-colors"
      >
        <span>📋</span> Paste Table
      </button>
    )
  }

  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
      <p className="text-xs text-amber-700 font-medium mb-1">Paste from Excel/Sheets — {hint}</p>
      <textarea
        className="w-full h-32 border border-amber-300 rounded-lg p-2 text-xs font-mono focus:outline-none"
        placeholder="Paste tab-separated data here…"
        value={text}
        onChange={e => setText(e.target.value)}
        onPaste={e => {
          // auto-apply on paste event
          setTimeout(() => {
            const rows = parsePastedTable(e.currentTarget.value)
            if (rows.length) { onPaste(rows); setText(''); setOpen(false) }
          }, 50)
        }}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => setOpen(false)} className="px-3 py-1 text-xs text-gray-600">Cancel</button>
        <button onClick={apply} className="px-3 py-1 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>Apply</button>
      </div>
    </div>
  )
}

// ── Regions & Sites Tab ───────────────────────────────────────────────────────

type SiteRow = { site_code: string; site_name: string; region: string; physical_address: string; gps_lat: string; gps_lng: string; contact_name: string; contact_phone: string; notes: string }

function RegionsSitesTab() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const { framework } = useContext(FrameworkContext)
  const [regions, setRegions] = useState<string[]>(framework?.regions ?? [])
  const [sites, setSites] = useState<SiteRow[]>(
    (framework?.sites ?? []).map(s => ({
      site_code: s.site_code, site_name: s.site_name, region: s.region,
      physical_address: s.physical_address ?? '', gps_lat: String(s.gps_lat ?? ''),
      gps_lng: String(s.gps_lng ?? ''), contact_name: s.contact_name ?? '',
      contact_phone: s.contact_phone ?? '', notes: s.notes ?? '',
    }))
  )
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [newRegion, setNewRegion] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const regionSites = selectedRegion ? sites.filter(s => s.region === selectedRegion) : []

  function addRegion() {
    const r = newRegion.trim()
    if (!r || regions.includes(r)) return
    setRegions(prev => [...prev, r])
    setNewRegion('')
    setSelectedRegion(r)
  }

  function removeRegion(r: string) {
    setRegions(prev => prev.filter(x => x !== r))
    setSites(prev => prev.filter(s => s.region !== r))
    if (selectedRegion === r) setSelectedRegion(null)
  }

  function addSite() {
    if (!selectedRegion) return
    setSites(prev => [...prev, {
      site_code: '', site_name: '', region: selectedRegion,
      physical_address: '', gps_lat: '', gps_lng: '',
      contact_name: '', contact_phone: '', notes: '',
    }])
  }

  function updateSite(idx: number, field: keyof SiteRow, val: string) {
    setSites(prev => {
      const regionSiteIndices = prev.reduce<number[]>((acc, s, i) => {
        if (s.region === selectedRegion) acc.push(i)
        return acc
      }, [])
      const globalIdx = regionSiteIndices[idx]
      return prev.map((s, i) => i === globalIdx ? { ...s, [field]: val } : s)
    })
  }

  function removeSite(idx: number) {
    const regionSiteIndices = sites.reduce<number[]>((acc, s, i) => {
      if (s.region === selectedRegion) acc.push(i)
      return acc
    }, [])
    const globalIdx = regionSiteIndices[idx]
    setSites(prev => prev.filter((_, i) => i !== globalIdx))
  }

  function handleRegionPaste(rows: string[][]) {
    const newRegions = rows.map(r => r[0]?.trim()).filter(r => r && !regions.includes(r))
    setRegions(prev => [...prev, ...newRegions])
  }

  function handleSitePaste(rows: string[][]) {
    if (!selectedRegion) return
    // Site Code | Site Name | Address | GPS Lat | GPS Lng | Contact Name | Contact Phone | Notes
    const newSites: SiteRow[] = rows.filter(cols => cols[0]?.trim() && cols[1]?.trim()).map(cols => ({
      site_code: cols[0]?.trim() ?? '',
      site_name: cols[1]?.trim() ?? '',
      region: selectedRegion,
      physical_address: cols[2]?.trim() ?? '',
      gps_lat: cols[3]?.trim() ?? '',
      gps_lng: cols[4]?.trim() ?? '',
      contact_name: cols[5]?.trim() ?? '',
      contact_phone: cols[6]?.trim() ?? '',
      notes: cols[7]?.trim() ?? '',
    }))
    setSites(prev => [...prev, ...newSites])
  }

  async function handleSave() {
    if (!frameworkId) return
    setSaving(true); setError('')
    try {
      await updateRegionsSites(frameworkId, {
        regions,
        sites: sites.filter(s => s.site_code && s.site_name).map(s => ({
          site_code: s.site_code, site_name: s.site_name, region: s.region,
          physical_address: s.physical_address || undefined,
          gps_lat: s.gps_lat ? Number(s.gps_lat) : undefined,
          gps_lng: s.gps_lng ? Number(s.gps_lng) : undefined,
          contact_name: s.contact_name || undefined,
          contact_phone: s.contact_phone || undefined,
          notes: s.notes || undefined,
        })),
      })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Regions & Sites</h2>
          <p className="text-xs text-gray-500 mt-0.5">Define regions and their sites — used as dropdowns when adding assets, schedules, and work orders.</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
          style={{ backgroundColor: saved ? '#16a34a' : ACCENT }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save All'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}

      <div className="flex gap-5">
        {/* Regions panel */}
        <div className="w-56 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700">Regions ({regions.length})</h3>
            <PasteZone onPaste={handleRegionPaste} hint="Region name (one per row)" />
          </div>

          <div className="flex gap-1 mb-3">
            <input
              value={newRegion}
              onChange={e => setNewRegion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRegion()}
              placeholder="Add region…"
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <button onClick={addRegion} disabled={!newRegion.trim()}
              className="px-2 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40"
              style={{ backgroundColor: ACCENT }}>+</button>
          </div>

          <div className="space-y-1">
            {regions.map(r => (
              <div key={r}
                onClick={() => setSelectedRegion(r)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-all ${
                  selectedRegion === r ? 'text-white font-semibold' : 'bg-gray-50 text-gray-700 hover:bg-amber-50'
                }`}
                style={selectedRegion === r ? { backgroundColor: ACCENT } : {}}
              >
                <span className="truncate">{r}</span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className={`text-[10px] ${selectedRegion === r ? 'text-amber-100' : 'text-gray-400'}`}>
                    {sites.filter(s => s.region === r).length}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); removeRegion(r) }}
                    className={`text-sm leading-none ${selectedRegion === r ? 'text-amber-200 hover:text-white' : 'text-gray-300 hover:text-red-400'}`}
                  >×</button>
                </div>
              </div>
            ))}
            {regions.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
                <p className="text-xs text-gray-400">No regions yet.</p>
                <p className="text-[10px] text-gray-300">Type above or paste</p>
              </div>
            )}
          </div>
        </div>

        {/* Sites panel */}
        <div className="flex-1 min-w-0">
          {!selectedRegion ? (
            <div className="flex items-center justify-center h-48 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-sm text-gray-400">← Select a region to manage its sites</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-700">Sites in <span style={{ color: ACCENT }}>{selectedRegion}</span> ({regionSites.length})</h3>
                <div className="flex gap-2">
                  <PasteZone onPaste={handleSitePaste} hint="Site Code | Site Name | Address | Lat | Lng | Contact | Phone | Notes" />
                  <button onClick={addSite} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Site</button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 w-28">Site Code</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500">Site Name</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500">Address</th>
                      <th className="text-right px-3 py-3 font-semibold text-gray-500 w-20">GPS Lat</th>
                      <th className="text-right px-3 py-3 font-semibold text-gray-500 w-20">GPS Lng</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500">Contact</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500">Phone</th>
                      <th className="px-3 py-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {regionSites.map((site, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5">
                          <input value={site.site_code} onChange={e => updateSite(i, 'site_code', e.target.value)}
                            placeholder="GIG-001"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={site.site_name} onChange={e => updateSite(i, 'site_name', e.target.value)}
                            placeholder="Site name *"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={site.physical_address} onChange={e => updateSite(i, 'physical_address', e.target.value)}
                            placeholder="Physical address"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" value={site.gps_lat} onChange={e => updateSite(i, 'gps_lat', e.target.value)}
                            placeholder="-1.28"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" value={site.gps_lng} onChange={e => updateSite(i, 'gps_lng', e.target.value)}
                            placeholder="36.82"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right font-mono focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={site.contact_name} onChange={e => updateSite(i, 'contact_name', e.target.value)}
                            placeholder="Contact name"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={site.contact_phone} onChange={e => updateSite(i, 'contact_phone', e.target.value)}
                            placeholder="+254…"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => removeSite(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                        </td>
                      </tr>
                    ))}
                    {regionSites.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-xs">
                          No sites in {selectedRegion} yet. Add rows or paste from a spreadsheet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Schedule 4 – Schedule of Rates ───────────────────────────────────────────

type Sch4Row = {
  site_code: string; site_name: string; region: string; brand: string
  kva_rating: string; cost_a: string; cost_b: string; cost_c: string; notes: string
}

function blankSch4Row(): Sch4Row {
  return { site_code: '', site_name: '', region: '', brand: '', kva_rating: '', cost_a: '', cost_b: '', cost_c: '', notes: '' }
}

function Schedule4Tab() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const { framework } = useContext(FrameworkContext)
  const [rows, setRows] = useState<Sch4Row[]>(() =>
    (framework?.schedule4_entries ?? []).map(e => ({
      site_code: e.site_code ?? '',
      site_name: e.site_name,
      region: e.region,
      brand: e.brand ?? '',
      kva_rating: e.kva_rating ?? '',
      cost_a: String(e.cost_a || ''),
      cost_b: String(e.cost_b || ''),
      cost_c: String(e.cost_c || ''),
      notes: e.notes ?? '',
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)

  const regions = framework?.regions ?? []
  const sites = framework?.sites ?? []

  function updateRow(i: number, field: keyof Sch4Row, val: string) {
    setRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }

  function addRow() { setRows(prev => [...prev, blankSch4Row()]) }
  function removeRow(i: number) { setRows(prev => prev.filter((_, j) => j !== i)) }

  function onRegionSelect(i: number, region: string) {
    const sitesInRegion = sites.filter(s => s.region === region)
    // Auto-fill first site in region if row has no site yet
    const row = rows[i]
    if (!row.site_name && sitesInRegion.length === 1) {
      setRows(prev => prev.map((r, j) => j === i ? { ...r, region, site_code: sitesInRegion[0].site_code, site_name: sitesInRegion[0].site_name } : r))
    } else {
      setRows(prev => prev.map((r, j) => j === i ? { ...r, region } : r))
    }
  }

  function onSiteSelect(i: number, siteCode: string) {
    const site = sites.find(s => s.site_code === siteCode)
    if (site) {
      setRows(prev => prev.map((r, j) => j === i ? { ...r, site_code: site.site_code, site_name: site.site_name, region: site.region } : r))
    }
  }

  function computeD(r: Sch4Row): number {
    return (parseFloat(r.cost_a) || 0) + (parseFloat(r.cost_b) || 0) + (parseFloat(r.cost_c) || 0)
  }

  function handlePaste(pasted: string[][]) {
    // Expected columns: Site Code | Site Name | Region | Brand | KVA | Cost A | Cost B | Cost C | Notes
    const newRows: Sch4Row[] = pasted.map(cols => ({
      site_code: cols[0] ?? '',
      site_name: cols[1] ?? '',
      region: cols[2] ?? '',
      brand: cols[3] ?? '',
      kva_rating: cols[4] ?? '',
      cost_a: cols[5] ?? '',
      cost_b: cols[6] ?? '',
      cost_c: cols[7] ?? '',
      notes: cols[8] ?? '',
    })).filter(r => r.site_name || r.region)
    setRows(prev => [...prev, ...newRows])
    setPasteOpen(false)
  }

  async function save() {
    if (!frameworkId) return
    setSaving(true); setError(''); setSaved(false)
    try {
      const entries: Schedule4EntryPayload[] = rows
        .filter(r => r.site_name.trim() && r.region.trim())
        .map(r => ({
          site_code: r.site_code || undefined,
          site_name: r.site_name,
          region: r.region,
          brand: r.brand || undefined,
          kva_rating: r.kva_rating || undefined,
          cost_a: parseFloat(r.cost_a) || 0,
          cost_b: parseFloat(r.cost_b) || 0,
          cost_c: parseFloat(r.cost_c) || 0,
          notes: r.notes || undefined,
        }))
      await updateSchedule4(frameworkId, entries)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setError(extractApiError(e).message)
    } finally {
      setSaving(false)
    }
  }

  const totalA = rows.reduce((s, r) => s + (parseFloat(r.cost_a) || 0), 0)
  const totalB = rows.reduce((s, r) => s + (parseFloat(r.cost_b) || 0), 0)
  const totalC = rows.reduce((s, r) => s + (parseFloat(r.cost_c) || 0), 0)
  const totalD = totalA + totalB + totalC

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          {/* <h2 className="text-sm font-bold text-gray-900">Schedule 4 – Schedule of Rates</h2> */}
          <p className="text-xs text-gray-500 mt-0.5">
            Per-site annual pricing: A = 2 PM services · B = 2 technical inspections · C = unlimited attendance · D = A+B+C
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPasteOpen(v => !v)}
            className="px-3 py-1.5 text-xs font-semibold border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
            📋 Paste Table
          </button>
          <button onClick={addRow}
            className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
            + Add Row
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save All'}
          </button>
        </div>
      </div>

      {pasteOpen && (
        <PasteZone
          onPaste={handlePaste}
          hint="Site Code | Site Name | Region | Brand | KVA | Cost A (KES) | Cost B (KES) | Cost C (KES) | Notes"
        />
      )}

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 w-24">Site Code</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Site Name</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 w-32">Region</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 w-28">Brand</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 w-24">KVA</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500 w-28">
                <span title="2 PM services/year – VAT inclusive (labour, consumables, accom, transport, excl. spare parts)">A (KES)</span>
              </th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500 w-28">
                <span title="2 technical inspections/year – VAT inclusive (labour, accom, transport, excl. spare parts)">B (KES)</span>
              </th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500 w-28">
                <span title="Annual unlimited attendance – VAT inclusive (labour, accom, transport, excl. spare parts)">C (KES)</span>
              </th>
              <th className="text-right px-3 py-3 font-semibold text-blue-600 w-28">D=A+B+C</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-amber-50/30">
                {/* Site Code / Site selector */}
                <td className="px-3 py-2">
                  {sites.length > 0 ? (
                    <select value={r.site_code}
                      onChange={e => onSiteSelect(i, e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none bg-white">
                      <option value="">— pick —</option>
                      {sites.map(s => (
                        <option key={s.site_code} value={s.site_code}>{s.site_code}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={r.site_code} onChange={e => updateRow(i, 'site_code', e.target.value)}
                      placeholder="GIG-001"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                  )}
                </td>
                {/* Site Name */}
                <td className="px-3 py-2">
                  <input value={r.site_name} onChange={e => updateRow(i, 'site_name', e.target.value)}
                    placeholder="Gigiri Branch"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                {/* Region */}
                <td className="px-3 py-2">
                  {regions.length > 0 ? (
                    <select value={r.region} onChange={e => onRegionSelect(i, e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none bg-white">
                      <option value="">— pick —</option>
                      {regions.map(rg => <option key={rg} value={rg}>{rg}</option>)}
                    </select>
                  ) : (
                    <input value={r.region} onChange={e => updateRow(i, 'region', e.target.value)}
                      placeholder="Central"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                  )}
                </td>
                {/* Brand */}
                <td className="px-3 py-2">
                  <input value={r.brand} onChange={e => updateRow(i, 'brand', e.target.value)}
                    placeholder="Cummins"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                {/* KVA */}
                <td className="px-3 py-2">
                  <input value={r.kva_rating} onChange={e => updateRow(i, 'kva_rating', e.target.value)}
                    placeholder="100 KVA"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                {/* Cost A */}
                <td className="px-3 py-2">
                  <input type="number" value={r.cost_a} onChange={e => updateRow(i, 'cost_a', e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                {/* Cost B */}
                <td className="px-3 py-2">
                  <input type="number" value={r.cost_b} onChange={e => updateRow(i, 'cost_b', e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                {/* Cost C */}
                <td className="px-3 py-2">
                  <input type="number" value={r.cost_c} onChange={e => updateRow(i, 'cost_c', e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                {/* Total D (computed) */}
                <td className="px-3 py-2 text-right font-semibold text-blue-700 tabular-nums">
                  {computeD(r).toLocaleString()}
                </td>
                {/* Notes */}
                <td className="px-3 py-2">
                  <input value={r.notes} onChange={e => updateRow(i, 'notes', e.target.value)}
                    placeholder="Optional"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-400">
                  No entries yet — click <strong>+ Add Row</strong> or <strong>Paste Table</strong> to import from Excel.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-gray-500">Totals ({rows.length} rows)</td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-gray-700 tabular-nums">{totalA.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-gray-700 tabular-nums">{totalB.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-gray-700 tabular-nums">{totalC.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs font-bold text-blue-700 tabular-nums">{totalD.toLocaleString()}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { code: 'A', label: 'Cost A', desc: '2 full PM services/year — VAT incl. Labour, consumables, accommodation & transport. Excl. breakdown spare parts.' },
          { code: 'B', label: 'Cost B', desc: '2 technical inspections/year — VAT incl. Labour, accommodation & transport. Excl. spare parts.' },
          { code: 'C', label: 'Cost C', desc: 'Annual unlimited attendance — VAT incl. Labour, accommodation & transport. Excl. spare parts.' },
          { code: 'D', label: 'Total D = A+B+C', desc: 'Total annual cost: 2 services + 2 tech visits + unlimited attendance premium.' },
        ].map(({ code, label, desc }) => (
          <div key={code} className={`rounded-lg p-3 text-xs border ${code === 'D' ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
            <p className={`font-bold mb-1 ${code === 'D' ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
            <p className="text-gray-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Parts Catalog Tab ─────────────────────────────────────────────────────────

function PartsCatalogTab({ catalog, onCatalogChange }: { catalog: PartsCatalogItem[]; onCatalogChange: (c: PartsCatalogItem[]) => void }) {
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ part_name: '', part_number: '', category: '', unit: 'unit', unit_cost: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const categories = [...new Set(catalog.map(p => p.category).filter(Boolean) as string[])]

  const filtered = search
    ? catalog.filter(p => p.part_name.toLowerCase().includes(search.toLowerCase()) || (p.part_number && p.part_number.toLowerCase().includes(search.toLowerCase())))
    : catalog

  async function handleAdd() {
    if (!form.part_name.trim()) { setError('Part name is required'); return }
    setSaving(true); setError('')
    try {
      const item = await createPartsCatalogItem({
        part_name: form.part_name,
        part_number: form.part_number || undefined,
        category: form.category || undefined,
        unit: form.unit || 'unit',
        unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : undefined,
        notes: form.notes || undefined,
      })
      onCatalogChange([...catalog, item])
      setForm({ part_name: '', part_number: '', category: '', unit: 'unit', unit_cost: '', notes: '' })
      setAdding(false)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  async function handleUpdate(id: string) {
    const item = catalog.find(c => c.id === id)
    if (!item) return
    setSaving(true); setError('')
    try {
      const updated = await updatePartsCatalogItem(id, {
        part_name: form.part_name || item.part_name,
        part_number: form.part_number || item.part_number,
        category: form.category || item.category,
        unit: form.unit || item.unit,
        unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : item.unit_cost,
        notes: form.notes || item.notes,
      })
      onCatalogChange(catalog.map(c => c.id === id ? updated : c))
      setEditId(null)
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    try {
      await deletePartsCatalogItem(id)
      onCatalogChange(catalog.filter(c => c.id !== id))
    } catch {}
  }

  function startEdit(item: PartsCatalogItem) {
    setEditId(item.id)
    setForm({ part_name: item.part_name, part_number: item.part_number ?? '', category: item.category ?? '', unit: item.unit, unit_cost: item.unit_cost != null ? String(item.unit_cost) : '', notes: item.notes ?? '' })
  }

  function handlePaste(rows: string[][]) {
    // Part Name | Part No. | Category | Unit | Unit Cost | Notes
    const items = rows.map(cols => ({
      part_name: cols[0] ?? '',
      part_number: cols[1] || undefined,
      category: cols[2] || undefined,
      unit: cols[3] || 'unit',
      unit_cost: cols[4] ? (parseFloat(cols[4].replace(/,/g, '')) || undefined) : undefined,
      notes: cols[5] || undefined,
    })).filter(i => i.part_name.trim())
    if (!items.length) return
    setSaving(true)
    bulkImportParts(items).then(created => {
      onCatalogChange([...catalog, ...created])
    }).finally(() => setSaving(false))
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    try {
      const created = await uploadPartsCatalogCsv(file)
      onCatalogChange([...catalog, ...created])
    } catch (err) { setError(extractApiError(err).message) }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Parts Catalog</h2>
          <p className="text-xs text-gray-500 mt-0.5">Org-wide master list of spare parts. Used as dropdown in pricing matrices and parts kits.</p>
        </div>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Part Name | Part No. | Category | Unit | Unit Cost | Notes" />
          <button onClick={() => fileRef.current?.click()} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:border-amber-400 hover:text-amber-700 transition-colors disabled:opacity-50">
            📁 Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          <button onClick={() => { setAdding(true); setError('') }} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
            + Add Part
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {/* Search */}
      <div className="mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or part number…"
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Part Name</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 font-mono">Part Number</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Category</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Unit</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Unit Cost (KES)</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {/* Add row */}
            {adding && (
              <tr className="bg-amber-50">
                <td className="px-4 py-2">
                  <input autoFocus value={form.part_name} onChange={e => setForm(p => ({ ...p, part_name: e.target.value }))} placeholder="Part name *"
                    className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={form.part_number} onChange={e => setForm(p => ({ ...p, part_number: e.target.value }))} placeholder="e.g. 4089122"
                    className="w-full border border-amber-200 rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. Filters" list="cat-opts"
                    className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                  <datalist id="cat-opts">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </td>
                <td className="px-3 py-2">
                  <input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} placeholder="unit"
                    className="w-24 border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} placeholder="0.00"
                    className="w-full border border-amber-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional"
                    className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button onClick={handleAdd} disabled={saving} className="px-2 py-1 text-[10px] font-semibold text-white rounded disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                      {saving ? '…' : 'Add'}
                    </button>
                    <button onClick={() => setAdding(false)} className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700">×</button>
                  </div>
                </td>
              </tr>
            )}

            {filtered.map(item => (
              <tr key={item.id} className="hover:bg-gray-50 group">
                {editId === item.id ? (
                  <>
                    <td className="px-4 py-1.5">
                      <input autoFocus value={form.part_name} onChange={e => setForm(p => ({ ...p, part_name: e.target.value }))}
                        className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={form.part_number} onChange={e => setForm(p => ({ ...p, part_number: e.target.value }))}
                        className="w-full border border-amber-200 rounded px-2 py-1 text-xs font-mono focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} list="cat-opts"
                        className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                        className="w-20 border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} placeholder="0.00"
                        className="w-full border border-amber-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="optional"
                        className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(item.id)} disabled={saving} className="px-2 py-1 text-[10px] font-semibold text-white rounded disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => setEditId(null)} className="px-2 py-1 text-[10px] text-gray-500">×</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{item.part_name}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-500">{item.part_number ?? <span className="text-gray-200">—</span>}</td>
                    <td className="px-3 py-2.5 text-gray-500">{item.category ?? <span className="text-gray-200">—</span>}</td>
                    <td className="px-3 py-2.5 text-gray-500">{item.unit}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                      {item.unit_cost != null ? item.unit_cost.toLocaleString() : <span className="text-gray-200">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-[10px]">{item.notes ?? ''}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(item)} className="px-2 py-1 text-[10px] text-gray-500 border border-gray-200 rounded hover:border-amber-400 hover:text-amber-600">Edit</button>
                        <button onClick={() => handleDelete(item.id)} className="px-2 py-1 text-[10px] text-red-400 border border-red-100 rounded hover:border-red-300">Del</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {filtered.length === 0 && !adding && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="text-2xl mb-2">🔩</div>
                  <p className="text-sm text-gray-500">No parts in catalog yet.</p>
                  <p className="text-xs text-gray-400">Add parts manually, paste from a spreadsheet, or upload a CSV file.</p>
                  <p className="text-xs text-gray-400 mt-1">CSV columns: <span className="font-mono">Part Name, Part Number, Category, Unit, Unit Cost, Notes</span></p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {catalog.length > 0 && (
        <p className="text-xs text-gray-400 mt-2 text-right">{catalog.length} parts in catalog</p>
      )}
    </div>
  )
}

// ── Schedule of Rates Tab ─────────────────────────────────────────────────────

const DEFAULT_LABOUR = [
  { role: 'Lead Technician', rate_per_day: 35000, rate_per_hour: undefined, notes: '' },
  { role: 'Assistant Technician', rate_per_day: 20000, rate_per_hour: undefined, notes: '' },
  { role: 'Engineer (Specialist)', rate_per_day: 60000, rate_per_hour: undefined, notes: '' },
  { role: 'Overtime (per hour)', rate_per_day: 0, rate_per_hour: 5000, notes: 'After 8hrs' },
]

type LabourRow = { role: string; rate_per_day: number; rate_per_hour?: number; notes?: string }
type AccomRow = { region: string; rate_per_day: number; notes?: string }
type PersonnelTransRow = { region: string; transport_mode: 'road' | 'air'; rate_per_km?: number; fixed_rate?: number; notes?: string }
type GenTransRow = { region: string; description: string; rate_per_km?: number; fixed_rate?: number; notes?: string }
type SiteOverrideRow = { site_code: string; site_name: string; multiplier?: number; notes?: string }

function RateScheduleTab() {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [schedules, setSchedules] = useState<RateSchedule[]>([])
  const [activeTier, setActiveTier] = useState<'A' | 'B' | 'C'>('A')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [expiryDate, setExpiryDate] = useState('')
  const [labour, setLabour] = useState<LabourRow[]>(DEFAULT_LABOUR)
  const [accom, setAccom] = useState<AccomRow[]>([])
  const [personnelTrans, setPersonnelTrans] = useState<PersonnelTransRow[]>([])
  const [genTrans, setGenTrans] = useState<GenTransRow[]>([])
  const [siteOverrides, setSiteOverrides] = useState<SiteOverrideRow[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [section, setSection] = useState('labour')

  useEffect(() => {
    if (!frameworkId) return
    listRateSchedules(frameworkId).then(s => {
      setSchedules(s)
      loadTier(s, activeTier)
    }).finally(() => setLoading(false))
  }, [frameworkId])

  function loadTier(s: RateSchedule[], tier: 'A' | 'B' | 'C') {
    const found = s.find(x => x.pricing_tier === tier)
    if (found) {
      setEffectiveDate(found.effective_date)
      setExpiryDate(found.expiry_date ?? '')
      setLabour(found.labour_rates.length ? found.labour_rates : DEFAULT_LABOUR)
      setAccom(found.accommodation_rates)
      setPersonnelTrans(found.personnel_transport_rates as PersonnelTransRow[])
      setGenTrans(found.generator_transport_rates as GenTransRow[])
      setSiteOverrides(found.site_overrides as SiteOverrideRow[])
      setNotes(found.notes ?? '')
    } else {
      setEffectiveDate(new Date().toISOString().slice(0, 10))
      setExpiryDate('')
      setLabour(DEFAULT_LABOUR)
      setAccom([])
      setPersonnelTrans([])
      setGenTrans([])
      setSiteOverrides([])
      setNotes('')
    }
  }

  function switchTier(tier: 'A' | 'B' | 'C') {
    setActiveTier(tier)
    loadTier(schedules, tier)
  }

  async function handleSave() {
    if (!frameworkId) return
    setSaving(true)
    try {
      const result = await upsertRateSchedule(frameworkId, {
        pricing_tier: activeTier,
        effective_date: effectiveDate,
        expiry_date: expiryDate || undefined,
        is_active: true,
        labour_rates: labour.filter(r => r.role),
        accommodation_rates: accom.filter(r => r.region),
        personnel_transport_rates: personnelTrans.filter(r => r.region),
        generator_transport_rates: genTrans.filter(r => r.region),
        site_overrides: siteOverrides.filter(r => r.site_code),
        notes: notes || undefined,
      })
      setSchedules(prev => {
        const existing = prev.findIndex(s => s.pricing_tier === activeTier)
        if (existing >= 0) { const n = [...prev]; n[existing] = result; return n }
        return [...prev, result]
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 flex justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>

  const SECTIONS = [
    { id: 'labour', label: 'Labour Rates' },
    { id: 'accommodation', label: 'Accommodation' },
    { id: 'personnel_transport', label: 'Personnel Transport' },
    { id: 'generator_transport', label: 'Generator Transport' },
    { id: 'site_overrides', label: 'Site Overrides' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Schedule of Rates</h2>
          <p className="text-xs text-gray-500 mt-0.5">Define labour, accommodation, transport, and site-specific rates per pricing tier.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tier selector */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['A', 'B', 'C'] as const).map(tier => (
              <button
                key={tier}
                onClick={() => switchTier(tier)}
                className={`px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTier === tier
                    ? 'text-white'
                    : 'text-gray-500 hover:text-gray-700 bg-white'
                }`}
                style={activeTier === tier ? { backgroundColor: ACCENT } : {}}
              >
                Tier {tier}
                {schedules.find(s => s.pricing_tier === tier) && (
                  <span className="ml-1 w-1.5 h-1.5 bg-green-400 rounded-full inline-block" />
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: saved ? '#16a34a' : ACCENT }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Tier ' + activeTier}
          </button>
        </div>
      </div>

      {/* Effective dates */}
      <div className="flex gap-4 mb-5 bg-gray-50 rounded-xl p-4 border border-gray-100">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Effective From</label>
          <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Expiry Date (optional)</label>
          <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Revised rates effective Q2 2026"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
      </div>

      {/* Sub-section tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-100 pb-2">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              section === s.id ? 'text-white' : 'text-gray-500 hover:text-gray-700 bg-gray-50'
            }`}
            style={section === s.id ? { backgroundColor: ACCENT } : {}}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'labour' && (
        <LabourRatesSection rows={labour} onChange={setLabour} />
      )}
      {section === 'accommodation' && (
        <AccommodationSection rows={accom} onChange={setAccom} />
      )}
      {section === 'personnel_transport' && (
        <PersonnelTransportSection rows={personnelTrans} onChange={setPersonnelTrans} />
      )}
      {section === 'generator_transport' && (
        <GeneratorTransportSection rows={genTrans} onChange={setGenTrans} />
      )}
      {section === 'site_overrides' && (
        <SiteOverridesSection rows={siteOverrides} onChange={setSiteOverrides} />
      )}
    </div>
  )
}

function LabourRatesSection({ rows, onChange }: { rows: LabourRow[]; onChange: (r: LabourRow[]) => void }) {
  function addRow() {
    onChange([...rows, { role: '', rate_per_day: 0, rate_per_hour: undefined, notes: '' }])
  }
  function remove(i: number) { onChange(rows.filter((_, j) => j !== i)) }
  function update(i: number, field: keyof LabourRow, val: string | number) {
    onChange(rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }

  function handlePaste(pasted: string[][]) {
    // Expected columns: Role | Rate/Day | Rate/Hour | Notes
    const newRows: LabourRow[] = pasted.map(cols => ({
      role: cols[0] ?? '',
      rate_per_day: parseFloat(cols[1]?.replace(/,/g, '') ?? '0') || 0,
      rate_per_hour: cols[2] ? parseFloat(cols[2].replace(/,/g, '')) || undefined : undefined,
      notes: cols[3] ?? '',
    }))
    onChange([...rows, ...newRows])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Labour charges per day/hour for personnel attending generator works.</p>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Role | Rate/Day (KES) | Rate/Hour | Notes" />
          <button onClick={addRow} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Row</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Role / Description</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Rate/Day (KES)</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Rate/Hour (KES)</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <input value={r.role} onChange={e => update(i, 'role', e.target.value)} placeholder="e.g. Lead Technician"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-300" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.rate_per_day || ''} onChange={e => update(i, 'rate_per_day', Number(e.target.value))}
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-300" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.rate_per_hour ?? ''} onChange={e => update(i, 'rate_per_hour', e.target.value ? Number(e.target.value) : undefined as any)}
                    placeholder="—"
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-300" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.notes ?? ''} onChange={e => update(i, 'notes', e.target.value)} placeholder="optional"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-base leading-none">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">No labour rates defined. Add rows or paste from a spreadsheet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AccommodationSection({ rows, onChange }: { rows: AccomRow[]; onChange: (r: AccomRow[]) => void }) {
  function addRow() { onChange([...rows, { region: '', rate_per_day: 0, notes: '' }]) }
  function remove(i: number) { onChange(rows.filter((_, j) => j !== i)) }
  function update(i: number, field: keyof AccomRow, val: string | number) {
    onChange(rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }
  function handlePaste(pasted: string[][]) {
    const newRows: AccomRow[] = pasted.map(cols => ({
      region: cols[0] ?? '',
      rate_per_day: parseFloat(cols[1]?.replace(/,/g, '') ?? '0') || 0,
      notes: cols[2] ?? '',
    }))
    onChange([...rows, ...newRows])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Accommodation charges per day for personnel attending major generator repairs.</p>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Region | Rate/Day (KES) | Notes" />
          <button onClick={addRow} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Region</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Region</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Rate/Day (KES)</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <input value={r.region} onChange={e => update(i, 'region', e.target.value)} placeholder="e.g. Nairobi, Mombasa, Rift Valley"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.rate_per_day || ''} onChange={e => update(i, 'rate_per_day', Number(e.target.value))}
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.notes ?? ''} onChange={e => update(i, 'notes', e.target.value)} placeholder="optional"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">No accommodation rates defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PersonnelTransportSection({ rows, onChange }: { rows: PersonnelTransRow[]; onChange: (r: PersonnelTransRow[]) => void }) {
  function addRow(mode: 'road' | 'air') {
    onChange([...rows, { region: '', transport_mode: mode, rate_per_km: undefined, fixed_rate: undefined, notes: '' }])
  }
  function remove(i: number) { onChange(rows.filter((_, j) => j !== i)) }
  function update(i: number, field: keyof PersonnelTransRow, val: any) {
    onChange(rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }
  function handlePaste(pasted: string[][]) {
    // Region | Mode (road/air) | Rate/km | Fixed Rate | Notes
    const newRows: PersonnelTransRow[] = pasted.map(cols => ({
      region: cols[0] ?? '',
      transport_mode: (cols[1]?.toLowerCase() === 'air' ? 'air' : 'road') as 'road' | 'air',
      rate_per_km: cols[2] ? parseFloat(cols[2].replace(/,/g, '')) || undefined : undefined,
      fixed_rate: cols[3] ? parseFloat(cols[3].replace(/,/g, '')) || undefined : undefined,
      notes: cols[4] ?? '',
    }))
    onChange([...rows, ...newRows])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Transport costs for personnel to attend generator works — by road (per km) or by air (fixed).</p>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Region | Mode (road/air) | Rate/km | Fixed Rate | Notes" />
          <button onClick={() => addRow('road')} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Road</button>
          <button onClick={() => addRow('air')} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg bg-sky-600 hover:bg-sky-700">+ Air</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Region</th>
              <th className="text-center px-3 py-3 font-semibold text-gray-500">Mode</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Rate/km (KES)</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Fixed Rate (KES)</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <input value={r.region} onChange={e => update(i, 'region', e.target.value)} placeholder="Region"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.transport_mode === 'air' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>
                    {r.transport_mode === 'air' ? '✈ Air' : '🚗 Road'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.rate_per_km ?? ''} onChange={e => update(i, 'rate_per_km', e.target.value ? Number(e.target.value) : undefined)}
                    disabled={r.transport_mode === 'air'} placeholder={r.transport_mode === 'air' ? 'N/A' : '80'}
                    className="w-24 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none disabled:bg-gray-50 disabled:text-gray-300" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.fixed_rate ?? ''} onChange={e => update(i, 'fixed_rate', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="optional"
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.notes ?? ''} onChange={e => update(i, 'notes', e.target.value)} placeholder="optional"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">No personnel transport rates defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GeneratorTransportSection({ rows, onChange }: { rows: GenTransRow[]; onChange: (r: GenTransRow[]) => void }) {
  function addRow() { onChange([...rows, { region: '', description: 'Emergency Generator Transport', rate_per_km: undefined, fixed_rate: undefined, notes: '' }]) }
  function remove(i: number) { onChange(rows.filter((_, j) => j !== i)) }
  function update(i: number, field: keyof GenTransRow, val: any) {
    onChange(rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }
  function handlePaste(pasted: string[][]) {
    const newRows: GenTransRow[] = pasted.map(cols => ({
      region: cols[0] ?? '',
      description: cols[1] ?? 'Emergency Generator Transport',
      rate_per_km: cols[2] ? parseFloat(cols[2].replace(/,/g, '')) || undefined : undefined,
      fixed_rate: cols[3] ? parseFloat(cols[3].replace(/,/g, '')) || undefined : undefined,
      notes: cols[4] ?? '',
    }))
    onChange([...rows, ...newRows])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Transport for generator and materials — emergency cases only.</p>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Region | Description | Rate/km | Fixed Rate | Notes" />
          <button onClick={addRow} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Region</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Region</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Description</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Rate/km (KES)</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Fixed Rate (KES)</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <input value={r.region} onChange={e => update(i, 'region', e.target.value)} placeholder="Region"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.description} onChange={e => update(i, 'description', e.target.value)}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.rate_per_km ?? ''} onChange={e => update(i, 'rate_per_km', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="—"
                    className="w-24 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" value={r.fixed_rate ?? ''} onChange={e => update(i, 'fixed_rate', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="—"
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.notes ?? ''} onChange={e => update(i, 'notes', e.target.value)} placeholder="optional"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">No generator transport rates defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SiteOverridesSection({ rows, onChange }: { rows: SiteOverrideRow[]; onChange: (r: SiteOverrideRow[]) => void }) {
  function addRow() { onChange([...rows, { site_code: '', site_name: '', multiplier: undefined, notes: '' }]) }
  function remove(i: number) { onChange(rows.filter((_, j) => j !== i)) }
  function update(i: number, field: keyof SiteOverrideRow, val: any) {
    onChange(rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }
  function handlePaste(pasted: string[][]) {
    const newRows: SiteOverrideRow[] = pasted.map(cols => ({
      site_code: cols[0] ?? '',
      site_name: cols[1] ?? '',
      multiplier: cols[2] ? parseFloat(cols[2]) || undefined : undefined,
      notes: cols[3] ?? '',
    }))
    onChange([...rows, ...newRows])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Site-specific rate multipliers (e.g. 1.2 = +20% surcharge for remote sites).</p>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Site Code | Site Name | Multiplier | Notes" />
          <button onClick={addRow} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Site</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-500">Site Code</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Site Name</th>
              <th className="text-right px-3 py-3 font-semibold text-gray-500">Multiplier</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <input value={r.site_code} onChange={e => update(i, 'site_code', e.target.value)} placeholder="GIG-001"
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.site_name} onChange={e => update(i, 'site_name', e.target.value)} placeholder="Site Name"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.01" value={r.multiplier ?? ''} onChange={e => update(i, 'multiplier', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="1.0"
                    className="w-20 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                </td>
                <td className="px-3 py-2">
                  <input value={r.notes ?? ''} onChange={e => update(i, 'notes', e.target.value)} placeholder="e.g. Remote site surcharge"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">No site overrides defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Parts Kits Tab ────────────────────────────────────────────────────────────

type KitItemRow = { part_number: string; part_name: string; quantity: number; unit: string; unit_price: string; notes: string }

function PartsKitsTab({ catalog }: { catalog: PartsCatalogItem[] }) {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [kits, setKits] = useState<SparePartsKit[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKit, setSelectedKit] = useState<SparePartsKit | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!frameworkId) return
    listPartsKits(frameworkId).then(setKits).finally(() => setLoading(false))
  }, [frameworkId])

  async function handleDelete(kit: SparePartsKit) {
    if (!frameworkId) return
    setDeleting(kit.id)
    try {
      await deletePartsKit(frameworkId, kit.id)
      setKits(prev => prev.filter(k => k.id !== kit.id))
      if (selectedKit?.id === kit.id) setSelectedKit(null)
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <div className="py-12 flex justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex gap-6">
      {/* Kit list */}
      <div className="w-72 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Parts Kits</h2>
          <button onClick={() => { setShowCreate(true); setSelectedKit(null) }} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
            + New Kit
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">Engine/model-specific spare parts lists with part numbers and quantities.</p>
        <div className="space-y-2">
          {kits.map(kit => (
            <div
              key={kit.id}
              onClick={() => { setSelectedKit(kit); setShowCreate(false) }}
              className={`rounded-xl border p-3 cursor-pointer transition-all ${
                selectedKit?.id === kit.id ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-amber-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{kit.kit_name}</p>
                  {(kit.engine_make || kit.engine_model) && (
                    <p className="text-[10px] text-gray-500">{[kit.engine_make, kit.engine_model].filter(Boolean).join(' ')}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      kit.validity_type === 'emergency' ? 'bg-red-100 text-red-700' :
                      kit.validity_type === 'seasonal' ? 'bg-blue-100 text-blue-700' :
                      'bg-green-100 text-green-700'
                    }`}>{kit.validity_type}</span>
                    <span className="text-[10px] text-gray-400">{kit.items.length} parts</span>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(kit) }}
                  disabled={deleting === kit.id}
                  className="ml-2 text-gray-300 hover:text-red-400 text-sm"
                >
                  {deleting === kit.id ? '…' : '×'}
                </button>
              </div>
            </div>
          ))}
          {kits.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
              <div className="text-2xl mb-1">🔧</div>
              <p className="text-xs text-gray-400">No parts kits yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Kit editor */}
      <div className="flex-1 min-w-0">
        {showCreate && (
          <KitEditor
            frameworkId={frameworkId!}
            catalog={catalog}
            onSaved={kit => { setKits(prev => [...prev, kit]); setSelectedKit(kit); setShowCreate(false) }}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {selectedKit && !showCreate && (
          <KitEditor
            frameworkId={frameworkId!}
            catalog={catalog}
            kit={selectedKit}
            onSaved={updated => {
              setKits(prev => prev.map(k => k.id === updated.id ? updated : k))
              setSelectedKit(updated)
            }}
            onCancel={() => setSelectedKit(null)}
          />
        )}
        {!showCreate && !selectedKit && (
          <div className="flex items-center justify-center h-48 border-2 border-dashed border-gray-200 rounded-xl">
            <p className="text-sm text-gray-400">Select a kit or create a new one</p>
          </div>
        )}
      </div>
    </div>
  )
}

function KitEditor({ frameworkId, kit, catalog, onSaved, onCancel }: {
  frameworkId: string
  kit?: SparePartsKit
  catalog: PartsCatalogItem[]
  onSaved: (k: SparePartsKit) => void
  onCancel: () => void
}) {
  const [kitName, setKitName] = useState(kit?.kit_name ?? '')
  const [validityType, setValidityType] = useState<string>(kit?.validity_type ?? 'standard')
  const [engineMake, setEngineMake] = useState(kit?.engine_make ?? '')
  const [engineModel, setEngineModel] = useState(kit?.engine_model ?? '')
  const [kvaMin, setKvaMin] = useState(String(kit?.kva_min ?? ''))
  const [kvaMax, setKvaMax] = useState(String(kit?.kva_max ?? ''))
  const [siteCode, setSiteCode] = useState(kit?.site_code ?? '')
  const [notes, setNotes] = useState(kit?.notes ?? '')
  const [items, setItems] = useState<KitItemRow[]>(
    kit?.items.map(i => ({
      part_number: i.part_number ?? '',
      part_name: i.part_name,
      quantity: i.quantity,
      unit: i.unit,
      unit_price: String(i.unit_price ?? ''),
      notes: i.notes ?? '',
    })) ?? []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addRow() {
    setItems(prev => [...prev, { part_number: '', part_name: '', quantity: 1, unit: 'unit', unit_price: '', notes: '' }])
  }

  function removeRow(i: number) { setItems(prev => prev.filter((_, j) => j !== i)) }

  function updateRow(i: number, field: keyof KitItemRow, val: string | number) {
    setItems(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }

  function handlePaste(pasted: string[][]) {
    // Expected: Part No. | Part Name | Qty | Unit | Unit Price | Notes
    const newRows: KitItemRow[] = pasted.map(cols => ({
      part_number: cols[0] ?? '',
      part_name: cols[1] ?? '',
      quantity: parseFloat(cols[2] ?? '1') || 1,
      unit: cols[3] ?? 'unit',
      unit_price: cols[4]?.replace(/,/g, '') ?? '',
      notes: cols[5] ?? '',
    }))
    setItems(prev => [...prev, ...newRows])
  }

  async function handleSave() {
    if (!kitName.trim()) { setError('Kit name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        kit_name: kitName,
        validity_type: validityType,
        engine_make: engineMake || undefined,
        engine_model: engineModel || undefined,
        kva_min: kvaMin ? Number(kvaMin) : undefined,
        kva_max: kvaMax ? Number(kvaMax) : undefined,
        site_code: siteCode || undefined,
        notes: notes || undefined,
        items: items.filter(i => i.part_name.trim()).map(i => ({
          part_number: i.part_number || undefined,
          part_name: i.part_name,
          quantity: i.quantity,
          unit: i.unit || 'unit',
          unit_price: i.unit_price ? Number(i.unit_price) : undefined,
          notes: i.notes || undefined,
        })),
      }
      let result: SparePartsKit
      if (kit) {
        result = await updatePartsKit(frameworkId, kit.id, payload)
      } else {
        result = await createPartsKit(frameworkId, payload)
      }
      onSaved(result)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const totalEstimate = items.reduce((sum, i) => sum + (i.unit_price ? Number(i.unit_price) * i.quantity : 0), 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900">{kit ? 'Edit Kit' : 'New Parts Kit'}</h3>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
            {saving ? 'Saving…' : kit ? 'Update Kit' : 'Create Kit'}
          </button>
        </div>
      </div>

      {error && <div className="mx-5 mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

      {/* Header fields */}
      <div className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-gray-50">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Kit Name *</label>
          <input value={kitName} onChange={e => setKitName(e.target.value)}
            placeholder="e.g. Genset V440c2 Standard Kit, 500KVA Cummins Gigiri"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Validity Type</label>
          <select value={validityType} onChange={e => setValidityType(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400">
            <option value="standard">Standard</option>
            <option value="emergency">Emergency</option>
            <option value="seasonal">Seasonal</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Engine Make</label>
          <input value={engineMake} onChange={e => setEngineMake(e.target.value)} placeholder="e.g. Cummins, Perkins, FG Wilson"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Engine Model</label>
          <input value={engineModel} onChange={e => setEngineModel(e.target.value)} placeholder="e.g. V440c2, P500, P150"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Site Code (optional)</label>
          <input value={siteCode} onChange={e => setSiteCode(e.target.value)} placeholder="If site-specific"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">KVA Min</label>
          <input type="number" value={kvaMin} onChange={e => setKvaMin(e.target.value)} placeholder="e.g. 22"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">KVA Max</label>
          <input type="number" value={kvaMax} onChange={e => setKvaMax(e.target.value)} placeholder="e.g. 500"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none" />
        </div>
      </div>

      {/* Items table */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h4 className="text-xs font-bold text-gray-700">Parts List ({items.length} items)</h4>
            {totalEstimate > 0 && (
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                Est. KES {totalEstimate.toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <PasteZone onPaste={handlePaste} hint="Part No. | Part Name | Qty | Unit | Unit Price (KES) | Notes" />
            <button onClick={addRow} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>+ Add Part</button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-3 font-semibold text-gray-500 w-28">Part Number</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-500">Part Name</th>
                <th className="text-right px-3 py-3 font-semibold text-gray-500 w-16">Qty</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-500 w-20">Unit</th>
                <th className="text-right px-3 py-3 font-semibold text-gray-500 w-28">Unit Price</th>
                <th className="text-right px-3 py-3 font-semibold text-gray-500 w-24">Total</th>
                <th className="text-left px-3 py-3 font-semibold text-gray-500">Notes</th>
                <th className="px-3 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, i) => {
                const lineTotal = item.unit_price ? Number(item.unit_price) * item.quantity : 0
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">
                      <PartAutocomplete
                        catalog={catalog}
                        value={item.part_number}
                        valueField="part_number"
                        onChange={(name, pn, unit) => {
                          setItems(prev => prev.map((r, j) => j === i ? {
                            ...r,
                            ...(name ? { part_name: name } : {}),
                            part_number: pn ?? r.part_number,
                            ...(unit !== undefined ? { unit } : {}),
                          } : r))
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <PartAutocomplete
                        catalog={catalog}
                        value={item.part_name}
                        placeholder="Part name *"
                        onChange={(name, pn, unit) => {
                          setItems(prev => prev.map((r, j) => j === i ? {
                            ...r,
                            part_name: name,
                            ...(pn !== undefined ? { part_number: pn } : {}),
                            ...(unit !== undefined ? { unit } : {}),
                          } : r))
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={item.quantity} onChange={e => updateRow(i, 'quantity', Number(e.target.value))}
                        min={0.01} step={0.01}
                        className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={item.unit} onChange={e => updateRow(i, 'unit', e.target.value)}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={item.unit_price} onChange={e => updateRow(i, 'unit_price', e.target.value)}
                        placeholder="—"
                        className="w-24 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-700">
                      {lineTotal > 0 ? lineTotal.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={item.notes} onChange={e => updateRow(i, 'notes', e.target.value)}
                        placeholder="optional"
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 text-base">×</button>
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-xs">
                    No parts yet. Add rows manually or paste from a spreadsheet (Part No. | Part Name | Qty | Unit | Price | Notes).
                  </td>
                </tr>
              )}
              {items.length > 0 && (
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-xs text-right text-gray-600">Estimated Total</td>
                  <td className="px-3 py-2 text-right text-xs font-bold text-gray-900 font-mono">
                    {totalEstimate > 0 ? `KES ${totalEstimate.toLocaleString()}` : '—'}
                  </td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── KVA Pricing Matrix Tab ────────────────────────────────────────────────────

function KvaPricingTab({ catalog }: { catalog: PartsCatalogItem[] }) {
  const { frameworkId } = useParams<{ frameworkId: string }>()
  const [parts, setParts] = useState<SparePartsPricing[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newPart, setNewPart] = useState<Partial<SparePartsPricing>>({
    part_name: '', part_number: '', category: '', unit: 'unit', kva_pricing: {},
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!frameworkId) return
    listSparePartsPricing(frameworkId).then(setParts).finally(() => setLoading(false))
  }, [frameworkId])

  async function handleSavePart() {
    if (!frameworkId || !newPart.part_name) return
    setSaving(true)
    setError('')
    try {
      const p = await upsertSparePartPricing(frameworkId, {
        part_name: newPart.part_name!,
        part_number: newPart.part_number,
        category: newPart.category!,
        unit: newPart.unit!,
        kva_pricing: newPart.kva_pricing ?? {},
        notes: newPart.notes,
      })
      setParts(prev => [...prev, p])
      setNewPart({ part_name: '', part_number: '', category: '', unit: 'unit', kva_pricing: {} })
      setShowAdd(false)
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  function handlePaste(pasted: string[][]) {
    // Part Name | P/N | Category | Unit | 22-35 | 40-55 | 60-75 | 80-110 | 120-200 | 250-330
    pasted.forEach(cols => {
      const pricing: Record<string, number> = {}
      KVA_RANGES.forEach((k, idx) => {
        const val = parseFloat(cols[4 + idx]?.replace(/,/g, '') ?? '')
        if (!isNaN(val) && val > 0) pricing[k] = val
      })
      setNewPart({ part_name: cols[0] ?? '', part_number: cols[1] ?? '', category: cols[2] ?? '', unit: cols[3] ?? 'unit', kva_pricing: pricing })
      setShowAdd(true)
    })
  }

  const categories = [...new Set(parts.map(p => p.category).filter(Boolean))]

  if (loading) return <div className="py-12 flex justify-center"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">KVA Pricing Matrix</h2>
          <p className="text-xs text-gray-500 mt-0.5">Per-part unit prices by KVA range — used for cost estimation across asset classes.</p>
        </div>
        <div className="flex gap-2">
          <PasteZone onPaste={handlePaste} hint="Part Name | P/N | Category | Unit | 22-35 | 40-55 | 60-75 | 80-110 | 120-200 | 250-330" />
          <button onClick={() => setShowAdd(true)} className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
            + Add Part
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {parts.length === 0 && !showAdd ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-3xl mb-2">💹</div>
          <p className="text-sm text-gray-500">No pricing matrix defined yet.</p>
          <p className="text-xs text-gray-400">Add spare parts with pricing by KVA range, or paste from a spreadsheet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 min-w-[200px]">Part Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500">Unit</th>
                {KVA_RANGES.map(k => (
                  <th key={k} className="text-right px-3 py-3 font-semibold text-gray-500 whitespace-nowrap">{k} KVA</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {parts.map(part => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {part.part_name}
                    {part.part_number && <div className="text-[10px] text-gray-400 font-mono">{part.part_number}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{part.category}</td>
                  <td className="px-4 py-3 text-gray-500">{part.unit}</td>
                  {KVA_RANGES.map(k => (
                    <td key={k} className="px-3 py-3 text-right font-mono text-gray-700">
                      {part.kva_pricing[k] !== undefined ? part.kva_pricing[k]!.toLocaleString() : <span className="text-gray-200">—</span>}
                    </td>
                  ))}
                </tr>
              ))}

              {showAdd && (
                <tr className="bg-amber-50">
                  <td className="px-4 py-2">
                    <PartAutocomplete
                      catalog={catalog}
                      value={newPart.part_name ?? ''}
                      placeholder="Part name"
                      onChange={(name, pn, unit) => setNewPart(p => ({
                        ...p,
                        part_name: name,
                        ...(pn !== undefined ? { part_number: pn } : {}),
                        ...(unit !== undefined ? { unit } : {}),
                      }))}
                    />
                    <PartAutocomplete
                      catalog={catalog}
                      value={newPart.part_number ?? ''}
                      valueField="part_number"
                      onChange={(name, pn, unit) => setNewPart(p => ({
                        ...p,
                        ...(name ? { part_name: name } : {}),
                        part_number: pn ?? p.part_number,
                        ...(unit !== undefined ? { unit } : {}),
                      }))}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input value={newPart.category ?? ''} onChange={e => setNewPart(p => ({ ...p, category: e.target.value }))} placeholder="Category" list="cat-list"
                      className="w-full border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                    <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                  </td>
                  <td className="px-4 py-2">
                    <input value={newPart.unit ?? 'unit'} onChange={e => setNewPart(p => ({ ...p, unit: e.target.value }))} placeholder="unit"
                      className="w-24 border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none" />
                  </td>
                  {KVA_RANGES.map(k => (
                    <td key={k} className="px-3 py-2">
                      <input type="number" value={newPart.kva_pricing?.[k] ?? ''} onChange={e => setNewPart(p => ({
                        ...p, kva_pricing: { ...(p.kva_pricing ?? {}), [k]: e.target.value ? Number(e.target.value) : undefined },
                      }))} placeholder="—"
                        className="w-20 border border-amber-200 rounded px-2 py-1 text-xs focus:outline-none text-right" />
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>

          {showAdd && (
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-amber-100 bg-amber-50">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-600">Cancel</button>
              <button onClick={handleSavePart} disabled={saving} className="px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                {saving ? 'Saving…' : 'Save Part'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SLA Thresholds Tab ────────────────────────────────────────────────────────

function SlaThresholdsTab() {
  const [thresholds, setThresholds] = useState({
    emergency_response_hours: 4,
    critical_resolution_hours: 24,
    routine_resolution_hours: 72,
    monthly_report_day: 5,
    ppm_report_days_after: 30,
    penalty_pct_per_event: 5,
    major_repair_penalty_pct: 10,
  })

  function update(key: keyof typeof thresholds, value: number) {
    setThresholds(p => ({ ...p, [key]: value }))
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-bold text-gray-900">SLA Thresholds</h2>
        <p className="text-xs text-gray-500 mt-0.5">Configure SLA response and resolution time standards for this contract.</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        {[
          { label: 'Emergency Response Time (hours)', key: 'emergency_response_hours' as const, unit: 'hours' },
          { label: 'Critical Fault Resolution Time (hours)', key: 'critical_resolution_hours' as const, unit: 'hours' },
          { label: 'Routine Fault Resolution Time (hours)', key: 'routine_resolution_hours' as const, unit: 'hours' },
          { label: 'Monthly Report Submission (day of month)', key: 'monthly_report_day' as const, unit: '' },
          { label: 'PPM Service Report Submission (days after visit)', key: 'ppm_report_days_after' as const, unit: 'days' },
          { label: 'Standard Penalty per Event (%)', key: 'penalty_pct_per_event' as const, unit: '%' },
          { label: 'Major Repair Delay Penalty (%)', key: 'major_repair_penalty_pct' as const, unit: '%' },
        ].map(field => (
          <div key={field.key} className="flex items-center justify-between gap-4">
            <label className="text-sm text-gray-700 flex-1">{field.label}</label>
            <div className="flex items-center gap-2">
              <input type="number" value={thresholds[field.key]} onChange={e => update(field.key, Number(e.target.value))}
                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-400" />
              {field.unit && <span className="text-xs text-gray-400 w-10">{field.unit}</span>}
            </div>
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <button className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{ backgroundColor: ACCENT }}>
            Save Thresholds
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Contract Info Tab ─────────────────────────────────────────────────────────

function ContractInfoTab() {
  const { framework } = useContext(FrameworkContext)
  if (!framework) return null
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-bold text-gray-900">Contract Information</h2>
        <p className="text-xs text-gray-500 mt-0.5">Core contract details.</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-2 gap-5">
          {[
            { label: 'Contract Name', value: framework.name },
            { label: 'Client Name', value: framework.client_name },
            { label: 'Contract Number', value: framework.contract_number },
            { label: 'Region / Coverage', value: framework.region },
            { label: 'Contract Start', value: new Date(framework.contract_start).toLocaleDateString('en-GB') },
            { label: 'Contract End', value: new Date(framework.contract_end).toLocaleDateString('en-GB') },
            { label: 'Status', value: framework.status },
            { label: 'Total Assets', value: String(framework.total_assets) },
          ].map(item => (
            <div key={item.label}>
              <label className="block text-xs font-semibold text-gray-500 mb-1">{item.label}</label>
              <div className="text-sm font-medium text-gray-900 bg-gray-50 rounded-lg px-3 py-2">{item.value}</div>
            </div>
          ))}
          {framework.description && (
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Description</label>
              <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{framework.description}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
