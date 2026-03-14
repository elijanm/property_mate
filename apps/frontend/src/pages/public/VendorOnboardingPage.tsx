import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getOnboardingContext,
  saveCompanyDetails,
  saveServices,
  uploadVendorDocument,
  completeOnboarding,
} from '@/api/vendors'
import { extractApiError } from '@/utils/apiError'
import type { VendorOnboardingContext } from '@/types/vendor'

type Step = 'company' | 'services' | 'documents' | 'done'
const STEPS: Step[] = ['company', 'services', 'documents', 'done']
const STEP_LABELS: Record<Step, string> = {
  company: 'Company Details',
  services: 'Services',
  documents: 'Documents',
  done: 'Complete',
}

const DOC_TYPES = [
  { value: 'certificate_of_incorporation', label: 'Certificate of Incorporation' },
  { value: 'tax_compliance', label: 'Tax Compliance Certificate' },
  { value: 'insurance', label: 'Insurance Certificate' },
  { value: 'nca_cert', label: 'NCA Certificate' },
  { value: 'other', label: 'Other Document' },
]

export default function VendorOnboardingPage() {
  const { token } = useParams<{ token: string }>()
  const [context, setContext] = useState<VendorOnboardingContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<Step>('company')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Company form
  const [companyForm, setCompanyForm] = useState({
    company_name: '',
    trading_name: '',
    registration_number: '',
    tax_pin: '',
    company_type: 'individual',
    contact_name: '',
    contact_phone: '',
    website: '',
    address: '',
    service_areas: '',
  })

  // Services form
  const [serviceCategories, setServiceCategories] = useState('')
  const [services, setServices] = useState<{ name: string; category: string; base_rate: string; rate_unit: string }[]>([])

  // Documents
  const [docType, setDocType] = useState('certificate_of_incorporation')
  const [docName, setDocName] = useState('')
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploadedDocs, setUploadedDocs] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    getOnboardingContext(token)
      .then((ctx) => {
        setContext(ctx)
        setCompanyForm((f) => ({
          ...f,
          company_name: ctx.company_name,
          contact_name: ctx.contact_name,
        }))
        if (ctx.onboarding_completed_at) setCurrentStep('done')
      })
      .catch((err) => setLoadError(extractApiError(err).message))
  }, [token])

  // Track step index for progress UI
  void STEPS.indexOf(currentStep)

  async function handleCompanyNext(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      await saveCompanyDetails(token, {
        ...companyForm,
        service_areas: companyForm.service_areas
          ? companyForm.service_areas.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      })
      setCurrentStep('services')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleServicesNext(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      await saveServices(token, {
        service_categories: serviceCategories
          ? serviceCategories.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        services: services
          .filter((s) => s.name && s.category)
          .map((s) => ({
            name: s.name,
            category: s.category,
            base_rate: parseFloat(s.base_rate) || undefined,
            rate_unit: s.rate_unit || undefined,
          })),
      })
      setCurrentStep('documents')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUploadDoc() {
    if (!token || !docFile) return
    setSubmitting(true)
    setError(null)
    try {
      await uploadVendorDocument(token, docType, docName || docFile.name, docFile)
      setUploadedDocs((d) => [...d, docName || docFile.name])
      setDocFile(null)
      setDocName('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleComplete() {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      await completeOnboarding(token)
      setCurrentStep('done')
    } catch (err) {
      setError(extractApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  function addService() {
    setServices((s) => [...s, { name: '', category: '', base_rate: '', rate_unit: 'job' }])
  }

  function removeService(i: number) {
    setServices((s) => s.filter((_, idx) => idx !== i))
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900 mb-2">Invalid Link</p>
          <p className="text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  if (!context) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-400">Loading…</p></div>
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Vendor Onboarding</h1>
          <p className="text-gray-500 mt-1">Welcome, {context.contact_name}</p>
        </div>

        {/* Progress bar */}
        {currentStep !== 'done' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              {STEPS.filter((s) => s !== 'done').map((s, i) => (
                <div key={s} className="flex items-center">
                  <div
                    className={[
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
                      STEPS.indexOf(currentStep) > i
                        ? 'bg-green-500 text-white'
                        : STEPS.indexOf(currentStep) === i
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-500',
                    ].join(' ')}
                  >
                    {STEPS.indexOf(currentStep) > i ? '✓' : i + 1}
                  </div>
                  {i < STEPS.filter((s) => s !== 'done').length - 1 && (
                    <div className={`h-1 w-16 mx-1 ${STEPS.indexOf(currentStep) > i ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-sm font-medium text-gray-700">{STEP_LABELS[currentStep]}</p>
          </div>
        )}

        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

        {/* Step: Company */}
        {currentStep === 'company' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">Company Details</h2>
            <form onSubmit={handleCompanyNext} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.company_name}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, company_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Trading Name</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.trading_name}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, trading_name: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Registration Number</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.registration_number}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, registration_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">KRA PIN</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.tax_pin}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, tax_pin: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company Type</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={companyForm.company_type}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, company_type: e.target.value }))}
                >
                  <option value="individual">Individual</option>
                  <option value="sole_proprietor">Sole Proprietor</option>
                  <option value="partnership">Partnership</option>
                  <option value="limited_company">Limited Company</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name *</label>
                  <input
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.contact_name}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, contact_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={companyForm.contact_phone}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, contact_phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Service Areas (comma-separated)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Nairobi, Mombasa"
                  value={companyForm.service_areas}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, service_areas: e.target.value }))}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Next: Services →'}
              </button>
            </form>
          </div>
        )}

        {/* Step: Services */}
        {currentStep === 'services' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">Services Offered</h2>
            <form onSubmit={handleServicesNext} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Service Categories (comma-separated)</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="plumbing, electrical, cleaning"
                  value={serviceCategories}
                  onChange={(e) => setServiceCategories(e.target.value)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-700">Service Offerings</p>
                  <button type="button" onClick={addService} className="text-blue-600 text-xs hover:underline">
                    + Add Service
                  </button>
                </div>
                {services.map((s, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 mb-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        placeholder="Service name"
                        value={s.name}
                        onChange={(e) => setServices((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      />
                      <input
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        placeholder="Category"
                        value={s.category}
                        onChange={(e) => setServices((arr) => arr.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        placeholder="Base rate"
                        value={s.base_rate}
                        onChange={(e) => setServices((arr) => arr.map((x, j) => j === i ? { ...x, base_rate: e.target.value } : x))}
                      />
                      <select
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        value={s.rate_unit}
                        onChange={(e) => setServices((arr) => arr.map((x, j) => j === i ? { ...x, rate_unit: e.target.value } : x))}
                      >
                        <option value="job">Per job</option>
                        <option value="hour">Per hour</option>
                        <option value="day">Per day</option>
                        <option value="sqm">Per sqm</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeService(i)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Next: Documents →'}
              </button>
            </form>
          </div>
        )}

        {/* Step: Documents */}
        {currentStep === 'documents' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">Compliance Documents</h2>
            <p className="text-sm text-gray-500 mb-4">Upload required compliance documents. You can upload multiple.</p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Document Type</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Document Name</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Tax Certificate 2025"
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">File</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                />
              </div>
              <button
                type="button"
                disabled={!docFile || submitting}
                onClick={handleUploadDoc}
                className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-40"
              >
                {submitting ? 'Uploading…' : 'Upload Document'}
              </button>
            </div>

            {uploadedDocs.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Uploaded:</p>
                {uploadedDocs.map((d) => (
                  <div key={d} className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                    <span className="text-green-500">✓</span> {d}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleComplete}
              disabled={submitting}
              className="w-full py-2.5 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Completing…' : 'Complete Onboarding →'}
            </button>
          </div>
        )}

        {/* Done */}
        {currentStep === 'done' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Onboarding Complete!</h2>
            <p className="text-gray-500">
              Thank you for completing your vendor onboarding. Check your email for next steps —
              you may receive a contract to sign or an account setup link.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
