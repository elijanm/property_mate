import client from './client'

export const monitoringApi = {
  getOverview: () =>
    client.get('/monitoring/overview').then(r => r.data),

  getSnapshots: (trainerName: string, hours = 24) =>
    client.get(`/monitoring/performance/${trainerName}`, { params: { hours } }).then(r => r.data),

  getRollingSummary: (trainerName: string, hours = 24) =>
    client.get(`/monitoring/performance/${trainerName}/summary`, { params: { hours } }).then(r => r.data),

  forceSnapshot: (trainerName: string) =>
    client.post(`/monitoring/performance/${trainerName}/snapshot`).then(r => r.data),

  getBaseline: (trainerName: string) =>
    client.get(`/monitoring/drift/${trainerName}/baseline`).then(r => r.data),

  setBaseline: (trainerName: string, sampleCount = 500) =>
    client.post(`/monitoring/drift/${trainerName}/baseline`, { sample_count: sampleCount }).then(r => r.data),

  checkDrift: (trainerName: string, sampleCount = 200, hours = 6) =>
    client.post(`/monitoring/drift/${trainerName}/check`, { sample_count: sampleCount, hours }).then(r => r.data),

  getDriftAlerts: (trainerName: string, status?: string) =>
    client.get(`/monitoring/drift/${trainerName}/alerts`, { params: status ? { status } : {} }).then(r => r.data),

  updateAlert: (alertId: string, status: 'acknowledged' | 'resolved', notes = '') =>
    client.patch(`/monitoring/drift/alerts/${alertId}`, { status, notes }).then(r => r.data),
}
