import client from './client'

export interface TrainingConfig {
  key?: string

  // Hardware
  cuda_device: string
  workers: number
  batch_size: number
  fp16: boolean
  mixed_precision: string        // auto | no | fp16 | bf16
  dataloader_pin_memory: boolean
  prefetch_factor: number

  // Training loop
  max_epochs: number
  early_stopping: boolean
  early_stopping_patience: number

  // Data splitting
  test_split: number
  val_split: number
  random_seed: number

  // Optimisation
  optimizer: string              // adam | adamw | sgd | rmsprop | adagrad
  learning_rate: number
  weight_decay: number
  gradient_clip: number
  lr_scheduler: string           // cosine | linear | step | plateau | none
  warmup_ratio: number

  // Task
  task: string                   // classification | regression | detection | nlp_classification | ...
  num_classes: number | null

  extra?: Record<string, unknown>
}

export interface CudaDeviceDetail {
  index: number
  name: string
  vram_gb: number
  memory_reserved_gb: number
  memory_allocated_gb: number
  compute_capability: string
  multi_processor_count: number
}

export interface DeviceInfo {
  device: string
  cuda_available: boolean
  cuda_device_count: number
  cuda_device_name: string | null
  cuda_devices: CudaDeviceDetail[]
  mps_available: boolean
}

export const configApi = {
  get:       ()                              => client.get<TrainingConfig>('/config').then(r => r.data),
  update:    (data: Partial<TrainingConfig>) => client.patch<TrainingConfig>('/config', data).then(r => r.data),
  getDevice: ()                              => client.get<DeviceInfo>('/config/device').then(r => r.data),
}
