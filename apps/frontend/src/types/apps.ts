export type AppStatus = 'active' | 'inactive' | 'configuring'

export interface VoiceOption {
  id: string
  name: string
}
export type LLMProvider = 'openai' | 'anthropic' | 'openai_compatible'
export type TTSProvider = 'openai' | 'elevenlabs' | 'deepgram'

export interface VoiceAgentConfig {
  phone_number: string
  agent_name: string
  company_name: string
  llm_provider: LLMProvider
  llm_model: string
  llm_api_key: string
  llm_base_url: string
  tts_provider: TTSProvider
  tts_voice: string
  elevenlabs_api_key: string
  deepgram_api_key: string
  auto_mode: boolean
  recording_enabled: boolean
  greeting_message: string
  sandbox_enabled: boolean
}

export interface InstalledApp {
  id: string
  org_id: string
  app_id: string
  app_name: string
  status: AppStatus
  config: VoiceAgentConfig | Record<string, unknown>
  installed_by: string
  installed_at: string
  updated_at: string
}

export interface TranscriptTurn {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: string
}

export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  result: unknown
  error: string | null
  timestamp: string
}

export interface KeywordAlert {
  keyword: string
  context: string
  timestamp: string
}

export interface ApiCallRecord {
  method: string
  url: string
  payload: unknown
  status_code: number | null
  response: unknown
  duration_ms: number | null
  timestamp: string
}

export interface CallMetrics {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  tts_characters: number
  stt_minutes: number
  llm_cost_usd: number
  tts_cost_usd: number
  stt_cost_usd: number
  total_cost_usd: number
}

export interface CallSession {
  id: string
  call_control_id: string
  caller_number: string
  called_number: string
  org_id: string
  tenant_id: string | null
  tenant_name: string | null
  status: 'active' | 'completed' | 'failed' | 'transferred' | 'abandoned'
  auto_mode: boolean
  recording_enabled: boolean
  recording_key: string | null
  transcript: TranscriptTurn[]
  tool_calls: ToolCallRecord[]
  summary: string | null
  sentiment: string | null
  quality_score: number | null
  keyword_alerts: KeywordAlert[] | undefined
  actions_taken: string[]
  metrics: CallMetrics | null
  api_calls: ApiCallRecord[] | undefined
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
}

export interface CallSessionListResponse {
  items: CallSession[]
  total: number
  page: number
  page_size: number
}

export interface VoiceAgentMetrics {
  total_calls: number
  answered_calls: number
  transferred_calls: number
  avg_duration_seconds: number
  tickets_created: number
  payment_links_sent: number
  unique_callers: number
  calls_by_day: Array<{ date: string; count: number }>
}
