import client from './client'
import type {
  AttachmentFile,
  BulkUtilityTicketPayload,
  MaintenanceTicket,
  OrgMember,
  Ticket,
  TicketCounts,
  TicketCreatePayload,
  TicketListResponse,
  TicketTaskCreatePayload,
  TicketTaskUpdatePayload,
  TicketUpdatePayload,
} from '@/types/ticket'

// ── Legacy MaintenanceTicket (meter discrepancy) ──────────────────────────────

export const maintenanceTicketsApi = {
  list(leaseId: string): Promise<MaintenanceTicket[]> {
    return client.get<MaintenanceTicket[]>(`/leases/${leaseId}/tickets`).then((r) => r.data)
  },

  resolve(
    ticketId: string,
    data: { resolution_reading: number; resolution_notes?: string },
    evidence: File[] = [],
  ): Promise<MaintenanceTicket> {
    const form = new FormData()
    form.append('resolution_reading', String(data.resolution_reading))
    if (data.resolution_notes) form.append('resolution_notes', data.resolution_notes)
    evidence.forEach((f) => form.append('evidence', f))
    return client
      .post<MaintenanceTicket>(`/maintenance-tickets/${ticketId}/resolve`, form)
      .then((r) => r.data)
  },
}

// Keep backward-compat export for existing consumers (LeaseDetailSlideOver)
export const ticketsApi = maintenanceTicketsApi

// ── New comprehensive Ticket API ──────────────────────────────────────────────

export const generalTicketsApi = {
  list(params?: {
    property_id?: string
    unit_id?: string
    tenant_id?: string
    category?: string
    status?: string
    priority?: string
    page?: number
    page_size?: number
  }): Promise<TicketListResponse> {
    return client.get<TicketListResponse>('/tickets', { params }).then((r) => r.data)
  },

  getCounts(propertyId?: string): Promise<TicketCounts> {
    return client
      .get<TicketCounts>('/tickets/counts', { params: propertyId ? { property_id: propertyId } : {} })
      .then((r) => r.data)
  },

  get(id: string): Promise<Ticket> {
    return client.get<Ticket>(`/tickets/${id}`).then((r) => r.data)
  },

  create(data: TicketCreatePayload): Promise<Ticket> {
    return client.post<Ticket>('/tickets', data).then((r) => r.data)
  },

  createBulkUtility(data: BulkUtilityTicketPayload): Promise<Ticket[]> {
    return client.post<Ticket[]>('/tickets/bulk-utility', data).then((r) => r.data)
  },

  update(id: string, data: TicketUpdatePayload): Promise<Ticket> {
    return client.patch<Ticket>(`/tickets/${id}`, data).then((r) => r.data)
  },

  delete(id: string): Promise<void> {
    return client.delete(`/tickets/${id}`).then(() => undefined)
  },

  addComment(id: string, body: string): Promise<Ticket> {
    return client.post<Ticket>(`/tickets/${id}/comments`, { body }).then((r) => r.data)
  },

  addAttachment(id: string, file: File): Promise<{ url: string }> {
    const form = new FormData()
    form.append('file', file)
    return client.post<{ url: string }>(`/tickets/${id}/attachments`, form).then((r) => r.data)
  },

  // Public token-based
  getByToken(token: string): Promise<Ticket> {
    return client.get<Ticket>(`/tickets/task/${token}`).then((r) => r.data)
  },

  submitByToken(token: string, data: Record<string, unknown>): Promise<Ticket> {
    return client
      .post<Ticket>(`/tickets/task/${token}/submit`, { data })
      .then((r) => r.data)
  },

  startCapture(token: string): Promise<Ticket> {
    return client.patch<Ticket>(`/tickets/task/${token}/start`).then((r) => r.data)
  },

  submitTaskReading(
    token: string,
    taskId: string,
    data: { current_reading: number; notes?: string; captured_by?: string; photo_key?: string; meter_number?: string },
  ): Promise<Ticket> {
    return client.patch<Ticket>(`/tickets/task/${token}/tasks/${taskId}`, data).then((r) => r.data)
  },

  completeSession(token: string): Promise<Ticket> {
    return client.post<Ticket>(`/tickets/task/${token}/complete`).then((r) => r.data)
  },

  uploadTaskPhoto(token: string, taskId: string, file: File): Promise<{ photo_key: string; url: string }> {
    const form = new FormData()
    form.append('file', file)
    return client
      .post<{ photo_key: string; url: string }>(`/tickets/task/${token}/tasks/${taskId}/photo`, form)
      .then((r) => r.data)
  },

  readMeterAI(token: string, taskId: string, file: File): Promise<{ reading: number | null; confidence: number; raw_text?: string; error?: string }> {
    const form = new FormData()
    form.append('file', file)
    return client
      .post<{ reading: number | null; confidence: number; raw_text?: string; error?: string }>(`/tickets/task/${token}/tasks/${taskId}/read-meter`, form)
      .then((r) => r.data)
  },

  // Org members for assignment dropdown
  listMembers(): Promise<OrgMember[]> {
    return client.get<OrgMember[]>('/tickets/members').then((r) => r.data)
  },

  // Task CRUD
  addTask(ticketId: string, data: TicketTaskCreatePayload): Promise<Ticket> {
    return client.post<Ticket>(`/tickets/${ticketId}/tasks`, data).then((r) => r.data)
  },

  updateTask(ticketId: string, taskId: string, data: TicketTaskUpdatePayload): Promise<Ticket> {
    return client.patch<Ticket>(`/tickets/${ticketId}/tasks/${taskId}`, data).then((r) => r.data)
  },

  deleteTask(ticketId: string, taskId: string): Promise<Ticket> {
    return client.delete<Ticket>(`/tickets/${ticketId}/tasks/${taskId}`).then((r) => r.data)
  },

  uploadAttachment: (ticketId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post<AttachmentFile>(`/tickets/${ticketId}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  deleteAttachment: (ticketId: string, attachmentId: string) =>
    client.delete(`/tickets/${ticketId}/attachments/${attachmentId}`),
}

