import apiClient from '@/api/client'
import type { AccountingSummary, TenantBehaviorList, VacancyLive, VacancyReport } from '@/types/accounting'

export const accountingApi = {
  getSummary: (billingMonth?: string, propertyId?: string): Promise<AccountingSummary> =>
    apiClient
      .get('/accounting/summary', {
        params: {
          ...(billingMonth ? { billing_month: billingMonth } : {}),
          ...(propertyId ? { property_id: propertyId } : {}),
        },
      })
      .then((r) => r.data),

  getTenantBehavior: (params?: { cursor?: string; pageSize?: number; sortBy?: string }): Promise<TenantBehaviorList> =>
    apiClient.get('/accounting/tenant-behavior', {
      params: {
        ...(params?.cursor   ? { cursor:    params.cursor }           : {}),
        ...(params?.pageSize ? { page_size: params.pageSize }         : {}),
        ...(params?.sortBy   ? { sort_by:   params.sortBy }           : {}),
      },
    }).then((r) => r.data),

  getVacancyLive: (params?: { propertyId?: string; cursor?: string; pageSize?: number }): Promise<VacancyLive> =>
    apiClient.get('/accounting/vacancy-live', {
      params: {
        ...(params?.propertyId ? { property_id: params.propertyId } : {}),
        ...(params?.cursor ? { cursor: params.cursor } : {}),
        ...(params?.pageSize ? { page_size: params.pageSize } : {}),
      },
    }).then((r) => r.data),

  getVacancyReport: (billingMonth: string): Promise<VacancyReport> =>
    apiClient.get(`/accounting/vacancy-report/${billingMonth}`).then((r) => r.data),
}
