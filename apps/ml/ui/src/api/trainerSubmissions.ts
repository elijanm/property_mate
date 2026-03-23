import api from './client';
import type { TrainerSubmission, AdminTicket } from '../types/trainerSubmission';

export type SubStatusEvent = {
  status: TrainerSubmission['status']
  message?: string
  summary?: string
  severity?: string
  instant?: boolean
  llm_scan_result?: Record<string, unknown>
}

/**
 * Open an SSE stream for a submission.
 * Uses EventSource with ?token= because browser EventSource cannot set headers.
 * Returns a cleanup function — call it to close the stream.
 */
export function streamSubmissionStatus(
  submissionId: string,
  onStatus: (evt: SubStatusEvent) => void,
  onDone: (finalStatus: TrainerSubmission['status']) => void,
  onError?: () => void,
): () => void {
  const token = localStorage.getItem('ml_token') ?? ''
  const url = `/api/v1/trainer-submissions/${submissionId}/stream?token=${encodeURIComponent(token)}`
  const es = new EventSource(url)

  es.addEventListener('status', (e: MessageEvent) => {
    try { onStatus(JSON.parse(e.data)) } catch {}
  })

  es.addEventListener('done', (e: MessageEvent) => {
    try {
      const d = JSON.parse(e.data)
      onDone(d.status)
    } catch {}
    es.close()
  })

  es.addEventListener('error', () => {
    onError?.()
    es.close()
  })

  // Ignore ping events
  return () => es.close()
}

export const trainerSubmissionsApi = {
  upload: async (file: File): Promise<TrainerSubmission> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/trainer-submissions/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  list: async (): Promise<{ items: TrainerSubmission[]; total: number }> => {
    const res = await api.get('/trainer-submissions');
    return res.data;
  },

  get: async (id: string): Promise<TrainerSubmission> => {
    const res = await api.get(`/trainer-submissions/${id}`);
    return res.data;
  },

  approve: async (id: string): Promise<{ ok: boolean }> => {
    const res = await api.post(`/trainer-submissions/${id}/approve`);
    return res.data;
  },

  reject: async (id: string, reason: string): Promise<{ ok: boolean }> => {
    const res = await api.post(`/trainer-submissions/${id}/reject`, { reason });
    return res.data;
  },

  listTickets: async (): Promise<{ items: AdminTicket[]; total: number }> => {
    const res = await api.get('/admin-tickets');
    return res.data;
  },

  updateTicket: async (id: string, status: string): Promise<AdminTicket> => {
    const res = await api.patch(`/admin-tickets/${id}`, { status });
    return res.data;
  },

  getSource: async (id: string): Promise<{
    trainer_name: string;
    source: string;
    scan_result: Record<string, any>;
    ast_violations: { line: number; col?: number; rule: string; message: string }[];
  }> => {
    const res = await api.get(`/trainer-submissions/${id}/source`);
    return res.data;
  },
};
