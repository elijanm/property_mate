import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, ToggleLeft, ToggleRight, Users, UserMinus, UserPlus, ChevronDown, CheckCircle, Image as ImageIcon, Loader2 } from 'lucide-react'
import { watermarkApi } from '@/api/watermark'
import { staffApi } from '@/api/staff'
import { adminApi } from '@/api/admin'
import type { StaffMember } from '@/types/staff'
import type { MLPlan } from '@/types/plan'
import type { OrgWatermarkConfig, UserWatermarkConfig } from '@/types/watermark'

const POSITION_OPTIONS = [
  { value: 'bottom_right', label: 'Bottom Right' },
  { value: 'bottom_left',  label: 'Bottom Left' },
  { value: 'top_right',    label: 'Top Right' },
  { value: 'top_left',     label: 'Top Left' },
  { value: 'center',       label: 'Center' },
]

function WatermarkPreview({
  imageUrl, position, opacity, scale,
}: { imageUrl: string; position: string; opacity: number; scale: number }) {
  const posClass: Record<string, string> = {
    top_left: 'top-2 left-2',
    top_right: 'top-2 right-2',
    bottom_left: 'bottom-2 left-2',
    bottom_right: 'bottom-2 right-2',
    center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  }
  return (
    <div className="relative bg-gray-900 border border-gray-700 rounded-lg overflow-hidden" style={{ height: 140 }}>
      <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">
        Sample Image
      </div>
      <img
        src={imageUrl}
        alt="watermark preview"
        className={`absolute pointer-events-none ${posClass[position] ?? posClass.bottom_right}`}
        style={{ opacity, width: `${Math.round(scale * 100)}%`, maxWidth: '50%' }}
      />
    </div>
  )
}

