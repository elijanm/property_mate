import client from './client'
import type { TrainerRegistration, ModelDeployment, TrainingJob, GpuOption, LocalGpuInfo } from '@/types/trainer'

export const trainersApi = {
  list: () => client.get<{ items: TrainerRegistration[] }>('/trainers').then(r => r.data.items ?? []),
  listPublic: () => client.get<{ items: TrainerRegistration[] }>('/trainers/public').then(r => r.data.items ?? []),
  listPending: () => client.get<{ items: TrainerRegistration[] }>('/trainers/pending').then(r => r.data.items ?? []),
  approvePending: (name: string) => client.patch(`/trainers/pending/${name}/approve`).then(r => r.data),
  rejectPending: (name: string, reason: string) => client.patch(`/trainers/pending/${name}/reject`, { reason }).then(r => r.data),
  clone: (name: string) => client.post<TrainerRegistration>(`/trainers/${name}/clone`).then(r => r.data),
  initWorkspace: () => client.post<{ cloned: string[]; count: number }>('/trainers/init-workspace').then(r => r.data),
  get: (name: string) => client.get<TrainerRegistration>(`/trainers/${name}`).then(r => r.data),
  scan: () => client.post('/trainers/scan').then(r => r.data),

  listDeployments: () =>
    client.get<{ items: ModelDeployment[] }>('/models').then(r => r.data.items ?? []),

  listVersions: (trainerName: string) =>
    client.get<{ items: ModelDeployment[] }>('/models', {
      params: { trainer_name: trainerName, include_all: true },
    }).then(r => r.data.items ?? []),
  getSchema: (name: string) => client.get(`/inference/${name}/schema`).then(r => r.data),

  listJobs: (trainerName?: string) =>
    client.get<{ items: TrainingJob[] }>('/training/jobs', { params: { trainer_name: trainerName } })
      .then(r => r.data.items ?? []),
  getJob: (id: string) => client.get<TrainingJob>(`/training/jobs/${id}`).then(r => r.data),

  listGpuOptions: () =>
    client.get<{ options: GpuOption[]; available: boolean; source: string }>('/training/gpu-options').then(r => r.data),

  getLocalInfo: () =>
    client.get<LocalGpuInfo>('/training/local-info').then(r => r.data),

  startTraining: (
    trainerName: string,
    configOverrides?: Record<string, unknown>,
    compute?: { compute_type: 'local' | 'cloud_gpu'; gpu_type_id?: string },
    datasetSlugOverride?: string,
  ) =>
    client.post<{ job_id: string }>('/training/start', {
      trainer_name: trainerName,
      config_overrides: configOverrides,
      ...(compute ?? {}),
      ...(datasetSlugOverride ? { dataset_slug_override: datasetSlugOverride } : {}),
    }).then(r => r.data),

  deleteDeployment: (id: string) =>
    client.delete(`/models/${id}`).then(r => r.data),

  deleteAllDeployments: (trainerName?: string) =>
    client.delete('/models', { params: trainerName ? { trainer_name: trainerName } : {} }).then(r => r.data),

  deleteJob: (id: string) =>
    client.delete(`/training/jobs/${id}`).then(r => r.data),

  deleteAllJobs: (trainerName?: string) =>
    client.delete('/training/jobs', { params: trainerName ? { trainer_name: trainerName } : {} }).then(r => r.data),

  cancelJob: (id: string) =>
    client.post(`/training/jobs/${id}/cancel`).then(r => r.data),

  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return client.post('/trainers/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },

  deactivate: (name: string) =>
    client.delete(`/trainers/${name}`).then(r => r.data),

  rerunJob: (id: string) =>
    client.post(`/training/jobs/${id}/rerun`).then(r => r.data),

  setVisibility: (deploymentId: string, visibility: 'viewer' | 'engineer') =>
    client.patch<ModelDeployment>(`/models/${deploymentId}/visibility`, { visibility }).then(r => r.data),

  setTrainerFlags: (name: string, flags: {
    trainer_visible?: boolean
    trainer_source_downloadable?: boolean
    trainer_model_visible?: boolean
    trainer_model_downloadable?: boolean
  }) => client.patch(`/trainers/${name}/flags`, flags).then(r => r.data),
}
