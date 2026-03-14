import client from './client'

export interface DeployUriPayload {
  name: string
  version?: string
  description?: string
  tags?: Record<string, string>
  set_as_default?: boolean
  huggingface_model_id?: string
  huggingface_task?: string
  s3_key?: string
  url?: string
  mlflow_uri?: string
}

export const modelsApi = {
  deployFromUri: (payload: DeployUriPayload) =>
    client.post('/models/deploy-pretrained', payload).then(r => r.data),

  deployFromFile: (
    file: File,
    name: string,
    version = '1.0.0',
    description = '',
    setAsDefault = true,
    inferenceScript?: File,
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name)
    fd.append('version', version)
    fd.append('description', description)
    fd.append('set_as_default', String(setAsDefault))
    if (inferenceScript) fd.append('inference_script', inferenceScript)
    return client.post('/models/deploy-pretrained/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  deployFromZip: (file: File, action?: 'upgrade' | 'replace') => {
    const fd = new FormData()
    fd.append('file', file)
    if (action) fd.append('action', action)
    return client.post('/models/deploy-pretrained/zip', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  setDefault: (id: string) =>
    client.post(`/models/${id}/set-default`).then(r => r.data),

  getMetricHistory: (id: string) =>
    client.get<{ metrics: Record<string, { step: number; value: number; timestamp: number }[]> }>(
      `/models/${id}/metric-history`
    ).then(r => r.data),

  getTrainingArtifacts: (id: string) =>
    client.get<{ artifacts: { path: string; url: string; label: string }[] }>(
      `/models/${id}/training-artifacts`
    ).then(r => r.data),
}
