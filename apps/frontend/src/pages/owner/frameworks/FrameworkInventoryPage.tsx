import { useParams } from 'react-router-dom'

// Spare parts inventory — mirrors PropertyInventoryPage but scoped to framework.
// Full implementation reuses the existing inventory API with framework_id as the entity context.
// This is a focused view for spare parts: air filters, oil filters, belts, batteries, etc.

const CATEGORIES = [
  { name: 'Air Filters', icon: '🌬️', count: 0, unit: 'pcs', reorder: 10 },
  { name: 'Oil Filters', icon: '🛢️', count: 0, unit: 'pcs', reorder: 10 },
  { name: 'Fuel Filters', icon: '⛽', count: 0, unit: 'pcs', reorder: 5 },
  { name: 'Engine Belts', icon: '🔗', count: 0, unit: 'pcs', reorder: 3 },
  { name: 'Engine Oil', icon: '🧴', count: 0, unit: 'litres', reorder: 20 },
  { name: 'Coolant', icon: '🧊', count: 0, unit: 'litres', reorder: 10 },
  { name: 'Batteries (12V)', icon: '🔋', count: 0, unit: 'pcs', reorder: 2 },
  { name: 'Spark Plugs', icon: '⚡', count: 0, unit: 'pcs', reorder: 8 },
  { name: 'Control Modules', icon: '🖥️', count: 0, unit: 'pcs', reorder: 1 },
  { name: 'Voltage Regulators', icon: '⚙️', count: 0, unit: 'pcs', reorder: 2 },
  { name: 'Earth Leakage Breakers', icon: '🔌', count: 0, unit: 'pcs', reorder: 2 },
  { name: 'Other Parts', icon: '📦', count: 0, unit: 'pcs', reorder: 0 },
]

export default function FrameworkInventoryPage() {
  useParams<{ frameworkId: string }>()

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Spare Parts Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track consumables and spare parts for framework assets.</p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg"
          style={{ backgroundColor: '#D97706' }}
        >
          + Stock In
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-4 mb-7">
        {[
          { label: 'Part Categories', value: CATEGORIES.length, icon: '📦' },
          { label: 'Total Stock Items', value: 0, icon: '🗃️' },
          { label: 'Below Reorder Level', value: 0, icon: '⚠️' },
          { label: 'Movements This Month', value: 0, icon: '🔄' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-lg mb-1">{s.icon}</div>
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {CATEGORIES.map(cat => (
          <div
            key={cat.name}
            className="bg-white rounded-xl border border-gray-200 hover:border-amber-300 hover:shadow-sm cursor-pointer transition-all p-4"
          >
            <div className="text-2xl mb-2">{cat.icon}</div>
            <div className="text-sm font-semibold text-gray-900 mb-0.5">{cat.name}</div>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-gray-700">{cat.count}</span>
              <span className="text-xs text-gray-400">{cat.unit}</span>
            </div>
            {cat.reorder > 0 && cat.count < cat.reorder && (
              <div className="mt-1.5 text-[10px] font-bold text-red-600">⚠️ Reorder: &lt;{cat.reorder}</div>
            )}
          </div>
        ))}
      </div>

      {/* Movements table placeholder */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Recent Movements</h2>
        </div>
        <div className="py-16 text-center">
          <div className="text-3xl mb-2">📦</div>
          <p className="text-sm text-gray-500">No stock movements recorded yet.</p>
          <p className="text-xs text-gray-400 mt-1">Record parts used during work orders to track inventory.</p>
        </div>
      </div>
    </div>
  )
}
