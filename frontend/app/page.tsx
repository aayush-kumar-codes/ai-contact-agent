'use client'

import { useState, useEffect } from 'react'
import ChatArea from '@/components/ChatArea'
import InputArea from '@/components/InputArea'

const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:3001'

/** Build display text from /agent/chat API response (ok, intent, result, message). */
function formatAgentResponse(data: {
  ok: boolean
  intent?: string
  result?: { contacts?: unknown[]; csvPath?: string; hubspotResults?: { success?: unknown[]; failed?: unknown[] }; sequenceResults?: { success?: unknown[]; failed?: unknown[] } }
  message?: string
}): string {
  if (!data.ok) {
    return data.message ?? 'Something went wrong. Please try again.'
  }
  const r = data.result
  if (!r) return 'Done.'
  const parts: string[] = []
  if (Array.isArray(r.contacts) && r.contacts.length > 0) {
    parts.push(`**${r.contacts.length}** contact(s) extracted.`)
  }
  if (r.csvPath) {
    parts.push(`CSV: \`${r.csvPath}\`.`)
  }
  if (r.hubspotResults) {
    const s = r.hubspotResults.success?.length ?? 0
    const f = r.hubspotResults.failed?.length ?? 0
    parts.push(`HubSpot: ${s} synced, ${f} failed.`)
  }
  if (r.sequenceResults) {
    const s = r.sequenceResults.success?.length ?? 0
    const f = r.sequenceResults.failed?.length ?? 0
    parts.push(`Sequence: ${s} enrolled, ${f} failed.`)
  }
  return parts.length ? parts.join('\n\n') : 'Done.'
}

const WELCOME_MESSAGE: { id: string; content: string; role: 'assistant'; timestamp: Date } = {
  id: 'welcome',
  content: 'Send a **single website URL** to scrape for contacts, or say **"niche"** / **"run niche"** to run the Niche schools agent (uses best-schools search; no URL needed).',
  role: 'assistant',
  timestamp: new Date(),
}

export default function Home() {
  const [messages, setMessages] = useState<Array<{ id: string; content: string; role: 'user' | 'assistant'; timestamp: Date }>>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setMessages([WELCOME_MESSAGE])
    setIsMounted(true)
  }, [])

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return

    const userMessage = {
      id: Date.now().toString(),
      content: text,
      role: 'user' as const,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch(`${AGENT_API_URL}/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      const content = formatAgentResponse(data)

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        content,
        role: 'assistant' as const,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorContent = err instanceof Error ? err.message : 'Request failed. Is the agent server running on port 3001?'
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          content: `**Error:** ${errorContent}`,
          role: 'assistant' as const,
          timestamp: new Date(),
        },
      ])
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
