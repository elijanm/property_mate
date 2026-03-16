import client from './client'
import type { AnnotationProject, AnnotationImage, ModelVersion, AnnotationShape } from '@/types/annotate'

export const annotateApi = {
  // Projects
  listProjects: () =>
    client.get<AnnotationProject[]>('/annotate/projects').then(r => r.data),

  createProject: (data: { name: string; description?: string; classes: string[]; annotation_type: string }) =>
    client.post<AnnotationProject>('/annotate/projects', data).then(r => r.data),

  getProject: (id: string) =>
    client.get<AnnotationProject>(`/annotate/projects/${id}`).then(r => r.data),

  updateProject: (id: string, data: { name?: string; description?: string; classes?: string[] }) =>
    client.patch<AnnotationProject>(`/annotate/projects/${id}`, data).then(r => r.data),

  deleteProject: (id: string) =>
    client.delete(`/annotate/projects/${id}`),

  // Images
  addImages: (projectId: string, files: File[]) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    return client.post<{ added: number; images: AnnotationImage[]; auto_predicting: boolean }>(
      `/annotate/projects/${projectId}/images`, fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    ).then(r => r.data)
  },

  listImages: (projectId: string, status?: string) =>
    client.get<AnnotationImage[]>(`/annotate/projects/${projectId}/images`, { params: status ? { status } : {} }).then(r => r.data),

  getImage: (projectId: string, imageId: string) =>
    client.get<AnnotationImage>(`/annotate/projects/${projectId}/images/${imageId}`).then(r => r.data),

  deleteImage: (projectId: string, imageId: string) =>
    client.delete(`/annotate/projects/${projectId}/images/${imageId}`),

  // Annotations
  saveAnnotations: (projectId: string, imageId: string, annotations: Partial<AnnotationShape>[]) =>
    client.put<AnnotationImage & { annotated_count: number; can_train: boolean }>(
      `/annotate/projects/${projectId}/images/${imageId}/annotations`,
      { annotations }
    ).then(r => r.data),

  approvePredictions: (projectId: string, imageId: string, annotationIds?: string[]) =>
    client.post<AnnotationImage>(
      `/annotate/projects/${projectId}/images/${imageId}/approve`,
      { annotation_ids: annotationIds ?? null }
    ).then(r => r.data),

  // Run predictions with current model
  runPredictions: (projectId: string) =>
    client.post<{ status: string; images_queued: number; model_version: number }>(
      `/annotate/projects/${projectId}/predict`
    ).then(r => r.data),

  // Run prediction on a single image
  predictImage: (projectId: string, imageId: string) =>
    client.post<{ status: string; image_id: string; model_version: number }>(
      `/annotate/projects/${projectId}/images/${imageId}/predict`
    ).then(r => r.data),

  // Training
  triggerTraining: (projectId: string) =>
    client.post<{ version_id: string; version: number; status: string; trained_on: number }>(
      `/annotate/projects/${projectId}/train`
    ).then(r => r.data),

  trainingStatus: (projectId: string, versionId: string) =>
    client.get<ModelVersion>(`/annotate/projects/${projectId}/train/${versionId}`).then(r => r.data),

  // Export
  exportDataset: (projectId: string) =>
    client.post<{ url: string; key: string; image_count: number }>(
      `/annotate/projects/${projectId}/export/dataset`
    ).then(r => r.data),

  exportModel: (projectId: string) =>
    client.post<{ url: string; version: number; map50: number }>(
      `/annotate/projects/${projectId}/export/model`
    ).then(r => r.data),

  activateModelVersion: (projectId: string, versionId: string) =>
    client.post<import('@/types/annotate').AnnotationProject>(
      `/annotate/projects/${projectId}/models/${versionId}/activate`
    ).then(r => r.data),

  cancelModelVersion: (projectId: string, versionId: string) =>
    client.post<import('@/types/annotate').AnnotationProject>(
      `/annotate/projects/${projectId}/models/${versionId}/cancel`
    ).then(r => r.data),

  deleteModelVersion: (projectId: string, versionId: string) =>
    client.delete<import('@/types/annotate').AnnotationProject>(
      `/annotate/projects/${projectId}/models/${versionId}`
    ).then(r => r.data),
}
