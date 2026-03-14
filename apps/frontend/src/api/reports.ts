import apiClient from './client'
import type { ArrearsData, CollectionRateData, LeaseExpiryData, MeterReadingsData, OccupancyData, OutstandingBalancesData, PaymentBehaviorData, RentRollData, UtilityConsumptionData, VacancyDetailData } from '@/types/reports'

export const reportsApi = {
  getRentRoll(propertyId: string): Promise<RentRollData> {
    return apiClient.get(`/properties/${propertyId}/reports/rent-roll`).then((r) => r.data)
  },

  exportRentRoll(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/rent-roll/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getArrears(propertyId: string): Promise<ArrearsData> {
    return apiClient.get(`/properties/${propertyId}/reports/arrears`).then((r) => r.data)
  },

  exportArrears(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/arrears/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getCollectionRate(propertyId: string, months = 12): Promise<CollectionRateData> {
    return apiClient.get(`/properties/${propertyId}/reports/collection-rate`, { params: { months } }).then((r) => r.data)
  },

  exportCollectionRate(propertyId: string, months: number, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/collection-rate/export`, { params: { months, format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getOutstandingBalances(propertyId: string): Promise<OutstandingBalancesData> {
    return apiClient.get(`/properties/${propertyId}/reports/outstanding-balances`).then((r) => r.data)
  },

  getPaymentBehavior(propertyId: string): Promise<PaymentBehaviorData> {
    return apiClient.get(`/properties/${propertyId}/reports/payment-behavior`).then((r) => r.data)
  },

  exportPaymentBehavior(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/payment-behavior/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getLeaseExpiry(propertyId: string, days = 90): Promise<LeaseExpiryData> {
    return apiClient.get(`/properties/${propertyId}/reports/lease-expiry`, { params: { days } }).then((r) => r.data)
  },

  exportLeaseExpiry(propertyId: string, days: number, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/lease-expiry/export`, { params: { days, format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getMeterReadings(propertyId: string): Promise<MeterReadingsData> {
    return apiClient.get(`/properties/${propertyId}/reports/meter-readings`).then((r) => r.data)
  },

  exportMeterReadings(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/meter-readings/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getUtilityConsumption(propertyId: string): Promise<UtilityConsumptionData> {
    return apiClient.get(`/properties/${propertyId}/reports/utility-consumption`).then((r) => r.data)
  },

  exportUtilityConsumption(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/utility-consumption/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getVacancyDetail(propertyId: string): Promise<VacancyDetailData> {
    return apiClient.get(`/properties/${propertyId}/reports/vacancy-detail`).then((r) => r.data)
  },

  exportVacancyDetail(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/vacancy-detail/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  getOccupancy(propertyId: string): Promise<OccupancyData> {
    return apiClient.get(`/properties/${propertyId}/reports/occupancy`).then((r) => r.data)
  },

  exportOccupancy(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/occupancy/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  exportOutstandingBalances(propertyId: string, format: 'csv' | 'tsv'): Promise<Blob> {
    return apiClient
      .get(`/properties/${propertyId}/reports/outstanding-balances/export`, { params: { format }, responseType: 'blob' })
      .then((r) => r.data)
  },

  vacancyLoss(propertyId: string, months = 6): Promise<any> {
    return apiClient
      .get(`/properties/${propertyId}/reports/vacancy-loss`, { params: { months } })
      .then((r) => r.data)
  },

  expiryCalendar(propertyId: string, daysAhead = 90): Promise<any> {
    return apiClient
      .get(`/properties/${propertyId}/reports/expiry-calendar`, { params: { days_ahead: daysAhead } })
      .then((r) => r.data)
  },

  paymentScorecard(propertyId: string): Promise<any> {
    return apiClient.get(`/properties/${propertyId}/reports/payment-scorecard`).then((r) => r.data)
  },

  discountImpact(propertyId: string): Promise<any> {
    return apiClient.get(`/properties/${propertyId}/reports/discount-impact`).then((r) => r.data)
  },
}
