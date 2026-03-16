export type AnnotationType = 'box' | 'polygon' | 'line'
export type ImageStatus = 'unannotated' | 'annotating' | 'annotated' | 'predicted' | 'approved'
export type ProjectStatus = 'collecting' | 'training' | 'predicting' | 'done'

export interface AnnotationShape {
  id: string
  type: AnnotationType
  label: string
  /** Box: [cx, cy, w, h] normalised 0-1 | Polygon: [[x,y],...] | Line: [[x,y],[x,y]] */
  coords: number[] | number[][]
  confidence?: number
  approved: boolean
  source: 'manual' | 'model'
}

export interface AnnotationImage {
  id: string
  project_id: string
  filename: string
  url?: string
  width?: number
  height?: number
  status: ImageStatus
  annotations: AnnotationShape[]
  added_at: string
}

export interface ModelVersion {
  id: string
  version: number
  status: 'queued' | 'training' | 'predicting' | 'ready' | 'failed'
  trained_on: number
  map50?: number
  map50_95?: number
  epochs: number
  created_at: string
  completed_at?: string
  error?: string
}

export interface AnnotationProject {
  id: string
  org_id: string
  name: string
  description: string
  classes: string[]
  annotation_type: AnnotationType
  status: ProjectStatus
  image_count: number
  annotated_count: number
  approved_count: number
  min_annotations_to_train: number
  active_model_version_id?: string
  model_versions: ModelVersion[]
  created_at: string
  updated_at: string
}

export interface SaveAnnotationsPayload {
  annotations: Omit<AnnotationShape, 'id'> & { id?: string }[]
}
