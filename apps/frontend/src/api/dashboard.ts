import apiClient from './client'
import type { DashboardData } from '@/types/dashboard'

export const dashboardApi = {
  get(): Promise<DashboardData> {
    return apiClient.get('/dashboard').then((r) => r.data)
  },
}
