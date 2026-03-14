import client from '@/api/client'
import { TOKEN_KEY } from '@/constants/storage'
import type { AIAgent, AIConversation, AIConversationSummary, AIStreamEvent } from '@/types/ai'

// Mirror the same base URL logic as api/client.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1`
  : '/api/v1'

export const aiApi = {
  listAgents: () =>
    client.get<{ agents: AIAgent[] }>('/ai/agents').then(r => r.data.agents),

  createConversation: (data: {
    agent_type?: string
    context_id?: string
    context?: Record<string, unknown>
  }) =>
    client
      .post<{ id: string; agent_type: string; context_id: string | null; model: string; created_at: string }>(
        '/ai/conversations',
        data
      )
      .then(r => r.data),

  listConversations: (params?: {
    agent_type?: string
    context_id?: string
    page?: number
    page_size?: number
  }) =>
    client
      .get<{ items: AIConversationSummary[]; total: number }>('/ai/conversations', { params })
      .then(r => r.data),

  getConversation: (id: string) =>
    client.get<AIConversation>(`/ai/conversations/${id}`).then(r => r.data),

  deleteConversation: (id: string) =>
    client.delete(`/ai/conversations/${id}`),

  getUsage: () =>
    client.get<{
      by_agent: Array<{
        agent_type: string
        conversations: number
        input_tokens: number
        output_tokens: number
        total_tokens: number
      }>
      total_conversations: number
      total_tokens: number
    }>('/ai/usage').then(r => r.data),

  /**
   * Stream a message via SSE (fetch + ReadableStream).
   * Returns an async generator yielding AIStreamEvent objects.
   */
  async *streamMessage(
    convId: string,
    content: string,
    context?: Record<string, unknown>
  ): AsyncGenerator<AIStreamEvent> {
    const token = localStorage.getItem(TOKEN_KEY)

    const resp = await fetch(`${API_BASE}/ai/conversations/${convId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, context }),
    })

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => 'Unknown error')
      yield { type: 'error', message: text }
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const raw = trimmed.slice(5).trim()
        if (raw === '[DONE]') return
        try {
          yield JSON.parse(raw) as AIStreamEvent
        } catch {
          // ignore malformed lines
        }
      }
    }
  },
}
