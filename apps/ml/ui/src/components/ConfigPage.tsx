import { useState, useEffect } from 'react'
import { configApi, type TrainingConfig, type DeviceInfo, type CudaDeviceDetail } from '@/api/config'
import { Cpu, Save, Loader2, CheckCircle2, Zap } from 'lucide-react'
import clsx from 'clsx'

export default function ConfigPage() {
  const [config, setConfig] = useState<TrainingConfig | null>(null)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState<Partial<TrainingConfig>>({})

  useEffect(() => {
    Promise.all([configApi.get(), configApi.getDevice()]).then(([cfg, dev]) => {
      setConfig(cfg); setForm(cfg); setDevice(dev)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const updated = await configApi.update(form)
      setConfig(updated); setForm(updated); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const set = (key: keyof TrainingConfig, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-600" /></div>
  void config

  return (
    <div className="max-w-3xl space-y-6">

      {/* Device info */}
      {device && (
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Cpu size={15} /> Active Device
            <span className={clsx(
              'ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border',
              device.device === 'cpu'
                ? 'text-gray-400 border-gray-700 bg-gray-800'
                : device.device === 'mps'
                ? 'text-purple-400 border-purple-800/50 bg-purple-950/30'
                : 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30',
            )}>
              {device.device.toUpperCase()}
            </span>
          </h3>

          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DeviceCard label="Active Device" value={device.device.toUpperCase()} highlight={device.device !== 'cpu'} />
            <DeviceCard label="CUDA Available" value={device.cuda_available ? 'Yes' : 'No'} highlight={device.cuda_available} />
            <DeviceCard label="GPU Count" value={String(device.cuda_device_count)} highlight={device.cuda_device_count > 0} />
            <DeviceCard label="MPS (Apple)" value={device.mps_available ? 'Yes' : 'No'} highlight={device.mps_available} />
          </div>

          {/* Per-GPU breakdown */}
          {device.cuda_devices.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                <Zap size={10} /> GPU Details
              </p>
              {device.cuda_devices.map((gpu: CudaDeviceDetail) => {
                const usedPct = gpu.vram_gb > 0 ? Math.round((gpu.memory_allocated_gb / gpu.vram_gb) * 100) : 0
                const reservedPct = gpu.vram_gb > 0 ? Math.round((gpu.memory_reserved_gb / gpu.vram_gb) * 100) : 0
                return (
                  <div key={gpu.index} className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="text-[10px] text-gray-500 font-mono mr-2">cuda:{gpu.index}</span>
                        <span className="text-sm font-semibold text-white">{gpu.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{gpu.vram_gb} GB VRAM</span>
                        <span className="text-gray-600">·</span>
                        <span>SM {gpu.compute_capability}</span>
                        <span className="text-gray-600">·</span>
                        <span>{gpu.multi_processor_count} SMs</span>
                      </div>
                    </div>
                    {/* VRAM usage bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-gray-500">
                        <span>VRAM usage — allocated {gpu.memory_allocated_gb} GB / reserved {gpu.memory_reserved_gb} GB / total {gpu.vram_gb} GB</span>
                        <span className={clsx('font-semibold', usedPct > 85 ? 'text-red-400' : usedPct > 60 ? 'text-amber-400' : 'text-emerald-400')}>
                          {usedPct}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gray-600 relative" style={{ width: `${reservedPct}%` }}>
                          <div className={clsx('absolute inset-y-0 left-0 rounded-full', usedPct > 85 ? 'bg-red-500' : usedPct > 60 ? 'bg-amber-500' : 'bg-emerald-500')}
                            style={{ width: reservedPct > 0 ? `${(usedPct / reservedPct) * 100}%` : '0%' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* CPU fallback note — only when truly no GPU hardware present */}
          {!device.cuda_available && !device.mps_available && (
            <p className="text-xs text-gray-500">
              No GPU detected. Training will run on CPU — consider switching to a GPU instance for faster jobs.
            </p>
          )}
        </div>
      )}

      {/* ── Hardware ─────────────────────────────────────────────────────── */}
      <Section title="Hardware">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <SelectField
              label="CUDA Device"
              value={form.cuda_device ?? 'auto'}
              onChange={v => set('cuda_device', v)}
              options={[
                { value: 'auto', label: 'auto (detect best)' },
                { value: 'cpu', label: 'cpu' },
                { value: 'cuda', label: 'cuda (all GPUs)' },
                { value: 'cuda:0', label: 'cuda:0' },
                { value: 'cuda:1', label: 'cuda:1' },
                { value: 'mps', label: 'mps (Apple Silicon)' },
              ]}
            />
          </div>
          <NumberField label="Batch Size" value={form.batch_size ?? 32} onChange={v => set('batch_size', v)} min={1} max={4096} />
          <NumberField label="DataLoader Workers" value={form.workers ?? 4} onChange={v => set('workers', v)} min={0} max={64} />
          <div className="col-span-2">
            <SelectField
              label="Mixed Precision"
              value={form.mixed_precision ?? 'auto'}
              onChange={v => set('mixed_precision', v)}
              options={[
                { value: 'auto', label: 'auto (fp16 on CUDA, bf16 where supported, no-op on CPU)' },
                { value: 'no', label: 'no (full fp32)' },
                { value: 'fp16', label: 'fp16 (half precision)' },
                { value: 'bf16', label: 'bf16 (bfloat16)' },
              ]}
              hint="Controls AMP (Automatic Mixed Precision). 'auto' is recommended."
            />
          </div>
          <Toggle label="FP16 legacy flag" value={form.fp16 ?? false} onChange={v => set('fp16', v)} hint="Legacy toggle — use Mixed Precision above instead" />
          <Toggle label="Pin DataLoader Memory" value={form.dataloader_pin_memory ?? true} onChange={v => set('dataloader_pin_memory', v)} hint="Faster GPU transfers (disable on CPU-only)" />
          <NumberField label="Prefetch Factor" value={form.prefetch_factor ?? 2} onChange={v => set('prefetch_factor', v)} min={1} max={32} />
        </div>
      </Section>

      {/* ── Training Loop ────────────────────────────────────────────────── */}
      <Section title="Training Loop">
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Max Epochs" value={form.max_epochs ?? 100} onChange={v => set('max_epochs', v)} min={1} max={10000} />
          <NumberField label="Early Stopping Patience" value={form.early_stopping_patience ?? 5} onChange={v => set('early_stopping_patience', v)} min={1} max={200} />
          <Toggle label="Early Stopping" value={form.early_stopping ?? true} onChange={v => set('early_stopping', v)} hint="Stop when val loss stops improving" />
        </div>
      </Section>

      {/* ── Data Splitting ───────────────────────────────────────────────── */}
      <Section title="Data Splitting">
        <div className="grid grid-cols-3 gap-4">
          <NumberField label="Test Split" value={form.test_split ?? 0.2} onChange={v => set('test_split', v)} min={0} max={0.5} step={0.05} />
          <NumberField label="Val Split" value={form.val_split ?? 0.1} onChange={v => set('val_split', v)} min={0} max={0.5} step={0.05} />
          <NumberField label="Random Seed" value={form.random_seed ?? 42} onChange={v => set('random_seed', v)} min={0} max={999999} />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Training set = {(100 - (form.test_split ?? 0.2) * 100 - (form.val_split ?? 0.1) * 100).toFixed(0)}% &nbsp;|&nbsp;
          Val = {((form.val_split ?? 0.1) * 100).toFixed(0)}% &nbsp;|&nbsp;
          Test = {((form.test_split ?? 0.2) * 100).toFixed(0)}%
        </p>
      </Section>

      {/* ── Optimisation ─────────────────────────────────────────────────── */}
      <Section title="Optimisation">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Optimizer"
            value={form.optimizer ?? 'adam'}
            onChange={v => set('optimizer', v)}
            options={[
              { value: 'adam',    label: 'Adam' },
              { value: 'adamw',   label: 'AdamW (recommended for transformers)' },
              { value: 'sgd',     label: 'SGD + Momentum' },
              { value: 'rmsprop', label: 'RMSProp' },
              { value: 'adagrad', label: 'Adagrad' },
            ]}
          />
          <SelectField
            label="LR Scheduler"
            value={form.lr_scheduler ?? 'cosine'}
            onChange={v => set('lr_scheduler', v)}
            options={[
              { value: 'cosine',  label: 'Cosine Annealing' },
              { value: 'linear',  label: 'Linear Decay' },
              { value: 'step',    label: 'Step LR' },
              { value: 'plateau', label: 'ReduceLROnPlateau' },
              { value: 'none',    label: 'None (constant LR)' },
            ]}
          />
          <NumberField label="Learning Rate" value={form.learning_rate ?? 1e-3} onChange={v => set('learning_rate', v)} min={1e-7} max={1} step={1e-4} />
          <NumberField label="Weight Decay" value={form.weight_decay ?? 0} onChange={v => set('weight_decay', v)} min={0} max={1} step={1e-4} />
          <NumberField label="Gradient Clip" value={form.gradient_clip ?? 0} onChange={v => set('gradient_clip', v)} min={0} max={10} step={0.1} hint="0 = disabled" />
          <NumberField label="Warmup Ratio" value={form.warmup_ratio ?? 0} onChange={v => set('warmup_ratio', v)} min={0} max={0.5} step={0.01} hint="Fraction of steps for LR warmup" />
        </div>
      </Section>

      {/* ── Task ─────────────────────────────────────────────────────────── */}
      <Section title="Task">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Task Type"
            value={form.task ?? 'classification'}
            onChange={v => set('task', v)}
            options={[
              { value: 'classification',     label: 'Classification' },
              { value: 'regression',         label: 'Regression' },
              { value: 'detection',          label: 'Object Detection' },
              { value: 'nlp_classification', label: 'NLP Classification' },
              { value: 'segmentation',       label: 'Segmentation' },
              { value: 'custom',             label: 'Custom' },
            ]}
            hint="Used by auto_train_torch to set loss function and metrics"
          />
          <NumberField
            label="Num Classes"
            value={form.num_classes ?? 0}
            onChange={v => set('num_classes', v === 0 ? null : v)}
            min={0} max={100000}
            hint="0 = inferred automatically"
          />
        </div>
      </Section>

      {/* Debug / visibility */}
      <Section title="Developer Debug">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!(form.show_cost_debug ?? config?.show_cost_debug ?? false)}
            onChange={e => set('show_cost_debug', e.target.checked)}
            className="w-4 h-4 rounded accent-brand-500"
          />
          <div>
            <p className="text-sm text-gray-200">Show token cost in AI Workshop</p>
            <p className="text-xs text-gray-500">Displays input/output token count and USD cost on each AI chat message and run output</p>
          </div>
        </label>
      </Section>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 rounded-xl text-sm font-semibold text-white transition-colors">
          {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Config'}
        </button>
        {saved && <span className="text-xs text-green-400">Configuration saved — new training runs will use these defaults.</span>}
      </div>
    </div>
  )
}

// ── Primitives ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      {children}
    </div>
  )
}

function DeviceCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl p-3">
      <div className={clsx('text-base font-bold', highlight ? 'text-emerald-400' : 'text-gray-100')}>{value}</div>
      <div className="text-gray-400 mt-0.5 text-[11px]">{label}</div>
    </div>
  )
}

function NumberField({
  label, value, onChange, min, max, step = 1, hint,
}: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step?: number; hint?: string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
      />
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}

function SelectField({
  label, value, onChange, options, hint,
}: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; hint?: string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}

function Toggle({
  label, value, onChange, hint,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string
}) {
  return (
    <div>
      <button onClick={() => onChange(!value)} className="flex items-center gap-2.5 text-sm">
        <div className={clsx('w-9 h-5 rounded-full transition-colors relative shrink-0', value ? 'bg-brand-600' : 'bg-gray-700')}>
          <div className={clsx('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all', value ? 'left-4' : 'left-0.5')} />
        </div>
        <span className="text-gray-300">{label}</span>
      </button>
      {hint && <p className="text-xs text-gray-600 mt-0.5 ml-11">{hint}</p>}
    </div>
  )
}
