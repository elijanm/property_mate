import { useState, useEffect } from 'react'
import {
  ArrowRight, Code2, Menu, X, CheckCircle2, Zap, Globe, Shield,
  BarChart2, GitBranch, Cpu, CloudLightning, Layers,
  ChevronRight, Database, Monitor, Star,
} from 'lucide-react'
import clsx from 'clsx'
import Logo from '@/components/Logo'
import { adminApi } from '@/api/admin'
import type { MLPlan } from '@/types/plan'

interface Props {
  onSignIn: () => void
  onGetStarted: () => void
  onApiDocs: () => void
  onGettingStarted: () => void
  onPrivacy: () => void
  onTerms: () => void
}

// ── Data ───────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: '01',
    icon: <Code2 size={18} className="text-violet-400" />,
    title: 'Write a Python trainer',
    desc: 'Subclass BaseTrainer, implement train() and predict(). Any framework — sklearn, PyTorch, XGBoost, Keras, YOLO, transformers. Drop the file in /trainers/ and it\'s detected automatically.',
    tag: 'No boilerplate',
    tagColor: 'text-violet-400 bg-violet-950/40 border-violet-800/40',
  },
  {
    n: '02',
    icon: <CloudLightning size={18} className="text-sky-400" />,
    title: 'Train locally or on cloud GPU',
    desc: 'Start free on your own machine (10 hrs/month included). Switch to cloud GPU in one click — same trainer code, no rewrite. Cost is reserved upfront and refunded for unused time.',
    tag: 'CPU from $0.05/hr',
    tagColor: 'text-sky-400 bg-sky-950/40 border-sky-800/40',
  },
  {
    n: '03',
    icon: <Zap size={18} className="text-emerald-400" />,
    title: 'Deploy as a REST API in seconds',
    desc: 'The moment training completes your model is live. Hit it with a signed API key from anywhere in the world. No servers to provision, no Docker knowledge required.',
    tag: 'Live instantly',
    tagColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
  },
  {
    n: '04',
    icon: <BarChart2 size={18} className="text-amber-400" />,
    title: 'Monitor, compare & improve',
    desc: 'Track latency, error rates, and model drift in real time. Compare versions side-by-side. Run A/B tests with traffic splitting. Correct bad predictions to build better training data.',
    tag: 'MLflow built-in',
    tagColor: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
  },
]

const DIFFERENTIATORS = [
  {
    icon: <Database size={20} className="text-sky-400" />,
    title: 'Built-in dataset collection',
    body: 'Define structured collection forms, invite contributors via unique links, and gather labelled images, files, or text at scale — with optional model-based validation that automatically rejects off-topic submissions.',
  },
  {
    icon: <Layers size={20} className="text-violet-400" />,
    title: 'One platform, full lifecycle',
    body: 'AWS SageMaker, Weights & Biases, Modal, Replicate — four tools to do what MLDock does in one. Experiment tracking, training, deployment, monitoring, A/B testing. All connected, all in one place.',
  },
  {
    icon: <Globe size={20} className="text-sky-400" />,
    title: 'Any framework, any model',
    body: 'We don\'t lock you into a specific ecosystem. sklearn, PyTorch, TensorFlow, YOLO, Roboflow, Hugging Face — if it\'s Python, it works. Bring your existing code and run it without modification.',
  },
  {
    icon: <Shield size={20} className="text-amber-400" />,
    title: 'Your models, your data',
    body: '100% ownership. Your trained models, your prediction data, your API keys — none of it is shared or used to train anything else. Self-host or white-label the entire platform for your own customers.',
  },
  {
    icon: <GitBranch size={20} className="text-rose-400" />,
    title: 'Cost reserved, not post-billed',
    body: 'GPU time is reserved from your wallet before the job starts. If the job finishes early, unused cost is returned immediately. No surprise invoices at the end of the month.',
  },
  {
    icon: <Cpu size={20} className="text-cyan-400" />,
    title: 'Free standard training tier',
    body: 'Standard CPU and GPU training at a fraction of accelerated cloud prices. CPU from $0.05/hr, GPU from $0.20/hr. Start on the Starter plan with 10 free CPU hours — great for prototyping before scaling to accelerated compute.',
  },
]

