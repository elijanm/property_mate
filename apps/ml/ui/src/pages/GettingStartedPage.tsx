import { ArrowLeft, CheckCircle2, Terminal, Code2, Zap, Play, Wallet, Key } from 'lucide-react'
import clsx from 'clsx'
import PageFooter from '@/components/PageFooter'
import Logo from '@/components/Logo'

interface Props {
  onBack: () => void
  onSignIn: () => void
  onApiDocs: () => void
  onPrivacy?: () => void
  onTerms?: () => void
}

function CodeBlock({ code, lang = 'python', filename }: { code: string; lang?: string; filename?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden text-sm font-mono">
      {filename && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-950">
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="text-gray-500 text-xs ml-1">{filename}</span>
        </div>
      )}
      <pre className={clsx('p-4 overflow-x-auto text-[13px] leading-relaxed', lang === 'bash' ? 'text-emerald-400' : 'text-gray-300')}>
        {code}
      </pre>
    </div>
  )
}

function Section({ n, icon, title, children }: { n: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-900/50 border border-brand-800/50 flex items-center justify-center text-brand-400">
          {icon}
        </div>
        <div>
          <div className="text-[10px] text-brand-500 font-bold uppercase tracking-widest">{n}</div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
        </div>
      </div>
      <div className="pl-11 space-y-4">{children}</div>
    </section>
  )
}

