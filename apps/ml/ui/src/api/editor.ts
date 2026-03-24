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

export interface SampleTrainer {
  name: string
  trainer_name: string
  version: string
  description: string
  tags: string[]
  path: string
  is_installed: boolean
}

export interface RunningTrainerVersion {
  name: string          // versioned: e.g. "iris_classifier_v1"
  base_name: string
  version_num: number
  path: string
  is_active: boolean
  approval_status: string
  description: string
  framework: string
  registered_at: string | null
}

export interface RunningTrainerGroup {
  base_name: string
  versions: RunningTrainerVersion[]
  latest: RunningTrainerVersion
  total_versions: number
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

  createDatasetFromCsv: (payload: {
    name: string
    description?: string
    filename: string
    csv_b64: string
    content_type?: string
    session_id?: string
  }) =>
    client.post<{
      dataset_id: string
      dataset_slug: string
      dataset_name: string
      field_id: string
      original_field_id: string
      clean_field_id: string
      code_field_id: string
    }>('/editor/datasets/from-csv', payload).then(r => r.data),

  uploadDatasetField: (datasetId: string, fieldId: string, file: File) => {
    const fd = new FormData()
    fd.append('field_id', fieldId)
    fd.append('file', file)
    return client.post(`/datasets/${datasetId}/entries/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  uploadDatasetText: (datasetId: string, fieldId: string, text: string) => {
    const fd = new FormData()
    fd.append('field_id', fieldId)
    fd.append('text_value', text)
    return client.post(`/datasets/${datasetId}/entries/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  /** @deprecated use uploadDatasetField */
  replaceDatasetFile: (datasetId: string, fieldId: string, file: File) => {
    const fd = new FormData()
    fd.append('field_id', fieldId)
    fd.append('file', file)
    return client.post(`/datasets/${datasetId}/entries/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  // ── Virtual folder structure ─────────────────────────────────────────────────

  listSamples: () =>
    client.get<{ items: SampleTrainer[] }>('/editor/samples').then(r => r.data.items),

  listRunningTrainers: () =>
    client.get<{ items: RunningTrainerGroup[] }>('/editor/running-trainers').then(r => r.data.items),

  installTrainer: (source_path: string, base_name?: string) =>
    client.post<{
      installed: boolean
      trainer_name: string
      version_num: number
      path: string
      dataset_conflicts: { slug: string; system_dataset_name: string; suggested_slug: string }[]
      org_alias: string
    }>('/editor/install', { source_path, base_name }).then(r => r.data),

  patchDatasetSlug: (source_path: string, old_slug: string, new_slug: string) =>
    client.post<{ patched: boolean; path: string; old_slug: string; new_slug: string }>(
      '/editor/patch-dataset-slug', { source_path, old_slug, new_slug }
    ).then(r => r.data),

  uninstallTrainer: (trainer_name: string) =>
    client.post<{ uninstalled: boolean; trainer_name: string }>(
      '/editor/uninstall', { trainer_name }
    ).then(r => r.data),

  generateTrainer: (payload: {
    description: string
    data_source_type?: string
    framework?: string
    class_name?: string
    extra_notes?: string
  }) =>
    client.post<{ code: string; model: string }>('/editor/ai-generate', payload).then(r => r.data),

  aiChat: (payload: {
    messages: { role: string; content: string }[]
    data_source_type?: string
    framework?: string
    class_name?: string
    csv_schema?: { columns: string[]; sample_rows: string[][] } | null
    available_datasets?: { id: string; name: string; fields: { label: string; type: string }[] }[]
    generate_now?: boolean
    uploaded_dataset_slug?: string | null
    uploaded_dataset_id?: string | null
  }) =>
    client.post<{
      message: string
      code: string | null
      filename: string | null
      suggestions: string[]
      has_code: boolean
      debug?: {
        tokens: { input: number; output: number; total: number }
        cost_usd: number
        model: string
        provider?: string
        num_ctx?: number | null
        system_prompt_tokens_est?: number
        extraction_pass?: string
        continuation_count?: number
        repair_ran?: boolean
        final_line_count?: number
        missing_methods_final?: string[]
        raw_llm_reply?: string
      }
    }>('/editor/ai-chat', payload).then(r => r.data),
}
