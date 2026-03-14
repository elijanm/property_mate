import client from './client'
import type {
  LedgerEntry,
  Payment,
  PaymentCreateRequest,
  PaymentSummary,
  RefundRequest,
} from '@/types/payment'

export const paymentsApi = {
  list: (leaseId: string) =>
    client.get<PaymentSummary>(`/leases/${leaseId}/payments`).then((r) => r.data),

  create: (leaseId: string, data: PaymentCreateRequest) =>
    client.post<Payment>(`/leases/${leaseId}/payments`, data).then((r) => r.data),

  getLedger: (leaseId: string) =>
    client.get<LedgerEntry[]>(`/leases/${leaseId}/ledger`).then((r) => r.data),

  refund: (leaseId: string, data: RefundRequest) =>
    client.post<Payment>(`/leases/${leaseId}/refund`, data).then((r) => r.data),
}
