export interface AIAgent {
  type: string
  label: string
  description: string
  icon: string
  requires_context: boolean
  context_type?: 'property' | 'tenant'
}

export interface AIConversationSummary {
  id: string
  agent_type: string
  context_id: string | null
  title: string
  last_message: string
  last_role: 'user' | 'assistant' | null
  message_count: number
  total_tokens: number
  created_at: string
  updated_at: string
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string | null
  token_usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
  created_at: string
}

export interface AIConversation {
  id: string
  agent_type: string
  context_id: string | null
  title: string
  model: string
  total_input_tokens: number
  total_output_tokens: number
  messages: AIMessage[]
  created_at: string
  updated_at: string
}

// SSE stream events
export type AIStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; display: string }
  | { type: 'tool_end'; name: string }
  | { type: 'done'; content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
  | { type: 'error'; message: string }
  | { type: 'message_sent'; channel: 'email' | 'whatsapp'; tenant_name: string; tenant_email: string; subject: string; preview: string }
