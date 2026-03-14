import client from './client'
import type { InferenceResult, InferenceLog, CompareResponse } from '@/types/inference'

export const inferenceApi = {
  predict: (trainerName: string, inputs: Record<string, unknown>, version?: string, sessionId?: string) =>
    client.post<InferenceResult>(`/inference/${trainerName}`, { inputs, model_version: version, session_id: sessionId })
      .then(r => r.data),

  predictFile: (trainerName: string, file: File, extra?: Record<string, unknown>, version?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (extra) fd.append('extra', JSON.stringify(extra))
    if (version) fd.append('version', version)
    return client.post<InferenceResult>(`/inference/${trainerName}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  getSchema: (trainerName: string) =>
    client.get(`/inference/${trainerName}/schema`).then(r => r.data),

  getLogs: (trainerName: string, page = 1, pageSize = 50) =>
    client.get<{ items: InferenceLog[]; total: number }>(`/inference/logs/${trainerName}`, { params: { page, page_size: pageSize } })
      .then(r => r.data),

  getAllLogs: (page = 1, pageSize = 50, trainerName?: string) =>
    client.get<{ items: InferenceLog[]; total: number }>('/inference/logs/all', {
      params: { page, page_size: pageSize, trainer_name: trainerName },
    }).then(r => r.data),

  correctLog: (logId: string, correctedOutput: unknown) =>
    client.patch(`/inference/logs/correct/${logId}`, { corrected_output: correctedOutput }).then(r => r.data),

  deleteLog: (logId: string) =>
    client.delete(`/inference/logs/delete/${logId}`).then(r => r.data),

  compareVersions: (trainerName: string, inputs: unknown, deploymentIds: string[]) =>
    client.post<CompareResponse>(`/inference/${trainerName}/compare`, {
      inputs,
      deployment_ids: deploymentIds,
    }).then(r => r.data),
}
