import apiClient from '@/api/client'
import type {
  BillingCycleRun,
  BillingRunListResponse,
  GenerateBillingResponse,
  Invoice,
  InvoiceCounts,
  InvoiceGeneratePayload,
  InvoiceListResponse,
  InvoicePaymentPayload,
  InvoiceUpdatePayload,
  SmartMeterSummary,
} from '@/types/invoice'
import type { Payment } from '@/types/payment'

export const invoicesApi = {
  generate: (data: InvoiceGeneratePayload): Promise<GenerateBillingResponse> =>
    apiClient.post('/invoices/generate', data).then((r) => r.data),

  getBillingRuns: (params?: {
    billing_month?: string
    page?: number
    page_size?: number
  }): Promise<BillingRunListResponse> =>
    apiClient.get('/invoices/billing-runs', { params }).then((r) => r.data),

  getBillingRun: (runId: string): Promise<BillingCycleRun> =>
    apiClient.get(`/invoices/billing-runs/${runId}`).then((r) => r.data),

  getCounts: (params?: {
    billing_month?: string
    sandbox?: boolean
  }): Promise<InvoiceCounts> =>
    apiClient.get('/invoices/counts', { params }).then((r) => r.data),

  list: (params?: {
    billing_month?: string
    property_id?: string
    tenant_id?: string
    lease_id?: string
    status?: string
    sandbox?: boolean
    invoice_category?: string
    page?: number
    page_size?: number
  }): Promise<InvoiceListResponse> =>
    apiClient.get('/invoices', { params }).then((r) => r.data),

  get: (id: string): Promise<Invoice> =>
    apiClient.get(`/invoices/${id}`).then((r) => r.data),

  update: (id: string, data: InvoiceUpdatePayload): Promise<Invoice> =>
    apiClient.patch(`/invoices/${id}`, data).then((r) => r.data),

  send: (id: string): Promise<Invoice> =>
    apiClient.post(`/invoices/${id}/send`).then((r) => r.data),

  void: (id: string): Promise<void> =>
    apiClient.delete(`/invoices/${id}`).then(() => undefined),

  recordPayment: (id: string, data: InvoicePaymentPayload): Promise<Invoice> =>
    apiClient.post(`/invoices/${id}/payments`, data).then((r) => r.data),

  listPayments: (id: string): Promise<{ items: Payment[]; total: number }> =>
    apiClient.get(`/invoices/${id}/payments`).then((r) => r.data),

  downloadPdf: async (id: string, filename: string): Promise<void> => {
    const response = await apiClient.get(`/invoices/${id}/pdf`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  sendProforma: (invoiceId: string): Promise<void> =>
    apiClient.post<void>(`/invoices/${invoiceId}/send-proforma`).then((r) => r.data),

  applySmartMeter: (invoiceId: string): Promise<{ invoice: Invoice; smart_meter_summary: SmartMeterSummary }> =>
    apiClient.post(`/invoices/${invoiceId}/apply-smart-meter`).then((r) => r.data),
}
