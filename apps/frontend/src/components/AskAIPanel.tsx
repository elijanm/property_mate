import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { aiApi } from '@/api/ai'
import type { AIConversationSummary } from '@/types/ai'

interface MessageSentCard {
  channel: 'email' | 'whatsapp'
  tenant_name: string
  tenant_email: string
  subject: string
  preview: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  toolsRunning?: string[]
  messageSent?: MessageSentCard
}

interface Props {
  onClose: () => void
  /** If provided, initialise as property agent for this property */
  propertyId?: string
  propertyName?: string
}

/** Strip <think>...</think> reasoning blocks (handles partial/unclosed blocks during streaming). */
function stripThinking(text: string): string {
  // Remove fully closed think blocks
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // Remove open (still-streaming) think block at end
  out = out.replace(/<think>[\s\S]*$/i, '')
  return out.trimStart()
}

function MessageSentDisplay({ card }: { card: MessageSentCard }) {
  const isEmail = card.channel === 'email'
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden text-xs mt-1">
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-100 border-b border-emerald-200">
        <span className="text-emerald-700 font-semibold">
          {isEmail ? '✉ Email sent' : '💬 WhatsApp sent'}
        </span>
        <span className="ml-auto text-emerald-600 bg-emerald-200 px-1.5 py-0.5 rounded-full capitalize">
          {card.channel}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="flex gap-1">
          <span className="text-emerald-600 font-medium w-12 shrink-0">To:</span>
          <span className="text-gray-700">{card.tenant_name} ({card.tenant_email})</span>
        </div>
        <div className="flex gap-1">
          <span className="text-emerald-600 font-medium w-12 shrink-0">Subject:</span>
          <span className="text-gray-700 font-medium">{card.subject}</span>
        </div>
        <div className="mt-1.5 bg-white rounded-lg border border-emerald-100 px-2.5 py-2 text-gray-600 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
          {card.preview}
          {card.preview.length >= 300 && <span className="text-gray-400">…</span>}
        </div>
      </div>
    </div>
  )
}

function ToolBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-violet-50 text-violet-600 border border-violet-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
      {name.replace(/_/g, ' ')}
    </span>
  )
}

