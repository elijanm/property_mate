import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { propertiesApi } from '@/api/properties'
import PropertyBreadcrumb from '@/components/PropertyBreadcrumb'
import { extractApiError } from '@/utils/apiError'
import PropertyEditSlideOver from '@/components/PropertyEditSlideOver'
import SignaturePad from '@/components/SignaturePad'
import { PRESET_COLORS } from '@/layouts/PropertyWorkspaceLayout'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import type { Property, PaymentConfig, LateFeeSetting } from '@/types/property'
import type { AccountEntry } from '@/types/org'

type Tab = 'color' | 'payment' | 'billing' | 'signature' | 'accounts' | 'info'

const TABS: { id: Tab; label: string }[] = [
  { id: 'color', label: 'Appearance' },
  { id: 'payment', label: 'Payment' },
  { id: 'billing', label: 'Billing' },
  { id: 'signature', label: 'Signature' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'info', label: 'Info' },
]

const TYPE_BADGE: Record<string, string> = {
  income:    'bg-green-100 text-green-800',
  expense:   'bg-red-100 text-red-700',
  asset:     'bg-blue-100 text-blue-700',
  liability: 'bg-orange-100 text-orange-800',
}

const EMPTY_PAYMENT_CONFIG: PaymentConfig = {
  paybill_number: '',
  till_number: '',
  bank_name: '',
  bank_account: '',
  bank_branch: '',
  online_payment_enabled: false,
  account_reference_type: 'unit_code',
  custom_account_reference: '',
}

