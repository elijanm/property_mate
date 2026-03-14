import client from './client'
import type { BulkSendPayload, BulkSendResult } from '@/types/communication'

export const communicationsApi = {
  bulkSend: (propertyId: string, data: BulkSendPayload) =>
    client.post<BulkSendResult>(`/properties/${propertyId}/communications/bulk-send`, data).then(r => r.data),
}
