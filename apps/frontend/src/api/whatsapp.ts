import client from './client'
import type { WhatsAppEvent, WhatsAppInstance } from '@/types/whatsapp'

export const whatsappApi = {
  listInstances: (propertyId: string) =>
    client.get<WhatsAppInstance[]>('/whatsapp/instances', { params: { property_id: propertyId } })
      .then(r => r.data),

  getInstance: (instanceId: string) =>
    client.get<WhatsAppInstance>(`/whatsapp/instances/${instanceId}`).then(r => r.data),

  createInstance: (propertyId: string, name: string) =>
    client.post<WhatsAppInstance>('/whatsapp/instances', { property_id: propertyId, name })
      .then(r => r.data),

  connect: (instanceId: string) =>
    client.post<WhatsAppInstance>(`/whatsapp/instances/${instanceId}/connect`).then(r => r.data),

  getQr: (instanceId: string) =>
    client.get<{ qr_code: string | null }>(`/whatsapp/instances/${instanceId}/qr`).then(r => r.data),

  disconnect: (instanceId: string) =>
    client.post<WhatsAppInstance>(`/whatsapp/instances/${instanceId}/disconnect`).then(r => r.data),

  logout: (instanceId: string) =>
    client.post<WhatsAppInstance>(`/whatsapp/instances/${instanceId}/logout`).then(r => r.data),

  deleteInstance: (instanceId: string) =>
    client.delete(`/whatsapp/instances/${instanceId}`),

  listEvents: (instanceId: string, params?: { limit?: number; skip?: number }) =>
    client.get<WhatsAppEvent[]>(`/whatsapp/instances/${instanceId}/events`, { params })
      .then(r => r.data),
}