export default function PropertySettingsPage() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { orgProfile } = useOrgProfile()
  const [tab, setTab] = useState<Tab>('color')
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  // Color state
  const [colorSaving, setColorSaving] = useState(false)
  const [colorError, setColorError] = useState<string | null>(null)

  // Payment config state
  const [payConfig, setPayConfig] = useState<PaymentConfig>(EMPTY_PAYMENT_CONFIG)
  const [paySaving, setPaySaving] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [paySaved, setPaySaved] = useState(false)

  // Billing settings state
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingSaved, setBillingSaved] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingSettings, setBillingSettings] = useState({
    invoice_day: 1,
    due_days: 7,
    grace_days: 3,
    late_fee_type: 'flat' as 'flat' | 'percentage',
    late_fee_value: 500,
    show_tiered_breakdown: false,
  })

  // Late Fee Automation state
  const [lateFeeSetting, setLateFeeSetting] = useState<LateFeeSetting>({
    enabled: false,
    grace_days: 5,
    fee_type: 'fixed',
    fee_value: 500,
    max_applications: 1,
  })
  const [lateFeeSaving, setLateFeeSaving] = useState(false)
  const [lateFeeSaved, setLateFeeSaved] = useState(false)
  const [lateFeeError, setLateFeeError] = useState<string | null>(null)

  // Signature state
  const sigFileRef = useRef<HTMLInputElement>(null)
  const [sigMode, setSigMode] = useState<'upload' | 'draw'>('upload')
  const [sigUploading, setSigUploading] = useState(false)
  const [sigSaving, setSigSaving] = useState(false)
  const [sigDeleting, setSigDeleting] = useState(false)
  const [sigError, setSigError] = useState<string | null>(null)
  const [sigSaved, setSigSaved] = useState(false)
  const [sigName, setSigName] = useState('')
  const [sigTitle, setSigTitle] = useState('')
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null)
  const [drawEmpty, setDrawEmpty] = useState(true)
  const [drawSaving, setDrawSaving] = useState(false)

  useEffect(() => {
    if (!propertyId) return
    propertiesApi.get(propertyId)
      .then((p) => {
        setProperty(p)
        setPayConfig({ ...EMPTY_PAYMENT_CONFIG, ...p.payment_config })
        // Fall back to org-level signatory fields when property hasn't overridden them
        setSigName(p.signature_config?.signatory_name ?? orgProfile?.signature_config?.signatory_name ?? '')
        setSigTitle(p.signature_config?.signatory_title ?? orgProfile?.signature_config?.signatory_title ?? '')
        if (p.billing_settings) {
          setBillingSettings((prev) => ({ ...prev, ...p.billing_settings }))
        }
        if (p.late_fee_setting) {
          setLateFeeSetting({ ...lateFeeSetting, ...p.late_fee_setting })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [propertyId, orgProfile])

  async function pickColor(hex: string) {
    if (!propertyId || !property) return
    setColorSaving(true)
    setColorError(null)
    try {
      const updated = await propertiesApi.update(propertyId, { color: hex })
      setProperty(updated)
    } catch (err) {
      setColorError(extractApiError(err).message)
    } finally {
      setColorSaving(false)
    }
  }

  async function savePaymentConfig() {
    if (!propertyId) return
    setPaySaving(true)
    setPayError(null)
    setPaySaved(false)
    try {
      const updated = await propertiesApi.updatePaymentConfig(propertyId, payConfig)
      setProperty(updated)
      setPayConfig({ ...EMPTY_PAYMENT_CONFIG, ...updated.payment_config })
      setPaySaved(true)
      setTimeout(() => setPaySaved(false), 3000)
    } catch (err) {
      setPayError(extractApiError(err).message)
    } finally {
      setPaySaving(false)
    }
  }

  async function saveBillingSettings() {
    if (!propertyId) return
    setBillingSaving(true)
    setBillingError(null)
    setBillingSaved(false)
    try {
      const updated = await propertiesApi.updateBillingSettings(propertyId, billingSettings)
      setProperty(updated)
      setBillingSaved(true)
      setTimeout(() => setBillingSaved(false), 3000)
    } catch (err) {
      setBillingError(extractApiError(err).message)
    } finally {
      setBillingSaving(false)
    }
  }

  async function saveLateFeeSetting() {
    if (!propertyId) return
    setLateFeeSaving(true)
    setLateFeeError(null)
    setLateFeeSaved(false)
    try {
      const updated = await propertiesApi.updateLateFeeSetting(propertyId, lateFeeSetting)
      setProperty(updated)
      if (updated.late_fee_setting) setLateFeeSetting({ ...lateFeeSetting, ...updated.late_fee_setting })
      setLateFeeSaved(true)
      setTimeout(() => setLateFeeSaved(false), 3000)
    } catch (err) {
      setLateFeeError(extractApiError(err).message)
    } finally {
      setLateFeeSaving(false)
    }
  }

  async function uploadPropertySignature(file: File) {
    if (!propertyId) return
    setSigUploading(true)
    setSigError(null)
    try {
      const updated = await propertiesApi.uploadSignature(propertyId, file)
      setProperty(updated)
    } catch (err) {
      setSigError(extractApiError(err).message)
    } finally {
      setSigUploading(false)
    }
  }

  async function handleSaveDrawn() {
    if (!drawnDataUrl || !propertyId) return
    setDrawSaving(true)
    setSigError(null)
    try {
      const res = await fetch(drawnDataUrl)
      const blob = await res.blob()
      const file = new File([blob], 'signature.png', { type: 'image/png' })
      const updated = await propertiesApi.uploadSignature(propertyId, file)
      setProperty(updated)
      setDrawnDataUrl(null)
      setDrawEmpty(true)
    } catch (err) {
      setSigError(extractApiError(err).message)
    } finally {
      setDrawSaving(false)
    }
  }

  async function savePropertySignatureConfig() {
    if (!propertyId) return
    setSigSaving(true)
    setSigError(null)
    setSigSaved(false)
    try {
      const updated = await propertiesApi.updateSignatureConfig(propertyId, { signatory_name: sigName, signatory_title: sigTitle })
      setProperty(updated)
      setSigSaved(true)
      setTimeout(() => setSigSaved(false), 3000)
    } catch (err) {
      setSigError(extractApiError(err).message)
    } finally {
      setSigSaving(false)
    }
  }

  async function deletePropertySignature() {
    if (!propertyId || !confirm('Remove property signature override?')) return
    setSigDeleting(true)
    setSigError(null)
    try {
      const updated = await propertiesApi.deleteSignature(propertyId)
      setProperty(updated)
      setSigName('')
      setSigTitle('')
    } catch (err) {
      setSigError(extractApiError(err).message)
    } finally {
      setSigDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 bg-gray-200 rounded w-48 animate-pulse mb-6" />
        <div className="h-40 bg-white rounded-xl border border-gray-200 animate-pulse" />
      </div>
    )
  }

  if (!property) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">Property not found.</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <PropertyBreadcrumb page="Settings" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Property Settings</h1>
        <button
          onClick={() => setShowEdit(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Edit Settings
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Color tab */}
      {tab === 'color' && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Property Color</h2>
          <p className="text-xs text-gray-500 mb-4">Used for the property avatar and sidebar accent.</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((hex) => (
              <button
                key={hex}
                onClick={() => pickColor(hex)}
                disabled={colorSaving}
                className="w-8 h-8 rounded-full border-2 transition-all disabled:opacity-50"
                style={{
                  backgroundColor: hex,
                  borderColor: property.color === hex ? 'white' : hex,
                  outline: property.color === hex ? `3px solid ${hex}` : 'none',
                  outlineOffset: '2px',
                }}
                title={hex}
              />
            ))}
          </div>
          {colorError && <p className="text-xs text-red-500 mt-2">{colorError}</p>}
          {colorSaving && <p className="text-xs text-gray-400 mt-2">Saving…</p>}
        </section>
      )}

      {/* Payment tab */}
      {tab === 'payment' && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Payment Settings</h2>
          <p className="text-xs text-gray-500 mb-4">
            Configure how tenants pay rent. These details appear on the lease contract and onboarding wizard.
          </p>

          <div className="space-y-4">
            {/* Mpesa */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">M-Pesa</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Paybill Number</label>
                  <input type="text" value={payConfig.paybill_number ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, paybill_number: e.target.value }))} placeholder="e.g. 400200" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Till Number</label>
                  <input type="text" value={payConfig.till_number ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, till_number: e.target.value }))} placeholder="e.g. 123456" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>

            {/* Bank */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Bank</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Bank Name</label>
                  <input type="text" value={payConfig.bank_name ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. KCB Bank" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Account Number</label>
                  <input type="text" value={payConfig.bank_account ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, bank_account: e.target.value }))} placeholder="e.g. 1234567890" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">Branch</label>
                  <input type="text" value={payConfig.bank_branch ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, bank_branch: e.target.value }))} placeholder="e.g. Westlands" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>

            {/* Account reference */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Account Reference</p>
              <p className="text-xs text-gray-400 mb-2">What tenants enter as the account/reference when paying.</p>
              <select value={payConfig.account_reference_type} onChange={(e) => setPayConfig((p) => ({ ...p, account_reference_type: e.target.value as PaymentConfig['account_reference_type'] }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2">
                <option value="unit_code">Unit Code (e.g. A-101)</option>
                <option value="tenant_id">Tenant ID</option>
                <option value="custom">Custom reference</option>
              </select>
              {payConfig.account_reference_type === 'custom' && (
                <input type="text" value={payConfig.custom_account_reference ?? ''} onChange={(e) => setPayConfig((p) => ({ ...p, custom_account_reference: e.target.value }))} placeholder="Enter custom reference" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
            </div>

            {/* Online payment toggle */}
            <div className="flex items-center justify-between py-2 border-t border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-700">Enable online payment in onboarding</p>
                <p className="text-xs text-gray-400">Tenants can pay via M-Pesa STK push during onboarding.</p>
              </div>
              <button type="button" onClick={() => setPayConfig((p) => ({ ...p, online_payment_enabled: !p.online_payment_enabled }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${payConfig.online_payment_enabled ? 'bg-blue-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${payConfig.online_payment_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
            <button onClick={savePaymentConfig} disabled={paySaving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {paySaving ? 'Saving…' : 'Save Payment Settings'}
            </button>
            {paySaved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
            {payError && <span className="text-xs text-red-500">{payError}</span>}
          </div>
        </section>
      )}

      {/* Billing tab */}
      {tab === 'billing' && (
        <>
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Billing Settings</h2>
            <p className="text-xs text-gray-500">
              Controls invoice generation schedule, late fees, and PDF invoice format.
            </p>
          </div>

          {/* Schedule */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Schedule</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Invoice Day</label>
                <input
                  type="number" min={1} max={28}
                  value={billingSettings.invoice_day}
                  onChange={(e) => setBillingSettings((p) => ({ ...p, invoice_day: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-0.5">Day of month to generate</p>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Due Days</label>
                <input
                  type="number" min={0}
                  value={billingSettings.due_days}
                  onChange={(e) => setBillingSettings((p) => ({ ...p, due_days: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-0.5">Days until payment due</p>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Grace Days</label>
                <input
                  type="number" min={0}
                  value={billingSettings.grace_days}
                  onChange={(e) => setBillingSettings((p) => ({ ...p, grace_days: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-0.5">Before late fee applies</p>
              </div>
            </div>
          </div>

          {/* Late fee */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Late Fee</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Type</label>
                <select
                  value={billingSettings.late_fee_type}
                  onChange={(e) => setBillingSettings((p) => ({ ...p, late_fee_type: e.target.value as 'flat' | 'percentage' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="flat">Flat Amount</option>
                  <option value="percentage">Percentage of Total</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  {billingSettings.late_fee_type === 'flat' ? 'Amount (KES)' : 'Percentage (%)'}
                </label>
                <input
                  type="number" min={0}
                  value={billingSettings.late_fee_value}
                  onChange={(e) => setBillingSettings((p) => ({ ...p, late_fee_value: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* PDF options */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">PDF Invoice Options</p>
            <div className="flex items-center justify-between py-2 border border-gray-100 rounded-lg px-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Show tiered rate breakdown</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Adds a per-band calculation table for metered utilities with tiered pricing.
                  Useful to avoid billing disputes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBillingSettings((p) => ({ ...p, show_tiered_breakdown: !p.show_tiered_breakdown }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-4 flex-shrink-0 ${billingSettings.show_tiered_breakdown ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${billingSettings.show_tiered_breakdown ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {billingError && <p className="text-xs text-red-500">{billingError}</p>}

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={saveBillingSettings}
              disabled={billingSaving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {billingSaving ? 'Saving…' : 'Save Billing Settings'}
            </button>
            {billingSaved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
          </div>
        </section>

        {/* Late Fee Automation */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Late Fee Automation</h2>
              <p className="text-xs text-gray-500 mt-0.5">Automatically apply late fees to overdue invoices.</p>
            </div>
            <button
              type="button"
              onClick={() => setLateFeeSetting((p) => ({ ...p, enabled: !p.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${lateFeeSetting.enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${lateFeeSetting.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {lateFeeSetting.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Grace Days After Due Date</label>
                <input
                  type="number" min={0}
                  value={lateFeeSetting.grace_days}
                  onChange={(e) => setLateFeeSetting((p) => ({ ...p, grace_days: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Fee Type</label>
                <select
                  value={lateFeeSetting.fee_type}
                  onChange={(e) => setLateFeeSetting((p) => ({ ...p, fee_type: e.target.value as 'fixed' | 'percentage' }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="fixed">Fixed Amount (KES)</option>
                  <option value="percentage">Percentage of Balance Due</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  {lateFeeSetting.fee_type === 'fixed' ? 'Amount (KES)' : 'Percentage (%)'}
                </label>
                <input
                  type="number" min={0}
                  value={lateFeeSetting.fee_value}
                  onChange={(e) => setLateFeeSetting((p) => ({ ...p, fee_value: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Max Applications Per Invoice</label>
                <input
                  type="number" min={0}
                  value={lateFeeSetting.max_applications}
                  onChange={(e) => setLateFeeSetting((p) => ({ ...p, max_applications: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-0.5">0 = unlimited</p>
              </div>
            </div>
          )}

          {lateFeeError && <p className="text-xs text-red-500">{lateFeeError}</p>}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button
              onClick={saveLateFeeSetting}
              disabled={lateFeeSaving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {lateFeeSaving ? 'Saving…' : 'Save Late Fee Setting'}
            </button>
            {lateFeeSaved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
          </div>
        </section>
        </>
      )}

      {/* Signature tab */}
      {tab === 'signature' && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Countersignature</h2>
            <p className="text-xs text-gray-500">
              Property-level override. When set, this is used instead of the global default.
              {!property.signature_config?.signature_key && (
                <span className="ml-1 text-blue-600 font-medium">(Inheriting from global settings)</span>
              )}
            </p>
          </div>

          {/* Current signature */}
          {property.signature_config?.signature_key && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Current signature</p>
              <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 flex items-center justify-center" style={{ minHeight: 80 }}>
                <img src={property.signature_config.signature_key} alt="Signature" className="max-h-20 max-w-full object-contain" />
              </div>
              <button type="button" onClick={deletePropertySignature} disabled={sigDeleting} className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">
                {sigDeleting ? 'Removing…' : 'Clear override (revert to global)'}
              </button>
            </div>
          )}

          {/* Mode tabs */}
          <div>
            <div className="flex border-b border-gray-200 mb-4">
              {(['upload', 'draw'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setSigMode(m)} className={['px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors', sigMode === m ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'].join(' ')}>
                  {m === 'upload' ? 'Upload Image' : 'Draw Signature'}
                </button>
              ))}
            </div>

            {sigMode === 'upload' ? (
              <div>
                <button type="button" onClick={() => sigFileRef.current?.click()} disabled={sigUploading} className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50">
                  <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <span className="text-sm text-gray-500">{sigUploading ? 'Uploading…' : 'Upload PNG, JPG or SVG'}</span>
                </button>
                <input ref={sigFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPropertySignature(f) }} />
              </div>
            ) : (
              <div className="space-y-3">
                <SignaturePad
                  onSign={(d) => { setDrawnDataUrl(d); setDrawEmpty(false) }}
                  onClear={() => { setDrawnDataUrl(null); setDrawEmpty(true) }}
                  isEmpty={drawEmpty}
                  initialUrl={property.signature_config?.signature_key ?? undefined}
                />
                <button type="button" onClick={handleSaveDrawn} disabled={drawEmpty || drawSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                  {drawSaving ? 'Saving…' : 'Save Drawn Signature'}
                </button>
              </div>
            )}
          </div>

          {/* Name / Title */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Signatory Name
                {!property.signature_config?.signatory_name && orgProfile?.signature_config?.signatory_name && (
                  <span className="ml-1 text-blue-500 font-normal">(from global)</span>
                )}
              </label>
              <input
                type="text"
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
                placeholder={orgProfile?.signature_config?.signatory_name ?? 'e.g. Cecil Homes'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Signatory Title
                {!property.signature_config?.signatory_title && orgProfile?.signature_config?.signatory_title && (
                  <span className="ml-1 text-blue-500 font-normal">(from global)</span>
                )}
              </label>
              <input
                type="text"
                value={sigTitle}
                onChange={(e) => setSigTitle(e.target.value)}
                placeholder={orgProfile?.signature_config?.signatory_title ?? 'e.g. Property Manager'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {sigError && <p className="text-xs text-red-500">{sigError}</p>}

          <div className="flex items-center gap-3">
            <button onClick={savePropertySignatureConfig} disabled={sigSaving} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {sigSaving ? 'Saving…' : 'Save Name & Title'}
            </button>
            {sigSaved && <span className="text-xs text-green-600 font-medium">Saved!</span>}
          </div>
        </section>
      )}

      {/* Accounts tab */}
      {tab === 'accounts' && (() => {
        // Property-level override takes priority; fall back to org defaults
        const accounts: AccountEntry[] =
          property.ledger_settings?.accounts?.length
            ? property.ledger_settings.accounts
            : (orgProfile?.ledger_settings?.accounts ?? [])
        const isOrgDefault = !property.ledger_settings?.accounts?.length

        const grouped = accounts.reduce<Record<string, AccountEntry[]>>((acc, a) => {
          const k = a.account_type
          ;(acc[k] ||= []).push(a)
          return acc
        }, {})
        const typeOrder = ['income', 'asset', 'liability', 'expense']

        return (
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Chart of Accounts</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Accounts used for ledger postings on invoices, payments and deductions.
                  {isOrgDefault && (
                    <span className="ml-1 text-blue-600 font-medium">(Inheriting from global settings)</span>
                  )}
                </p>
              </div>
              <span className="text-xs text-gray-400">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
            </div>

            {accounts.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No accounts defined. Configure them in Global Settings → Billing.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {typeOrder.filter(t => grouped[t]).map(type => (
                  <div key={type}>
                    <div className="px-5 py-2 bg-gray-50 flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_BADGE[type] ?? 'bg-gray-100 text-gray-600'}`}>{type}</span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {grouped[type].map((a) => (
                          <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                            <td className="px-5 py-3 w-20 font-mono text-xs text-gray-500">{a.code}</td>
                            <td className="px-3 py-3 font-medium text-gray-900">{a.name}</td>
                            <td className="px-3 py-3 text-xs text-gray-400">{a.role?.replace(/_/g, ' ')}</td>
                            <td className="px-5 py-3 text-xs text-gray-400 text-right max-w-xs truncate">{a.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })()}

      {/* Info tab */}
      {tab === 'info' && (
        <section className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <InfoRow label="Name" value={property.name} />
          <InfoRow label="Type" value={property.property_type} />
          <InfoRow label="Region" value={property.region} />
          <InfoRow label="Timezone" value={property.timezone} />
          <InfoRow label="Address" value={`${property.address.street}, ${property.address.city}, ${property.address.state}`} />
          <InfoRow label="Units" value={String(property.unit_count)} />
          <InfoRow label="Status" value={property.status} />
          {property.wings.length > 0 && (
            <InfoRow label="Wings" value={property.wings.map((w) => w.name).join(', ')} />
          )}
        </section>
      )}

      {showEdit && (
        <PropertyEditSlideOver
          propertyId={property.id}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setProperty(updated)
            setShowEdit(false)
          }}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 capitalize">{value}</span>
    </div>
  )
}
