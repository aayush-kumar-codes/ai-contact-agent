'use client'

import { Copy, Check, Loader2, CheckCircle2, CircleSlash } from 'lucide-react'
import { useState } from 'react'

interface AgentRunStep {
  id: string
  label: string
  detail?: string
  status: 'running' | 'done' | 'skipped'
  parentId?: string
}

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  agentRun?: {
    steps: AgentRunStep[]
    summary?: string
    csvDownloadUrl?: string
  }
}

interface MessageBubbleProps {
  message: Message
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = message.agentRun?.summary ?? message.content
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = message.role === 'user'

  // Simple markdown-like formatting
  const formatContent = (text: string) => {
    if (!text) return null
    return text.split('\n').map((line, idx) => {
      // Handle bold text
      const parts = line.split(/(\*\*.*?\*\*)/g)
      return (
        <div key={idx} className="mb-2 last:mb-0">
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <span key={i} className="font-semibold">
                  {part.slice(2, -2)}
                </span>
              )
            }
            return <span key={i}>{part}</span>
          })}
        </div>
      )
    })
  }

  const agentRun = message.agentRun
  const showSteps = agentRun && agentRun.steps.length > 0
  const showSummary = agentRun && (agentRun.summary || agentRun.csvDownloadUrl)
  const displayContent = showSummary ? (agentRun.summary ?? '') : message.content

  const isVerboseSuccessChild = (step: AgentRunStep) => {
    if (!step.parentId || step.status !== 'done') return false
    return (
      step.label === 'Fetching school profile' ||
      step.label === 'Scraping school website for contacts' ||
      step.label === 'Extracting contacts with AI' ||
      step.label.startsWith('HubSpot synced:') ||
      step.label.startsWith('Sequence enrolled:')
    )
  }

  const getVisibleSteps = (steps: AgentRunStep[]) => {
    const byParent = steps.reduce<Record<string, AgentRunStep[]>>((acc, step) => {
      if (step.parentId) {
        if (!acc[step.parentId]) acc[step.parentId] = []
        acc[step.parentId].push(step)
      }
      return acc
    }, {})

    const topLevel = steps.filter((step) => !step.parentId)
    const visibleTopLevel = topLevel.filter((step) => {
      const children = byParent[step.id] ?? []
      const hasVisibleChildren = children.some((child) => !isVerboseSuccessChild(child))
      if (step.status === 'running') return true
      if (step.status === 'skipped') return true
      if (step.label.startsWith('Page ') || step.label.startsWith('CSV updated')) return true
      if (step.label.startsWith('Uploading to HubSpot') || step.label.startsWith('Enrolling in sequence')) return true
      if (step.label.startsWith('School on page')) return true
      if (children.length === 0) return true
      return hasVisibleChildren
    })

    const visibleByParent = Object.fromEntries(
      Object.entries(byParent).map(([parentId, children]) => [
        parentId,
        children.filter((child) => !isVerboseSuccessChild(child)),
      ])
    )

    return { visibleTopLevel, visibleByParent }
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-4 py-3 max-w-2xl group ${
          isUser
            ? 'bg-foreground text-background rounded-md'
            : 'bg-transparent text-foreground'
        }`}
      >
        {showSteps && (
          <div className="space-y-1 mb-3 text-sm">
            {(() => {
              const steps = agentRun!.steps
              const { visibleTopLevel, visibleByParent } = getVisibleSteps(steps)
              const stepIcon = (step: AgentRunStep) => {
                if (step.status === 'running')
                  return <Loader2 size={14} className="shrink-0 mt-0.5 animate-spin text-muted-foreground" />
                if (step.status === 'done')
                  return <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                if (step.status === 'skipped')
                  return <CircleSlash size={14} className="shrink-0 mt-0.5 text-muted-foreground" />
                return null
              }
              const renderStep = (step: AgentRunStep, isSub = false) => (
                <div
                  key={step.id}
                  className={isSub ? 'flex items-start gap-2 pl-5 border-l-2 border-muted/50 ml-1 py-0.5' : 'flex items-start gap-2 py-0.5'}
                >
                  {stepIcon(step)}
                  <span className={isSub ? 'text-muted-foreground' : ''}>
                    <span className={isSub ? '' : 'font-medium'}>{step.label}</span>
                    {step.detail && (
                      <span className="text-muted-foreground ml-1">— {step.detail}</span>
                    )}
                  </span>
                </div>
              )
              return (
                <>
                  {visibleTopLevel.map((step) => (
                    <div key={step.id} className="space-y-0.5">
                      {renderStep(step, false)}
                      {(visibleByParent[step.id] ?? []).map((sub) => renderStep(sub, true))}
                    </div>
                  ))}
                </>
              )
            })()}
          </div>
        )}

        {displayContent ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {formatContent(displayContent)}
          </div>
        ) : null}

        {agentRun?.csvDownloadUrl && (
          <div className="mt-3 pt-3 border-t border-border">
            <a
              href={agentRun.csvDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              Download CSV
            </a>
          </div>
        )}

        {!isUser && (displayContent || showSteps) && (
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 p-1 rounded text-muted-foreground hover:text-foreground"
            title="Copy message"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}
