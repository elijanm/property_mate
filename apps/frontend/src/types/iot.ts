// ── Device ────────────────────────────────────────────────────────────────
export type DeviceStatus = 'provisioned' | 'online' | 'offline' | 'quarantined' | 'decommissioned'
export type DeviceCategory = 'smart_lock' | 'meter' | 'sensor' | 'camera' | 'gateway' | 'lora_node' | 'modbus' | 'custom'
export type DeviceProtocol = 'mqtt' | 'http' | 'lorawan' | 'modbus' | 'custom'

export interface DeviceCapabilities {
  telemetry: boolean
  rpc: boolean
  ota: boolean
  ssh: boolean
  attributes: boolean
  streaming: boolean
}

export interface DeviceConfig {
  telemetry_interval_s?: number
  telemetry_qos?: number
  extras?: Record<string, unknown>
}

export interface TailscaleStatus {
  online: boolean
  ip: string | null
  node_id: string | null
  hostname: string | null
  last_seen: string | null
  os: string | null
  timezone: string | null
  auto_matched: boolean
}

export interface Device {
  id: string
  org_id: string
  property_id: string
  device_uid: string
  name: string
  description?: string
  serial_number?: string
  tags: string[]
  device_type_id: string
  device_type_category: DeviceCategory
  unit_id?: string
  store_location_id?: string
  gateway_id?: string
  mqtt_username: string
  mqtt_client_id: string
  status: DeviceStatus
  capabilities: DeviceCapabilities
  config?: DeviceConfig
  firmware_version?: string
  ota_pending_version?: string
  tailscale_ip?: string
  tailscale_node_id?: string
  tailscale_node_key?: string
  tailscale_hostname?: string
  tailscale_status?: TailscaleStatus
  cert_fingerprint?: string
  cert_serial?: string
  cert_issued_at?: string
  cert_expires_at?: string
  last_seen_at?: string
  last_telemetry_at?: string
  quarantine_reason?: string
  quarantined_at?: string
  quarantined_by?: string
  inventory_item_id?: string
  inventory_serial_id?: string
  asset_id?: string
  tb_device_id?: string
  created_at: string
  updated_at: string
}

export interface ProvisionedDevice extends Device {
  mqtt_password: string
  ssh_preauth_key?: string
  headscale_namespace?: string
  tailscale_login_cmd?: string
}

export interface SyncStep {
  name: string
  status: 'ok' | 'skipped' | 'error'
  detail: string
  external_id: string
}

export interface RegisterDeviceResult {
  status: 'provisioned' | 'partial'
  device_id: string
  device_uid: string
  org_id: string
  property_id: string
  unit_id?: string

  // MQTT
  mqtt_username: string
  mqtt_password: string
  mqtt_client_id: string
  mqtt_broker_host: string
  mqtt_broker_port: number

  // mTLS (shown once — save securely)
  device_cert_pem?: string
  device_key_pem?: string
  cert_fingerprint?: string
  cert_expires_at?: string

  // ThingsBoard
  tb_device_id?: string
  tb_access_token?: string
  tb_tenant_id?: string
  tb_customer_id?: string
  tb_asset_id?: string
  tb_dashboard_url?: string

  // Audit trail
  steps: SyncStep[]
  note: string

  // SSH setup
  ssh_setup?: Record<string, unknown>
}

// ── Device Type ───────────────────────────────────────────────────────────
export interface TelemetryField {
  key: string
  label: string
  unit?: string
  data_type: 'number' | 'string' | 'boolean'
  min_value?: number
  max_value?: number
  description?: string
}

export interface RpcCommand {
  name: string
  label: string
  description?: string
  params_schema: Record<string, unknown>
}

export interface DeviceType {
  id: string
  org_id?: string
  name: string
  category: DeviceCategory
  protocol: DeviceProtocol
  telemetry_schema: TelemetryField[]
  attribute_schema: TelemetryField[]
  capabilities: string[]
  rpc_commands: RpcCommand[]
  ota_supported: boolean
  ota_firmware_s3_prefix?: string
  icon?: string
  description?: string
  is_active: boolean
  tb_device_profile_id?: string
  created_at: string
  updated_at: string
}

