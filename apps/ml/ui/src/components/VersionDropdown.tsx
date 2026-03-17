import { ChevronDown, GitBranch } from 'lucide-react'
import type { ModelDeployment } from '@/types/trainer'

interface Props {
  deployments: ModelDeployment[]
  selected: ModelDeployment
  onChange: (d: ModelDeployment) => void
  label?: string
}

export default function VersionDropdown({ deployments, selected, onChange, label = 'Version:' }: Props) {
  if (deployments.length <= 1) return null
  const sorted = [...deployments].sort(
    (a, b) => parseInt(b.mlflow_model_version || '0') - parseInt(a.mlflow_model_version || '0')
  )
  return (
    <div className="flex items-center gap-2 mb-5">
      <GitBranch size={13} className="text-gray-500 shrink-0" />
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <div className="relative">
        <select
          value={selected.id}
          onChange={e => {
            const d = sorted.find(d => d.id === e.target.value)
            if (d) onChange(d)
          }}
          className="appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 pr-7 text-xs text-gray-200 focus:outline-none focus:border-brand-500"
        >
          {sorted.map(d => (
            <option key={d.id} value={d.id}>
              v{d.mlflow_model_version}{d.is_default ? ' ★ default' : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      </div>
    </div>
  )
}