const VS = [
  { feature: 'Local training (free tier)', us: true, sm: false, wb: false, modal: false },
  { feature: 'Local payment methods', us: true, sm: false, wb: false, modal: false },
  { feature: 'Built-in dataset collection', us: true, sm: false, wb: false, modal: false },
  { feature: 'Wallet billing (pre-fund)', us: true, sm: false, wb: false, modal: false },
  { feature: 'Any Python framework', us: true, sm: true, wb: true, modal: true },
  { feature: 'Built-in experiment tracking', us: true, sm: false, wb: true, modal: false },
  { feature: 'One-click GPU switch', us: true, sm: false, wb: false, modal: true },
  { feature: 'A/B testing + drift monitoring', us: true, sm: true, wb: false, modal: false },
  { feature: 'White-label / self-host', us: true, sm: false, wb: false, modal: false },
  { feature: 'No AWS account needed', us: true, sm: false, wb: true, modal: true },
]

// On-demand rates fallback (shown while loading or if API fails)
const DEFAULT_ONDEMAND = { cpu: 0.05, gpu: 0.20, inference: 0.001, cloudGpu: 0.28 }

// Static fallback plan cards shown before API responds
const FALLBACK_PLANS = [
  { id: 'f1', name: 'Starter', price_usd_per_month: 0, included_period: 'month' as const, included_cpu_hours: 0, included_local_gpu_hours: 0, included_cloud_gpu_credit_usd: 0, free_inference_calls: 500, free_inference_period: 'month' as const, new_customer_credit_usd: 5, is_active: true, is_default: true, created_at: null, updated_at: null },
  { id: 'f2', name: 'Developer', price_usd_per_month: 19, included_period: 'month' as const, included_cpu_hours: 30, included_local_gpu_hours: 10, included_cloud_gpu_credit_usd: 2, free_inference_calls: 2000, free_inference_period: 'month' as const, new_customer_credit_usd: 10, is_active: true, is_default: false, created_at: null, updated_at: null },
  { id: 'f3', name: 'Pro', price_usd_per_month: 79, included_period: 'month' as const, included_cpu_hours: 100, included_local_gpu_hours: 40, included_cloud_gpu_credit_usd: 8, free_inference_calls: 10000, free_inference_period: 'month' as const, new_customer_credit_usd: 25, is_active: true, is_default: false, created_at: null, updated_at: null },
]

const FAQ = [
  {
    q: 'What\'s the difference between CPU, local GPU, and cloud GPU?',
    a: 'CPU training runs on your machine\'s processor — available on any computer, slower for deep learning, billed at $0.05/hr. Local GPU uses your own CUDA-capable graphics card (NVIDIA), which is 5–30× faster than CPU and billed at $0.20/hr. Cloud GPU rents hardware from our partner network (RTX 3090, A100, H100) — fastest, billed from $0.28/hr, started in seconds and stopped any time.',
  },
  {
    q: 'Do I need my own GPU to use MLDock?',
    a: 'No. You can start with CPU training right away on any machine. When you need more speed, switch to cloud GPU in one click — no hardware required on your side. If you do have an NVIDIA GPU, you can use local GPU training to get near-cloud speeds at a lower cost.',
  },
  {
    q: 'How does wallet billing work? Can I get a surprise charge?',
    a: 'You pre-fund your wallet (no credit card required — M-Pesa and local methods accepted). Before any job starts, the estimated cost is reserved. If the job finishes early, unused funds are refunded immediately. You can never be charged more than your wallet balance — jobs won\'t start if there isn\'t enough balance.',
  },
  {
    q: 'What happens if my training job fails?',
    a: 'For cloud GPU jobs, you\'re only charged for the time the job actually ran. The reserved amount for unused time is returned to your wallet automatically. For local jobs, the cost reflects actual wall-clock time elapsed before the failure.',
  },
  {
    q: 'What Python frameworks are supported?',
    a: 'Any Python framework that can run on the target machine: scikit-learn, PyTorch, TensorFlow, Keras, XGBoost, LightGBM, YOLO (Ultralytics), Hugging Face Transformers, Roboflow, and more. You subclass BaseTrainer, drop your file in /trainers/, and it\'s auto-detected — no platform-specific rewrites needed.',
  },
  {
    q: 'Is my model and training data private?',
    a: 'Yes. Your trained models, prediction data, and API keys are yours and are never shared or used to train anything else. You can self-host the entire platform or use the white-label option to deploy under your own brand.',
  },
  {
    q: 'How do I choose between a monthly plan and on-demand?',
    a: 'On-demand is best if your usage is irregular — you only pay for what you run. Monthly plans make sense if you train regularly: you pre-pay at a discount and get a fixed quota of CPU, local GPU, and cloud GPU credit each month. The Developer plan\'s included compute is worth ~$9.50 at on-demand rates for $19/mo, so you break even at just a few hours of use per month.',
  },
  {
    q: 'Can I cancel a running job?',
    a: 'Yes — any queued or running job can be cancelled from the Jobs panel. For cloud GPU jobs, billing stops immediately on cancellation and unused reserved funds are returned. The trained checkpoint (if any) up to the point of cancellation is preserved.',
  },
]

