import { useState } from 'react'
import {
  ArrowRight, Code2, Menu, X, CheckCircle2, Zap, Globe, Shield,
  BarChart2, GitBranch, Cpu, CloudLightning, Layers,
  ChevronRight, Play, Database,
} from 'lucide-react'
import clsx from 'clsx'
import Logo from '@/components/Logo'

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
    tag: 'From $0.28/hr',
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
    title: 'Free local training tier',
    body: '10 hours of local CPU training per month, free forever. Great for prototyping, smaller models, and teams that want to validate before spending on GPU time.',
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

const PLANS = [
  {
    name: 'Local',
    price: 'Free',
    note: 'forever',
    highlight: false,
    badge: null,
    items: [
      '10 hrs local training / month',
      'REST API deployment',
      'Experiment tracking (MLflow)',
      'Monitoring & alerts',
      'API key management',
    ],
    cta: 'Start free',
  },
  {
    name: 'Cloud GPU',
    price: '$0.28',
    note: 'per GPU hour',
    highlight: true,
    badge: 'Most popular',
    items: [
      'Everything in Local',
      'RTX 3090, A100, H100 access',
      'Pay-as-you-go wallet billing',
      'Unused cost refunded instantly',
      'Local payment methods accepted',
      'Priority job queue',
    ],
    cta: 'Get started',
  },
  {
    name: 'White-label',
    price: 'Custom',
    note: 'talk to us',
    highlight: false,
    badge: null,
    items: [
      'Everything in Cloud GPU',
      'Your branding & domain',
      'Multi-tenant resale',
      'Dedicated infrastructure',
      'SLA + dedicated support',
    ],
    cta: 'Contact us',
  },
]

// ── Component ──────────────────────────────────────────────────────────────────

export default function LandingPage({ onSignIn, onGetStarted, onApiDocs, onGettingStarted, onPrivacy, onTerms }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

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
          <div className="w-[700px] h-[400px] rounded-full bg-sky-600/10 blur-[120px] -translate-y-1/3" />
        </div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/20 bg-sky-500/5 text-sky-400 text-xs mb-8 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            Open beta — train your first model free today
          </div>

          <h1 className="font-logo text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-[1.06] tracking-[-0.03em] mb-6 max-w-4xl mx-auto">
            Train ML models.<br />
            <span className="text-sky-400">Deploy REST APIs.</span><br />
            No infrastructure.
          </h1>

          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto mb-4 leading-relaxed">
            The complete platform for the entire ML lifecycle — from training to production monitoring.
            Works with any Python framework. Runs on your machine or cloud GPUs.
            Accepts local payments.
          </p>
          <p className="text-gray-600 text-sm mb-10">
            No AWS account. No credit card required to start. No infrastructure to manage.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-20">
            <button onClick={onGetStarted}
              className="flex items-center justify-center gap-2 px-7 py-3.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl text-sm transition-colors shadow-lg shadow-sky-900/40">
              Start for free <ArrowRight size={14} />
            </button>
            <button onClick={onGettingStarted}
              className="flex items-center justify-center gap-2 px-7 py-3.5 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-xl text-sm transition-colors">
              <Play size={13} /> See how it works
            </button>
          </div>

          {/* Code window */}
          <div className="bg-[#0d1117] border border-white/8 rounded-2xl text-left max-w-2xl mx-auto overflow-hidden shadow-2xl shadow-black/80">
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
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="font-logo text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
              Simple. Transparent. No surprises.
            </h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              Local training is free forever. Pay only for GPU time you actually use — billed from a pre-funded wallet, not post-hoc.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {PLANS.map(plan => (
              <div key={plan.name} className={clsx(
                'rounded-2xl border p-6 flex flex-col',
                plan.highlight
                  ? 'border-sky-600/50 bg-sky-950/20 ring-1 ring-sky-600/20'
                  : 'border-white/5 bg-gray-900/40',
              )}>
                {plan.badge && (
                  <div className="text-[10px] text-sky-400 font-bold uppercase tracking-widest mb-3">{plan.badge}</div>
                )}
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">{plan.name}</div>
                <div className="text-3xl font-bold text-white tracking-tight mb-0.5 font-logo">{plan.price}</div>
                <div className="text-[11px] text-gray-600 mb-6">{plan.note}</div>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.items.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs text-gray-400">
                      <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={plan.name === 'White-label' ? undefined : onGetStarted}
                  className={clsx(
                    'w-full py-2.5 text-sm font-semibold rounded-xl transition-colors',
                    plan.highlight
                      ? 'bg-sky-600 hover:bg-sky-500 text-white'
                      : 'border border-white/10 hover:border-white/20 text-gray-400 hover:text-white',
                  )}>
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-gray-600 mt-8">
            All plans include: API key management · experiment tracking · model versioning · monitoring dashboards
          </p>
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
