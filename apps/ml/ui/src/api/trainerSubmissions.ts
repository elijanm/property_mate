import api from './client';
import type { TrainerSubmission, AdminTicket } from '../types/trainerSubmission';

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

  getSource: async (id: string): Promise<{ trainer_name: string; source: string }> => {
    const res = await api.get(`/trainer-submissions/${id}/source`);
    return res.data;
  },
};