// ── Component ──────────────────────────────────────────────────────────────────

function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="bg-gray-900/60 border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-5 py-4 text-left gap-4"
          >
            <span className="text-sm font-medium text-white">{item.q}</span>
            <ChevronRight
              size={14}
              className={clsx('text-gray-500 flex-shrink-0 transition-transform', open === i && 'rotate-90')}
            />
          </button>
          {open === i && (
            <div className="px-5 pb-5 text-sm text-gray-400 leading-relaxed border-t border-white/5 pt-4">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function LandingPage({ onSignIn, onGetStarted, onApiDocs, onGettingStarted, onPrivacy, onTerms }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [billingMode, setBillingMode] = useState<'ondemand' | 'monthly'>('monthly')
  const [rates, setRates] = useState(DEFAULT_ONDEMAND)
  const [dbPlans, setDbPlans] = useState<MLPlan[]>([])

  useEffect(() => {
    adminApi.getPublicPricing().then(data => {
      setRates({
        cpu: data.pricing.local_cpu_price_per_hour ?? DEFAULT_ONDEMAND.cpu,
        gpu: data.pricing.local_gpu_price_per_hour ?? DEFAULT_ONDEMAND.gpu,
        inference: data.pricing.inference_price_per_call ?? DEFAULT_ONDEMAND.inference,
        cloudGpu: data.pricing.cloud_gpu_min_price_per_hour ?? DEFAULT_ONDEMAND.cloudGpu,
      })
      setDbPlans(data.plans)
    }).catch(() => {})  // silently fall back to defaults
  }, [])

  const displayPlans = dbPlans.length > 0 ? dbPlans : FALLBACK_PLANS
  const planGridClass = displayPlans.length <= 1 ? 'max-w-sm'
    : displayPlans.length === 2 ? 'grid-cols-2 max-w-2xl'
    : displayPlans.length <= 3 ? 'grid-cols-3 max-w-5xl'
    : 'grid-cols-4 max-w-6xl'

  const Check = ({ ok }: { ok: boolean }) => ok
    ? <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
    : <X size={15} className="text-gray-700 flex-shrink-0" />

  return (
    <div className="min-h-screen bg-[#060810] text-white">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#060810]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-14">
          <Logo size="sm" />

          <div className="hidden md:flex items-center gap-7 text-sm text-gray-500">
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#why" className="hover:text-white transition-colors">Why MLDock</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <button onClick={onGettingStarted} className="hover:text-white transition-colors">Docs</button>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <button onClick={onSignIn} className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
              Sign in
            </button>
            <button onClick={onGetStarted}
              className="px-4 py-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
              Start free <ArrowRight size={12} />
            </button>
          </div>

          <button onClick={() => setMenuOpen(v => !v)} className="md:hidden text-gray-500 hover:text-white">
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-white/5 px-5 py-4 space-y-3 bg-[#060810]">
            <a href="#how" onClick={() => setMenuOpen(false)} className="block text-sm text-gray-400 hover:text-white">How it works</a>
            <a href="#why" onClick={() => setMenuOpen(false)} className="block text-sm text-gray-400 hover:text-white">Why MLDock</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block text-sm text-gray-400 hover:text-white">Pricing</a>
            <a href="#faq" onClick={() => setMenuOpen(false)} className="block text-sm text-gray-400 hover:text-white">FAQ</a>
            <button onClick={onGettingStarted} className="block text-sm text-gray-400 hover:text-white">Docs</button>
            <div className="flex gap-2 pt-1">
              <button onClick={onSignIn} className="flex-1 py-2 text-sm border border-gray-800 rounded-lg text-gray-300">Sign in</button>
              <button onClick={onGetStarted} className="flex-1 py-2 text-sm bg-sky-600 rounded-lg text-white font-semibold">Start free</button>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Glow */}
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="w-[800px] h-[500px] rounded-full bg-sky-600/8 blur-[140px] -translate-y-1/4" />
        </div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-20 pb-20">
          <div className="grid lg:grid-cols-2 gap-16 items-center">

            {/* ── Left: copy ── */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/20 bg-sky-500/5 text-sky-400 text-xs mb-7 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                Open beta — train your first model free today
              </div>

              <h1 className="font-logo text-4xl sm:text-5xl lg:text-[3.25rem] font-bold text-white leading-[1.1] tracking-[-0.03em] mb-8">
                ML Training &amp; Deployment<br />
                <span className="text-sky-400">For Developers and Teams</span>
              </h1>

              <ul className="space-y-4 mb-10">
                {[
                  'Get your entire ML pipeline set up in minutes',
                  'Train, deploy, and monitor models across all projects and frameworks',
                  'Streamline inference — live REST API the moment training completes',
                  'Focus on your models, place your infrastructure on autopilot',
                ].map(point => (
                  <li key={point} className="flex items-start gap-3 text-gray-300 text-[15px] leading-snug">
                    <CheckCircle2 size={17} className="text-sky-400 flex-shrink-0 mt-0.5" />
                    {point}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={onGetStarted}
                  className="flex items-center justify-center gap-2 px-7 py-3.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-sky-900/40">
                  Sign Up — it's free <ArrowRight size={14} />
                </button>
                <button onClick={onSignIn}
                  className="flex items-center justify-center gap-2 px-7 py-3.5 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-xl text-sm transition-colors">
                  Log In
                </button>
              </div>

              <p className="text-gray-700 text-xs mt-5">
                No AWS account · No credit card required · No infrastructure to manage
              </p>
            </div>

            {/* ── Right: code window ── */}
            <div className="bg-[#0d1117] border border-white/8 rounded-2xl text-left overflow-hidden shadow-2xl shadow-black/80">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                <span className="text-gray-600 text-xs ml-2 font-mono">sentiment_trainer.py</span>
              </div>
              <pre className="px-5 py-5 text-[13px] font-mono leading-[1.8] overflow-x-auto">
<span className="text-violet-400">from</span> <span className="text-blue-300">mldock</span> <span className="text-violet-400">import</span> <span className="text-white">BaseTrainer</span>{'\n\n'}<span className="text-violet-400">class</span> <span className="text-emerald-400">SentimentModel</span><span className="text-gray-300">(BaseTrainer):</span>{'\n'}{'    '}<span className="text-amber-400">name</span>      <span className="text-gray-300">= </span><span className="text-emerald-300">"sentiment-v1"</span>{'\n'}{'    '}<span className="text-amber-400">framework</span> <span className="text-gray-300">= </span><span className="text-emerald-300">"sklearn"</span>{'\n\n'}{'    '}<span className="text-violet-400">def</span> <span className="text-blue-300">train</span><span className="text-gray-300">(self, data, cfg):</span>{'\n'}{'        '}<span className="text-gray-500"># your existing training logic</span>{'\n'}{'        '}<span className="text-violet-400">return</span> <span className="text-white">model</span>{'\n\n'}{'    '}<span className="text-violet-400">def</span> <span className="text-blue-300">predict</span><span className="text-gray-300">(self, inputs):</span>{'\n'}{'        '}<span className="text-violet-400">return</span> <span className="text-white">self.model.predict(inputs)</span></pre>
              <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between text-[11px] font-mono">
                <span className="text-gray-600">Drop in <span className="text-gray-400">/trainers/</span> → auto-detected</span>
                <span className="text-emerald-500">✓ ready to train</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── What we offer — clear pitch ── */}
      <section className="border-t border-white/5 bg-white/[0.015] py-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 text-center">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">What MLDock.io is</p>
          <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight mb-6 max-w-3xl mx-auto">
            The end-to-end ML platform that works for everyone — not just teams in San Francisco
          </h2>
          <p className="text-gray-400 text-base max-w-2xl mx-auto leading-relaxed mb-16">
            MLDock.io lets you train machine learning models, deploy them as production APIs, run experiments,
            monitor performance, and improve models over time — all from one dashboard, with no cloud account
            setup, no DevOps knowledge, and no international payment card.
          </p>

          <div className="grid sm:grid-cols-3 gap-5 text-left">
            {[
              {
                label: 'Train',
                color: 'border-violet-800/40 bg-violet-950/20',
                dot: 'bg-violet-500',
                points: ['Any Python framework', 'Local (free) or cloud GPU', 'MLflow experiment tracking', 'Automatic dataset versioning'],
              },
              {
                label: 'Deploy',
                color: 'border-sky-800/40 bg-sky-950/20',
                dot: 'bg-sky-500',
                points: ['REST API live instantly post-training', 'Signed API key access control', 'Model versioning & rollback', 'Zero-downtime updates'],
              },
              {
                label: 'Monitor & Improve',
                color: 'border-emerald-800/40 bg-emerald-950/20',
                dot: 'bg-emerald-500',
                points: ['Latency & error rate dashboards', 'A/B testing with traffic splits', 'Drift detection & alerts', 'Correct predictions → retrain'],
              },
            ].map(col => (
              <div key={col.label} className={clsx('rounded-2xl border p-6', col.color)}>
                <div className="flex items-center gap-2 mb-4">
                  <span className={clsx('w-2 h-2 rounded-full', col.dot)} />
                  <span className="text-xs font-bold text-white uppercase tracking-widest">{col.label}</span>
                </div>
                <ul className="space-y-2.5">
                  {col.points.map(p => (
                    <li key={p} className="flex items-start gap-2 text-sm text-gray-400">
                      <ChevronRight size={13} className="text-gray-600 flex-shrink-0 mt-0.5" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight">
              From idea to production in 4 steps
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative bg-gray-900/40 border border-white/5 rounded-2xl p-6 space-y-4">
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-8 -right-2 z-10 text-gray-700">
                    <ArrowRight size={14} />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 rounded-xl bg-gray-800/80 border border-white/5 flex items-center justify-center">
                    {s.icon}
                  </div>
                  <span className="text-[10px] font-bold text-gray-700 tracking-widest">{s.n}</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2 leading-snug">{s.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
                <span className={clsx('inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border', s.tagColor)}>
                  {s.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why MLDock — differentiators ── */}
      <section id="why" className="border-t border-white/5 bg-white/[0.015] py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Our edge</p>
            <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
              Why teams choose MLDock over the alternatives
            </h2>
            <p className="text-gray-500 text-sm max-w-xl mx-auto">
              SageMaker, W&B, Modal, Replicate — they all solve part of the problem. MLDock solves all of it, with no AWS account and no USD credit card.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-20">
            {DIFFERENTIATORS.map(d => (
              <div key={d.title} className="bg-gray-900/40 border border-white/5 rounded-2xl p-6">
                <div className="w-10 h-10 rounded-xl bg-gray-800/80 border border-white/5 flex items-center justify-center mb-4">
                  {d.icon}
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{d.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div>
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest text-center mb-6">Feature comparison</p>
            <div className="overflow-x-auto rounded-2xl border border-white/5">
              <div className="min-w-[540px]">
                <div className="grid grid-cols-5 bg-gray-900/60 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  <div className="col-span-2">Feature</div>
                  <div className="text-center text-sky-400">MLDock.io</div>
                  <div className="text-center">SageMaker</div>
                  <div className="text-center">W&B / Modal</div>
                </div>
                {VS.map((row, i) => (
                  <div key={row.feature} className={clsx(
                    'grid grid-cols-5 px-5 py-3 items-center text-sm border-t border-white/5',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]',
                  )}>
                    <div className="col-span-2 text-gray-400 text-xs">{row.feature}</div>
                    <div className="flex justify-center"><Check ok={row.us} /></div>
                    <div className="flex justify-center"><Check ok={row.sm} /></div>
                    <div className="flex justify-center"><Check ok={row.modal} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
              Simple. Transparent. No surprises.
            </h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
              Start free on your machine, scale to cloud GPU in one click. Billed from a pre-funded wallet — no surprise invoices.
            </p>

            {/* On-demand / Monthly toggle */}
            <div className="inline-flex rounded-xl border border-gray-800 overflow-hidden text-sm font-medium">
              <button
                onClick={() => setBillingMode('monthly')}
                className={clsx('px-5 py-2 transition-colors',
                  billingMode === 'monthly' ? 'bg-sky-700 text-white' : 'text-gray-500 hover:text-gray-300')}
              >
                Monthly plans
              </button>
              <button
                onClick={() => setBillingMode('ondemand')}
                className={clsx('px-5 py-2 transition-colors border-l border-gray-800',
                  billingMode === 'ondemand' ? 'bg-sky-700 text-white' : 'text-gray-500 hover:text-gray-300')}
              >
                On-demand rates
              </button>
            </div>
          </div>

          {billingMode === 'ondemand' ? (
            /* ── On-demand rate cards ── */
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    icon: <Monitor size={18} className="text-sky-400" />,
                    label: 'CPU Training',
                    price: `$${rates.cpu.toFixed(4)}`,
                    unit: '/ hr',
                    desc: 'Local CPU compute. No GPU required. Great for small models and prototyping.',
                    color: 'border-sky-800/40 bg-sky-950/20',
                  },
                  {
                    icon: <Zap size={18} className="text-violet-400" />,
                    label: 'Local GPU Training',
                    price: `$${rates.gpu.toFixed(4)}`,
                    unit: '/ hr',
                    desc: 'Your own CUDA GPU at a fraction of cloud price. Up to 3× faster than CPU.',
                    color: 'border-violet-800/40 bg-violet-950/20',
                  },
                  {
                    icon: <CloudLightning size={18} className="text-amber-400" />,
                    label: 'Cloud GPU',
                    price: `from $${rates.cloudGpu}`,
                    unit: '/ hr',
                    desc: 'RTX 3090, A100, H100. Reserved from wallet, unused time refunded.',
                    color: 'border-amber-800/40 bg-amber-950/20',
                  },
                ].map(card => (
                  <div key={card.label} className={clsx('rounded-2xl border p-5 flex flex-col gap-3', card.color)}>
                    <div className="flex items-center justify-between">
                      <div className="w-9 h-9 rounded-xl bg-gray-800/80 border border-white/5 flex items-center justify-center">
                        {card.icon}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">{card.label}</div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-white font-logo">{card.price}</span>
                        <span className="text-xs text-gray-600">{card.unit}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed flex-1">{card.desc}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/5 bg-gray-900/40 p-5 flex items-start gap-3">
                <Zap size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-white mb-1">Inference API</div>
                  <div className="text-xs text-gray-500">
                    <span className="text-white font-mono">${rates.inference.toFixed(6)}</span> per call after plan free calls are exhausted.
                    Pre-fund your wallet, no card required.
                  </div>
                </div>
              </div>
              <p className="text-center text-xs text-gray-600">
                All compute types include: experiment tracking · model versioning · REST API deployment · monitoring
              </p>
            </div>
          ) : (
            /* ── Monthly plan cards (live from DB) ── */
            <div>
              <div className={clsx('grid gap-5 mx-auto', planGridClass)}>
                {displayPlans.map((plan, idx) => {
                  const isFree = plan.price_usd_per_month === 0
                  // highlight the first paid plan
                  const isHighlight = !isFree && idx === 1
                  const period = plan.included_period ?? 'month'
                  const periodLabel = period === 'month' ? '/mo' : `/${period}`
                  const val = (plan as any).included_compute_value_usd as number | undefined
                  return (
                    <div key={plan.id ?? plan.name} className={clsx(
                      'rounded-2xl border p-6 flex flex-col relative',
                      isHighlight ? 'border-sky-500/60 bg-sky-950/25 ring-1 ring-sky-500/20' : 'border-white/6 bg-gray-900/40',
                    )}>
                      {isHighlight && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-sky-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
                          Most popular
                        </div>
                      )}

                      <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">{plan.name}</div>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-4xl font-bold text-white font-logo">
                          {isFree ? 'Free' : `$${plan.price_usd_per_month}`}
                        </span>
                        {!isFree && <span className="text-sm text-gray-500">{periodLabel}</span>}
                      </div>

                      {/* Included value badge */}
                      {val != null && val > 0 && (
                        <div className="text-[11px] text-emerald-400 mb-4">
                          ~${val} compute included per month
                        </div>
                      )}
                      {isFree && (
                        <div className="text-[11px] text-gray-600 mb-4">pay only for what you use</div>
                      )}

                      {/* Compute breakdown */}
                      <div className="space-y-1.5 mb-5 border-t border-white/5 pt-4">
                        {plan.included_cpu_hours > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-400"><Monitor size={10} className="text-sky-400" /> CPU training</span>
                            <span className="text-sky-300 font-medium">{plan.included_cpu_hours}h{periodLabel}</span>
                          </div>
                        )}
                        {plan.included_local_gpu_hours > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-400"><Zap size={10} className="text-violet-400" /> Local GPU</span>
                            <span className="text-violet-300 font-medium">{plan.included_local_gpu_hours}h{periodLabel}</span>
                          </div>
                        )}
                        {plan.included_cloud_gpu_credit_usd > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-400"><CloudLightning size={10} className="text-amber-400" /> Cloud GPU credit</span>
                            <span className="text-amber-300 font-medium">${plan.included_cloud_gpu_credit_usd}{periodLabel}</span>
                          </div>
                        )}
                        {isFree && (
                          <div className="text-[11px] text-gray-600 italic">
                            CPU ${rates.cpu}/hr · GPU ${rates.gpu}/hr · Cloud from ${rates.cloudGpu}/hr
                          </div>
                        )}
                        {plan.free_inference_calls > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-400"><BarChart2 size={10} className="text-blue-400" /> Inference calls</span>
                            <span className="text-blue-300 font-medium">{plan.free_inference_calls.toLocaleString()}{periodLabel}</span>
                          </div>
                        )}
                      </div>

                      <ul className="space-y-2 flex-1 mb-6">
                        {plan.new_customer_credit_usd > 0 && (
                          <li className="flex items-start gap-2 text-xs text-gray-400">
                            <CheckCircle2 size={10} className="text-green-400 flex-shrink-0 mt-0.5" />
                            ${plan.new_customer_credit_usd} welcome credit (one-time)
                          </li>
                        )}
                        <li className="flex items-start gap-2 text-xs text-gray-400">
                          <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> REST API deployment
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-400">
                          <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Experiment tracking (MLflow)
                        </li>
                        <li className="flex items-start gap-2 text-xs text-gray-400">
                          <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0 mt-0.5" /> Cloud GPU access (wallet, pay-as-you-go)
                        </li>
                      </ul>

                      <button onClick={onGetStarted}
                        className={clsx('w-full py-2.5 text-sm font-semibold rounded-xl transition-colors',
                          isHighlight ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/40'
                          : 'border border-white/10 hover:border-white/20 text-gray-400 hover:text-white')}>
                        {isFree ? 'Start now — no card needed' : 'Get started'}
                      </button>
                    </div>
                  )
                })}
              </div>
              <p className="text-center text-xs text-gray-600 mt-8">
                All plans: API keys · model versioning · monitoring · A/B testing · no AWS account required
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Global + Africa callout ── */}
      <section className="border-t border-white/5 bg-white/[0.015] py-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="grid sm:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Global platform, African roots</p>
              <h2 className="font-logo text-3xl font-bold text-white tracking-tight mb-5 leading-snug">
                The same GPUs as Silicon Valley. Accessible from anywhere.
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-5">
                Every major ML platform was built for teams in the US and Europe — requiring international credit cards, USD billing, and AWS accounts. Most African, Asian, and Latin American teams are blocked before they even start.
              </p>
              <p className="text-gray-400 text-sm leading-relaxed mb-8">
                MLDock.io was built by a Kenyan team to solve this. Local payment support, wallet-based billing, and the same RTX 3090s, A100s, and H100s that any global team uses. Your geography is no longer a limit.
              </p>
              <button onClick={onGetStarted}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400 hover:text-sky-300 transition-colors">
                Start for free — no card needed <ArrowRight size={13} />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Wallet billing', desc: 'Pre-fund in local currency. Spend on GPU time as needed.' },
                { label: 'Local payment methods', desc: 'No international USD card required. Pay the way you normally pay.' },
                { label: 'Same global GPUs', desc: 'RTX 3090, A100, H100 — the same hardware every top ML team uses.' },
                { label: '100% data ownership', desc: 'Your models and data stay yours. Nothing shared or sold.' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 bg-gray-900/40 border border-white/5 rounded-xl px-4 py-3.5">
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-white">{item.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="border-t border-white/5 bg-white/[0.015] py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">FAQ</p>
            <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Common questions
            </h2>
          </div>

          <FaqAccordion items={FAQ} />
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden py-28 text-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-[600px] h-[300px] rounded-full bg-sky-600/8 blur-[100px]" />
        </div>
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
          <h2 className="font-logo text-4xl sm:text-5xl font-bold text-white tracking-[-0.02em] mb-5">
            Ready to ship your first model?
          </h2>
          <p className="text-gray-400 text-base mb-3 max-w-lg mx-auto">
            Free to start. No infrastructure setup. No AWS account. No credit card.
          </p>
          <p className="text-gray-600 text-sm mb-10">Works with sklearn, PyTorch, XGBoost, YOLO, transformers, and more.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={onGetStarted}
              className="flex items-center justify-center gap-2 px-8 py-3.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-sky-900/40">
              Create free account <ArrowRight size={14} />
            </button>
            <button onClick={onApiDocs}
              className="flex items-center justify-center gap-2 px-8 py-3.5 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-xl text-sm transition-colors">
              <Code2 size={13} /> View API docs
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 bg-[#060810]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <Logo size="xs" />
              <div className="text-[10px] text-gray-700 pl-[34px]">Kreateyou Technologies Ltd, Kenya</div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-600">
              <button onClick={onGettingStarted} className="hover:text-gray-400 transition-colors">Docs</button>
              <button onClick={onApiDocs} className="hover:text-gray-400 transition-colors">API</button>
              <button onClick={onPrivacy} className="hover:text-gray-400 transition-colors">Privacy</button>
              <button onClick={onTerms} className="hover:text-gray-400 transition-colors">Terms</button>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-white/5 text-[11px] text-gray-700">
            © {new Date().getFullYear()} Kreateyou Technologies Ltd. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