// ── Alert Rules ───────────────────────────────────────────────────────────
export type AlertOperator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq'
export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertRule {
  id: string
  org_id: string
  property_id?: string
  device_id?: string
  device_type_id?: string
  group_id?: string
  name: string
  description?: string
  is_active: boolean
  telemetry_key: string
  operator: AlertOperator
  threshold: number
  consecutive_violations: number
  cooldown_m: number
  severity: AlertSeverity
  alert_message_template: string
  create_ticket: boolean
  notify_email: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface AlertRulePayload {
  name: string
  description?: string
  device_id?: string
  device_type_id?: string
  group_id?: string
  property_id?: string
  telemetry_key: string
  operator: AlertOperator
  threshold: number
  consecutive_violations?: number
  cooldown_m?: number
  severity?: AlertSeverity
  alert_message_template?: string
  create_ticket?: boolean
  notify_email?: boolean
}

// ── OTA ───────────────────────────────────────────────────────────────────
export type OTAStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'
export type DeviceOTAStatus = 'pending' | 'sent' | 'in_progress' | 'completed' | 'failed'

export interface DeviceOTAProgress {
  device_id: string
  device_uid: string
  status: DeviceOTAStatus
  progress_pct: number
  error?: string
  started_at?: string
  completed_at?: string
}

export interface OTAUpdate {
  id: string
  org_id: string
  device_type_id: string
  target_version: string
  firmware_size_bytes?: number
  checksum_sha256?: string
  release_notes?: string
  device_ids: string[]
  group_id?: string
  rollout_pct: number
  status: OTAStatus
  device_statuses: DeviceOTAProgress[]
  created_by: string
  created_at: string
  updated_at: string
}

// ── Device Groups / Fleets ────────────────────────────────────────────────
export interface DeviceGroup {
  id: string
  org_id: string
  property_id?: string
  name: string
  description?: string
  tags: string[]
  device_ids: string[]
  tag_filter?: string
  member_count?: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface DeviceGroupPayload {
  name: string
  description?: string
  property_id?: string
  device_ids?: string[]
  tag_filter?: string
  tags?: string[]
}

// ── SSH ───────────────────────────────────────────────────────────────────
export type SSHRequestStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'denied'

export interface SSHAccessRequest {
  id: string
  org_id: string
  target_type: 'device' | 'gateway'
  target_id: string
  target_name: string
  target_tailscale_ip: string
  target_port: number
  requester_user_id: string
  requester_email?: string
  requester_tailscale_ip?: string
  reason: string
  requested_duration_m: number
  status: SSHRequestStatus
  approved_by_user_id?: string
  approved_at?: string
  expires_at?: string
  denied_by_user_id?: string
  denied_at?: string
  denial_reason?: string
  headscale_acl_comment?: string
  approval_ticket_id?: string
  created_at: string
  updated_at: string
}

export interface SSHRequestPayload {
  target_type: 'device' | 'gateway'
  target_id: string
  reason: string
  requested_duration_m: number
  requester_tailscale_ip?: string
}

export interface SSHAuditLog {
  id: string
  org_id: string
  ssh_request_id: string
  session_start: string
  session_end?: string
  source_ip: string
  destination_ip: string
  destination_port: number
  duration_seconds?: number
  commands_count?: number
  bytes_rx?: number
  bytes_tx?: number
  status: 'active' | 'completed' | 'terminated'
  termination_reason?: string
  recording_s3_key?: string
  recording_format?: string
  user_id: string
  user_email?: string
}

export interface SSHSetupInfo {
  device_id: string
  device_uid: string
  name: string
  tailscale_ip?: string
  tailscale_registered: boolean
  preauth_key?: string
  headscale_namespace?: string
  tailscale_login_cmd?: string
  tailscale_hostname?: string
  ssh_command?: string
  ssh_command_named?: string
  ca_cert_pem?: string
}

// ── Device Commands ───────────────────────────────────────────────────────
export type CommandStatus = 'pending' | 'sent' | 'acknowledged' | 'success' | 'failed' | 'timeout'

export interface DeviceCommand {
  id: string
  org_id: string
  device_id: string
  command_name: string
  params: Record<string, unknown>
  request_id: string
  status: CommandStatus
  response?: unknown
  error_message?: string
  sent_by_user_id: string
  sent_via: 'api' | 'scheduler' | 'automation'
  sent_at?: string
  acknowledged_at?: string
  completed_at?: string
  timeout_at?: string
  created_at: string
}

export interface CommandPayload {
  command_name: string
  params?: Record<string, unknown>
  timeout_s?: number
}

// ── Payloads ─────────────────────────────────────────────────────────────
export interface DeviceRegisterPayload {
  name: string
  device_type_id: string
  device_uid: string
  property_id: string
  unit_id?: string
  store_location_id?: string
  gateway_id?: string
  description?: string
  serial_number?: string
  tags?: string[]
  inventory_item_id?: string
  inventory_serial_id?: string
}

export interface DeviceUpdatePayload {
  name?: string
  description?: string
  tags?: string[]
  unit_id?: string
  store_location_id?: string
  gateway_id?: string
  config?: DeviceConfig
}

export interface QuarantinePayload {
  reason: string
}

export interface BulkCommandPayload {
  command_name: string
  params?: Record<string, unknown>
}