export default function AskAIPanel({ onClose, propertyId, propertyName }: Props) {
  const { user } = useAuth()
  const agentType = propertyId ? 'property' : (
    user?.role === 'tenant' ? 'tenant' : 'owner'
  )
  const agentLabel = propertyId
    ? `${propertyName ?? 'Property'} AI`
    : user?.role === 'tenant' ? 'Tenant AI' : 'Portfolio AI'

  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversations, setConversations] = useState<AIConversationSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Create conversation on mount
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const conv = await aiApi.createConversation({
          agent_type: agentType,
          context_id: propertyId,
          context: propertyId ? { property_id: propertyId, property_name: propertyName } : undefined,
        })
        if (!cancelled) setConvId(conv.id)
      } catch (err: unknown) {
        if (!cancelled) setInitError('Could not start AI session. Check your connection.')
      }
    }
    init()
    return () => { cancelled = true }
  }, [agentType, propertyId, propertyName])

  async function loadHistory() {
    if (historyLoaded) return
    try {
      const data = await aiApi.listConversations({
        agent_type: agentType,
        context_id: propertyId,
        page_size: 20,
      })
      setConversations(data.items)
      setHistoryLoaded(true)
    } catch { /* ignore */ }
  }

  async function loadConversation(id: string) {
    try {
      const conv = await aiApi.getConversation(id)
      setConvId(conv.id)
      setMessages(
        conv.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content ?? '',
        }))
      )
      setShowHistory(false)
    } catch { /* ignore */ }
  }

  async function startNewConversation() {
    try {
      const conv = await aiApi.createConversation({
        agent_type: agentType,
        context_id: propertyId,
        context: propertyId ? { property_id: propertyId, property_name: propertyName } : undefined,
      })
      setConvId(conv.id)
      setMessages([])
      setShowHistory(false)
    } catch { /* ignore */ }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending || !convId) return
    setInput('')
    setSending(true)

    // Add user message
    const userMsgId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: text }])

    // Add placeholder assistant message
    const asstMsgId = crypto.randomUUID()
    setMessages(prev => [
      ...prev,
      { id: asstMsgId, role: 'assistant', content: '', streaming: true, toolsRunning: [] },
    ])

    let accumulated = ''
    const runningTools: string[] = []

    try {
      for await (const event of aiApi.streamMessage(convId, text, {
        property_id: propertyId,
        property_name: propertyName,
      })) {
        if (event.type === 'token') {
          accumulated += event.content
          setMessages(prev =>
            prev.map(m =>
              m.id === asstMsgId
                ? { ...m, content: accumulated, toolsRunning: [...runningTools] }
                : m
            )
          )
        } else if (event.type === 'tool_start') {
          runningTools.push(event.display)
          setMessages(prev =>
            prev.map(m =>
              m.id === asstMsgId ? { ...m, toolsRunning: [...runningTools] } : m
            )
          )
        } else if (event.type === 'tool_end') {
          const idx = runningTools.indexOf(event.name.replace(/_/g, ' '))
          if (idx !== -1) runningTools.splice(idx, 1)
          setMessages(prev =>
            prev.map(m =>
              m.id === asstMsgId ? { ...m, toolsRunning: [...runningTools] } : m
            )
          )
        } else if (event.type === 'message_sent') {
          const card: MessageSentCard = {
            channel: event.channel,
            tenant_name: event.tenant_name,
            tenant_email: event.tenant_email,
            subject: event.subject,
            preview: event.preview,
          }
          const cardMsgId = crypto.randomUUID()
          setMessages(prev => [
            ...prev,
            { id: cardMsgId, role: 'assistant', content: '', messageSent: card },
          ])
        } else if (event.type === 'done') {
          setMessages(prev =>
            prev.map(m =>
              m.id === asstMsgId
                ? { ...m, content: stripThinking(event.content || accumulated), streaming: false, toolsRunning: [] }
                : m
            )
          )
        } else if (event.type === 'error') {
          console.error('[AskAIPanel] stream error event:', event.message)
          setMessages(prev => prev.filter(m => m.id !== asstMsgId))
        }
      }
    } catch (err: unknown) {
      console.error('[AskAIPanel] send error:', err)
      setMessages(prev => prev.filter(m => m.id !== asstMsgId))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const agentColor = agentType === 'property'
    ? 'from-emerald-500 to-teal-500'
    : agentType === 'tenant'
    ? 'from-blue-500 to-cyan-500'
    : 'from-violet-500 to-indigo-500'

  return (
    <div className="fixed inset-0 z-[10000] flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${agentColor} flex items-center justify-center`}>
              <span className="text-white text-[11px]">✦</span>
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-900">{agentLabel}</span>
              <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 font-medium px-1.5 py-0.5 rounded-full">
                {agentType === 'property' ? 'Property' : agentType === 'tenant' ? 'Tenant' : 'Portfolio'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowHistory(v => !v); loadHistory() }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-100"
              title="Conversation history"
            >
              ☰
            </button>
            <button
              onClick={startNewConversation}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-100"
              title="New conversation"
            >
              ✎
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="border-b border-gray-100 bg-gray-50 max-h-48 overflow-y-auto shrink-0">
            {conversations.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No previous conversations</p>
            ) : (
              conversations.map(c => (
                <button
                  key={c.id}
                  onClick={() => loadConversation(c.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-white transition-colors border-b border-gray-100 last:border-0"
                >
                  <p className="text-xs font-medium text-gray-700 truncate">{c.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.last_message}</p>
                </button>
              ))
            )}
          </div>
        )}

        {/* Init error */}
        {initError && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 shrink-0">
            <p className="text-xs text-red-600">{initError}</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${agentColor} flex items-center justify-center opacity-20`}>
                <span className="text-white text-xl">✦</span>
              </div>
              <p className="text-sm text-gray-400">
                {agentType === 'property'
                  ? `Ask me anything about ${propertyName ?? 'this property'}`
                  : agentType === 'tenant'
                  ? 'Ask about your lease, invoices, or tickets'
                  : 'Ask about your portfolio, properties, or finances'}
              </p>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[85%] text-sm leading-relaxed',
                  msg.messageSent
                    ? 'w-full'
                    : `rounded-2xl px-3.5 py-2.5 ${msg.role === 'user'
                        ? `bg-gradient-to-br ${agentColor} text-white rounded-br-sm`
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`,
                ].join(' ')}
              >
                {/* Tool status badges */}
                {msg.role === 'assistant' && (msg.toolsRunning?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {msg.toolsRunning!.map(t => <ToolBadge key={t} name={t} />)}
                  </div>
                )}

                {/* Message sent card */}
                {msg.messageSent && <MessageSentDisplay card={msg.messageSent} />}

                {/* Content */}
                {!msg.messageSent && (() => { const visible = stripThinking(msg.content); return visible ? (
                  <p className="whitespace-pre-wrap">{visible}</p>
                ) : msg.streaming ? (
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                ) : null })()}
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* Suggestions (empty state only) */}
        {messages.length === 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5 shrink-0">
            {(agentType === 'property'
              ? ['Occupancy summary', 'Open tickets', 'Outstanding invoices', 'Active tenants']
              : agentType === 'tenant'
              ? ['My current balance', 'When is my lease ending?', 'My open tickets']
              : ['Portfolio summary', 'Overdue invoices', 'Expiring leases', 'Open tickets']
            ).map(s => (
              <button
                key={s}
                onClick={() => { setInput(s); inputRef.current?.focus() }}
                className="text-[11px] bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full border border-gray-200 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-gray-100 px-4 py-3 shrink-0">
          <div className="flex items-end gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200 focus-within:border-violet-300 focus-within:bg-white transition-colors">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={convId ? 'Ask anything…' : 'Starting session…'}
              disabled={!convId || !!initError}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 resize-none outline-none max-h-28 leading-5 disabled:opacity-50"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending || !convId}
              className={`shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br ${agentColor} flex items-center justify-center text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90`}
            >
              ↑
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  )
}