export default function WatermarkSettingsPage() {
  const [cfg, setCfg] = useState<OrgWatermarkConfig | null>(null)
  const [overrides, setOverrides] = useState<UserWatermarkConfig[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [plans, setPlans] = useState<MLPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [showGrantDropdown, setShowGrantDropdown] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [c, o, s, p] = await Promise.all([
        watermarkApi.getOrgConfig(),
        watermarkApi.listUserOverrides(),
        staffApi.list().catch(() => ({ items: [], plan: {} as any })),
        adminApi.getPlans().catch(() => [] as MLPlan[]),
      ])
      setCfg(c)
      setOverrides(o)
      setStaffList(s.items ?? [])
      setPlans(p ?? [])
    } catch {
      setError('Failed to load watermark settings.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const updated = await watermarkApi.uploadOrgWatermark(file)
      setCfg(updated)
      setSuccess('Watermark image uploaded.')
    } catch {
      setError('Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDeleteImage() {
    if (!confirm('Remove the org watermark image?')) return
    try {
      await watermarkApi.deleteOrgWatermarkImage()
      setCfg(prev => prev ? { ...prev, has_watermark: false, watermark_url: '', watermark_name: '' } : prev)
      setSuccess('Watermark image removed.')
    } catch {
      setError('Failed to remove image.')
    }
  }

  async function handlePatch(patch: Partial<OrgWatermarkConfig>) {
    if (!cfg) return
    setSaving(true)
    setError('')
    try {
      const updated = await watermarkApi.updateOrgSettings(patch)
      setCfg(updated)
      setSuccess('Settings saved.')
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function handleGrant() {
    const target = staffList.find(s => s.email === grantEmail)
    if (!target) return
    try {
      const u = await watermarkApi.grantUserOverride(target.email)
      setOverrides(prev => [...prev.filter(o => o.user_id !== u.user_id), u])
      setGrantEmail('')
      setShowGrantDropdown(false)
      setSuccess(`Override granted to ${target.email}.`)
    } catch {
      setError('Failed to grant override.')
    }
  }

  async function handleRevoke(userId: string) {
    try {
      await watermarkApi.revokeUserOverride(userId)
      setOverrides(prev => prev.filter(o => o.user_id !== userId))
      setSuccess('Override revoked.')
    } catch {
      setError('Failed to revoke override.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    )
  }

  if (error && !cfg) {
    return (
      <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
    )
  }

  if (!cfg) return null

  const grantableStaff = (staffList as StaffMember[]).filter(
    s => !overrides.some(o => o.user_id === s.email) && s.role !== 'admin'
  )

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status messages */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 text-emerald-400 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {/* Enable / disable */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-100">Watermarking</p>
            <p className="text-xs text-gray-500 mt-0.5">Applied when serving files — not saved to db but displayed on website/served to public.</p>
          </div>
          <button onClick={() => handlePatch({ active: !cfg.active })} className="text-gray-400 hover:text-gray-200">
            {cfg.active ? <ToggleRight size={28} className="text-emerald-400" /> : <ToggleLeft size={28} />}
          </button>
        </div>
      </div>

      {/* Watermark image */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-200">Watermark Image</p>
        {cfg.has_watermark ? (
          <div className="flex items-center gap-4">
            <img src={cfg.watermark_url} alt="watermark" className="h-12 rounded border border-gray-700 bg-gray-950 p-1 object-contain" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 truncate">{cfg.watermark_name}</p>
            </div>
            <button onClick={handleDeleteImage} className="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-900/20">
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center">
            <ImageIcon size={24} className="mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">No watermark image. Upload a PNG with transparency.</p>
          </div>
        )}
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/webp,image/gif" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? 'Uploading…' : cfg.has_watermark ? 'Replace Image' : 'Upload Watermark'}
          </button>
        </div>
      </div>

      {/* Placement settings */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-200">Placement</p>

        {/* Preview */}
        {cfg.has_watermark && cfg.watermark_url && (
          <WatermarkPreview
            imageUrl={cfg.watermark_url}
            position={cfg.position}
            opacity={cfg.opacity}
            scale={cfg.scale}
          />
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-3 sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-1">Position</label>
            <select
              value={cfg.position}
              onChange={e => handlePatch({ position: e.target.value as OrgWatermarkConfig['position'] })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 px-2 py-1.5"
            >
              {POSITION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Opacity — {Math.round(cfg.opacity * 100)}%</label>
            <input
              type="range" min={5} max={100} step={5}
              value={Math.round(cfg.opacity * 100)}
              onChange={e => handlePatch({ opacity: parseInt(e.target.value) / 100 })}
              className="w-full accent-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Size — {Math.round(cfg.scale * 100)}% of image</label>
            <input
              type="range" min={5} max={50} step={5}
              value={Math.round(cfg.scale * 100)}
              onChange={e => handlePatch({ scale: parseInt(e.target.value) / 100 })}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
        {saving && <p className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Saving…</p>}
      </div>

      {/* User overrides */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-200 flex items-center gap-2"><Users size={14} /> User Overrides</p>
            <p className="text-xs text-gray-500 mt-0.5">Allow specific team members to upload their own watermark.</p>
          </div>
          <button onClick={() => handlePatch({ allow_user_override: !cfg.allow_user_override })} className="text-gray-400 hover:text-gray-200">
            {cfg.allow_user_override
              ? <ToggleRight size={24} className="text-emerald-400" />
              : <ToggleLeft size={24} />}
          </button>
        </div>

        {cfg.allow_user_override && (
          <>
            {/* Plan-based overrides */}
            {plans.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2">Auto-grant override to users on these plans:</p>
                <div className="flex flex-wrap gap-2">
                  {plans.map(plan => {
                    const selected = (cfg.allowed_plans ?? []).includes(plan.name)
                    return (
                      <button
                        key={plan.id}
                        onClick={() => {
                          const next = selected
                            ? cfg.allowed_plans.filter(n => n !== plan.name)
                            : [...cfg.allowed_plans, plan.name]
                          handlePatch({ allowed_plans: next })
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          selected
                            ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {plan.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Explicit grant dropdown */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Or grant individually:</p>
              <div className="relative inline-block">
                <button
                  onClick={() => setShowGrantDropdown(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                >
                  <UserPlus size={12} /> Grant override <ChevronDown size={10} />
                </button>
                {showGrantDropdown && grantableStaff.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 min-w-[220px]">
                    {grantableStaff.map(s => (
                      <button
                        key={s.email}
                        onClick={() => { setGrantEmail(s.email); setShowGrantDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 flex items-center justify-between"
                      >
                        <span>{s.full_name || s.email}</span>
                        <span className="text-gray-500">{s.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {grantEmail && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-300 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1">{grantEmail}</span>
                <button onClick={handleGrant} className="px-3 py-1 text-xs rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white">Confirm</button>
                <button onClick={() => setGrantEmail('')} className="px-3 py-1 text-xs rounded-lg bg-gray-700 text-gray-300">Cancel</button>
              </div>
            )}

            {/* Existing explicit overrides */}
            {overrides.length > 0 ? (
              <div className="divide-y divide-gray-800">
                {overrides.map(o => (
                  <div key={o.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-xs text-gray-200">{o.user_id}</p>
                      {o.granted_by && <p className="text-[11px] text-gray-500">Granted by {o.granted_by}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {o.has_watermark && <span className="text-[11px] text-emerald-400">Has image</span>}
                      <button onClick={() => handleRevoke(o.user_id)} className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-900/20">
                        <UserMinus size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No explicit user overrides yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
