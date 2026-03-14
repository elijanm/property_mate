import client from './client'

export interface FileNode {
  type: 'file' | 'dir'
  name: string
  path: string
  size?: number
  ext?: string
  children?: FileNode[]
}

export interface EditorDataset {
  id: string
  name: string
  description: string
  category: string
  status: string
  fields: { id: string; label: string; type: string; required: boolean }[]
}

export const editorApi = {
  listFiles: () =>
    client.get<{ tree: FileNode[]; root: string }>('/editor/files').then(r => r.data),

  getFileContent: (path: string) =>
    client.get<{ path: string; content: string }>('/editor/files/content', { params: { path } }).then(r => r.data),

  saveFile: (path: string, content: string) =>
    client.post<{ saved: boolean; path: string }>('/editor/files', { path, content }).then(r => r.data),

  deleteFile: (path: string) =>
    client.delete<{ deleted: boolean; path: string }>('/editor/files', { params: { path } }).then(r => r.data),

  newFile: (path: string, template: 'blank' | 'trainer' = 'blank') =>
    client.post<{ created: boolean; path: string; content: string }>('/editor/files/new', { path, template }).then(r => r.data),

  validateFile: (path: string, content: string) =>
    client.post<{ valid: boolean; trainers: string[]; error: string | null }>('/editor/validate', { path, content }).then(r => r.data),

  runTrainer: (trainer_name: string, content: string, path: string, config_overrides?: Record<string, unknown>) =>
    client.post<{ job_id: string; status: string }>('/editor/run', { trainer_name, content, path, config_overrides }).then(r => r.data),

  listDatasets: () =>
    client.get<{ items: EditorDataset[]; total: number }>('/editor/datasets').then(r => r.data.items),

  getDatasetAutofill: (datasetId: string) =>
    client.get<{ code: string; filename: string; trainer_name: string; dataset: EditorDataset }>(
      `/editor/datasets/${datasetId}/autofill`
    ).then(r => r.data),

  /** Returns the URL for the SSE log stream (pass JWT token as ?token=) */
  logStreamUrl: (jobId: string, token: string) =>
    `/api/v1/editor/run/${jobId}/stream?token=${encodeURIComponent(token)}`,
}
