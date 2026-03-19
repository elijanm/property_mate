import client from './client'
import type { AnnotationProject, AnnotationImage, ModelVersion, AnnotationShape, SimilarImage } from '@/types/annotate'

export const annotateApi = {
  // Projects
  listProjects: () =>
    client.get<AnnotationProject[]>('/annotate/projects').then(r => r.data),

  createProject: (data: { name: string; description?: string; classes: string[]; annotation_type: string }) =>
    client.post<AnnotationProject>('/annotate/projects', data).then(r => r.data),

  getProject: (id: string) =>
    client.get<AnnotationProject>(`/annotate/projects/${id}`).then(r => r.data),

  updateProject: (id: string, data: {
    name?: string; description?: string; classes?: string[]
    auto_finetune?: boolean; finetune_lr?: number; base_lr?: number
    train_imgsz?: number; min_annotations_to_train?: number
  }) =>
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

  listImages: (projectId: string, status?: string, quality?: string, include_archived?: boolean) =>
    client.get<AnnotationImage[]>(`/annotate/projects/${projectId}/images`, {
      params: {
        ...(status ? { status } : {}),
        ...(quality ? { quality } : {}),
        ...(include_archived ? { include_archived: true } : {}),
      }
    }).then(r => r.data),

  getImage: (projectId: string, imageId: string) =>
    client.get<AnnotationImage>(`/annotate/projects/${projectId}/images/${imageId}`).then(r => r.data),

  deleteImage: (projectId: string, imageId: string) =>
    client.delete(`/annotate/projects/${projectId}/images/${imageId}`),

  archiveImage: (projectId: string, imageId: string, archived = true) =>
    client.post<AnnotationImage>(`/annotate/projects/${projectId}/images/${imageId}/archive`, { archived }).then(r => r.data),

  findSimilar: (projectId: string, imageId: string, threshold = 12) =>
    client.get<SimilarImage[]>(`/annotate/projects/${projectId}/images/${imageId}/similar`, { params: { threshold } }).then(r => r.data),

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
  exportDataset: (
    projectId: string,
    opts: { format: string; train: number; val: number; test: number }
  ) =>
    client.post<{
      job_id: string; status: string; format: string
      total_images: number; splits: Record<string, number>
    }>(
      `/annotate/projects/${projectId}/export/dataset`, opts
    ).then(r => r.data),

  getExportJob: (projectId: string, jobId: string) =>
    client.get<{
      job_id: string; status: string; format: string
      total_images: number; processed_images: number; progress_pct: number
      splits: Record<string, number>; download_url: string | null
      error: string | null; created_at: string; completed_at: string | null
    }>(`/annotate/projects/${projectId}/export/jobs/${jobId}`).then(r => r.data),

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
