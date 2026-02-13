'use client'

import { useState, useEffect } from 'react'
import ChatArea from '@/components/ChatArea'
import InputArea from '@/components/InputArea'

// Always use absolute backend URL so we never accidentally POST to the Next.js server (which would 404)
const AGENT_API_URL = (() => {
  const url = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:3001'
  if (!url || url.startsWith('/')) return 'http://localhost:3001'
  return url.replace(/\/$/, '') // trim trailing slash
})()

export type AgentRunStep = { id: string; label: string; detail?: string; status: 'running' | 'done' | 'skipped'; parentId?: string }
export type AgentRun = { steps: AgentRunStep[]; summary?: string; csvDownloadUrl?: string }

export type Message = {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  agentRun?: AgentRun
}

/** Build summary text from stream done result. */
function buildSummary(result: {
  contactsCount?: number
  hubspotResults?: { success?: unknown[]; failed?: unknown[] }
  sequenceResults?: { success?: unknown[]; failed?: unknown[] }
}): string {
  const parts: string[] = []
  if (typeof result.contactsCount === 'number' && result.contactsCount > 0) {
    parts.push(`**${result.contactsCount}** contact(s) extracted.`)
  }
  if (result.hubspotResults) {
    const s = result.hubspotResults.success?.length ?? 0
    const f = result.hubspotResults.failed?.length ?? 0
    parts.push(`HubSpot: ${s} synced, ${f} failed.`)
  }
  if (result.sequenceResults) {
    const s = result.sequenceResults.success?.length ?? 0
    const f = result.sequenceResults.failed?.length ?? 0
    parts.push(`Sequence: ${s} enrolled, ${f} failed.`)
  }
  return parts.length ? parts.join('\n\n') : 'Done.'
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  content: 'Send a **single website URL** to scrape for contacts, or say **"niche"** / **"run niche"** to run the Niche schools agent (uses best-schools search; no URL needed).',
  role: 'assistant',
  timestamp: new Date(),
}

/** Parse SSE stream: read chunks, split by double newline, parse data lines as JSON. */
async function consumeSSE(
  res: Response,
  onEvent: (event: { type: string; [k: string]: unknown }) => void
) {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\n\n+/)
      buffer = events.pop() ?? ''
      for (const block of events) {
        const line = block.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const raw = line.slice(5).trim()
        if (raw === '[DONE]' || !raw) continue
        try {
          const event = JSON.parse(raw) as { type: string; [k: string]: unknown }
          onEvent(event)
        } catch {
          // ignore malformed JSON
        }
      }
    }
    if (buffer.trim()) {
      const line = buffer.split('\n').find((l) => l.startsWith('data:'))
      if (line) {
        const raw = line.slice(5).trim()
        if (raw && raw !== '[DONE]') {
          try {
            onEvent(JSON.parse(raw) as { type: string; [k: string]: unknown })
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setMessages([WELCOME_MESSAGE])
    setIsMounted(true)
  }, [])

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: text,
      role: 'user',
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    const assistantId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantId,
      content: '',
      role: 'assistant',
      timestamp: new Date(),
      agentRun: { steps: [] },
    }
    setMessages((prev) => [...prev, assistantMessage])

    try {
      const res = await fetch(`${AGENT_API_URL}/agent/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Request failed')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `**Error:** ${errText}`, agentRun: undefined }
              : m
          )
        )
        return
      }

      await consumeSSE(res, (event) => {
        if (event.type === 'step') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId || !m.agentRun) return m
              const step = {
                id: String(event.id),
                label: String(event.label),
                detail: event.detail != null ? String(event.detail) : undefined,
                status: (event.status as 'running' | 'done' | 'skipped') || 'running',
                parentId: event.parentId != null ? String(event.parentId) : undefined,
              }
              const existing = m.agentRun.steps.findIndex((s) => s.id === step.id)
              const steps =
                existing >= 0
                  ? m.agentRun.steps.map((s, i) => (i === existing ? step : s))
                  : [...m.agentRun.steps, step]
              return { ...m, agentRun: { ...m.agentRun, steps } }
            })
          )
        } else if (event.type === 'done' && event.result) {
          const result = event.result as {
            contactsCount?: number
            csvDownloadUrl?: string
            hubspotResults?: { success?: unknown[]; failed?: unknown[] }
            sequenceResults?: { success?: unknown[]; failed?: unknown[] }
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.agentRun
                ? {
                    ...m,
                    content: buildSummary(result),
                    agentRun: {
                      ...m.agentRun,
                      summary: buildSummary(result),
                      csvDownloadUrl: result.csvDownloadUrl ?? undefined,
                    },
                  }
                : m
            )
          )
        } else if (event.type === 'error') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `**Error:** ${event.message ?? 'Unknown error'}`, agentRun: undefined }
                : m
            )
          )
        }
      })
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : 'Request failed. Is the agent server running on port 3001?'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `**Error:** ${errorContent}`, agentRun: undefined }
            : m
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!isMounted) {
    return (
      <div className="flex h-screen bg-background text-foreground overflow-hidden flex-col items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden flex-col">
      <ChatArea messages={messages} isLoading={isLoading} />
      <InputArea input={input} setInput={setInput} onSend={handleSendMessage} isLoading={isLoading} />
    </div>
  )
}