export default function GettingStartedPage({ onBack, onSignIn, onApiDocs, onPrivacy, onTerms }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="border-b border-gray-800 sticky top-0 z-50 bg-gray-950/90 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={14} />
            <Logo size="sm" />
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onApiDocs} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">API Reference</button>
            <button onClick={onSignIn} className="px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-lg transition-colors">
              Sign in
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-16">
        {/* Header */}
        <div>
          <div className="text-[10px] text-brand-500 font-bold uppercase tracking-widest mb-2">Getting Started</div>
          <h1 className="text-4xl font-extrabold text-white mb-4">From zero to deployed model</h1>
          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl">
            Build and deploy a machine learning model in under 10 minutes — no Docker, no cloud account, no YAML.
          </p>

          {/* TOC */}
          <div className="mt-8 bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">In this guide</div>
            <div className="space-y-2">
              {[
                ['01', 'Create an account & top up wallet'],
                ['02', 'Write your trainer plugin'],
                ['03', 'Run your first local training job'],
                ['04', 'Launch on cloud GPU'],
                ['05', 'Call your deployed model'],
              ].map(([n, label]) => (
                <div key={n} className="flex items-center gap-3 text-sm">
                  <span className="text-brand-600 font-bold font-mono text-xs w-5">{n}</span>
                  <span className="text-gray-300">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Step 1 */}
        <Section n="Step 01" icon={<Wallet size={15} />} title="Create an account & top up your wallet">
          <p className="text-gray-400 text-sm leading-relaxed">
            Register at your MLDock.io instance. Once your account is active, go to <strong className="text-white">Wallet</strong> in the sidebar and top up using your preferred local payment method.
          </p>
          <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl p-4 text-xs text-amber-300 space-y-1">
            <div className="font-semibold">💡 How wallet billing works</div>
            <div className="text-amber-400/80">When you start a cloud GPU job, 3× the estimated cost is reserved. You're only charged for actual GPU time used. Any unspent reservation is returned to your balance automatically.</div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs text-gray-400">
            {[
              { icon: '💳', t: 'Card', d: 'Visa / Mastercard accepted through our secure payment partner.' },
              { icon: '📲', t: 'Mobile money', d: 'Supported in select regions via local payment methods.' },
              { icon: '💵', t: 'USD balance', d: 'Your local currency is converted to USD. Wallet always shows USD.' },
            ].map(i => (
              <div key={i.t} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1">
                <div className="text-lg">{i.icon}</div>
                <div className="font-semibold text-gray-300">{i.t}</div>
                <div className="text-gray-500 text-[11px]">{i.d}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Step 2 */}
        <Section n="Step 02" icon={<Code2 size={15} />} title="Write your trainer plugin">
          <p className="text-gray-400 text-sm leading-relaxed">
            A trainer is a plain Python file. Implement <code className="text-brand-300 bg-gray-900 px-1.5 py-0.5 rounded text-xs font-mono">BaseTrainer</code> with a <code className="text-brand-300 bg-gray-900 px-1.5 py-0.5 rounded text-xs font-mono">train()</code> and <code className="text-brand-300 bg-gray-900 px-1.5 py-0.5 rounded text-xs font-mono">predict()</code> method. Drop the file into your <code className="text-brand-300 bg-gray-900 px-1.5 py-0.5 rounded text-xs font-mono">/trainers/</code> directory.
          </p>

          <CodeBlock filename="trainers/my_classifier.py" code={`from ml_vault import BaseTrainer
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score


class MyClassifier(BaseTrainer):
    name        = "my-classifier"
    version     = "1.0.0"
    framework   = "sklearn"
    description = "Iris species classifier"
    category    = {"key": "classification", "label": "Classification"}

    # Schema shown in the UI inference panel
    input_schema = {
        "sepal_length": {"type": "number", "label": "Sepal length (cm)"},
        "sepal_width":  {"type": "number", "label": "Sepal width (cm)"},
        "petal_length": {"type": "number", "label": "Petal length (cm)"},
        "petal_width":  {"type": "number", "label": "Petal width (cm)"},
    }
    output_schema = {
        "species": {"type": "text", "label": "Predicted species"},
    }

    def train(self, data: bytes | None, config: dict):
        df = pd.read_csv("data/iris.csv")  # or use injected data
        X = df.drop("species", axis=1)
        y = df["species"]

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=config.get("test_split", 0.2), random_state=42
        )
        model = RandomForestClassifier(
            n_estimators=config.get("n_estimators", 100)
        )
        model.fit(X_train, y_train)
        acc = accuracy_score(y_test, model.predict(X_test))
        return model, {"accuracy": acc}

    def predict(self, model, input_data: dict) -> dict:
        import numpy as np
        features = np.array([[
            input_data["sepal_length"],
            input_data["sepal_width"],
            input_data["petal_length"],
            input_data["petal_width"],
        ]])
        return {"species": model.predict(features)[0]}`} />

          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { label: 'Supported frameworks', items: ['scikit-learn', 'PyTorch', 'XGBoost', 'Keras / TensorFlow', 'Any Python library'] },
              { label: 'What BaseTrainer gives you', items: ['Auto MLflow experiment logging', 'Model registry integration', 'Automatic deployment on complete', 'Config overrides from the UI'] },
            ].map(g => (
              <div key={g.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-500 font-medium mb-2">{g.label}</div>
                <ul className="space-y-1">
                  {g.items.map(i => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
                      <CheckCircle2 size={10} className="text-emerald-500" /> {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* Step 3 */}
        <Section n="Step 03" icon={<Play size={15} />} title="Run your first local training job">
          <p className="text-gray-400 text-sm leading-relaxed">
            Go to <strong className="text-white">Training</strong> in the sidebar. Select your trainer, leave Compute on <strong className="text-white">Local</strong>, and click Start Training. Local runs are always free.
          </p>
          <CodeBlock lang="bash" code={`# Optional: pass config overrides as JSON in the UI
# or call the API directly:

curl -X POST http://localhost:8030/api/v1/training/start \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trainer_name": "my-classifier",
    "compute_type": "local",
    "config_overrides": {
      "n_estimators": 200,
      "test_split": 0.25
    }
  }'`} />
          <p className="text-gray-500 text-xs">
            Watch the job appear in <strong className="text-gray-400">Jobs</strong> → logs stream live → model auto-deploys to the Models page on completion.
          </p>
        </Section>

        {/* Step 4 */}
        <Section n="Step 04" icon={<Zap size={15} />} title="Launch on cloud GPU">
          <p className="text-gray-400 text-sm leading-relaxed">
            Switch Compute to <strong className="text-white">Cloud GPU</strong>, click the GPU selector, choose your GPU and budget. Make sure your wallet balance covers 3× the estimated hourly cost.
          </p>
          <CodeBlock lang="bash" code={`curl -X POST http://localhost:8030/api/v1/training/start \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trainer_name": "my-classifier",
    "compute_type": "cloud_gpu",
    "gpu_type_id": "NVIDIA GeForce RTX 3090",
    "config_overrides": { "n_estimators": 500 }
  }'`} />
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs space-y-2">
            <div className="text-gray-400 font-medium">GPU tiers available</div>
            {[
              { tier: 'Budget', gpu: 'RTX 3080 · RTX 3090', price: 'from $0.28 USD/hr', color: 'text-emerald-400' },
              { tier: 'Standard', gpu: 'RTX 4090 · A4000', price: 'from $0.62 USD/hr', color: 'text-blue-400' },
              { tier: 'Performance', gpu: 'A40 · A6000', price: 'from $1.11 USD/hr', color: 'text-violet-400' },
              { tier: 'Enterprise', gpu: 'A100 80GB', price: 'from $2.79 USD/hr', color: 'text-amber-400' },
            ].map(g => (
              <div key={g.tier} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={clsx('font-bold', g.color)}>{g.tier}</span>
                  <span className="text-gray-500">{g.gpu}</span>
                </div>
                <span className="text-gray-400 font-mono">{g.price}</span>
              </div>
            ))}
            <div className="text-gray-600 pt-1">Live prices fetched at job submission. Actual charge based on real GPU time used.</div>
          </div>
        </Section>

        {/* Step 5 */}
        <Section n="Step 05" icon={<Key size={15} />} title="Call your deployed model">
          <p className="text-gray-400 text-sm leading-relaxed">
            Once training completes, your model is live. Grab an API key from <strong className="text-white">API Keys</strong> in the sidebar and start calling the inference endpoint.
          </p>
          <CodeBlock lang="bash" code={`# REST inference
curl -X POST http://localhost:8030/api/v1/inference/my-classifier/predict \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sepal_length": 5.1,
    "sepal_width": 3.5,
    "petal_length": 1.4,
    "petal_width": 0.2
  }'

# Response:
# { "species": "setosa", "latency_ms": 12 }`} />
          <CodeBlock filename="example.py" code={`import requests

API_KEY  = "mlv_your_api_key_here"
BASE_URL = "http://localhost:8030/api/v1"

resp = requests.post(
    f"{BASE_URL}/inference/my-classifier/predict",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "sepal_length": 5.1,
        "sepal_width":  3.5,
        "petal_length": 1.4,
        "petal_width":  0.2,
    }
)
print(resp.json())  # {'species': 'setosa', 'latency_ms': 12}`} />
        </Section>

        {/* Next steps */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">Next steps</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: <Terminal size={13} />, title: 'API Reference', desc: 'Full REST API docs with all endpoints', action: onApiDocs },
              { icon: <Zap size={13} />, title: 'A/B Testing', desc: 'Route traffic between model versions', action: undefined },
              { icon: <BarChart3 size={13} />, title: 'Monitoring', desc: 'Drift detection, latency alerts, dashboards', action: undefined },
              { icon: <Key size={13} />, title: 'Batch inference', desc: 'Submit bulk prediction jobs async', action: undefined },
            ].map(n => (
              <button key={n.title} onClick={n.action}
                className="flex items-start gap-3 p-3 bg-gray-950 border border-gray-800 hover:border-gray-600 rounded-xl text-left transition-colors group">
                <div className="text-brand-400 mt-0.5">{n.icon}</div>
                <div>
                  <div className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{n.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{n.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
      <PageFooter onApiDocs={onApiDocs} onPrivacy={onPrivacy} onTerms={onTerms} />
    </div>
  )
}

// BarChart3 import needed
import { BarChart3 } from 'lucide-react'
