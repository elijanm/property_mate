import api from './client';

export const marketplaceApi = {
  listTrainers: async (params?: { search?: string; tags?: string; category?: string }) => {
    const res = await api.get('/marketplace/trainers', { params });
    return res.data;
  },

  cloneTrainer: async (trainerId: string): Promise<{ ok: boolean; trainer_id: string; name: string }> => {
    const res = await api.post(`/marketplace/trainers/${trainerId}/clone`);
    return res.data;
  },
};
