import client from './client'
import type { CCTVCamera, CCTVCameraPayload, CCTVEvent } from '@/types/cctv'

interface CameraListResponse { items: CCTVCamera[]; total: number }
interface EventListResponse  { items: CCTVEvent[];  total: number }

export const cctvApi = {
  listCameras: (propertyId: string) =>
    client.get<CameraListResponse>(`/properties/${propertyId}/cctv/cameras`).then(r => r.data),

  createCamera: (propertyId: string, data: CCTVCameraPayload) =>
    client.post<CCTVCamera>(`/properties/${propertyId}/cctv/cameras`, data).then(r => r.data),

  updateCamera: (cameraId: string, data: Partial<CCTVCameraPayload> & { status?: string }) =>
    client.patch<CCTVCamera>(`/cctv/cameras/${cameraId}`, data).then(r => r.data),

  deleteCamera: (cameraId: string) =>
    client.delete(`/cctv/cameras/${cameraId}`),

  listEvents: (
    propertyId: string,
    params?: { camera_id?: string; is_suspicious?: boolean; page?: number; page_size?: number }
  ) =>
    client.get<EventListResponse>(`/properties/${propertyId}/cctv/events`, { params }).then(r => r.data),

  reviewEvent: (eventId: string, review_notes?: string) =>
    client.patch<CCTVEvent>(`/cctv/events/${eventId}/review`, { review_notes }).then(r => r.data),

  seedEvents: (propertyId: string, cameraId: string) =>
    client.post<{ seeded: number }>(
      `/properties/${propertyId}/cctv/cameras/${cameraId}/seed-events`
    ).then(r => r.data),
}
