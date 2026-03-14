import client from './client'
import type { Deduction, DeductionCreateRequest, DeductionSummary } from '@/types/deduction'

export const deductionsApi = {
  list: (leaseId: string) =>
    client.get<DeductionSummary>(`/leases/${leaseId}/deductions`).then((r) => r.data),

  create: (leaseId: string, data: DeductionCreateRequest) =>
    client.post<Deduction>(`/leases/${leaseId}/deductions`, data).then((r) => r.data),

  delete: (deductionId: string) =>
    client.delete(`/deductions/${deductionId}`).then(() => undefined),
}
