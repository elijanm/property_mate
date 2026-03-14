import client from './client'

export const securityApi = {
  getDashboard: () =>
    client.get('/security/dashboard').then(r => r.data),

  listIps: (params?: { banned_only?: boolean; min_threat?: number; limit?: number; skip?: number }) =>
    client.get('/security/ips', { params }).then(r => r.data),

  getIp: (ip: string) =>
    client.get(`/security/ips/${ip}`).then(r => r.data),

  banIp: (ip: string, reason: string, expiresHours: number | null, adminPassword: string) =>
    client.post(`/security/ips/${ip}/ban`,
      { reason, expires_hours: expiresHours },
      { headers: { 'X-Admin-Password': adminPassword } }
    ).then(r => r.data),

  unbanIp: (ip: string, adminPassword: string) =>
    client.delete(`/security/ips/${ip}/ban`, {
      headers: { 'X-Admin-Password': adminPassword }
    }).then(r => r.data),

  deleteIp: (ip: string, adminPassword: string) =>
    client.delete(`/security/ips/${ip}`, {
      headers: { 'X-Admin-Password': adminPassword }
    }).then(r => r.data),

  getLogs: (params?: { ip?: string; path?: string; blocked_only?: boolean; upload_only?: boolean; limit?: number; skip?: number }) =>
    client.get('/security/logs', { params }).then(r => r.data),

  clearLogs: (olderThanDays = 30) =>
    client.delete('/security/logs', { params: { older_than_days: olderThanDays } }).then(r => r.data),
}
